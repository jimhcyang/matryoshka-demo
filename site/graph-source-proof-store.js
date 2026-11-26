/* Byte-pinned source inspection only. No node identity or evidence votes. */
const SHA=/^[a-f0-9]{64}$/;
const MAX_DECODED=8_000_000,MAX_WIRE=8_000_000;
const encoder=new TextEncoder();
const hex=bytes=>[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
const hash=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
let manifestPromise;
const cache=new Map();

export async function boundedBytes(stream,limit){
  if(!stream?.getReader)throw Error('Bounded source proof streaming is unavailable.');
  const reader=stream.getReader(),chunks=[];let size=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Source proof exceeds its byte bound.');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}return bytes;
}

function localURL(path){
  const root=new URL('./graph-source-proofs/',import.meta.url),url=new URL(path,root);
  if(url.origin!==location.origin||!url.href.startsWith(root.href)||url.search||url.hash)
    throw Error('Source proof path is not in the local frozen asset directory.');
  return url;
}

async function getManifest(){
  const meta=document.querySelector('meta[name="graph-node-source-proof-index"]');
  if(!meta)return null;
  if(!SHA.test(meta.dataset.sha256||''))throw Error('Source proof manifest pin is missing.');
  if(new URL(meta.content,document.baseURI).href!==localURL('manifest.json').href)
    throw Error('Source proof manifest location changed.');
  if(!manifestPromise)manifestPromise=(async()=>{
    const response=await fetch(localURL('manifest.json'),{credentials:'omit',redirect:'error',mode:'same-origin'});
    if(!response.ok)throw Error('Source proof manifest HTTP '+response.status);
    const bytes=await boundedBytes(response.body,1_000_000);
    if(await hash(bytes)!==meta.dataset.sha256)throw Error('Source proof manifest hash changed.');
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(data.version!=='graph-native-node-source-proof-shards/3'||data.bucket_count!==128||
        data.decoded_shard_limit!==MAX_DECODED||data.inspection_only!==true||
        data.graph_or_source_modified!==false||data.inference_calls!==0)throw Error('Source proof manifest contract changed.');
    return data;
  })();
  return manifestPromise;
}

function sameBinding(a,b){return JSON.stringify(a)===JSON.stringify(b);}

export async function chunkedNodeSourceProofs(nodeId,binding){
  const manifest=await getManifest();if(!manifest)return [];
  const matches=Object.entries(manifest.corpora).filter(([,entry])=>
    entry.binding.browser_graph_id===binding.graph_run_id&&entry.binding.browser_hierarchy_id===binding.hierarchy_run_id&&
    entry.binding.resource_id===(binding.source_resource?.id||null));
  if(matches.length!==1)return [];
  const [corpus,entry]=matches[0],idHash=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(nodeId)));
  const bucket=(idHash[0]%128).toString(16).padStart(2,'0'),ref=entry.buckets[bucket];
  if(!ref||ref.path!==corpus+'/'+bucket+'.json.gz'||!SHA.test(ref.sha256)||!SHA.test(ref.wire_sha256)||
      !Number.isSafeInteger(ref.decoded_bytes)||ref.decoded_bytes<=0||ref.decoded_bytes>=MAX_DECODED||
      !Number.isSafeInteger(ref.wire_bytes)||ref.wire_bytes<=0||ref.wire_bytes>=MAX_WIRE)
    throw Error('Source proof shard bounds or path changed.');
  const key=ref.wire_sha256;
  if(!cache.has(key)){
    const pending=(async()=>{
      const response=await fetch(localURL(ref.path),{credentials:'omit',redirect:'error',mode:'same-origin'});
      if(!response.ok)throw Error('Source proof shard HTTP '+response.status);
      const wire=await boundedBytes(response.body,Math.min(MAX_WIRE,ref.wire_bytes));
      if(wire.byteLength!==ref.wire_bytes||await hash(wire)!==ref.wire_sha256)throw Error('Source proof wire hash changed.');
      if(typeof DecompressionStream==='undefined')throw Error('Compressed source proof decoding is unavailable.');
      const decoded=await boundedBytes(new Blob([wire]).stream().pipeThrough(new DecompressionStream('gzip')),Math.min(MAX_DECODED,ref.decoded_bytes));
      if(decoded.byteLength!==ref.decoded_bytes||await hash(decoded)!==ref.sha256)throw Error('Source proof decoded hash changed.');
      const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));
      if(packet.version!=='graph-index-source-proofs/3'||!sameBinding(packet.binding,entry.binding)||
          !Array.isArray(packet.rows)||packet.rows.length!==ref.records)throw Error('Source proof shard binding changed.');
      const nodes=new Map();
      for(const row of packet.rows){
        if(typeof row.node_id!=='string'||row.inspection_only!==true||row.source_ascription_only!==true||
            !['native_observation_span','native_source_edge_unit_context'].includes(row.proof_kind)||
            row.proof_kind==='native_source_edge_unit_context'&&row.node_assertion_certified!==false)
          throw Error('Source proof row authority changed.');
        if(!nodes.has(row.node_id))nodes.set(row.node_id,[]);nodes.get(row.node_id).push(row);
      }
      return nodes;
    })();
    cache.set(key,pending);
    pending.catch(()=>cache.delete(key));
    // Bound decoded-memory retention; evicted shards can be verified again.
    while(cache.size>6)cache.delete(cache.keys().next().value);
  }
  return (await cache.get(key)).get(nodeId)||[];
}

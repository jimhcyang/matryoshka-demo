import {buildInspectionGuide,openInspectionGuide,assertInspectionGuide} from './workbench-evidence-navigation.js';

const abort = signal => { if(signal?.aborted)throw new DOMException('Inspection cancelled','AbortError'); };
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const bytesJSON = bytes => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));

// Public graph transport remains separate from retained Live evidence.
export async function inspectionJSON(path,{signal,sha256,wire_sha256,maxBytes=128*1024*1024,maxWireBytes=64*1024*1024}={}){
  abort(signal);
  const root=new URL('./',import.meta.url),url=new URL(path.replace(/^\/(?!\/)/,''),root);
  if(url.origin!==root.origin||!url.href.startsWith(root.href))throw Error('Nonlocal source inspection asset.');
  const relative=url.pathname.slice(root.pathname.length);
  let bytes,wire;
  if(relative.startsWith('api/')||relative.startsWith('graph-assets-v4/')){
    const packet=await globalThis.PublicReplay.verified(url,signal);bytes=packet.decoded;wire=packet.wire;
  }else{
    if(!/^(?:data\/source-inspection-v1\/|graph-source-proofs\/)/.test(relative)||url.search||url.hash)throw Error('Unbound source inspection path.');
    wire=await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();xhr.open('GET',url.href);xhr.responseType='arraybuffer';xhr.timeout=60000;
      const cancel=()=>xhr.abort(),clean=()=>signal?.removeEventListener('abort',cancel);
      xhr.onprogress=e=>{if(e.loaded>maxWireBytes)xhr.abort();};
      xhr.onload=()=>{clean();if(xhr.status!==200||!xhr.response||xhr.response.byteLength>maxWireBytes)reject(Error('Source inspection asset unavailable or oversized.'));else resolve(new Uint8Array(xhr.response));};
      xhr.onerror=xhr.ontimeout=()=>{clean();reject(Error('Source inspection asset unavailable.'));};
      xhr.onabort=()=>{clean();reject(new DOMException('Inspection cancelled','AbortError'));};
      signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();else xhr.send();
    });
    bytes=wire;
    if(wire[0]===31&&wire[1]===139){
      const stream=new Blob([wire]).stream().pipeThrough(new DecompressionStream('gzip'));
      const reader=stream.getReader(),chunks=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw Error('Decoded inspection asset is oversized.');}chunks.push(value);}}finally{reader.releaseLock();}
      bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    }
  }
  if(bytes.length>maxBytes||wire.length>maxWireBytes)throw Error('Inspection asset exceeds its bound: '+relative+' ('+bytes.length+'/'+maxBytes+' decoded, '+wire.length+'/'+maxWireBytes+' stored).');
  if(sha256&&await hash(bytes)!==sha256||wire_sha256&&await hash(wire)!==wire_sha256)throw Error('Inspection asset hash differs.');
  abort(signal);return bytesJSON(bytes);
}

function readyBridge(frame,signal){
  return new Promise((resolve,reject)=>{
    const start=performance.now();let timer;
    const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
    const cancel=()=>{clean();reject(new DOMException('Inspection cancelled','AbortError'));};
    const poll=()=>{
      try{
        abort(signal);const bridge=frame.contentWindow?.MatryoshkaGraphInspection;
        if(bridge?.describe()?.ready){clean();resolve(bridge);return;}
        if(performance.now()-start>90000){clean();reject(Error('The existing corpus map did not become ready.'));return;}
        timer=setTimeout(poll,100);
      }catch(error){clean();reject(error);}
    };
    signal?.addEventListener('abort',cancel,{once:true});poll();
  });
}

export async function mountEvidenceInspection(options){
  const {host,caseInfo,config,binding,facts,proof,sourcePolicy,getSourcePage,getNode,sourceIndex,
    signal,assertCurrent=()=>{},onSource}=options;
  const ensure=()=>{abort(signal);assertCurrent();};ensure();
  const doc=host.ownerDocument,status=doc.createElement('p'),controls=doc.createElement('div'),frame=doc.createElement('iframe');
  const readout=doc.createElement('button');readout.type='button';readout.textContent='Inspect selected source';readout.onclick=()=>{ensure();onSource(proof);};
  frame.title='Knowledge Graph source navigator';frame.className='workbench-kg-frame';frame.dataset.testid='existing-kg-inspection-frame';
  status.textContent='Locating the selected quotation in the corpus map…';status.setAttribute('role','status');
  host.replaceChildren(status,controls,frame,readout);
  const guide=await buildInspectionGuide({caseInfo,config,binding,facts,proofs:[proof],sourcePolicy,fetchJSON:inspectionJSON,
    signal,getSourcePage,getNode,sourceIndex});ensure();
  host.dataset.graphHops=String(guide.graph_hop_count);host.dataset.routeMode=guide.route_mode;
  if(!guide.actions.some(action=>action.node_id)){
    frame.remove();controls.remove();
    status.textContent='This exact excerpt has no linked graph extraction. Inspect its source instead.';
    return {guide,controller:null,destroy:()=>{}};
  }
  const url=new URL('./graph-full-v6.html',import.meta.url);
  url.search=new URLSearchParams({corpus:caseInfo.corpus,inspection_embed:'1',level:'evidence',as_of:caseInfo.date,
    release:guide.viewer.view==='current_later'?'later':'earlier'});
  frame.src=url.href;
  const bridge=await readyBridge(frame,signal);ensure();
  const controller=await openInspectionGuide({guide,host:controls,signal,playInterval:2200,
    onOpen:async(action,{signal:actionSignal})=>{ensure();assertInspectionGuide(guide);await bridge.apply(action,{...guide.viewer,
      corpus:guide.corpus,resource_binding:guide.resource_binding},{signal:actionSignal});ensure();},
    inspect:async selected=>{ensure();
      let quote=host.querySelector('[data-testid="inspection-endpoint-quote"]');
      if(!quote){quote=doc.createElement('blockquote');quote.dataset.testid='inspection-endpoint-quote';host.insertBefore(quote,readout);}
      quote.textContent=selected.text;readout.focus({preventScroll:true});
    }});
  status.textContent=guide.graph_hop_count?`${guide.graph_hop_count} source connection${guide.graph_hop_count===1?'':'s'} · selected quotation`:
    guide.actions.some(a=>a.node_id)?'Source node and its community':'Selected source quotation';
  host.dataset.graphHops=String(guide.graph_hop_count);host.dataset.routeMode=guide.route_mode;
  return {guide,controller,destroy:()=>controller.close()};
}

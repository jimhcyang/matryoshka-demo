// Verified public wire remains sanitized; receipt identities are hash-only proofs.
const bindings=new WeakMap();
const fail=message=>{throw Error('V8 raw binding: '+message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function stable(value){
  return Array.isArray(value)?value.map(stable):value&&typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
}
const ascii=value=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
async function hash(text){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function receiptIdentity(tree,root,record,nativePath,narrativeProjection){
  const witness=tree?.unpublished_query_receipt_identities;
  if(witness===undefined)return {root,witness:null};
  const singleton=witness?.version==='unpublished-query-receipt-identities/3';
  if(!narrativeProjection||!same(nativePath,['native'])||
      !exact(tree,['native','resource_binding','unpublished_query_receipt_identities'])||
      !exact(witness,['version','projection_kind','source_native_sha256','public_native_sha256','source_plan_sha256','public_plan_sha256','receipts',...(singleton?['receipt_layout']:[])])||
      !['unpublished-query-receipt-identities/2','unpublished-query-receipt-identities/3'].includes(witness.version)||
      witness.projection_kind!=='QUERY_PREPARATION_RECEIPT_LOCATION_IDENTITIES_ONLY'||
      ![witness.source_native_sha256,witness.public_native_sha256,witness.source_plan_sha256,witness.public_plan_sha256].every(sha)||
      witness.source_native_sha256!==record.native_record_sha256||
      !Array.isArray(witness.receipts)||witness.receipts.length<1||witness.receipts.length>8)
    fail('invalid query receipt identity projection');
  if(!['terminal-evidence-fit/8','terminal-context-priority/10'].includes(root?.result?.terminal_scores?.version))
    fail('unsupported native score version for receipt projection');
  const rows=root?.plan?.receipt;
  if(!rows||typeof rows!=='object'||Array.isArray(rows))fail('query receipt stages missing');
  if(singleton){
    const item=witness.receipts[0];
    if(root.result.terminal_scores.version!=='terminal-context-priority/10'||witness.receipt_layout!=='SINGLE_QUERY_PREPARATION_ROW'||witness.receipts.length!==1||
        !exact(item,['receipt_id','request_sha256'])||typeof item.receipt_id!=='string'||!/^[a-f0-9]{32}$/.test(item.receipt_id)||!sha(item.request_sha256)||
        rows.receipt!==null||rows.request_sha256!==item.request_sha256||rows.publication_availability!=='Unpublished audit artifact; content hash retained')
      fail('invalid fixed singleton query receipt identity');
    const restored={...rows,receipt:'receipts/'+item.receipt_id+'.json'};delete restored.publication_availability;
    return {root:{...root,plan:{...root.plan,receipt:restored}},witness};
  }
  const restored={...rows},seen=new Set();
  for(const item of witness.receipts){
    if(!exact(item,['stage','receipt_id','request_sha256'])||typeof item.stage!=='string'||
        !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.stage)||seen.has(item.stage)||
        typeof item.receipt_id!=='string'||!/^[a-f0-9]{32}$/.test(item.receipt_id)||!sha(item.request_sha256)||
        !Object.hasOwn(rows,item.stage))fail('invalid/duplicate opaque query receipt identity');
    seen.add(item.stage);
    const row=rows[item.stage];
    if(!row||Array.isArray(row)||row.receipt!==null||row.request_sha256!==item.request_sha256||
        row.publication_availability!=='Unpublished audit artifact; content hash retained')
      fail('receipt witness does not match an exact sanitized stage');
    const copy={...row,receipt:'receipts/'+item.receipt_id+'.json'};
    delete copy.publication_availability;restored[item.stage]=copy;
  }
  if(Object.values(rows).filter(row=>row&&typeof row==='object'&&row.receipt===null&&
      row.publication_availability==='Unpublished audit artifact; content hash retained').length!==seen.size)
    fail('incomplete query receipt identity projection');
  // Never write restored paths into public source, condition or DOM; hash only.
  return {root:{...root,plan:{...root.plan,receipt:restored}},witness};
}
function projectionMatches(record,source){
  if(record.version!=='narrative-condition-projection/1'||source.case?.task!=='redaction')return false;
  const sourceCase=source.public_case||source.case;
  const plan={...source.plan,slot_readings:source.result.readings.map(branch=>{
    const reading={...branch.reading};
    if(!Object.hasOwn(reading,'form'))reading.form=Object.hasOwn(reading,'outer_family')?reading.outer_family:'unknown';
    return reading;
  }),leads:[]};
  const result={...source.result,retrieval:source.retrieval,task:sourceCase.task,
    flow_targets:(source.result.atoms||[]).filter(a=>a.evidence?.length).map(a=>({id:a.id,atom_id:a.id,fill:a.text,label:a.text,
      sources:a.evidence.filter(e=>Object.hasOwn(e,'citation')).map(e=>e.citation)}))};
  delete result._candidate_audit;
  return same(stable(record.case),stable(sourceCase))&&same(stable(record.plan),stable(plan))&&
    same(stable(record.result),stable(result))&&same(stable(record.index_ref),stable(source.binding))&&
    same(stable(record.configuration),stable(source.configuration))&&record.native_checksum===source.native_checksum;
}
export function bindContextPriorityWire(record,verifiedJSON,{nativePath=[],narrativeProjection=false}={}){
  if(typeof verifiedJSON!=='string'||verifiedJSON.length>128*1024**2||!Array.isArray(nativePath)||
      nativePath.some(key=>typeof key!=='string'&& !Number.isSafeInteger(key)))fail('bounded verified native JSON required');
  const numeric=new WeakSet();
  const tree=JSON.parse(verifiedJSON,(_key,value,context)=>{
    if(typeof value!=='number')return value;
    if(!Number.isFinite(value)||typeof context?.source!=='string'||
        !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(context.source))fail('lossless JSON numeric source support required');
    const node={raw:context.source,value};numeric.add(node);return node;
  });
  const get=(node,path)=>path.reduce((value,key)=>{if(value==null||!Object.hasOwn(value,key))fail('native JSON path missing');return value[key];},node);
  const plain=node=>numeric.has(node)?node.value:Array.isArray(node)?node.map(plain):node&&typeof node==='object'?
    Object.fromEntries(Object.entries(node).map(([key,value])=>[key,plain(value)])):node;
  const publicRoot=get(tree,nativePath),source=plain(publicRoot);
  if(narrativeProjection&&source.result?.terminal_scores?.version==='terminal-context-priority/10'&&
      (!same(nativePath,['native'])||!exact(tree,['native','resource_binding',...(Object.hasOwn(tree,'unpublished_query_receipt_identities')?['unpublished_query_receipt_identities']:[])])))
    fail('closed V10 native envelope required');
  if(!(narrativeProjection?projectionMatches(record,source):same(stable(source),stable(record))))fail('verified wire differs from the loaded record/projection');
  const identity=receiptIdentity(tree,publicRoot,record,nativePath,narrativeProjection),root=identity.root;
  const encode=node=>numeric.has(node)?node.raw:Array.isArray(node)?'['+node.map(encode).join(',')+']':node&&typeof node==='object'?
    '{'+Object.keys(node).sort().map(key=>ascii(key)+':'+encode(node[key])).join(',')+'}':ascii(node);
  const project=node=>{
    const value=Object.fromEntries(Object.entries(node).filter(([key])=>!['rank','terminal_scorecard'].includes(key)));
    if(value.ranking&&typeof value.ranking==='object'){
      value.ranking=Object.fromEntries(Object.entries(value.ranking).filter(([key])=>!['terminal_scoring_version','canonical_order'].includes(key)));
      if(!Object.keys(value.ranking).length)delete value.ranking;
    }
    return value;
  };
  const binding={wireToken:Object.freeze({}),snapshot:JSON.stringify(stable(record)),envelopeResource:plain(tree.resource_binding),sourceMetadata:{binding:source.binding,
    configuration:source.configuration,native_checksum:source.native_checksum},narrativeProjection,
    projection:identity.witness?{...plain(identity.witness),hashes_verified:false}:null,
    canonical(path,candidateProjection=false){
      const node=get(root,path);return encode(candidateProjection?project(node):node);
    },publicCanonical(path){return encode(get(publicRoot,path));}};
  binding.prove=()=>binding.proofPromise??=(async()=>{
    if(!identity.witness)return;
    const witness=identity.witness;
    const actualPublic=await hash(encode(publicRoot)),actualSource=await hash(encode(root));
    const publicPlan=await hash(encode(publicRoot.plan)),sourcePlan=await hash(encode(root.plan));
    if(actualPublic!==witness.public_native_sha256||actualSource!==witness.source_native_sha256||
        actualSource!==record.native_record_sha256||publicPlan!==witness.public_plan_sha256||sourcePlan!==witness.source_plan_sha256)
      fail('public/original native or plan identity digest differs');
    binding.projection.hashes_verified=true;
  })();
  bindings.set(record,binding);
}
export function contextPriorityWireMetadata(record){
  const binding=bindings.get(record);if(!binding)fail('verified native authority required');
  return structuredClone({source:binding.sourceMetadata,narrativeProjection:binding.narrativeProjection,
    sourceIdentityProjection:binding.projection});
}
export function contextPriorityEnvelopeResource(record){
  const binding=bindings.get(record);if(!binding)fail('verified native authority required');
  return structuredClone(binding.envelopeResource);
}
export function contextPriorityWireToken(record){
  const binding=bindings.get(record);if(!binding)fail('verified native authority required');
  return binding.wireToken;
}
export function assertContextPriorityWire(record){
  const binding=bindings.get(record);
  if(!binding||binding.snapshot!==JSON.stringify(stable(record)))fail('bind the exact verified raw native response before validation');
}
export async function v8WireHash(record,path,{candidateProjection=false}={}){
  const binding=bindings.get(record);if(!binding)fail('verified raw native response required');
  await binding.prove();return hash(binding.canonical(path,candidateProjection));
}
export async function v8PublicWireHash(record,path=[]){
  const binding=bindings.get(record);if(!binding)fail('verified raw native response required');
  await binding.prove();return hash(binding.publicCanonical(path));
}


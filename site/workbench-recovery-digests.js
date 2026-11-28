// New actual postrun summaries; original study packets and availability flags stay unchanged.
import {createDigestInputs, recoverySourcePacket, RECOVERY_STUDIES_MANIFEST} from './workbench-recovery-studies.js?v=20261128-polish1';
import {parseRaw, hash, same, check} from './r-contract.js';

export const RECOVERY_DIGEST_VERSION='recovery-study-postrun-digest-reader/1';
export const RECOVERY_DIGEST_MANIFEST=Object.freeze({
  path:'data/recovery-studies-v1/digest-manifests/f393b57274d34b2be8cdfae7fcfadcac027cafc254141e6923b4a2eca9cd986e.json',
  sha256:'f393b57274d34b2be8cdfae7fcfadcac027cafc254141e6923b4a2eca9cd986e',bytes:15108
});
const ROOT=new URL('./',import.meta.url),SHA=/^[a-f0-9]{64}$/;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const cancelled=options=>{if(options.signal?.aborted)throw new DOMException('Digest selection cancelled','AbortError');options.assertCurrent?.();};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const ascii=v=>JSON.stringify(v).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const canon=v=>Array.isArray(v)?'['+v.map(canon).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>ascii(k)+':'+canon(v[k])).join(',')+'}':ascii(v);
const keys=(v,fields)=>object(v)&&same(Object.keys(v).sort(),fields.slice().sort());
const labels=text=>[...text.matchAll(/\[S(\d+)\]/g)].map(m=>'S'+m[1]);

function reference(ref){
  check(keys(ref,['path','sha256','bytes'])&&SHA.test(ref.sha256)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=2*1024**2&&
    /^data\/recovery-studies-v1\/(?:digest-manifests|digests\/(?:cloze_[a-f0-9]{24}|review))\/[a-f0-9]{64}\.json$/.test(ref.path)&&
    ref.path.endsWith('/'+ref.sha256+'.json'),'closed content-addressed postrun digest reference');
}

async function asset(ref,options){
  reference(ref);cancelled(options);let bytes;
  if(options.fetchBytes){bytes=await options.fetchBytes(ref,{signal:options.signal});check(bytes instanceof Uint8Array,'actual digest bytes required');}
  else{
    const url=new URL(ref.path,ROOT),response=await fetch(url,{signal:options.signal,credentials:'same-origin',redirect:'error',cache:'no-cache'});
    check(response.ok&&(!response.url||response.url===url.href),'exact local digest response');
    const reader=response.body?.getReader();check(reader,'bounded digest stream required');const chunks=[];let count=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;
      if(count>ref.bytes){await reader.cancel();throw Error('Oversized digest response');}chunks.push(value);}}
    finally{reader.releaseLock();}
    bytes=new Uint8Array(count);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  }
  check(bytes.byteLength===ref.bytes,'exact digest byte count');
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  check(sha===ref.sha256,'postrun digest bytes differ');cancelled(options);return parseRaw(bytes).data;
}

export async function loadRecoveryDigest(handle,options={}){
  cancelled(options);
  // This original issuer also rejects a forged/serialized/stale study handle.
  const request=await createDigestInputs(handle);cancelled(options);
  const manifest=await asset(RECOVERY_DIGEST_MANIFEST,options);
  check(manifest.version==='recovery-study-postrun-digest-manifest/1'&&same(manifest.original_study_manifest_ref,RECOVERY_STUDIES_MANIFEST)&&
    manifest.actual_distinct_parent_calls===10&&manifest.worker_API_calls===0&&manifest.original_study_packets_and_flags_unchanged===true&&
    manifest.new_postrun_overlay_not_original_run_digest===true&&manifest.entries.length===10&&
    new Set(manifest.entries.map(e=>e.case_id)).size===10&&manifest.API0_review_status==='PASS_BOUNDED_SOURCE_AND_CITATION_REVIEW',
    'separate actual postrun overlay manifest');
  const entry=manifest.entries.find(e=>e.case_id===handle.case.case_id);check(entry,'no digest substitution from another case');
  check(entry.postrun_overlay===true&&entry.original_run_had_digest===false&&same(entry.binding,request.binding),'exact input/case/native/method binding');
  const value=await asset(entry.digest_ref,options);
  check(keys(value,['version','case_id','method_id','original_study_manifest_ref','original_study_packet_ref','source_input_ref','binding','text',
    'text_sha256','text_utf8_sha256','output_value_sha256','source_map','provenance','review','postrun_generation','original_run_had_digest',
    'used_for_inference','candidates_ranks_scores_or_sources_changed','new_factual_support_certificate','new_generation_batch_sha256'])&&
    value.version==='recovery-study-postrun-digest-overlay/1'&&value.case_id===handle.case.case_id&&value.method_id==='SOURCE_PROPOSALS_CONTEXT_ONLY'&&
    same(value.original_study_manifest_ref,RECOVERY_STUDIES_MANIFEST)&&same(value.original_study_packet_ref,handle.metadata.packet_ref)&&
    same(value.source_input_ref,request.inputRef)&&same(value.binding,request.binding)&&value.postrun_generation===true&&
    value.original_run_had_digest===false&&value.used_for_inference===false&&value.candidates_ranks_scores_or_sources_changed===false&&
    value.new_factual_support_certificate===false&&value.new_generation_batch_sha256===manifest.generation_batch_sha256,
    'typed postrun output cannot relabel the original study or rewrite evidence');
  check(typeof value.text==='string'&&await hash(ascii(value.text))===value.text_sha256&&await hash(value.text)===value.text_utf8_sha256&&
    value.text_utf8_sha256===entry.text_utf8_sha256&&await hash(canon({digest:value.text}))===value.output_value_sha256,'exact actual digest text');
  const words=value.text.trim().split(/\s+/u).length,used=labels(value.text);
  check(words>=50&&words<=100&&used.length>0&&same(value.source_map,request.payload.sources),'full unchanged S/C source map and word bounds');
  check(value.source_map.every((s,i)=>s.id==='S'+(i+1)&&s.citations.every((c,j)=>c.id==='C'+(j+1)))&&
    used.every(id=>value.source_map.some(s=>s.id===id)),'source-label inventory');
  for(const source of value.source_map)for(const row of source.citations)recoverySourcePacket(handle,row.citation);
  const review=value.review,p=value.provenance;
  check(review.version==='API0-study-digest-source-review/1'&&review.status==='PASS_BOUNDED_SOURCE_AND_CITATION_REVIEW'&&
    review.digest_utf8_sha256===value.text_utf8_sha256&&review.word_count===words&&same(review.source_labels_used,[...new Set(used)])&&
    review.all_supplied_source_citations_replayed===true&&review.actual_provider_request_response_receipt_replayed===true&&
    review.source_attribution_conditions_and_missing_links_preserved===true&&review.source_factual_support_upgraded===false&&
    review.original_QA_or_hidden_equivalence_regraded===false&&review.world_truth_certified===false,'bounded source-review scope');
  check(keys(p,['version','model','model_sha256','body_sha256','request_stored_bytes_sha256','response_stored_bytes_sha256',
    'response_canonical_sha256','receipt_stored_bytes_sha256','exact_cache_stored_bytes_sha256','call_id_sha256',
    'provider_response_id_sha256','started_utc','finished_utc','usage','execution_contract','cache_reuse',
    'original_private_provenance_retained','private_locations_exported'])&&p.version==='actual-study-postrun-digest-hash-provenance/1'&&
    p.execution_contract==='phase-exact-api/2'&&p.original_private_provenance_retained===true&&p.private_locations_exported===false&&
    typeof p.model==='string'&&await hash(ascii(p.model))===p.model_sha256&&
    Object.keys(p).filter(k=>k.endsWith('_sha256')).every(k=>SHA.test(p[k]))&&
    ['input_tokens','output_tokens'].every(k=>Number.isSafeInteger(p.usage[k])&&p.usage[k]>=0),'hash-only actual model/provider provenance');
  cancelled(options);return freeze({version:RECOVERY_DIGEST_VERSION,overlay:value,manifestRef:RECOVERY_DIGEST_MANIFEST,
    digestRef:entry.digest_ref,studyCaseId:handle.case.case_id,originalRunHadDigest:false,newActualPostrunDigest:true});
}

function sourceContext(source){
  // Deterministic longest recorded own context; all C anchors remain separately inspectable.
  return source.citations.reduce((best,row)=>!best||row.citation.end-row.citation.start>best.citation.end-best.citation.start?row:best,null).citation;
}

export async function renderRecoveryDigest(host,{handle,assertCurrent,onSource},options={}){
  check(host?.ownerDocument&&typeof assertCurrent==='function'&&typeof onSource==='function','guarded workbench digest callbacks required');
  const current=()=>{assertCurrent();cancelled(options);};current();
  const loaded=await loadRecoveryDigest(handle,{...options,assertCurrent:current}),value=loaded.overlay;current();
  const doc=host.ownerDocument,fragment=doc.createDocumentFragment(),paragraph=doc.createElement('p');
  paragraph.dataset.testid='recovery-actual-digest';paragraph.dataset.textSha256=value.text_utf8_sha256;
  const sourceById=new Map(value.source_map.map(s=>[s.id,s]));let at=0;
  function button(label,proof){
    const node=doc.createElement('button');node.type='button';node.className='sw-button sw-quiet';node.textContent=label;
    node.dataset.testid='recovery-digest-source';node.addEventListener('click',()=>{
      try{current();recoverySourcePacket(handle,proof);onSource(proof);}catch{/* A stale selection must not reopen a source. */}
    });return node;
  }
  for(const match of value.text.matchAll(/\[S(\d+)\]/g)){
    paragraph.append(doc.createTextNode(value.text.slice(at,match.index)));
    const id='S'+match[1],source=sourceById.get(id);paragraph.append(button(match[0],sourceContext(source)));at=match.index+match[0].length;
  }
  paragraph.append(doc.createTextNode(value.text.slice(at)));fragment.append(paragraph);
  const scope=doc.createElement('p');scope.className='sw-note';scope.textContent='New postrun brief of the saved primary reading and alternatives.';fragment.append(scope);
  const references=doc.createElement('details'),title=doc.createElement('summary');title.textContent='Source references';references.append(title);
  for(const source of value.source_map){
    const row=doc.createElement('div'),label=doc.createElement('p');label.textContent=source.id+' / '+source.document_id+' / '+source.date;row.append(label);
    for(const anchor of source.citations)row.append(button('['+source.id+'/'+anchor.id+']',anchor.citation));references.append(row);
  }
  fragment.append(references);
  const details=doc.createElement('details'),heading=doc.createElement('summary'),pre=doc.createElement('pre');heading.textContent='Digest provenance';
  pre.textContent=JSON.stringify({overlayVersion:value.version,actualGeneration:value.provenance,sourceReview:value.review,
    inputBinding:value.binding,manifestRef:loaded.manifestRef,digestRef:loaded.digestRef,originalRunHadDigest:false},null,2);
  details.append(heading,pre);fragment.append(details);current();return fragment;
}

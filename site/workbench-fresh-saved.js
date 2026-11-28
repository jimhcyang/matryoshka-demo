// Static publication transport only. The existing Live adapter owns all result semantics.
import * as live from './live-result-adapter.js?v=20261128-polish1';
import {parseRaw,hash,ascii,same,stable} from './r-contract.js';
import {liveSourceSummary} from './workbench-live-source.js?v=20261128-polish1';

export const FRESH_SAVED_VERSION='fresh-saved-publication/1';
const ROOT=new URL('./',import.meta.url),SHA=/^[a-f0-9]{64}$/,RUN=/^live_[a-f0-9]{32}$/;
const publications=new WeakMap(),loadedInputs=new WeakMap();
const check=(ok,message)=>{if(!ok)throw Error('Fresh saved: '+message);};
const freeze=(v,seen=new WeakSet())=>{if(v&&typeof v==='object'&&!seen.has(v)){
  seen.add(v);Object.values(v).forEach(child=>freeze(child,seen));Object.freeze(v);
}return v;};
const keys=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&same(Object.keys(v).sort(),fields.slice().sort());
const caseKeys=['case_id','corpus','task','query','date','document_id','focal_marker'];
const canonical=v=>ascii(stable(v));
const bytesHash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(n=>n.toString(16).padStart(2,'0')).join('');
const cancelled=(signal,assertCurrent)=>{if(signal?.aborted||assertCurrent?.()===false)throw new DOMException('Saved input changed','AbortError');};
const metadata=raw=>{const parsed=parseRaw(raw);const encoded=parsed.canonical(parsed.data);
  for(const m of encoded.matchAll(/"(?:bytes|decoded_bytes|wire_bytes)":([-0-9.eE+]+)/g))check(/^-?(?:0|[1-9]\d*)$/.test(m[1]),'integer metadata cannot be a float token');
  return parsed.data;};
const validCase=c=>keys(c,caseKeys)&&['cib','iran','vietnam'].includes(c.corpus)&&['redaction','mosaic','hypothesis'].includes(c.task)&&
  ['case_id','query','date','document_id'].every(k=>typeof c[k]==='string'&&c[k])&&/^\d{4}-\d{2}-\d{2}$/.test(c.date)&&
  (c.task==='redaction'?typeof c.focal_marker==='string'&&c.focal_marker&&c.query.split(c.focal_marker).length===2:c.focal_marker===null||c.focal_marker==='');

function publicRef(ref,kind){
  check(keys(ref,['path','sha256','bytes'])&&SHA.test(ref.sha256)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&
    ref.bytes<=(kind==='wire'?live.LIVE_TRANSPORT_LIMITS.wireBytes:8*1024**2),'exact bounded public ref required');
  const allowed=kind==='report'?ref.path==='data/report-v6.json':kind==='code'?
    ['live-result-adapter.js','workbench-live-source.js'].includes(ref.path):
    new RegExp('^data/fresh-saved-v1/'+kind+'/[a-f0-9]{64}\\.json$').test(ref.path);
  check(allowed&&(!['report','code'].includes(kind)?ref.path.endsWith('/'+ref.sha256+'.json'):true),'closed public artifact location required');
}

async function read(ref,kind,options){
  publicRef(ref,kind);cancelled(options.signal,options.assertCurrent);
  const snapshot=JSON.stringify(ref);let raw;
  if(options.fetchBytes)raw=await options.fetchBytes(Object.freeze({...ref}),{signal:options.signal});
  else{
    const url=new URL(ref.path,options.base||ROOT),response=await fetch(url,{signal:options.signal,credentials:'omit',redirect:'error',cache:'no-cache'});
    check(response.ok&&(!response.url||response.url===url.href),'exact static response required');
    const reader=response.body?.getReader();check(reader,'bounded static stream required');
    const chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>ref.bytes){await reader.cancel();throw Error('Fresh saved: response exceeded pinned size');}chunks.push(value);}}
    finally{reader.releaseLock();}
    raw=new Uint8Array(size);let at=0;for(const chunk of chunks){raw.set(chunk,at);at+=chunk.length;}
  }
  check(raw instanceof Uint8Array&&raw.length===ref.bytes&&snapshot===JSON.stringify(ref),'original exact static bytes required');
  check(await bytesHash(raw)===ref.sha256,'static content hash differs');cancelled(options.signal,options.assertCurrent);return raw;
}

// Large packed outer JSON needs duplicate/nonfinite protection without an 8MiB
// metadata-parser ceiling. Its inner raw numeric seals remain the Live codec's job.
function packedJSON(raw){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);let at=0,nodes=0;
  const ws=()=>{while(/[ \n\r\t]/.test(text[at]||'!'))at++;};
  const string=()=>{const start=at++;while(at<text.length){const c=text[at++];if(c==='\\'){at++;continue;}if(c==='"')return JSON.parse(text.slice(start,at));}throw Error('Fresh saved: unclosed string');};
  const value=depth=>{check(depth<=96&&++nodes<=1000000,'packed JSON structural bound');ws();const c=text[at];
    if(c==='"'){string();return;}
    if(c==='{'||c==='['){const object=c==='{',seen=new Set(),end=object?'}':']';at++;ws();if(text[at]===end){at++;return;}
      for(;;){let key;if(object){check(text[at]==='"','packed object key required');key=string();check(!seen.has(key),'duplicate packed JSON key');seen.add(key);ws();check(text[at++]===':','packed colon required');}
        ws();const start=at;value(depth+1);if(['decoded_bytes','wire_bytes','bytes'].includes(key))check(/^-?(?:0|[1-9]\d*)$/.test(text.slice(start,at)),'integer packed metadata required');
        ws();if(text[at]===end){at++;return;}check(text[at++]===',','packed separator required');ws();}}
    const m=/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));check(m,'invalid packed JSON token');at+=m[0].length;
    if(!['null','true','false'].includes(m[0]))check(Number.isFinite(Number(m[0]))&&(!/^[+-]?\d+$/.test(m[0])||Number.isSafeInteger(Number(m[0]))),'unsafe packed number');
  };
  value(0);ws();check(at===text.length,'trailing packed JSON bytes');return JSON.parse(text);
}

function originMatches(origin,c){
  check(origin.version==='fresh-saved-origin/1'&&origin.case_id===c.case_id&&origin.query===c.query&&
    origin.document_id===c.document_id&&origin.date===c.date&&origin.corpus===c.corpus&&
    origin.eligible_evidence===false&&origin.focal_revealed===false&&origin.reference_answer===null&&origin.reveal_available===false,
    'exact original-input Origin binding required');
  const full=origin.full_transcription;check(full&&typeof full.text==='string'&&SHA.test(full.text_sha256),'complete raw original transcription required');
  for(const a of full.query_anchors||[])check(Number.isSafeInteger(a.start)&&Number.isSafeInteger(a.end)&&a.start>=0&&a.end>a.start&&
    Array.from(full.text).slice(a.start,a.end).join('')===a.text,'raw original Origin span differs');
}

const HISTORICAL_KIND='HISTORICAL_RECOVERY_TEN',HISTORICAL_SHA='822babd9ca06dc3f85a9bac0dc96b395b14fcf5c8599d0d677befe06c8074ec3';
const atSpan=(text,a)=>a&&Number.isSafeInteger(a.start)&&Number.isSafeInteger(a.end)&&a.start>=0&&a.end>a.start&&
  a.end<=Array.from(text).length&&Array.from(text).slice(a.start,a.end).join('')===a.text;
async function historicalOriginMatches(origin,c,querySHA){
  check(origin.version==='historical-recovery-study-origin/1'&&same(origin.case,c)&&origin.query_sha256===querySHA&&
    origin.source_document_id===c.document_id&&origin.source_date===c.date&&origin.focal_reference===null&&
    origin.reveal_available===false&&origin.QA_answer_or_grade_included===false&&origin.source_masks_replaced_or_revealed===false&&
    origin.postrun_provenance_only===true&&origin.eligible_inference_evidence_added===false&&
    origin.recorded_public_projection_matches_case===true&&origin.complete_listed_raw_pages===true&&
    typeof origin.complete_original_document==='boolean','exact masked historical Origin contract');
  check(Array.isArray(origin.earlier_masked_pages)&&origin.earlier_masked_pages.length>0&&origin.earlier_masked_pages.length<=32,'bounded original masked pages');
  const ids=new Set();let focal=0;
  for(const p of origin.earlier_masked_pages){
    check(p.edition==='earlier'&&p.corpus===c.corpus&&p.document_id===c.document_id&&p.date===c.date&&
      typeof p.canonical_page_id==='string'&&!ids.has(p.canonical_page_id)&&Number.isSafeInteger(p.physical_page)&&p.physical_page>0&&
      typeof p.text==='string'&&await hash(ascii(p.text))===p.text_sha256&&await hash(p.text)===p.text_utf8_sha256&&
      Array.isArray(p.anchors),'original masked raw page/hash');ids.add(p.canonical_page_id);
    for(const a of p.anchors){
      check(atSpan(p.text,a)&&atSpan(c.query,a.query_span),'historical raw/query span binding');
      if(a.kind==='EXACT_VISIBLE_QUERY_CONTEXT')check(a.text===a.query_span.text,'original visible context changed');
      else{check(a.kind==='ORIGINAL_OPAQUE_FOCAL_SLOT'&&/^\[\[REDACTION_SLOT:[A-Za-z0-9_:-]{1,128}\]\]$/.test(a.text)&&
        a.query_span.text===c.focal_marker,'original focal remains opaque');focal++;}
    }
  }
  check(focal===1,'one original focal binding required');
  check(keys(origin.pdfs,['earlier','later']),'paired original PDF metadata required');
  for(const [edition,p]of Object.entries(origin.pdfs))check(p.edition===edition&&Number.isSafeInteger(p.physical_page)&&
    Number.isSafeInteger(p.physical_page_count)&&p.physical_page>0&&p.physical_page<=p.physical_page_count&&
    keys(p.ref,['path','sha256','bytes'])&&SHA.test(p.ref.sha256)&&Number.isSafeInteger(p.ref.bytes)&&p.ref.bytes>0&&p.ref.bytes<=32*1024**2&&
    p.ref.path==='data/recovery-studies-v1/pdfs/'+p.ref.sha256+'.pdf','unchanged paired PDF locator');
}

async function originalCatalog(report,manifest,options){
  const originals=new Map(report.cases.map(row=>[row.case.case_id,{...row,catalog_kind:'BASE_REPORT'}]));
  const secondaryRef=manifest.secondary_catalog_ref;
  if(!secondaryRef){check(manifest.version===FRESH_SAVED_VERSION&&!options.secondaryCatalogRef,'unexpected secondary catalog authority');return originals;}
  check(manifest.version==='fresh-saved-publication/2'&&same(secondaryRef,options.secondaryCatalogRef),'explicit secondary catalog pin required');
  const secondary=metadata(await read(secondaryRef,'publications',options));
  check(keys(secondary,['version','kind','base_report_ref','source_manifest_ref','records','original_outcomes_used','origin_is_provenance_only'])&&
    secondary.version==='fresh-historical-original-catalog/1'&&secondary.kind===HISTORICAL_KIND&&
    same(secondary.base_report_ref,manifest.base_report_ref)&&secondary.original_outcomes_used===false&&
    secondary.origin_is_provenance_only===true&&secondary.source_manifest_ref.sha256===HISTORICAL_SHA&&
    secondary.source_manifest_ref.bytes===18098,'closed known-ten original lineage');
  const source=metadata(await read(secondary.source_manifest_ref,'publications',options));
  check(source.version==='historical-recovery-studies-manifest/1'&&source.historical_study_only===true&&
    source.source_cases===10&&source.QA_answers_or_grades_exported===false&&Array.isArray(source.cases)&&source.cases.length===10&&
    Array.isArray(secondary.records)&&secondary.records.length===10,'complete original ten inventory');
  const seen=new Set();
  for(const item of secondary.records){
    check(keys(item,['case','case_sha256','query_sha256','context_ref','origin_ref'])&&validCase(item.case)&&
      item.case.task==='redaction'&&item.case.corpus==='cib'&&!originals.has(item.case.case_id)&&!seen.has(item.case.case_id),
      'unique nonoverlapping historical original');seen.add(item.case.case_id);
    const meta=source.cases.find(m=>m.case_id===item.case.case_id);
    check(meta&&item.case.date===meta.date&&item.case.document_id===meta.document_id&&
      item.case_sha256===meta.public_case_sha256&&item.case_sha256===await hash(canonical(item.case))&&
      item.query_sha256===meta.query_sha256&&item.query_sha256===await hash(ascii(item.case.query))&&
      item.context_ref.sha256===meta.context_ref.sha256&&item.origin_ref.sha256===meta.origin_ref.sha256,
      'original manifest/case/query/context/Origin commitments');
    const context=metadata(await read(item.context_ref,'publications',options));
    check(context.version==='historical-recovery-study-context/1'&&context.case_id===item.case.case_id&&
      context.public_case_sha256===item.case_sha256&&context.query_sha256===item.query_sha256&&
      context.public_packet_sha256===meta.packet_ref.sha256&&context.source_view_policy?.id==='source_day_inclusive'&&
      context.source_view_policy.later_or_secret_version_admitted===false,'original context/source-policy lineage');
    const origin=metadata(await read(item.origin_ref,'origins',options));
    await historicalOriginMatches(origin,item.case,item.query_sha256);
    originals.set(item.case.case_id,{catalog_kind:HISTORICAL_KIND,case:item.case,
      configurations:{llm_readings:{source_view_policy:context.source_view_policy}},
      origin_refs:{masked:{sha256:item.origin_ref.sha256}},historical_origin_ref:item.origin_ref,
      historical_origin:freeze(origin),source_manifest_sha256:HISTORICAL_SHA});
  }
  check(source.cases.every(m=>seen.has(m.case_id)),'no omitted historical originals');return originals;
}

export function freshPublicationOriginals(publication){
  const state=publications.get(publication);check(state&&state.snapshot===JSON.stringify(publication),'verified original-catalog handle required');
  cancelled(state.options.signal,state.options.assertCurrent);
  return freeze([...state.originals.values()].filter(o=>o.catalog_kind===HISTORICAL_KIND).map(o=>({
    kind:o.catalog_kind,case:o.case,source_view_policy:o.configurations.llm_readings.source_view_policy,
    origin_ref:o.historical_origin_ref,original_manifest_sha256:o.source_manifest_sha256})));
}


export async function loadFreshPublication(options={}){
  const {manifestRef,reportRef,secondaryCatalogRef=null}=options;check(manifestRef&&reportRef,'approved manifest AND base report refs required');
  const expectedRefs=JSON.stringify([manifestRef,reportRef,secondaryCatalogRef]);
  const raw=await read(manifestRef,'publications',options),manifest=metadata(raw);
  check([FRESH_SAVED_VERSION,'fresh-saved-publication/2'].includes(manifest.version)&&manifest.status==='APPROVED_COMPLETED_RESULTS'&&
    manifest.scope==='diagnostic_demo_with_declared_limitations'&&manifest.no_native_or_old_grade_rewrite===true&&
    manifest.benchmark_accuracy_claimed===false&&same(manifest.base_report_ref,reportRef),'manifest scope/report binding differs');
  check(typeof manifest.fixture_only==='boolean'&&(!manifest.fixture_only||options.allowFixtures===true),'API0 fixture cannot be a published result');
  const report=parseRaw(await read(reportRef,'report',options)).data;
  check(Array.isArray(report.cases)&&report.cases.length>0&&new Set(report.cases.map(r=>r.case?.case_id)).size===report.cases.length,'unique immutable base catalog required');
  check(Array.isArray(manifest.entries)&&manifest.entries.length>0&&manifest.entries.length<=64&&
    new Set(manifest.entries.map(e=>e.case?.case_id)).size===manifest.entries.length,'unique bounded fresh input inventory required');
  for(const code of ['adapter_ref','receiver_ref'])await read(manifest[code],'code',options);
  check(manifest.adapter_ref.path==='live-result-adapter.js'&&manifest.receiver_ref.path==='workbench-live-source.js','shared qualified adapter/receiver required');
  const originals=await originalCatalog(report,manifest,options);
  for(const e of manifest.entries){
    const original=originals.get(e.original_case_id);
    check(original&&(e.original_catalog_kind||'BASE_REPORT')===original.catalog_kind,'original catalog kind differs');
    if(original.catalog_kind===HISTORICAL_KIND)check(e.replacement===false&&same(e.case,original.case)&&same(e.origin_ref,original.historical_origin_ref)&&same(e.original_origin_ref,e.origin_ref),'historical input/Origin cannot be rewritten');
    check(original&&validCase(e.case)&&SHA.test(e.source_method_sha256||'')&&typeof e.replacement==='boolean'&&RUN.test(e.run_id)&&typeof e.executed_case_id==='string'&&e.executed_case_id,
      'fresh input must link to an existing original case');
    check(e.replacement?e.case.case_id!==e.original_case_id&&!originals.has(e.case.case_id):same(e.case,original.case),
      'changed input needs a distinct replacement case, never a rewritten old row');
    check(e.case.corpus===original.case.corpus&&e.case.document_id===original.case.document_id&&e.case.date===original.case.date&&
      e.case.task===original.case.task&&same(e.source_view_policy,original.configurations?.llm_readings?.source_view_policy),
      'original source date/document/task/policy changed');
    check(e.query_sha256===await hash(ascii(e.case.query))&&e.case_sha256===await hash(canonical(e.case))&&
      e.source_policy_sha256===await hash(canonical(e.source_view_policy)),'input/query/policy commitments differ');
    check(e.original_origin_attachment_sha256===original.origin_refs?.masked?.sha256||
      e.original_origin_attachment_sha256===original.origin_refs?.by_arm?.llm_readings?.masked?.sha256,'original report Origin attachment differs');
    for(const [field,kind]of [['wire_ref','wire'],['origin_ref','origins'],['original_origin_ref','origins'],['approval_ref','approvals']])publicRef(e[field],kind);
  }
  cancelled(options.signal,options.assertCurrent);
  check(JSON.stringify([manifestRef,reportRef,options.secondaryCatalogRef??null])===expectedRefs,'publication authority changed during loading');
  const handle=freeze({version:manifest.version,manifestRef:{...manifestRef},reportRef:{...reportRef},
    entries:manifest.entries,replacements:manifest.entries.filter(e=>e.replacement)});
  publications.set(handle,{manifest:freeze(manifest),report:freeze(report),originals,options:{...options},snapshot:JSON.stringify(handle)});return handle;
}

export async function loadFreshSavedInput(id,{publication,signal,assertCurrent}={}){
  const state=publications.get(publication);check(state&&state.snapshot===JSON.stringify(publication),'load the approved static publication first');
  const current=()=>{cancelled(state.options.signal,state.options.assertCurrent);return assertCurrent?.()!==false;};
  const options={...state.options,signal:signal||state.options.signal,assertCurrent:current};cancelled(options.signal,current);
  const e=publication.entries.find(e=>e.case.case_id===id);check(e,'input not in this approved fresh publication');
  const original=state.originals.get(e.original_case_id);
  const approval=metadata(await read(e.approval_ref,'approvals',options));
  check(approval.version===(original.catalog_kind===HISTORICAL_KIND?'fresh-saved-result-approval/2':'fresh-saved-result-approval/1')&&approval.status==='APPROVED_COMPLETED'&&approval.completion_status==='COMPLETE'&&
    approval.fixture_only===state.manifest.fixture_only&&approval.run_id===e.run_id&&approval.wire_sha256===e.wire_ref.sha256&&
    approval.case_sha256===e.case_sha256&&approval.source_policy_sha256===e.source_policy_sha256&&approval.origin_sha256===e.origin_ref.sha256&&
    approval.base_report_sha256===publication.reportRef.sha256&&approval.no_truth_or_grade_upgrade===true,'completed vetted-result approval differs');
  const originalOrigin=metadata(await read(e.original_origin_ref,'origins',options));
  const origin=metadata(await read(e.origin_ref,'origins',options));
  if(original.catalog_kind===HISTORICAL_KIND){
    check(keys(approval,['version','status','completion_status','fixture_only','run_id','wire_sha256','case_sha256',
      'source_policy_sha256','base_report_sha256','no_truth_or_grade_upgrade','origin_sha256',
      'secondary_catalog_sha256','original_manifest_sha256','original_origin_sha256'])&&
      approval.secondary_catalog_sha256===state.manifest.secondary_catalog_ref.sha256&&
      approval.original_manifest_sha256===HISTORICAL_SHA&&approval.original_origin_sha256===e.origin_ref.sha256&&
      same(originalOrigin,original.historical_origin)&&same(origin,originalOrigin),'historical approval/Origin lineage changed');
    await historicalOriginMatches(origin,e.case,e.query_sha256);
  }else{
  originMatches(originalOrigin,original.case);originMatches(origin,e.case);
  check(originalOrigin.original_origin_attachment_sha256===e.original_origin_attachment_sha256&&
    origin.original_origin_attachment_sha256===e.original_origin_attachment_sha256&&
    originalOrigin.query_sha256===await hash(ascii(original.case.query))&&origin.query_sha256===e.query_sha256&&
    originalOrigin.full_transcription.text===origin.full_transcription.text&&
    origin.full_transcription.text_sha256===await hash(ascii(origin.full_transcription.text)),
    'original Origin body/attachment/query differs');
  if(e.replacement)check(origin.origin_rebind?.version==='fresh-origin-query-rebind/1'&&
    origin.origin_rebind.original_origin_sha256===e.original_origin_ref.sha256&&origin.origin_rebind.original_case_id===e.original_case_id&&
    origin.origin_rebind.source_body_unchanged===true&&origin.minimal_selection?.version==='origin-minimal-selection/1'&&
    origin.minimal_selection.case_id===e.case.case_id&&origin.minimal_selection.query_sha256===e.query_sha256&&
    origin.minimal_selection.source_text_sha256===origin.full_transcription.text_sha256&&
    same(origin.minimal_selection.spans,origin.full_transcription.query_anchors)&&
    approval.origin_spans_sha256===await hash(canonical(origin.minimal_selection.spans))&&
    approval.origin_body_utf8_sha256===await bytesHash(new TextEncoder().encode(origin.full_transcription.text)),
    'new input needs its own approved raw-source spans and rebound Origin');
  }
  const wireBytes=await read(e.wire_ref,'wire',options),wire=packedJSON(wireBytes);
  check(wire.version==='matryoshka-live-packed/1','original packed Live wire required; no reconstructed result DTO');
  const envelope=await live.unpackLiveResult(wire);cancelled(options.signal,current);
  const c=envelope.native?.public_case;
  check(envelope.run_id===e.run_id&&envelope.execution_kind==='live'&&c?.case_id===e.executed_case_id&&
    ['corpus','task','query','date','document_id'].every(k=>c[k]===e.case[k])&&
    (c.focal_marker===e.case.focal_marker||c.task!=='redaction'&&c.focal_marker===''&&e.case.focal_marker===null)&&
    same(envelope.source_scope?.source_view_policy,e.source_view_policy),'fresh wire execution/input/policy link differs');
  const packet=await live.toWorkbenchPacket(envelope,e.run_id);cancelled(options.signal,current);
  check(packet.source_method?.sha256===e.source_method_sha256,'executed source method differs');
  freeze(packet);
  const result=Object.freeze({packet,originalCase:original.case,inputCase:e.case,originalOrigin:freeze(originalOrigin),origin:freeze(origin),
    link:freeze({version:'fresh-saved-input-link/1',original_catalog_kind:original.catalog_kind,original_case_id:e.original_case_id,input_case_id:e.case.case_id,
      executed_case_id:e.executed_case_id,run_id:e.run_id,query_sha256:e.query_sha256,source_view_policy:e.source_view_policy,
      wire_ref:e.wire_ref,origin_ref:e.origin_ref,original_origin_ref:e.original_origin_ref,replacement:e.replacement,
      static_saved_publication:true,wire_or_execution_identity_rewritten:false,old_rank_or_grade_merged:false})});
  loadedInputs.set(result,Object.freeze({packet,handle:packet.source_method_handle,method:packet.source_method,
    condition:packet.condition,originalCase:original.case,inputCase:e.case,link:result.link,
    runId:e.run_id,executedCaseId:e.executed_case_id,query:e.case.query,task:e.case.task,
    methodSHA:e.source_method_sha256,querySHA:e.query_sha256,snapshot:JSON.stringify(packet),
    signal:options.signal,assertCurrent:current}));return result;
}

function boundInput(input){
  const state=loadedInputs.get(input);check(state,'verify the typed fresh input before consuming it');
  cancelled(state.signal,state.assertCurrent);
  const p=state.packet;
  check(input.packet===p&&input.originalCase===state.originalCase&&input.inputCase===state.inputCase&&input.link===state.link&&
    p.source_method_handle===state.handle&&p.source_method===state.method&&p.condition===state.condition&&
    p.condition.source_method===state.method&&p.row.configurations.llm_readings===state.condition&&
    p.row.case===state.condition.case&&p.run_id===state.runId&&p.execution_kind==='live'&&
    p.row.case.case_id===state.executedCaseId&&p.row.case.task===state.task&&p.row.case.query===state.query&&
    p.source_method.sha256===state.methodSHA&&JSON.stringify(p)===state.snapshot,
    'registered fresh packet/method/run/input binding changed');
  return state;
}

export function assertLoadedFreshInput(input){boundInput(input);return input;}

export function freshSavedPacket(input){return boundInput(input).packet;}

export function freshSavedStatus(input){
  const state=boundInput(input),summary=liveSourceSummary(state.handle);
  return freeze({version:'casebook-display-status/1',case_id:state.inputCase.case_id,label:summary.title,tone:summary.tone,
    basis:'published-fresh-source-method',run_id:state.runId,query_sha256:state.querySHA,
    source_truth_certified:false,selection_dependent:false});
}

export async function prepareFreshSavedStatuses(publication,{signal,assertCurrent}={}){
  check(publications.has(publication),'verified publication required');
  const statuses=Object.create(null),inputs=Object.create(null);
  for(const entry of publication.entries){
    const input=await loadFreshSavedInput(entry.case.case_id,{publication,signal,assertCurrent});
    inputs[entry.case.case_id]=input;statuses[entry.case.case_id]=freshSavedStatus(input);
  }
  cancelled(signal,assertCurrent);
  return Object.freeze({statuses:freeze(statuses),inputs:Object.freeze(inputs)});
}

export function freshPublicationStatuses(publication){
  const state=publications.get(publication);check(state,'verified publication required');
  cancelled(state.options.signal,state.options.assertCurrent);
  const descriptors=state.manifest.status_descriptors;
  check(Array.isArray(descriptors)&&descriptors.length===publication.entries.length&&new Set(descriptors.map(d=>d.case_id)).size===descriptors.length,
    'complete pinned status inventory required before navigation');
  const result=Object.create(null);
  for(const entry of publication.entries){
    const d=descriptors.find(d=>d.case_id===entry.case.case_id),s=d?.status;
    check(d&&d.version==='fresh-saved-status-descriptor/1'&&d.generated_from==='liveSourceSummary'&&
      d.run_id===entry.run_id&&d.wire_sha256===entry.wire_ref.sha256&&d.query_sha256===entry.query_sha256&&
      d.source_method_sha256===entry.source_method_sha256&&s?.version==='casebook-display-status/1'&&s.case_id===entry.case.case_id&&
      s.run_id===entry.run_id&&s.query_sha256===entry.query_sha256&&s.basis==='published-fresh-source-method'&&
      typeof s.label==='string'&&s.label&&['supported','partial','mixed','opposed','unresolved'].includes(s.tone)&&
      s.source_truth_certified===false&&s.selection_dependent===false,'pinned displayed-source status differs');
    result[entry.case.case_id]=s;
  }
  return freeze(result);
}

// Historical contextual studies only; never current native/condition/report DTOs.
import {parseRaw, hash, check, same} from './r-contract.js';
import {savedSourcePolicy, savedSourceScope, sourcePagePolicyAllows} from './saved-source-policy.js';
import {renderStandardWorkbench} from './workbench-standard-view.js';
import {mountSourceAccountMap} from './workbench-source-map.js';

export const RECOVERY_STUDIES_VERSION = 'historical-recovery-study-reader/1';
export const RECOVERY_STUDIES_MANIFEST = Object.freeze({
  path:'data/recovery-studies-v1/manifests/822babd9ca06dc3f85a9bac0dc96b395b14fcf5c8599d0d677befe06c8074ec3.json',
  sha256:'822babd9ca06dc3f85a9bac0dc96b395b14fcf5c8599d0d677befe06c8074ec3',bytes:18098
});
const ROOT = new URL('./', import.meta.url), handles = new WeakMap(), catalogs = new WeakSet();
const SHA = /^[a-f0-9]{64}$/, ID = /^cloze_[a-f0-9]{24}$/;
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const freeze = value => {if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const object = v => v!==null && typeof v==='object' && !Array.isArray(v);
const keys = (v,fields) => object(v) && same(Object.keys(v).sort(),fields.slice().sort());
const list = v => Array.isArray(v)?v:[];
const abort = signal => {if(signal?.aborted)throw new DOMException('Study selection cancelled','AbortError');};
const ascii = text => JSON.stringify(text).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const chars = text => Array.from(text);
const cut = (text,a,b) => chars(text).slice(a,b).join('');
const span = (text,p) => object(p) && Number.isSafeInteger(p.start) && Number.isSafeInteger(p.end) &&
  p.start>=0 && p.start<p.end && p.end<=chars(text).length && cut(text,p.start,p.end)===p.text;
const near = (a,b) => typeof a==='number' && typeof b==='number' && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<1e-12;
const proofKey = p => JSON.stringify([p.corpus,p.canonical_page_id,p.document_id,p.date,p.page_sha256,p.start,p.end,p.text]);
const unique = proofs => [...new Map(proofs.map(p=>[proofKey(p),p])).values()];

function exactRef(ref){
  check(keys(ref,['path','sha256','bytes']) && SHA.test(ref.sha256) && Number.isSafeInteger(ref.bytes) && ref.bytes>0 && ref.bytes<8*1024**2 &&
    /^data\/recovery-studies-v1\/(?:cases\/cloze_[a-f0-9]{24}|contexts\/cloze_[a-f0-9]{24}|origins\/cloze_[a-f0-9]{24}|digest-inputs\/cloze_[a-f0-9]{24}|manifests|prompts)\/[a-f0-9]{64}\.json$/.test(ref.path), 'closed study asset ref');
  check(ref.path.endsWith('/'+ref.sha256+'.json'),'content-addressed study path');
}

async function fetchAsset(ref,options={}){
  exactRef(ref);abort(options.signal);options.assertSelectionCurrent?.();
  const url=new URL(ref.path,ROOT);let bytes;
  if(options.fetchBytes){
    bytes=await options.fetchBytes(ref,{signal:options.signal});
    check(bytes instanceof Uint8Array,'verified loader requires original Uint8Array bytes');
  }else{
    const response=await fetch(url,{signal:options.signal,credentials:'same-origin',redirect:'error',cache:'no-cache'});
    check(response.ok && (!response.url || response.url===url.href),'exact local study response');
    const reader=response.body?.getReader();check(reader,'bounded stream required');
    const chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>ref.bytes){await reader.cancel();throw Error('Study response exceeded pinned size');}chunks.push(value);}}
    finally{reader.releaseLock();}
    bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  }
  check(bytes.byteLength===ref.bytes,'study asset byte count differs');
  const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  check(actual===ref.sha256,'study asset bytes differ');abort(options.signal);options.assertSelectionCurrent?.();
  return parseRaw(bytes);
}

export async function loadRecoveryStudies(options={}){
  const parsed=await fetchAsset(RECOVERY_STUDIES_MANIFEST,options),m=parsed.data;
  check(m.version==='historical-recovery-studies-manifest/1' && m.method_id==='SOURCE_PROPOSALS_CONTEXT_ONLY' &&
    m.historical_study_only===true && m.source_context_not_factual_support===true && m.source_cases===10 &&
    m.original_study_denominator===31 && m.current_report_rows_created===false && m.original_public_packets_unchanged===true &&
    m.QA_answers_or_grades_exported===false && m.model_calls===0 && m.native_runs===0 && Array.isArray(m.cases) && m.cases.length===10,
    'historical study manifest scope');
  check(new Set(m.cases.map(c=>c.case_id)).size===10,'unique ten study IDs');exactRef(m.prompt_ref);
  for(const item of m.cases){
    check(ID.test(item.case_id) && item.corpus==='cib' && item.historical_distinct_study===true && item.analyst_summary_available===false &&
      [item.query_sha256,item.public_case_sha256,item.native_checksum].every(v=>SHA.test(v)) && Array.isArray(item.reading_ids) &&
      item.reading_ids.includes(item.primary_reading_id),'study metadata binding');
    for(const key of ['packet_ref','context_ref','origin_ref','digest_input_ref']){exactRef(item[key]);
      check(item[key].path.includes('/'+item.case_id+'/'),'case-specific asset required');}
  }
  const catalog=freeze({version:m.version,manifestRef:RECOVERY_STUDIES_MANIFEST,cases:m.cases,promptRef:m.prompt_ref});
  catalogs.add(catalog);return catalog;
}

function citation(page,p){
  check(span(page.text,p),'exact retained source span');
  return freeze({corpus:page.corpus,canonical_page_id:page.id,document_id:page.document_id,date:page.date,
    page_sha256:page.source_sha256,start:p.start,end:p.end,text:p.text,...(page.earlier_page!=null?{earlier_page:page.earlier_page}:{})});
}

async function validatePacket(parsed,context,meta){
  const p=parsed.data,caseInfo=p.case;
  check(p.version==='historical-source-only-workbench-data/1' && p.publication_authorized===false &&
    p.typed_source_method_admission_not_issued===true && p.QA_answers_or_grades_included===false &&
    keys(caseInfo,['case_id','corpus','task','query','document_id','date','focal_marker']) && caseInfo.case_id===meta.case_id &&
    caseInfo.corpus==='cib' && caseInfo.task==='redaction' && caseInfo.date===meta.date && caseInfo.document_id===meta.document_id &&
    typeof caseInfo.query==='string' && caseInfo.query.split(caseInfo.focal_marker).length===2 &&
    await hash(parsed.canonical(caseInfo))===meta.public_case_sha256 && await hash(ascii(caseInfo.query))===meta.query_sha256,
    'exact unchanged study public case');
  check(context.version==='historical-recovery-study-context/1' && context.case_id===meta.case_id &&
    context.public_case_sha256===meta.public_case_sha256 && context.query_sha256===meta.query_sha256 &&
    context.public_packet_sha256===meta.packet_ref.sha256 && context.native_checksum===meta.native_checksum &&
    context.current_native_DTO_created===false && context.source_graph_identity_not_remapped===true &&
    context.source_edges_or_walks_fabricated===false,'exact historical native/source context');
  const binding=context.resource_binding;
  check(binding.corpus==='cib' && binding.source_status==='CURRENT_NATIVE_RESOURCE_EXPLICIT' &&
    ['resource_id','graph_id','hierarchy_id'].every(k=>typeof binding[k]==='string'&&binding[k]) &&
    ['registry_sha256','index_sha256'].every(k=>SHA.test(binding[k])) &&
    p.native_baseline.native_checksum===meta.native_checksum && p.native_baseline.checkpoint_sha256===context.original_native_checkpoint_sha256 &&
    p.native_baseline.execution_context_sha256===context.original_execution_context_sha256 &&
    same(p.native_baseline.source_view_policy,context.source_view_policy),'historical resource/native binding');
  const policy=savedSourcePolicy(context.source_view_policy),scope=savedSourceScope(caseInfo,policy);
  check(policy.id==='source_day_inclusive','ordinary saved study policy');
  const s=p.sections;
  check(keys(s,['facts_to_look_for','facts_to_evidence','selected_evidence','saved_fills','analyst_summary']) &&
    p.saved_method.name==='SOURCE_PROPOSALS_CONTEXT_ONLY' && p.saved_method.factual_support_certified===false &&
    s.analyst_summary.text===null && s.analyst_summary.actual_digest_ref===null && s.analyst_summary.calls_authorized_here===0,
    'context method, sections and missing summary required');
  const pages=new Map();
  check(Array.isArray(s.selected_evidence.pages) && s.selected_evidence.pages.length<=32,'retained ordinary source pages');
  for(const page of s.selected_evidence.pages){
    check(!pages.has(page.id) && page.corpus==='cib' && page.permitted===true && sourcePagePolicyAllows(page,caseInfo,scope) &&
      ['earlier','both'].includes(page.visibility) && await hash(ascii(page.text))===page.source_sha256 &&
      await hash(page.text)===page.raw_text_sha256,'eligible retained raw page/hash');pages.set(page.id,page);
  }
  check(Array.isArray(s.facts_to_look_for.atoms) && s.facts_to_look_for.atoms.length>0 &&
    new Set(s.facts_to_look_for.atoms.map(a=>a.id)).size===s.facts_to_look_for.atoms.length,'actual query fact inventory');
  for(const atom of s.facts_to_look_for.atoms){check(typeof atom.id==='string'&&typeof atom.text==='string','query atom');
    for(const q of list(atom.query_spans))check(span(caseInfo.query,q),'literal public atom query span');}
  const readings=s.saved_fills.readings;
  check(Array.isArray(readings) && same(readings.map(b=>b.reading_id),meta.reading_ids) &&
    s.saved_fills.primary_reading_id===meta.primary_reading_id && s.saved_fills.order_unchanged===true &&
    s.saved_fills.score_is_probability===false,'complete original readings/order');
  const records=new Map(s.facts_to_evidence.records.map(r=>[r.reading_id+'/'+r.candidate_id,r]));let count=0;
  for(const branch of readings){
    check(branch.reading.id===branch.reading_id && Array.isArray(branch.candidates),'declared reading');
    for(const [i,c] of branch.candidates.entries()){
      count++;check(c.rank===i+1 && Number.isSafeInteger(c.rank) && c.rank_within_new_method===c.rank &&
        c.reading_id===branch.reading_id && same(c.declared_reading,branch.reading) && typeof c.fill==='string' &&
        c.state==='REVIEWED_CONTEXTUAL_SOURCE_CANDIDATE_NOT_NATIVE_EVIDENCE' &&
        ['factual_support_certified','legacy_source_license_claimed','native_DTO_or_certificate_created','native_tier_assigned','source_positive_B_added'].every(k=>c[k]===false),
        'saved candidate/rank; context cannot gain factual authority');
      check(caseInfo.query.replace(caseInfo.focal_marker,c.fill)===c.completed_input &&
        await hash(ascii(c.completed_input))===c.completed_input_sha256 && await hash(c.completed_input)===c.completed_input_utf8_sha256,
        'literal completed insertion');
      const source=c.source,page=pages.get(source.page_id);check(page && source.page_sha256===page.source_sha256 &&
        source.document_id===page.document_id && source.date===page.date,'candidate own-source owner');
      for(const key of ['exact_quote','original_phrase','qualification_paragraph'])check(span(page.text,source[key]),'source phrase/qualification');
      check(Array.isArray(c.sources)&&c.sources.length>0,'actual candidate citations');
      for(const proof of c.sources){const q=pages.get(proof.canonical_page_id);check(q && span(q.text,proof) &&
        proof.document_id===q.document_id && proof.date===q.date && proof.corpus===q.corpus && proof.page_sha256===q.source_sha256,'own citation binding');}
      const score=c.context_priority,f=score.raw_features;
      check(score.version==='source-proposal-context-priority/1' && same(score.weights,[.55,.25,.20]) &&
        ['own_page_focal_coverage','local_grammatical_fit','nonrepeated_content_fraction'].every(k=>typeof f[k]==='number'&&f[k]>=0&&f[k]<=1) &&
        near(score.score,.55*f.own_page_focal_coverage+.25*f.local_grammatical_fit+.20*f.nonrepeated_content_fraction) &&
        near(score.components.own_page_focal,.55*f.own_page_focal_coverage) && near(score.components.local_grammatical_fit,.25*f.local_grammatical_fit) &&
        near(score.components.lexical_novelty,.20*f.nonrepeated_content_fraction) && score.probability===false &&
        score.source_positive_B_added===false && score.support_or_event_or_identity_certified===false,'original context priority math/scope');
      for(const [key,value] of [['reading_sha256',c.declared_reading],['grammar_sha256',c.grammar],
        ['exact_quote_sha256',source.exact_quote],['source_phrase_sha256',source.original_phrase]])
        check(score.bindings[key]===await hash(parsed.canonical(value)),'saved score component commitment');
      check(score.bindings.query_sha256===meta.query_sha256 && span(caseInfo.query,score.focal_query_span) &&
        c.lineage.original_provenance_sha256===score.bindings.provenance_sha256 && c.publication_authorized===false,
        'source-local score/query and original lineage');
      const record=records.get(branch.reading_id+'/'+c.id);
      check(record && same(record.source,source) && same(record.citations,c.sources) && same(record.grammar,c.grammar) &&
        same(record.review,c.source_review) && record.factual_support_certified===false,'recorded review/grammar records agree');
    }
  }
  check(count===records.size && readings.find(b=>b.candidates.length)?.reading_id===meta.primary_reading_id,'first nonempty reading and complete records');
  return pages;
}

export async function loadRecoveryStudy(caseId,options={}){
  check(ID.test(caseId),'explicit historical study ID');
  const catalog=options.catalog||await loadRecoveryStudies(options);check(catalogs.has(catalog),'catalog not issued by pinned loader');
  const metadata=catalog.cases.find(c=>c.case_id===caseId);check(metadata,'unknown study case');
  const packet=await fetchAsset(metadata.packet_ref,options),context=await fetchAsset(metadata.context_ref,options);
  const pages=await validatePacket(packet,context.data,metadata);abort(options.signal);options.assertSelectionCurrent?.();
  const data=packet.data,facts=data.sections.facts_to_look_for.atoms;
  const handle=freeze({version:RECOVERY_STUDIES_VERSION,metadata,packet:data,case:data.case,facts,plan:{atoms:facts},
    sourcePages:data.sections.selected_evidence.pages,resourceBinding:context.data.resource_binding,
    sourcePolicy:context.data.source_view_policy,context:context.data,primaryReadingId:metadata.primary_reading_id,
    nativeBaseline:data.native_baseline,studyOnly:true});
  handles.set(handle,{options,catalog,pages});return handle;
}

function bound(handle){
  const state=handles.get(handle);check(state,'study handle not issued by pinned loader');
  abort(state.options.signal);state.options.assertSelectionCurrent?.();return state;
}

export function recoverySourcePacket(handle,proof){
  const state=bound(handle),page=state.pages.get(proof?.canonical_page_id);
  check(page && span(page.text,proof) && proof.page_sha256===page.source_sha256 && proof.document_id===page.document_id &&
    proof.date===page.date && proof.corpus===page.corpus,'study source is outside bound retained pages');
  const allowed=handle.packet.sections.saved_fills.readings.flatMap(b=>b.candidates).flatMap(c=>{
    const p=state.pages.get(c.source.page_id);return [...c.sources,...['exact_quote','original_phrase','qualification_paragraph'].map(k=>citation(p,c.source[k]))];});
  check(allowed.some(p=>same(p,proof)),'source span is outside the saved candidate proof inventory');
  return freeze({version:'historical-recovery-study-source/1',case_id:handle.case.case_id,resource_binding:handle.resourceBinding,
    source_view_policy:handle.sourcePolicy,cutoff:handle.case.date,whole_origin_excluded:null,
    page,proof,historical_study_only:true,factual_support_certified:false});
}

export async function recoveryOrigin(handle){
  const state=bound(handle),parsed=await fetchAsset(handle.metadata.origin_ref,state.options),origin=parsed.data;
  check(origin.version==='historical-recovery-study-origin/1' && same(origin.case,handle.case) &&
    origin.query_sha256===handle.metadata.query_sha256 && origin.focal_reference===null && origin.reveal_available===false &&
    origin.QA_answer_or_grade_included===false && origin.source_masks_replaced_or_revealed===false &&
    origin.postrun_provenance_only===true && origin.eligible_inference_evidence_added===false &&
    origin.recorded_public_projection_matches_case===true,'masked-only origin contract');
  for(const page of origin.earlier_masked_pages){
    check(page.edition==='earlier'&&page.document_id===handle.case.document_id && page.date===handle.case.date &&
      await hash(ascii(page.text))===page.text_sha256 && await hash(page.text)===page.text_utf8_sha256,'raw masked origin page');
    for(const anchor of page.anchors)check(span(page.text,anchor) && span(handle.case.query,anchor.query_span) &&
      (anchor.kind==='EXACT_VISIBLE_QUERY_CONTEXT'?anchor.text===anchor.query_span.text:
        anchor.kind==='ORIGINAL_OPAQUE_FOCAL_SLOT'&&/^\[\[REDACTION_SLOT:/.test(anchor.text)&&anchor.query_span.text===handle.case.focal_marker),
      'origin exact visible context or opaque slot only');
  }
  for(const [edition,pdf] of Object.entries(origin.pdfs))check(['earlier','later'].includes(edition)&&pdf.edition===edition&&
    pdf.ref.path==='data/recovery-studies-v1/pdfs/'+pdf.ref.sha256+'.pdf' && SHA.test(pdf.ref.sha256)&&
    Number.isSafeInteger(pdf.physical_page)&&pdf.physical_page>0&&pdf.physical_page<=pdf.physical_page_count,'paired original PDF locator');
  bound(handle);return freeze(origin);
}

export function recoveryInspectionOptions(handle,proof){
  const state=bound(handle);recoverySourcePacket(handle,proof);
  return {caseInfo:handle.case,config:'historical_source_only_study',binding:handle.resourceBinding,facts:handle.facts,
    proof,sourcePolicy:handle.sourcePolicy,sourceIndex:handle.context.source_index,signal:state.options.signal,
    assertCurrent:()=>{bound(handle);},getSourcePage:async p=>recoverySourcePacket(handle,p),
    // Existing graph source-proof shards still establish exact node ownership.
    // No native incident-edge export is invented for these non-report rows.
    getNode:async()=>{bound(handle);return null;}};
}

export async function createDigestInputs(handle){
  const state=bound(handle),parsed=await fetchAsset(handle.metadata.digest_input_ref,state.options),input=parsed.data;
  const prompt=(await fetchAsset(state.catalog.promptRef,state.options)).data,b=input.binding;
  check(input.version==='historical-recovery-study-digest-input/1' && input.kind==='HISTORICAL_CONTEXTUAL_REDACTION_STUDY' &&
    same(input.public_case,handle.case) && same(input.facts,handle.facts) && input.method.id==='SOURCE_PROPOSALS_CONTEXT_ONLY' &&
    input.method.native_method===false && input.method.factual_support_certified===false && input.used_for_inference===false &&
    input.postrun===true && b.public_packet_sha256===handle.metadata.packet_ref.sha256 &&
    b.context_packet_sha256===handle.metadata.context_ref.sha256 && b.native_checksum===handle.nativeBaseline.native_checksum &&
    b.query_sha256===handle.metadata.query_sha256 && input.selection.primary_reading_id===handle.primaryReadingId,'exact all-reading study digest input');
  check(prompt.version==='historical-study-existing-digest-prompt/1'&&prompt.prompt_reused_verbatim===true&&
    prompt.model_calls_authorized===0 && await hash(ascii(prompt.instructions))===prompt.prompt_sha256,'existing digest prompt commitment');
  const branches=handle.packet.sections.saved_fills.readings;
  check(input.readings.length===branches.length && input.readings.every((r,i)=>same(r.reading,branches[i].reading)&&
    r.candidates.length===branches[i].candidates.length && r.candidates.every((c,j)=>{
      const saved=branches[i].candidates[j];return c.id===saved.id&&c.rank===saved.rank&&c.fill===saved.fill&&
        c.completed_input===saved.completed_input&&same(c.context_priority,saved.context_priority)&&c.factual_support_certified===false;
    })),'digest must preserve every actual reading/candidate/order/score');
  for(const source of input.sources)for(const row of source.citations)recoverySourcePacket(handle,row.citation);
  bound(handle);return freeze({version:'historical-recovery-study-digest-preparation/1',payload:input,
    instructions:prompt.instructions,schema:prompt.schema,inputRef:handle.metadata.digest_input_ref,
    promptRef:state.catalog.promptRef,binding:b,actualDigestAvailable:false,modelCallsAuthorized:0,
    outputAttachmentVersion:null});
}

export function normalizeRecoveryStudy(handle){
  const {pages}=bound(handle),facts=handle.facts,marker=handle.case.focal_marker;
  const start=chars(handle.case.query.slice(0,handle.case.query.indexOf(marker))).length,end=start+chars(marker).length;
  const focal=facts.filter(f=>f.text.includes(marker)||list(f.query_spans).some(s=>s.start<end&&start<s.end));
  const allowed=[];
  const readings=handle.packet.sections.saved_fills.readings.map(branch=>{
    const links=[],metadata=[],proofs=[],candidates=branch.candidates.map(c=>{
      const page=pages.get(c.source.page_id),main=citation(page,c.source.exact_quote),qualification=citation(page,c.source.qualification_paragraph);
      const ownProofs=unique([main,qualification,...c.sources]);proofs.push(...ownProofs);allowed.push(...ownProofs,citation(page,c.source.original_phrase));
      for(const p of ownProofs)metadata.push({proof:p,atom_ids:focal.map(f=>f.id),direction:'CONTEXT'});
      for(const f of focal)links.push({factId:f.id,itemId:c.id,proof:main,direction:'CONTEXT',
        basis:'RECORDED_CONTEXTUAL_PROPOSAL_FOR_FOCAL_READING_NOT_FACTUAL_SUPPORT',source_graph_edge:false,original_retrieval_claimed:false});
      return {id:c.id,rank:c.rank,fill:c.fill,priority:c.context_priority.score,label:'Contextual suggestion',
        evidenceState:'CONTEXT_ONLY',proofs:ownProofs,sourceWord:c.source.original_phrase.text,
        details:{completedInput:c.completed_input,transformation:c.transformation,grammar:c.grammar,
          sourceReview:c.source_review,contextPriority:c.context_priority,qualification:c.source.qualification_paragraph}};
    });
    return {id:branch.reading_id,label:branch.reading.explanation||branch.reading.outer_family,explanation:branch.reading.explanation,
      candidates,proofs:unique(proofs),proofMetadata:metadata,sourceLinks:links,graphItems:candidates.map(c=>({id:c.id})),nativeCandidates:[]};
  });
  return {task:'redaction',caseInfo:{...handle.case,title:handle.metadata.title},facts,readings,selectedReadingId:handle.primaryReadingId,
    summary:{title:'Source-derived suggestions',text:'Contextual nominations; factual support has not been certified.',tone:'context'},
    allowedProofs:unique(allowed),sourcePolicy:handle.sourcePolicy,originalMethodId:'SOURCE_PROPOSALS_CONTEXT_ONLY',
    technicalDetails:{studyOnly:true,case_id:handle.case.case_id,originalNative:handle.nativeBaseline,
      resourceBinding:handle.resourceBinding,sourcePolicy:handle.sourcePolicy,publicPacketSHA256:handle.metadata.packet_ref.sha256,
      scoreFormula:'.55 own-page focal coverage + .25 local grammar fit + .20 nonrepeated content fraction',
      QAgradesNotDisplayed:true,analystSummary:'MISSING_ACTUAL_EXACT_METHOD_DIGEST'}};
}

export function recoveryAccountMap(handle,readingId=handle.primaryReadingId){
  const data=normalizeRecoveryStudy(handle),branch=data.readings.find(r=>r.id===readingId);check(branch,'saved reading required');
  return {trace:{version:'historical-study-source-account-map/1',task:'redaction',reading_id:readingId,
    paths:branch.sourceLinks.map((link,i)=>({id:'historical-context-'+i,candidate_or_atom_id:readingId+'/'+link.itemId,
      query_atom_id:link.factId,direction:'CONTEXT',steps:[],graph_hops:0,route_mode:'DIRECT_SOURCE_HANDOFF',
      original_traversal_claimed:false,decision_source_refs:[link.proof],source_refs:[link.proof],display_association_basis:link.basis})),
    steps:[],sources:{},original_traversal_claimed:false,source_graph_edges_created:false},
    plan:{atoms:data.facts},items:branch.graphItems,nativeCandidates:[],proofs:branch.proofs,sourcePolicy:handle.sourcePolicy};
}

export function renderRecoveryStudy(handle,options){
  bound(handle);check(typeof options?.stage==='function','canonical stage factory required');
  let disposed=false,mapView=null;
  const current=()=>{check(!disposed,'historical workspace disposed');bound(handle);options.assertSelectionCurrent?.();return true;},data=normalizeRecoveryStudy(handle);
  const selectedId=options.selectedReadingId??handle.primaryReadingId,branch=data.readings.find(b=>b.id===selectedId);
  check(branch,'do not replace an unavailable reading');
  const onSource=proof=>{current();const packet=recoverySourcePacket(handle,proof);return options.onSource?.(proof,packet);};
  const onKG=typeof options.onKG==='function'?proof=>{current();return options.onKG(proof,recoveryInspectionOptions(handle,proof));}:undefined;
  const panels=renderStandardWorkbench({...options,...data,...branch,selectedReadingId:selectedId,assertCurrent:current,
    onSource,onKG,onBaseline:undefined,onDetails:options.onDetails,
    onMapMount:(host,selection)=>{current();const map=recoveryAccountMap(handle,selection.readingId);
      const mounted=options.onMapMount?options.onMapMount(host,{...data,...branch,map}):
        mountSourceAccountMap(host,{data:{...data,...branch,map},onSource,onDetails:options.onDetails,formatText:options.formatText,assertCurrent:current});
      if(mounted?.destroy)mapView=mounted;return mounted;},
    renderDigest:async host=>{current();
      if(typeof options.renderDigest==='function'){
        const value=await options.renderDigest(host,Object.freeze({handle,assertCurrent:current,onSource}));
        current();return value;
      }
      const note=document.createElement('p');note.className='sw-note';
      note.textContent='No saved Analyst Summary exists for this exact method. Generation and verified attachment are pending.';host.append(note);}});
  if(options.includeInput!==false){
    const input=options.stage('01','Input','Source input'),text=document.createElement('pre');text.className='sw-copy';text.textContent=handle.case.query;
    input.body.append(text);
    if(typeof options.onOrigin==='function'){
      const button=document.createElement('button');button.type='button';button.className='sw-button';button.textContent='Origin';button.dataset.testid='recovery-origin-open';
      button.addEventListener('click',async()=>{try{current();const origin=await recoveryOrigin(handle);current();await options.onOrigin(origin);}
        catch(error){try{current();options.onError?.(error);}catch{/* A stale async origin must not reopen another selection. */}}});input.body.append(button);
    }
    panels.splice(1,0,input.outer);
  }
  const result=[...panels];Object.defineProperty(result,'destroy',{value:()=>{disposed=true;mapView?.destroy();panels.destroy();}});return result;
}

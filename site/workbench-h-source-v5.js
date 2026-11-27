// Distinct H5 source-view reader; no native factual or world-execution authority.
export const H5_METHOD_ID='reviewed_h_source_views_issue_direction_document_voice5';
const VIEW_VERSION='reviewed-H-source-workbench-view/5';
const REVIEWED_SOURCE_METHOD_IDS=Object.freeze([H5_METHOD_ID]);
const verified=new WeakMap();
const fields=['case_id','corpus','task','query','document_id','date','focal_marker'];
const check=(value,message)=>{if(!value)throw Error('Reviewed source method: '+message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const number=value=>typeof value==='number'&&Number.isFinite(value);
const close=(a,b)=>number(a)&&number(b)&&Math.abs(a-b)<=1e-12;
const stable=value=>Array.isArray(value)?value.map(stable):object(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const ascii=value=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
async function hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function requiredFacts(record){return (record.plan?.atoms||[]).filter(a=>a.required!==false&&a.kind==='proposition');}
function sourceSnapshot(row,record){return JSON.stringify([row.case,row.reviewed_source_assessment,record.case,
  record.native_checkpoint,record.registry_ref,record.index_ref,record.configuration?.source_view_policy,
  record.plan?.query_sha256,requiredFacts(record),record.result?.source_view_policy,record.reviewed_source_assessment,
  record.native_checksum,record.config,record.result?.inspected_page_ids]);}

export function reviewedSourceEndpoint(pin,{caseInfo,config,resourceBinding,base=location.href}){
  check(REVIEWED_SOURCE_METHOD_IDS.includes(pin?.method_id)&&typeof pin.endpoint==='string','explicit supported method and endpoint required');
  const target=new URL(pin.endpoint,base),origin=new URL(base);
  check(target.origin===origin.origin&&/^https?:$/.test(target.protocol)&&!target.username&&!target.password&&!target.hash&&
    target.pathname==='/api/current/reviewed-source-accounts','only the bound local saved-method endpoint is allowed');
  const expected={case_id:caseInfo.case_id,config,resource_id:resourceBinding?.resource_id,
    registry_sha256:resourceBinding?.registry_sha256,index_sha256:resourceBinding?.index_sha256};
  check(typeof config==='string'&&['llm_readings','llm_atoms','llm_local'].includes(config)&&
    typeof expected.resource_id==='string'&&expected.resource_id&&sha(expected.registry_sha256)&&sha(expected.index_sha256),'exact selected configuration/resource pins required');
  for(const [key,value]of target.searchParams)check(Object.hasOwn(expected,key)&&value===expected[key]&&target.searchParams.getAll(key).length===1,'endpoint changes or repeats case/config/resource scope');
  for(const [key,value]of Object.entries(expected))target.searchParams.set(key,value);
  return target;
}

function parsedWire(raw){
  const numeric=new WeakSet();
  const tree=JSON.parse(raw,(_key,value,context)=>{
    if(typeof value!=='number')return value;
    check(Number.isFinite(value)&&typeof context?.source==='string'&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(context.source),'lossless JSON numeric-source support required');
    const token={value,raw:context.source};numeric.add(token);return token;
  });
  const plain=value=>numeric.has(value)?value.value:Array.isArray(value)?value.map(plain):object(value)?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)])):value;
  const encode=value=>numeric.has(value)?value.raw:Array.isArray(value)?'['+value.map(encode).join(',')+']':object(value)?
    '{'+Object.keys(value).sort().map(k=>ascii(k)+':'+encode(value[k])).join(',')+'}':ascii(value);
  check(tree?.version===VIEW_VERSION,'endpoint must contain the unmodified versioned reader view');
  const withoutSHA=Object.fromEntries(Object.entries(tree).filter(([key])=>key!=='sha256'));
  return {view:plain(tree),canonical:encode(withoutSHA)};
}


export async function loadReviewedSourceMethod({row,record,config,resourceBinding,verified:fetchVerified,signal,base=location.href}){
  const pin=row.reviewed_source_assessment;if(pin==null)return null;
  check(object(pin)&&sha(pin.original_view_sha256)&&sha(pin.public_view_sha256)&&sha(pin.original_native_sha256)&&sha(pin.query_sha256)&&
    typeof fetchVerified==='function','a method flag alone is not an admission authority');
  const snapshot=sourceSnapshot(row,record),endpoint=reviewedSourceEndpoint(pin,{caseInfo:row.case,config,resourceBinding,base});
  const packet=await fetchVerified(endpoint.href,signal);
  check(!signal?.aborted,'method request was cancelled');
  check(packet?.decoded instanceof Uint8Array&&packet.decoded.length>0&&packet.decoded.length<=16*1024**2,'byte-verified bounded method response required');
  const {view,canonical}=parsedWire(new TextDecoder('utf-8',{fatal:true}).decode(packet.decoded));
  check(REVIEWED_SOURCE_METHOD_IDS.includes(view.method_id)&&pin.method_id===view.method_id&&
    view.publication_projection_version==='reviewed-source-location-redaction/1'&&
    sha(view.original_view_sha256)&&view.original_view_sha256===pin.original_view_sha256&&
    sha(view.sha256)&&view.sha256===pin.public_view_sha256&&await hash(canonical)===pin.public_view_sha256,
    'public view digest, declared location-projection lineage or method identity differs');
  check(fields.every(k=>view.case?.[k]===row.case?.[k]&&record.case?.[k]===row.case?.[k])&&view.case.task==='hypothesis'&&
    await hash(ascii(row.case.query))===pin.query_sha256&&view.query_sha256===pin.query_sha256&&record.plan?.query_sha256===pin.query_sha256,'case, task, public query or native plan binding differs');
  const reference=row.configurations?.[config]?.native_checkpoint;
  check(sha(reference?.sha256)&&reference.sha256===pin.original_native_sha256&&same(reference,record.native_checkpoint)&&
    same(reference,view.original_native_ref),'reviewed method belongs to another original native checkpoint');
  check(same(view.source_view_policy,pin.source_view_policy)&&same(view.source_view_policy,record.configuration?.source_view_policy)&&
    same(view.source_view_policy,record.result?.source_view_policy),'reviewed method source policy differs');
  const execution=view.execution_context,index=execution?.index_ref;
  const resourceId=index?.resource_id??(index?.source_status==='INCUMBENT_NOT_MIGRATED'?index.native_index_ref?.binding?.graph_id:null);
  check(execution?.version==='pinned-execution-context/1'&&same(execution.registry_ref,record.registry_ref)&&same(index,record.index_ref)&&
    typeof resourceId==='string'&&resourceId===resourceBinding.resource_id&&index.sha256===resourceBinding.index_sha256&&index.registry_sha256===resourceBinding.registry_sha256,
    'reviewed method resource/index binding differs');
  check(view.source_origin?.document_id===row.case.document_id&&view.source_origin.date===row.case.date&&view.source_origin.origin_body_used===false,'origin provenance was substituted for evidence');
  if(record.reviewed_source_assessment!=null)check(same(record.reviewed_source_assessment,pin),'record method declaration differs from the report pin');
  await validateH5Evidence(view,record);
  check(!signal?.aborted&&sourceSnapshot(row,record)===snapshot,'selected case or native authority changed during verification');
  freeze(view);
  const handle=Object.freeze({method_id:view.method_id,view});
  verified.set(handle,{row,record,snapshot});return handle;
}

function bound(handle){const binding=verified.get(handle);check(binding&&sourceSnapshot(binding.row,binding.record)===binding.snapshot,'verify the exact current method before rendering');return handle.view;}

const WEIGHTS=Object.freeze({actors:.18,action:.20,arguments:.15,event_identity:.15,event_time:.06,quantity:.08,polarity:.06,modality:.05,attribution:.03,conditions:.04});
const LABELS=Object.freeze({SOURCE_VIEWS_RECORDED:'Qualified source views recorded',CONTEXT_ONLY:'Related source context only',UNRESOLVED:'No accepted source view in assessed pages'});
const SIGNS=['SUPPORT','OPPOSE','CONTEXT'];
const cut=(text,start,end)=>Array.from(text).slice(start,end).join('');
const validSpan=(text,s)=>Number.isSafeInteger(s?.start)&&Number.isSafeInteger(s?.end)&&s.start>=0&&s.start<s.end&&s.end<=Array.from(text).length&&cut(text,s.start,s.end)===s.text;
function occurrences(text,quote){const chars=Array.from(text),needle=Array.from(quote),out=[];check(needle.length>0&&needle.length<=24000,'bounded exact anchor required');
  for(let i=0;i+needle.length<=chars.length;i++)if(chars.slice(i,i+needle.length).join('')===quote)out.push({start:i,end:i+needle.length,text:quote});return out;}
async function anchors(groups,text,coordinate,qualification){
  check(Array.isArray(groups)&&groups.length>0&&groups.length<=256,'literal query/source anchors required');const ids=new Set();
  for(const g of groups){
    check(g.coordinate_system===coordinate&&g.all_exact_occurrences_retained===true&&typeof g.key==='string'&&!ids.has(g.anchor_id)&&
      sha(g.anchor_id)&&await hash(ascii([g.key,coordinate,g.model_quote]))===g.anchor_id&&Array.isArray(g.candidates)&&g.candidates.length>0&&g.candidates.length<=256,
      'anchor identity/coordinate changed');ids.add(g.anchor_id);
    const expected=occurrences(text,g.model_quote);check(same(expected,g.candidates.map(c=>({start:c.start,end:c.end,text:c.text}))),'anchor occurrences were dropped or invented');
    for(const c of g.candidates){check(validSpan(text,c)&&await hash(ascii(stable([coordinate,{start:c.start,end:c.end,text:c.text}])))===c.candidate_id&&
      Array.isArray(c.parser_intersections)&&c.parser_intersections.every(s=>validSpan(text,s)&&c.start<=s.start&&s.end<=c.end),'literal anchor span/hash differs');}
    if(coordinate==='BOUND_FACT_TEXT')check(g.candidates.some(c=>c.parser_intersections.length>0),'query anchor has no declared parser intersection');
    else check(Array.isArray(g.eligible_candidate_ids)&&g.eligible_candidate_ids.length>0&&new Set(g.eligible_candidate_ids).size===g.eligible_candidate_ids.length&&
      g.eligible_candidate_ids.every(id=>g.candidates.some(c=>c.candidate_id===id&&qualification.start<=c.start&&c.end<=qualification.end)),'source anchor escapes retained qualification');
  }
}
function validateScope(view,record){
  const s=view.assessment_scope,keys=['processed_slots','provider_reviewed_slots','model_accepted_slots','accepted_slots','directional_source_view_slots','held_slots','eligibility_hold_slots','rejected_slots','review_pending_slots','unprocessed_slots'];
  check(s?.version==='H-V5-source-assessment-scope/1'&&Array.isArray(s.grid)&&s.grid.length===s.original_slots&&
    keys.every(k=>Number.isSafeInteger(s[k])&&s[k]>=0),'exact H5 scope version and integer counters required');
  const totals=Object.fromEntries(keys.map(k=>[k,0])),slots=new Set(),pages=new Set(),facts=new Set(view.atoms.map(a=>a.id)),ids=new Set();
  for(const g of s.grid){
    const key=JSON.stringify([g.fact_id,g.page_id]);check(!slots.has(key)&&facts.has(g.fact_id)&&typeof g.page_id==='string'&&typeof g.document_id==='string'&&
      ['provider_reviewed','model_accepted','source_view_credit'].every(k=>typeof g[k]==='boolean'),'H5 scope slot flags/identity differ');slots.add(key);pages.add(g.page_id);
    if(g.appraisal_id!==null){check(sha(g.appraisal_id)&&!ids.has(g.appraisal_id)&&sha(g.request_sha256),'scope appraisal/request identity differs');ids.add(g.appraisal_id);}
    totals.provider_reviewed_slots+=Number(g.provider_reviewed);totals.model_accepted_slots+=Number(g.model_accepted);totals.directional_source_view_slots+=Number(g.source_view_credit);
    if(g.state==='UNPROCESSED'){totals.unprocessed_slots++;check(g.appraisal_id===null&&!g.provider_reviewed&&!g.model_accepted&&!g.source_view_credit,'unprocessed is not reviewed NONE');continue;}
    totals.processed_slots++;check(sha(g.appraisal_id),'processed slot lacks appraisal identity');
    if(g.state==='ROW_REJECTED')totals.rejected_slots++;
    else if(g.state==='REVIEW_PENDING')totals.review_pending_slots++;
    else if(['FIRST_PASS_HOLD','REVIEW_HOLD','SOURCE_ELIGIBILITY_HOLD'].includes(g.state)){totals.held_slots++;totals.eligibility_hold_slots+=Number(g.state==='SOURCE_ELIGIBILITY_HOLD');}
    else{check(['SUPPORT','OPPOSE','CONTEXT','NONE'].some(sign=>g.state==='ACCEPTED_'+sign)&&g.provider_reviewed&&g.model_accepted&&
      g.source_view_credit===['ACCEPTED_SUPPORT','ACCEPTED_OPPOSE'].includes(g.state),'unknown or unaccepted slot gained H5 credit');totals.accepted_slots++;continue;}
    check(!g.source_view_credit,'held/pending/rejected slot gained a directional vote');
  }
  check(keys.every(k=>s[k]===totals[k])&&s.original_pages===pages.size&&s.required_facts===view.atoms.length&&s.original_slots===pages.size*view.atoms.length&&
    same([...pages].sort(),[...(record.result.inspected_page_ids||[])].sort())&&s.processed_slots+s.unprocessed_slots===s.original_slots&&
    s.accepted_slots+s.held_slots+s.rejected_slots+s.review_pending_slots===s.processed_slots&&s.inspected_pool_completely_assessed===(s.accepted_slots===s.original_slots)&&
    s.inspected_pool_completely_processed===(s.unprocessed_slots===0)&&s.partial_assessment===(s.accepted_slots!==s.original_slots)&&
    s.partial_source_search===true&&s.whole_corpus_search_claimed===false&&s.scope==='RECORDED_NATIVE_INSPECTED_PAGES_NOT_WHOLE_ELIGIBLE_CORPUS'&&
    s.counts_are_not_independent_votes===true&&s.accepted_NONE_is_page_local_not_absence_elsewhere===true&&s.unprocessed_is_NOT_NONE===true,'H5 processing/review/acceptance/search partition differs');
}
async function validateH5Evidence(view,record){
  check(view.producer_version==='reviewed-H-source-views/5'&&sha(view.method_packet_sha256)&&view.coverage===null&&
    sha(view.original_inspection_ref?.sha256)&&
    view.incumbent_native_method===false&&view.native_status_or_gates_rewritten===false&&view.world_truth_certified===false&&
    view.synthetic_native_ESTABLISHED_labels_created===false&&view.deterministic_event_join_authority===false&&view.identity_authority===false&&
    view.source_drawer_reuses_exact_citations===true&&view.origin_drawer_binding_unchanged===true,'H5 cannot claim native/world/join authority');
  const native=requiredFacts(record);check(Array.isArray(view.atoms)&&native.length>0&&native.length===view.atoms.length&&native.length<=128&&
    new Set(view.atoms.map(a=>a.id)).size===view.atoms.length&&native.every((a,i)=>a.id===view.atoms[i].id&&a.text===view.atoms[i].text&&same(a.query_spans,view.atoms[i].query_spans)),
    'complete ordered native public atom text/spans required');
  validateScope(view,record);
  const trace=view.trace;check(trace?.version==='H-source-containment-inspection-graph/1'&&trace.native_semantic_edges_created===0&&trace.actual_KG_edges_inferred===false&&
    Array.isArray(trace.nodes)&&trace.nodes.length<=4096&&Array.isArray(trace.edges)&&trace.edges.length<=10000,'H5 graph is inspection containment only');
  const kinds=['REQUIRED_PUBLIC_H_ASSESSMENT','SOURCE_DOCUMENT','SOURCE_PAGE','EXACT_RAW_SOURCE_EXCERPT','MODEL_H_SOURCE_VIEW'],nodes=new Map(),pages=new Map();
  for(const n of trace.nodes){check(typeof n.id==='string'&&!nodes.has(n.id)&&kinds.includes(n.kind),'unknown/repeated H5 graph node');nodes.set(n.id,n);
    if(n.kind==='SOURCE_PAGE'){check(!pages.has(n.canonical_page_id)&&sha(n.page_sha256)&&typeof n.raw_text==='string'&&await hash(ascii(n.raw_text))===n.page_sha256,'raw H5 page/hash differs');pages.set(n.canonical_page_id,n);}}
  for(const e of trace.edges)check(nodes.has(e.source)&&nodes.has(e.target)&&['RECORDED_DOCUMENT_PAGE','EXACT_RAW_SPAN_CONTAINMENT','QUOTED_MODEL_INPUT','FULL_QUALIFICATION_CONTEXT','MODEL_APPRAISES_H_ISSUE'].includes(e.kind)&&
    e.historical_relation_certified!==true&&e.deterministic_support!==true&&e.event_join_authority!==true,'H5 containment cannot create semantic KG proof');
  check(Array.isArray(view.source_endpoints),'H5 source endpoints required');const endpoints=new Map();
  for(const e of view.source_endpoints){check(sha(e.appraisal_id)&&!endpoints.has(e.appraisal_id)&&e.native_KG_node_id===null&&e.native_semantic_route===null&&
    e.inspection_only===true&&e.input_to_source_world_edge_invented===false,'H5 source endpoint/authority differs');endpoints.set(e.appraisal_id,e);}
  const citation=p=>{const page=pages.get(p?.canonical_page_id);check(page&&p.document_id===page.document_id&&p.date===page.date&&p.page_sha256===page.page_sha256&&p.corpus===view.case.corpus&&validSpan(page.raw_text,p)&&
    /^\d{4}-\d{2}-\d{2}$/.test(p.date)&&(view.source_view_policy.date_relation==='<='?p.date<=view.case.date:view.source_view_policy.date_relation==='<'&&p.date<view.case.date),
    'exact H5 quotation/page/date/policy binding differs');return page;};
  const allIds=new Set();
  for(const atom of view.atoms){
    check(atom.authority==='QUERIED_ASSESSMENT_ONLY'&&atom.coverage===null&&atom.world_truth_verdict==='NOT_ASSESSED'&&atom.whole_query_entailed===false&&
      atom.counts_are_independent_votes===false&&atom.query_spans.every(s=>validSpan(view.case.query,s))&&Array.isArray(atom.evidence),'H5 atom authority/query/no-vote contract differs');
    const factNodes=trace.nodes.filter(n=>n.kind==='REQUIRED_PUBLIC_H_ASSESSMENT'&&n.atom_id===atom.id);
    check(factNodes.length===1&&factNodes[0].text===atom.text&&same(factNodes[0].query_spans,atom.query_spans),'H5 inspection graph changed the bound public issue');
    const expected=view.assessment_scope.grid.filter(g=>g.fact_id===atom.id&&['ACCEPTED_SUPPORT','ACCEPTED_OPPOSE','ACCEPTED_CONTEXT'].includes(g.state)),counts={SUPPORT:new Set(),OPPOSE:new Set(),CONTEXT:new Set()};
    check(same(expected.map(g=>g.appraisal_id).sort(),atom.evidence.map(e=>e.appraisal_id).sort()),'eligible H5 source inventory was dropped or invented');
    for(const e of atom.evidence){
      const grid=expected.find(g=>g.appraisal_id===e.appraisal_id),endpoint=endpoints.get(e.appraisal_id),review=e.review;
      check(sha(e.appraisal_id)&&!allIds.has(e.appraisal_id)&&SIGNS.includes(e.direction)&&grid.state==='ACCEPTED_'+e.direction&&
        e.authority==='QUERIED_ASSESSMENT_ONLY'&&e.model_reviewed===true&&e.partial_coverage_is_not_full_entailment===true&&
        ['world_truth','inner_execution','event_join_authority','identity_authority','calibrated_probability','deterministic_proof'].every(k=>e[k]===false),
        'H5 account label or authority differs');allIds.add(e.appraisal_id);
      check(review?.decision==='ACCEPT'&&review.appraisal_id===e.appraisal_id&&review.direction===e.direction&&review.independent_rederivation===true&&
        same(review.field_states,Object.fromEntries(Object.entries(e.fields).map(([k,v])=>[k,v.state])))&&review.issue_state===e.issue.state,'independent H5 appraisal review differs');
      const accounts=trace.nodes.filter(n=>n.kind==='MODEL_H_SOURCE_VIEW'&&n.appraisal_id===e.appraisal_id),account=accounts[0];
      check(accounts.length===1&&account.direction===e.direction&&account.eligible_directional_vote===(e.direction!=='CONTEXT')&&
        account.deterministic_proof===false&&account.inner_execution===false&&account.world_truth===false&&
        trace.edges.some(x=>x.kind==='MODEL_APPRAISES_H_ISSUE'&&x.source===account.id&&x.target===factNodes[0].id&&x.direction===e.direction),
        'H5 inspection graph changed the appraisal issue/direction/authority');
      const page=citation(e.citation);citation(e.qualification_citation);const q=e.qualification_citation,p=e.citation;
      check(grid.page_id===p.canonical_page_id&&grid.document_id===p.document_id&&p.canonical_page_id===q.canonical_page_id&&p.document_id===q.document_id&&p.page_sha256===q.page_sha256&&
        q.start<=p.start&&p.end<=q.end&&e.model_quote_unchanged===p.text&&endpoint&&same(endpoint.quote,p)&&same(endpoint.qualification_quote,q)&&
        endpoint.atom_id===atom.id&&endpoint.endpoint_id===e.source_endpoint_id&&endpoint.qualification_endpoint_id===e.qualification_endpoint_id&&
        same(nodes.get(e.source_endpoint_id)?.citation,p)&&same(nodes.get(e.qualification_endpoint_id)?.citation,q)&&endpoint.temporal_eligibility_hold===null,
        'H5 retained quote/qualification/endpoint differs');
      const weights=e.requested_facet_weights,fields=e.fields;
      check(object(weights)&&same(Object.keys(fields).sort(),Object.keys(WEIGHTS).sort())&&Object.keys(weights).length>0&&
        Object.entries(fields).every(([k,f])=>['MATCHED','MISSING','CONFLICTING','NOT_REQUESTED'].includes(f.state)&&(f.state==='NOT_REQUESTED')===!Object.hasOwn(weights,k)&&
          Array.isArray(f.query_quotes)&&Array.isArray(f.source_quotes)&&(f.state==='NOT_REQUESTED'?f.query_quotes.length===0&&f.source_quotes.length===0:
          f.query_quotes.length>0&&(f.source_quotes.length>0)===['MATCHED','CONFLICTING'].includes(f.state)))&&Object.entries(weights).every(([k,w])=>w===WEIGHTS[k]),'requested H5 facet states/weights differ');
      const directional=e.direction!=='CONTEXT';check(e.source_view_credit===directional&&grid.source_view_credit===directional&&endpoint.eligible_directional_vote===directional,'context or unbound row gained a directional vote');
      if(directional){check(['DIRECT_STANCE','REASONED_ARGUMENT'].includes(e.kind)&&e.issue.state==='BOUND'&&
        ['owner_role_aligned','causal_role_compatible','time_scope_compatible'].every(k=>e.issue[k]===true&&review[k]===true)&&
        review.same_issue_verified===true&&review.attribution_verified===true&&review.qualifications_retained===true&&review.operators_retained===true&&
        ['actors','event_time','quantity'].every(k=>fields[k].state!=='CONFLICTING')&&e.issue.query_quotes.length>0&&e.issue.source_quotes.length>0,
        'H5 directional account lost its issue/owner/role/time/qualification');
        check(e.mode!=='NONE'&&(!['CONDITIONAL','UNCERTAIN'].includes(e.mode)||e.qualifier_quotes.length>0),'H5 conditional/uncertain source qualifier missing');
        if(e.kind==='REASONED_ARGUMENT')check(typeof e.argument_quote==='string'&&e.argument_quote.length>0&&review.source_argument_explicit===true,'source-explicit argument required');
        if(e.direction==='OPPOSE')check(Object.keys(weights).some(k=>fields[k].state!=='MATCHED'),'all-matched facets cannot assert opposition');
        if(e.kind==='DIRECT_STANCE'){const operator=['polarity','modality'].filter(k=>Object.hasOwn(weights,k)).map(k=>fields[k].state);
          check(e.direction==='OPPOSE'?operator.includes('CONFLICTING'):!operator.includes('CONFLICTING'),'direct stance operator direction differs');}
      }else check(e.kind==='CONTEXT','H5 context is not a directional argument');
      const voice=e.source_attribution;
      check(['NAMED_SOURCE','DOCUMENT_REPORTING_VOICE'].includes(voice?.kind)&&voice.canonical_document_id===p.document_id&&voice.canonical_page_id===p.canonical_page_id&&
        voice.page_sha256===p.page_sha256&&voice.person_identity_inferred===false,'source voice/document ownership differs');
      if(voice.kind==='DOCUMENT_REPORTING_VOICE')check(voice.speaker_quote===null&&(!directional||review.document_voice_not_embedded===true&&voice.document_voice_guard?.holds?.length===0&&voice.document_voice_guard.positive_voice_certified===false),'report voice cannot invent/absorb an embedded speaker');
      else check(typeof voice.speaker_quote==='string'&&voice.speaker_quote.length>0&&voice.speaker_quote.length<=256&&voice.speaker_quote!==p.text&&page.raw_text.includes(voice.speaker_quote),'named-source literal holder missing');
      await anchors(e.query_anchor_candidates,atom.text,'BOUND_FACT_TEXT');await anchors(e.source_anchor_candidates,page.raw_text,'BOUND_SOURCE_PAGE',q);
      const backing=(groups,key,quote)=>groups.some(g=>g.key===key&&g.model_quote===quote);
      for(const [k,f]of Object.entries(fields)){f.query_quotes.forEach((quote,i)=>check(backing(e.query_anchor_candidates,'fields.'+k+'.query.'+i,quote),'field query anchor missing'));
        f.source_quotes.forEach((quote,i)=>check(backing(e.source_anchor_candidates,'fields.'+k+'.source.'+i,quote),'field source anchor missing'));}
      e.issue.query_quotes.forEach((quote,i)=>check(backing(e.query_anchor_candidates,'issue.query.'+i,quote),'issue query anchor missing'));
      e.issue.source_quotes.forEach((quote,i)=>check(backing(e.source_anchor_candidates,'issue.source.'+i,quote),'issue source anchor missing'));
      e.qualifier_quotes.forEach((quote,i)=>check(backing(e.source_anchor_candidates,'qualifier.'+i,quote),'source qualifier anchor missing'));
      if(e.argument_quote!==null)check(backing(e.source_anchor_candidates,'argument',e.argument_quote),'source argument anchor missing');
      const denominator=Object.values(weights).reduce((a,b)=>a+b,0),sum=states=>Object.entries(weights).reduce((n,[k,w])=>n+(states.includes(fields[k].state)?w:0),0)/denominator;
      const literal=sum(['MATCHED']),alignment=sum(e.direction==='OPPOSE'?['MATCHED','CONFLICTING']:['MATCHED']),lexical=e.local_lexical_fit?.value;
      check(number(lexical)&&lexical>=0&&lexical<=1&&close(e.literal_agreement_coverage,literal)&&close(e.facet_coverage,literal)&&close(e.evidence_alignment_coverage,alignment)&&
        close(e.context_priority_index,.75*alignment+.25*lexical),'literal agreement/directional alignment/source score arithmetic differs');
      counts[e.direction].add(p.document_id);
    }
    check(SIGNS.every(sign=>Number.isSafeInteger(atom.source_counts?.[sign])&&atom.source_counts[sign]===counts[sign].size)&&Object.keys(atom.source_counts).length===SIGNS.length,'H5 document counts differ');
    const status=counts.SUPPORT.size||counts.OPPOSE.size?'SOURCE_VIEWS_RECORDED':counts.CONTEXT.size?'CONTEXT_ONLY':'UNRESOLVED';
    check(atom.status===status&&atom.label===LABELS[status],'H5 status/label must derive from eligible source directions');
    check(Array.isArray(atom.held_source_context)&&atom.held_source_context.length===view.assessment_scope.grid.filter(g=>g.fact_id===atom.id&&g.state==='SOURCE_ELIGIBILITY_HOLD').length,'H5 held-context inventory differs');
  }
  check(Array.isArray(view.model_provenance)&&view.model_provenance.length>=2&&['assessment','review'].every(stage=>view.model_provenance.some(p=>p.stage===stage))&&view.model_provenance.every(p=>p.kind==='MODEL_SEMANTIC_JUDGMENT'&&
    ['assessment','review'].includes(p.stage)&&/^[a-f0-9]{32}$/.test(p.call_id||'')&&typeof p.model==='string'&&p.model&&['request_ref','response_ref','provider_receipt_ref'].every(k=>sha(p[k]?.sha256))),
    'actual fresh H5 assessment and independent provider provenance required');
  check(same(view.receiver_labels,{literal_agreement_coverage:'Literal Agreement Coverage',evidence_alignment_coverage:'Directional Evidence Alignment',context_priority_index:'Source Alignment Index'})&&
    view.score_units==='DIRECTIONAL_SOURCE_ALIGNMENT_NOT_WORLD_TRUTH_OR_PROBABILITY'&&
    view.score_formula==='0.75*evidence_alignment_coverage+0.25*local_lexical_fit; accepted OPPOSE counts MATCHED or CONFLICTING; other directions MATCHED only; HOLD/NONE/REJECTED=0','H5 metric units/labels/formula differ');
  check(Array.isArray(view.source_integrity_warnings)&&new Set(view.source_integrity_warnings.map(w=>w.page_id)).size===view.source_integrity_warnings.length&&
    view.source_integrity_warnings.every(w=>view.atoms.some(a=>a.held_source_context.some(h=>same(h.temporal_eligibility_hold,w)))),'unbound H5 source warning');
  for(const atom of view.atoms)for(const held of atom.held_source_context){const w=held.temporal_eligibility_hold,p=held.citation,page=citation(p),endpoint=endpoints.get(held.appraisal_id);
    check(held.reader_class==='INSPECTED_CONTEXT_WITH_SOURCE_ELIGIBILITY_HOLD'&&held.context_priority_index===0&&held.eligible_directional_vote===false&&
      endpoint?.eligible_directional_vote===false&&same(endpoint.temporal_eligibility_hold,w)&&view.source_integrity_warnings.some(x=>same(x,w))&&
      w.page_id===p.canonical_page_id&&w.document_id===p.document_id&&w.page_sha256===p.page_sha256&&w.canonical_source_date===p.date&&w.origin_cutoff===view.case.date&&
      w.temporal_eligibility_hold===true&&w.source_date_rewritten===false&&w.date_resolution==='UNRESOLVED_SOURCE_OWNER_REVIEW_REQUIRED'&&w.eligible_directional_vote===false&&
      Array.isArray(w.exact_page_spans)&&w.exact_page_spans.length>0&&w.exact_page_spans.every(s=>validSpan(page.raw_text,s)),'H5 date-held source gained score/vote or lost original raw warning');}
}

export function reviewedSourceSummary(handle){
  const view=bound(handle),all=view.atoms.flatMap(a=>a.evidence),support=all.some(e=>e.direction==='SUPPORT'),oppose=all.some(e=>e.direction==='OPPOSE');
  return {title:support&&oppose?'Supporting and opposing evidence':support?'Sources support this assessment':oppose?'Sources oppose this assessment':all.length?'Related context only':'Assessment unresolved',
    tone:support&&oppose?'mixed':oppose?'opposed':support?'supported':'unresolved',method_id:H5_METHOD_ID,complete:null,total:view.atoms.length,
    directional_issues:view.atoms.filter(a=>a.evidence.some(e=>e.source_view_credit)).length,world_truth_certified:false};
}
const node=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const button=(label,action,attrs={})=>{const n=node('button',label,{type:'button',...attrs});n.addEventListener('click',action);return n;};
function style(){if(document.querySelector('link[data-reviewed-h5-style]'))return;const n=node('link',null,{rel:'stylesheet',href:new URL('./workbench-reviewed-source.css',import.meta.url).href,'data-reviewed-h5-style':''});document.head.append(n);}
function locator(p){return p.date+' / p. '+(p.physical_page??p.earlier_page??p.later_page??p.page??'?');}
const directionText={SUPPORT:'Supporting source argument',OPPOSE:'Opposing source argument',CONTEXT:'Related context'};
function balance(atom){const maximum={SUPPORT:new Map(),OPPOSE:new Map()};for(const e of atom.evidence)if(maximum[e.direction]){
    const docs=maximum[e.direction],id=e.citation.document_id;docs.set(id,Math.max(docs.get(id)||0,e.context_priority_index));}
  return Object.fromEntries(Object.entries(maximum).map(([sign,docs])=>[sign,{score:[...docs.values()].reduce((a,b)=>a+b,0),documents:docs.size}]));}
function chart(atom){const values=balance(atom),largest=Math.max(values.SUPPORT.score,values.OPPOSE.score),host=node('section',null,{class:'h5-balance','data-testid':'h5-source-balance','data-atom-id':atom.id});
  for(const sign of ['SUPPORT','OPPOSE']){const row=node('div',null,{class:'h5-balance-row','data-direction':sign}),line=node('div',null,{class:'reviewed-fit-label'});
    line.append(node('span',sign==='SUPPORT'?'Supporting arguments':'Opposing arguments'),node('span',values[sign].score.toFixed(4),{'data-testid':'h5-document-max-score','data-direction':sign}));
    const bar=node('div',null,{class:'reviewed-fit-track',role:'img','aria-label':sign+' document-max source alignment '+values[sign].score.toFixed(4)+'; not probability'}),fill=node('span');fill.style.width=(largest?100*values[sign].score/largest:0)+'%';bar.append(fill);row.append(line,bar);host.append(row);}
  return host;
}
export function renderReviewedSourceWorkspace(handle,{stage,onSource,onOrigin,onBaseline,onDetails,formatText=x=>x,policyText=''}={}){
  const view=bound(handle),summary=reviewedSourceSummary(handle);style();check(typeof stage==='function'&&typeof onSource==='function'&&typeof onBaseline==='function','existing source/structural controls required');
  const hero=node('section',null,{class:'construction-verdict verdict-strip reviewed-source-hero','data-testid':'compact-verdict','data-method-id':H5_METHOD_ID,'data-tone':summary.tone});
  hero.append(node('h2',summary.title,{'data-testid':'local-verdict-title'}),node('p','Source arguments address '+summary.directional_issues+' of '+summary.total+' issues.',{class:'reviewed-source-date'}),
    node('p',(view.source_view_policy.date_relation==='<'?'Sources before ':'Sources through ')+view.case.date,{class:'reviewed-source-date'}));
  const controls=node('details',null,{class:'reviewed-method-controls'});controls.append(node('summary','Method details'),node('p','Two-pass source assessment, separate from the structural native result. Directional source arguments are not proof that the assessment is true.'));
  if(policyText)controls.append(node('p',policyText));
  controls.append(node('p','Charts sum one maximum source-alignment score per document and direction. Documents are not independent votes; these scores are not probabilities. Literal agreement and directional alignment remain separate.'));
  controls.append(button('Open structural baseline',onBaseline,{'data-testid':'structural-baseline-open'}));if(typeof onOrigin==='function')controls.append(button('Origin',onOrigin));hero.append(controls);
  if(view.source_integrity_warnings.length)hero.append(node('p',view.source_integrity_warnings.length+' source-date hold; excluded from directional evidence.',{class:'reviewed-eligibility-warning','data-testid':'source-eligibility-warning'}));
  const facts=stage('02','Assessment issues','Public input'),map=stage('03','Source links','Exact source records'),sources=stage('04','Source arguments','Exact quotations'),results=stage('05','Assessment balance','Source arguments'),audit=stage('06','Method and provenance','Assessment details');
  for(const section of [facts,map,sources,results,audit])section.outer.classList.add('reviewed-source-stage');
  const contextCount=view.atoms.reduce((n,a)=>n+a.evidence.filter(e=>e.direction==='CONTEXT').length,0),related=node('details',null,{class:'reviewed-related-context','data-testid':'h5-related-context'});
  related.append(node('summary','Show related context ('+contextCount+')'));
  const details=e=>{const body=node('div',null,{class:'reviewed-source-details'});body.append(node('h3',directionText[e.direction]),node('p',e.review.reason));
    for(const [label,value]of [['Literal agreement',e.literal_agreement_coverage],['Directional alignment',e.evidence_alignment_coverage],['Source alignment score',e.context_priority_index]])body.append(node('p',label+' '+value.toFixed(4)));
    body.append(node('p',e.kind==='REASONED_ARGUMENT'?'Source-explicit supporting/opposing argument; partial coverage is not full entailment.':'Direct source stance or related context, as recorded.'),node('p','Source mode: '+e.mode.toLowerCase()));
    if(e.argument_quote)body.append(node('h4','Source argument'),node('blockquote',e.argument_quote));
    for(const quote of e.qualifier_quotes)body.append(node('h4','Retained condition or qualification'),node('blockquote',quote));
    body.append(button('Inspect full qualification paragraph',()=>onSource(e.qualification_citation)));
    if(typeof onDetails==='function')onDetails(body);};
  for(const [i,atom]of view.atoms.entries()){
    const f=node('article',null,{class:'reviewed-input-fact','data-atom-id':atom.id});f.append(node('h3','F'+(i+1)),node('p',formatText(atom.text)));facts.body.append(f);
    const card=node('article',null,{class:'reviewed-source-result','data-testid':'reviewed-source-atom','data-atom-id':atom.id,'data-source-status':atom.status});
    card.append(node('h3','F'+(i+1)+' / '+formatText(atom.text)),node('p',atom.status==='UNRESOLVED'?'No accepted source argument in assessed pages':atom.status==='CONTEXT_ONLY'?'Related context only':'Qualified source arguments recorded'),chart(atom));results.body.append(card);
    if(!atom.evidence.length)sources.body.append(node('p','F'+(i+1)+': No accepted source argument in assessed pages.',{class:'empty'}));
    for(const e of atom.evidence){
      const p=e.citation,voice=e.source_attribution.kind==='DOCUMENT_REPORTING_VOICE'?'Report assessment':formatText(e.source_attribution.speaker_quote),context=e.direction==='CONTEXT';
      if(!context){const link=node('div',null,{class:'reviewed-source-chain','data-testid':'reviewed-source-chain','data-native-kg-hops':'0'}),excerpt=p.text.replace(/\s+/g,' ');
        const cite=node('div',null,{class:'reviewed-chain-citation'});cite.append(node('span',locator(p)),node('footer',p.document_id));
        link.append(node('span','F'+(i+1)+' \u2192'),button(excerpt.slice(0,130)+(excerpt.length>130?'...':''),()=>onSource(p),{class:'reviewed-chain-excerpt','data-original-text':p.text}),cite);map.body.append(link);}
      const quote=node('article',null,{class:'exact-quote reviewed-source-quote','data-testid':'reviewed-source-quote','data-judgment-id':e.appraisal_id,'data-direction':e.direction});
      const header=node('header',null,{class:'quote-toolbar'}),readout=node('span',null,{class:'h5-score-readout'});
      readout.append(node('small','Source alignment score'),node('span',e.context_priority_index.toFixed(4),{'data-testid':'reviewed-source-index',title:'Source alignment score; not probability'}));header.append(node('span',directionText[e.direction]),readout);
      quote.append(header,node('p',voice,{class:'h5-source-voice','data-testid':'h5-source-voice','data-original-text':e.source_attribution.speaker_quote??''}),node('p',e.kind==='REASONED_ARGUMENT'?'Source-explicit argument':context?'Related context':'Direct source stance',{class:'h5-account-kind'}));
      const inspect=button('',()=>onSource(p),{class:'excerpt-text','data-testid':'reviewed-source-inspect','aria-label':'Inspect exact source'});inspect.append(node('blockquote',p.text,{'data-original-text':p.text}),node('footer',p.document_id+' / '+locator(p)));quote.append(inspect,button('Assessment details',()=>details(e),{class:'quiet'}));
      (context?related:sources.body).append(quote);
    }
    for(const held of atom.held_source_context){const block=node('article',null,{class:'exact-quote reviewed-source-quote','data-direction':'CONTEXT','data-eligibility-hold':'true'});
      block.append(node('p',held.temporal_eligibility_hold.reason,{class:'reviewed-eligibility-warning'}),node('p','Source-date hold / 0.0000; no directional vote. Original model direction '+held.original_model_direction+'.'));
      if(held.citation)block.append(button(held.citation.text,()=>onSource(held.citation),{class:'excerpt-text'}));sources.body.append(block);}
  }
  if(contextCount)sources.body.append(related);
  map.body.append(node('p','Source links are provenance, not historical graph relations.',{class:'reviewed-source-scope'}));
  const s=view.assessment_scope;audit.body.append(node('p','Processed '+s.processed_slots+'/'+s.original_slots+' fact-page slots; provider-reviewed '+s.provider_reviewed_slots+'; eligible accepted '+s.accepted_slots+'; held '+s.held_slots+'; rejected '+s.rejected_slots+'; unprocessed '+s.unprocessed_slots+'. The source search remains partial.'));
  const provenance=node('details');provenance.append(node('summary','Models and immutable source bindings'),node('p','Source-view method: '+H5_METHOD_ID),node('p',view.caveat),
    node('p','Original native: '+view.original_native_ref.sha256),node('p','Original source view: '+view.original_view_sha256),node('p','Public view: '+view.sha256));audit.body.append(provenance);
  return [hero,facts.outer,map.outer,sources.outer,results.outer,audit.outer];
}


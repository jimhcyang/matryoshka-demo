// Separate reviewed-source method. Never write model judgments into native rows.
export const REVIEWED_SOURCE_METHOD='reviewed_source_model_accounts_v3_coverage1';
const COMPOSITE_METHOD='reviewed_source_model_accounts_v3_v4_explicit_composite1';
const TEMPORAL_METHOD='reviewed_source_model_accounts_v3_temporal_qualified1';
export const REVIEWED_SOURCE_METHOD_IDS=Object.freeze([REVIEWED_SOURCE_METHOD,COMPOSITE_METHOD,TEMPORAL_METHOD]);
const DISCLOSURE='source-account-disclosure/2';
const temporalHeld=e=>e.temporal_eligibility_hold!=null;
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
  record.plan?.query_sha256,requiredFacts(record),record.result?.source_view_policy,record.reviewed_source_assessment]);}

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
  check(tree?.version==='reviewed-source-workbench-view/1','endpoint must contain the unmodified versioned reader view');
  const withoutSHA=Object.fromEntries(Object.entries(tree).filter(([key])=>key!=='sha256'));
  return {view:plain(tree),canonical:encode(withoutSHA)};
}

function validateEvidence(view,record){
  check(view.incumbent_native_method===false&&view.native_status_or_gates_rewritten===false&&
    view.synthetic_native_ESTABLISHED_labels_created===false&&view.deterministic_event_join_authority===false&&
    view.source_drawer_reuses_exact_citations===true&&view.origin_drawer_binding_unchanged===true,'method cannot claim native or deterministic authority');
  const trace=view.trace;
  check(trace?.version==='semantic-source-containment-inspection-graph/1'&&trace.native_semantic_edges_created===0&&
    trace.actual_KG_edges_inferred===false&&Array.isArray(trace.nodes)&&Array.isArray(trace.edges)&&
    trace.nodes.length<=4096&&trace.edges.length<=10000,'only the recorded containment graph is supported');
  const kinds=new Set(['REQUIRED_INPUT_COMPONENT','SOURCE_DOCUMENT','SOURCE_PAGE','EXACT_RAW_SOURCE_EXCERPT','REVIEWED_MODEL_SOURCE_ACCOUNT']);
  const edges=new Set(['RECORDED_DOCUMENT_PAGE','EXACT_RAW_SPAN_CONTAINMENT','QUOTED_MODEL_INPUT','FULL_QUALIFICATION_CONTEXT','MODEL_ASSESSES_COMPONENT']);
  const nodes=new Map();for(const node of trace.nodes){check(typeof node.id==='string'&&!nodes.has(node.id)&&kinds.has(node.kind),'unknown or repeated source-containment node');nodes.set(node.id,node);}
  for(const edge of trace.edges)check(nodes.has(edge.source)&&nodes.has(edge.target)&&edges.has(edge.kind)&&
    edge.historical_relation_certified!==true&&edge.deterministic_support!==true&&edge.event_join_authority!==true,'containment is not a historical/KG edge');
  check(Array.isArray(view.source_endpoints)&&Array.isArray(view.atoms)&&view.atoms.length>0&&view.atoms.length<=128,'required facts/endpoints missing');
  const query=Array.from(view.case.query),factIds=new Set(),judgments=new Set();
  const nativeFacts=requiredFacts(record);
  check(nativeFacts.length===view.atoms.length&&nativeFacts.every(a=>view.atoms.some(v=>v.id===a.id&&v.text===a.text)),'required fact inventory differs from the bound native plan');
  const labels=view.case.task==='hypothesis'?new Set(['SOURCE_VIEWS_RECORDED','CONTESTED_SOURCE_ACCOUNTS','PARTIAL_SOURCE_ASCRIPTION','CONTEXT_ONLY','UNRESOLVED']):
    new Set(['SOURCE_ASCRIBED','PARTIAL_SOURCE_ASCRIPTION','OPPOSING_SOURCE_ACCOUNT','CONTESTED_SOURCE_ACCOUNTS','CONTEXT_ONLY','UNRESOLVED']);
  const pages=new Map(trace.nodes.filter(n=>n.kind==='SOURCE_PAGE').map(n=>[n.canonical_page_id,n]));
  const citation=proof=>{
    const page=pages.get(proof?.canonical_page_id),chars=Array.from(page?.raw_text||'');
    check(page&&proof.document_id===page.document_id&&proof.date===page.date&&proof.page_sha256===page.page_sha256&&sha(proof.page_sha256)&&
      Number.isSafeInteger(proof.start)&&Number.isSafeInteger(proof.end)&&proof.start>=0&&proof.end>proof.start&&proof.end<=chars.length&&
      typeof proof.text==='string'&&chars.slice(proof.start,proof.end).join('')===proof.text,'source quotation does not reproduce its exact source page');
    const inclusive=view.source_view_policy.date_relation==='<=',strict=view.source_view_policy.date_relation==='<';
    check(/^\d{4}-\d{2}-\d{2}$/.test(proof.date)&&(inclusive?proof.date<=view.case.date:strict&&proof.date<view.case.date),'source date is outside the bound policy');
  };
  for(const atom of view.atoms){
    check(typeof atom.id==='string'&&!factIds.has(atom.id)&&labels.has(atom.status)&&Array.isArray(atom.evidence)&&
      atom.evidence.length<=2048&&atom.counts_are_independent_votes===false&&atom.world_truth_verdict==='NOT_ASSESSED','unknown or unauthenticated method-local fact');factIds.add(atom.id);
    check(atom.authority===(view.case.task==='hypothesis'?'QUERIED_ASSESSMENT_ONLY':'SOURCE_ASCRIPTION'),'fact authority differs from its task');
    check(Array.isArray(atom.query_spans)&&atom.query_spans.length&&atom.query_spans.every(span=>Number.isSafeInteger(span.start)&&Number.isSafeInteger(span.end)&&
      span.start>=0&&span.end>span.start&&span.end<=query.length&&query.slice(span.start,span.end).join('')===span.text),'fact query spans changed');
    const counts={SUPPORT:new Set(),OPPOSE:new Set(),PARTIAL:new Set(),CONTEXT:new Set()};
    for(const evidence of atom.evidence){
      check(sha(evidence.judgment_id)&&!judgments.has(evidence.judgment_id)&&Object.hasOwn(counts,evidence.direction)&&
        evidence.model_reviewed===true&&evidence.deterministic_proof===false&&evidence.inner_execution===false&&evidence.event_join_authority===false&&
        evidence.authority===atom.authority,'unreviewed or stronger-authority evidence is not admitted');judgments.add(evidence.judgment_id);
      check(evidence.review?.decision==='ACCEPT'&&(view.method_id===COMPOSITE_METHOD&&evidence.reviewed_method_version==='V4'?evidence.review.anchor_binding_verified===true:evidence.review.judgment_id===evidence.judgment_id)&&evidence.review.independent_rederivation===true&&
        evidence.review.authority===evidence.authority,'independent source review missing');
      if(evidence.direction!=='CONTEXT')check(evidence.review.same_target===true&&evidence.review.operators_retained===true&&
        evidence.review.qualifications_retained===true,'directional account lost its target/operators/qualifications');
      if(evidence.direction==='SUPPORT'&&view.case.task==='mosaic')check(evidence.review.whole_component_sufficient===true&&
        evidence.review.directional_stance_supported===false,'Mosaic support must retain whole-component sufficiency');
      if(['SUPPORT','OPPOSE'].includes(evidence.direction)&&view.case.task==='hypothesis')check(evidence.review.directional_stance_supported===true&&
        evidence.review.whole_component_sufficient===false,'a source stance is not whole-event factual execution');
      citation(evidence.citation);citation(evidence.qualification_citation);
      const p=evidence.citation,q=evidence.qualification_citation;
      check(p.canonical_page_id===q.canonical_page_id&&p.document_id===q.document_id&&p.page_sha256===q.page_sha256&&
        q.start<=p.start&&p.end<=q.end&&Array.from(q.text).slice(p.start-q.start,p.end-q.start).join('')===p.text&&
        evidence.model_quote_unchanged===p.text,'qualification envelope was dropped or changed');
      const endpoint=view.source_endpoints.filter(e=>e.judgment_id===evidence.judgment_id);
      check(endpoint.length===1&&endpoint[0].atom_id===atom.id&&endpoint[0].endpoint_id===evidence.source_endpoint_id&&
        endpoint[0].qualification_endpoint_id===evidence.qualification_endpoint_id&&same(endpoint[0].quote,p)&&same(endpoint[0].qualification_quote,q)&&
        endpoint[0].native_KG_node_id===null&&endpoint[0].native_semantic_route===null&&endpoint[0].input_to_source_world_edge_invented===false&&
        same(nodes.get(evidence.source_endpoint_id)?.citation,p)&&same(nodes.get(evidence.qualification_endpoint_id)?.citation,q),'source endpoint/containment differs from accepted evidence');
      const lexical=evidence.local_lexical_fit;
      check(number(evidence.facet_coverage)&&evidence.facet_coverage>=0&&evidence.facet_coverage<=1&&number(lexical?.value)&&lexical.value>=0&&lexical.value<=1&&
        (temporalHeld(evidence)?view.method_id===TEMPORAL_METHOD&&evidence.context_priority_index===0&&close(evidence.original_model_context_priority_index,.75*evidence.facet_coverage+.25*lexical.value):close(evidence.context_priority_index,.75*evidence.facet_coverage+.25*lexical.value)),'recorded source context-index arithmetic differs');
      counts[evidence.direction].add(p.document_id);
    }
    for(const [direction,documents]of Object.entries(counts))check(atom.source_counts?.[direction]===documents.size,'source counts are not literal distinct document counts');
    if(view.case.task==='hypothesis')check(atom.complete_by_model_source_review===null,'a source stance must not certify world-truth coverage');
    else check(atom.complete_by_model_source_review===(counts.SUPPORT.size>0&&counts.OPPOSE.size===0)&&
      (atom.status==='SOURCE_ASCRIBED')===atom.complete_by_model_source_review,'Mosaic component coverage differs from accepted source accounts');
  }
  const scope=view.assessment_scope;
  check(scope&&['original_slots','processed_slots','reviewed_slots','rejected_slots','review_pending_slots','unprocessed_slots','required_facts','original_pages']
    .every(k=>Number.isSafeInteger(scope[k])&&scope[k]>=0)&&scope.required_facts===view.atoms.length&&scope.original_slots===scope.required_facts*scope.original_pages&&
    (scope.version===DISCLOSURE?scope.accepted_slots+scope.held_slots+scope.rejected_slots+scope.review_pending_slots===scope.processed_slots:scope.reviewed_slots+scope.rejected_slots+scope.review_pending_slots===scope.processed_slots)&&scope.processed_slots+scope.unprocessed_slots===scope.original_slots&&
    scope.unknown_is_NONE===false,'method coverage/pending/rejection inventory differs');
  check(view.case.task==='hypothesis'?view.coverage===null:close(view.coverage,view.atoms.filter(a=>a.complete_by_model_source_review).length/view.atoms.length),'coverage is method-local, not probability');
  check(Array.isArray(view.model_provenance)&&view.model_provenance.length>0&&view.model_provenance.every(p=>
    p.kind==='MODEL_SEMANTIC_JUDGMENT'&&['assessment','review'].includes(p.stage)&&typeof p.model==='string'&&p.model&&
    typeof p.call_id==='string'&&/^[a-f0-9]{32}$/.test(p.call_id)&&sha(p.provider_receipt_ref?.sha256)),
    'test fixtures or missing actual provider provenance cannot enter the published method');
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
  check(fields.every(k=>view.case?.[k]===row.case?.[k]&&record.case?.[k]===row.case?.[k])&&['mosaic','hypothesis'].includes(view.case.task)&&
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
  await validateMethodExtension(view,record);
  validateEvidence(view,record);
  check(!signal?.aborted&&sourceSnapshot(row,record)===snapshot,'selected case or native authority changed during verification');
  freeze(view);
  const handle=Object.freeze({method_id:view.method_id,view});
  verified.set(handle,{row,record,snapshot});return handle;
}

function bound(handle){const binding=verified.get(handle);check(binding&&sourceSnapshot(binding.row,binding.record)===binding.snapshot,'verify the exact current method before rendering');return handle.view;}
function validateDisclosure(view,record){
  const s=view.assessment_scope;if(s.version!==DISCLOSURE)return;
  const keys=['processed_slots','provider_reviewed_slots','model_accepted_slots','accepted_slots','held_slots','review_hold_slots','eligibility_hold_slots','rejected_slots','review_pending_slots','unprocessed_slots'];
  check(Array.isArray(s.grid)&&s.grid.length===s.original_slots&&keys.every(k=>Number.isSafeInteger(s[k])&&s[k]>=0),'complete revised scope grid/counters required');
  const totals=Object.fromEntries(keys.map(k=>[k,0])),seen=new Set(),pages=new Set(),facts=new Set(view.atoms.map(a=>a.id));
  for(const row of s.grid){
    const key=JSON.stringify([row.fact_id,row.page_id]);check(!seen.has(key)&&facts.has(row.fact_id)&&typeof row.page_id==='string'&&row.page_id&&
      ['provider_reviewed','model_accepted','eligible_accepted'].every(k=>typeof row[k]==='boolean'),'scope slot identity/flags differ');seen.add(key);pages.add(row.page_id);
    totals.provider_reviewed_slots+=Number(row.provider_reviewed);totals.model_accepted_slots+=Number(row.model_accepted);
    if(row.state==='UNPROCESSED'){totals.unprocessed_slots++;check(!row.provider_reviewed&&!row.model_accepted&&!row.eligible_accepted,'unprocessed slot gained review');continue;}
    totals.processed_slots++;
    if(row.state==='ROW_REJECTED')totals.rejected_slots++;
    else if(row.state==='REVIEW_PENDING')totals.review_pending_slots++;
    else if(row.state==='SOURCE_ELIGIBILITY_HOLD'){totals.held_slots++;totals.eligibility_hold_slots++;check(row.temporal_eligibility_hold&&row.eligible_accepted===false,'eligibility hold was counted as accepted');}
    else if(row.state==='REVIEW_HOLD'){totals.held_slots++;totals.review_hold_slots++;}
    else{check(['SUPPORT','OPPOSE','PARTIAL','CONTEXT','NONE'].some(label=>row.state==='REVIEWED_'+label&&row.label===label)&&row.provider_reviewed&&row.model_accepted&&row.eligible_accepted,'unknown/unaccepted source slot counted as accepted');totals.accepted_slots++;continue;}
    check(row.eligible_accepted===false,'unresolved slot gained eligible acceptance');
  }
  const complete=totals.accepted_slots===s.original_slots;
  check(keys.every(k=>s[k]===totals[k])&&s.original_pages===pages.size&&s.original_slots===s.required_facts*pages.size&&s.required_facts===view.atoms.length&&
    same([...pages].sort(),[...(record.result.inspected_page_ids||[])].sort())&&s.reviewed_slots===totals.provider_reviewed_slots&&s.eligible_accepted_slots===totals.accepted_slots&&
    s.reviewed_slots_meaning==='PROVIDER_REVIEWED_INCLUDING_HOLD_NOT_ACCEPTED'&&s.all_slots_resolved_by_eligible_review===complete&&
    s.inspected_pool_completely_assessed===complete&&s.inspected_pool_completely_processed===(totals.unprocessed_slots===0)&&
    s.partial_inspected_pool_processing===(totals.unprocessed_slots>0)&&s.partial_assessment===!complete&&s.partial_search===true&&
    s.whole_corpus_search_claimed===false&&s.search_scope==='RECORDED_INSPECTED_PAGES_NOT_WHOLE_ELIGIBLE_CORPUS','HOLD/processing/assessment/source-search scope differs');
}
function providerIn(view,receipt,stage){return receipt?.kind==='MODEL_SEMANTIC_JUDGMENT'&&receipt.stage===stage&&/^[a-f0-9]{32}$/.test(receipt.call_id||'')&&
  ['provider_receipt_ref','request_ref','response_ref'].every(k=>sha(receipt[k]?.sha256))&&view.model_provenance.some(p=>p.stage===receipt.stage&&p.call_id===receipt.call_id&&p.model===receipt.model&&
    ['provider_receipt_ref','request_ref','response_ref'].every(k=>p[k]?.sha256===receipt[k]?.sha256));}
async function validateMethodExtension(view,record){
  const composite=view.method_id===COMPOSITE_METHOD,temporal=view.method_id===TEMPORAL_METHOD,all=view.atoms.flatMap(a=>a.evidence.map(e=>({atom:a,...e})));
  check(!(composite||temporal)||view.assessment_scope?.version===DISCLOSURE,'typed composite/temporal method requires the reviewed disclosure version');
  validateDisclosure(view,record);
  check(sha(view.method_packet_sha256),'typed producer method commitment missing');
  if(composite){
    check(view.projection_revision===DISCLOSURE&&view.assessment_scope.mixed_method_declared===true&&Array.isArray(view.method_lineage)&&view.method_lineage.length>0,'explicit composite lineage required, not a V3 alias');
    const slots=new Set(),ids=new Set(),byId=new Map(),approvals=new Map();
    for(const l of view.method_lineage){
      const key=JSON.stringify([l.fact_id,l.page_id]),prior=l.prior_V3_row,grid=view.assessment_scope.grid.find(g=>g.fact_id===l.fact_id&&g.page_id===l.page_id);
      check(!slots.has(key)&&!ids.has(l.selected_V4_judgment_id)&&grid&&prior?.fact_id===l.fact_id&&prior.page_id===l.page_id&&prior.document_id===grid.document_id&&sha(prior.page_sha256)&&
        l.policy==='EXPLICIT_V4_SLOT_REPLACEMENT_INCLUDING_HOLD_NOT_BEST_LABEL_SELECTION'&&sha(l.observation_sha256)&&sha(l.selected_V4_judgment_id)&&
        providerIn(view,l.review_receipt,'review')&&providerIn(view,l.unchanged_first_pass_receipt,'assessment'),'composite slot/provider/prior-row lineage differs');
      const sourcePages=view.trace.nodes.filter(n=>n.kind==='SOURCE_PAGE'&&n.canonical_page_id===l.page_id),source=sourcePages[0];
      check(sourcePages.length===1&&prior.page_id===source.canonical_page_id&&prior.document_id===source.document_id&&grid.document_id===source.document_id&&
        prior.page_sha256===source.page_sha256&&sha(source.page_sha256)&&typeof source.raw_text==='string'&&
        await hash(ascii(source.raw_text))===source.page_sha256,'every composite lineage slot must bind the actual raw source page, including NONE/HOLD');
      slots.add(key);ids.add(l.selected_V4_judgment_id);byId.set(l.selected_V4_judgment_id,l);
      const approval=JSON.stringify([l.observation_sha256,l.review_receipt.call_id,l.unchanged_first_pass_receipt.call_id]);
      if(!approvals.has(approval))approvals.set(approval,[]);approvals.get(approval).push(l);
    }
    for(const rows of approvals.values())for(const page of new Set(rows.map(l=>l.page_id)))for(const atom of view.atoms)
      check(rows.some(l=>l.page_id===page&&l.fact_id===atom.id),'composite approval dropped a literal source slot, including NONE/HOLD');
    for(const e of all){
      check(['V3','V4'].includes(e.reviewed_method_version),'composite account producer version missing');
      if(e.reviewed_method_version==='V3'){check(!byId.has(e.judgment_id),'replaced V4 slot relabeled V3');continue;}
      const l=byId.get(e.judgment_id),review=e.review,raw=l?.prior_V3_row.raw_model_row||l?.prior_V3_row;
      check(l&&l.fact_id===e.atom.id&&l.page_id===e.citation.canonical_page_id&&raw?.quote===e.model_quote_unchanged&&raw.label===e.direction&&
        review?.anchor_binding_verified===true&&sha(review.observation_row_id)&&review.label===e.direction&&
        await hash(ascii(['mixed-reviewed-source-accounts/1',review.observation_row_id,l.review_receipt.call_id]))===e.judgment_id&&
        Array.isArray(review.anchor_resolutions)&&review.anchor_resolutions.length>0&&new Set(review.anchor_resolutions.map(r=>r.anchor_id)).size===review.anchor_resolutions.length&&
        review.anchor_resolutions.every(r=>sha(r.anchor_id)&&Array.isArray(r.candidate_ids)&&new Set(r.candidate_ids).size===r.candidate_ids.length&&r.candidate_ids.every(sha)),
        'V4 accepted account lacks literal original-slot/review-anchor lineage');
      const page=view.trace.nodes.find(n=>n.kind==='SOURCE_PAGE'&&n.canonical_page_id===e.citation.canonical_page_id);
      check(same(Object.keys(e.grounded_fields).sort(),Object.keys(raw.fields).sort())&&Object.entries(e.grounded_fields).every(([field,g])=>
        g.state===raw.fields[field].state&&review.field_states[field]===g.state&&g.query_coordinate_system==='BOUND_FACT_TEXT'&&same(g.bound_public_query_spans,e.atom.query_spans)&&
        Array.isArray(g.query_spans)&&g.query_spans.every(s=>Number.isSafeInteger(s.start)&&Number.isSafeInteger(s.end)&&s.start>=0&&s.start<s.end&&s.end<=Array.from(e.atom.text).length&&Array.from(e.atom.text).slice(s.start,s.end).join('')===s.text)&&
        Array.isArray(g.source_spans)&&g.source_spans.every(s=>Number.isSafeInteger(s.start)&&Number.isSafeInteger(s.end)&&e.qualification_citation.start<=s.start&&s.start<s.end&&s.end<=e.qualification_citation.end&&Array.from(page.raw_text).slice(s.start,s.end).join('')===s.text)),
        'V4 source/query argument or qualification spans changed');
      const account=view.trace.nodes.find(n=>n.kind==='REVIEWED_MODEL_SOURCE_ACCOUNT'&&n.judgment_id===e.judgment_id);
      check(account?.reviewed_method_version==='V4'&&account.effective_label===e.direction,'V4 trace producer differs');
    }
  }else check(!view.method_lineage&&all.every(e=>e.reviewed_method_version==null||e.reviewed_method_version==='V3'),'V3/temporal method cannot inherit V4 composite authority');
  const warnings=view.source_integrity_warnings||[],held=all.filter(temporalHeld);
  if(!temporal){check(!warnings.length&&!held.length&&all.every(e=>e.eligibility_projection_not_new_model_review!==true&&e.eligible_directional_vote!==false),'temporal exception requires its distinct typed method');return;}
  check(view.case.task==='hypothesis'&&view.original_method_id===REVIEWED_SOURCE_METHOD&&view.projection_revision===DISCLOSURE&&sha(view.supersedes_view_sha256)&&warnings.length>0&&held.length>0,
    'temporal qualification is not an ordinary V3 alias');
  for(const w of warnings){
    const page=view.trace.nodes.find(n=>n.kind==='SOURCE_PAGE'&&n.canonical_page_id===w.page_id);
    check(page&&w.document_id===page.document_id&&w.canonical_source_date===page.date&&w.origin_cutoff===view.case.date&&w.page_sha256===page.page_sha256&&
      await hash(ascii(page.raw_text))===w.page_sha256&&w.temporal_eligibility_hold===true&&w.internal_date_conflict===true&&w.eligible_directional_vote===false&&
      w.source_date_rewritten===false&&w.date_resolution==='UNRESOLVED_SOURCE_OWNER_REVIEW_REQUIRED'&&typeof w.reason==='string'&&w.reason&&
      Array.isArray(w.exact_page_spans)&&w.exact_page_spans.length>0&&w.exact_page_spans.every(s=>Number.isSafeInteger(s.start)&&Number.isSafeInteger(s.end)&&s.start>=0&&s.start<s.end&&s.end<=Array.from(page.raw_text).length&&Array.from(page.raw_text).slice(s.start,s.end).join('')===s.text),
      'source date warning lost its exact raw page/hash/cutoff/spans');
    check(held.some(e=>same(e.temporal_eligibility_hold,w)),'unbound temporal warning');
  }
  for(const e of held){
    const w=e.temporal_eligibility_hold,endpoint=view.source_endpoints.find(x=>x.judgment_id===e.judgment_id),account=view.trace.nodes.find(n=>n.kind==='REVIEWED_MODEL_SOURCE_ACCOUNT'&&n.judgment_id===e.judgment_id);
    const edge=view.trace.edges.find(x=>x.kind==='MODEL_ASSESSES_COMPONENT'&&x.source===account?.id),grid=view.assessment_scope.grid.find(g=>g.fact_id===e.atom.id&&g.page_id===e.citation.canonical_page_id);
    check(warnings.some(x=>same(x,w))&&e.direction==='CONTEXT'&&e.context_priority_index===0&&e.eligible_directional_vote===false&&e.internal_date_conflict===true&&
      e.eligibility_projection_not_new_model_review===true&&['SUPPORT','OPPOSE','PARTIAL','CONTEXT'].includes(e.original_model_direction)&&
      number(e.original_model_context_priority_index)&&close(e.original_model_context_priority_index,.75*e.facet_coverage+.25*e.local_lexical_fit.value)&&
      e.citation.document_id===w.document_id&&e.citation.canonical_page_id===w.page_id&&e.citation.date===w.canonical_source_date&&e.citation.page_sha256===w.page_sha256&&
      endpoint?.eligible_directional_vote===false&&same(endpoint.temporal_eligibility_hold,w)&&account?.effective_label==='CONTEXT'&&account.original_model_effective_label===e.original_model_direction&&
      account.eligible_directional_vote===false&&same(account.temporal_eligibility_hold,w)&&edge?.label==='CONTEXT'&&edge.original_model_label===e.original_model_direction&&
      edge.eligible_directional_vote===false&&same(edge.temporal_eligibility_hold,w)&&grid?.state==='SOURCE_ELIGIBILITY_HOLD'&&grid.eligible_accepted===false&&same(grid.temporal_eligibility_hold,w),
      'date-held account cannot regain score/vote or discard original model provenance');
    if(['SUPPORT','OPPOSE'].includes(e.original_model_direction))check(e.review.same_target===true&&e.review.operators_retained===true&&e.review.qualifications_retained===true&&
      e.review.directional_stance_supported===true&&e.review.whole_component_sufficient===false,'original directional review was rewritten');
  }
  for(const atom of view.atoms)for(const sign of ['SUPPORT','OPPOSE']){
    const best=new Map();for(const e of atom.evidence.filter(e=>e.direction===sign&&!temporalHeld(e))){const prior=best.get(e.citation.document_id);if(!prior||e.context_priority_index>prior.context_priority_index)best.set(e.citation.document_id,e);}
    const groups=new Map();for(const e of best.values()){const key=e.qualification_citation.text.toLowerCase().trim().replace(/\s+/g,' ');groups.set(key,Math.max(groups.get(key)||0,e.context_priority_index));}
    const balance=atom.source_balance?.[sign];check(balance?.independent_votes===false&&balance.report_groups===groups.size&&close(balance.context_index_sum,[...groups.values()].reduce((a,b)=>a+b,0)),
      'eligibility-held report inflated directional balance');
  }
}
export function reviewedSourceSummary(handle){
  const view=bound(handle),mosaic=view.case.task==='mosaic',complete=view.atoms.filter(a=>a.complete_by_model_source_review===true).length;
  const directions=new Set(view.atoms.flatMap(a=>a.evidence.map(e=>e.direction))),support=directions.has('SUPPORT'),oppose=directions.has('OPPOSE');
  const title=mosaic?complete+'/'+view.atoms.length+' source-backed Mosaic':support&&oppose?'Supporting and opposing source views':
    support?'Supporting source views':oppose?'Opposing source views':directions.has('PARTIAL')?'Qualified source arguments':directions.has('CONTEXT')?'Related source context':'No accepted source view';
  const tone=support&&oppose?'mixed':oppose?'opposed':mosaic?(complete===view.atoms.length?'supported':'partial'):support?'supported':'unresolved';
  return {title,complete,total:view.atoms.length,tone,method_id:view.method_id,world_truth_certified:false};
}
function node(tag,text,attributes={}){const el=document.createElement(tag);if(text!=null)el.textContent=text;for(const [key,value]of Object.entries(attributes))el.setAttribute(key,value);return el;}
function button(text,action,attributes={}){const b=node('button',text,{type:'button',...attributes});b.addEventListener('click',action);return b;}
function style(){if(document.querySelector('link[data-reviewed-source-style]'))return;const link=node('link',null,{rel:'stylesheet',href:new URL('./workbench-reviewed-source.css',import.meta.url).href,'data-reviewed-source-style':'1'});document.head.append(link);}
const directionLabel={SUPPORT:'Supporting source',OPPOSE:'Opposing source',PARTIAL:'Partial source account',CONTEXT:'Related context'};
const statusLabel={SOURCE_ASCRIBED:'Source-account supported',PARTIAL_SOURCE_ASCRIPTION:'Partial source account',OPPOSING_SOURCE_ACCOUNT:'Opposing source account',
  CONTESTED_SOURCE_ACCOUNTS:'Conflicting source accounts',SOURCE_VIEWS_RECORDED:'Qualified source views recorded',CONTEXT_ONLY:'Related source context',UNRESOLVED:'Unresolved'};
function locator(proof){return [proof.date,Number.isSafeInteger(proof.earlier_page||proof.physical_page)?'p. '+(proof.earlier_page||proof.physical_page):null].filter(Boolean).join(' / ');}
function location(proof){return [proof.document_id,locator(proof)].filter(Boolean).join(' / ');}
function sourceLabel(proof){
  const chars=Array.from(proof.text),prefix=chars.slice(0,112).join('');
  if(chars.length<=112)return prefix;
  const cut=prefix.lastIndexOf(' ');
  return prefix.slice(0,cut>72?cut:prefix.length)+'...';
}
function related(count,testid){const el=node('details',null,{class:'reviewed-related-context','data-testid':testid});el.append(node('summary','Show related context ('+count+')'));return el;}
function fitBar(atom){
  const eligible=atom.evidence.filter(e=>!temporalHeld(e)),decisive=eligible.filter(e=>e.direction!=='CONTEXT'),pool=decisive.length?decisive:eligible;
  const selected=pool.reduce((best,e)=>!best||e.context_priority_index>best.context_priority_index?e:best,null);
  if(!selected)return null;
  const value=selected.context_priority_index,label=decisive.length?'Best source fit':'Context fit';
  const host=node('div',null,{class:'reviewed-fact-fit','data-testid':'reviewed-fact-fit','data-judgment-id':selected.judgment_id,'data-direction':selected.direction});
  const line=node('div',null,{class:'reviewed-fit-label'});line.append(node('span',label),node('span',value.toFixed(4),{'data-testid':'reviewed-fact-fit-value'}));
  const meter=node('div',null,{class:'reviewed-fit-track',role:'meter','aria-label':label+' for '+atom.text,'aria-valuemin':'0','aria-valuemax':'1',
    'aria-valuenow':String(value),'aria-valuetext':value.toFixed(4)+' source fit; not probability'});
  const fill=node('span');fill.style.width=String(value*100)+'%';meter.append(fill);host.append(line,meter);return host;
}
function digestSurface(handle,sources,renderVerifiedDigest,onSource){
  if(renderVerifiedDigest==null)return;
  check(typeof renderVerifiedDigest==='function','optional digest renderer must be an explicit trusted callback');
  const view=bound(handle),authority=verified.get(handle),record=authority.record;
  const host=node('section',null,{class:'reviewed-source-digest','data-testid':'reviewed-source-digest',hidden:''});sources.body.append(host);
  const binding=freeze({case_id:view.case.case_id,config:record.config,method_id:view.method_id,query_sha256:view.query_sha256,
    original_view_sha256:view.original_view_sha256,public_view_sha256:view.sha256,native_checkpoint_sha256:view.original_native_ref.sha256,
    native_checksum:record.native_checksum,source_view_policy:structuredClone(view.source_view_policy)});
  const citations=view.atoms.flatMap(a=>a.evidence.flatMap(e=>[e.citation,e.qualification_citation]));
  const assertCurrent=()=>{bound(handle);check(record.native_checksum===binding.native_checksum&&record.config===binding.config,'digest native checksum or configuration changed');return binding;};
  const context=Object.freeze({binding,assertCurrent,
    onSource:proof=>{assertCurrent();check(citations.some(p=>same(p,proof)),'digest citation is outside the verified source view');onSource(proof);}});
  const accept=content=>{
    assertCurrent();if(content==null)return;
    check([1,11].includes(content.nodeType)&&typeof content.appendChild==='function','digest callback must render verified content, not supply raw JSON or HTML');
    host.replaceChildren(content);host.hidden=false;
  };
  const content=renderVerifiedDigest(context);
  if(content&&typeof content.then==='function'){
    Promise.resolve(content).then(value=>{if(host.isConnected)accept(value);}).catch(()=>{host.hidden=true;host.replaceChildren();host.dataset.digestStatus='held';});
  }else accept(content);
}

export function renderReviewedSourceWorkspace(handle,{stage,onSource,onOrigin,onBaseline,onDetails,formatText=value=>value,policyText='',renderVerifiedDigest}={}){
  const view=bound(handle),summary=reviewedSourceSummary(handle);style();
  check(typeof stage==='function'&&typeof onSource==='function'&&typeof onBaseline==='function','existing source drawer and separate baseline controls required');
  const hero=node('section',null,{class:'construction-verdict verdict-strip reviewed-source-hero','data-testid':'compact-verdict','data-method-id':view.method_id,'data-tone':summary.tone});
  hero.append(node('h2',summary.title,{'data-testid':'local-verdict-title'}));
  const chips=node('div',null,{class:'verdict-facts'});
  for(const [i,atom]of view.atoms.entries())chips.append(button('F'+(i+1)+' / '+statusLabel[atom.status],()=>document.querySelector('#stage-05 [data-atom-id="'+CSS.escape(atom.id)+'"]')?.scrollIntoView({block:'center'}),{class:'verdict-fact'}));
  if(view.source_integrity_warnings?.length)hero.append(node('p',view.source_integrity_warnings.length+' source-date hold; excluded from directional evidence.',{class:'reviewed-eligibility-warning','data-testid':'source-eligibility-warning'}));
  hero.append(chips,node('p',(view.source_view_policy.date_relation==='<'?'Sources before ':'Sources through ')+view.case.date,{class:'reviewed-source-date'}));
  if(view.method_id===TEMPORAL_METHOD){const docs=sign=>new Set(view.atoms.flatMap(a=>a.evidence.filter(e=>e.direction===sign&&!temporalHeld(e)).map(e=>e.citation.document_id))).size;
    hero.append(node('p',docs('SUPPORT')+' eligible supporting reports / '+docs('OPPOSE')+' opposing',{class:'reviewed-source-balance','data-testid':'eligible-source-balance'}));}
  const controls=node('details',null,{class:'reviewed-method-controls'});controls.append(node('summary','Method details'));
  controls.append(node('p','Two-pass model source assessment, separate from the structural native result. Source accounts are not deterministic event proof.'));
  if(policyText)controls.append(node('p',policyText,{class:'reviewed-source-scope'}));
  const scope=view.assessment_scope;
  if(scope.version===DISCLOSURE)controls.append(node('p','Provider-reviewed '+scope.provider_reviewed_slots+'; eligible accepted '+scope.accepted_slots+'; held '+scope.held_slots+'. Reviewed does not mean accepted.'));
  controls.append(node('p',scope.processed_slots+'/'+scope.original_slots+' fact-page slots processed; '+scope.unprocessed_slots+' unprocessed; '+scope.review_pending_slots+' awaiting review; '+scope.rejected_slots+' rejected.'));
  controls.append(node('p','Fit bars show the highest recorded non-context source index for each fact, or context fit when no directional account exists. They are not probabilities or independent votes.'));
  controls.append(button('Open structural baseline',onBaseline,{'data-testid':'structural-baseline-open'}));
  if(typeof onOrigin==='function')controls.append(button('Origin',onOrigin));hero.append(controls);
  const facts=stage('02','Required facts','Public input'),map=stage('03','Source links','Exact source records'),sources=stage('04','Source accounts','Exact quotations'),
    results=stage('05',view.case.task==='hypothesis'?'Source views':'Mosaic components','Source assessment'),audit=stage('06','Method and provenance','Assessment details');
  for(const section of [facts,map,sources,results,audit])section.outer.classList.add('reviewed-source-stage');
  const contextCount=view.atoms.reduce((n,a)=>n+a.evidence.filter(e=>e.direction==='CONTEXT'&&!temporalHeld(e)).length,0);
  const relatedMap=contextCount?related(contextCount,'reviewed-context-routes'):null,relatedSources=contextCount?related(contextCount,'reviewed-context-sources'):null;
  const sourceDetails=(atom,evidence)=>{
    const body=node('div',null,{class:'reviewed-source-details'});
    if(temporalHeld(evidence))body.append(node('p','Original model direction '+evidence.original_model_direction+' / original index '+evidence.original_model_context_priority_index.toFixed(4)+'. Publication eligibility is held at CONTEXT / 0.0000; the original model review is unchanged.',{class:'reviewed-eligibility-warning'}));
    body.append(node('h3',directionLabel[evidence.direction]),node('p',evidence.review.reason),node('p','Context fit index '+evidence.context_priority_index.toFixed(4)+' (not probability).'));
    body.append(button('Inspect full qualification paragraph',()=>onSource(evidence.qualification_citation)));
    if(evidence.qualifications)body.append(node('pre',JSON.stringify(evidence.qualifications,null,2)));
    if(typeof onDetails==='function')onDetails(body);
  };
  for(const [i,atom]of view.atoms.entries()){
    const fact=node('article',null,{class:'reviewed-input-fact','data-atom-id':atom.id});fact.append(node('h3','F'+(i+1)),node('p',formatText(atom.text)));facts.body.append(fact);
    const group=node('section',null,{class:'fact-evidence-group','data-atom-id':atom.id});group.append(node('h3','F'+(i+1)+' / '+formatText(atom.text)));
    const card=node('article',null,{class:'reviewed-source-result','data-testid':'reviewed-source-atom','data-atom-id':atom.id,'data-source-status':atom.status});
    const heading=node('div',null,{class:'reviewed-result-heading'});heading.append(node('strong','F'+(i+1)),node('span',statusLabel[atom.status]));card.append(heading,node('p',formatText(atom.text)));
    const fit=fitBar(atom);if(fit)card.append(fit);
    if(!atom.evidence.length)group.append(node('p','No accepted source account in the assessed pages.',{class:'empty'}));
    let visible=0;
    const contextReferences=node('details',null,{class:'reviewed-related-context'});contextReferences.append(node('summary','Related context'));
    for(const evidence of atom.evidence){
      const proof=evidence.citation,held=temporalHeld(evidence),isContext=evidence.direction==='CONTEXT'&&!held;
      const chain=node('div',null,{class:'reviewed-source-chain','data-testid':'reviewed-source-chain','data-native-kg-hops':'0'});
      const short=button(sourceLabel(proof),()=>onSource(proof),{class:'reviewed-chain-excerpt','aria-label':'Inspect exact source quotation','data-original-text':proof.text});
      const citation=node('div',null,{class:'reviewed-chain-citation'});citation.append(node('span',locator(proof)),node('footer',proof.document_id));
      chain.append(node('span','F'+(i+1)+' \u2192',{class:'reviewed-chain-fact'}),short,citation);
      (isContext?relatedMap:map.body).append(chain);
      const quote=node('article',null,{class:'exact-quote reviewed-source-quote','data-direction':evidence.direction,'data-testid':'reviewed-source-quote','data-judgment-id':evidence.judgment_id});
      const header=node('header',null,{class:'quote-toolbar'});header.append(node('span',held?'Source-date hold / no directional vote':directionLabel[evidence.direction]),node('span',evidence.context_priority_index.toFixed(4),{'data-testid':'reviewed-source-index',title:'Context fit index; not probability'}));
      const inspect=button('',()=>onSource(proof),{class:'excerpt-text','data-testid':'reviewed-source-inspect','aria-label':'Inspect exact source'});
      inspect.append(node('blockquote',proof.text,{'data-original-text':proof.text}),node('footer',location(proof)));
      if(held){quote.dataset.eligibilityHold='true';quote.append(node('p',evidence.temporal_eligibility_hold.reason,{class:'reviewed-eligibility-warning'}));}
      quote.append(header,inspect,button('Assessment details',()=>sourceDetails(atom,evidence),{class:'quiet'}));
      if(isContext){
        const contextLabel=node('p','F'+(i+1)+' / '+formatText(atom.text),{class:'reviewed-context-fact'});relatedSources.append(contextLabel,quote);
      }else{group.append(quote);visible++;}
      const reference=button(directionLabel[evidence.direction]+' / '+locator(proof),()=>onSource(proof),{class:'reviewed-source-reference',title:proof.document_id});
      (isContext?contextReferences:card).append(reference);
    }
    if(visible||!atom.evidence.length)sources.body.append(group);
    if(contextReferences.children.length>1)card.append(contextReferences);
    results.body.append(card);
  }
  if(relatedMap)map.body.append(relatedMap);
  if(relatedSources)sources.body.append(relatedSources);
  digestSurface(handle,sources,renderVerifiedDigest,onSource);
  map.body.append(node('p','Source links are provenance, not historical graph relations.',{class:'reviewed-source-scope'}));
  audit.body.append(node('p',view.caveat));
  if(view.review_pending_disclosure)audit.body.append(node('p',view.review_pending_disclosure));
  const provenance=node('details');provenance.append(node('summary','Models and immutable source bindings'));
  const models=[...new Set((view.model_provenance||[]).map(p=>p.model))];
  provenance.append(node('p','Assessment and independent review: '+models.join(', ')),node('p','Method: '+view.method_id),node('p','Original native: '+view.original_native_ref.sha256),
    node('p','Original view: '+view.original_view_sha256),node('p','Public view: '+view.sha256));
  audit.body.append(provenance);
  return [hero,facts.outer,map.outer,sources.outer,results.outer,audit.outer];
}

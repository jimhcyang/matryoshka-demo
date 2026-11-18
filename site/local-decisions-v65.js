// The V6.5 reporting supplement never substitutes for the frozen native record.
export const labels={evidence_backed_suggestion:"Evidence-backed suggestion",partial_grounding:"Partial grounding",
  exploratory_contextual:"Exploratory / contextual",incompatible_not_viable:"Incompatible / not viable"};
export function decisionLabel(value,task=value?.task){
  if(task==="hypothesis")return assertionDecision(value,task).label;
  if(task==="reconstruction")return assertionDecision(value,task).label;
  return labels[value?.status]||"New local decision not published";
}

const BACKED="evidence_backed_suggestion",PARTIAL="partial_grounding",CONTEXT="exploratory_contextual";
const rows=value=>Array.isArray(value)?value:[];
const verifiedCurrentRecords=new WeakMap();
const validResourceBinding=value=>value&&typeof value.resource_id==='string'&&value.resource_id.trim()&&
  /^[a-f0-9]{64}$/.test(value.registry_sha256||'')&&/^[a-f0-9]{64}$/.test(value.index_sha256||'');
const CURRENT_ROUTES=new Set(['condition-v6','flow-v6','source-v6','node-v6','native-v6','guide-v6','guide-view-v6','guide-overlay-v63','guide-overlay-v64','origin-v63','cib-pdf','postrun-review']);
export function currentResourceURL(input,binding,base=globalThis.location?.href||'https://matryoshka.invalid/'){
  const url=new URL(input,base),match=/^\/api\/(?:current\/)?([^/]+)$/.exec(url.pathname);
  if(binding==null||!match||!CURRENT_ROUTES.has(match[1]))return url;
  if(url.origin!==new URL(base).origin)throw Error('A current source API must use the local application origin.');
  if(typeof binding.resource_id!=='string'||!binding.resource_id.trim()||
      !/^[a-f0-9]{64}$/.test(binding.registry_sha256||'')||!/^[a-f0-9]{64}$/.test(binding.index_sha256||''))throw Error('Current source resource pins are malformed; no old resource is substituted.');
  for(const key of ['resource_id','registry_sha256','index_sha256']){
    const existing=url.searchParams.getAll(key);
    if(existing.length>1||existing.length===1&&existing[0]!==binding[key])throw Error('Current source resource URL has conflicting pins.');
    url.searchParams.set(key,binding[key]);
  }
  url.pathname='/api/current/'+match[1];return url;
}
export function currentPDFURL(input,{caseId,config,binding}={},base=globalThis.location?.href||'https://matryoshka.invalid/'){
  const url=new URL(input,base);
  if(!/^\/api\/(?:current\/)?cib-pdf$/.test(url.pathname))return url;
  if(binding==null){if(url.pathname.startsWith('/api/current/'))throw Error('A current PDF requires explicit resource pins.');return url;}
  if(typeof caseId!=='string'||!caseId.trim()||caseId.length>240||/[\u0000-\u001f]/.test(caseId)||
      !['llm_readings','llm_atoms','llm_local'].includes(config))throw Error('A current PDF requires the selected case and search method; no default is substituted.');
  for(const [key,value]of Object.entries({case_id:caseId,config})){
    const existing=url.searchParams.getAll(key);
    if(existing.length>1||existing.length===1&&existing[0]!==value)throw Error('The PDF link conflicts with the selected case or search method.');
    url.searchParams.set(key,value);
  }
  return currentResourceURL(url,binding,base);
}
export function currentReportStatusBadge(row,config,verifiedVersion){
  const item=row?.configurations?.[config],task=row?.case?.task;
  if(verifiedVersion!=='current-workbench-publication/1'||row?.current_resource_execution!==true||
      !validResourceBinding(row.resource_binding)||!['hypothesis','reconstruction','redaction'].includes(task)||
      !item||item.config!==config||!/^[a-f0-9]{64}$/.test(item.gate_sha256||'')||
      item.resource_binding&&canonicalGateJSON(item.resource_binding)!==canonicalGateJSON(row.resource_binding))return null;
  const status=item.local_decision_status;
  let value=({evidence_backed_suggestion:{badge:task==='hypothesis'?'SUPPORT':'EVIDENCE',tone:'supported'},
    exploratory_contextual:{badge:'CONTEXT',tone:'unresolved'},partial_grounding:{badge:'PARTIAL',tone:'partial'}})[status];
  if(task==='hypothesis'&&status==='incompatible_not_viable')value={badge:'OPPOSE',tone:'opposed'};
  if(task==='hypothesis'&&status==='mixed_evidence')value={badge:'MIXED',tone:'mixed'};
  return value?{...value,basis:'pinned-overall-status',detail:'Published overall local decision from the verified report. Counts and per-reading details require loading this method; no confidence or correctness is inferred.'}:null;
}
export function verifyCurrentResourceResponse(url,value){
  const parsed=new URL(url,globalThis.location?.href||'https://matryoshka.invalid/');
  if(!parsed.pathname.startsWith('/api/current/'))return value;
  for(const key of ['resource_id','registry_sha256','index_sha256'])if(!parsed.searchParams.get(key)||value?.resource_binding?.[key]!==parsed.searchParams.get(key))
    throw Error('The response does not match the explicitly selected current resource.');
  const binding=canonicalGateJSON(value.resource_binding);
  for(const record of Object.values(value.configurations||{}))if(record&&typeof record==='object')verifiedCurrentRecords.set(record,binding);
  return value;
}
export async function adaptCurrentGuideOverlay(value,guide,{resourceBinding,viewer,resolveNode,resolveHierarchy}={}){
  const packet=guide.packet,scope=packet?.scope;
  const fail=message=>{throw Error('Current guide overlay rejected: '+message);};
  const equal=(a,b)=>a!=null&&b!=null&&canonicalGateJSON(a)===canonicalGateJSON(b);
  const strings=value=>Array.isArray(value)&&value.every(x=>typeof x==='string'&&x)&&new Set(value).size===value.length;
  if(value?.version!=='current-context-inspection/1'||value.lens!=='current_resource_overlay'||!validResourceBinding(resourceBinding)||
      !validResourceBinding(value.resource_binding)||['resource_id','registry_sha256','index_sha256'].some(k=>value.resource_binding[k]!==resourceBinding[k])||
      !equal(value.resource_binding,packet?.resource_binding)||!equal(value.browser_binding,value.resource_binding)||
      !equal(value.study_binding,packet?.graph_binding)||!equal(value.binding,value.study_binding)||
      !equal(value.scope?.binding,value.study_binding))fail('resource pins or selected context differ');
  if(value.browser_binding.graph_id!==viewer?.graph_run_id||value.browser_binding.hierarchy_id!==viewer?.hierarchy_run_id||
      value.study_binding?.graph_id!==viewer?.graph_run_id||value.study_binding?.hierarchy_id!==viewer?.hierarchy_run_id)fail('loaded current graph/hierarchy differs');
  if(value.case_id!==packet.case_id||value.corpus!==packet.corpus||value.scope?.strictly_before!==scope?.strictly_before||
      value.scope?.whole_origin_excluded!==scope?.whole_origin_excluded||!scope?.strictly_before||!scope?.whole_origin_excluded)fail('case or strict source boundary differs');
  if(value.topology_replaced!==false||value.browser_export_verified!==false||value.layout_coordinates_reused!==false||
      value.browser_layout_comparison!=='NOT_PERFORMED'||value.native_source_graph_matches_selected_context!==true||
      value.membership_is_factual!==false||value.guidance_is_entailment!==false||value.saved_kernel_walk_reverified!==false||
      !Array.isArray(value.verified_browser_edges)||value.verified_browser_edges.length)fail('unverified browser edges cannot become certified');
  if(!strings(value.eligible_ids)||!strings(value.eligible_group_ids)||!strings(value.eligible_document_ids)||
      !Array.isArray(value.endpoint_mappings)||value.endpoint_mappings.length!==guide.nodes.length||
      !Array.isArray(value.connections)||value.connections.length!==(guide.lexical?0:guide.hops.length))fail('invalid source/mapping inventory');
  const eligible=new Set(value.eligible_ids),groups=new Set(value.eligible_group_ids),documents=new Set(value.eligible_document_ids);
  function proof(p){
    if(!p?.canonical_page_id||!documents.has(p.document_id)||!(p.date<scope.strictly_before)||p.document_id===scope.whole_origin_excluded||
        !/^[a-f0-9]{64}$/.test(p.page_sha256||'')||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end<=p.start||
        typeof p.text!=='string'||Array.from(p.text).length!==p.end-p.start)fail('source quotation lacks exact eligible bounds');
  }
  const mappings=[];
  for(const [i,m] of value.endpoint_mappings.entries()){
    if(m.native_id!==guide.nodes[i].id||m.label_join_used!==false)fail('native ID changed or a label join was attempted');
    if(guide.lexical){if(m.browser_id!==null||m.status!=='READOUT_NOT_A_GRAPH_STATE')fail('readout cannot become a graph identity');mappings.push({...m,current_mapping:true,reason:'Source readout, not a graph state'});continue;}
    const prefix=/^hierarchy:(domain|theme|community):(.+)$/.exec(m.native_id);
    let record;
    if(prefix){
      if(m.status!=='EXACT_CURRENT_HIERARCHY_ID'||m.browser_id!==prefix[2]||!groups.has(m.browser_id)||typeof resolveHierarchy!=='function')fail('hierarchy prefix does not bind exact current membership');
      record=await resolveHierarchy(prefix[1],m.browser_id);
      if(record&&(record.id!==m.browser_id||String(record.type).toLowerCase()!==prefix[1]))fail('known hierarchy ID/type differs');
    }else{
      if(m.status!=='EXACT_BOUND_NODE_ID_WITH_ELIGIBLE_SOURCE'||m.browser_id!==m.native_id||!eligible.has(m.native_id)||
          !Array.isArray(m.source_citations)||!m.source_citations.length||typeof resolveNode!=='function')fail('semantic identity is not exact and source-bound');
      m.source_citations.forEach(proof);record=await resolveNode(m.browser_id);
      if(record&&record.id!==m.native_id)fail('browser ID substitution is forbidden');
      if(record&&guide.nodes[i].type&&String(record.type).toLowerCase()!==String(guide.nodes[i].type).toLowerCase())fail('exact node type differs');
      const parent=/^hierarchy:(domain|theme|community):(.+)$/.exec(guide.nodes[i].parent_id||'');
      if(record&&parent&&record[parent[1]+'_id']!==parent[2])fail('exact source/browser membership differs');
    }
    mappings.push({...m,current_mapping:true,...(prefix?{level:prefix[1]}:{}),browser_id:record?m.browser_id:null,
      reason:record?'Exact known current ID; not a label remap':'Exact source ID absent from the loaded current map; no substitute inserted',
      browser_membership:record?Object.fromEntries(['domain_id','theme_id','community_id'].map(k=>[k,record[k]||null])):null});
  }
  value.connections.forEach((connection,i)=>{
    const hop=guide.hops[i];
    if(connection.native_source!==hop.source||connection.native_target!==hop.target||connection.kind!==hop.kind||
        connection.native_source_verified!==true||connection.browser_edge_verified!==false||
        !Array.isArray(connection.browser_edge_ids)||connection.browser_edge_ids.length||
        connection.browser_edge_proofs!=null&&(!Array.isArray(connection.browser_edge_proofs)||connection.browser_edge_proofs.length))fail('uncertified browser-edge correspondence claimed');
    for(const p of connection.citations||[])proof(p);
  });
  return {...value,endpoint_mappings:mappings,eligible,groups,documents,edges:new Map()};
}
export function presentationTitle(row={}){
  const supplied=[row.presentation_title,row.display_title,row.case?.title,row.case?.query]
    .find(value=>typeof value==="string"&&value.trim());
  const words=(supplied||"Saved question").replace(/\[(?:REDACTED|REDACTION[^\]]*|MASK)\]/gi,"masked passage").trim().split(/\s+/);
  return words.slice(0,5).join(" ")+(words.length>5?"...":"");
}
export function readingExplanation(reading={}, {local=false}={}){
  if(!local)return reading.explanation||reading.notes||'No saved interpretation explanation was published.';
  const quote=value=>typeof value==='string'&&value.trim()?JSON.stringify(value):null;
  const attachment=quote(reading.attachment_quote),cue=quote(reading.kind_cue_quote);
  const number=({singular:'singular ',plural:'plural '})[reading.grammatical_number]||'';
  const kind=({person:"person's",organization:"organization's",location:"place's"})[reading.target_kind];
  let text;
  if(reading.form==='possessive'){
    text=`A ${number}${kind?kind+' ':''}possessive phrase could modify ${attachment||'the nearby visible expression'}.`;
    if(cue)text+=` Nearby ${cue} is a grammatical clue, not a resolved reference.`;
    if(!kind)text+=" The possessor's kind and identity remain open.";
  }else if(reading.form==='unknown'){
    text='The visible grammar does not determine a safe interpretation of this missing span.';
  }else{
    const form=({nominal:'noun phrase',modifier:'modifier',adjectival:'adjective phrase',verbal:'verb phrase',finite_clause:'finite clause',clausal:'clause',member_example:'member or example phrase'})[reading.form]||'phrase';
    const role=({actor_argument:'fill the grammatical subject position',patient_argument:'fill the grammatical object or passive-subject position',recipient_argument:'fill the recipient position',prepositional_argument:'complete a prepositional phrase',quoted_characterization:'supply a quoted characterization',verbal_bridge:'complete the nearby verbal expression',member_example:'give a member of the visible class'})[reading.role];
    text=`A ${number}${form} could ${role||'fit the visible grammatical boundaries'}${attachment?' near '+attachment:''}.`;
  }
  return text+' This is a grammatical possibility, not an identified answer or evidence of the underlying claim.';
}
export function hasRequestedAnalystDigest(value){
  return value!=null&&value!=="NOT_REQUESTED"&&value.status!=="NOT_REQUESTED";
}
export function isCounterhypothesis(task,kind){
  return task==="hypothesis"&&typeof kind==="string"&&
    (/^SYNTHETIC_ANALYST_COUNTERHYPOTHESIS(?:_|$)/.test(kind)||kind.startsWith("ANALYST_ALTERNATIVE_"));
}
export function assertionDecision(unit,task){
  if(!unit)return {kind:"unresolved",label:"Unresolved"};
  if(task==="reconstruction"){
    if(unit.counterevidence)return {kind:"conflict",label:"Conflicting evidence"};
    if(unit.status===BACKED&&unit.coverage==="Established")return {kind:"supported",label:"Evidence-backed reconstruction"};
    if(unit.coverage==="Partial"||unit.coverage==="Established")return {kind:"partial",label:"Partial"};
    return {kind:"unresolved",label:"Insufficient"};
  }
  if(unit.counterevidence){
    const support=unit.support_present===true||unit.coverage==="Established"||rows(unit.requirements).some(f=>rows(f.evidence).some(e=>e.direction==="Support"));
    return unit.decisive_counter===true||!support?{kind:"opposed",label:"Opposed"}:{kind:"mixed",label:"Conflicting witnesses"};
  }
  if(unit.status===BACKED)return {kind:"supported",label:"Supported"};
  if(unit.status===PARTIAL)return {kind:"partial",label:"Partial evidence"};
  const context=rows(unit.requirements).some(f=>rows(f.context_citations).length)||rows(unit.source_pages_checked).length;
  if(unit.status===CONTEXT&&context)return {kind:"context",label:"Context"};
  return {kind:"unresolved",label:"Unresolved"};
}

export function hypothesisReadout(record={},caseInfo={}){
  if(caseInfo.task!=="hypothesis")return null;
  const summary=verdictSummary(record,caseInfo);
  if(!summary.available)return null;
  const supported=summary.counts.supported||0,opposed=summary.counts.opposed||0;
  const unresolved=summary.total-supported-opposed;
  const resolution={id:"hypothesis_resolution",state:unresolved?"missing":"resolved",label:"Required assertions resolved",
    detail:`${supported} supported, ${opposed} opposed; ${unresolved} of ${summary.total} remain unresolved or mixed. Opposition is a resolved evidence decision, not positive support.`};
  const original=rows(summary.overall?.checklist),checks=original.map(check=>check.id==="required_units"?resolution:check);
  if(!original.some(check=>check.id==="required_units"))checks.unshift(resolution);
  const otherFailures=original.some(check=>check.id!=="required_units"&&check.state!=="pass");
  return {supported,opposed,unresolved,total:summary.total,checks,otherFailures,
    detail:`${supported+opposed}/${summary.total} required assertions resolved by eligible evidence. ${unresolved} unresolved or mixed remaining.`,
    guidance:otherFailures?"Whole-query or source checks still have gaps. Resolved assertions do not repair those separate coverage failures.":
      unresolved?"Resolve only the remaining assertions with eligible evidence. Already opposed assertions are not missing positive support.":
      "No required assertion remains unresolved. Opposing evidence does not establish the positive claim or imply the truth of an embedded event."};
}

// A display projection only: never mutate the gate or replace it with native
// scores, source co-occurrence, answer keys, or independent review judgments.
export function verdictSummary(record={},caseInfo={},reading=""){
  const task=caseInfo.task,packet=record.local_decisions_v65;
  const unavailable={available:false,task,title:"Evidence decision unavailable",detail:"No bound evidence decision has been supplied.",units:[],counts:{},total:0,badge:"NOT LOADED",tone:"unresolved",recommendation:null};
  if(!packet)return unavailable;
  const counts={},units=[];
  let recommendation=null,overall=overviewFor(packet,task,reading);
  if(task==="redaction"){
    const entry=rows((record.result?.redaction||record.result)?.readings).find(r=>r.reading?.id===reading);
    if(!entry)return {...unavailable,detail:"No saved candidates for this reading."};
    for(const [index,item] of rows(entry.candidates).entries()){
      const unit=packet.candidates?.[item.id];
      const bound=unit&&unit.reading_id===reading?unit:null;
      const kind=bound?.status===BACKED?"supported":bound?.status===PARTIAL?"partial":bound?.status===CONTEXT?"context":bound?.status==="incompatible_not_viable"?"incompatible":"unresolved";
      counts[kind]=(counts[kind]||0)+1;
      units.push({id:item.id,text:item.fill,rank:index+1,kind,label:kind==="supported"?"Evidence-backed fill":kind==="partial"?"Partial":kind==="context"?"Corpus context":kind==="incompatible"?"Not viable":"Unresolved",unit:bound});
      if(!recommendation&&kind==="supported")recommendation={id:item.id,text:item.fill,rank:index+1,scope:bound.scope};
    }
    const total=units.length;
    return {available:true,task,reading,units,counts,total,recommendation,overall,
      title:recommendation?"Evidence-backed fill":"Abstain",tone:recommendation?"supported":counts.partial?"partial":"unresolved",
      detail:recommendation?`Recommend the highest-ranked backed candidate in this reading (saved rank ${recommendation.rank}). This supports only the focal contribution, not the surrounding event or hidden-answer correctness.`:counts.partial?"Partial evidence does not meet the complete-evidence checks. Do not fill the hidden span.":counts.context?"Corpus context is available, but no candidate passes the evidence checks. Do not fill the hidden span.":"No candidate passes the evidence checks. Do not fill the hidden span.",
      badge:redSidebar(counts,total).badge};
  }
  const planned=rows(record.plan?.atoms),fallback=Object.values(packet.atoms||{});
  const required=(planned.length?planned:fallback).filter(a=>a.required!==false);
  if(!required.length||new Set(required.map(a=>a.id)).size!==required.length)return {...unavailable,detail:"Required assertions are absent or ambiguous; no coverage count is invented."};
  for(const atom of required){
    const unit=packet.atoms?.[atom.id]||null,status=assertionDecision(unit,task);
    counts[status.kind]=(counts[status.kind]||0)+1;
    units.push({id:atom.id,text:atom.text||unit?.text||atom.id,...status,unit});
  }
  const total=units.length,complete=overall?.status===BACKED&&counts.supported===total;
  const opposed=counts.opposed||0,mixed=counts.mixed||0,crossMixed=overall?.status==='mixed_evidence'&&counts.supported>0&&opposed>0;
  let title,detail,tone;
  if(task==="reconstruction"){
    title=complete?"Evidence-backed reconstruction":counts.conflict?"Conflicting reconstruction":counts.supported||counts.partial?"Partial reconstruction":"Insufficient evidence";
    detail=complete?"All recorded required assertions pass the scoped evidence checks. Additional chronology or causal claims are not implied.":`${counts.supported||0} of ${total} required assertions are evidence-backed. Reconstruct only those components; do not join unresolved details into a complete account.`;
    tone=complete?"supported":counts.conflict?"opposed":"partial";
  }else{
    title=crossMixed?"Mixed across assertions":opposed?(opposed===total?"Opposed by eligible evidence":"Partial opposition"):
      mixed?"Conflicting witnesses":complete?"Supported by eligible evidence":counts.supported||counts.partial?"Partial support":counts.context?"Context only":"Unresolved";
    detail=crossMixed?`${counts.supported} supported, ${opposed} opposed; ${total-counts.supported-opposed} unresolved or conflicted. Different required assertions have different evidence outcomes; this is not witness disagreement on one assertion.`:complete?"Every recorded required assertion passes the scoped evidence checks. This is not broader historical confirmation.":opposed?`${opposed} of ${total} required assertions have explicit opposing evidence. Missing evidence is not opposition.`:`${counts.supported||0} of ${total} required assertions are supported. Related context and partial evidence do not establish the whole hypothesis.`;
    if(!crossMixed&&!opposed&&counts.partial)detail=`${counts.supported||0} fully supported, ${counts.partial} partial; ${total-(counts.supported||0)-counts.partial} unresolved or contextual. Partial evidence does not establish a complete assertion or the whole hypothesis.`;
    tone=crossMixed?"mixed":opposed?"opposed":complete?"supported":mixed?"mixed":counts.supported||counts.partial?"partial":"unresolved";
  }
  if(!complete&&counts.supported===total)detail="All recorded assertions have evidence, but the overall source or whole-query coverage checks do not pass. Omitted chronology, conditions or attributions must not be inferred.";
  return {available:true,task,units,counts,total,overall,recommendation:null,title,detail,tone,
    badge:assertionSidebar(task,counts,total,overall?.status).badge};
}

function assertionSidebar(task,counts,total,overallStatus){
  if(task==="reconstruction")return {badge:`R ${counts.supported||0}/${total}`,tone:counts.conflict?"opposed":counts.supported===total?"supported":"partial"};
  if(overallStatus==='mixed_evidence'&&counts.supported>0&&counts.opposed>0)return {badge:`MIXED ${counts.supported}S/${counts.opposed}O/${total-counts.supported-counts.opposed}U`,tone:'mixed'};
  const kind=counts.opposed?"opposed":counts.mixed?"mixed":counts.supported?"supported":counts.partial?"partial":counts.context?"context":"unresolved";
  const label={opposed:"OPPOSE",mixed:"CONFLICT",supported:"SUPPORT",partial:"PARTIAL",context:"CONTEXT",unresolved:"UNRESOLVED"}[kind];
  return {badge:`${label} ${kind==="unresolved"?(counts.unresolved||0)+(counts.partial||0):counts[kind]}/${total}`,tone:kind==="context"?"unresolved":kind};
}
function redSidebar(counts,total){
  const kind=counts.supported?"supported":counts.partial?"partial":counts.context?"context":"unresolved";
  const label={supported:"EVIDENCE",partial:"PARTIAL",context:"CONTEXT",unresolved:"INSUFFICIENT"}[kind];
  return {badge:`${label} ${kind==="unresolved"?0:counts[kind]}/${total}`,tone:kind==="supported"?"supported":kind==="partial"?"partial":"unresolved"};
}
export function preferredReading(record={},caseInfo={}){
  const entries=rows((record.result?.redaction||record.result)?.readings);
  let best="",count=-1;
  for(const entry of entries){
    const id=entry.reading?.id;if(!id)continue;
    const backed=verdictSummary(record,{...caseInfo,task:"redaction"},id).counts.supported||0;
    if(backed>count){best=id;count=backed;}
  }
  return best;
}

const SUMMARY_VERSION="workbench-decision-summary/1";
const ASSERTION_COUNTS=["supported","opposed","partial","context","mixed","unresolved","conflict"];
const READING_COUNTS=["backed","partial","context","incompatible","unresolved"];
function checkedCounts(value,keys,totalKey){
  if(!value||keys.concat(totalKey).some(k=>!Number.isSafeInteger(value[k])||value[k]<0)||keys.reduce((n,k)=>n+value[k],0)!==value[totalKey])throw Error("Sidebar decision counts are malformed.");
}
export function sidebarDecisionSummary(value,caseInfo={},config,reading=""){
  if(!value||value.version!==SUMMARY_VERSION||value.case_id!==caseInfo.case_id||value.task!==caseInfo.task||value.config!==config||
    !/^[a-f0-9]{64}$/.test(value.query_sha256||"")||!/^[a-f0-9]{64}$/.test(value.gate_sha256||"")||
    typeof value.native_run_id!=="string"||!value.native_run_id||value.native_checksum==null||
    value.overall_status!==null&&typeof value.overall_status!=="string")throw Error("Sidebar decision has another case, method or provenance binding.");
  if(value.task!=="redaction"){
    if(!["hypothesis","reconstruction"].includes(value.task))throw Error("Unsupported sidebar task.");
    checkedCounts(value.counts,ASSERTION_COUNTS,"required");
    if(value.counts.required===0)throw Error("No required assertions are declared.");
    if(value.task==="reconstruction"&&["opposed","mixed","context"].some(k=>value.counts[k]!==0)||value.task==="hypothesis"&&value.counts.conflict!==0)throw Error("Sidebar categories belong to another task.");
    const result=assertionSidebar(value.task,value.counts,value.counts.required,value.overall_status);
    const complete=value.overall_status===BACKED&&value.counts.supported===value.counts.required;
    result.tone=value.task==="reconstruction"?(value.counts.conflict?"opposed":complete?"supported":"partial"):
      value.overall_status==='mixed_evidence'&&value.counts.supported>0&&value.counts.opposed>0?"mixed":value.counts.opposed?"opposed":value.counts.mixed?"mixed":complete?"supported":value.counts.supported||value.counts.partial?"partial":"unresolved";
    return {...result,available:true,detail:"Required assertions only; derived from the exact saved evidence checks."};
  }
  const order=value.reading_order;
  if(!Array.isArray(order)||order.some(id=>typeof id!=="string"||!id)||new Set(order).size!==order.length||!value.readings||Object.keys(value.readings).length!==order.length)throw Error("Sidebar reading order is malformed.");
  let best=null,backed=-1;
  for(const id of order){
    const r=Object.hasOwn(value.readings,id)?value.readings[id]:null;
    checkedCounts(r,READING_COUNTS,"candidate_count");
    if(r.backed===0?(r.recommendation_candidate_id!==null||r.recommendation_rank!==null):
      (typeof r.recommendation_candidate_id!=="string"||!r.recommendation_candidate_id||!Number.isSafeInteger(r.recommendation_rank)||r.recommendation_rank<1||r.recommendation_rank>r.candidate_count))throw Error("Sidebar recommendation is not bound to a backed candidate.");
    if(r.backed>backed){best=id;backed=r.backed;}
  }
  if(value.default_reading_id!==best)throw Error("Sidebar reading default does not follow the deterministic evidence-count rule.");
  const selected=order.includes(reading)?reading:best,r=value.readings[selected];
  return {...redSidebar(r?{supported:r.backed,partial:r.partial,context:r.context}:{},r?.candidate_count||0),available:true,reading:selected,
    detail:r?.backed?`First backed fill is saved rank ${r.recommendation_rank}; candidates are not reordered.`:"No backed fill in this reading. Corpus recommendation abstains."};
}
async function jsonDigest(value){
  const bytes=new TextEncoder().encode(canonicalGateJSON(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
}
// Reference materializer for a loaded packet; never fetches other cases.
export async function decisionSummaryFor(record={},caseInfo={},verifiedBinding){
  const packet=packetFor(record,caseInfo,verifiedBinding);if(!packet)return null;
  if(packet.query_sha256!==await jsonDigest(caseInfo.query)||packet.binding.query_sha256!==packet.query_sha256)throw Error("Sidebar decision belongs to another query.");
  const value={version:SUMMARY_VERSION,case_id:caseInfo.case_id,task:caseInfo.task,config:record.config,
    query_sha256:packet.query_sha256,gate_sha256:await jsonDigest(packet),native_run_id:packet.binding.native_run_id,
    native_checksum:packet.binding.native_checksum,overall_status:packet.overall?.status??null};
  if(caseInfo.task==="redaction"){
    value.reading_order=rows((record.result?.redaction||record.result)?.readings).map(r=>r.reading?.id);
    value.default_reading_id=preferredReading(record,caseInfo)||null;value.readings=Object.create(null);
    for(const id of value.reading_order){
      const s=verdictSummary(record,caseInfo,id);
      value.readings[id]={candidate_count:s.total,backed:s.counts.supported||0,
        ...Object.fromEntries(READING_COUNTS.filter(k=>k!=="backed").map(k=>[k,s.counts[k]||0])),
        recommendation_candidate_id:s.recommendation?.id??null,recommendation_rank:s.recommendation?.rank??null};
    }
  }else{
    const s=verdictSummary(record,caseInfo);if(!s.available)return null;
    value.counts={required:s.total,...Object.fromEntries(ASSERTION_COUNTS.map(k=>[k,s.counts[k]||0]))};
  }
  sidebarDecisionSummary(value,caseInfo,record.config);
  return value;
}

export function exactOriginAnchors(data){
  const source=data.full_transcription||data,text=source.text,chars=Array.from(text),whole=data.text;
  const supplied=source.query_anchors||source.anchors||[];
  const valid=[];
  for(const a of supplied){
    if(!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<0||a.end<=a.start||a.end>chars.length||chars.slice(a.start,a.end).join("")!==a.text)throw Error("The exact origin span does not replay.");
    // A legacy whole-page proof is not a precise birth-of-query highlight.
    if(a.text===whole||a.start===0&&a.end===chars.length)continue;
    valid.push({start:a.start,end:a.end,text:a.text});
  }
  // Rephrased and negative analyst questions are never searched in the source;
  // only the source-proof's recorded birth quotations can supply highlights.
  const sorted=valid.sort((a,b)=>a.start-b.start||b.end-a.end),result=[];
  for(const a of sorted){const last=result.at(-1);if(last&&a.start<last.end){if(a.end<=last.end)continue;throw Error("Origin highlight spans overlap ambiguously.");}result.push(a);}
  return result;
}
export function packetFor(record={},caseInfo={},verifiedBinding){
  const packet=record.local_decisions_v65;
  if(!packet)return null;
  const legacy=String(packet.version||'').startsWith('local-evidence-sufficiency/6.5');
  if(!legacy){
    const verified=verifiedBinding===undefined?verifiedCurrentRecords.get(record):validResourceBinding(verifiedBinding)?canonicalGateJSON(verifiedBinding):null;
    if(packet.version!=='current-evidence-decision/1'||record.current_resource_execution!==true||!validResourceBinding(packet.resource_binding)||
        !verified||canonicalGateJSON(packet.resource_binding)!==verified||
        record.resource_binding!=null&&canonicalGateJSON(record.resource_binding)!==verified)
      throw Error('The current decision requires an explicitly verified matching resource binding; unsupported provenance is not substituted.');
  }
  if(packet.derived!==true||packet.frozen_native_unchanged!==true||packet.keys_read!==false||packet.grades_read!==false||packet.model_calls!==0)
    throw Error("The decision supplement has an unsupported provenance contract.");
  if(packet.case_id!==caseInfo.case_id||packet.binding?.case_id!==caseInfo.case_id||packet.config!==record.config||packet.binding?.config!==record.config)
    throw Error("The V6.5 decision supplement belongs to another case or condition.");
  if(packet.binding?.native_run_id!==record.run_id||JSON.stringify(packet.binding?.native_checksum)!==JSON.stringify(record.native_checksum))
    throw Error("The V6.5 decision supplement has another native-record binding.");
  return packet;
}
export function unitFor(packet,item,task){return (task==="redaction"?packet?.candidates:packet?.atoms)?.[task==="redaction"?item?.id:item?.atom_id||item?.id]||null;}
export function overviewFor(packet,task,reading){return task==="redaction"?packet?.reading_overviews?.[reading]||null:packet?.overall||null;}
export const reviewDisclosure="The saved LLM reviewed the original candidate/raw-quote packet and frozen native decision, not the new V6.5 gate. No new model review is implied.";
export const guideDisclosure="Evidence checks explain source support; they do not add graph links or change the saved search.";
export function canonicalGateJSON(value){
  const encode=v=>Array.isArray(v)?"["+v.map(encode).join(",")+"]":v&&typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+encode(v[k])).join(",")+"}":JSON.stringify(v);
  return encode(value).replace(/[\u007f-\uffff]/g,char=>"\\u"+char.charCodeAt(0).toString(16).padStart(4,"0"));
}
export async function exactGateReview(record={},gate){
  if(gate?.version==='current-evidence-decision/1')return {status:'pending'};
  const value=record.local_decision_assessment_v65;
  if(!gate||!value||value.status==="PENDING"||!Array.isArray(value.grades)||!value.grades.length)return {status:"pending"};
  const bytes=new TextEncoder().encode(canonicalGateJSON(gate)),hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
  if(value.version!=="post-run-local-decision-assessment/6.5.4"||value.gate_sha256!==hash||value.used_for_inference!==false||value.old_native_grades_used!==false||value.source_only_method_blinded!==true)
    return {status:"unavailable",reason:"The new review does not bind this exact displayed decision packet."};
  for(const row of value.grades){
    const unit=gate.atoms?.[row.decision_id]||gate.candidates?.[row.decision_id];
    if(row.case_id!==gate.case_id||row.config!==gate.config||row.grade?.id!==row.item_id||!["component","overall"].includes(row.scope)||row.scope==="overall"&&row.decision_id!=null||row.scope==="component"&&(!unit||row.reading_id!=null&&unit.reading_id!==row.reading_id))
      return {status:"unavailable",reason:"A new-review item belongs to another case, condition or component."};
  }
  return {status:"complete",gate_sha256:hash,version:value.version,grades:value.grades};
}
export function presentationDecisionReview(record={}){
  const value=record.presentation_decision_assessment;
  if(!value||value.status==="PENDING")return {status:"pending"};
  const gate=record.local_decisions_v65,commitment=record.presentation_gate_commitment;
  const unavailable={status:"unavailable",reason:"This opinion attachment does not match the displayed evidence decision. No other review is substituted."};
  // Both hashes are the producer's Python encoding. Do not rehash the packet
  // with JavaScript's different integral-float/exponent serialization.
  if(!gate||!commitment||value.version!=="sealed-presentation-decision-assessment/1"||
      commitment.hash_encoding!=="python-json-sorted-ascii-compact/1"||
      !/^[a-f0-9]{64}$/.test(value.gate_sha256||"")||value.gate_sha256!==commitment.gate_content_sha256||
      value.gate_version!==gate.version||commitment.gate_version!==gate.version||
      value.used_for_inference!==false||value.old_native_grades_used!==false||
      value.source_only_assessment!==true||value.method_blinded!==true||
      !Array.isArray(value.grades)||!value.grades.length)return unavailable;
  const seen=new Set();
  for(const row of value.grades){
    const unit=gate.atoms?.[row.decision_id]||gate.candidates?.[row.decision_id];
    if(row.case_id!==gate.case_id||row.config!==record.config||row.grade?.id!==row.item_id||
        !["component","overall"].includes(row.scope)||seen.has(row.item_id)||
        row.scope==="overall"&&row.decision_id!=null||row.scope==="component"&&(!unit||row.reading_id!=null&&unit.reading_id!==row.reading_id))return unavailable;
    seen.add(row.item_id);
  }
  return {status:"verified",gate_sha256:value.gate_sha256,gate_version:value.gate_version,
    source_only_assessment:true,method_blinded:true,grades:value.grades,assessment_ref:value.assessment_ref};
}
// Labels and scope follow Herschel's V65 route-sidecar contract.
export function routeProvenance(route={}){
  if(route.route_kind==="LEXICAL_SOURCE_READOUT")return {label:"Source readout",note:"Document and quote readout, not a numerical KG walk."};
  if(route.derived_witness===true||route.route_kind==="DERIVED_BOUNDED_PROJECTION_WITNESS")return {label:"Derived projection witness",note:"Selected from actual bounded projection edges and the bound native kernel. Not a native-saved witness or a correctness probability."};
  if(route.native_witness===true)return {label:"Native-saved witness",note:"The unchanged complete native-saved sequence; presentation selection does not change its rank or support."};
  return {label:"Saved positive walk",note:"An existing positive finite walk, not a newly derived path or a correctness probability."};
}

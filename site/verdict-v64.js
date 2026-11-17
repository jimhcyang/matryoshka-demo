// Presentation of recorded fields only. No acceptance policy or score cutoff is inferred.
export function direction(value) {
  const raw=String(value??"").trim().toUpperCase();
  return ({SUPPORT:"Support",SUPPORTED:"Support",FOR:"Support",COUNTER:"Counterevidence",CONTRADICTED:"Counterevidence",AGAINST:"Counterevidence",
    PARTIAL:"Partial",SOME:"Partial","PARTIAL EVIDENCE":"Partial","PARTIAL / DIRECTION UNESTABLISHED":"Partial",MIXED:"Support + Counterevidence",CONFLICT:"Support + Counterevidence",
    "FOR + AGAINST":"Support + Counterevidence",INSUFFICIENT:"Unresolved",UNSUPPORTED:"Unresolved",MISSING:"Unresolved",UNRESOLVED:"Unresolved",
    INFERRED:"Unresolved","CONTEXTUAL INFERENCE":"Unresolved",RELATED:"Context only",BACKGROUND:"Context only",CONTEXT:"Context only"})[raw]||"Not recorded";
}
export function displayText(value) {
  if(value===true)return "Yes";if(value===false)return "No";
  if(value==null||value===""||typeof value==="object")return "Not recorded";
  return String(value).replace(/\b(?:SUPPORTED|SUPPORT|FOR)\b/g,"Support").replace(/\b(?:COUNTER|CONTRADICTED|AGAINST)\b/g,"Counterevidence")
    .replace(/\b(?:PARTIAL|SOME)\b/g,"Partial").replace(/\b(?:UNSUPPORTED|INSUFFICIENT|UNRESOLVED)\b/g,"Unresolved").replaceAll("_"," ");
}
export function coverage(value) {
  return ({Support:"Established",Partial:"Partial",Unresolved:"Missing"})[direction(value)]||null;
}
export function localTaskVerdict(task,result={}) {
  const raw=result.native_verdict??result.status;
  if(task!=="reconstruction")return direction(raw);
  return ({COMPLETE:"Complete reconstruction",PARTIAL:"Partial reconstruction",INSUFFICIENT:"Unresolved reconstruction",MISSING:"Unresolved reconstruction"})[String(raw||"").toUpperCase()]||displayText(raw);
}
export function factual(candidate={}) {
  const support=candidate.support_assessment||{},dims=candidate.support_dimensions||{};
  const raw=support.factual_status??dims.factual??dims.claim_support??support.status??support.label??candidate.disposition?.evidence_label;
  let label=direction(raw);
  if(label==="Not recorded"){
    if(support.substantive_support===true)label="Support";
    else if(support.same_scoped_counterevidence===true)label="Counterevidence";
    else if(support.partial_clue===true)label="Partial";
  }
  const detail=String(candidate.disposition?.evidence_label||dims.factual||support.label||"");
  return {label,detail:/infer|context/i.test(detail)?"Contextual inference / claim not established":"",raw};
}
export function feasibility(candidate={}) {
  const checks=[];
  const status=candidate.candidate_feasibility?.status;
  if(status!=null)checks.push({field:"candidate_feasibility.status",value:status,
    passed:status==="FEASIBLE"?true:status==="INFEASIBLE"?false:null});
  if(typeof candidate.disposition?.feasible==="boolean")checks.push({field:"disposition.feasible",value:candidate.disposition.feasible,passed:candidate.disposition.feasible});
  for(const field of ["grammar_admission","v21_joint_fit"])if(typeof candidate[field]?.admissible==="boolean")checks.push({field:field+".admissible",value:candidate[field].admissible,passed:candidate[field].admissible});
  const conflict=checks.some(c=>c.passed===true)&&checks.some(c=>c.passed===false);
  const declared=checks.find(c=>["candidate_feasibility.status","disposition.feasible"].includes(c.field));
  return {label:conflict?"Recorded fit fields disagree":declared?(declared.passed===true?"Feasible":declared.passed===false?"Not feasible":displayText(declared.value)):"Feasibility not recorded",
    checks,conflict,recorded:!!declared};
}
export function localDecisions(record={}) {
  const rows=[];
  for(const [field,label] of [["accepted","Acceptance"],["rejected","Rejection"],["recommended","Recommendation"],["local_acceptance","Acceptance"],["local_recommendation","Recommendation"],["local_decision","Decision"]]){
    if(!Object.hasOwn(record,field)||record[field]==null)continue;
    const value=record[field];
    if(["boolean","string","number"].includes(typeof value))rows.push({field,label,value:displayText(value)});
    else if(typeof value==="object"){
      if(value.status!=null)rows.push({field:field+".status",label,value:displayText(value.status)});
      for(const key of ["accepted","rejected","recommended"])if(typeof value[key]==="boolean")rows.push({field:field+"."+key,label:key==="accepted"?"Acceptance":key==="rejected"?"Rejection":"Recommendation",value:displayText(value[key])});
    }
  }
  return rows;
}
export function selectionSummary(record={}) {
  const rows=localDecisions(record);
  return rows.length?rows.map(row=>`${row.label}: ${row.value} (recorded)`).join("; "):"Acceptance / recommendation not recorded";
}
export function correctness(value) {
  return ({correct:"Correct",partial:"Partially correct",incorrect:"Incorrect",wrong:"Incorrect",uncertain:"Uncertain",not_applicable:"Not applicable"})[String(value||"").toLowerCase()]||displayText(value);
}
export function llmReview(item={},task) {
  const assessment=item.assessment;
  if(!assessment||typeof assessment!=="object")return {recorded:false,summary:"LLM review not published"};
  return {recorded:true,summary:task==="redaction"?correctness(assessment.answer_match):displayText(assessment.judgment),
    correctness:task==="redaction"?correctness(assessment.answer_match):"Not applicable to this task",
    evidence:displayText(assessment.evidence_support),grammar:displayText(assessment.grammatical),explanation:displayText(assessment.explanation)};
}

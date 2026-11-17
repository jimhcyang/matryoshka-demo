// The V6.5 reporting supplement never substitutes for the frozen native record.
export const labels={evidence_backed_suggestion:"Evidence-backed suggestion",partial_grounding:"Partial grounding",
  exploratory_contextual:"Exploratory / contextual",incompatible_not_viable:"Incompatible / not viable"};
export function decisionLabel(value,task=value?.task){
  if(value?.counterevidence&&task==="hypothesis")return value.decisive_counter===true?"Opposed by eligible evidence":(value.mixed_evidence??value.support_present)?"Mixed eligible evidence":"Opposed by eligible evidence";
  if(value?.counterevidence&&task==="reconstruction")return value.is_overall?"Conflicting reconstruction component":"Conflicting component";
  return labels[value?.status]||"New local decision not published";
}
export function packetFor(record={},caseInfo={}){
  const packet=record.local_decisions_v65;
  if(!packet)return null;
  if(!String(packet.version||"").startsWith("local-evidence-sufficiency/6.5")||packet.derived!==true||packet.frozen_native_unchanged!==true||packet.keys_read!==false||packet.grades_read!==false||packet.model_calls!==0)
    throw Error("The V6.5 decision supplement has an unsupported provenance contract.");
  if(packet.case_id!==caseInfo.case_id||packet.binding?.case_id!==caseInfo.case_id||packet.config!==record.config||packet.binding?.config!==record.config)
    throw Error("The V6.5 decision supplement belongs to another case or condition.");
  if(packet.binding?.native_run_id!==record.run_id||JSON.stringify(packet.binding?.native_checksum)!==JSON.stringify(record.native_checksum))
    throw Error("The V6.5 decision supplement has another native-record binding.");
  return packet;
}
export function unitFor(packet,item,task){return (task==="redaction"?packet?.candidates:packet?.atoms)?.[task==="redaction"?item?.id:item?.atom_id||item?.id]||null;}
export function overviewFor(packet,task,reading){return task==="redaction"?packet?.reading_overviews?.[reading]||null:packet?.overall||null;}
export const reviewDisclosure="The saved LLM reviewed the original candidate/raw-quote packet and frozen native decision, not the new V6.5 gate. No new model review is implied.";
export const guideDisclosure="Derived V6.5 evidence-decision guidance, not a saved native graph path or a new kernel edge.";
export function canonicalGateJSON(value){
  const encode=v=>Array.isArray(v)?"["+v.map(encode).join(",")+"]":v&&typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+encode(v[k])).join(",")+"}":JSON.stringify(v);
  return encode(value).replace(/[\u007f-\uffff]/g,char=>"\\u"+char.charCodeAt(0).toString(16).padStart(4,"0"));
}
export async function exactGateReview(record={},gate){
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
// Labels and scope follow Herschel's V65 route-sidecar contract.
export function routeProvenance(route={}){
  if(route.route_kind==="LEXICAL_SOURCE_READOUT")return {label:"Source readout",note:"Document and quote readout, not a numerical KG walk."};
  if(route.derived_witness===true||route.route_kind==="DERIVED_BOUNDED_PROJECTION_WITNESS")return {label:"Derived projection witness",note:"Selected from actual bounded projection edges and the bound native kernel. Not a native-saved witness or a correctness probability."};
  if(route.native_witness===true)return {label:"Native-saved witness",note:"The unchanged complete native-saved sequence; presentation selection does not change its rank or support."};
  return {label:"Saved positive walk",note:"An existing positive finite walk, not a newly derived path or a correctness probability."};
}

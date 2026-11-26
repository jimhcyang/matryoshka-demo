// Publication inventory validation only; never a candidate or evidence vote.
import {workbenchStudyTarget} from './workbench-study-entry.js';

const identity=value=>typeof value==='string'&&value.trim()===value&&value.length>0;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const reference=value=>identity(value?.path)&&!/[\\?#:\u0000-\u001f]/.test(value.path)&&
  !value.path.startsWith('/')&&value.path.split('/').every(part=>part&&part!=='.'&&part!=='..')&&hash(value.sha256);
const fields=['case_id','corpus','task','query','date','document_id','focal_marker'];
const sameKeys=(values,expected)=>Array.isArray(values)&&values.length===expected.length&&
  new Set(values).size===values.length&&expected.every(key=>values.includes(key));
const requireValue=(condition,message)=>{if(!condition)throw Error('Retained study contract: '+message);};

export async function validateRetainedStudyCollection(report){
  requireValue(Array.isArray(report?.cases),'the public case inventory is missing.');
  const marked=report.cases.filter(row=>row.collection==='withheld_delegation'),
    slotted=report.cases.filter(row=>row.study_slot!==undefined);
  if(!marked.length&&!slotted.length&&report.collection_counts?.withheld_delegation==null)return;
  requireValue(marked.length===1&&slotted.length===1&&slotted[0]===marked[0]&&
    report.collection_counts?.withheld_delegation===1,'exactly one declared active first gap is required.');
  const row=marked[0],c=row.case,b=row.native_public_case_binding,saved=row.configurations?.llm_readings,
    resource=row.resource_binding,companion=row.study_companion_case_id;
  requireValue(row.study_slot==='first'&&c?.task==='redaction'&&c.corpus==='cib'&&
    sameKeys(Object.keys(c),fields)&&fields.every(key=>identity(c[key]))&&
    /^\d{4}-\d{2}-\d{2}$/.test(c.date)&&c.query.includes(c.focal_marker)&&
    row.selected_demo===false&&row.selected_bench===false&&row.selected_additional===false&&
    row.current_resource_execution===true,'public case, collection flags or current execution differ.');
  requireValue(row.reference_answer_kind==='unknown_still_withheld'&&
    !Object.hasOwn(row,'reference_answer')&&!Object.hasOwn(row,'gold')&&
    (row.reference_answer_available===undefined||row.reference_answer_available===false),
    'the historical reference must remain unknown and absent.');
  requireValue(resource?.corpus==='cib'&&['resource_id','graph_id','hierarchy_id'].every(key=>identity(resource[key]))&&
    hash(resource.registry_sha256)&&hash(resource.index_sha256),'the resource binding is incomplete.');
  requireValue(saved?.config==='llm_readings'&&identity(saved.run_id)&&
    reference(saved.native_checkpoint)&&reference(saved.condition_ref)&&
    saved.trace_refs&&Object.keys(saved.trace_refs).length>0&&
    Object.entries(saved.trace_refs).every(([key,value])=>identity(key)&&reference(value)),
    'saved execution, condition or reading traces are missing.');
  requireValue(b?.version==='narrative-native-public-case-binding/1'&&b.state==='PASS'&&
    b.native_packet_modified===false&&b.source_admission_scope_bound_not_recomputed===true&&
    b.task_binding==='EXACT_SAME_PUBLIC_TASK'&&sameKeys(b.checked_public_fields,fields)&&
    Array.isArray(b.issues)&&b.issues.length===0&&hash(b.native_result_checksum),
    'the exact native/public input attestation is incomplete.');
  requireValue(Array.isArray(report.ordered_case_ids)&&
    report.ordered_case_ids.filter(id=>id===c.case_id).length===1&&
    report.cases.filter(value=>value.case?.case_id===c.case_id).length===1,
    'the active gap must occur exactly once in the ordered inventory.');
  const archive=(report.retirements||[]).filter(value=>value.case_id===companion);
  requireValue(identity(companion)&&companion!==c.case_id&&
    !report.cases.some(value=>value.case?.case_id===companion)&&
    !report.ordered_case_ids.includes(companion)&&archive.length===1&&
    reference(archive[0].native_ref)&&identity(archive[0].reason),
    'the distinct second gap must remain archived with its native checkpoint.');
  // Reuse the released entry's cryptographic public-input/checkpoint and exact
  // registered-source policy checks. This builds a URL but performs no fetch.
  await workbenchStudyTarget(report,{slot:'first',base:'https://matryoshka.invalid/'});
}

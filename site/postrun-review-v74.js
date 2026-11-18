// Display binding checks only. The backend replays immutable review/source receipts.
import {canonicalGateJSON,packetFor} from './local-decisions-v65.js';

const VERSION='current-postrun-review-projection/1';
const PROTOCOL='independent-redaction-assessment/2';
const FIELDS=['canonical_page_id','document_id','date','start','end','text','page_sha256'];
const META=['version','available','verified','grades_revealed','binding','item_count','review_sha256','protocol_version',
  'judgment_policy','native_claim_status_supplied','calibration_judgment','source_scope','provider_authenticity_certified',
  'used_for_inference','automatic_support_upgrade','native_outputs_modified','notice'];
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>canonicalGateJSON(a)===canonicalGateJSON(b);
const require=(ok,message)=>{if(!ok)throw Error(message);};
const pin=ref=>ref&&typeof ref.path==='string'&&ref.path&&!ref.path.includes('\\')&&
  !ref.path.startsWith('/')&&ref.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&hash(ref.sha256);
async function digest(value){
  const bytes=new TextEncoder().encode(canonicalGateJSON(value)),valueHash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(valueHash),v=>v.toString(16).padStart(2,'0')).join('');
}
function nativeItems(record){
  const entries=[],keys=new Set();
  for(const row of record.result?.readings||[]){
    require(typeof row.reading?.id==='string'&&row.reading.id,'Review reading identity is missing.');
    for(const [index,candidate]of (row.candidates||[]).slice(0,5).entries()){
      const key=JSON.stringify([row.reading.id,candidate.id]);
      require(typeof candidate.id==='string'&&candidate.id&&typeof candidate.fill==='string'&&!keys.has(key),
        'Review candidate identity is ambiguous.');
      require(candidate.rank==null||candidate.rank===index+1,'Saved candidate rank differs.');keys.add(key);
      entries.push({reading_id:row.reading.id,candidate_id:candidate.id,rank:index+1,fill:candidate.fill,candidate});
    }
  }
  return entries;
}
function sources(candidate){
  const offered=[...(candidate.sources||[]),...(candidate.support_assessment?.evidence||[]).map(e=>e.citation)];
  const unique=new Map(),pages=new Map();
  for(const row of offered){
    const ref=row?.citation||row;
    require(ref&&FIELDS.every(k=>Object.hasOwn(ref,k))&&FIELDS.every(k=>!Object.hasOwn(row,k)||row[k]===ref[k]),
      'Reviewed source citation is incomplete.');
    require(['canonical_page_id','document_id','date','text'].every(k=>typeof ref[k]==='string'&&ref[k])&&hash(ref.page_sha256)&&
      Number.isSafeInteger(ref.start)&&Number.isSafeInteger(ref.end)&&ref.start>=0&&ref.end>ref.start&&
      Array.from(ref.text).length===ref.end-ref.start,'Reviewed source quotation has invalid bounds.');
    const binding=FIELDS.slice(1,3).map(k=>ref[k]).concat(ref.page_sha256),key=JSON.stringify([ref.canonical_page_id,ref.start,ref.end]);
    require(!pages.has(ref.canonical_page_id)||same(pages.get(ref.canonical_page_id),binding),'Reviewed page bindings conflict.');
    require(!unique.has(key)||same(unique.get(key),Object.fromEntries(FIELDS.map(k=>[k,ref[k]]))),'Reviewed quotations conflict.');
    pages.set(ref.canonical_page_id,binding);unique.set(key,Object.fromEntries(FIELDS.map(k=>[k,ref[k]])));
  }
  return [...unique.values()].sort((a,b)=>{
    for(const key of ['date','document_id','canonical_page_id','start','end'])if(a[key]!==b[key])return a[key]<b[key]?-1:1;
    return 0;
  });
}
function metadata(value,revealed){
  require(value&&Object.keys(value).every(k=>META.includes(k)||k==='resource_binding'||revealed&&k==='items')&&
    META.every(k=>Object.hasOwn(value,k)),'Unsupported independent-review metadata.');
  require(value.version===VERSION&&value.available===true&&value.verified===true&&value.grades_revealed===revealed&&
    value.protocol_version===PROTOCOL&&value.judgment_policy==='UNCLEAR_WITHOUT_NATIVE_ASSERTION'&&
    value.native_claim_status_supplied===false&&value.calibration_judgment==='NOT_ASSESSED'&&
    value.source_scope==='ALL_SAVED_TOP5_QUOTATIONS_NOT_FULL_NATIVE_POOL_RECERTIFICATION'&&
    value.provider_authenticity_certified===false&&value.used_for_inference===false&&
    value.automatic_support_upgrade===false&&value.native_outputs_modified===false&&hash(value.review_sha256)&&
    Number.isSafeInteger(value.item_count)&&value.item_count>0&&typeof value.notice==='string',
    'Independent review has an unsupported provenance contract.');
  return Object.fromEntries(META.map(k=>[k,k==='grades_revealed'?false:value[k]]));
}

export async function preparePostrunReview(record,caseInfo,summary){
  const available=record?.postrun_review,reference=record?.postrun_review_ref;
  if(available?.available!==true){require(!reference,'Review reference lacks verified availability metadata.');return null;}
  require(caseInfo.task==='redaction'&&record.current_resource_execution===true&&
    packetFor(record,caseInfo)?.version==='current-evidence-decision/1','Independent review requires the verified current native.');
  const meta=metadata(available,false);
  require(pin(reference)&&same(reference,summary?.postrun_review_ref),'Independent review projection reference differs.');
  if(summary.postrun_review!==undefined)require(same(available,summary.postrun_review),'Review summary metadata differs.');
  require(pin(record.native_checkpoint)&&hash(record.native_record_sha256)&&hash(record.source_binding_sha256)&&
    record.identity&&record.code,'Independent review is missing native identity fields.');
  const codeHash=await digest(record.code);
  require(record.identity.code_sha256===codeHash&&record.identity.source_binding_sha256===record.source_binding_sha256,
    'Independent review native code/source binding differs.');
  const expected={case_id:caseInfo.case_id,config:record.config,native_run_id:record.run_id,native_checksum:record.native_checksum,
    native_record_sha256:record.native_record_sha256,case_sha256:await digest(caseInfo),query_sha256:await digest(caseInfo.query),
    resource_id:record.resource_binding.resource_id,registry_sha256:record.resource_binding.registry_sha256,
    index_sha256:record.resource_binding.index_sha256,source_binding_sha256:record.source_binding_sha256,code_sha256:codeHash,
    native_checkpoint_ref:{path:record.native_checkpoint.path,sha256:record.native_checkpoint.sha256}};
  require(same(meta.binding,expected),'Independent review belongs to another native, query or resource.');
  const entries=nativeItems(record);
  require(entries.length===meta.item_count&&caseInfo.focal_marker&&caseInfo.query.split(caseInfo.focal_marker).length===2,
    'Independent review candidate count or focal marker differs.');
  return {meta,reference,entries,caseInfo,resource_binding:record.resource_binding,key:canonicalGateJSON([expected,reference,meta.review_sha256])};
}

export async function verifyPostrunReview(value,prepared){
  const meta=metadata(value,true);
  require(prepared&&same(meta,prepared.meta)&&same(value.resource_binding,prepared.resource_binding),
    'Independent review response differs from its published binding.');
  require(Array.isArray(value.items)&&value.items.length===prepared.entries.length,'Independent review item count differs.');
  const checked=[];
  for(const [index,item]of value.items.entries()){
    const expected=prepared.entries[index],refs=sources(expected.candidate);
    require(item&&item.reading_id===expected.reading_id&&item.candidate_id===expected.candidate_id&&item.rank===expected.rank&&
      item.fill===expected.fill&&Array.isArray(item.sources)&&same(item.sources.map(s=>Object.fromEntries(FIELDS.map(k=>[k,s[k]]))),refs),
      'Independent review candidate order, wording or sources differ.');
    const identity={kind:'redaction_fill',assessment_unit:'inserted_fill',candidate_fill:expected.fill,
      completed_sentence:prepared.caseInfo.query.replace(prepared.caseInfo.focal_marker,expected.fill),
      sources:refs.map((s,i)=>({id:'S'+(i+1),text:s.text,date:s.date})),packet_version:'source-complete-assessment-packets/3'};
    require(item.item_id==='item_'+(await digest(identity)).slice(0,24),'Independent review item identity differs.');
    const grade=item.grade,ids=refs.map((_,i)=>'S'+(i+1));
    require(grade&&Object.keys(grade).length===7&&grade.id===item.item_id&&
      ['correct','partial','incorrect'].includes(grade.answer_match)&&['direct','partial','context','contradicted','none'].includes(grade.evidence_support)&&
      [true,false,null].includes(grade.grammatical)&&grade.judgment==='unclear'&&typeof grade.explanation==='string'&&
      Array.isArray(grade.cited_source_ids)&&new Set(grade.cited_source_ids).size===grade.cited_source_ids.length&&
      grade.cited_source_ids.every(id=>ids.includes(id))&&(grade.evidence_support==='none'||grade.cited_source_ids.length),
      'Independent review grade or cited source IDs are unsupported.');
    checked.push({...item,sources:refs,grade:{...grade,cited_source_ids:[...grade.cited_source_ids]}});
  }
  return {key:prepared.key,meta:prepared.meta,items:checked};
}

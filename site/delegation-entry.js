import {canonicalGateJSON} from './local-decisions-v65.js';
import {savedSourcePolicy} from './saved-source-policy.js';

export const STUDY_CASE_IDS=Object.freeze({
  first:'delegation_window_0a778cbe9fe92251c0a2fa5a',
  last:'delegation_window_ad3f98e8db456d199146b68c'
});
const check=(value,message)=>{if(!value)throw Error(message);};
const list=value=>Array.isArray(value)?value:[];

export function studySlot(row,caseInfo=row?.case,{positions=['first','last'],comparisonCaseIds=[]}={}){
  const slot=Object.keys(STUDY_CASE_IDS).find(key=>STUDY_CASE_IDS[key]===caseInfo?.case_id);
  if(!slot)return null;
  const other=slot==='first'?'last':'first';
  check(positions.includes(slot)&&row?.study_slot===slot&&
    (positions.length===1?row.study_companion_case_id==null||comparisonCaseIds.includes(row.study_companion_case_id):row.study_companion_case_id===STUDY_CASE_IDS[other])&&
    row.reference_answer_kind==='unknown_still_withheld'&&row.reference_answer_available!==true&&
    row.reference_answer==null&&row.gold==null&&caseInfo.task==='redaction'&&caseInfo.corpus==='cib'&&
    caseInfo.document_id==='CIA-RDP79T00975A004300220001-9'&&caseInfo.date==='1959-02-17'&&caseInfo.focal_marker==='[REDACTION]'&&
    typeof caseInfo.query==='string'&&caseInfo.query.trim()&&
    ['case_id','task','corpus','document_id','date','focal_marker','query'].every(key=>row.case?.[key]===caseInfo[key]),
    'The canonical study input or unknown-truth policy is not bound. No older input or answer is substituted.');
  return slot;
}

// Only the existing hash/span-verified private view may supply the primary channel.
export function studyInputPrimary(record,caseInfo,row,view,readingId){
  const slot=studySlot(row,caseInfo);if(!slot)return null;
  const unavailable={available:false,slot,readingId:readingId||'',channel:'input_nomination'};
  if(view==null)return unavailable;
  check(view.version==='input-context-view/1'&&view.query===caseInfo.query&&Array.isArray(view.readings),
    'The study suggestion has another verified input view. No suggestion is substituted.');
  const native=list((record?.result?.redaction||record?.result)?.readings);
  const nominations=list(record?.result?.input_nomination?.readings),ids=new Set();
  for(const reading of view.readings){
    check(typeof reading.id==='string'&&reading.id&&!ids.has(reading.id)&&Array.isArray(reading.candidates),
      'The study suggestion reading inventory is invalid.');ids.add(reading.id);
    if(!reading.candidates.length)continue;
    const matching=nominations.filter(value=>value.reading_id===reading.id);
    check(reading.corpusAvailable===true&&native.filter(value=>value.reading?.id===reading.id).length===1&&
      matching.length===1&&matching[0].nominations?.length===reading.candidates.length&&
      reading.candidates.every((item,index)=>item.proof===matching[0].nominations[index]&&
        item.id===item.proof?.id&&item.fill===item.proof?.fill&&item.proof.reading_id===reading.id&&
        typeof item.fill==='string'&&item.fill.trim()),
      'The study suggestion does not match its verified native reading. No other reading is substituted.');
  }
  const selected=readingId==null?view.readings.find(value=>value.candidates.length):view.readings.find(value=>value.id===readingId);
  const nominee=selected?.candidates[0];
  return nominee?{available:true,slot,channel:'input_nomination',readingId:selected.id,nomineeId:nominee.id,fill:nominee.fill}:unavailable;
}

// Source-owned event, not a lexical-name identity join or a historical retrieval route.
export function studyInspection(primary,record,caseInfo,row){
  if(!primary?.available||primary.slot!==studySlot(row,caseInfo)||row.resource_binding?.graph_id!=='graph_2e1f8d6c2443987c')return null;
  const pins={
    first:{query:'567139c9efa50dd17bcd318b2cd19845adb06b58e416b75342d2d69d962c1664',nominee:'input_nomination_c8e8eb9867d9d23e0cb4bb87'},
    last:{query:'9b119f444907f84d858ae39a75ca3af9a43a3674a84157a72089944e48a176f4',nominee:'input_nomination_50c10913596a0415909224aa'}
  };
  const pin=pins[primary.slot];
  if(!pin||record.result?.input_nomination?.binding?.query_sha256!==pin.query||primary.nomineeId!==pin.nominee)return null;
  return {node_id:'event_88934c2188134359cfbf',source_id:'page_d884726ce3791d6d8092',
    document_id:'CIA-RDP79T00975A004300220001-9',release:'later',
    page_sha256:'9258c7233e921e703b3e0089a8a1aa06c4ca585a4cd312f47790cb642074bb00'};
}

export function studyPublicationSlots(report,study,reportSHA){
  check(study?.version==='delegation-native-workbench/1'&&study.gold===null&&study.native_results_modified===false&&
    /^[a-f0-9]{64}$/.test(reportSHA||'')&&study.source_report_ref?.sha256===reportSHA&&
    Array.isArray(report?.cases)&&Array.isArray(study.cases)&&[1,2].includes(study.cases.length),
    'The study capsule is not bound to this exact report. No other study is substituted.');
  const policy=savedSourcePolicy(study.source_view_policy),positions=study.cases.map(item=>item.position);
  const comparisons=study.comparison_cases??[],comparisonIds=comparisons.map(item=>item.case_id);
  check(new Set(positions).size===positions.length&&positions.every(slot=>Object.hasOwn(STUDY_CASE_IDS,slot))&&
    (positions.length===2||positions[0]==='first'&&study.cases[0].qualified===true&&study.corpus_only===true&&policy.id==='supplied_documents_inclusive')&&
    Array.isArray(comparisons)&&comparisons.length<=1&&new Set(comparisonIds).size===comparisonIds.length&&
    (!comparisons.length||positions.length===1&&canonicalGateJSON(study.comparison_case_ids)===canonicalGateJSON(comparisonIds))&&
    comparisons.every(item=>item.position==='last'&&item.case_id===STUDY_CASE_IDS.last&&item.qualified===false&&
      item.role==='FRESH_NEGATIVE_COMPARISON_NOT_PUBLIC_STUDY'),
    'A single public study must explicitly declare its corpus-only registered-source execution.');
  for(const key of ['public_study_case_ids','qualified_case_ids'])if(study[key]!=null)
    check(canonicalGateJSON(study[key])===canonicalGateJSON(study.cases.map(item=>item.case_id)),'The public study list promotes an undeclared comparison.');
  for(const item of [...study.cases,...comparisons]){
    const rows=report.cases.filter(row=>row.case?.case_id===item.case_id),pin=item.native_checkpoint;
    check(item.case_id===STUDY_CASE_IDS[item.position]&&rows.length===1&&
      studySlot(rows[0],rows[0].case,{positions:item.qualified===false?['first','last']:positions,comparisonCaseIds:comparisonIds})===item.position&&
      pin&&typeof pin.path==='string'&&pin.path&&!/^[\/]|[\\?#:\u0000-\u001f]/.test(pin.path)&&
      pin.path.split('/').every(part=>part&&part!=='.'&&part!=='..')&&/^[a-f0-9]{64}$/.test(pin.sha256||'')&&
      canonicalGateJSON(rows[0].configurations?.llm_readings?.native_checkpoint)===canonicalGateJSON(pin)&&
      canonicalGateJSON(savedSourcePolicy(rows[0].configurations?.llm_readings?.source_view_policy))===canonicalGateJSON(policy),
      'The study case, native checkpoint or source policy differs from the bound capsule.');
  }
  const published=report.cases.filter(row=>row.study_slot!=null);
  const declared=[...study.cases,...comparisons];
  check(published.length===declared.length&&published.every(row=>declared.some(item=>item.case_id===row.case?.case_id)),
    'The report exposes a study choice outside the bound public capsule.');
  return positions;
}

export function canonicalStudyTarget(report,slot,base=import.meta.url,{study,reportSHA}={}){
  check(Object.hasOwn(STUDY_CASE_IDS,slot)&&Array.isArray(report?.cases),'Choose study input 1 (first gap) or 2 (last gap).');
  const positions=study==null?['first','last']:studyPublicationSlots(report,study,reportSHA);
  check(positions.includes(slot),'This study input is not published in the bound public capsule. No other input is substituted.');
  for(const key of positions){
    const id=STUDY_CASE_IDS[key];
    const rows=report.cases.filter(row=>row.case?.case_id===id);
    check(rows.length===1,'The two new study inputs are not published in the canonical report. No old bridge or input is substituted.');
    check(studySlot(rows[0],rows[0].case,{positions,comparisonCaseIds:list(study?.comparison_cases).map(item=>item.case_id)})===key&&rows[0].configurations?.llm_readings,
      'The canonical study execution is not published. No other method is substituted.');
  }
  const target=new URL('workbench-v6.html',base);
  target.search=new URLSearchParams({case:STUDY_CASE_IDS[slot],arm:'A'}).toString();return target;
}

export async function loadStudyPublication(report,reportSHA,base=import.meta.url){
  const options={mode:'same-origin',credentials:'omit',redirect:'error',cache:'no-store'};
  const html=await fetch(new URL('swedish-study.html',base),options);check(html.ok,'The public study metadata is unavailable.');
  const meta=new DOMParser().parseFromString(await html.text(),'text/html');
  const path=meta.querySelector('meta[name="study-data-path"]')?.content,pin=meta.querySelector('meta[name="study-data-sha256"]')?.content;
  check(path==='data/delegation-study-current.json'&&/^[a-f0-9]{64}$/.test(pin||''),'The pinned public study metadata is unavailable.');
  const response=await fetch(new URL(path,base),options);check(response.ok,'The public study capsule is unavailable.');
  const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  check(hash===pin,'The public study capsule failed its exact content pin.');
  const study=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),positions=studyPublicationSlots(report,study,reportSHA);
  return {positions,caseIds:study.cases.map(item=>item.case_id),comparisonCaseIds:list(study.comparison_cases).map(item=>item.case_id)};
}

async function start(){
  const status=document.getElementById('study-status');
  const navigation=document.querySelector('nav[aria-label="Delegation study inputs"]');
  if(navigation)navigation.hidden=true;
  status.textContent='Checking the published saved study input...';
  try{
    const params=new URLSearchParams(location.search);
    check([...params.keys()].every(key=>key==='slot')&&params.getAll('slot').length<=1&&(!params.has('slot')||Object.hasOwn(STUDY_CASE_IDS,params.get('slot'))),
      'Choose study input 1 (first gap) or 2 (last gap).');
    const path=document.querySelector('meta[name="study-data-path"]')?.content,pin=document.querySelector('meta[name="study-data-sha256"]')?.content;
    check(path==='data/delegation-study-current.json'&&/^[a-f0-9]{64}$/.test(pin||''),'The pinned study capsule is unavailable.');
    const read=async relative=>{
      const response=await fetch(new URL(relative,import.meta.url),{mode:'same-origin',credentials:'omit',redirect:'error',cache:'no-store'});
      check(response.ok,'The canonical study data is unavailable. No old input is substituted.');
      const bytes=await response.arrayBuffer(),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
      return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256};
    };
    const capsule=await read(path);check(capsule.sha256===pin,'The study capsule failed its exact content pin.');
    const report=await read('data/report-v6.json'),positions=studyPublicationSlots(report.value,capsule.value,report.sha256),slot=params.get('slot')||positions[0];
    const target=canonicalStudyTarget(report.value,slot,location.href,{study:capsule.value,reportSHA:report.sha256});
    for(const tab of document.querySelectorAll('[data-study-slot]')){
      if(positions.length===1||!positions.includes(tab.dataset.studySlot))tab.remove();
      else tab.setAttribute('aria-current',tab.dataset.studySlot===slot?'page':'false');
    }
    if(navigation)navigation.hidden=positions.length<2;
    status.textContent='Opening the canonical saved input. Truth remains unknown.';
    location.replace(target.href);
  }catch(error){status.textContent=error.message;status.className='notice error';status.dataset.error='true';}
}
if(typeof document!=='undefined'&&document.getElementById('study-status'))void start();

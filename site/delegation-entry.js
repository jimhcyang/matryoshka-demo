export const STUDY_CASE_IDS=Object.freeze({
  first:'delegation_window_0a778cbe9fe92251c0a2fa5a',
  last:'delegation_window_ad3f98e8db456d199146b68c'
});
const check=(value,message)=>{if(!value)throw Error(message);};
const list=value=>Array.isArray(value)?value:[];

export function studySlot(row,caseInfo=row?.case){
  const slot=Object.keys(STUDY_CASE_IDS).find(key=>STUDY_CASE_IDS[key]===caseInfo?.case_id);
  if(!slot)return null;
  const other=slot==='first'?'last':'first';
  check(row?.study_slot===slot&&row.study_companion_case_id===STUDY_CASE_IDS[other]&&
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

export function canonicalStudyTarget(report,slot,base=import.meta.url){
  check(Object.hasOwn(STUDY_CASE_IDS,slot)&&Array.isArray(report?.cases),'Choose study input 1 (first gap) or 2 (last gap).');
  for(const [key,id]of Object.entries(STUDY_CASE_IDS)){
    const rows=report.cases.filter(row=>row.case?.case_id===id);
    check(rows.length===1,'The two new study inputs are not published in the canonical report. No old bridge or input is substituted.');
    check(studySlot(rows[0])===key&&rows[0].configurations?.llm_readings,
      'The canonical study execution is not published. No other method is substituted.');
  }
  const target=new URL('workbench-v6.html',base);
  target.search=new URLSearchParams({case:STUDY_CASE_IDS[slot],arm:'A'}).toString();return target;
}

async function start(){
  const status=document.getElementById('study-status');
  try{
    const params=new URLSearchParams(location.search),slot=params.get('slot')||'first';
    check([...params.keys()].every(key=>key==='slot')&&params.getAll('slot').length<=1&&Object.hasOwn(STUDY_CASE_IDS,slot),
      'Choose study input 1 (first gap) or 2 (last gap).');
    for(const tab of document.querySelectorAll('[data-study-slot]'))tab.setAttribute('aria-current',tab.dataset.studySlot===slot?'page':'false');
    const response=await fetch(new URL('data/report-v6.json',import.meta.url),{mode:'same-origin',credentials:'omit',redirect:'error',cache:'no-store'});
    check(response.ok,'The canonical study report is unavailable. No old bridge or input is substituted.');
    const target=canonicalStudyTarget(await response.json(),slot,location.href);
    status.textContent='Opening the canonical saved input. Truth remains unknown.';
    location.replace(target.href);
  }catch(error){status.textContent=error.message;status.className='notice error';status.dataset.error='true';}
}
if(typeof document!=='undefined'&&document.getElementById('study-status'))void start();

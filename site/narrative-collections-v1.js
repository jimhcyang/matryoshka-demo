// Optional display hooks for a separately published additional collection.
// No case is nominated, promoted or judged by these helpers.
import {validateRetainedStudyCollection} from './graph-retained-study-guard-v1.js';
export const ADDITIONAL_COLLECTION='additional_real_redaction';
export const WITHHELD_COLLECTION='withheld_delegation';
export const CONFIGS={llm_readings:'A',llm_local:'C',llm_atoms:'B'};
const pin=ref=>typeof ref?.path==='string'&&ref.path.length>0&&/^[a-f0-9]{64}$/.test(ref.sha256||'');
const identity=value=>typeof value==='string'&&value.trim()===value&&value.length>0;

export function questionCollection(row){
  if(row.collection===ADDITIONAL_COLLECTION)return ADDITIONAL_COLLECTION;
  return row.selected_demo===true?'presentation':row.selected_bench===true?'bench':'archive';
}

export function savedCondition(row){
  const config=Object.keys(CONFIGS).find(key=>{
    const value=row.configurations?.[key];
    return value?.config===key&&identity(value.run_id)&&
      !['PENDING','NOT_STARTED','UNEXECUTED'].includes(String(value.status||'').toUpperCase())&&
      pin(value.native_checkpoint)&&pin(value.condition_ref);
  });
  return config?{row,config}:null;
}

export async function validateAdditionalCollection(manifest,report){
  if(report.cases.some(row=>row.collection!==undefined&&!['starter','bench',ADDITIONAL_COLLECTION,WITHHELD_COLLECTION].includes(row.collection)))
    throw Error('The casebook has an unsupported explicit collection marker.');
  await validateRetainedStudyCollection(report);
  for(const row of report.cases)if(row.collection==='starter'&&(row.selected_demo!==true||row.selected_bench===true)||
      row.collection==='bench'&&(row.selected_bench!==true||row.selected_demo===true))
    throw Error('The explicit starter or bench collection conflicts with its selected-case flags.');
  const extras=report.cases.filter(row=>row.collection===ADDITIONAL_COLLECTION);
  const ids=manifest[ADDITIONAL_COLLECTION];
  if(ids!==undefined||extras.length){
    if(!Array.isArray(ids)||ids.some(id=>!identity(id))||new Set(ids).size!==ids.length||
      JSON.stringify([...ids].sort())!==JSON.stringify(extras.map(row=>row.case.case_id).sort()))
      throw Error('The additional redaction collection differs from the pinned report.');
  }
  for(const row of extras)if(row.case.corpus!=='cib'||row.case.task!=='redaction'||
    row.selected_demo===true||row.selected_bench===true)
    throw Error('Additional CIB redactions cannot occupy a core starter or bench cell.');
  // Canonical target and episode/fact-family IDs come from the source owner,
  // never from a hidden answer, title or browser-generated grouping.
  const targets=new Set(),families=new Set();
  for(const row of report.cases){
    if(row.case.task!=='redaction')continue;
    const target=row.source_target_id,family=row.family_id;
    if(extras.length&&row.case.corpus==='cib'&&questionCollection(row)!=='archive'&&
      (!identity(target)||!identity(family)))
      throw Error('Published CIB redactions need canonical target and fact-family identities before extras can be displayed.');
    for(const [value,seen] of [[target,targets],[family,families]]){
      if(value===undefined)continue;
      const key=JSON.stringify([row.case.corpus,value]);
      if(!identity(value)||seen.has(key))throw Error('The casebook repeats or omits a redaction target or fact family.');
      seen.add(key);
    }
  }
}

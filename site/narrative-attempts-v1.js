// Browser-local ordering for a saved replay, never a new inference request.
const memory=new Map();
function identity(report){return 'narrative-saved-attempts/1/'+report.run_id+'/'+report.sha256;}
function selected(report){
  const contract=report?.privacy_contract;if(contract==null)return null;
  if(contract.version!=='narrative-story-attempts/1'||contract.require_story_attempts_before_privileged_sources!==true||
      !contract.story_case_ids||typeof contract.story_case_ids!=='object'||Array.isArray(contract.story_case_ids))
    throw Error('The saved story access contract is unsupported.');
  const rows=report.cases,seen=new Set();
  for(const [story,ids] of Object.entries(contract.story_case_ids)){
    if(!story||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>
        typeof id!=='string'||seen.has(id)||!rows.some(row=>row.case.case_id===id&&row.narrative_id===story)))
      throw Error('The saved story access contract does not match its published cases.');
    ids.forEach(id=>seen.add(id));
  }
  if(rows.some(row=>!seen.has(row.case.case_id)))throw Error('A published case is missing its saved story access contract.');
  return contract;
}
export function validatePrivacyContract(report){selected(report);return report;}
function attempts(report){
  const key=identity(report);let ids=memory.get(key);
  if(!ids){
    ids=new Set();try{const saved=JSON.parse(sessionStorage.getItem(key)||'[]');if(Array.isArray(saved))for(const id of saved)if(typeof id==='string')ids.add(id);}catch{/* Storage is optional. */}
    memory.set(key,ids);
  }
  return ids;
}
function save(report,ids){try{sessionStorage.setItem(identity(report),JSON.stringify([...ids]));}catch{/* Memory retains this page's explicit actions. */}}
export function hasOpenedResult(report,row){return !selected(report)||attempts(report).has(row.case.case_id);}
export function markOpenedResult(report,row){
  const contract=selected(report);if(!contract)return;
  if(!contract.story_case_ids[row.narrative_id]?.includes(row.case.case_id))throw Error('This task is outside the saved story access contract.');
  const ids=attempts(report);ids.add(row.case.case_id);save(report,ids);
}
export function storyAccess(report,row){
  const contract=selected(report);if(!contract)return {unlocked:true,total:0,opened:0};
  const ids=contract.story_case_ids[row.narrative_id],opened=attempts(report);
  if(!ids)return {unlocked:false,total:0,opened:0};
  return {unlocked:ids.every(id=>opened.has(id)),total:ids.length,opened:ids.filter(id=>opened.has(id)).length};
}
export function acknowledgeStoryReveal(report,row){
  const contract=selected(report);if(!contract)return;
  const ids=attempts(report);for(const id of contract.story_case_ids[row.narrative_id])ids.add(id);save(report,ids);
}

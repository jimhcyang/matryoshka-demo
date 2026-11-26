import {validateManifest} from './narrative-trace-v1.js';
import {CONFIGS,savedCondition,ADDITIONAL_COLLECTION,questionCollection} from './narrative-collections-v1.js';
import {sidebarDecisionSummary,canonicalGateJSON} from './local-decisions-v65.js';
import {validatePrivacyContract} from './narrative-attempts-v1.js';
export {savedCondition,ADDITIONAL_COLLECTION,questionCollection};

export const CORPORA=[['iran','Iran cables'],['vietnam','Vietnam cables'],['cib','Central Intelligence Bulletins']];
export const TASKS=[['mosaic','Mosaic'],['hypothesis','Hypothesis'],['redaction','Redaction']];
export function savedInvestigation(report,corpus){
  const source=report.investigations;
  const matches=Array.isArray(source)?source.filter(row=>row?.corpus===corpus):source?.[corpus]?[source[corpus]]:[];
  if(matches.length!==1)return null;
  const story=matches[0],id=story.id||story.narrative_id;
  if(typeof id!=='string'||!id||story.id&&story.narrative_id&&story.id!==story.narrative_id)return null;
  return {...story,id};
}
export function savedStoryQuestion(report,corpus,task,{bench=false,story}={}){
  const asBench=bench||story?.collection==='bench';
  const matches=report.cases.filter(row=>row.case.corpus===corpus&&row.case.task===task&&
    questionCollection(row)!==ADDITIONAL_COLLECTION&&
    (asBench?row.selected_bench===true:row.selected_demo===true)&&
    (story?.id?row.narrative_id===story.id:asBench));
  if(matches.length!==1)return null;
  return savedCondition(matches[0]);
}

export function savedQuestionURL(match,{bench=false,stage}={}){
  const collection=questionCollection(match.row);
  const params=new URLSearchParams({case:match.row.case.case_id,arm:CONFIGS[match.config],show:collection===ADDITIONAL_COLLECTION?collection:bench||match.row.selected_bench===true?'bench':'presentation'});
  if(stage)params.set('stage',stage);
  return 'workbench-v6.html?'+params;
}

export async function savedRedactionOutcome(match){
  const unavailable={label:'Outcome unavailable',detail:'No bound saved outcome is published for this method.'};
  if(!match)return unavailable;
  const {row,config}=match,value=row.decision_summary_by_arm?.[config],native=row.configurations[config];
  try{
    const summary=sidebarDecisionSummary(value,row.case,config);
    const bytes=new TextEncoder().encode(canonicalGateJSON(row.case.query));
    const queryHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(row.case.task!=='redaction'||value.query_sha256!==queryHash||value.native_run_id!==(native.native_run_id||native.run_id)||
      native.native_checksum!=null&&canonicalGateJSON(native.native_checksum)!==canonicalGateJSON(value.native_checksum)||
      native.gate_sha256!=null&&native.gate_sha256!==value.gate_sha256)return unavailable;
    return {label:summary.badge.replace(/^EVIDENCE /,'SUPPORT ').replace(/^INSUFFICIENT /,'UNRESOLVED '),
      detail:summary.detail+' Counts are candidate states in the saved default reading; they do not establish exact recovery.'};
  }catch{return unavailable;}
}

export async function loadSavedCatalog(){
  const responses=await Promise.all(['/api/narrative-v1/manifest','/api/health','/data/report-v6.json'].map(url=>fetch(url,{cache:'no-store'})));
  if(responses.some(response=>!response.ok))throw Error('Saved selection unavailable');
  const [manifest,health,bytes]=await Promise.all([responses[0].json(),responses[1].json(),responses[2].arrayBuffer()]);
  const report=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  await validateManifest(manifest,health,report,sha);
  validatePrivacyContract(report);
  if(canonicalGateJSON(report.investigations||{})!==canonicalGateJSON(manifest.investigations||{}))
    throw Error('Story metadata differs from the pinned report');
  return {manifest,report};
}

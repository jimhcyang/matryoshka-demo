// Navigation from the verified active report, not a stale historical capsule.
import {savedSourcePolicy} from './saved-source-policy.js';
import {canonicalGateJSON} from './local-decisions-v65.js';
const SHA=/^[a-f0-9]{64}$/;
async function hash(value){
  const bytes=new TextEncoder().encode(canonicalGateJSON(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function workbenchStudyTarget(report,{slot='first',base=location.href}={}){
  if(!['first','last'].includes(slot)||!Array.isArray(report?.cases))throw Error('The requested study input is not published.');
  const rows=report.cases.filter(row=>row.study_slot===slot);
  if(rows.length!==1)throw Error('The active report has no unique study input for this position.');
  const row=rows[0],c=row.case,b=row.native_public_case_binding,n=row.configurations?.llm_readings?.native_checkpoint;
  const policy=savedSourcePolicy(row.configurations?.llm_readings?.source_view_policy);
  if(row.current_resource_execution!==true||c?.task!=='redaction'||c.corpus!=='cib'||
    typeof c.case_id!=='string'||!c.case_id||typeof c.query!=='string'||!c.query.trim()||
    row.reference_answer_kind!=='unknown_still_withheld'||row.reference_answer_available===true||
    row.reference_answer!=null||row.gold!=null||!['supplied_documents_inclusive','later_release_inclusive'].includes(policy.id)||
    b?.state!=='PASS'||b.native_packet_modified!==false||!SHA.test(b.query_sha256||'')||
    !n||!SHA.test(n.sha256||'')||n.path!==b.native_checkpoint?.path||n.sha256!==b.native_checkpoint?.sha256)
    throw Error('The study lacks its exact saved-input, unknown-truth or source-view binding.');
  const caseHash=await hash(c);
  if(b.query_sha256!==await hash(c.query)||b.public_case_sha256!==caseHash||
    b.native_public_case_sha256!==caseHash||b.native_case_sha256!==caseHash)
    throw Error('The study public input differs from its saved native binding.');
  const target=new URL('workbench-v6.html',base);
  target.search=new URLSearchParams({case:c.case_id,arm:'A'}).toString();return target;
}

export function linkWorkbenchStudyNavigation(root=document){
  for(const anchor of root.querySelectorAll('a[href]')){
    const url=new URL(anchor.href,location.href);
    if(url.origin!==location.origin||!url.pathname.endsWith('/swedish-study.html'))continue;
    const target=new URL('workbench-v6.html',url);target.search='study=first';
    anchor.href=target.href;anchor.dataset.studyNavigation='active-report';
  }
}

async function boot(){
  const status=document.getElementById('study-status');if(!status)return;
  try{
    const params=new URLSearchParams(location.search);
    if([...params.keys()].some(key=>key!=='slot')||params.getAll('slot').length>1)throw Error('Choose one published study position.');
    if(!globalThis.PublicReplay?.verified)throw Error('The pinned public report transport is unavailable.');
    const packet=await PublicReplay.verified('/data/report-v6.json');
    const report=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(packet.decoded));
    const target=await workbenchStudyTarget(report,{slot:params.get('slot')||'first'});
    status.textContent='Opening the bound saved input. Historical truth remains unknown.';
    location.replace(target.href);
  }catch(error){status.textContent=error.message;status.dataset.error='true';}
}
if(typeof document!=='undefined')void boot();

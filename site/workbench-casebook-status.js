// Presentation snapshots only. No selected reading, rank, QA grade or Live state.
import {sidebarDecisionSummary,canonicalGateJSON} from './local-decisions-v65.js';
import {hash} from './r-contract.js';

export const CASEBOOK_STATUS_VERSION='casebook-display-status/1';
const SHA=/^[a-f0-9]{64}$/;
const ascii=text=>JSON.stringify(text).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const copy=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const COLORS={supported:'#217358',partial:'#a77a25',context:'#71827c',mixed:'#9b6c35',opposed:'#a44a40',unresolved:'#77817e',unavailable:'#a0a8a4'};
const validSummary=s=>s&&typeof s.title==='string'&&s.title.trim()&&Object.hasOwn(COLORS,s.tone)&&
  s.world_truth_certified===false&&Number.isSafeInteger(s.total)&&s.total>0&&
  (s.complete===null||Number.isSafeInteger(s.complete)&&s.complete>=0&&s.complete<=s.total);
const unavailable=(id,reason)=>freeze({version:CASEBOOK_STATUS_VERSION,case_id:id,label:'Unavailable',tone:'unavailable',basis:reason,
  source_truth_certified:false,selection_dependent:false});

export async function prepareCasebookStatuses(rows,{verifiedReportVersion,config='llm_readings',sourceDescriptors=[],signal}={}){
  if(!['narrative-workbench-publication/1','current-workbench-publication/1'].includes(verifiedReportVersion))
    throw Error('A verified saved publication is required for casebook indicators.');
  const snapshot=JSON.stringify(rows),input=copy(rows),descriptors=copy(sourceDescriptors),result={};
  if(!Array.isArray(input)||!Array.isArray(descriptors)||new Set(input.map(r=>r.case?.case_id)).size!==input.length||
      new Set(descriptors.map(d=>d.case_id)).size!==descriptors.length)throw Error('Casebook inventory or status descriptors are duplicated.');
  const byCase=new Map(descriptors.map(d=>[d.case_id,d]));
  for(const row of input){
    if(signal?.aborted)throw new DOMException('Casebook preparation cancelled','AbortError');
    const c=row.case,id=c?.case_id;
    if(typeof id!=='string'||!id||row.execution_kind==='live')throw Error('Only saved casebook inputs have fixed indicators.');
    const querySHA=await hash(ascii(c.query)),method=row.reviewed_source_assessment;
    if(method){
      const d=byCase.get(id);
      if(!d){result[id]=unavailable(id,'source-method-descriptor-not-published');continue;}
      if(d.version!=='casebook-source-summary/1'||d.case_id!==id||d.query_sha256!==querySHA||
          d.query_sha256!==method.query_sha256||d.method_id!==method.method_id||d.config!==config||
          !SHA.test(d.public_view_sha256||'')||d.public_view_sha256!==method.public_view_sha256||
          !validSummary(d.summary)||d.summary.method_id!==method.method_id||
          canonicalGateJSON(d.resource_binding)!==canonicalGateJSON(row.resource_binding))
        throw Error('Casebook source summary has another method, input, resource or view.');
      result[id]=freeze({version:CASEBOOK_STATUS_VERSION,case_id:id,label:d.summary.title,
        tone:d.summary.tone,basis:'pinned-displayed-source-method',method_id:method.method_id,
        public_view_sha256:d.public_view_sha256,query_sha256:querySHA,
        source_truth_certified:false,selection_dependent:false});
      continue;
    }
    const dto=row.decision_summary_by_arm?.[config];
    if(!dto){result[id]=unavailable(id,'saved-summary-not-published');continue;}
    if(dto.query_sha256!==querySHA)throw Error('Casebook native summary has another input.');
    const s=sidebarDecisionSummary(dto,c,config); // Always its saved default, never active reading.
    result[id]=freeze({version:CASEBOOK_STATUS_VERSION,case_id:id,label:s.badge,tone:s.tone,
      basis:'pinned-saved-default-summary',query_sha256:querySHA,source_truth_certified:false,selection_dependent:false});
  }
  if(signal?.aborted)throw new DOMException('Casebook preparation cancelled','AbortError');
  if(JSON.stringify(rows)!==snapshot)throw Error('Casebook input changed during preparation.');
  return freeze(result);
}

export function historicalStudyStatus(metadata){
  if(metadata?.historical_distinct_study!==true||typeof metadata.case_id!=='string'||!SHA.test(metadata.packet_ref?.sha256||''))
    throw Error('An exact historical study metadata binding is required.');
  return freeze({version:CASEBOOK_STATUS_VERSION,case_id:metadata.case_id,label:'Contextual source suggestions',
    tone:'context',basis:'saved-historical-context-only-study',source_truth_certified:false,selection_dependent:false});
}

export function renderCasebookStatusDot(status,{document:doc=globalThis.document}={}){
  if(status?.version!==CASEBOOK_STATUS_VERSION||!Object.hasOwn(COLORS,status.tone)||typeof status.label!=='string'||!status.label||
      status.selection_dependent!==false||status.source_truth_certified!==false)throw Error('A prepared status snapshot is required.');
  const host=doc.createElement('span'),dot=doc.createElement('span');
  host.className='casebook-status-dot';host.dataset.testid='casebook-status-dot';host.dataset.caseId=status.case_id;
  host.dataset.tone=status.tone;host.dataset.statusBasis=status.basis;host.setAttribute('role','img');
  host.setAttribute('aria-label',status.label);host.title=status.label;
  host.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;vertical-align:middle';
  dot.setAttribute('aria-hidden','true');dot.style.cssText='display:block;width:8px;height:8px;border-radius:50%;border:1px solid currentColor;background:'+COLORS[status.tone]+';color:'+COLORS[status.tone];
  host.append(dot);return host;
}

export function unifyCasebookCatalog(rows,{groups=[]}={}){
  const byId=new Map(rows.map(row=>[row.case?.case_id||row.case_id,row]));
  if(byId.size!==rows.length||byId.has(undefined))throw Error('Casebook records must have unique IDs.');
  if(new Set(groups.map(group=>group.episode_key)).size!==groups.length)throw Error('Casebook episode keys must be unique.');
  const used=new Set(),out=[];
  for(const group of groups){
    if(typeof group.episode_key!=='string'||!group.episode_key||!Array.isArray(group.case_ids)||!group.case_ids.length||
        !group.case_ids.includes(group.preferred_case_id)||new Set(group.case_ids).size!==group.case_ids.length)
      throw Error('A reviewed episode group needs one explicit existing representative.');
    for(const id of group.case_ids)if(!byId.has(id)||used.has(id))throw Error('Episode aliases overlap or name an absent record.');
    const representative=byId.get(group.preferred_case_id),first=representative.case||representative;
    if(group.case_ids.some(id=>(byId.get(id).case||byId.get(id)).corpus!==first.corpus))throw Error('Episode grouping cannot cross corpora.');
    group.case_ids.forEach(id=>used.add(id));
    out.push(Object.freeze({episode_key:group.episode_key,representative,aliases:Object.freeze(group.case_ids.map(id=>
      Object.freeze({case_id:id,row:byId.get(id),href:'workbench-v6.html?'+new URLSearchParams({
        [byId.get(id).recovery_metadata||byId.get(id).historical_distinct_study?'recovery':'case']:id})}))),
      original_records_merged:false,ranks_or_results_changed:false}));
  }
  for(const [id,row]of byId)if(!used.has(id))out.push(Object.freeze({episode_key:id,representative:row,
    aliases:Object.freeze([Object.freeze({case_id:id,row,href:'workbench-v6.html?'+new URLSearchParams({
      [row.recovery_metadata||row.historical_distinct_study?'recovery':'case']:id})})]),original_records_merged:false,ranks_or_results_changed:false}));
  return Object.freeze(out);
}

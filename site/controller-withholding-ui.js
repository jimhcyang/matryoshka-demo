import {canonicalGateJSON} from './local-decisions-v65.js';
import {formatDecisionScore} from './decision-scores.js';

// Presentation only: replay the native shortlist audit, never classify or select.
// This module never selects, removes, ranks or changes a native candidate.
export const CONTROLLER_WITHHOLDING_VIEW='controller-withholding-ui/1';
export const CONTROLLER_SHORTLIST_POLICY='controller-compatibility-shortlist/1';
const check=(value,message)=>{if(!value)throw Error('Saved compatibility audit: '+message);};
const ids=value=>Array.isArray(value)&&value.every(id=>typeof id==='string'&&id)&&new Set(value).size===value.length;
const sameIDs=(a,b)=>ids(a)&&ids(b)&&a.length===b.length&&a.every(id=>b.includes(id));
async function digest(value){
  const bytes=new TextEncoder().encode(canonicalGateJSON(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}

export async function nativeControllerWithholdingViews(record,caseInfo){
  const result=record?.result?.redaction||record?.result,policy=result?.controller_shortlist;
  if(!policy){
    check(result?.version!=='narrative-bounded-red-construction/32','the v32 shortlist inventory is missing.');
    return null;
  }
  check(caseInfo?.task==='redaction'&&typeof caseInfo.query==='string','the public question is missing.');
  const queryHash=await digest(caseInfo.query);
  check(result.query_sha256===queryHash,'the public-query hash differs.');
  check(policy.version===CONTROLLER_SHORTLIST_POLICY&&policy.audit_collection==='assessed_candidates'&&
    policy.local_decisions_unchanged===true&&policy.withholding_is_factual_rejection===false&&
    policy.no_additional_checks_or_allocation===true,'the native non-rejection policy is incomplete.');
  const rolePolicy=result.controller_role_policy;
  check(rolePolicy?.shortlist_policy_version===policy.version&&rolePolicy.holds_exclude_insertion===false&&
    rolePolicy.target_kind_modified===false&&rolePolicy.valid_frame_holds_withheld_from_shortlist===true&&
    rolePolicy.withheld_is_factual_rejection===false&&rolePolicy.source_or_factual_gates_bypassed===false&&
    rolePolicy.compatibility_is_support===false,'the native role-policy binding differs.');
  const rows=result.readings,pool=result.assessed_candidates,counts=policy.counts_by_reading;
  check(Array.isArray(rows)&&ids(rows.map(row=>row.reading?.id))&&Array.isArray(pool)&&
    ids(pool.map(candidate=>candidate.id))&&counts&&typeof counts==='object','the reading or raw inventory is incomplete.');
  const readingIDs=rows.map(row=>row.reading.id),held=pool.filter(candidate=>candidate.controller_shortlist_eligibility?.state==='withheld_unresolved');
  check(pool.every(candidate=>readingIDs.includes(candidate.reading_id))&&
    sameIDs(policy.withheld_candidate_ids,held.map(candidate=>candidate.id)),'the withheld IDs do not resolve to the original inventory.');
  const views=new Map();let displayed=0;
  for(const row of rows){
    const rid=row.reading.id,own=pool.filter(candidate=>candidate.reading_id===rid),withheld=held.filter(candidate=>candidate.reading_id===rid),count=counts[rid];
    check(Array.isArray(row.candidates)&&ids(row.candidates.map(candidate=>candidate.id))&&
      row.candidates.every(candidate=>own.some(raw=>raw.id===candidate.id)&&!held.some(raw=>raw.id===candidate.id)),
      'the displayed shortlist and raw inventory disagree.');
    check(count&&['assessed','eligible','withheld','displayed'].every(key=>Number.isSafeInteger(count[key])&&count[key]>=0)&&
      count.assessed===own.length&&count.withheld===withheld.length&&count.eligible===own.length-withheld.length&&
      count.displayed===row.candidates.length&&sameIDs(count.withheld_candidate_ids,withheld.map(candidate=>candidate.id)),
      'the per-reading counts or IDs disagree.');
    for(const candidate of withheld){
      const marker=candidate.controller_shortlist_eligibility,controller=candidate.controller_role_fit,frame=controller?.query_frame;
      check(originalCandidate(candidate)&&candidate.declared_reading?.id===rid&&
        marker.version===policy.version&&marker.reason==='VALID_CONTROLLER_ROLE_COMPATIBILITY_UNRESOLVED'&&
        marker.factual_rejection===false&&marker.factual_counterevidence===false&&marker.local_decision_modified===false&&
        marker.raw_candidate_retained===true&&marker.withholding_is_not_proof_of_incompatibility===true&&
        marker.query_sha256===queryHash&&marker.reading_sha256===await digest(candidate.declared_reading)&&
        marker.controller_receipt_sha256===await digest(controller)&&marker.query_frame_sha256===await digest(frame)&&
        controller.state==='hold'&&controller.excludes_insertion===false&&controller.factual_support_certified===false&&
        controller.support_promotion_permitted===false&&controller.reading_modified===false&&
        frame.state==='actor_control_hypothesis'&&frame.query_sha256===queryHash&&frame.reading_sha256===marker.reading_sha256&&
        frame.query_only===true&&frame.source_access===false&&frame.candidate_access===false&&frame.reading_modified===false,
        'a withheld candidate lost its original decision, source or bound HOLD receipt.');
    }
    displayed+=row.candidates.length;
    views.set(rid,{version:CONTROLLER_WITHHOLDING_VIEW,readingId:rid,displayedCount:count.displayed,candidates:withheld});
  }
  check(policy.assessed_count===pool.length&&policy.withheld_count===held.length&&
    policy.eligible_count===pool.length-held.length&&policy.displayed_count===displayed,'the total counts disagree.');
  return views;
}

function node(tag,text,attrs={}){
  const value=document.createElement(tag);
  if(text!=null)value.textContent=String(text);
  for(const [key,item] of Object.entries(attrs))if(item!=null)value.setAttribute(key,String(item));
  return value;
}
function originalCandidate(value){
  return value&&typeof value.id==='string'&&value.id&&typeof value.fill==='string'&&value.fill.trim()&&
    value.local_decision&&typeof value.local_decision==='object'&&!Array.isArray(value.local_decision)&&
    typeof value.local_decision.status==='string'&&Array.isArray(value.sources);
}
function rawRecord(title,value,{open=false}={}){
  const details=node('details',null,{class:'method-audit'});details.open=open;
  details.append(node('summary',title));
  let rendered=false;
  const render=()=>{
    if(rendered||!details.open)return;rendered=true;
    const pre=node('pre',JSON.stringify(value,null,2),{class:'raw-record'});
    pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';details.append(pre);
  };
  details.addEventListener('toggle',render);if(open)render();return details;
}

export function controllerWithholdingEmptyText(view){
  if(view?.version!==CONTROLLER_WITHHOLDING_VIEW||view.displayedCount!==0)return null;
  return 'No candidates are automatically shortlisted for this reading. This is not a factual rejection or a finding that no source information exists.';
}

export function renderControllerWithholding(view,{activeReadingId,onInspect}={}){
  if(view==null)return null;
  if(view.version!==CONTROLLER_WITHHOLDING_VIEW||typeof view.readingId!=='string'||!view.readingId||
      !Number.isSafeInteger(view.displayedCount)||view.displayedCount<0||!Array.isArray(view.candidates)||
      view.candidates.some(candidate=>!originalCandidate(candidate)||candidate.reading_id!==view.readingId)||
      new Set(view.candidates.map(candidate=>candidate.id)).size!==view.candidates.length||
      view.candidates.length&&typeof onInspect!=='function')throw Error('A complete active-reading withholding presentation is required.');
  if(view.readingId!==activeReadingId)return null;
  const host=node('section',null,{class:'notice','data-testid':'controller-withholding','data-reading-id':view.readingId});
  host.append(node('h3','Compatibility unresolved'));
  const empty=controllerWithholdingEmptyText(view);if(empty)host.append(node('p',empty,{'data-testid':'controller-shortlist-empty'}));
  host.append(node('p','These candidates are withheld from the automatic shortlist because their fit in this grammatical role remains unresolved. They are not being declared false or opposed. Their original evidence decisions and source records are unchanged.'));
  const details=node('details',null,{'data-testid':'controller-withheld-list'});details.open=view.displayedCount===0;
  details.append(node('summary',`Withheld candidates (${view.candidates.length})`));
  for(const candidate of view.candidates){
    const row=node('section',null,{class:'method-audit','data-testid':'controller-withheld-item','data-candidate-id':candidate.id});
    const inspect=node('button','Original decision and sources',{type:'button','data-testid':'controller-withheld-inspect'});
    inspect.onclick=()=>onInspect(candidate);
    row.append(node('strong',candidate.fill),node('p','Compatibility unresolved; not a factual rejection.'),inspect);details.append(row);
  }
  if(!view.candidates.length)details.append(node('p','No withheld entries are recorded in this audit. Missing entries are not inferred.'));
  host.append(details);return host;
}

export function renderControllerWithheldAudit(candidate,{makeSourceButton,decisionText}={}){
  if(!originalCandidate(candidate))throw Error('The complete original candidate and decision are required.');
  const host=node('section',null,{'data-testid':'controller-withheld-audit','data-candidate-id':candidate.id});
  host.append(node('blockquote',candidate.fill,{class:'cue'}),
    node('p','Withheld from automatic shortlisting because compatibility is unresolved. This review does not change the original evidence decision, score, rank or source records.',{class:'notice'}),
    node('h3','Original evidence decision'),node('p',decisionText?.(candidate.local_decision)||candidate.local_decision.label||candidate.local_decision.status));
  host.append(rawRecord('Complete original evidence decision',candidate.local_decision,{open:true}));
  if(Number.isFinite(candidate.rank))host.append(node('p','Recorded original rank: '+candidate.rank));
  if(Number.isFinite(candidate.score))host.append(node('p','Recorded original score: '+formatDecisionScore(candidate.score)+' (unchanged, not confidence).'));
  const rawScore=candidate.controller_shortlist_eligibility?.raw_v3_scorecard;
  if(rawScore)host.append(rawRecord('Original v3 scorecard / not confidence',rawScore));
  host.append(node('h3','Original source wording'),node('blockquote',candidate.source_wording||'Not recorded in this snapshot.',{class:'cue'}),node('h3','Original source records'));
  for(const proof of candidate.sources){
    if(makeSourceButton)host.append(makeSourceButton(proof));
    else host.append(rawRecord('Recorded source quotation and binding',proof));
  }
  if(!candidate.sources.length)host.append(node('p','No source records were attached to this preserved snapshot.'));
  host.append(rawRecord('Complete original candidate record / unchanged',candidate));return host;
}

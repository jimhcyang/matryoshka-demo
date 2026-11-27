// Source-owned context priority only. No probability, new evidence or rank spacing.
import {bindContextPriorityWire,v8WireHash,assertContextPriorityWire,contextPriorityWireMetadata} from './v8-json-wire.js';
export {bindContextPriorityWire};
export const CONTEXT_PRIORITY_VERSION='terminal-evidence-fit/8';
const PRODUCER='phase-source-page-context-rank/8';
const UNITS='TIERED_CONTEXT_PRIORITY_INDEX_NOT_PROBABILITY';
const RUBRICS=Object.freeze({page_local_information_55_25_20:[.55,.25,.20],page_local_75_25:[.75,.25,0]});
const check=(ok,message)=>{if(!ok)throw Error('V8 score binding: '+message);};
const number=value=>typeof value==='number'&&Number.isFinite(value);
const close=(a,b)=>number(a)&&number(b)&&Math.abs(a-b)<=1e-12;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const terms=value=>Array.isArray(value)&&value.every(word=>typeof word==='string'&&word)&&new Set(value).size===value.length;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const verifiedRecords=new WeakMap();
function nativeTier(native){
  const status=native.local_decision?.status;
  return status==='evidence_backed_suggestion'?2:status==='partial_grounding'?
    (native.local_decision.requirements?.some(r=>r.coverage==='Established')?1:0):status==='exploratory_contextual'?0:-1;
}
function candidateRows(result){
  return result.readings.flatMap((branch,r)=>[...(branch.candidates||[]).map((native,i)=>({native,path:['result','readings',r,'candidates',i]})),
    ...(branch.reserve_candidates||[]).map((native,i)=>({native,path:['result','readings',r,'reserve_candidates',i]}))]);
}
export function validateContextPriorityCard(card,native,record){
  check(card?.version===CONTEXT_PRIORITY_VERSION&&card.id===native.id&&card.candidate_id===native.id&&card.fill===native.fill&&
    same(card,native.terminal_scorecard)&&card.native_status===native.local_decision?.status,'candidate/card identity differs');
  const weights=RUBRICS[card.rubric],raw=card.raw_features;
  check(weights&&same(card.weights,weights)&&exact(raw,['page_focal_content_containment','previous_local_fit','bounded_previous_local_fit','nonrepeated_candidate_content_fraction']), 'rubric/raw feature schema differs');
  const {page_focal_content_containment:p,previous_local_fit:prior,bounded_previous_local_fit:l,nonrepeated_candidate_content_fraction:n}=raw;
  check([p,prior,l,n].every(number)&&p>=0&&p<=1&&n>=0&&n<=1&&l===Math.min(1,Math.max(0,prior)),'nonfinite/out-of-range feature');
  const components={page_focal_content:weights[0]*p,bounded_prior_local_fit:weights[1]*l,nonrepeated_candidate_content:weights[2]*n};
  const index=Object.values(components).reduce((a,b)=>a+b,0),tier=nativeTier(native),score=(tier+.99*index)/3;
  const ranking={evidence_tier_contribution:tier/3,context_contribution:.99*index/3,context_index:index,context_scale:.99,tier_divisor:3};
  check([0,1,2].includes(tier)&&card.evidence_tier===tier&&card.native_evidence_tier===tier&&
    exact(card.components,Object.keys(components))&&Object.keys(components).every(k=>close(card.components[k],components[k]))&&
    exact(card.ranking_components,Object.keys(ranking))&&Object.keys(ranking).every(k=>close(card.ranking_components[k],ranking[k]))&&
    close(card.context_index,index)&&close(card.score,score)&&same(card.score_range,[0,2.99/3]),'55/25/20 tier arithmetic differs');
  check(card.score_units===UNITS&&card.calibrated_probability===false&&card.source_page_union_used===false&&
    card.BM25_or_retrieval_weight_in_context_index===false&&card.truth_support_or_eligibility_changed===false&&
    card.visible_repetition_is_not_factual_rejection===true&&card.legacy_evidence_features_are_not_v8_score_components===true&&
    card.normalization==='OPAQUE_MASK_TO_SPACES_THEN_LOWERCASE_CONTENT_LEMMAS_MINUS_STOPWORDS','priority units/unchanged-gate scope differs');
  const legacy=card.legacy_native_features;
  check(legacy&&legacy.evidence_tier===tier&&card.native_score_version===legacy.version&&card.native_score===legacy.score&&
    card.fit===prior&&['support','oppose','context','fit','criteria_coverage'].every(k=>number(card[k])&&card[k]===(legacy[k]??0))&&
    ['support','oppose','context'].every(k=>card[k]>=0)&&card.criteria_coverage>=0&&card.criteria_coverage<=1&&
    same(card.contributions,legacy.contributions||[])&&same(card.native_source_function_band,legacy.source_function_band??null),'legacy evidence was changed/rescaled');
  check(terms(card.candidate_content_terms)&&terms(card.repeated_visible_content_terms)&&terms(card.visible_content_terms)&&terms(card.focal_content_terms)&&
    card.repeated_visible_content_terms.every(t=>card.candidate_content_terms.includes(t))&&
    close(n,card.candidate_content_terms.length?(card.candidate_content_terms.length-card.repeated_visible_content_terms.length)/card.candidate_content_terms.length:0),'nonrepeated content fraction differs');
  check(card.candidate_content_terms.filter(t=>card.visible_content_terms.includes(t)).every(t=>card.repeated_visible_content_terms.includes(t))&&
    card.repeated_visible_content_terms.every(t=>card.visible_content_terms.includes(t)||card.lexical_provenance?.eligible===true&&card.candidate_content_terms.length===1),'visible repetition/license scope differs');
  const observations=card.source_page_observations;
  check(Array.isArray(observations)&&observations.length>0,'citation-owned page observations missing');
  const inspected=new Map(record.result.context_rank_v8.inspected_page_bindings.map(p=>[p.canonical_page_id,p.page_sha256]));
  for(const observation of observations){
    const ref=observation.citation,span=observation.source_span;
    check(ref&&native.sources?.some(r=>same(r,ref))&&native.source_occurrences?.some(o=>same(o.citation,ref)&&same(o.source_span,span)&&o.source_wording===observation.source_wording)&&
      observation.canonical_page_id===ref.canonical_page_id&&observation.document_id===ref.document_id&&observation.date===ref.date&&
      observation.full_page_sha256===ref.page_sha256&&inspected.get(ref.canonical_page_id)===ref.page_sha256&&sha(observation.full_page_utf8_sha256), 'context borrowed an unowned/uninspected page');
    const quote=Array.from(ref.text||'');
    check(Number.isSafeInteger(ref.start)&&Number.isSafeInteger(ref.end)&&ref.start>=0&&ref.end>ref.start&&quote.length===ref.end-ref.start&&
      Array.isArray(span)&&span.length===2&&span.every(Number.isSafeInteger)&&ref.start<=span[0]&&span[0]<span[1]&&span[1]<=ref.end&&
      quote.slice(span[0]-ref.start,span[1]-ref.start).join('')===observation.source_wording,'own source span/text changed');
    check(Number.isSafeInteger(observation.focal_term_count)&&observation.focal_term_count===card.focal_content_terms.length&&
      Number.isSafeInteger(observation.page_content_term_count)&&observation.page_content_term_count>=0&&terms(observation.matched_focal_terms)&&
      observation.matched_focal_terms.every(t=>card.focal_content_terms.includes(t))&&observation.matched_focal_terms.length<=observation.page_content_term_count&&
      close(observation.containment,observation.focal_term_count?observation.matched_focal_terms.length/observation.focal_term_count:0),'page containment terms/counts differ');
  }
  const winner=observations.reduce((a,b)=>b.containment>a.containment?b:a);
  check(close(p,winner.containment)&&card.selected_source_page===winner.canonical_page_id,'source page MAX differs');
  return score;
}
export function computeContextPriorityScores(record){
  const result=record.result,score=result?.terminal_scores,context=result?.context_rank_v8;
  check(result&&Array.isArray(result.readings)&&exact(score,['version','probability','ranking_applied','judgments_unchanged','source_function_bonus_applied','readings','legacy_overall_auxiliary'])&&
    score.version===CONTEXT_PRIORITY_VERSION&&score.probability===false&&score.ranking_applied===true&&score.judgments_unchanged===true&&score.source_function_bonus_applied===false,'v8 terminal contract missing');
  check(context?.version===PRODUCER&&context.score_version===CONTEXT_PRIORITY_VERSION&&same(context.weights,RUBRICS[context.rubric])&&
    context.input_or_model_nomination_used===false&&context.facts_classes_gates_unchanged===true&&context.legacy_evidence_values_rescaled===false&&
    context.candidates_scored_after_source_local_consolidation===true&&Array.isArray(result.assessed_candidates)&&
    same(context.withheld_candidate_ids,result.controller_shortlist?.withheld_candidate_ids||[])&&
    Array.isArray(context.inspected_page_bindings)&&same(context.inspected_page_bindings.map(p=>p.canonical_page_id),result.inspected_page_ids)&&
    new Set(result.inspected_page_ids).size===result.inspected_page_ids.length&&context.inspected_page_bindings.every(p=>sha(p.page_sha256)), 'full-pool/controller/inspection contract differs');
  check(Array.isArray(score.readings)&&score.readings.length===result.readings.length&&
    same(score.legacy_overall_auxiliary,result.legacy_terminal_scores_before_v8?.overall??null),'reading inventory/legacy auxiliary differs');
  const seen=new Set();
  result.readings.forEach((branch,i)=>{
    const s=score.readings[i],display=branch.candidates,reserve=branch.reserve_candidates;
    check(exact(s,['reading_id','candidates','reserve_candidates'])&&s.reading_id===branch.reading?.id&&Array.isArray(display)&&Array.isArray(reserve)&&
      display.length<=5&&display.length+reserve.length<=10&&same(s.candidates,display.map(c=>c.terminal_scorecard))&&
      same(s.reserve_candidates,reserve.map(c=>c.terminal_scorecard)),'display/reserve score inventory differs');
    const candidates=[...display,...reserve];
    candidates.forEach((native,index)=>{
      check(!seen.has(native.id)&&native.reading_id===branch.reading.id&&native.declared_reading?.id===branch.reading.id&&native.rank===index+1,'candidate reading/rank identity differs');
      seen.add(native.id);
      validateContextPriorityCard(native.terminal_scorecard,native,record);
      check(!context.withheld_candidate_ids.includes(native.id)&&native.terminal_scorecard.rubric===context.rubric,'withheld/mixed rubric candidate');
      if(index)check(native.terminal_scorecard.score<=candidates[index-1].terminal_scorecard.score+1e-12,'native candidate order differs from v8 index');
    });
  });
  return score;
}
export async function verifyContextPriorityScoreBindings(record,caseInfo,_digest,{rawVerifiedJSON,nativePath=[],narrativeProjection=false}={}){
  if(rawVerifiedJSON!==undefined)bindContextPriorityWire(record,rawVerifiedJSON,{nativePath,narrativeProjection});
  assertContextPriorityWire(record);
  computeContextPriorityScores(record);
  check(record.case?.query===caseInfo?.query&&record.case?.focal_marker===caseInfo?.focal_marker&&record.case?.case_id===caseInfo?.case_id,'different public case');
  const context=record.result.context_rank_v8;
  const authority=contextPriorityWireMetadata(record),binding=authority.source.binding;
  check(same(context.source_binding,binding)&&same(binding,record.binding??record.index_ref)&&same(context.source_view_policy,record.configuration?.source_view_policy)&&
    same(record.result.source_view_policy,context.source_view_policy)&&binding?.corpus===record.case.corpus&&
    typeof binding.resource_id==='string'&&binding.resource_id&&sha(binding.sha256)&&sha(binding.registry_sha256),'native policy/index binding differs');
  check(await v8WireHash(record,['case','query'])===record.plan?.query_sha256&&record.result.query_sha256===record.plan.query_sha256&&
    await v8WireHash(record,['result','assessed_candidates'])===context.raw_assessed_pool_sha256&&
    await v8WireHash(record,['result'])===record.native_checksum,'native/raw pool checksum differs');
  if(authority.narrativeProjection)check(sha(record.native_record_sha256)&&await v8WireHash(record,[])===record.native_record_sha256,'condition projection belongs to another native record');
  const planHash=await v8WireHash(record,['plan']),query=Array.from(caseInfo.query),at=Array.from(caseInfo.query.slice(0,caseInfo.query.indexOf(caseInfo.focal_marker))).length;
  for(const {native,path} of candidateRows(record.result)){
    const card=native.terminal_scorecard,span=card.focal_query_span;
    check(card.query_sha256===record.plan.query_sha256&&card.plan_sha256===planHash&&same(card.source_context_binding,binding)&&
      same(card.source_view_policy,context.source_view_policy)&&card.candidate_binding_contract==='FINAL_CONSOLIDATED_ENTITY_EXCLUDING_RANK_SCORECARD_AND_RANKING_DISPLAY_FIELDS'&&
      await v8WireHash(record,[...path,'local_decision'])===card.native_decision_sha256&&
      await v8WireHash(record,path,{candidateProjection:true})===card.raw_candidate_sha256,'final candidate/query/decision hash differs');
    check(span&&Number.isSafeInteger(span.start)&&Number.isSafeInteger(span.end)&&span.start<=at&&span.end>=at+Array.from(caseInfo.focal_marker).length&&
      span.start>=0&&span.end<=query.length&&query.slice(span.start,span.end).join('')===span.text,'focal raw query span differs');
    const license=card.lexical_provenance,audit=native.lexical_realization;
    if(audit?.state==='licensed'){
      check(license?.eligible===true&&license.actual_wordnet_replayed===true&&license.source_identity===native.source_wording&&
        license.audit_sha256===await v8WireHash(record,[...path,'lexical_realization'])&&same(license.resource,audit.resource)&&
        same(license.source_quote,audit.original_quote)&&native.sources.some(ref=>same(ref,license.source_quote))&&
        audit.context_only===true&&audit.factual_support_certified===false&&audit.same_owner_or_event_certified===false&&
        audit.used_as_retrieval_seed===false&&audit.source_nominated_before_realization===true&&audit.source_wording_modified===false&&
        audit.proposed_insertion===native.fill&&audit.source_identity===native.source_wording&&same(audit.source_span,native.source_span),'licensed source form lost its exact audit binding');
    }else check(license===null,'unexpected lexical license');
  }
  assertContextPriorityWire(record);
  verifiedRecords.set(record,record.native_checksum);
}
export function formatContextPriorityScore(value){
  if(!number(value))return 'Not recorded';
  return value.toFixed(4);
}
export function contextPriorityReadout(record){
  const score=computeContextPriorityScores(record);
  return {version:CONTEXT_PRIORITY_VERSION,label:'Context priority index',probability:false,
    readings:score.readings.map(r=>({reading_id:r.reading_id,candidates:r.candidates.map(c=>({id:c.id,score:c.score,
      display:formatContextPriorityScore(c.score),evidence_tier:c.evidence_tier,label:'Context priority index'}))}))};
}
export function renderContextPriorityCards(record,{readingId,formatText=value=>value,onInspect,onExplain}={}){
  check(verifiedRecords.get(record)===record.native_checksum,'verify the exact raw native binding before rendering');
  assertContextPriorityWire(record);
  const view=contextPriorityReadout(record),branch=record.result.readings.find(b=>b.reading.id===readingId)||
    (!readingId?record.result.readings.find(b=>b.candidates.length):null);
  check(branch,'selected v8 reading is not recorded');
  const host=document.createElement('section');host.className='terminal-scorecards';host.dataset.testid='context-priority-scorecards';
  const title=document.createElement('h3');title.textContent='Context priority index';host.append(title);
  const labels={evidence_backed_suggestion:'Evidence-backed suggestion',partial_grounding:'Partially grounded',exploratory_contextual:'Exploratory / contextual'};
  for(const native of branch.candidates){
    const row=document.createElement('div');row.className='terminal-score-card';row.dataset.candidateId=native.id;
    const fill=document.createElement('strong');fill.textContent=formatText(native.fill);
    const score=document.createElement('span');score.dataset.testid='context-priority-value';score.textContent=formatContextPriorityScore(native.terminal_scorecard.score);
    const status=document.createElement('span');status.textContent=labels[native.local_decision.status];
    row.append(fill,document.createTextNode(' / '),score,document.createTextNode(' / '),status);
    for(const [label,action] of [['Inspect source',onInspect],['Score details',onExplain]])if(typeof action==='function'){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>action(native));row.append(button);
    }
    host.append(row);
  }
  return host;
}

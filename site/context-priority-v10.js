// Bind the exact native before rendering; never derive a new order from the scalar.
import {replayContextPriorityV10} from './context-priority-v10-math.js';
import * as legacy from './legacy-decision-scores.js';
import {bindContextPriorityWire,assertContextPriorityWire,contextPriorityWireMetadata,contextPriorityEnvelopeResource,contextPriorityWireToken,v8WireHash} from './v8-json-wire.js';
export const CONTEXT_PRIORITY_V10_VERSION='terminal-context-priority/10';
const PRODUCER='source-human-recency-context-rank/10';
const UNITS='TIERED_CONTEXT_PRIORITY_ORDINAL_NOT_PROBABILITY';
const verified=new WeakMap();
const attempts=new WeakMap();
function beginAttempt(record){const token=Object.freeze({});verified.delete(record);attempts.set(record,token);return token;}
export function revokeContextPriorityV10(record){if(record&&typeof record==='object')beginAttempt(record);}
const check=(ok,message)=>{if(!ok)throw Error('V10 native binding: '+message);};
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const number=x=>typeof x==='number'&&Number.isFinite(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&same(Object.keys(x).sort(),[...keys].sort());
const terms=x=>Array.isArray(x)&&new Set(x).size===x.length&&x.every(t=>typeof t==='string'&&/^[a-z0-9]+$/.test(t));
const close=(a,b)=>number(a)&&number(b)&&Math.abs(a-b)<=1e-12;
function envelopeResourceMatches(envelope,binding,record,selected){
  const pins={resource_id:binding.resource_id,index_sha256:binding.sha256,registry_sha256:binding.registry_sha256};
  if(exact(envelope,Object.keys(pins)))return same(envelope,pins)&&
    (selected===undefined||Object.keys(pins).every(k=>selected?.[k]===pins[k]));
  const keys=[...Object.keys(pins),'corpus','graph_id','hierarchy_id','source_status'];
  return exact(envelope,keys)&&exact(selected,keys)&&same(envelope,selected)&&same(envelope,record.resource_binding)&&
    Object.keys(pins).every(k=>envelope[k]===pins[k])&&envelope.corpus===binding.corpus&&envelope.corpus===record.case.corpus&&
    envelope.source_status==='CURRENT_NATIVE_RESOURCE_EXPLICIT'&&envelope.source_status===binding.source_status&&
    ['graph_id','hierarchy_id'].every(k=>typeof envelope[k]==='string'&&envelope[k].length>0&&envelope[k].length<=256&&!/[\s\u0000-\u001f]/.test(envelope[k]));
}
const cut=(text,a,b)=>Array.from(text).slice(a,b).join('');
const span=(query,s)=>Number.isSafeInteger(s?.start)&&Number.isSafeInteger(s?.end)&&s.start>=0&&s.start<s.end&&s.end<=Array.from(query).length&&cut(query,s.start,s.end)===s.text;
const wordSet=text=>new Set((text.toLowerCase().match(/[a-z0-9]+/g)||[]));
const tier=c=>c.local_decision?.status==='evidence_backed_suggestion'?2:c.local_decision?.status==='partial_grounding'?
  (c.local_decision.requirements?.some(r=>r.coverage==='Established')?1:0):c.local_decision?.status==='exploratory_contextual'?0:-1;

// A validation-only one-card view invokes the unchanged real V7/adjunct guards.
// It is never a replacement native record, source certificate or published artifact.
function legacyRecord(native,record){
  const card=native.terminal_scorecard.native_v7_auxiliary;
  return {...record,result:{...record.result,atoms:[],readings:[{reading:native.declared_reading,candidates:[{...native,terminal_scorecard:card}]}],
    terminal_scores:{version:'terminal-evidence-fit/7',probability:false,ranking_applied:false,judgments_unchanged:true,
      readings:[{id:native.reading_id,candidates:[card]}],atoms:[],overall:{}}}};
}
function publicContext(context,record,reading){
  const query=record.case.query,marker=record.case.focal_marker,chars=Array.from(query);
  check(typeof marker==='string'&&marker&&query.split(marker).length===2,'one exact public focal marker required');
  const lo=Array.from(query.slice(0,query.indexOf(marker))).length,hi=lo+Array.from(marker).length;
  const nominal=['form','outer_family'].every(k=>reading[k]==='nominal')&&reading.role==='possessor'&&reading.function==='possessor';
  if(!nominal){check(same(context,{active:false,reason:'NO_DECLARED_NOMINAL_POSSESSOR'}),'nonpossessor activation');return;}
  let hint=null;
  for(const attachment of reading.attachment_spans||[]){
    check(span(query,attachment),'attachment source span differs');
    if(attachment.start<hi||chars.slice(hi,attachment.start).join('').trim())continue;
    const match=/^\s*[,;]\s*(he|she)\b/i.exec(chars.slice(attachment.end).join(''));
    if(match){const start=attachment.end+Array.from(match[0].slice(0,match[0].indexOf(match[1]))).length;
      hint={pronoun_span:{start,end:start+Array.from(match[1]).length,text:match[1]},attachment_span:attachment,identity_or_coreference_certified:false};break;}
  }
  const atoms=[],spans=[];
  for(const atom of record.plan.atoms){
    check(Array.isArray(atom.query_spans)&&atom.query_spans.every(s=>span(query,s)),'plan spans do not replay');
    const keep=atom.query_spans.filter(s=>s.start<=lo&&hi<=s.end||hint&&s.start<=hint.pronoun_span.start&&hint.pronoun_span.end<=s.end&&
      !/[.!?\n]/.test(chars.slice(hi,hint.pronoun_span.start).join('')));
    if(keep.length){spans.push(...keep);atoms.push({id:atom.id,query_spans:keep,polarity:atom.polarity??null,modality:atom.modality??null});}
  }
  const unique=[...new Map(spans.map(s=>[JSON.stringify(canonical(s)),s])).values()],b=context.public_span_binding;
  check(unique.some(s=>s.start<=lo&&hi<=s.end)&&context.active===!!hint&&context.reason===(hint?'BOUND_ADJACENT_PRONOUN':'NO_ADJACENT_PERSON_HINT')&&
    context.coreference_or_identity_certified===false&&b?.semantic_coreference_or_identity_certified===false&&
    b.query_sha256===record.plan.query_sha256&&b.reading_id===reading.id&&same(b.person_hint,hint)&&same(b.atoms,atoms)&&same(b.query_spans,unique),
    'public cue/actor/modal/polarity scope differs');
  const words=wordSet(unique.map(s=>s.text.replaceAll(marker,' ')).join(' '));
  check(terms(context.terms)&&context.terms.every(t=>words.has(t))&&terms(b.literal_terms)&&b.literal_terms.every(t=>words.has(t)),
    'context borrowed words outside its exact focal public spans');
}
function sourceFeatures(card,native,record){
  if(card.source_features===null)return;
  const feature=card.source_features,context=card.bindings.public_context;
  check(exact(feature,['winner','observations','each_citation_scored_separately','human_and_date_and_fit_from_same_quote','no_source_or_truth_credit'])&&
    feature.each_citation_scored_separately===true&&feature.no_source_or_truth_credit===true&&Array.isArray(feature.observations)&&feature.observations.length>0,'own-source observations missing');
  const pages=new Map(record.result.context_rank_v10.inspected_page_bindings.map(p=>[p.canonical_page_id,p.page_sha256]));
  for(const o of feature.observations){
    const q=o.citation,bounds=o.source_phrase_span,head=o.source_head;
    check(q&&native.sources?.some(s=>same(s,q))&&q.corpus===record.case.corpus&&pages.get(q.canonical_page_id)===q.page_sha256&&sha(q.page_sha256)&&
      Number.isSafeInteger(q.start)&&Number.isSafeInteger(q.end)&&q.start>=0&&q.end>q.start&&Array.from(q.text||'').length===q.end-q.start&&
      same(bounds,native.source_span)&&Array.isArray(bounds)&&bounds.length===2&&bounds.every(Number.isSafeInteger)&&
      q.start<=bounds[0]&&bounds[0]<bounds[1]&&bounds[1]<=q.end&&o.source_wording===native.source_wording&&
      cut(q.text,bounds[0]-q.start,bounds[1]-q.start)===o.source_wording,'source quote/owner/span/index differs');
    const own=native.source_occurrences?.find(s=>same(s.citation,q)&&same(s.source_span,bounds)&&s.source_wording===o.source_wording&&
      same(s.source_head,head)&&(s.features?.source_ner||'')===o.own_head_ner);
    check(own&&o.coreference_or_factual_support_certified===false,'source feature is not from an unchanged own occurrence');
    const hs=head?.span,bound=Array.isArray(hs)&&hs.length===2&&hs.every(Number.isSafeInteger)&&bounds[0]<=hs[0]&&hs[0]<hs[1]&&hs[1]<=bounds[1]&&
      cut(q.text,hs[0]-q.start,hs[1]-q.start)===head.text;
    const witnesses=(own.features?.source_type_witnesses||[]).filter(w=>bound&&Number.isSafeInteger(w.start)&&Number.isSafeInteger(w.end)&&
      bounds[0]<=w.start&&w.start<=hs[0]&&hs[1]<=w.end&&w.end<=bounds[1]&&w.canonical_page_id===q.canonical_page_id&&w.page_sha256===q.page_sha256&&
      cut(q.text,w.start-q.start,w.end-q.start)===w.label);
    const conflicts=[...new Set(witnesses.map(w=>w.source_entity_type).filter(t=>!['Person','Other',null,undefined].includes(t)))].map(String).sort();
    const persons=witnesses.filter(w=>w.node_id===native.node_id),human=Number(bound&&head.pos==='PROPN'&&!conflicts.length&&
      (persons.some(w=>w.source_entity_type==='Person')||o.own_head_ner==='PERSON'));
    const words=wordSet(q.text),matched=context.terms.filter(t=>words.has(t)).sort(),coverage=context.terms.length?matched.length/context.terms.length:0;
    check(o.own_head_bound===bound&&same(o.person_witnesses,persons)&&same(o.conflicting_own_head_types,conflicts)&&o.human_context_category===human&&
      same(o.matched_focal_terms,matched)&&close(o.literal_focal_coverage,coverage),'Human/fit used another head or quote');
    check(/^\d{4}-\d{2}-\d{2}$/.test(q.date)&&q.date<=record.case.date&&
      (record.result.source_view_policy.date_relation==='<='||record.result.source_view_policy.date_relation==='<'&&q.date<record.case.date),
      'source day violates native policy');
    const age=(Date.parse(record.case.date+'T00:00:00Z')-Date.parse(q.date+'T00:00:00Z'))/86400000,decay=2**(-age/90);
    check(Number.isSafeInteger(age)&&age>=0&&o.source_age_days===age&&o.half_life_days===90&&close(o.decay,decay)&&close(o.context_merit,(1+coverage)*decay),'same-source clock/merit differs');
  }
  const winner=feature.observations.reduce((a,b)=>b.human_context_category>a.human_context_category||b.human_context_category===a.human_context_category&&b.context_merit>a.context_merit?b:a);
  check(same(feature.winner,winner),'one-own-citation winner differs');
}
function candidateRows(record){return record.result.readings.flatMap((b,r)=>[...(b.candidates||[]).map((native,i)=>({native,path:['result','readings',r,'candidates',i]})),
  ...(b.reserve_candidates||[]).map((native,i)=>({native,path:['result','readings',r,'reserve_candidates',i]}))]);}

export function computeContextPriorityV10Scores(record){
  const result=record.result,score=result?.terminal_scores,context=result?.context_rank_v10;
  check(record.case?.task==='redaction'&&result.task==='redaction'&&exact(score,['version','probability','ranking_applied','judgments_unchanged','score_units','readings','legacy_overall_auxiliary'])&&
    score.version===CONTEXT_PRIORITY_V10_VERSION&&score.probability===false&&score.ranking_applied===true&&score.judgments_unchanged===true&&score.score_units===UNITS,'terminal contract differs');
  check(context?.version===PRODUCER&&context.score_version===CONTEXT_PRIORITY_V10_VERSION&&context.half_life_days===90&&context.full_assessed_pool===true&&
    context.input_or_model_nomination_used===false&&context.original_gates_tiers_and_sources_unchanged===true&&context.new_B_or_support_credit===false&&
    context.ranking_contract==='PRESERVE_NON_CONTEXTUAL_SLOTS_THEN_CONTEXTUAL_HUMAN_MERIT_V7_TIES; CLIENT_MUST_NOT_RESORT_BY_DISPLAY_FLOAT'&&
    result.input_nomination==null&&Array.isArray(result.assessed_candidates)&&Array.isArray(context.inspected_page_bindings)&&
    same(context.inspected_page_bindings.map(p=>p.canonical_page_id),result.inspected_page_ids)&&new Set(result.inspected_page_ids).size===result.inspected_page_ids.length&&
    context.inspected_page_bindings.every(p=>sha(p.page_sha256)&&Number.isSafeInteger(p.global_page_index)&&p.global_page_index>=0),'full pool/source/unchanged-gate contract differs');
  check(Array.isArray(score.readings)&&Array.isArray(context.ledger)&&score.readings.length===result.readings.length&&context.ledger.length===result.readings.length&&
    same(score.legacy_overall_auxiliary,result.legacy_terminal_scores_before_v10?.overall??null)&&
    same([...(context.withheld_candidate_ids||[])].sort(),[...(result.controller_shortlist?.withheld_candidate_ids||[])].sort()),'ledger/controller inventory differs');
  const rawIds=result.assessed_candidates.map(c=>c.id),seen=new Set();check(new Set(rawIds).size===rawIds.length,'repeated raw candidate');
  for(const [i,branch]of result.readings.entries()){
    const summary=score.readings[i],ledger=context.ledger[i],rid=branch.reading.id,list=[...branch.candidates,...branch.reserve_candidates];
    check(exact(summary,['reading_id','candidates','reserve_candidates'])&&summary.reading_id===rid&&ledger.reading_id===rid&&branch.candidates.length<=5&&list.length<=10&&
      same(summary.candidates,branch.candidates.map(c=>c.terminal_scorecard))&&same(summary.reserve_candidates,branch.reserve_candidates.map(c=>c.terminal_scorecard))&&
      ledger.raw_assessed_count===result.assessed_candidates.filter(c=>c.reading_id===rid).length&&
      Array.isArray(ledger.ranked_ids)&&new Set(ledger.ranked_ids).size===ledger.ranked_ids.length&&same(list.map(c=>c.id),ledger.ranked_ids.slice(0,list.length)),
      'saved reading/display/reserve/ledger order differs');
    publicContext(ledger.public_context,record,branch.reading);
    const cards=new Map(ledger.full_consolidated_scorecards.map(c=>[c.id,c]));check(cards.size===ledger.full_consolidated_scorecards.length&&ledger.ranked_ids.every(id=>cards.has(id)),'consolidated ledger differs');
    for(const [j,native]of list.entries()){
      const card=native.terminal_scorecard;
      check(!seen.has(native.id)&&native.rank===j+1&&native.reading_id===rid&&same(native.declared_reading,branch.reading)&&card.reading_id===rid&&
        card.id===native.id&&card.fill===native.fill&&card.native_status===native.local_decision?.status&&card.evidence_tier===tier(native)&&
        !context.withheld_candidate_ids.includes(native.id)&&same(cards.get(native.id),card)&&same(card.bindings.public_context,ledger.public_context),'candidate class/rank/reading identity differs');seen.add(native.id);
      replayContextPriorityV10(card,{validateLegacyCard:aux=>{check(same(aux,card.native_v7_auxiliary),'legacy card substituted');legacy.computeDecisionScores(legacyRecord(native,record));return true;}});
      check(card.mode===(ledger.public_context.active&&tier(native)===0&&native.local_decision.status==='exploratory_contextual'?'source_human_recency':'legacy_v7_passthrough'),'active/signed mode differs');
      sourceFeatures(card,native,record);
    }
  }
  check(same(result.candidates,result.readings.flatMap(b=>b.candidates)),'flat native display inventory differs');return score;
}
export async function verifyContextPriorityV10Bindings(record,caseInfo,digest,options={}){
  const attempt=beginAttempt(record),caseSnapshot=JSON.stringify(canonical(caseInfo));
  check(options&&typeof options==='object'&&!Array.isArray(options),'verification options required');
  const {rawVerifiedJSON,nativePath=[],narrativeProjection=false,publicResourceBinding}=options;
  const resourceSnapshot=JSON.stringify(canonical(publicResourceBinding));
  if(rawVerifiedJSON!==undefined)bindContextPriorityWire(record,rawVerifiedJSON,{nativePath,narrativeProjection});
  assertContextPriorityWire(record);
  const wireToken=contextPriorityWireToken(record);
  const context=record.result?.context_rank_v10,authority=contextPriorityWireMetadata(record),binding=authority.source.binding;
  if(authority.narrativeProjection)check(envelopeResourceMatches(contextPriorityEnvelopeResource(record),binding,record,publicResourceBinding),
    'public envelope resource pins differ from original native index');
  check(typeof digest==='function'&&same(record.case,caseInfo)&&record.case.task==='redaction'&&
    same(context?.source_binding,binding)&&same(binding,record.binding??record.index_ref)&&binding.corpus===caseInfo.corpus&&
    typeof binding.resource_id==='string'&&binding.resource_id&&sha(binding.sha256)&&sha(binding.registry_sha256)&&
    same(context.source_view_policy,record.configuration?.source_view_policy)&&same(context.source_view_policy,record.result.source_view_policy),'native input/source/index/policy differs');
  const planHash=await v8WireHash(record,['plan']),caseHash=await v8WireHash(record,['case']),queryHash=await v8WireHash(record,['case','query']);
  check(queryHash===record.plan.query_sha256&&queryHash===record.result.query_sha256&&planHash===record.result.provided_plan_sha256&&
    planHash===context.provided_plan_sha256&&await v8WireHash(record,['result'])===record.native_checksum&&
    await v8WireHash(record,['result','assessed_candidates'])===context.raw_assessed_pool_sha256,'native result/raw pool/plan/query digest differs');
  if(authority.narrativeProjection)check(sha(record.native_record_sha256)&&await v8WireHash(record,[])===record.native_record_sha256,'condition belongs to another full native');
  computeContextPriorityV10Scores(record);
  const readingsHash=await v8WireHash(record,['plan','readings_packet']);
  check(same(record.plan.readings_packet.readings,record.result.readings.map(b=>b.reading)),'declared public readings differ');
  for(const {native,path}of candidateRows(record)){
    const b=native.terminal_scorecard.bindings;
    check(b.case_sha256===caseHash&&b.origin_date===caseInfo.date&&b.query_sha256===queryHash&&b.provided_plan_sha256===planHash&&
      b.readings_sha256===readingsHash&&b.reading_sha256===await v8WireHash(record,[...path,'declared_reading'])&&
      b.raw_candidate_sha256===await v8WireHash(record,path,{candidateProjection:true})&&same(b.source_binding,binding)&&same(b.source_view_policy,context.source_view_policy),
      'case/query/plan/readings/raw candidate/source binding differs');
    await legacy.verifyContextualScoreBindings(legacyRecord(native,record),caseInfo,digest);
  }
  assertContextPriorityWire(record);
  check(attempts.get(record)===attempt&&contextPriorityWireToken(record)===wireToken&&JSON.stringify(canonical(caseInfo))===caseSnapshot&&JSON.stringify(canonical(publicResourceBinding))===resourceSnapshot,
    'verification attempt, selected origin or raw wire was replaced');
  verified.set(record,{checksum:record.native_checksum,wireToken,attempt,caseInfo,caseSnapshot,publicResourceBinding,resourceSnapshot});
}
export function formatContextPriorityV10(value){return number(value)?value.toFixed(4):'Not recorded';}
export function contextPriorityV10Readout(record){const score=computeContextPriorityV10Scores(record);return {version:CONTEXT_PRIORITY_V10_VERSION,label:'Context Priority',probability:false,
  readings:score.readings.map(r=>({reading_id:r.reading_id,candidates:r.candidates.map(c=>({id:c.id,score:c.score,display:formatContextPriorityV10(c.score),evidence_tier:c.evidence_tier,label:'Context Priority'}))}))};}
export function renderContextPriorityV10Cards(record,{readingId,formatText=x=>x,onInspect,onExplain,caseInfo}={}){
  const authority=verified.get(record);
  check(authority&&authority.checksum===record.native_checksum&&authority.attempt===attempts.get(record)&&
    authority.wireToken===contextPriorityWireToken(record)&&authority.caseSnapshot===JSON.stringify(canonical(authority.caseInfo))&&
    authority.resourceSnapshot===JSON.stringify(canonical(authority.publicResourceBinding))&&
    same(record.case,authority.caseInfo)&&(caseInfo===undefined||JSON.stringify(canonical(caseInfo))===authority.caseSnapshot),
    'verify the original full native and exact current origin/wire before rendering');
  assertContextPriorityWire(record);computeContextPriorityV10Scores(record);
  const branch=record.result.readings.find(b=>b.reading.id===readingId)||(!readingId?record.result.readings.find(b=>b.candidates.length):null);check(branch,'selected native reading absent');
  const host=document.createElement('section');host.className='terminal-scorecards';host.dataset.testid='context-priority-scorecards';
  const title=document.createElement('h3');title.textContent='Context Priority';host.append(title);
  const labels={evidence_backed_suggestion:'Evidence-backed suggestion',partial_grounding:'Partially grounded',exploratory_contextual:'Exploratory / contextual'};
  for(const native of branch.candidates){const row=document.createElement('div');row.className='terminal-score-card';row.dataset.candidateId=native.id;
    const fill=document.createElement('strong');fill.textContent=formatText(native.fill);const score=document.createElement('span');score.dataset.testid='context-priority-value';score.textContent=formatContextPriorityV10(native.terminal_scorecard.score);
    const status=document.createElement('span');status.textContent=labels[native.local_decision.status];row.append(fill,document.createTextNode(' / '),score,document.createTextNode(' / '),status);
    for(const [label,action]of [['Inspect source',onInspect],['Score details',onExplain]])if(typeof action==='function'){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>action(native));row.append(button);}
    host.append(row);
  }return host;
}


// The adjunct constructor has its own saved lexical scale, not v7 evidence points.
export const ADJUNCT_SCORE_VERSION='native-own-complement-context-fit/1';
const RELATIVE_SCORE_VERSION='native-source-relative-context-fit/1';
export const ADJUNCT_SCORE_VERSIONS=Object.freeze([ADJUNCT_SCORE_VERSION,RELATIVE_SCORE_VERSION]);
const VERSION='native-source-owned-adjunct-construction/1';
const fail=message=>{throw Error('Adjunct score binding: '+message);};
const check=(ok,message)=>{if(!ok)fail(message);};
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-12;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const fraction=x=>Number.isFinite(x)&&x>=0&&x<=1;
const terms=x=>Array.isArray(x)&&new Set(x).size===x.length&&x.every(t=>typeof t==='string'&&t.length);
const mask=()=>/\[\[REDACTION_SLOT:[^\]]+\]\]|\[(?:REDACTION(?:[ _]\d+)?|REDACTED|STILL REDACTED|MASKED|MASK)\]/gi;
const cut=(text,a,b)=>Array.from(text).slice(a,b).join('');
const span=x=>Array.isArray(x)&&x.length===2&&x.every(Number.isInteger)&&x[0]>=0&&x[0]<x[1];
const hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);

function idfObservation(observation,statistics){
  check(statistics&&Number.isInteger(statistics.document_count)&&statistics.document_count>0&&
    statistics.document_frequency&&hash(statistics.profile_sha256),'missing document-IDF profile');
  const n=statistics.document_count,df=statistics.document_frequency;
  const q=new Set(observation.query_terms),s=new Set(observation.source_terms),union=[...new Set([...q,...s])].sort();
  check(same(Object.keys(df).sort(),union),'IDF term inventory changed');
  const weights=Object.create(null);
  for(const term of union){
    check(Number.isInteger(df[term])&&df[term]>=0&&df[term]<=n,'invalid distinct-document frequency');
    weights[term]=Math.log(1+(n-df[term]+.5)/(df[term]+.5));
  }
  const sum=ts=>ts.reduce((v,t)=>v+weights[t],0),common=[...q].filter(t=>s.has(t)).sort();
  const intersection=sum(common),querySum=sum([...q].sort()),unionSum=sum(union);
  check(same(observation.term_document_frequencies,df)&&observation.term_weights&&
    same(Object.keys(observation.term_weights).sort(),union)&&
    union.every(t=>near(observation.term_weights[t],weights[t]))&&
    near(observation.intersection_idf_sum,intersection)&&near(observation.query_idf_sum,querySum)&&
    near(observation.union_idf_sum,unionSum),'saved IDF arithmetic changed');
  const coverage=querySum?intersection/querySum:0,jaccard=unionSum?intersection/unionSum:0;
  return {coverage,jaccard,fit:.75*coverage+.25*jaccard};
}

function relativeSource(native,observation){
  const ref=native.sources[0],occurrence=native.source_occurrences?.[0],shape=occurrence?.source_shape;
  const raw=native.source_wording,bounds=native.source_span;
  check(native.source_occurrences?.length===1&&shape&&same(occurrence.citation,ref)&&
    same(occurrence.source_span,bounds)&&occurrence.source_wording===raw&&
    shape.fill===native.fill&&shape.source_wording===raw&&shape.source_sentence===raw&&
    same([shape.source_sentence_start,shape.source_sentence_end],bounds)&&
    shape.source_page_id===ref.canonical_page_id&&shape.source_document_id===ref.document_id&&
    shape.source_date===ref.date&&shape.source_page_sha256===ref.page_sha256,'relative raw-source binding changed');
  check(shape.generated_surface_is_exact_source_span===false&&shape.factual_support_certified===false&&
    shape.source_internal_references_resolved===false&&shape.owner_event_binding==='UNASSESSED',
    'relative wording cannot certify source-owner equivalence');
  const license=shape.operation_license,subject=shape.source_subject,predicate=shape.source_predicate_span;
  check(license?.kind==='REPLACE_INITIAL_SUBJECT_WITH_THAT_COPY_COMPLETE_SUFFIX'&&
    license.replacements?.length===2&&subject&&span(subject.span)&&span(predicate)&&
    subject.span[0]===bounds[0]&&subject.span[1]===predicate[0]&&predicate[1]===bounds[1]-1&&
    cut(raw,0,subject.span[1]-bounds[0])===subject.text&&
    cut(raw,predicate[0]-bounds[0],predicate[1]-bounds[0])===shape.source_predicate_text&&
    same(license.copied_predicate_span,predicate)&&license.copied_whitespace_and_punctuation_unchanged===true&&
    license.modal_negative_conditional_content_unchanged===true&&license.source_owner_equivalence_certified===false,
    'relative full-suffix operation license changed');
  const expected=[{span:subject.span,before:subject.text,after:'that'},
    {span:[bounds[1]-1,bounds[1]],before:'.',after:''}];
  check(same(license.replacements,expected)&&same(native.insertion_edits,expected)&&
    same(occurrence.insertion_edits,expected),'unlicensed relative edit or invented wrapper');
  let generated=Array.from(raw);
  for(const edit of [...expected].reverse()){
    const a=edit.span[0]-bounds[0],b=edit.span[1]-bounds[0];
    check(cut(raw,a,b)===edit.before,'relative edit raw coordinates changed');
    generated.splice(a,b-a,...Array.from(edit.after));
  }
  check(generated.join('')===native.fill,'relative realization does not replay');
  const parent=shape.source_parent_quote;
  check(parent&&span(parent.span)&&typeof parent.text==='string'&&
    Array.from(parent.text).length===parent.span[1]-parent.span[0]&&
    parent.span[0]<=bounds[0]&&bounds[1]<=parent.span[1]&&
    cut(parent.text,bounds[0]-parent.span[0],bounds[1]-parent.span[0])===raw&&
    typeof shape.source_parent_scope_complete==='boolean'&&
    shape.source_parent_scope_complete===!mask().test(parent.text),'raw parent or mask scope changed');
  if(shape.source_parent_scope_complete){
    check(same([ref.start,ref.end],parent.span)&&ref.text===parent.text,'whole relative parent qualification clipped');
  }else{
    check(same([ref.start,ref.end],bounds)&&ref.text===raw,'masked parent must not be a factual citation');
  }
  const label=/^(Comment:)(\s+)/i.exec(parent.text);
  if(label){
    const operator=shape.source_assessment_operator,partition=shape.source_parse_partition;
    check(shape.source_parent_scope_complete&&operator?.kind==='COMMENT_ASSESSMENT'&&
      same(operator.span,[parent.span[0],parent.span[0]+label[1].length])&&operator.text===label[1]&&
      same(operator.source_scope_span,parent.span)&&operator.source_scope_text===parent.text&&
      operator.assessment_is_verified_truth===false&&operator.assessment_is_completed_decision===false&&
      operator.source_authority_credit_added===false&&partition?.registered_label_only===true&&
      partition.original_source_text_or_hash_changed===false&&partition.body_operators_or_qualifications_removed===false&&
      same(partition.body_span,[parent.span[0]+label[0].length,parent.span[1]])&&
      partition.body_text===cut(parent.text,label[0].length)&&
      license.comment_assessment_operator_preserved===true,'Comment assessment scope changed');
  }else check(shape.source_assessment_operator===undefined,'unregistered assessment wrapper');
  const walk=value=>{
    if(Array.isArray(value)){value.forEach(walk);return;}
    if(!value||typeof value!=='object')return;
    if(typeof value.text==='string'&&Number.isInteger(value.start)&&Number.isInteger(value.end)){
      check(parent.span[0]<=value.start&&value.start<value.end&&value.end<=parent.span[1]&&
        cut(parent.text,value.start-parent.span[0],value.end-parent.span[0])===value.text,'source token coordinates changed');
    }else if(typeof value.text==='string'&&Array.isArray(value.span)){
      check(span(value.span)&&parent.span[0]<=value.span[0]&&value.span[1]<=parent.span[1]&&
        cut(parent.text,value.span[0]-parent.span[0],value.span[1]-parent.span[0])===value.text,'source scope coordinates changed');
    }
    Object.values(value).forEach(v=>{if(v&&typeof v==='object')walk(v);});
  };
  ['source_subject','source_copula','source_predicate_tokens','nested_finite_clauses','source_qualifier_scopes'].forEach(k=>walk(shape[k]));
  check(observation.source_sentence===raw&&same(observation.source_sentence_span,bounds)&&
    observation.source_page_id===ref.canonical_page_id&&observation.source_document_id===ref.document_id,
    'IDF observation is not the chosen own source clause');
}

async function projectionMatches(projection,expected,digest){
  if(await digest(projection)===expected)return true;
  // Python always emits these declared observation fractions as floats.
  // JSON decoding loses 0.0/1.0. Restore only that finite schema, never
  // coordinates/counts or arbitrary numeric fields; the whole SHA must match.
  const floating=path=>path[0]==='producer'&&path[1]==='context_order'&&
    ['score','coverage','jaccard'].includes(path.at(-1))&&
    (path.length===4&&path[2]==='best_single_occurrence'||path.length===5&&
      ['all_occurrence_scores','all_unique_clause_scores'].includes(path[2]));
  const encode=(value,path=[])=>{
    if(Array.isArray(value))return '['+value.map((v,i)=>encode(v,[...path,i])).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>
      JSON.stringify(k)+':'+encode(value[k],[...path,k])).join(',')+'}';
    check(typeof value!=='number'||Number.isFinite(value),'nonfinite producer projection');
    if(typeof value==='number'&&Number.isInteger(value)&&floating(path))return String(value)+'.0';
    const text=JSON.stringify(value);check(typeof text==='string','non-JSON producer projection');return text;
  };
  const text=encode(projection).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  return [...bytes].map(n=>n.toString(16).padStart(2,'0')).join('')===expected;
}

export function validateAdjunctScore(card,native){
  const producer=native.first_class_adjunct,decision=native.local_decision;
  check(ADJUNCT_SCORE_VERSIONS.includes(card.version)&&producer?.version===VERSION,'unknown producer or score version');
  const relative=card.version===RELATIVE_SCORE_VERSION;
  check(same(card,native.terminal_scorecard),'display and native scorecards differ');
  check(card.score_units==='OWN_CLAUSE_LEXICAL_RELEVANCE_POINTS_NOT_CONFIDENCE'&&card.calibrated_probability===false&&
    card.factual_decisions_unchanged===true&&card.native_support_gate_executed===false&&
    card.factual_tier_applied_separately===true&&card.source_function_band===null,'lexical scale changed');
  check(decision?.status==='exploratory_contextual'&&decision.support_present===false&&decision.counterevidence===false&&
    decision.coverage==='Missing'&&card.native_status===decision.status&&card.evidence_tier===0&&
    card.criteria_coverage===0&&card.support===0&&card.oppose===0,'lexical relevance cannot certify support');
  check(card.id===native.id&&card.fill===native.fill&&(relative||native.source_wording===native.fill)&&
    native.final_form_fit?.state==='pass'&&native.completed_head_kind_fit?.state==='pass'&&
    native.joint_slot_fit?.state==='pass'&&native.joint_slot_fit.context_only===true,'candidate or insertion changed');
  const order=producer.context_order,observation=order?.best_single_occurrence;
  check(order?.version===(relative?'bound-ordinary-document-idf-own-clause-context/2':'own-clause-adjunct-context/1')&&order.coverage_weight===.75&&order.jaccard_weight===.25&&
    order.correctness_probability===false&&order.factual_support_certified===false&&
    observation&&terms(observation.query_terms)&&terms(observation.source_terms),'missing own-clause term receipt');
  const q=new Set(observation.query_terms),s=new Set(observation.source_terms),common=[...q].filter(t=>s.has(t)).sort();
  let coverage=common.length/Math.max(1,q.size),jaccard=common.length/Math.max(1,new Set([...q,...s]).size);
  let fit=.75*coverage+.25*jaccard;
  if(relative){
    check(producer.source_realization_kind==='SOURCE_COPULAR_RELATIVE'&&
      producer.scoped_construction_version==='native-source-owned-scoped-construction/2'&&
      hash(producer.exact_public_binding_sha256)&&order.profile_sha256===producer.context_document_statistics?.profile_sha256&&
      order.source_or_qualification_or_gate_changed===false&&
      order.all_unique_clause_scores?.some(v=>same(v,observation)),'relative producer or own-clause order changed');
    ({coverage,jaccard,fit}=idfObservation(observation,producer.context_document_statistics));
    check(near(observation.coverage,coverage)&&near(observation.jaccard,jaccard),'relative observation fractions changed');
    const r=native.declared_reading,compat=native.final_form_fit?.compatibility;
    check(r?.outer_family==='clausal'&&r.function==='modifier'&&r.role==='nominal_property'&&
      r.target_kind==='any'&&r.grammatical_number==='unknown'&&r.constructor_form===null&&
      compat?.state==='PASS_SYNTAX_ONLY'&&compat.factual_support_certified===false&&compat.grammar_only===true&&
      compat.source_owner_equivalence_certified===false&&compat.hidden_actor_invented_or_borrowed===false,
      'relative declared grammar or contextual-only scope changed');
  }else check(producer.source_realization_kind===undefined,'relative realization cannot use legacy arithmetic');
  check(fraction(card.coverage)&&fraction(card.jaccard)&&fraction(card.fit)&&same(common,observation.matched_terms)&&
    near(card.coverage,coverage)&&near(card.jaccard,jaccard)&&near(card.fit,fit)&&near(card.context,fit)&&
    near(observation.score,fit)&&near(card.score,100*fit),'own-clause arithmetic changed');
  check(card.ranking_components&&Object.keys(card.ranking_components).length===2&&
    near(card.ranking_components.query_coverage_points,75*coverage)&&
    near(card.ranking_components.source_precision_points,25*jaccard),'lexical point components changed');
  const ref=native.sources?.[0],span=native.source_span;
  check(native.sources?.length===1&&ref&&Array.isArray(span)&&span.length===2&&span.every(Number.isInteger)&&
    Number.isInteger(ref.start)&&Number.isInteger(ref.end)&&span[0]>=ref.start&&span[1]<=ref.end&&span[0]<span[1]&&
    typeof ref.text==='string'&&Array.from(ref.text).length===ref.end-ref.start&&
    cut(ref.text,span[0]-ref.start,span[1]-ref.start)===(relative?native.source_wording:native.fill),'literal source span changed');
  if(relative)relativeSource(native,observation);
  check(card.contributions?.length===1&&card.contributions[0].direction==='context'&&
    card.contributions[0].document_id===ref.document_id&&same(card.contributions[0].citation,ref)&&
    card.contributions[0].source_owned_lexical_context_only===true&&
    near(card.contributions[0].contribution,fit)&&near(card.contributions[0].fit,fit),'source contribution changed');
}

export async function verifyAdjunctScoreBindings(native,record,caseInfo,digest){
  validateAdjunctScore(native.terminal_scorecard,native);
  const producer=native.first_class_adjunct;
  check(producer.query_sha256===await digest(caseInfo.query)&&
    producer.reading_sha256===await digest(native.declared_reading)&&
    producer.primary_citation_sha256===await digest(native.sources[0]),'query, reading or source hash changed');
  const fields=['id','reading_id','declared_reading','fill','source_wording','source_span','insertion_edits',
    'sources','source_occurrences','final_form_fit','completed_head_kind_fit','joint_slot_fit','local_decision'];
  const retained={...producer};delete retained.candidate_projection_sha256;
  const projection={candidate:Object.fromEntries(fields.map(k=>[k,native[k]??null])),producer:retained};
  check(await projectionMatches(projection,producer.candidate_projection_sha256,digest),'saved producer projection changed');
  check(record.plan?.slot_readings?.some(r=>r.id===native.reading_id&&same(r,native.declared_reading)),
    'candidate does not belong to its declared reading');
  if(native.terminal_scorecard.version===RELATIVE_SCORE_VERSION){
    const fields=['case_id','corpus','task','query','document_id','date','focal_marker'];
    const supplied=[record.public_case,record.case,caseInfo].find(c=>c&&fields.every(k=>typeof c[k]==='string'));
    check(supplied,'relative verification needs its exact seven-field public case');
    const bound=Object.fromEntries(fields.map(k=>[k,supplied[k]])),query=bound.query,marker=bound.focal_marker;
    check(fields.every(k=>typeof caseInfo[k]!=='string'||caseInfo[k]===bound[k])&&
      query===caseInfo.query&&marker&&query.split(marker).length===2&&bound.task==='redaction',
      'relative focal public input changed');
    const point=offset=>Array.from(query.slice(0,offset)).length;
    const at=point(query.indexOf(marker)),end=at+Array.from(marker).length;
    let left=0,right=Array.from(query).length;
    for(const match of query.matchAll(/\n\s*\n/g)){
      const a=point(match.index),b=point(match.index+match[0].length);
      if(b<=at)left=b;else if(a>=end){right=a;break;}
    }
    for(const match of query.matchAll(mask())){
      const a=point(match.index),b=point(match.index+match[0].length);
      if(b<=at)left=Math.max(left,b);else if(a>=end){right=Math.min(right,a);break;}
    }
    const context={span:[left,right],text:cut(query,left,right),rule:'EXACT_FOCAL_PARAGRAPH_AND_VISIBLE_COMPONENT'};
    const binding={version:'exact-public-source-context-bindings/2',case:bound,case_sha256:await digest(bound),
      query_sha256:await digest(query),focal_marker:marker,reading_id:native.reading_id,
      reading_sha256:await digest(native.declared_reading),query_context:context};
    check(producer.exact_public_binding_sha256===await digest(binding)&&
      producer.context_order.query_text===context.text,'relative exact case/query/context/reading binding changed');
    const final=query.replace(marker,native.fill),fit=native.final_form_fit,compat=fit.compatibility;
    check(fit.completed_query_sha256===await digest(final)&&compat.completed_query_sha256===fit.completed_query_sha256&&
      same(fit.inserted_span,[at,at+Array.from(native.fill).length])&&same(compat.inserted_span,fit.inserted_span),
      'relative completed public insertion binding changed');
    for(const token of compat.inserted_tokens||[]){
      check(Number.isInteger(token.start)&&Number.isInteger(token.end)&&
        at<=token.start&&token.start<token.end&&token.end<=at+Array.from(native.fill).length&&
        cut(final,token.start,token.end)===token.text,'relative completed token coordinates changed');
    }
  }
}

// Presentation only: all identities, paths, quotations and numbers come from saved records.
import {savedSourcePolicy,savedSourceScope} from './saved-source-policy.js';
const list=value=>Array.isArray(value)?value:[];
export function readerEvidenceState(status){
  const states={
    evidence_backed_suggestion:{kind:'supported',tier:'backed',label:'Evidence-backed'},
    partial_grounding:{kind:'partial',tier:'partial',label:'Partial evidence'},
    exploratory_contextual:{kind:'context',tier:'context',label:'Contextual suggestion'},
    incompatible_not_viable:{kind:'incompatible',tier:'incompatible',label:'Not viable'}
  };
  return Object.hasOwn(states,status)?{...states[status]}:null;
}
export function readerRedactionVerdict(summary={}){
  if(summary.task!=='redaction')return null;
  if(!summary.available)return {title:summary.title||'Evidence not recorded',tier:'unavailable'};
  const counts=summary.counts||{};
  if(counts.opposed||counts.mixed||counts.conflict)return {title:summary.title,tier:'stance'};
  if(summary.recommendation&&counts.supported)return {title:'Evidence-backed',tier:'backed'};
  if(counts.partial||counts.supported)return {title:'Partial evidence',tier:'partial'};
  if(counts.context)return {title:'Contextual suggestion',tier:'context'};
  if(summary.total>0&&counts.incompatible===summary.total)return {title:'Not viable',tier:'incompatible'};
  if(list(summary.units).some(value=>value.kind==='unresolved'&&(!value.unit||!readerEvidenceState(value.unit.status))))
    return {title:'Evidence not recorded',tier:'unavailable'};
  return {title:'No evidence',tier:'none'};
}
const short=(text,n=12)=>String(text||"").trim().split(/\s+/).slice(0,n).join(" ");
function node(tag,text,attrs={}){
  const result=document.createElement(tag);
  if(text!=null)result.textContent=String(text);
  for(const [key,value] of Object.entries(attrs))if(value!=null)result.setAttribute(key,String(value));
  return result;
}
function action(text,fn,attrs={}){const b=node("button",text,{type:"button",...attrs});b.onclick=fn;return b;}
const proofKey=p=>JSON.stringify([p.document_id,p.canonical_page_id,p.start,p.end,p.text,p.page_sha256,p.date]);
export function workbenchSourceScope(caseInfo,{reportItem,condition,liveScope}={}){
  const declarations=[reportItem?.source_view_policy,condition?.source_view_policy,
    condition?.configuration?.source_view_policy,condition?.result?.source_view_policy,liveScope?.source_view_policy].filter(value=>value!=null);
  const policy=savedSourcePolicy(declarations[0]);
  if(declarations.some(value=>JSON.stringify(savedSourcePolicy(value))!==JSON.stringify(policy)))
    throw Error('The selected report and native condition evidence policies disagree.');
  return savedSourceScope(caseInfo,policy);
}
export function studyCompanionCases(row,inventory){
  if(!['first','last'].includes(row?.study_slot)||typeof row.study_companion_case_id!=='string')return [];
  const companion=list(inventory).filter(other=>other.case?.case_id===row.study_companion_case_id);
  if(companion.length!==1)return [];
  const other=companion[0];
  if(other.study_slot!==(row.study_slot==='first'?'last':'first')||other.study_companion_case_id!==row.case?.case_id||
      row.case.task!=='redaction'||other.case?.task!=='redaction'||
      ['corpus','document_id','date'].some(key=>other.case[key]!==row.case[key]))return [];
  return [row,other].sort((a,b)=>a.study_slot==='first'?-1:b.study_slot==='first'?1:0);
}
export function uniqueProofs(values){
  const found=new Map();
  for(const value of list(values)){
    const p=value?.citation||value?.source_proof||value?.source||value;
    if(!p||typeof p!=="object")continue;
    const id=p.canonical_page_id||p.page_id;
    if(!id||typeof p.text!=="string"||!p.text||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.end<=p.start||!p.page_sha256)continue;
    const proof={...p,canonical_page_id:id};
    found.set(proofKey(proof),proof);
  }
  return [...found.values()];
}
export function digestProofs(values){
  const proofs=list(values).flatMap(v=>uniqueProofs([v]));
  return uniqueProofs(proofs).map(proof=>({...proof,digest_ids:[...new Set(proofs.filter(p=>proofKey(p)===proofKey(proof)).map(p=>p.id).filter(id=>/^S\d+$/.test(id||'')))]}));
}
export function decisionProofs(item={},unit={}){
  const fromEvidence=e=>[e?.citation,...list(e?.citations)];
  return uniqueProofs([
    ...list(item.sources),...list(item.evidence).flatMap(fromEvidence),
    ...list(item.support_assessment?.evidence).flatMap(fromEvidence),
    ...list(unit?.evidence).flatMap(fromEvidence),
    ...list(unit?.requirements).flatMap(r=>[
      ...list(r.citations),...list(r.context_citations),...list(r.evidence).flatMap(fromEvidence)
    ])
  ]);
}
export function factPresentationProofs(item={},unit={}){
  const proofs=decisionProofs(item,unit),directions=new Map(),groups=new Map();
  if(!item.id||unit.id&&unit.id!==item.id)return proofs;
  for(const evidence of [...list(item.evidence),...list(item.support_assessment?.evidence),
    ...list(unit.evidence),...list(unit.requirements).flatMap(row=>list(row.evidence))]){
    const direction=String(evidence.direction||'').trim().toUpperCase();
    if(!direction)continue;
    for(const proof of uniqueProofs([evidence.citation,...list(evidence.citations)])){
      const key=proofKey(proof);if(!directions.has(key))directions.set(key,new Set());directions.get(key).add(direction);
    }
  }
  proofs.forEach((proof,index)=>{
    const recorded=directions.get(proofKey(proof));if(!proof.document_id||recorded?.size!==1)return;
    const key=JSON.stringify([proof.document_id,[...recorded][0]]);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(index);
  });
  const result=[...proofs],words=proof=>proof.text.trim().split(/\s+/).length;
  // Only reorder existing slots with one recorded direction in this fact/document.
  for(const indices of groups.values()){
    const ordered=indices.map(index=>proofs[index]).sort((a,b)=>words(b)-words(a));
    indices.forEach((index,position)=>{result[index]=ordered[position];});
  }
  return result;
}
export function groupDuplicateFills(values){
  const groups=new Map();
  const ranked=list(values).filter(item=>item.rank!=null);
  if(ranked.length&&(ranked.length!==list(values).length||ranked.some((item,i)=>!Number.isSafeInteger(item.rank)||item.rank<1||i>0&&item.rank<=ranked[i-1].rank)))throw Error('Candidate ranks must retain their strict native order.');
  for(const [index,item]of list(values).entries()){
    const key=typeof item.fill==='string'?item.fill.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en'):item.id;
    if(!groups.has(key))groups.set(key,{...item,presentation_variants:[],native_display_positions:[]});
    const group=groups.get(key);group.presentation_variants.push(item);group.native_display_positions.push(index+1);
  }
  return [...groups.values()];
}
export function scoreRows(item={}){
  const candidates=[
    ["Reciprocal rank fusion",item.ranking?.fused_rrf??item.ranking?.rrf,"ranking.fused_rrf"],
    ["Focal anchor IDF",item.v21_features?.focal_anchor_idf,"v21_features.focal_anchor_idf"],
    ["Whole-query anchor IDF",item.v21_features?.full_query_anchor_idf,"v21_features.full_query_anchor_idf"]
  ];
  if(!candidates.some(([,value])=>typeof value==="number"&&Number.isFinite(value))){
    candidates.push(["Page retrieval relevance",item.ranking?.features?.retrieval_page_score,"ranking.features.retrieval_page_score"],
      ["Focal clue terms shared",item.context_ordering?.observation?.shared_count,"context_ordering.observation.shared_count"],
      ["Shared / source terms",item.context_ordering?.observation?.source_precision,"context_ordering.observation.source_precision"]);
  }
  return candidates.filter(([,value])=>typeof value==="number"&&Number.isFinite(value)&&value>=0).map(([label,value,field])=>({label,value,field}));
}
export function formatScore(value){return value!==0&&(Math.abs(value)<.001||Number(value.toFixed(2))===0)?value.toExponential(2):value.toFixed(2);}
export function endingScoreSeries(items){
  const values=list(items),pool=values[0]?.context_ordering?.pool_sha256;
  const ordinal=values.length>0&&/^[a-f0-9]{64}$/.test(pool||'')&&values.every(item=>{
    const record=item.context_ordering,score=record?.ordinal_context_utility;
    return record?.pool_sha256===pool&&record.correctness_probability===false&&record.changes_support===false&&
      Number.isInteger(score?.exact_numerator)&&Number.isInteger(score?.exact_denominator)&&score.exact_denominator>=1&&
      score.exact_numerator>=0&&score.exact_numerator<=score.exact_denominator&&score.value===score.exact_numerator/score.exact_denominator;
  });
  const rows=values.map(item=>({item,value:ordinal?item.context_ordering.ordinal_context_utility.value:item.ending_utility?.value,
    basis:ordinal?'SAVED_FULL_ORDER_ORDINAL':'SAVED_SOURCE_PRIORITY_INDEX'}));
  if(!rows.length||rows.some(row=>typeof row.value!=="number"||!Number.isFinite(row.value)||row.value<0||row.value>1))return null;
  if(rows.some((row,index)=>index>0&&row.value>rows[index-1].value+1e-12))return null;
  return rows;
}
export function renderEndingScoreChart(items,{onExplain}={}){
  let rows=endingScoreSeries(items);
  if(!rows){const values=list(items);if(!values.length)return null;rows=values.map((item,index)=>({item,
    value:values.length===1?1:1-index/(values.length-1),basis:'DISPLAY_POSITION_ONLY'}));}
  const host=node("section",null,{class:"saved-score-chart","data-testid":"ending-score-chart"});
  host.append(node("h3",rows[0].basis==='SAVED_FULL_ORDER_ORDINAL'?'Saved order index':rows[0].basis==='DISPLAY_POSITION_ONLY'?'Ranking position':'Source-priority index'));
  for(const [index,{item,value}] of rows.entries()){
    const row=node("div",null,{class:"score-chart-row","data-score-value":value});
    const track=node("div",null,{class:"score-track"}),fill=node("span");fill.style.width=(value*100)+"%";track.append(fill);
    row.append(node("span",`${index+1}. ${item.fill||item.id}`,{class:"score-chart-name"}),
      node("strong",(value*100).toFixed(2),{title:String(value*100)}),track);host.append(row);
  }
  if(onExplain)host.append(action("Score breakdown",()=>onExplain(rows),{"data-testid":"ending-score-explain"}));
  return host;
}
export function renderScoreChart(items){
  const metrics=[...new Map(items.flatMap(scoreRows).map(row=>[row.field,row])).values()];
  const host=node("section",null,{class:"saved-score-chart","data-testid":"saved-score-chart"});
  if(!metrics.length){host.append(node("p","No numeric ranking components are saved for this selection.",{class:"note"}));return host;}
  host.append(node("h3","Saved rank inputs"));
  const label=node("label","Compare one saved metric"),select=node("select",null,{"aria-label":"Saved score metric","data-testid":"score-metric"});
  for(const metric of metrics)select.append(node("option",metric.label,{value:metric.field}));
  label.append(select);host.append(label);
  const chart=node("div",null,{class:"score-chart-rows"});host.append(chart);
  function draw(){
    chart.replaceChildren();
    const rows=items.map(item=>({item,metric:scoreRows(item).find(r=>r.field===select.value)}));
    const maximum=Math.max(0,...rows.map(row=>row.metric?.value||0));
    for(const [index,{item,metric}] of rows.entries()){
      const row=node("div",null,{class:"score-chart-row","data-score-field":select.value,"data-score-value":metric?.value,"data-score-max":maximum});
      row.append(node("span",`${index+1}. ${item.fill||item.text||item.id}`,{class:"score-chart-name"}),node("strong",metric?formatScore(metric.value):"Not saved",{title:metric?String(metric.value):null}));
      const track=node("div",null,{class:"score-track"}),fill=node("span");fill.style.width=(metric&&maximum?100*metric.value/maximum:0)+"%";track.append(fill);row.append(track);chart.append(row);
    }
  }
  select.onchange=draw;draw();
  host.append(node("p","Scale: zero to the displayed maximum for this metric. Saved inputs, not an additive score or confidence.",{class:"note"}));return host;
}
export function terminalDocumentCounts(item){
  if(!Array.isArray(item?.contributions))return null;
  const directions=['support','oppose','context'],sums={support:0,oppose:0,context:0};
  const documents={support:new Set(),oppose:new Set(),context:new Set()},all=new Set();
  for(const row of item.contributions){
    if(!row||!directions.includes(row.direction)||typeof row.document_id!=='string'||!row.document_id.trim()||
      typeof row.contribution!=='number'||!Number.isFinite(row.contribution)||row.contribution<0||
      row.citation&&row.citation.document_id!==row.document_id)return null;
    sums[row.direction]+=row.contribution;
    if(row.contribution>0){documents[row.direction].add(row.document_id);all.add(row.document_id);}
  }
  if(directions.some(key=>typeof item[key]!=='number'||!Number.isFinite(item[key])||
    Math.abs(sums[key]-item[key])>32*Number.EPSILON*Math.max(1,Math.abs(item[key]),Math.abs(sums[key]))))return null;
  return {support:documents.support.size,oppose:documents.oppose.size,context:documents.context.size,total:all.size};
}
export function renderIdentityConsolidation(candidate){
  const metadata=candidate?.identity_consolidation,ambiguity=candidate?.identity_ambiguity;
  if(metadata==null&&ambiguity==null)return null;
  const host=node('div',null,{'data-testid':'candidate-identity-scope'});
  const sourceLocal='source-local-person-candidate-consolidation/2';
  if(ambiguity!=null){
    const valid=ambiguity.version===sourceLocal&&ambiguity.reason==='MULTIPLE_SOURCE_PERSON_ANTECEDENTS'&&
      ambiguity.identity_join_permitted===false&&ambiguity.factual_counterevidence===false&&list(ambiguity.observations).length>0;
    host.append(node('p',valid?'Ambiguous surname / identity unresolved. The native source-local check records multiple person antecedents. No identity join is permitted; this is not opposing evidence.':
      'The saved identity-ambiguity metadata is unsupported. No identity is inferred.',{class:'note hint','data-testid':valid?'candidate-identity-ambiguity':'candidate-identity-unavailable'}));
  }
  if(metadata!=null){
    const variants=list(metadata.variants),ids=new Set(variants.map(item=>item?.id));
    const contract=metadata.version==='source-occurrence-candidate-consolidation/1'&&metadata.rule==='SAME_EXACT_SOURCE_HEAD_AND_DECISION_SCOPE'||
      metadata.version===sourceLocal&&metadata.rule==='CHECKED_SOURCE_LOCAL_PERSON_IDENTITY'&&metadata.representative_id===candidate.id&&
      metadata.representative_score_unchanged===true&&metadata.identity_proofs_add_evidence_credit===false&&
      list(metadata.proofs).length>0&&metadata.proofs.every(proof=>proof?.factual_support_certified===false)&&
      metadata.document_evidence?.audit_only===true&&metadata.document_evidence.applied_to_candidate_score===false&&
      metadata.document_evidence.requirements_pooled===false&&metadata.document_evidence.rule==='MAX_PER_DOCUMENT_AND_DIRECTION';
    const valid=contract&&metadata.decisions_pooled===false&&metadata.cross_document_identity_inferred===false&&
      variants.length>1&&ids.size===variants.length&&ids.has(candidate.id)&&
      variants.every(item=>item&&typeof item.id==='string'&&item.id&&typeof item.fill==='string'&&item.fill.trim());
    if(!valid)host.append(node('p','Source-local variant metadata is unavailable or unsupported. No identity is inferred.',{class:'note hint'}));
    else{
      host.append(node('p','Recorded source-local variants only. No cross-document identity is inferred; evidence decisions are not pooled.',{class:'note hint'}));
      const details=node('details');details.append(node('summary',`${variants.length} recorded wording variants / ${metadata.version===sourceLocal?'native source-local identity':'same source occurrence'}`));
      const entries=node('ul');for(const item of variants)entries.append(node('li',item.fill,{'data-native-variant-id':item.id}));
      details.append(entries);host.append(details);
    }
  }
  return host;
}
export function renderTerminalScoreCards(record,scores,{formatScore=String,formatText=String,readingTitle=reading=>reading.id,readingId,onExplain,nativeBars=false,showTitle=true}={}){
  const host=node('section',null,{class:'terminal-scorecards','data-testid':'terminal-scorecards'});
  if(!scores){host.append(node('p','No terminal evidence/fit score was saved for this historical result.',{class:'note','data-testid':'terminal-score-unavailable'}));return host;}
  host.dataset.scoreVersion=scores.version;host.dataset.rankingApplied=String(scores.ranking_applied===true);
  const sourcePoints=['terminal-evidence-fit/6','terminal-evidence-fit/7'].includes(scores.version),components=sourcePoints||scores.version==='terminal-evidence-fit/5',points=components||scores.version==='terminal-evidence-fit/4';
  if(showTitle)host.append(node('h3','Evidence and fit'));
  host.append(node('p',scores.ranking_applied===true?
    (points?'Ranking points / 300, not confidence. Source priority is not a factual-support certificate.':'Saved priority indices, not confidence. Original units are retained.'):
    'Recorded diagnostics, not applied to ranking or a measure of confidence.',{class:'note hint terminal-comparison-note'}));
  const nativeReadings=list((record.result?.redaction||record.result)?.readings);
  function metric(label,value,maximum,tone,attrs={},bar=true){
    const row=node('div',null,{class:'terminal-metric'+(nativeBars?' score-overview':''),'data-metric-max':maximum,...attrs});
    row.append(node('span',label),node('strong',formatScore(value),{title:String(value)}));
    if(bar){
      const track=nativeBars?node('meter',null,{min:0,max:maximum||1,value,'aria-label':label}):
        node('div',null,{class:'score-track','data-tone':tone,role:'meter','aria-label':label,'aria-valuemin':0,'aria-valuemax':maximum||1,'aria-valuenow':value});
      if(!nativeBars){const fill=node('span');fill.style.width=(maximum>0?Math.min(100,Math.max(0,value)/maximum*100):0)+'%';track.append(fill);}
      row.append(track);
    }
    return row;
  }
  function criteria(item){return metric('Criteria coverage / 1 (not confidence)',item.criteria_coverage,1,'criteria',{'data-criteria-coverage':item.criteria_coverage});}
  function totalBar(item){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value]of Object.entries({viewBox:'0 0 300 8',preserveAspectRatio:'none',class:'terminal-total-track',role:'meter',
      'aria-label':'Ranking points / 300','aria-valuemin':0,'aria-valuemax':300,'aria-valuenow':item.score}))svg.setAttribute(key,String(value));
    const rectangle=(x,width,key)=>{const rect=document.createElementNS(svg.namespaceURI,'rect');
      for(const[name,value]of Object.entries({x,y:0,width,height:8}))rect.setAttribute(name,String(value));
      if(key)rect.setAttribute('data-segment-component',key);else rect.setAttribute('class','terminal-track-background');svg.append(rect);};
    rectangle(0,300);
    let x=0;
    for(const key of components?['evidence_tier_points','source_function_points','evidence_fit_points']:['score']){
      const value=components?item.ranking_components[key]:item.score;rectangle(x,value,key);x+=value;
    }
    return svg;
  }
  function evidence(row,item,maximum){
    const counts=terminalDocumentCounts(item);
    row.append(node('p',counts?`${counts.total} distinct contributing document${counts.total===1?'':'s'} across directions.`:'Contributing document counts not recorded or not bound to these totals.',
      {class:'terminal-score-summary hint','data-testid':'terminal-document-count','data-document-count':counts?.total}));
    for(const [key,label]of [['support','Support'],['oppose','Opposition'],['context','Context']]){
      const count=counts?.[key];
      row.append(metric(label+(count==null?'':` / ${count} document${count===1?'':'s'}`),item[key],maximum,key,
        {'data-direction':key,'data-contribution-sum':item[key],'data-document-count':count}));
    }
  }
  const technical=node('details',null,{class:'terminal-technical','data-testid':'terminal-score-contract'});
  technical.append(node('summary','Scoring contract / technical'),node('p',
    (points?'Recorded point contract: ':'Historical priority indices: ')+scores.version,{class:'note hint','data-testid':'terminal-score-units'}),
    node('p',sourcePoints?'100*tier + 40*bool(B & ~18) + 25*B/1023 + 35*u/(1+u). Nomination is not factual support.':
      components?'100*tier + 65*B/1023 + 35*u/(1+u).':points?'Original evidence/fit points, 0 to 300; no later components are inferred.':
      'Original saved index; no point conversion or rank-based spread is applied.',{class:'note hint'}));
  if(scores.version==='terminal-evidence-fit/7')technical.append(node('p',
    'Saved fit includes licensed wording and balanced focal/background lexical coverage. Source weights use the best recorded fused or atom-search position. These are contextual ranking inputs, not factual support.',{class:'note hint'}));
  for(const reading of list(scores.readings).filter(reading=>readingId==null||reading.id===readingId)){
    const source=nativeReadings.find(value=>value.reading?.id===reading.id),byId=new Map(list(source?.candidates).map(item=>[item.id,item]));
    const section=node('section',null,{class:'terminal-reading terminal-comparison','data-reading-id':reading.id});
    section.append(node('h4',readingTitle(source?.reading||reading)));
    const maximum=Math.max(0,...reading.candidates.flatMap(item=>[item.support,item.oppose,item.context]));
    const fitMaximum=Math.max(1,...reading.candidates.map(item=>item.fit));
    for(const [index,item]of reading.candidates.entries()){
      const saved=byId.get(item.id),row=node('article',null,{class:'terminal-score-item terminal-candidate','data-score-candidate':item.id,'data-native-status':item.native_status});
      const head=node('div',null,{class:'terminal-score-heading'}),name=node('div',null,{class:'terminal-candidate-name'}),states=node('div',null,{class:'terminal-candidate-status'});
      const status=readerEvidenceState(item.native_status);
      states.append(node('span',status?.label||String(item.native_status).replaceAll('_',' '),{class:'terminal-state','data-reader-tier':status?.tier}));
      name.append(node('h5',(index+1)+'. '+formatText(saved?.fill||item.id)),states);head.append(name);
      const audit=node('details',null,{class:'terminal-score-audit',...(!points?{'data-testid':'raw-priority-index'}:{})});
      audit.append(node('summary',points?'Details':'Raw priority index and evidence detail',{title:'Fit, criteria and document contributions'}));
      const score=metric(points?'Ranking points / 300':'Raw priority index',item.score,points?300:null,'score',{'data-score-value':item.score},false);
      score.classList.add('terminal-total');if(points)head.append(score);else audit.append(score);
      row.append(head);if(points)row.append(totalBar(item));
      const legend=node('div',null,{class:'terminal-component-legend'});
      if(components)for(const [key,label,max]of [['evidence_tier_points','Evidence class points / 200',200],
        ['source_function_points',sourcePoints?'Source nomination/priority points / 65':'Source-priority points / 65',65],['evidence_fit_points','Evidence/fit points / 35',35]])
        {const value=item.ranking_components[key],part=node('div',null,{class:'terminal-component-item','data-ranking-component':key,
          'data-component-value':value,'data-metric-max':max,title:label});
        part.append(node('span',key==='evidence_tier_points'?'Class':key==='source_function_points'?'Source':'Evidence/fit'),node('strong',formatScore(value),{title:String(value)}));legend.append(part);}
      if(components)row.append(legend);
      const identity=renderIdentityConsolidation(saved);if(identity){
        const ambiguity=identity.querySelector('[data-testid=candidate-identity-ambiguity]');
        if(ambiguity)states.append(node('span','Identity unresolved',{class:'terminal-state',title:ambiguity.textContent}));audit.append(identity);
      }
      if(sourcePoints)audit.append(node('p','Source nomination cue: '+(item.source_function_context.matched?'recorded':'not recorded')+
        '. Not a factual-support certificate; type compatibility and absence of a name penalty alone do not qualify.',
        {class:'terminal-score-summary hint','data-testid':'source-nomination-cue','data-cue-matched':item.source_function_context.matched,
          'data-source-function-band':item.source_function_band.value}));
      audit.append(metric('Source fit / '+formatScore(fitMaximum),item.fit,fitMaximum,'fit',{'data-fit-value':item.fit}),criteria(item));
      evidence(audit,item,maximum);
      if(onExplain)audit.append(action('Source contributions',()=>onExplain(item),{class:'quiet'}));row.append(audit);section.append(row);
    }
    technical.append(node('p',`Support, opposition and context share a 0 to ${formatScore(maximum)} evidence-index scale across this reading. The total point bar uses 0 to 300; order and ties are unchanged.`,{class:'note hint'}));host.append(section);
  }
  if(list(scores.atoms).length){
    const section=node('section',null,{class:'terminal-atom-scores'}),maximum=Math.max(0,...scores.atoms.flatMap(item=>[item.support,item.oppose,item.context]));
    section.append(node('h4','Evidence by fact'));
    for(const item of scores.atoms){
      const index=list(record.plan?.atoms).findIndex(atom=>atom.id===item.id),atom=list(record.plan?.atoms).find(atom=>atom.id===item.id);
      const row=node('article',null,{class:'terminal-score-item'+(nativeBars?' evidence-card':''),'data-score-atom':item.id,'data-native-status':item.native_status});
      row.append(node(nativeBars?'h4':'h5',(index>=0?'F'+(index+1)+' / ':'')+formatText(atom?.text||item.id)),criteria(item));
      evidence(row,item,maximum);
      if(onExplain)row.append(action('Source contributions',()=>onExplain(item),{class:'quiet'}));section.append(row);
    }
    section.append(node('p',`All fact directions share a 0 to ${formatScore(maximum)} evidence-index scale, not the candidate point scale. Criteria coverage is not confidence.`,{class:'note hint'}));host.append(section);
  }
  technical.append(node('p','Document counts include positive saved contributions, once per document and direction. The same document may occur in several directions; these are not independent votes. Context and missing evidence are not opposition.',{class:'note hint'}));host.append(technical);
  return host;
}
export function renderScoreBars(item,peers){
  const host=node("div",null,{class:"score-composition","data-testid":"score-composition"});
  for(const row of scoreRows(item)){
    const scale=Math.max(...list(peers).flatMap(p=>scoreRows(p).filter(r=>r.field===row.field).map(r=>r.value)),row.value);
    const line=node("div",null,{class:"score-row","data-score-field":row.field,"data-score-value":row.value,"data-score-max":scale});
    line.append(node("span",row.label),node("strong",formatScore(row.value),{title:String(row.value)}));
    const track=node("div",null,{class:"score-track"}),fill=node("span");
    fill.style.width=(scale?100*row.value/scale:0)+"%";track.append(fill);line.append(track);host.append(line);
  }
  return host;
}
export function recordedAtomLinks(route,plan={}){
  const atoms=list(plan.atoms),leads=list(plan.leads),ids=new Set();
  for(const input of list(route.query_inputs)){
    if(atoms.some(a=>a.id===input.id))ids.add(input.id);
    for(const id of list(leads.find(l=>l.id===input.id)?.atom_ids))if(atoms.some(a=>a.id===id))ids.add(id);
  }
  return atoms.filter(a=>ids.has(a.id));
}
export function routeDestinations(route,usedProofs){
  const witnesses=uniqueProofs([...list(route.citations),...list(route.source_quotes),...list(route.hops||route.edges).flatMap(h=>list(h.citations))]);
  return uniqueProofs(usedProofs).filter(proof=>witnesses.some(w=>
    w.canonical_page_id===proof.canonical_page_id&&w.page_sha256===proof.page_sha256&&
    w.document_id===proof.document_id&&w.date===proof.date));
}
export function guideRoutes(trace={}){
  const seen=new Set(),routes=[];
  for(const route of list(trace.represented_routes??trace.routes??trace.witnesses??trace.paths)){
    const key=JSON.stringify([route.route_kind??null,list(route.nodes).map(n=>typeof n==='string'?n:n.id)]);
    if(seen.has(key))continue;seen.add(key);routes.push(route);if(routes.length===3)break;
  }
  return routes;
}
export function mountSavedRoutes(host,{projection,plan,items,selected,traceFor,proofsFor,onSelect,onAtom,onNode,onSource,onGuide,provenance}){
  let timer=null,step=0,destroyed=false,active=selected;
  const stop=()=>{clearInterval(timer);timer=null;};
  function draw(){
    stop();host.replaceChildren();
    const choices=node("div",null,{class:"route-targets","aria-label":"Saved route targets"});
    for(const [i,item] of list(items).entries())choices.append(action(`${i+1}. ${item.fill||item.label||item.id}`,()=>onSelect(item.id),{"aria-pressed":String(active===item.id),"data-testid":"route-target"}));
    host.append(choices);
    const item=list(items).find(i=>i.id===active)||items[0];
    if(!item){host.append(node("p","No saved targets for this reading.",{class:"empty"}));return;}
    const trace=traceFor(item),routes=guideRoutes(trace||{}),used=proofsFor(item);
    const cards=node("div",null,{class:"saved-route-list"}),steps=[];
    const boundRoutes=[...routes.entries()].filter(([,route])=>routeDestinations(route,used).length).slice(0,3);
    for(const [index,route] of boundRoutes){
      const endings=routeDestinations(route,used);
      const card=node("article",null,{class:"saved-route","data-testid":"saved-route","data-route-id":route.id||String(index),"data-route-index":index});
      const kind=provenance(route),top=node("header");top.append(node("span",kind.label,{class:"eyebrow"}),action("Guide in Knowledge graph",()=>onGuide({candidate:{...item,...trace},route,route_index:index,proof:endings[0]}),{"data-testid":"route-guide"}));card.append(top);
      const atoms=recordedAtomLinks(route,plan),origins=node("div",null,{class:"route-origins"});
      for(const atom of atoms)origins.append(action(`${atom.id} / ${short(atom.text||atom.source_quote)}`,()=>onAtom(atom),{class:"route-atom","data-atom-id":atom.id}));
      for(const input of list(route.query_inputs))if(!atoms.some(a=>a.id===input.id)){
        const detail=node("details",null,{class:"route-input","data-query-input":input.id});detail.append(node("summary",`${input.id} / ${short(input.text||"Saved query input")}`),node("p",input.text));origins.append(detail);
      }
      card.append(origins);
      const chain=node("ol",null,{class:"saved-chain","aria-label":"Actual ordered saved states"});
      const nodes=list(route.nodes),hops=list(route.hops||route.edges),byId=new Map(list(projection.nodes).map(n=>[n.id,n]));
      for(const [i,value] of nodes.entries()){
        const saved=typeof value==="string"?byId.get(value)||{id:value,label:"Saved state"}:value;
        const li=node("li",null,{"data-saved-node":saved.id});
        if(i)li.append(node("small",hops[i-1]?.kind==="NAVIGATION"?"Membership":hops[i-1]?.kind||"Saved step",{class:"hop-kind"}));
        const b=action(saved.label||saved.id,()=>onNode(saved),{"data-node-id":saved.id});
        li.append(b);chain.append(li);steps.push(b);
      }
      if(!nodes.length)chain.append(node("li","Source readout only; no graph walk was saved."));
      card.append(chain);
      const routeProofs=uniqueProofs([...list(route.citations),...hops.flatMap(h=>list(h.citations))]);
      card.append(action("Route details",()=>{
        const detail=node("section");detail.append(node("p",kind.note));
        for(const proof of routeProofs)detail.append(action(proof.text,()=>onSource(proof),{class:"source-card"}));
        onNode({workbench_route_detail:detail,label:"Route provenance"});
      },{class:"quiet"}));
      if(endings.length){
        for(const proof of endings.slice(0,1)){
          const end=action("",()=>onSource(proof),{class:"route-ending","data-testid":"route-ending","data-source-id":proof.canonical_page_id});
          end.append(node("small",`${proof.document_id||"Source"} / ${proof.earlier_page?"page "+proof.earlier_page:proof.canonical_page_id} / ${proof.date||""}`),node("blockquote",proof.text));card.append(end);
        }
      }else card.append(node("p","No used decision quotation is linked to this saved walk. Inspect the used sources in 04.",{class:"note"}));
      cards.append(card);
    }
    if(!boundRoutes.length){
      const lexical=list(trace?.lexical_routes).find(route=>route.route_kind==='LEXICAL_SOURCE_READOUT'&&routeDestinations(route,used).length);
      cards.append(node("p",lexical?"Source match":"Direct source readout",{class:"empty","data-testid":"no-saved-route"}));
      if(lexical){
        const receipt=node("section",null,{class:"lexical-receipt","data-testid":"lexical-readout"});
        for(const atom of recordedAtomLinks(lexical,plan))receipt.append(action(`${atom.id} / ${short(atom.text||atom.source_quote)}`,()=>onAtom(atom),{class:"route-atom"}));
        for(const state of list(lexical.nodes).filter(n=>!n.citation&&n.type!=='constructed_fill_readout'))receipt.append(action(state.label,()=>onNode(state),{class:"lexical-state"}));
        cards.append(receipt);
      }
      for(const proof of (lexical?routeDestinations(lexical,used):used).slice(0,2)){
        const end=action("",()=>onSource(proof),{class:"route-ending","data-testid":"route-ending","data-source-id":proof.canonical_page_id});
        end.append(node("small",`${proof.document_id||"Source"} / ${proof.canonical_page_id} / direct quotation readout, not a graph hop`),node("blockquote",proof.text));cards.append(end);
      }
    }
    const controls=node("div",null,{class:"route-replay"}),status=node("span","Recorded states only",{role:"status"});
    const play=action("Replay steps",()=>{
      if(timer){stop();play.textContent="Replay steps";return;}
      step=0;play.textContent="Pause replay";
      const tick=()=>{if(destroyed||!host.isConnected){stop();return;}steps.forEach((b,i)=>b.classList.toggle("is-current",i===step));status.textContent=`Saved state ${step+1} of ${steps.length}`;step=(step+1)%steps.length;};
      tick();timer=setInterval(tick,1800);
    },{"data-testid":"route-replay",disabled:steps.length?null:""});
    controls.append(play,status);host.append(controls,cards);
  }
  draw();return {destroy(){destroyed=true;stop();},selectCandidate(id){if(active!==id){active=id;draw();}}};
}

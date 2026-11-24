import {canonicalGateJSON} from './local-decisions-v65.js';

export const PROPOSAL_POOL_VERSION='source-separated-redaction-proposal-fusion/1';
const tiers={evidence_backed_suggestion:2,partial_grounding:1,exploratory_contextual:0};
const rows=value=>Array.isArray(value)?value:[];
const check=(value,message)=>{if(!value)throw Error('Proposal pool binding: '+message);};
const same=(a,b)=>canonicalGateJSON(a)===canonicalGateJSON(b);
const pin=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const surface=value=>{
  check(typeof value==='string'&&value.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g,''),'empty proposal wording');
  return value.replace(/[ \t\r\n\f\v]+/g,' ').replace(/^ +| +$/g,'').toLowerCase();
};
const compareText=(a,b)=>{
  const left=Array.from(a),right=Array.from(b);
  for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])return left[i].codePointAt(0)-right[i].codePointAt(0);
  return left.length-right.length;
};
async function hashText(text){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
const digest=value=>hashText(canonicalGateJSON(value));

function descriptor(candidate){
  const result=Object.fromEntries(['id','reading_id','fill','rank','local_decision'].map(key=>[key,candidate[key]]));
  result.score=candidate.terminal_scorecard&&Object.hasOwn(candidate.terminal_scorecard,'score')?
    candidate.terminal_scorecard.score:candidate.score??null;
  check(result.score===null||typeof result.score==='number'&&Number.isFinite(result.score),'invalid corpus score');
  return result;
}

async function descriptorPins(corpus,expected){
  check(pin(expected),'missing corpus descriptor digest');
  // JSON decoding loses Python's integer/float distinction. Only the declared
  // score field has these two legal encodings; the complete digest must match.
  const choices=corpus.map(candidate=>{
    const value=descriptor(candidate),plain=canonicalGateJSON(value);
    if(!Number.isInteger(value.score))return [plain];
    const asFloat='{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+
      (key==='score'?String(value.score)+'.0':canonicalGateJSON(value[key]))).join(',')+'}';
    return plain===asFloat?[plain]:[plain,asFloat];
  });
  let combinations=[[]];
  for(const choice of choices){
    check(combinations.length*choice.length<=1024,'corpus score encoding is not bounded');
    combinations=combinations.flatMap(prefix=>choice.map(value=>[...prefix,value]));
  }
  for(const values of combinations)if(await hashText('['+values.join(',')+']')===expected)
    return new Map(await Promise.all(values.map(async(value,index)=>[corpus[index].id,await hashText(value)])));
  throw Error('Proposal pool binding: corpus descriptor digest changed');
}

function compareProposal(a,b){
  return b.evidence_tier-a.evidence_tier||b.fusion_score-a.fusion_score||
    Number(a.input_rank===null)-Number(b.input_rank===null)||
    (a.corpus_rank||1e9)-(b.corpus_rank||1e9)||(a.input_rank||1e9)-(b.input_rank||1e9)||
    compareText(a.surface_key,b.surface_key)||compareText(a.id,b.id);
}

async function replayReading(corpus,inputs,blocked,hashes){
  const grouped=new Map();
  for(const [index,candidate]of corpus.entries()){
    const status=candidate.local_decision?.status,rank=index+1,key=surface(candidate.fill);
    check(Object.hasOwn(tiers,status)&&candidate.rank===rank,'corpus viability/order changed');
    if(grouped.has(key)){grouped.get(key).same_surface_corpus_ids.push(candidate.id);continue;}
    grouped.set(key,{id:candidate.id,fill:candidate.fill,surface_key:key,provenance:'CORPUS',
      evidence_tier:tiers[status],status,corpus_candidate_id:candidate.id,corpus_candidate_sha256:hashes.get(candidate.id),
      corpus_rank:rank,corpus_score:descriptor(candidate).score,input_nomination_id:null,input_nomination_sha256:null,input_rank:null,
      same_surface_corpus_ids:[candidate.id],independent_corpus_evidence:status==='evidence_backed_suggestion',
      input_independent_evidence_votes:0,fusion_contributions:[{family:'CORPUS',rank,value:1/(60+rank)}]});
  }
  const seen=new Set();
  for(const [index,candidate]of inputs.entries()){
    const key=surface(candidate.fill),rank=index+1;
    check(!seen.has(key)&&candidate.ranking?.input_context_ordinal===rank,'input order or exact surface changed');seen.add(key);
    if(blocked.has(key)&&!grouped.has(key))continue;
    if(!grouped.has(key))grouped.set(key,{id:candidate.id,fill:candidate.fill,surface_key:key,provenance:'INPUT',evidence_tier:0,
      status:'input_context_only',corpus_candidate_id:null,corpus_candidate_sha256:null,corpus_rank:null,corpus_score:null,
      input_nomination_id:null,input_nomination_sha256:null,input_rank:null,same_surface_corpus_ids:[],
      independent_corpus_evidence:false,input_independent_evidence_votes:0,fusion_contributions:[]});
    const proposal=grouped.get(key);
    Object.assign(proposal,{input_nomination_id:candidate.id,input_nomination_sha256:await digest(candidate),input_rank:rank,
      provenance:proposal.corpus_candidate_id?'CORPUS_AND_INPUT':'INPUT'});
    proposal.fusion_contributions.push({family:'INPUT',rank,value:1/(60+rank)});
  }
  const values=[...grouped.values()];
  for(const proposal of values)proposal.fusion_score=proposal.fusion_contributions.reduce((sum,c)=>sum+c.value,0);
  values.sort(compareProposal);values.forEach((proposal,index)=>{proposal.rank=index+1;});
  return {proposals:values.slice(0,5),count:values.length};
}

export async function verifyProposalPool(record,caseInfo,inputView){
  const result=record?.result?.redaction||record?.result,pool=result?.proposal_pool;
  if(pool==null)return null;
  check(caseInfo?.task==='redaction'&&result.task==='redaction','not a redaction record');
  check(pool.version===PROPOSAL_POOL_VERSION&&pool.ranking_policy==='EVIDENCE_TIER_THEN_EQUAL_FAMILY_RRF_INPUT_TIE_BREAK'&&
    pool.rrf_k===60&&pool.top_k===5&&same(pool.family_weights,{CORPUS:1,INPUT:1})&&
    pool.score_meaning==='RECIPROCAL_RANK_FUSION_WITHIN_EVIDENCE_TIER_NOT_CORRECTNESS_PROBABILITY'&&
    pool.evidence_tier_priority===true&&pool.exact_surface_deduplication===true&&pool.corpus_candidates_scores_decisions_unchanged===true&&
    pool.input_evidence_credit===false&&pool.same_actor_or_event_certified===false&&pool.source_policy_modified===false&&pool.api_calls===0,
    'unsupported fusion policy');
  const c=Object.fromEntries(['case_id','corpus','task','query','document_id','date','focal_marker'].map(key=>[key,caseInfo[key]]));
  const querySHA=await digest(c.query),nativePins=[result.provided_plan_sha256,result.reading_adapter?.source_plan_sha256].filter(value=>value!=null);
  check(nativePins.every(value=>pin(value)&&value===nativePins[0]),'plan source pins disagree');
  check(pool.query_sha256===querySHA&&result.query_sha256===querySHA&&pool.case_sha256===await digest(c)&&
    pool.plan_sha256===(nativePins[0]||await digest(record.plan))&&pool.readings_packet_sha256===await digest(record.plan?.readings_packet),
    'case/query/plan changed');
  const declared=record.plan?.readings_packet?.readings,corpusRows=result.readings;
  check(Array.isArray(declared)&&Array.isArray(corpusRows)&&Array.isArray(pool.readings)&&pool.readings.length===declared.length&&
    corpusRows.length===declared.length&&new Set(declared.map(r=>r.id)).size===declared.length,'reading inventory changed');
  const nominal=result.input_nomination;
  if(nominal!=null)check(inputView?.version==='input-context-view/1'&&inputView.query===c.query&&
    Array.isArray(inputView.readings)&&inputView.readings.length===declared.length,'input nomination was not verified first');
  const withheld=new Set(rows(result.controller_shortlist?.withheld_candidate_ids)),view=[];
  for(const [index,reading]of declared.entries()){
    const raw=pool.readings[index],native=corpusRows[index],rid=reading.id;
    check(typeof rid==='string'&&rid&&raw.reading_id===rid&&native.reading?.id===rid&&
      raw.reading_sha256===await digest(reading)&&same(native.reading,reading),'declared reading changed');
    const corpus=native.candidates;
    check(Array.isArray(corpus)&&new Set(corpus.map(c=>c.id)).size===corpus.length&&
      corpus.every(c=>typeof c.id==='string'&&c.id&&c.reading_id===rid&&!withheld.has(c.id)),'corpus IDs or withheld membership changed');
    const hashes=await descriptorPins(corpus,raw.corpus_shortlist_sha256);
    const nomination=rows(nominal?.readings).filter(row=>row.reading_id===rid);
    check(nominal==null||nomination.length===1,'input reading missing or duplicated');
    const inputs=nomination[0]?.nominations||[],verified=rows(inputView?.readings).find(row=>row.id===rid);
    check(Array.isArray(inputs)&&raw.input_nominations_sha256===await digest(inputs),'input nomination digest changed');
    if(inputs.length)check(verified&&verified.candidates.length===inputs.length&&inputs.every((item,i)=>{
      const v=verified.candidates[i];return v.proof===item&&v.id===item.id&&v.fill===item.fill&&item.reading_id===rid&&
        item.independent_corpus_evidence===false&&item.independent_evidence_votes===0&&item.corpus_score===null&&
        item.corpus_citation===null&&item.factual_decision===null;
    }),'input proof is detached or has corpus credit');
    const visible=new Set(corpus.map(c=>surface(c.fill))),blocked=new Set();
    for(const candidate of rows(result.assessed_candidates))if(candidate.reading_id===rid&&
      (withheld.has(candidate.id)||!Object.hasOwn(tiers,candidate.local_decision?.status)))blocked.add(surface(candidate.fill));
    for(const key of visible)blocked.delete(key);
    check(same(raw.blocked_input_forms,[...blocked].sort(compareText)),'blocked input forms changed');
    const expected=await replayReading(corpus,inputs,blocked,hashes);
    check(raw.proposed_unique_fills===expected.count&&same(raw.proposals,expected.proposals),'native fusion order, arithmetic or provenance changed');
    view.push({id:rid,reading,corpus,proposals:raw.proposals.map(proposal=>({proposal,
      corpus:proposal.corpus_candidate_id?corpus.find(c=>c.id===proposal.corpus_candidate_id):null,
      input:proposal.input_nomination_id?verified.candidates.find(c=>c.id===proposal.input_nomination_id):null}))});
  }
  return {version:PROPOSAL_POOL_VERSION,readings:view};
}

export function preferredProposalReading(record,caseInfo,{pool=null,inputView=null}={}){
  if(caseInfo?.task!=='redaction')return '';
  const native=rows((record?.result?.redaction||record?.result)?.readings);
  const supported=['evidence_backed_suggestion','partial_grounding'].map(status=>native.find(row=>rows(row.candidates).some(c=>
    c.reading_id===row.reading?.id&&c.local_decision?.status===status))).find(Boolean);
  const input=rows(inputView?.readings).find(row=>row.candidates?.length&&native.some(n=>n.reading?.id===row.id));
  return supported?.reading.id||input?.id||pool?.readings.find(row=>row.proposals.length)?.id||
    native.find(row=>row.candidates?.length)?.reading.id||native[0]?.reading?.id||'';
}

function node(tag,text,attrs={}){
  const element=document.createElement(tag);if(text!=null)element.textContent=String(text);
  for(const [key,value]of Object.entries(attrs))if(value!=null)element.setAttribute(key,String(value));return element;
}
export function proposalSourceLabel(proposal){
  return proposal.provenance==='INPUT'?'Supplied context':proposal.provenance==='CORPUS_AND_INPUT'?'Corpus + supplied context':'Corpus';
}
export function renderProposalOrder(reading,{formatText=value=>value}={}){
  const host=node('section',null,{class:'proposal-pool-order','data-testid':'proposal-pool-order'});
  host.append(node('h3','Proposal order'),node('p','Evidence class first, then equal-family reciprocal-rank contributions. Not probability or corpus evidence points.',{class:'note'}));
  const audit=node('details');audit.append(node('summary','Pool order and rank contributions'));
  for(const {proposal:p}of reading.proposals){
    const row=node('div',null,{class:'proposal-pool-order-row','data-proposal-rank':p.rank,'data-proposal-id':p.id});
    row.append(node('strong',p.rank+'. '+formatText(p.fill)),node('span',proposalSourceLabel(p),{class:'badge'}));
    const detail=node('details'),summary=node('summary','Rank contributions');detail.append(summary,
      node('p','Fusion index: '+p.fusion_score.toFixed(4),{'data-fusion-score':p.fusion_score,title:String(p.fusion_score)}));
    for(const c of p.fusion_contributions)detail.append(node('p',c.family+' rank '+c.rank+': 1 / (60 + '+c.rank+') = '+c.value.toFixed(4),
      {'data-fusion-family':c.family,'data-fusion-value':c.value}));
    row.append(detail);audit.append(row);
  }
  host.append(audit);
  return host;
}

export function renderSuppliedProposalTrace(item,query){
  const proof=item?.proof,source=item?.source,chars=Array.from(query||'');
  check(proof&&source&&chars.slice(source.start,source.end).join('')===source.text,'input source span changed');
  const host=node('section',null,{'data-testid':'supplied-proposal-trace'});
  host.append(node('p','Input-derived context only. No independent corpus votes, identity certificate or factual support.',{class:'notice'}));
  const quote=node('blockquote',null,{class:'cue'}),start=Math.max(0,source.start-100),end=Math.min(chars.length,source.end+140);
  quote.append(document.createTextNode(chars.slice(start,source.start).join('')),node('mark',source.text,
    {'data-input-start':source.start,'data-input-end':source.end}),document.createTextNode(chars.slice(source.end,end).join('')));
  host.append(node('h3','Input -> lexical realization -> fill'),quote,
    node('p','Supplied wording: '+source.text+' -> '+item.fill),node('p','WordNet resource SHA-256: '+proof.lexical_realization.resource.sha256));
  const derivation=node('pre',JSON.stringify(proof.lexical_realization,null,2),{class:'raw-record'});
  host.append(node('h4','Recorded WordNet transformation'),derivation,
    node('p','Offsets above belong to the public input. Original-document offsets are available only through its separately verified Origin attachment.',{class:'note'}));
  return host;
}

import {METHOD_ID,check,sha,same,stable,parseRaw,validateEnvelope} from './r-contract.js';
import {mountFinalDigest} from './workbench-final-digest.js';
export const R_METHOD_ID=METHOD_ID;
const handles=new WeakMap(),attempts=new WeakMap();
const snapshot=o=>JSON.stringify(stable([o.row,o.record,o.config,o.resourceBinding]));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function reviewedSourceEndpoint(pin,{caseInfo,config,resourceBinding,base=location.href}){
  check(pin?.method_id===METHOD_ID&&typeof pin.endpoint==='string','explicit R method/endpoint required');
  const target=new URL(pin.endpoint,base),origin=new URL(base),expected={case_id:caseInfo.case_id,config,resource_id:resourceBinding?.resource_id,registry_sha256:resourceBinding?.registry_sha256,index_sha256:resourceBinding?.index_sha256};
  check(target.origin===origin.origin&&/^https?:$/.test(target.protocol)&&!target.username&&!target.password&&!target.hash&&target.pathname==='/api/current/source-realized-redaction','only exact same-origin R endpoint allowed');
  check(['llm_readings','llm_atoms','llm_local'].includes(config)&&typeof expected.resource_id==='string'&&expected.resource_id&&sha(expected.registry_sha256)&&sha(expected.index_sha256),'exact current config/public resource required');
  for(const[k,v]of target.searchParams)check(Object.hasOwn(expected,k)&&expected[k]===v&&target.searchParams.getAll(k).length===1,'endpoint scope changed/repeated');
  for(const[k,v]of Object.entries(expected))target.searchParams.set(k,v);return target;
}
export async function loadReviewedSourceMethod(options){
  const {row,record,config,resourceBinding,signal,verified:fetchVerified,base=location.href}=options,token=Object.freeze({});
  if(record&&typeof record==='object')attempts.set(record,token);
  const pin=row?.reviewed_source_assessment;if(pin==null)return null;
  check(pin.method_id===METHOD_ID&&['original_method_sha256','public_method_sha256','original_view_sha256','public_view_sha256','original_native_sha256','query_sha256'].every(k=>sha(pin[k]))&&typeof fetchVerified==='function','bound public R METHOD/VIEW pin required');
  if(record.reviewed_source_assessment!=null)check(same(record.reviewed_source_assessment,pin),'record/current report method pin differs');
  const before=snapshot(options),url=reviewedSourceEndpoint(pin,{caseInfo:row.case,config,resourceBinding,base});
  check(!signal?.aborted,'cancelled R selection');const packet=await fetchVerified(url.href,signal);
  check(!signal?.aborted&&attempts.get(record)===token&&before===snapshot(options),'late/cancelled/current resource changed');
  const parsed=parseRaw(packet?.decoded),result=await validateEnvelope(parsed,{row,record,config,resourceBinding,pin});
  check(!signal?.aborted&&attempts.get(record)===token&&before===snapshot(options),'authority changed during raw/method verification');
  freeze(result.method);freeze(result.view);freeze(result.citations);
  const handle=Object.freeze({method_id:METHOD_ID,view:result.view,method:result.method});
  handles.set(handle,{options,before,token,citations:result.citations,signal});return handle;
}
function bound(handle){const state=handles.get(handle);check(state&&attempts.get(state.options.record)===state.token&&!state.signal?.aborted&&state.before===snapshot(state.options),'verify the exact current native/report/public resource before rendering');return state;}
export function reviewedSourceSummary(handle){bound(handle);const view=handle.view;
  return {method_id:METHOD_ID,title:view.nomination_only?'Source-derived nominations':view.focal_summary.source_approved?'Evidence-backed candidates':'Contextual source candidates',
    tone:view.nomination_only?'unresolved':view.focal_summary.source_approved?'supported':'mixed',complete:null,total:view.readings.length,
    direct_candidates:view.focal_summary?.source_approved??0,world_truth_certified:false,native_result_rewritten:false};
}
const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const button=(label,action,attrs={})=>{const n=el('button',label,{type:'button',...attrs});n.addEventListener('click',action);return n;};
function style(){if(document.querySelector('link[data-source-realized-r]'))return;document.head.append(el('link',null,{rel:'stylesheet',href:new URL('./workbench-source-realized-r.css',import.meta.url).href,'data-source-realized-r':''}));}
export function evidenceLabel(p){if(p.evidence_state==='INFERENTIAL_CONTEXT'){
    const states=Object.values(p.focal_row?.raw_focal_assessment?.assessment?.facets||{}).map(x=>x.status);
    if(states.includes('MATCHED')&&states.includes('INFERRED'))return 'Partially corroborated candidate';return 'Contextual candidate';}
  return {DIRECT_SOURCE_APPROVED:'Evidence-backed suggestion',NOMINATION_ONLY:'Nomination only',EXPLICIT_CONFLICT:'Explicit source conflict',HOLD_SEMANTIC_REVIEW:'Semantic review held',UNRESOLVED:'Unresolved'}[p.evidence_state]||'Unresolved';}
export function visibleReadingOptions(view){
  const groups=new Map();
  for(const branch of view.readings){if(!branch.candidates.length)continue;
    const label=(branch.reading.outer_family+' / '+branch.reading.role).replaceAll('_',' '),description=(branch.reading.explanation||'').trim().replace(/\s+/g,' ')||label;
    const key=description.toLowerCase();
    let group=groups.get(key);if(!group){group={id:branch.reading.id,label,branch,reading_ids:[]};groups.set(key,group);}group.reading_ids.push(branch.reading.id);
    if(branch.reading.id===view.selection.display_reading_id){group.id=branch.reading.id;group.branch=branch;group.label=label;}}
  const labels=new Map();return [...groups.values()].map(group=>{const count=(labels.get(group.label)||0)+1;labels.set(group.label,count);return {...group,label:group.label+(count>1?' ('+count+')':'')};});
}
export function renderReviewedSourceWorkspace(handle,{stage,onSource,onOrigin,onBaseline,onDetails,formatText=x=>x,policyText='',renderVerifiedDigest,assertSelectionCurrent}={}){
  const state=bound(handle),view=handle.view,method=handle.method,summary=reviewedSourceSummary(handle);style();
  check(typeof stage==='function'&&typeof onSource==='function'&&typeof onBaseline==='function','existing stage/source/baseline callbacks required');
  const assertCurrent=()=>{bound(handle);if(typeof assertSelectionCurrent==='function')assertSelectionCurrent();},inspect=p=>{assertCurrent();check(state.citations.some(c=>same(c,p)),'source action outside exact own-source proof');return onSource(p);};
  const action=fn=>(...args)=>{assertCurrent();return fn(...args);};
  const hero=el('section',null,{class:'construction-verdict verdict-strip sr-r-hero','data-testid':'compact-verdict','data-method-id':METHOD_ID});
  hero.append(el('h2',summary.title,{'data-testid':'local-verdict-title'}),el('p','Sources through '+view.case.date));
  const baseline=button('Original result',action(onBaseline),{'data-testid':'structural-baseline-open'});hero.append(baseline);
  if(typeof onOrigin==='function')hero.append(button('Origin',action(onOrigin)));
  const reading=stage('02','Facts','Public input'),results=stage('03','Source-proposal links','Insertion provenance'),sources=stage('04','Sources','Exact quotations'),math=stage('05','Ranked fills','Source-realized candidates'),audit=stage('06','Method and provenance','');
  for(const s of [reading,results,sources,math,audit])s.outer.classList.add('sr-r-stage');
  const options=visibleReadingOptions(view),select=el('select',null,{'aria-label':'Source-realized reading','data-testid':'r-reading-select'});
  for(const o of options)select.append(el('option',o.label,{value:o.id}));select.value=options.find(o=>o.id===view.selection.display_reading_id)?.id||options[0]?.id||'';select.disabled=options.length===0;
  reading.body.append(select);
  if(view.selection.presentation_only)reading.body.append(el('small','Curated presentation default',{'data-testid':'r-presentation-note',class:'sr-r-note'}));
  const atoms=state.options.record.plan?.atoms;check(Array.isArray(atoms)&&atoms.length>0&&atoms.length<=128,'actual native fact inventory required');
  const factIds=new Set();for(const [i,atom]of atoms.entries()){check(typeof atom.id==='string'&&!factIds.has(atom.id)&&typeof atom.text==='string'&&Array.isArray(atom.query_spans)&&atom.query_spans.length>0&&atom.query_spans.every(p=>Number.isSafeInteger(p.start)&&Number.isSafeInteger(p.end)&&p.start>=0&&p.end>p.start&&Array.from(view.case.query).slice(p.start,p.end).join('')===p.text),'actual public fact/span differs');factIds.add(atom.id);
    const fact=el('article',null,{class:'sr-r-fact','data-testid':'r-public-fact','data-fact-id':atom.id});fact.append(el('strong','F'+(i+1)),el('p',formatText(atom.text),{'data-original-text':atom.text}));reading.body.append(fact);}
  function proof(pageId,p){return state.citations.find(c=>c.canonical_page_id===pageId&&c.start===p.start&&c.end===p.end&&c.text===p.text);}
  function details(variant){assertCurrent();const body=el('div',null,{class:'sr-r-details'}),p=variant.priority;
    body.append(el('h3',evidenceLabel(p)),el('p',variant.completed_input),el('p','Original phrase: '+variant.source.original_phrase.text),el('p',variant.transformation.description));
    if(p.evidence_class!==2)body.append(el('p',p.mode==='NOMINATION_ONLY'?'Nomination only: focal support has not been assessed.':'Not direct-source approved: some inserted constraints remain inferred, missing, held or conflicting.'));
    const facets=p.focal_row?.raw_focal_assessment?.assessment?.facets;
    if(facets)for(const[k,f]of Object.entries(facets))if(f.status!=='NOT_REQUESTED')body.append(el('p',k.replaceAll('_',' ')+': '+f.status+' / '+f.reason));
    if(p.quarantine)body.append(el('p','Quarantined: '+p.quarantine.reason));
    for(const d of variant.grammar.unsupported_diagnostics||[])body.append(el('p','Local diagnostic: '+(d.reason||d.state)));
    if(typeof onDetails==='function')onDetails(body);else return body;
  }
  function card(candidate){const variant=candidate.variants.find(v=>v.id===candidate.representative_id),p=candidate.priority,s=variant.source_reader,page=view.source_pages.find(x=>x.page_id===s.canonical_page_id);
    const host=el('article',null,{class:'sr-r-card','data-testid':'r-candidate','data-candidate-id':candidate.id,'data-evidence-state':p.evidence_state,'data-rank':candidate.rank}),head=el('header'),title=el('div');
    title.append(el('span','#'+candidate.rank,{class:'sr-r-rank'}),el('h3',formatText(candidate.fill)));head.append(title,el('span',p.value.toFixed(4),{class:'sr-r-index','data-testid':'r-priority-index',title:'Ranked priority index; not probability'}));
    const label=el('p',evidenceLabel(p),{class:'sr-r-evidence','data-testid':'r-evidence-label'});host.append(head,label);
    const track=el('div',null,{class:'sr-r-score-track',role:'img','aria-label':'Priority index '+p.value.toFixed(4)+'; not probability'}),bar=el('span');bar.style.width=(100*p.value)+'%';track.append(bar);host.append(track);
    host.append(el('blockquote',s.quote_span.text,{'data-testid':'r-exact-quote','data-original-text':s.quote_span.text}));
    const meta=page.original_page_metadata||{},number=meta.earlier_page??meta.later_page;
    host.append(button('Inspect source',()=>inspect(proof(s.canonical_page_id,s.quote_span)),{'data-testid':'r-source-inspect',class:'sr-r-source'}),
      el('footer',s.document_id+' / '+s.date+(number!=null?' / p. '+number:''),{class:'sr-r-locator'}));
    const transform=el('details');transform.append(el('summary','Original phrase and transformation'),el('p',s.phrase_span.text,{'data-testid':'r-original-phrase'}),el('p',variant.transformation.kind+': '+variant.transformation.description));host.append(transform);
    const qualification=el('details');qualification.append(el('summary','Complete source qualification'),el('blockquote',s.qualification_span.text,{'data-testid':'r-full-qualification'}),button('Inspect full qualification',()=>inspect(proof(s.canonical_page_id,s.qualification_span))));host.append(qualification);
    const extra=el('details');extra.append(el('summary','Insertion, constraints and source variants ('+candidate.variants.length+')'),el('p',variant.completed_input));
    if(typeof onDetails==='function')extra.append(button('Constraint details',()=>details(variant)));
    else extra.append(details(variant));
    for(const v of candidate.variants.slice(1))extra.append(el('p',v.fill+' / '+v.source.document_id+' / '+v.priority.value.toFixed(4)),button('Inspect variant source',()=>inspect(proof(v.source.page_id,v.source.exact_quote))));host.append(extra);return host;
  }
  function renderReading(){assertCurrent();const selected=options.find(o=>o.id===select.value);results.body.replaceChildren();sources.body.replaceChildren();math.body.replaceChildren();
    if(!selected){math.body.append(el('p','No admitted candidate in the recorded source pages.'));return;}
    results.outer.dataset.readingId=selected.id;math.outer.dataset.readingId=selected.id;const branch=selected.branch;
    const headers=el('div',null,{class:'sr-r-chain-head', 'aria-hidden':'true'});for(const label of ['Source excerpt','Original phrase','Suggested fill'])headers.append(el('span',label));results.body.append(headers);
    const excerpts=new Map();
    const retain=p=>{const key=JSON.stringify([p.canonical_page_id,p.page_sha256,p.start,p.end,p.text]);if(!excerpts.has(key))excerpts.set(key,p);};
    for(const candidate of branch.candidates){const variant=candidate.variants[0],s=variant.source_reader,chain=el('article',null,{class:'sr-r-chain','data-testid':'r-proposal-chain','data-native-kg-hops':'0'});
      const source=el('div',null,{class:'sr-r-chain-col'}),phrase=el('div',null,{class:'sr-r-chain-col'}),fill=el('div',null,{class:'sr-r-chain-col'});
      const quoteButton=button('',()=>inspect(proof(s.canonical_page_id,s.quote_span)),{class:'sr-r-chain-excerpt','data-testid':'r-chain-source-inspect','aria-label':'Inspect exact source excerpt'});quoteButton.append(el('blockquote',s.quote_span.text,{'data-original-text':s.quote_span.text}));source.append(quoteButton);
      phrase.append(button(s.phrase_span.text,()=>inspect(proof(s.canonical_page_id,s.phrase_span)),{class:'sr-r-chain-phrase','aria-label':'Inspect original source phrase'}));
      fill.append(el('strong',formatText(candidate.fill)));const insertion=el('details');insertion.append(el('summary','Insertion'),el('p',variant.completed_input),el('p',variant.transformation.description));fill.append(insertion);
      chain.append(source,phrase,fill);results.body.append(chain);
      for(const v of candidate.variants){const reader=v.source_reader;retain(proof(reader.canonical_page_id,reader.quote_span));for(const c of reader.focal_source_contexts||[])retain(proof(reader.canonical_page_id,{...c.anchor,text:c.anchor.quote}));}}
    for(const [key,p]of excerpts){const item=el('article',null,{class:'sr-r-source-card','data-testid':'r-source-quote','data-source-key':key}),inspectButton=button('',()=>inspect(p),{class:'sr-r-source-excerpt','aria-label':'Inspect exact source'});
      inspectButton.append(el('blockquote',p.text,{'data-original-text':p.text}));item.append(inspectButton,el('footer',p.document_id+' / '+p.date+(p.earlier_page!=null?' / p. '+p.earlier_page:p.later_page!=null?' / p. '+p.later_page:''),{class:'sr-r-locator'}));sources.body.append(item);}
    for(const candidate of branch.candidates.slice(0,5))math.body.append(card(candidate));
    if(branch.candidates.length>5){const reserve=el('details',null,{'data-testid':'r-reserves'});reserve.append(el('summary','Reserve candidates 6–8'));for(const c of branch.candidates.slice(5,8))reserve.append(card(c));math.body.append(reserve);}
    const rule=view.nomination_only?method.score_rules.nomination_formula:method.score_rules.final_formula;
    const how=el('details');how.append(el('summary','How candidates are ordered'),el('code',rule),el('p',view.nomination_only?'Nomination context priority only; not probability.':'Class 2: source-ascribed fill approved; class 1: contextual; class 0: unresolved, held or conflicting. Raw alignment is .75 facet alignment + .25 own-quote lexical fit. Not probability.'),
      el('p','The displayed index determines rank. Same-surface groups use per-document MAX and overall MAX, never added votes or proof unions.'));
    if(branch.holds.length||branch.deferred.length)how.append(el('p','Local holds: '+branch.holds.length+'; deferred: '+branch.deferred.length+'.'));math.body.append(how);
  }
  select.addEventListener('change',renderReading);renderReading();
  const raw=el('details');raw.append(el('summary','Source scope and audit details'),el('p','This method assesses the inserted contribution as attributed by its own source, not world truth or the whole visible event. The original result and its evidence rules remain unchanged.'),
    el('p',policyText||'The original source policy and cutoff remain in force.'),el('p','Method: '+METHOD_ID),
    el('p','Original native: '+view.original_native.native_ref.sha256),el('p','Original method: '+method.original_method_sha256),el('p','Original view: '+view.original_view_sha256),el('p','Public view: '+view.sha256));
  const readingAudit=el('div',null,{'data-testid':'r-reading-audit'});for(const b of view.readings)readingAudit.append(el('p',b.reading.id+' / '+b.reading.explanation+' / '+b.candidates.length+' display candidates'));raw.append(readingAudit);
  if(view.focal_summary)raw.append(el('p','Focal rows: '+view.focal_summary.valid_rows+'; direct source-approved: '+view.focal_summary.source_approved+'; quarantined: '+view.focal_summary.quarantined+'.'));
  audit.body.append(raw);
  if(renderVerifiedDigest!=null){const o=state.options;mountFinalDigest(audit.body,{assertCurrent,onSource:inspect,binding:{case_id:view.case.case_id,config:o.config,method_id:METHOD_ID,query_sha256:view.query_sha256,
      original_view_sha256:view.original_view_sha256,public_view_sha256:view.sha256,native_checkpoint_sha256:view.original_native.native_ref.sha256,native_checksum:o.record.native_checksum,source_view_policy:structuredClone(view.source_view_policy)}},renderVerifiedDigest);}
  assertCurrent();return [hero,reading.outer,results.outer,sources.outer,math.outer,audit.outer];
}

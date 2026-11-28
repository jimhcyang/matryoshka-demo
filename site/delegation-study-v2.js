import {mountEvidenceMap} from './evidence-map.js?v=20261128-polish1';
import {renderEndingScoreChart,uniqueProofs} from './workbench-visuals.js';
const $=selector=>document.querySelector(selector),rows=value=>Array.isArray(value)?value:[];
const state={data:null,arm:'full_middle_clue',slot:0,reading:0,map:null};
const armNames={full_middle_clue:'Full passage',full_middle_no_clue:'Without closing clue',minimal_first_last:'Short passage',minimal_first_last_clue:'Short passage + clue'};
const element=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
const button=(text,fn,attrs={})=>{const n=element('button',text,{type:'button',...attrs});n.onclick=fn;return n;};
const current=()=>state.data.cases.find(c=>c.window_arm===state.arm&&c.position===(state.slot?'second':'first'));
const reading=()=>rows(current()?.readings)[state.reading];
const status=value=>({evidence_backed_suggestion:'Evidence-backed',partial_grounding:'Partial source match',exploratory_contextual:'Contextual',incompatible_not_viable:'Not viable'})[value?.status]||'Unresolved';
async function hash(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
const canonicalText=text=>JSON.stringify(text).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
function masked(text){
  const n=element('div');let at=0;
  for(const m of text.matchAll(/\[\[REDACTION_SLOT:[^\]]+\]\]|\[(?:REDACTED|MASKED|MASK)\]/g)){
    n.append(document.createTextNode(text.slice(at,m.index)),m[0]==='[MASK]'?element('mark','[REDACTION]'):document.createTextNode('[MASKED]'));at=m.index+m[0].length;
  }
  n.append(document.createTextNode(text.slice(at)));return n;
}
function highlighted(text,spans=[]){
  const n=element('div',null,{class:'study-transcription'}),chars=Array.from(text);let at=0;
  for(const span of spans.toSorted((a,b)=>a.start-b.start)){
    if(!Number.isInteger(span.start)||span.start<at||span.end<=span.start||span.end>chars.length)throw Error('Invalid source highlight.');
    n.append(document.createTextNode(chars.slice(at,span.start).join('')),element('mark',chars.slice(span.start,span.end).join('')));at=span.end;
  }
  n.append(document.createTextNode(chars.slice(at).join('')));return n;
}
async function source(ref){
  const body=$('#dialog-body');$('#dialog-title').textContent='Source';body.replaceChildren(element('p','Verifying source...'));$('#source-dialog').showModal();
  try{
    if(ref.document_id===state.data.origin.document_id||!(ref.date<current().case.date))throw Error('Source violates the origin exclusion or cutoff.');
    const sourcePages=state.data.source_pages||{},page=sourcePages[ref.canonical_page_id];
    body.replaceChildren(element('p',ref.document_id+' / '+ref.date,{class:'citation-meta'}));
    if(!page){body.append(element('p','Exact retained quotation'),element('blockquote',ref.text));return;}
    const text=page.text,chars=Array.from(text);
    if(page.document_id!==ref.document_id||page.date!==ref.date||await hash(canonicalText(text))!==ref.page_sha256||chars.slice(ref.start,ref.end).join('')!==ref.text)throw Error('The exact quotation does not replay.');
    const pages=rows(state.data.document_pages?.[ref.document_id]);
    for(const segment of pages.length?pages:[page]){
      if(segment.document_id!==ref.document_id||segment.date!==ref.date||await hash(canonicalText(segment.text))!==(segment.source_sha256||segment.page_text_sha256))throw Error('Document provenance page failed verification.');
      body.append(element('h3',segment.source_page?'Page '+segment.source_page:'Source segment'));
      body.append(highlighted(segment.text,(segment.id||segment.canonical_page_id)===ref.canonical_page_id?[{start:ref.start,end:ref.end}]:[]));
    }
    requestAnimationFrame(()=>body.querySelector('mark')?.scrollIntoView({block:'center'}));
  }catch(error){body.replaceChildren(element('p',error.message,{role:'alert'}));}
}
async function origin(){
  const body=$('#dialog-body');$('#dialog-title').textContent='Input source';body.replaceChildren(element('p','Verifying input provenance...'));$('#source-dialog').showModal();
  try{
    const o=state.data.origin,w=o.full_window;
    if(await hash(canonicalText(w.text))!==w.page_text_sha256||await hash(w.text)!==w.raw_utf8_sha256)throw Error('Input source digest changed.');
    const mapping=rows(o.input_window_mappings).find(m=>m.case_id===current().case.case_id);
    if(!mapping||await hash(canonicalText(current().case.query))!==mapping.query_sha256)throw Error('Input query mapping changed.');
    const spans=rows(mapping.segments).map(s=>({start:s.source_span[0]-w.start,end:s.source_span[1]-w.start}));
    body.replaceChildren(element('p',o.document_id+' / '+o.date+' / page '+o.source_page,{class:'citation-meta'}),highlighted(w.text,spans),element('p','Input provenance only; the entire source document is excluded from retrieved evidence.',{class:'scope-copy'}));
  }catch(error){body.replaceChildren(element('p',error.message,{role:'alert'}));}
}
function renderResults(){
  const c=current(),r=reading(),items=rows(r?.candidates),list=$('#result-list'),sources=$('#source-list');
  list.replaceChildren();sources.replaceChildren();
  $('#reading-note').textContent=r?.reading?.outer_family==='adjectival'?'An adjective describing the delegation.':r?'A noun used as a modifier of the delegation.':'No grammatical reading was returned.';
  $('#source-count').textContent=c.inspected_page_count==null?'':c.inspected_page_count+' pages inspected';
  $('#reading-select').replaceChildren(...rows(c.readings).map((r,i)=>element('option',r.reading.outer_family==='adjectival'?'Adjective':'Noun modifier',{value:i})));
  $('#reading-select').value=String(state.reading);
  for(const item of items.slice(0,5)){
    const card=element('li',null,{class:'policy-card','data-testid':'scoped-candidate','data-rank':item.rank}),head=element('div',null,{class:'candidate-head'});
    head.append(element('span',String(item.rank).padStart(2,'0'),{class:'rank'}),element('strong',item.fill,{class:'fill'}),element('span',status(item.local_decision),{class:'context-tag'}));
    const refs=uniqueProofs(item.sources||item.citation_union);
    card.append(head);
    for(const ref of refs)card.append(button(ref.text,()=>source(ref),{class:'quote-button','data-testid':'inspect-variants'}));
    list.append(card);
  }
  const refs=uniqueProofs(items.flatMap(c=>c.sources||c.citation_union));
  for(const ref of refs)sources.append(button(ref.text,()=>source(ref),{class:'quote-button'}));
  if(!items.length){list.append(element('li',c.status==='PLANNING_FAILED'?'Planning did not complete for this input.':'No eligible fill was nominated for this reading.',{class:'empty-result'}));}
  const chart=renderEndingScoreChart(items);if(chart)list.after(chart);
  const host=$('#study-map'),trace={reading_id:r?.reading?.id,steps:[],paths:[]};
  for(const [i,h]of rows(c.selected_evidence_handoffs).filter(h=>h.reading_id===r?.reading?.id).entries()){
    const id='handoff:'+i;trace.steps.push({id,kind:'RECORDED_MATCH',nodes:[{id,label:'Source match',is_graph_node:false}],source_refs:h.source_refs,edges:[]});
    trace.paths.push({id,steps:[id],candidate_or_atom_id:h.candidate_id,source_refs:h.source_refs,decision_source_refs:h.source_refs,graph_hops:0,route_mode:'DIRECT_SOURCE_HANDOFF',original_traversal_claimed:false,direction:h.status==='evidence_backed_suggestion'?'FOR':'CONTEXT'});
  }
  state.map?.destroy();state.map=mountEvidenceMap(host,{trace,plan:{atoms:c.facts},items,onSource:source,onNode:value=>{const body=$('#dialog-body');$('#dialog-title').textContent='Recorded fact';body.replaceChildren(element('p',value.text||value.label||'Combined input facts'));$('#source-dialog').showModal();},onEdge:edge=>{const body=$('#dialog-body');$('#dialog-title').textContent='Source handoff';body.replaceChildren(element('p',edge.kind==='QUERY_COMPOSITION'?'Input facts contribute to the same search.':'A recorded source lookup or quotation handoff.'));$('#source-dialog').showModal();}});
}
function render(){
  const c=current();if(!c)throw Error('The selected input was not retained.');
  $('.saved-score-chart')?.remove();
  $('#window-controls').replaceChildren(...Object.entries(armNames).map(([key,name])=>button(name,()=>{state.arm=key;selectReading();render();},{'aria-pressed':String(state.arm===key)})));
  $('#slot-controls').replaceChildren(...['First gap','Second gap'].map((text,i)=>button(text,()=>{state.slot=i;selectReading();render();},{role:'tab','aria-selected':String(state.slot===i),'data-slot':i?'second':'first'})));
  $('#query-text').replaceChildren(masked(c.case.query));$('#slot-position').textContent=state.slot?'Second gap':'First gap';
  $('#fact-list').replaceChildren(...rows(c.facts).map(a=>{const li=element('li');li.append(masked(a.text));return li;}));
  $('#scope-rule').textContent='All eligible documents strictly before '+c.case.date+'. The entire input source is excluded.';
  $('#method-delta').textContent='The closing Swedes paragraph, where supplied, is part of the input. It is not independent corpus proof.';
  $('#run-pin').textContent=c.execution_ref?'Executed artifact / SHA-256 '+c.execution_ref.sha256:'Planning failure retained / no native result substituted.';
  $('#reading-metadata').textContent=JSON.stringify({readings:c.readings?.map(r=>r.reading),scope:c.scope,source_budget:c.source_budget,failures:c.failures},null,2);
  const u=new URL(location.href);u.search=new URLSearchParams({slot:state.slot?'second':'first',window:state.arm}).toString();history.replaceState(null,'',u);
  renderResults();
}
function selectReading(){const values=rows(current()?.readings);state.reading=Math.max(0,values.findIndex(r=>r.candidates?.length));}
$('#reading-select').onchange=event=>{$('.saved-score-chart')?.remove();state.reading=Number(event.target.value);renderResults();};
$('#dialog-close').onclick=()=>$('#source-dialog').close();$('#study-origin').onclick=origin;
try{
  const meta=document.querySelector('meta[name=study-data-sha256]'),path=meta.dataset.file;
  if(!/^[\w-]+\.json$/.test(path||'')||!/^[a-f0-9]{64}$/.test(meta.content))throw Error('Study pin missing.');
  const response=await fetch(new URL(path,import.meta.url),{cache:'no-store',credentials:'omit'}),text=await response.text();
  if(!response.ok||await hash(text)!==meta.content)throw Error('Study byte pin failed.');
  state.data=JSON.parse(text);
  if(state.data.version!=='cib-delegation-public-study/1'||state.data.origin?.entire_origin_excluded!==true||state.data.design?.unknown_gold!==true||state.data.cases.length!==8)throw Error('Study identity or evidence policy changed.');
  const params=new URLSearchParams(location.search);state.slot=params.get('slot')==='second'?1:0;
  if(Object.hasOwn(armNames,params.get('window')))state.arm=params.get('window');
  $('#archive').hidden=true;
  const table=$('#comparison-table');
  for(const c of state.data.cases){const row=element('tr');row.append(element('td',armNames[c.window_arm]),element('td',c.position==='first'?'First gap':'Second gap'),element('td',c.execution_performed?rows(c.readings).flatMap(r=>rows(r.candidates)).map(v=>v.fill).join(', ')||'No nominees':'Planning failed'));table.append(row);}
  selectReading();render();document.body.dataset.studyReady='true';$('#study-status').textContent='Reference not given. All retained input-window comparisons are available.';
}catch(error){$('#study-status').textContent=error.message;$('#query-workspace').replaceChildren(element('p','The pinned study is unavailable. No older result was substituted.',{role:'alert'}));}

// Saved display only. No model, retrieval or native-execution endpoint exists here.
const $=selector=>document.querySelector(selector);
const state={data:null,caseId:'',profile:'bridge_v2',policy:'',opened:new Set(),acknowledged:new Set(),history:null};
const names={S0:'Earlier strict',S1:'Later release, prior only',S2:'Later prior + exact origin'};
const descriptions={S0:'Earlier-release documents strictly before 17 February. The whole origin is excluded.',S1:'Later-release text, but only documents strictly before 17 February. The whole origin is excluded.',S2:'Strict-prior later documents plus the exact origin on 17 February. This is deliberate retrospective origin context.'};
const profileNotes={bridge_v2:'The same rules and 8-page inspection budget apply to all three windows.',broad_v1:'Broader saved pool: 40 documents / 80 pages. S0 was not saved. S1/S2 universe declarations match, but the old L4 dependency hash is incomplete. These ranks are not comparable with the 8-page study.',native_boundary_v2:'A separate quotation-boundary profile. Only the prior-only S1 result was saved; S0 and S2 are unavailable.'};
const node=(tag,text,attrs={})=>{const el=document.createElement(tag);if(text!=null)el.textContent=String(text);for(const[k,v]of Object.entries(attrs))if(v!=null)el.setAttribute(k,String(v));return el;};
const button=(text,callback,attrs={})=>{const el=node('button',text,{type:'button',...attrs});el.addEventListener('click',callback);return el;};
const key=policy=>[state.caseId,state.profile,policy].join('/');
const currentCase=()=>state.data.cases.find(c=>c.case_id===state.caseId);
const record=policy=>state.data.records.find(r=>r.case_id===state.caseId&&r.profile_id===state.profile&&r.policy_id===policy);
const formatted=n=>Number(n).toLocaleString('en-US');
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
async function readJSON(path,expected){
  const url=new URL(path,import.meta.url);
  if(url.origin!==location.origin||!['http:','https:'].includes(url.protocol)||url.search||url.hash)throw Error('Only this static study may supply a saved projection.');
  const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('The pinned static study file is unavailable.');
  const bytes=await response.arrayBuffer();
  if(!/^[a-f0-9]{64}$/.test(expected||'')||hex(await crypto.subtle.digest('SHA-256',bytes))!==expected)throw Error('Saved data failed its exact byte pin. No other record is substituted.');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function showDialog(title,content){$('#dialog-title').textContent=title;$('#dialog-body').replaceChildren(content);$('#source-dialog').showModal();}
function highlighted(text,start,end,expected){
  const chars=Array.from(text),el=node('div',null,{class:'exact-quote'});
  if(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>start&&end<=chars.length&&chars.slice(start,end).join('')===expected){
    el.append(document.createTextNode(chars.slice(0,start).join('')),node('mark',expected),document.createTextNode(chars.slice(end).join('')));
  }else el.textContent=text;
  return el;
}
function displayQuery(query){
  // Display tokens only: never rewrite the pinned query or its source offsets.
  const el=node('div',null,{class:'exact-quote'});
  const markers=/\[\[REDACTION_SLOT:[^\]\r\n]*\]\]|\[REDACTED\]|\[MASK\]/g;
  let cursor=0;
  for(const match of query.matchAll(markers)){
    el.append(document.createTextNode(query.slice(cursor,match.index)));
    const focal=match[0]==='[MASK]';
    el.append(focal?node('mark','[REDACTION]',{'aria-label':'Focal redaction'}):document.createTextNode('[MASKED]'));
    cursor=match.index+match[0].length;
    if(!focal&&query[cursor]&&!/\s/.test(query[cursor]))el.append(document.createTextNode(' '));
  }
  el.append(document.createTextNode(query.slice(cursor)));
  return el;
}
function citationBlock(ref,{word=null,preview=false}={}){
  const block=node('section',null,{class:'citation-block','data-source-page-id':ref.canonical_page_id});
  block.append(node('p',`${ref.document_id} / ${ref.date} / ${ref.release||'saved release'} / physical page ${ref.source_page??'not supplied'}`,{class:'citation-meta'}));
  block.append(node('p',`${ref.canonical_page_id} / exact span [${ref.start}, ${ref.end})`,{class:'citation-meta'}));
  block.append(word?highlighted(ref.text,word.start-ref.start,word.end-ref.start,word.text):highlighted(ref.text));
  if(preview)block.append(node('p','Page preview only, not signed decision evidence.',{class:'context-notice'}));
  block.append(node('p','Original page SHA-256: '+ref.page_sha256,{class:'source-hash'}));
  return block;
}
function sourceFor(candidate){
  const body=node('div');body.append(citationBlock(candidate.context,{word:candidate.source}));
  body.append(node('p',`Literal source wording: "${candidate.source.text}". Saved grammatical form: "${candidate.fill}". Conversion is not masked-word verification or delegation identity.`,{class:'context-notice'}));
  const edge=candidate.own_source_edge;
  if(edge){const detail=node('details');detail.append(node('summary','Actual source-owned edge witness'),node('p',`${edge.semantic_edge_id} / ${edge.relation_evidence_id}`,{class:'source-hash'}),node('p',`${edge.source_id} to ${edge.target_id} / ${edge.relation_type}`,{class:'source-hash'}),node('p','This saved source-nomination edge is not an original query traversal or proof that the hidden group is the same delegation.',{class:'context-notice'}));body.append(detail);}
  showDialog('Exact eligible source context',body);
}
function graphLink(candidate){
  const native=candidate.browser_node;
  if(!native||native.id!==candidate.source_node_id)return null;
  const url=new URL('graph-full-v6.html',location.href);
  url.search=new URLSearchParams({corpus:'cib',release:'later',view:'single',node_id:native.id}).toString();
  return node('a','Explore exact source-vocabulary node',{href:url.pathname+url.search,target:'_blank',rel:'noopener','data-testid':'exact-graph-link','data-node-id':native.id});
}
function candidateCard(candidate){
  const li=node('li',null,{class:'candidate','data-testid':'saved-candidate','data-rank':candidate.rank});
  const head=node('div',null,{class:'candidate-head'});head.append(node('span',String(candidate.rank).padStart(2,'0'),{class:'rank'}),node('strong',candidate.fill,{class:'fill'}));li.append(head);
  li.append(node('p','CONTEXT ONLY / GOLD UNKNOWN',{class:'context-notice'}));
  li.append(node('p',`Source wording: "${candidate.source.text}".`));
  const quoteButton=button('',()=>sourceFor(candidate),{class:'quote-button','data-testid':'candidate-source'});
  const text=highlighted(candidate.context.text,candidate.source.start-candidate.context.start,candidate.source.end-candidate.context.start,candidate.source.text);text.className='';
  quoteButton.append(text,node('small',`${candidate.context.document_id} / ${candidate.context.date}`));li.append(quoteButton);
  const link=graphLink(candidate);if(link){li.append(link);li.append(node('p',candidate.browser_node.instance_identity_asserted===true?'Graph identity is not hidden-word verification.':'A vocabulary node, not a verified delegation identity.',{class:'context-notice'}));}
  else li.append(node('p','No exact browser ID match is published. Use the original quotation; no label-based node is substituted.',{class:'context-notice'}));
  return li;
}
function choosePolicy(policy){state.policy=policy;$('#policy-select').value=policy;renderCards();updateLocation();}
function inspectedSources(value){
  const body=node('div');body.append(node('p',`${value.inspected_page_count} saved inspected pages. Their dates/releases were replayed against the selected policy. These page previews are not independent evidence votes.`,{class:'context-notice'}));
  for(const source of value.inspected_sources){const ref=state.data.source_previews[source.source_key];body.append(citationBlock(ref,{preview:true}));}
  showDialog('Saved inspected sources / '+value.policy_id,body);
}
function renderCards(){
  const host=$('#policy-cards');host.replaceChildren();
  for(const policy of ['S0','S1','S2']){
    const value=record(policy),selected=state.policy===policy,opened=state.opened.has(key(policy));
    const card=node('article',null,{class:'policy-card'+(selected?' selected':''),'data-policy':policy,'data-testid':'policy-card'});
    const heading=node('header',null,{class:'card-heading'}),copy=node('div');copy.append(node('span',policy,{class:'policy-number'}),node('h3',names[policy]));heading.append(copy,button(selected?'Selected':'Select',()=>choosePolicy(policy),{'aria-pressed':String(selected),disabled:value?null:''}));card.append(heading,node('p',descriptions[policy],{class:'rule'}));
    if(!value){card.append(node('p','NOT RECORDED FOR THIS PROFILE',{class:'state-tag'}),node('p','No saved arm exists under these exact candidate-universe rules. No other profile supplies its ranks.',{class:'missing-card'}));host.append(card);continue;}
    const metrics=node('div',null,{class:'metrics'});for(const[n,label]of[[value.eligible_page_count,'eligible pages'],[value.inspected_page_count,'inspected pages']]){const metric=node('div');metric.append(node('strong',formatted(n)),node('span',label));metrics.append(metric);}card.append(metrics,node('span','Unknown gold / saved context',{class:'state-tag'}));
    if(policy==='S2'){
      const label=node('label',null,{class:'ack'}),ack=node('input',null,{type:'checkbox','data-testid':'origin-exception-ack'});ack.checked=state.acknowledged.has(key(policy));ack.onchange=()=>{if(ack.checked)state.acknowledged.add(key(policy));else{state.acknowledged.delete(key(policy));state.opened.delete(key(policy));}renderCards();};
      label.append(ack,document.createTextNode('Include later origin context from 17 February 1959.'));card.append(label);
    }
    if(!opened){
      const open=button('Open saved result',()=>{state.opened.add(key(policy));choosePolicy(policy);},{class:'result-open','data-testid':'open-saved-result',disabled:!selected||policy==='S2'&&!state.acknowledged.has(key(policy))?'':null});
      card.append(node('p',selected?'View the saved result and its sources.':'Select this window to view its result.',{class:'card-copy'}),open);
    }else if(value.candidates.length){
      const list=node('ol',null,{class:'candidate-list'});for(const c of value.candidates)list.append(candidateCard(c));card.append(list);
      if(value.candidates_omitted)card.append(node('p',`First ${value.candidate_display_limit} saved ranks shown; ${value.candidates_omitted} additional saved unique forms are not displayed. No reranking.`,{class:'card-copy'}));
    }else card.append(node('p',`No grounded nationality form was nominated in this ${value.inspected_page_count}-page saved inspection. This is unresolved, not a negative identity finding.`,{class:'empty-result','data-testid':'empty-result'}));
    if(opened)card.append(button(`Inspect ${value.inspected_page_count} saved source pages`,()=>inspectedSources(value),{class:'sources-button','data-testid':'inspected-sources'}));
    host.append(card);
  }
}
function updateLocation(){const url=new URL(location.href);url.search=new URLSearchParams({slot:state.data.case_positions[state.caseId].position,profile:state.profile,...(state.policy?{policy:state.policy}:{})}).toString();history.replaceState(null,'',url);}
function render(){
  const c=currentCase(),position=state.data.case_positions[state.caseId];$('#slot-controls').replaceChildren();
  for(const candidate of state.data.cases){const p=state.data.case_positions[candidate.case_id].position;$('#slot-controls').append(button((p==='first'?'First':'Last')+' nationality slot',()=>{state.caseId=candidate.case_id;state.opened.clear();state.acknowledged.clear();$('#history-content').replaceChildren();render();updateLocation();},{'aria-pressed':String(candidate.case_id===state.caseId),'data-slot':p}));}
  $('#slot-position').textContent=position.position==='first'?'First nationality slot':'Last nationality slot';
  $('#query-text').replaceChildren(displayQuery(c.query));
  $('#origin-binding').textContent=`${c.document_id} / ${c.date} / ${position.source_page_id} / later original mask [${position.source_mask_span.join(', ')})`;
  $('#profile-note').textContent=profileNotes[state.profile];
  const available=state.data.profiles[state.profile].policies;
  for(const option of $('#policy-select').options)if(option.value)option.disabled=!available.includes(option.value);
  if(state.policy&&!available.includes(state.policy)){state.policy='';$('#policy-select').value='';}
  renderCards();
}
$('#dialog-close').onclick=()=>$('#source-dialog').close();
$('#source-dialog').addEventListener('click',event=>{if(event.target===$('#source-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
$('#profile-select').onchange=event=>{state.profile=event.target.value;state.opened.clear();state.acknowledged.clear();render();updateLocation();};
$('#policy-select').onchange=event=>choosePolicy(event.target.value);
$('#origin-ack').onchange=event=>$('#origin-open').disabled=!event.target.checked;
$('#history-ack').onchange=event=>$('#history-open').disabled=!event.target.checked;
$('#origin-open').onclick=async()=>{
  try{if(!$('#origin-ack').checked)return;const ref=state.data.original_source_display;const data=await readJSON(ref.path,ref.sha256);const release=$('#origin-release').value;const body=node('div');body.append(node('p','Post-attempt original-source display. The hidden slots remain withheld; this page is not ordinary S0/S1 evidence.',{class:'context-notice'}),citationBlock(data.source[release]));showDialog('Original still-masked source / '+release,body);}catch(error){$('#study-status').textContent=error.message;}
};
$('#history-open').onclick=async()=>{
  try{
    if(!$('#history-ack').checked)return;
    if(!state.history){const ref=state.data.historical_controls;state.history=await readJSON(ref.path,ref.sha256);}
    const host=$('#history-content');host.replaceChildren(node('p','HISTORICAL FUTURE-INCLUSIVE CONTROLS / NOT DEFAULT EVIDENCE',{class:'context-notice'}));
    const rows=state.history.controls.filter(c=>c.case_id===state.caseId);
    for(const value of rows){const section=node('section',null,{class:'history-record'});section.append(node('h3',`${value.profile_id} / ${value.condition}: ${value.label}`),node('p',`${value.eligible_page_count} eligible / ${value.inspected_page_count} inspected pages under that historical rule. Later-release retrospective data; gold unknown.`));const list=node('ol');
      for(const c of value.candidates){const li=node('li');li.append(node('strong',`${c.rank}. ${c.fill} / context only`),node('p',`${c.source.document_id} / ${c.source.date}${c.future_document?' / FUTURE DOCUMENT: EXCLUDED FROM S0/S1/S2':''}`),button('Exact archived source wording',()=>showDialog('Archived control quotation / not default evidence',citationBlock(c.context)),{class:'quote-button'}));list.append(li);}section.append(list);host.append(section);}
  }catch(error){$('#study-status').textContent=error.message;}
};
try{
  const expected=document.querySelector('meta[name=study-data-sha256]').content;
  state.data=await readJSON('swedish-study-data-v02.json',expected);
  if(state.data.version!=='withheld-nationality-static-study/1'||state.data.gold!==null||state.data.native_execution!==false||state.data.cases.length!==2)throw Error('The saved study contract does not match this display.');
  const params=new URLSearchParams(location.search),slot=params.get('slot');
  state.caseId=state.data.cases.find(c=>state.data.case_positions[c.case_id].position===(slot==='last'?'last':'first')).case_id;
  state.profile=Object.hasOwn(state.data.profiles,params.get('profile'))?params.get('profile'):state.data.default_profile;
  state.policy=['S0','S1','S2'].includes(params.get('policy'))?params.get('policy'):'';
  $('#profile-select').value=state.profile;$('#policy-select').value=state.policy;render();
  $('#study-status').textContent='Saved comparison loaded. Gold remains unknown.';
  $('#data-pin').textContent='Source projection SHA-256: '+expected;
  document.body.dataset.studyReady='true';
}catch(error){$('#study-status').textContent=error.message;$('#policy-cards').replaceChildren(node('p','The exact saved study is unavailable. No inferred answer or alternate record is substituted.',{role:'alert'}));}

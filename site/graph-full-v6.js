"use strict";

let kgSearch;
const kgSearchReady=import('./kg-search-v1.js').then(module=>{kgSearch=module;return module;});
const relatedIndexes=new WeakMap();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[char]);
const graphWeight=value=>{const n=Number(value);if(!Number.isFinite(n))return 'not supplied';if(n===0)return '0';const rounded=n.toLocaleString('en-US',{maximumFractionDigits:2});return Math.abs(n)<.001||Number(rounded.replaceAll(',',''))===0?n.toExponential(2):rounded;};
const fmt=value=>graphWeight(Number(value||0));
// Canvas-only bounds: raw node masses, source weights and memberships are unchanged.
const displayRadius=(value,minimum=0,maximum=Number.MAX_VALUE)=>Math.min(maximum,Math.max(minimum,Number.isFinite(value)?value:minimum));
const displayScale=value=>Number.isFinite(value)&&value>0?Math.min(3.2,value):1;
const compact = (value, limit = 220) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 3).trim()}...`;
};
const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function mapDisplayLabel(node){
  const label=String(node.label||'').replace(/\s+/g,' ').trim();
  const short=text=>text.length<=68&&text.split(/\s+/).length<=10&&!/[;|]|\.{3}|\u2026/.test(text);
  const readable=text=>/[a-z]/.test(text)?text:text.replace(/[A-Z]+/g,word=>/^(US|USA|UK|UN|USSR|NATO|CIA|PRAM|INF|LMI)$/.test(word)?word:word[0]+word.slice(1).toLowerCase()).replace(/\b(And|Of|The|In|For|To)\b/g,(word,offset)=>offset?word.toLowerCase():word);
  if(['Domain','Theme','Community'].includes(node.type)){
    const terms=label.replace(/^(?:(?:Graph\s+)?(?:domain|theme|community)|Connected evidence):\s*/i,'').split(/\s*\/\s*/).filter(Boolean);
    const first=terms[0]||'';
    // Complete native topic terms, never a generated account of their relationship.
    const pair=terms.length>1?first+' and '+terms[1]:first;
    return pair.length<=44&&pair.split(/\s+/).length<=6&&short(pair)?terms.slice(0,2).map(readable).join(' and '):short(first)?readable(first):'Reporting group';
  }
  if(short(label))return readable(label);
  const sentence=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(label)][0]?.segment.trim():'';
  if(['Claim','Event'].includes(node.type)&&sentence&&sentence.split(/\s+/).length>=4&&/[.!?]$/.test(sentence)&&short(sentence))return readable(sentence);
  if(['Claim','Event'].includes(node.type)&&label){
    const words=label.split(/\s+/).slice(0,11);
    while(words.length>4&&/^(?:a|an|the|to|of|in|on|at|for|and|or|with|by)$/i.test(words.at(-1)))words.pop();
    return readable(words.join(' ').replace(/[,;:]$/,''));
  }
  return node.overlay_slot?(node.display_label||'Redacted Slot'):({Entity:'Source entity',Claim:'Source claim',Event:'Source event',Document:'Source document',Segment:'Source passage',RelationEvidence:'Source relation',EvidenceGroup:'Evidence group'}[node.type]||'Graph object');
}
const pause = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const redactionOnlyMode = false;
const singleCorpusMode = new URLSearchParams(window.location.search).get("corpus") !== "cib" && ["iran","vietnam"].includes(new URLSearchParams(window.location.search).get("corpus"));
const currentOnlyMode = true;
const pageParams = new URLSearchParams(window.location.search);
// BEGIN CURRENT_RESOURCE_GRAPH_BRIDGE
const priorViewerBindingV70=typeof viewerBindingURL==='function'?viewerBindingURL:null;
const priorExplorationBindingV70=typeof renderExplorationBinding==='function'?renderExplorationBinding:null;
function currentGraphResource(params=pageParams){
  const keys=['resource_id','registry_sha256','index_sha256'];
  if(!keys.some(key=>params.has(key)))return null;
  if(keys.some(key=>params.getAll(key).length!==1)||!params.get('resource_id')||
      !/^[a-f0-9]{64}$/.test(params.get('registry_sha256')||'')||!/^[a-f0-9]{64}$/.test(params.get('index_sha256')||''))throw Error('Incomplete or mixed current graph resource pins.');
  if(['graph_revision','revision'].some(key=>params.getAll(key).some(value=>value!=='study')))throw Error('Unsupported graph revision');
  if(params.get('graph_revision')==='study'||params.get('revision')==='study')throw Error('A current resource guide cannot select the archived study graph.');
  return Object.fromEntries(keys.map(key=>[key,params.get(key)]));
}
function currentAwareViewerBindingURL(params=pageParams){
  if(currentGraphResource(params))return '/api/graph-v4-viewer?'+new URLSearchParams({corpus:corpusId});
  return priorViewerBindingV70?priorViewerBindingV70(params):'/api/graph-v4-viewer?'+new URLSearchParams({corpus:corpusId});
}
function currentAwareExplorationBinding(params=pageParams){
  if(!currentGraphResource(params)){priorExplorationBindingV70?.(params);return;}
  const heading=document.querySelector('#exploration-binding strong');if(heading)heading.textContent='Current corpus graph';
  const scope=document.querySelector('#exploration-scope');if(scope)scope.textContent='Explicit current resource. This is not the archived study graph; case source eligibility remains narrower than ordinary map navigation.';
  const layout=document.querySelector('#exploration-layout');if(layout)layout.textContent=`Current graph ${refreshBinding.graph_run_id} / hierarchy ${refreshBinding.hierarchy_run_id}. Guide source pins are checked independently; no label-based identity substitution is allowed.`;
}
function verifyCurrentMapBinding(resource,viewer=refreshBinding){
  if(!currentGraphResource())return;
  if(!resource?.graph_id||!resource.hierarchy_id||resource.graph_id!==viewer?.graph_run_id||resource.hierarchy_id!==viewer?.hierarchy_run_id)
    throw Error('The current guide and Corpus Map graph/hierarchy bindings differ. No archived study graph is substituted.');
}
// Export derivations may retain these legacy function declarations. Capture
// them once, then prevent their guide selector from silently choosing study.
if(priorViewerBindingV70)viewerBindingURL=currentAwareViewerBindingURL;
if(priorExplorationBindingV70)renderExplorationBinding=currentAwareExplorationBinding;
async function currentGraphJSON(path,options={}){
  const binding=currentGraphResource(),helpers=binding?await import('./local-decisions-v65.js'):null;
  const url=helpers?helpers.currentResourceURL(path,binding,location.href):path;
  const response=await fetch(url,{cache:'no-store',...options});
  if(!response.ok)throw Error('The explicitly selected saved guide or source is unavailable. No archived study resource is substituted.');
  const value=await response.json();return helpers?helpers.verifyCurrentResourceResponse(url,value):value;
}
async function currentGraphPDFURL(path){
  const binding=currentGraphResource(),selection=guideSelection(pageParams);
  if(!binding||!selection)return new URL(path,location.href);
  const {currentPDFURL}=await import('./local-decisions-v65.js');
  return currentPDFURL(path,{binding,caseId:selection.case_id,config:selection.config},location.href);
}
// END CURRENT_RESOURCE_GRAPH_BRIDGE
const redirectCibRoute = false;
const corpusId = ["iran","vietnam"].includes(pageParams.get("corpus")) ? pageParams.get("corpus") : "cib";
let comparisonAsset, searchAsset;
const refreshMode = false;
let refreshBinding = null;
let assetBase = "";
function assetURL(filename) {
  if(!/^[A-Za-z0-9_.-]+$/.test(filename)||filename.includes(".."))throw new Error("Unbound graph asset name");
  return assetBase+filename;
}
function safeWorkbench(value) {
  try{const url=new URL(value||"/workbench-v6.html",location.origin);if(url.origin===location.origin&&!url.username&&!url.password&&["/","/workbench-v3.html","/workbench-v4.html","/workbench-v5.html","/workbench-v6.html"].includes(url.pathname))return url.pathname+url.search+url.hash;}catch(_error){}
  return "/workbench-v6.html";
}
const returnWorkbench=safeWorkbench(pageParams.get("return_to")||pageParams.get("return"));
// Dense-view accounting can be long; it must never intercept canvas input.
$$('.preview-caption').forEach(caption=>$('#map-accounting').append(caption));
const releaseFilterApplies = (view) => currentOnlyMode && state.displayMode !== "pair" && ["current_reveal","current_later"].includes(view?.key);
const colors = {Domain:"#176e70",Theme:"#c89535",Community:"#315e78",EvidenceGroup:"#68787b",Entity:"#4d8068",Event:"#d39d35",Claim:"#bd5b44",RedactionSlot:"#bd5b44",RelationEvidence:"#79617e",Segment:"#68787b",Document:"#283f49",Unknown:"#68787b"};
const visibilityLabel = (value) => (singleCorpusMode?{both:"present in Confidential and expanded classification views",later_only:"added by the Secret projection",redacted_placeholder:"opaque redaction placeholder"}:{both:"visible in earlier + later releases",later_only:"present in later release only",redacted_placeholder:"opaque redaction placeholder"})[value] || String(value || "");
const visibilityModes = ["show","dim"];
const visibilityModeLabels = {show:"shown in full color",dim:"dimmed"};
const isLaterOnly = (item) => {
  if (!item) return false;
  if (item.visibility === "later_only") return true;
  const counts = item.visibility_counts || {};
  return Number(counts.later_only || 0) > 0 && Number(counts.both || 0) === 0;
};
const laterOnlyShare = (item) => Math.max(0,Math.min(1,Number(item?.later_only_share ?? (isLaterOnly(item)?1:0))));
const levelCopy = {
  domain:"Domains are the five-to-six broadest graph-derived reporting groups in the connected analyst core. Their multi-theme labels orient the corpus; they are navigation partitions, not claims that every member concerns one country or one real-world region.",
  theme:"Themes provide the intermediate analyst scale. Selecting this tab uses the corpus-wide Theme catalog; entering a Domain scopes the catalog to that Domain's child Themes. Every Theme has exactly one Domain parent by construction.",
  community:"Communities are focused evidence neighborhoods built from explicit relations, audited related concepts, and substantially overlapping grounded source spans. Selecting this tab uses the corpus-wide Community catalog; entering a Theme scopes it to that Theme's child Communities.",
  evidence:"Selecting this tab uses a complete count-preserving corpus map: every semantic node belongs to a weighted community or outside-core aggregate. Entering a Community loads its ranked membership and defaults to 256 nodes. Clicking an evidence node inspects it without changing that Community layout; only View all direct connections opens the hierarchy-banded one-hop view. The available ceilings are 32, 256, and 2,048 nodes.",
};
const state = {
  data:null,searchManifest:null,searchViews:{},searchIndexes:{},searchEvidenceViews:{},searchEvidenceIndexes:{},
  searchEvidencePromises:{},searchPromises:{},hierarchyPromises:{},communityDetailPromises:{},communityDetailShards:{},
  neighborhoodPromises:{},neighborhoodShards:{},adjacencyPromises:{},adjacencyShards:{},sourcePromises:{},sourceShards:{},
  renderRevision:0,release:"earlier",displayMode:"single",visibilityMode:"dim",showIneligible:true,level:"domain",
  hideIsolates:true,query:"",searchScope:"evidence",relatedSearch:false,autoOpenSearch:false,autoOpenDirect:false,neighborhoodMotion:true,
  activePanelName:"current",pdfApiAvailable:false,redactionResolutionApiAvailable:false,redactionProjection:null,
  redactionCategory:"entity_value",redactionIndex:0,redactionResolutionCache:{},guidePath:null,guideStep:0,guideBusy:false,
  panels:{},searchResults:{legacy:[],current:[]},
  asOfPolicy:{enabled:false,cutoff:"",inclusive:true,excludedDocument:"",caseId:"",minimum:"",maximum:""}
};
const nextLevel = {domain:"theme",theme:"community",community:"evidence"};
const nodeLevel = {Domain:"domain",Theme:"theme",Community:"community"};
const DEFAULT_NODE_LIMIT = 32;
const nodeLimitFor = level => level==='evidence'?256:DEFAULT_NODE_LIMIT;
const NODE_CAPS = new Set([32,256,2048]);
const MAX_RENDERED_NODES = 2048;
const MAX_ALL_RENDERED_EDGES = 16384;
const slotOverlayState={enabled:true,payload:null,promise:null,scanPromise:null,rows:new Map(),pages:new Map(),requests:new Map(),searchOffset:0,searchPage:null};

function cacheSlotRows(rows) {
  for(const row of rows){
    if(row.type!=="RedactionSlot"||row.semantic!==false||row.eligible_evidence!==false||row.context_links.some(edge=>edge.semantic!==false||edge.eligible_evidence!==false||edge.slot_navigation!==true||edge.weight!==0||edge.layout_weight!==0))throw Error('Malformed opaque-source navigation boundary.');
    row.node_subtype="OpaqueRedactionSlot";
    row._surfaces=[row.id,row.slot_id,row.label,row.document_id].filter(Boolean).map(kgSearch.normalizeSearchText);
    row._search=kgSearch.normalizeSearchText([row.id,row.slot_id,row.label,row.document_id,row.context_preview].join(' '));
    slotOverlayState.rows.delete(row.id);slotOverlayState.rows.set(row.id,row);
  }
  const protectedIds=new Set(Object.values(state.panels).flatMap(p=>[p.slotFocusId,p.selected?.id,p.external?.id,p.neighborhood?.node?.id]));
  for(const id of slotOverlayState.rows.keys()){
    if(slotOverlayState.rows.size<=512)break;
    if(!protectedIds.has(id))slotOverlayState.rows.delete(id);
  }
}

async function slotPacket(selectors={},cacheRows=true) {
  const params=new URLSearchParams({corpus:corpusId,graph_id:refreshBinding.graph_run_id,hierarchy_id:refreshBinding.hierarchy_run_id,...selectors});
  const key=params.toString();
  if(slotOverlayState.requests.has(key))return slotOverlayState.requests.get(key);
  const request=(async()=>{
    const response=await fetch('/api/current/slots-v1?'+params,{cache:'no-store'});
    if(!response.ok)throw Error(`Opaque-source slots HTTP ${response.status}; no substitute source is used.`);
    const value=await response.json();
    if(value.version!=="current-opaque-source-slots/2"||value.corpus!==corpusId||value.graph_run_id!==refreshBinding.graph_run_id||value.hierarchy_run_id!==refreshBinding.hierarchy_run_id||value.semantic_graph_modified!==false||value.hidden_values_read!==false)throw Error('Opaque-source slot binding differs from this graph.');
    slotOverlayState.payload=value;
    if(cacheRows)cacheSlotRows(value.slot?[value.slot]:(value.slots||[]));
    updateSlotStatus(value.coverage);
    return value;
  })();
  slotOverlayState.requests.set(key,request);
  try{return await request;}finally{slotOverlayState.requests.delete(key);}
}

function updateSlotStatus(coverage) {
  if(!coverage)return;
  $('#slot-overlay-status').textContent=coverage.complete
    ? `${fmt(coverage.total_slots)} Redacted Slots in ${fmt(coverage.scanned_documents)} documents.`
    : `Not a complete count: ${coverage.scanned_shards}/${coverage.total_shards} source shards scanned; ${fmt(coverage.observed_slots)} markers observed so far. Browse or search to scan.`;
}

async function ensureSlotOverlay() {
  if(!slotOverlayState.promise){
    slotOverlayState.promise=slotPacket({limit:1},false).catch(error=>{slotOverlayState.promise=null;throw error;});
  }
  return slotOverlayState.promise;
}

async function ensureSlotCensus() {
  await ensureSlotOverlay();
  if(!slotOverlayState.scanPromise){
    slotOverlayState.scanPromise=(async()=>{
      while(!slotOverlayState.payload.coverage.complete){await slotPacket({scan:1,limit:1},false);await pause(0);}
      return slotOverlayState.payload;
    })().catch(error=>{slotOverlayState.scanPromise=null;throw error;});
  }
  return slotOverlayState.scanPromise;
}

async function slotPage(selectors={}) {await ensureSlotCensus();return slotPacket({limit:32,...selectors});}
async function ensureOpaqueSlotPage(slot) {
  const key=slot.document_id+'|'+slot.canonical_page_id;
  if(!slotOverlayState.pages.has(key)){
    const value=await slotPacket({slot_id:slot.id});
    if(value.page.text_sha256!==slot.page_provenance.text_sha256)throw Error('Redacted Slot source page pin changed.');
    slotOverlayState.pages.set(key,value.page);
    while(slotOverlayState.pages.size>8)slotOverlayState.pages.delete(slotOverlayState.pages.keys().next().value);
  }
  return slotOverlayState.pages.get(key);
}

function slotRows() {return slotOverlayState.enabled&&!state.guidePath?[...slotOverlayState.rows.values()]:[];}
function opaqueSlot(id) {return slotOverlayState.enabled&&!state.guidePath?slotOverlayState.rows.get(id):null;}
function slotContextEdges() {return slotRows().flatMap(row=>row.context_links);}
function withSlotContext(detail) {
  if(state.guidePath)return detail;
  const node=opaqueSlot(detail.node.id)||detail.node;
  const neighbors=new Map((detail.neighbors||[]).filter(row=>!row.overlay_slot).map(row=>[row.id,row]));
  const edges=(detail.edges||[]).filter(edge=>!edge.slot_navigation);
  const allowed=new Set(detail.slot_context?.ids||[]);
  if(node.overlay_slot)allowed.add(node.id);
  // Keep the current slot reciprocal even if it lies outside the anchor's page.
  for(const panel of Object.values(state.panels))if(panel.slotFocusId)allowed.add(panel.slotFocusId);
  for(const slot of slotRows().filter(row=>allowed.has(row.id)))for(const edge of slot.context_links){
    if(edge.source!==node.id&&edge.target!==node.id)continue;
    const other=edge.source===node.id?slot.anchors.find(row=>row.id===edge.target):slot;
    if(!other)continue;
    neighbors.set(other.id,neighbors.get(other.id)||other);
    edges.push({...edge,hierarchy_scope:focusScope("evidence",node,other)});
  }
  return {...detail,node,neighbors:[...neighbors.values()],edges};
}
function slotGraphRows(panel,nodes,edges) {
  if(panel.level!=="evidence"||panel.studyContext||state.guidePath)return {nodes,edges};
  const parent=panel.trail.at(-1),focus=panel.slotFocusId;
  const slots=slotRows().filter(row=>(parent?.type==="Community"?row.community_id===parent.id:row.id===focus)&&
    (state.showIneligible||eligibilityReasons(row,{includeRelease:false}).length===0));
  if(!slots.length)return {nodes,edges};
  const map=new Map(nodes.map(row=>[row.id,row]));
  for(const slot of slots){
    map.set(slot.id,slot);
    for(const anchor of slot.anchors)if(anchor.community_id===parent?.id||slot.id===focus)map.set(anchor.id,{...anchor,...(map.get(anchor.id)||{})});
  }
  const extra=slots.flatMap(row=>row.context_links).filter(edge=>map.has(edge.source)&&map.has(edge.target));
  const selected=panel.external||panel.selected;
  const preserveIds=new Set([...panel.pinnedFocusIds,...(focus?[focus]:[]),...(!selected?.source&&selected?.id?[selected.id]:[])]);
  return panel.applyVisibilityPolicy([...map.values()],[...edges,...extra],{preserveIds});
}

async function navigateOpaqueSlot(panel,slot) {
  if(state.guidePath)throw Error('Close the saved case guide before independent slot exploration.');
  setRedactionVisibility(true,false);
  cacheSlotRows([slot]);
  panel.slotFocusId=slot.id;
  if(slot.community_id)await panel.navigateToNode(slot);else await panel.focusNeighborhood(slot);
  if(pageParams.get('connections')==='1')await panel.focusDirectConnections(slot);
  const url=new URL(location.href);url.searchParams.set('scope','slot');url.searchParams.set('q',slot.id);url.searchParams.set('inspect','1');history.replaceState(null,'',url);
  if(pageParams.get('slot_source')==='1')openOpaqueSlotSource(slot);
}

function slotPermalink(slot,source=false) {
  const params=new URLSearchParams({corpus:corpusId,scope:'slot',q:slot.id,inspect:'1'});
  if(source)params.set('slot_source','1');
  return '/graph-full-v6.html?'+params;
}

function opaqueSlotInspectorHTML(panel,slot) {
  const placed=slot.community_id?'Placed beside a visible earlier-view vocabulary anchor in its existing hierarchy. This is navigation, not concealed-entity membership.':'Unplaced: no unambiguous earlier-view visible vocabulary anchor was available. No hierarchy assignment was invented.';
  return `<section class="slot-inspector" data-opaque-slot="${esc(slot.id)}"><p class="eyebrow">Redacted Slot</p><h3>${esc(slot.label)}</h3><blockquote>${esc(slot.context_preview)}</blockquote><div class="slot-source-actions"><button type="button" data-slot-source>Open source</button><a href="${esc(slotPermalink(slot))}">Link to slot</a><a href="${esc(slotPermalink(slot,true))}" data-slot-source-link>Link to source</a></div>${panel.incidentConnections(slot)}${slot.workbench_links.length?`<h4>Workbench</h4>${slot.workbench_links.map(row=>`<a class="slot-workbench-link" href="${esc(row.href)}">${esc(row.label)}</a>`).join('')}`:''}<details><summary>Source and navigation details</summary><p>${esc(slot.document_id)} / ${esc(slot.date)} / earlier PDF page ${esc(slot.source_page)}</p><p>${esc(placed)}</p><p>Connections identify literal visible context, not the hidden identity. Concealed wording and length are unavailable.</p><dl><dt>Slot ID</dt><dd>${esc(slot.id)}</dd><dt>Observed marker</dt><dd>${esc(slot.slot_id||'Unnumbered earlier mask')}</dd><dt>Source page</dt><dd>${esc(slot.canonical_page_id)}</dd><dt>Graph</dt><dd>${esc(refreshBinding.graph_run_id)}</dd><dt>Hierarchy</dt><dd>${esc(refreshBinding.hierarchy_run_id)}</dd></dl></details></section>`;
}

function slotContextInspectorHTML(panel,edge) {
  const slot=opaqueSlot(edge.source),proof=edge.source_proof,page=slot?.page_provenance;
  if(!slot||!page||!proof?.text)throw Error('Exact base-visible source-context proof is unavailable. No relation was substituted.');
  const anchor=slot.anchors.find(row=>row.id===edge.target);
  const context=slot.context_preview;
  return `<section class="slot-inspector" data-slot-context-edge="${esc(edge.id)}"><p class="eyebrow">Selected source-context connection / not a factual relationship</p><h3>${esc(slot.label)} &harr; ${esc(anchor?.label||proof.text)}</h3><p class="slot-boundary-notice">This dotted link says only that the vocabulary term is visible in this earlier source context. It does not connect the hidden identity to that term. Semantic: false. Eligible evidence: false. Weight: 0. No corroboration or native relationship count is added.</p><div class="edge-endpoints"><button data-inspect-entity="${esc(edge.source)}">${esc(slot.label)}</button><span>&harr;</span><button data-inspect-entity="${esc(edge.target)}">${esc(anchor?.label||proof.text)}</button></div><h4>Exact visible source term</h4><blockquote data-context-proof>${esc(proof.text)}</blockquote><p>Earlier transcript excerpt around the visible term, not a quote of concealed wording:</p><blockquote>${esc(context)}</blockquote><p>${esc(page.document_id)} / ${esc(page.date)} / earlier PDF page ${esc(page.source_page)}</p><button type="button" data-context-source>Open exact earlier context and opaque boundary</button><details><summary>Source-context provenance and coordinates</summary><dl><dt>Canonical earlier page</dt><dd>${esc(page.canonical_page_id)}</dd><dt>Visible-term coordinates</dt><dd>[${proof.start}, ${proof.end}) Unicode code points in normalized visible text</dd><dt>Normalized visible text SHA-256</dt><dd>${esc(page.text_sha256)}</dd><dt>Original marker-transport text SHA-256</dt><dd>${esc(page.transport_text_sha256)}</dd><dt>Match authority</dt><dd>${esc(proof.match_kind)} / lexical context only</dd><dt>Context edge ID</dt><dd>${esc(edge.id)}</dd></dl></details></section>`;
}

async function openOpaqueSlotSource(slot,proof=null) {
  closeCibSource();const revision=state.sourceRequestRevision=(state.sourceRequestRevision||0)+1;
  let page;
  try{page=await ensureOpaqueSlotPage(slot);}catch(error){state.panels.current.inspectionError(error);return;}
  if(revision!==state.sourceRequestRevision)return;
  const drawer=$('#cib-source-drawer');state.sourceReturnFocus=document.activeElement;drawer.inert=false;drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');$('#cib-drawer-scrim').hidden=false;$('#cib-source-close').focus({preventScroll:true});
  $('#cib-source-kicker').textContent='Earlier-source provenance / no reveal';
  $('#cib-source-title').textContent=slot.article_title;
  $('#cib-source-meta').textContent=`${page.document_id} / ${page.date} / earlier PDF page ${page.source_page}`;
  $('#cib-source-release-actions').textContent='Earlier visible transcript. Paired original PDFs are inspection only, not evidence for the concealed contribution.';
  const chars=Array.from(page.text),spans=[{start:slot.marker_start,end:slot.marker_end,attribute:'data-focal-opaque-slot'}];
  if(proof){
    if(proof.canonical_page_id!==page.canonical_page_id||chars.slice(proof.start,proof.end).join('')!==proof.text)throw Error('Source-context coordinates do not match the earlier transcript.');
    spans.push({start:proof.start,end:proof.end,attribute:'data-visible-context-term'});
  }
  let cursor=0,sourceHTML='';
  for(const span of spans.sort((a,b)=>a.start-b.start)){
    if(span.start<cursor)throw Error('Overlapping source-context markers are not supported.');
    sourceHTML+=esc(chars.slice(cursor,span.start).join(''))+`<mark ${span.attribute}>${esc(chars.slice(span.start,span.end).join(''))}</mark>`;cursor=span.end;
  }
  sourceHTML+=esc(chars.slice(cursor).join(''));
  $('#cib-source-body').innerHTML=`<p class="slot-boundary-notice">Provenance and visible context, NOT semantic evidence for the concealed contribution. The highlighted opaque token is transport syntax, not a measured hidden-text extent. ${proof?'The other highlight is the exact visible lexical term; it is not a hidden identity.':''}</p><section class="cib-source-page active slot-source-page" data-cib-page="${esc(page.canonical_page_id)}"><header><b>Earlier source / PDF page ${esc(page.source_page)}</b></header><div class="slot-source-text">${sourceHTML}</div></section><details><summary>Earlier transcript audit</summary><p>Canonical page: ${esc(page.canonical_page_id)}</p><p>Normalized visible transcript SHA-256: ${esc(page.text_sha256)}</p><p>Original marker-transport SHA-256: ${esc(page.transport_text_sha256)}</p><p>Coordinates are Unicode code points in normalized visible text. Only existing opaque marker transport syntax was normalized to [REDACTED]. No concealed wording or span length was read.</p></details>`;
  $('[data-focal-opaque-slot]',drawer)?.scrollIntoView({block:'center'});
  const host=document.createElement('section');$('#cib-source-body').append(host);
  try{
    const source=await ensureCibSource(state.data.views.current_earlier,page.document_id);
    const original=source.pages.find(p=>p.canonical_page_id===page.canonical_page_id);
    if(!original)throw Error('No exact original page aligns with this opaque source.');
    await appendGraphPDFPair(host,{...original,document_id:page.document_id,
      source_page:{release:'earlier',page:original.source_page}},
      {document_id:page.document_id,canonical_page_id:page.canonical_page_id});
  }catch(error){if(host.isConnected)host.textContent=error.message+' No alternate source is substituted.';}
}

function appendHierarchySlots(panel,item) {
  const key={Domain:'domain_id',Theme:'theme_id',Community:'community_id'}[item?.type];
  if(!key)return;
  if(state.guidePath||!slotOverlayState.enabled)return;
  const section=document.createElement('section');section.className='slot-hierarchy-navigation';
  section.innerHTML='<h4>Redacted Slots</h4><button type="button" data-load-branch-slots>Browse nearby slots</button><div data-branch-slots></div>';
  panel.inspector.append(section);
  const load=async offset=>{
    const button=$('[data-load-branch-slots]',section);button.disabled=true;
    try{
      const value=await slotPage({[key]:item.id,offset});
      if(!section.isConnected)return;
      const host=$('[data-branch-slots]',section);
      host.innerHTML=`<p>${fmt(value.matched_count)} observed slots beside this branch. Showing ${value.slots.length?offset+1:0}-${offset+value.slots.length}; not Community membership.</p>`+value.slots.map((row,index)=>`<button type="button" data-hierarchy-slot="${index}">${esc(row.label)}</button>`).join('')+`<div class="slot-pagination"><button data-branch-prev ${offset===0?'disabled':''}>Previous</button><button data-branch-next ${value.next_offset===null?'disabled':''}>Next</button></div>`;
      $$('[data-hierarchy-slot]',host).forEach(b=>b.onclick=()=>navigateOpaqueSlot(panel,value.slots[Number(b.dataset.hierarchySlot)]).catch(e=>panel.inspectionError(e)));
      $('[data-branch-prev]',host).onclick=()=>load(Math.max(0,offset-32));
      $('[data-branch-next]',host).onclick=()=>load(value.next_offset);
    }catch(error){$('[data-branch-slots]',section).textContent=error.message;}finally{button.disabled=false;}
  };
  $('[data-load-branch-slots]',section).onclick=()=>load(0);
}

async function initializeSlotOverlay() {
  $('#slot-overlay-controls').hidden=false;
  try{
    await ensureSlotOverlay();
    $('#show-slot-overlay').onchange=event=>setRedactionVisibility(event.target.checked);
    $('#browse-source-slots').onclick=()=>{$('#search-scope').value='slot';$('#graph-search').value='Redacted Slot';applySearch();};
    $('#slot-search-prev').onclick=()=>{slotOverlayState.searchOffset=Math.max(0,slotOverlayState.searchOffset-32);applySearch(false);};
    $('#slot-search-next').onclick=()=>{slotOverlayState.searchOffset=slotOverlayState.searchPage.next_offset;applySearch(false);};
  }catch(error){$('#slot-overlay-status').textContent=`Overlay unavailable: ${error.message}`;$('#browse-source-slots').disabled=true;}
}
// BEGIN IDENTITY_AUTHORITY_ADAPTER
const identityAuthoritySchemas={
  comparison:{legacy:'cib-legacy-current-comparison/4.8',native:'cib-legacy-current-comparison/4.9'},
  search:{legacy:'cib-graph-search/3.4',native:'cib-graph-search/3.5'},
  neighborhood:{legacy:'cib-node-neighborhood/1.0',native:'cib-node-neighborhood/1.1'},
  community:{legacy:'cib-community-detail/1.1',native:'cib-community-detail/1.2'}
};
const legacyAuthoritySchemas=new Set();
function identityAuthorityMode(schema,kind,expectedMode=null){
  const mode=Object.entries(identityAuthoritySchemas[kind]).find(([,version])=>version===schema)?.[0];
  if(!mode)throw Error(`Unsupported ${kind} schema ${schema}`);
  if(expectedMode&&mode!==expectedMode)throw Error(`Mixed identity-authority schema revisions for ${kind}: ${schema}`);
  return mode;
}
function adaptIdentityRecord(row,mode){
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Invalid identity record');
  if((row.type||row.node_type)!=='Entity')return row;
  if(mode==='native'){
    const owns=key=>Object.prototype.hasOwnProperty.call(row,key);
    if(!owns('reference_scope')||!owns('instance_identity_asserted')||
        !(row.reference_scope===null||typeof row.reference_scope==='string')||
        !(row.instance_identity_asserted===null||typeof row.instance_identity_asserted==='boolean'))throw Error(`Missing or invalid native identity authority for ${row.id||row.node_id}`);
  }else if(mode==='legacy'){
    row.reference_scope=null;row.instance_identity_asserted=null;
  }else throw Error('Unsupported identity-authority adapter');
  delete row.identity_scope;row._identity_authority_mode=mode;return row;
}
function adaptIdentityRecords(rows,mode){
  if(!Array.isArray(rows))throw Error('Identity records must be an array');
  rows.forEach(row=>adaptIdentityRecord(row,mode));return rows;
}
function recordLegacyAuthoritySchema(schema,mode){
  if(mode!=='legacy')return;
  legacyAuthoritySchemas.add(schema);
  const hero=$('.hero');if(!hero)return;
  let notice=$('#legacy-identity-authority-notice');
  if(!notice){notice=document.createElement('section');notice.id='legacy-identity-authority-notice';notice.className='refresh-binding-notice';notice.setAttribute('role','status');hero.after(notice);}
  notice.innerHTML=`<strong>Identity authority unavailable in this legacy export</strong><p>Entity nodes remain navigable, but their identity is unknown here, not resolved or source-specific. Old cached identity labels are ignored.</p><small>Explicit legacy adapters: ${[...legacyAuthoritySchemas].sort().map(esc).join(', ')}.</small>`;
}
function adaptComparisonAuthority(payload,isSingleCorpus=singleCorpusMode){
  let mode;
  if(isSingleCorpus){
    if(payload.schema_version!=='matryoshka-single-corpus-browser/1.0')throw Error(`Unsupported comparison schema ${payload.schema_version}`);
    mode=identityAuthorityMode(payload.neighborhood_catalogs?.schema_version,'neighborhood');
  }else mode=identityAuthorityMode(payload.schema_version,'comparison');
  if(!payload.views||typeof payload.views!=='object'||Array.isArray(payload.views))throw Error('Comparison views are missing');
  if(payload.neighborhood_catalogs)identityAuthorityMode(payload.neighborhood_catalogs.schema_version,'neighborhood',mode);
  if(payload.community_detail_catalogs)identityAuthorityMode(payload.community_detail_catalogs.schema_version,'community',mode);
  for(const view of Object.values(payload.views)){
    for(const level of Object.values(view.levels||{})){
      if(level.neighborhood_catalog)identityAuthorityMode(level.neighborhood_catalog.schema_version,'neighborhood',mode);
      if(level.community_detail_schema_version)identityAuthorityMode(level.community_detail_schema_version,'community',mode);
      for(const key of ['nodes','catalog_nodes','overview_nodes','member_nodes'])if(level[key])adaptIdentityRecords(level[key],mode);
    }
    view._identity_authority_mode=mode;
  }
  payload._identity_authority_mode=mode;recordLegacyAuthoritySchema(payload.schema_version,mode);return payload;
}
function identityScopeLabel(item){
  if((item.type||item.node_type)!=='Entity')return '';
  if(item._identity_authority_mode==='legacy')return 'identity authority unavailable (legacy)';
  const scope=item.reference_scope,asserted=item.instance_identity_asserted;
  if(['unresolved_reference','unresolved_contextual_reference','ambiguous_lexical_hub'].includes(scope))return 'unresolved reference; instance identity not established';
  if(['lexical_reference','concept'].includes(scope))return 'reference-only vocabulary; instance identity not asserted';
  if(asserted===false)return 'reference-only; instance identity not asserted';
  if(asserted===true&&['model_source_context','human_source_occurrence_scope'].includes(scope))return 'source-specific identity; not a global alias';
  if(asserted===true&&['source_referent','named_entity'].includes(scope))return 'source-supported identity cluster';
  return 'identity authority not recorded; inspect source provenance';
}
function identityAuditHtml(item){
  const label=identityScopeLabel(item);if(!label)return '';
  const legacy=item._identity_authority_mode==='legacy',assertion=legacy?'unavailable (legacy)':typeof item.instance_identity_asserted==='boolean'?String(item.instance_identity_asserted):'not recorded';
  return `<p class="identity-audit"><b>Identity state:</b> ${esc(label)}<br><b>Native reference scope:</b> ${esc(legacy?'unavailable (legacy)':item.reference_scope??'not recorded')}<br><b>Instance identity asserted:</b> ${esc(assertion)}</p>`;
}
// END IDENTITY_AUTHORITY_ADAPTER

function sourceDocumentId(value) {
  const id=String(value??"").trim();
  return /^(?:none|null|undefined)$/i.test(id)?"":id;
}

function isDocumentAvailableAsOf(documentId,documentDate="") {
  if(state.guideOverlay)return state.guideOverlay.documents.has(documentId);
  if(!state.asOfPolicy.enabled)return true;
  if(documentId&&documentId===state.asOfPolicy.excludedDocument)return false;
  const knownDate=String(documentDate||state.data?.corpus_metadata?.document_dates?.[documentId]||"");
  if(!knownDate)return false;
  return state.asOfPolicy.inclusive?knownDate<=state.asOfPolicy.cutoff:knownDate<state.asOfPolicy.cutoff;
}

function isAvailableAsOf(item) {
  if(!state.asOfPolicy.enabled)return true;
  const directDocument=sourceDocumentId(item?.document_id)||sourceDocumentId(item?.doc_id);
  const directDate=String(item?.document_date_iso||item?.date_iso||"");
  if(directDocument&&!isDocumentAvailableAsOf(directDocument,directDate))return false;
  const supportingDocuments=(item?.supporting_document_ids||[]).map(String).filter(Boolean);
  if(supportingDocuments.length)return supportingDocuments.some((documentId)=>isDocumentAvailableAsOf(documentId));
  const firstSupport=String(item?.minimum_document_date||"");
  if(firstSupport)return state.asOfPolicy.inclusive?firstSupport<=state.asOfPolicy.cutoff:firstSupport<state.asOfPolicy.cutoff;
  return Boolean(directDocument);
}

function eligibilityReasons(item,{includeRelease=false}={}) {
  if(state.guideOverlay){
    const o=state.guideOverlay,id=item?.id||item?.node_id;
    if(item?.source&&item?.target){
      const proofs=o.edges.get(item.id)||[];
      const proven=proofs.some(p=>[item.source,item.target].every(n=>n===p.source||n===p.target)&&String(item.edge_type||"").split(",").map(s=>s.trim()).includes(p.relation));
      return proven?[]:["unassessed full-KG edge; no exact eligible source-relation correspondence"];
    }
    return o.eligible.has(id)||o.groups.has(id)||item?.aggregate_kind&&o.groups.has(item.community_id)?[]:["ineligible or unverified case source identity"];
  }
  const reasons=[];
  if(includeRelease&&isLaterOnly(item))reasons.push("later-only evidence");
  if(state.asOfPolicy.enabled&&!isAvailableAsOf(item)){
    const directDocument=sourceDocumentId(item?.document_id)||sourceDocumentId(item?.doc_id);
    const firstSupport=String(item?.minimum_document_date||item?.document_date_iso||item?.date_iso||"");
    if(directDocument&&directDocument===state.asOfPolicy.excludedDocument)reasons.push("excluded source document");
    else if(!firstSupport)reasons.push("undated support");
    else reasons.push(`not available by ${state.asOfPolicy.cutoff}`);
  }
  return [...new Set(reasons)];
}

function hashNumber(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  if (!dx && !dy) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x-a.x)*dx + (point.y-a.y)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(point.x-(a.x+t*dx), point.y-(a.y+t*dy));
}

function hierarchyScope(left, right) {
  if (left?.community_id && left.community_id===right?.community_id) return "same_community";
  if (left?.theme_id && left.theme_id===right?.theme_id) return "same_theme";
  if (left?.domain_id && left.domain_id===right?.domain_id) return "same_domain";
  if (left?.domain_id && right?.domain_id) return "cross_domain";
  return "outside_hierarchy";
}

function focusScope(level, left, right) {
  if (level === "domain") return "cross_domain";
  if (level === "theme") return left?.domain_id === right?.domain_id ? "same_domain" : "cross_domain";
  if (level === "community") {
    if (left?.theme_id && left.theme_id === right?.theme_id) return "same_theme";
    return left?.domain_id && left.domain_id === right?.domain_id ? "same_domain" : "cross_domain";
  }
  return hierarchyScope(left, right);
}

class GraphPanel {
  constructor(name) {
    this.name=name; this.canvas=$(`#${name}-canvas`); this.ctx=this.canvas.getContext("2d");
    this.tooltip=$(`#${name}-tooltip`); this.inspector=$(`#${name}-inspector`);
    document.body.append(this.inspector);
    this.nodes=[]; this.edges=[]; this.nodeMap=new Map(); this.matches=new Set();
    this.transform={x:0,y:0,scale:1}; this.drag=null; this.hover=null; this.selected=null; this.external=null;
    this.level=state.level; this.trail=[]; this.nodeLimit=nodeLimitFor(this.level); this.holdTimer=null;
    this.pinnedFocusIds=new Set(); this.searchMatchIds=new Set(); this.pinnedSearchRecords=new Map(); this.navigationRevision=0; this.pulseTimer=null;
    this.neighborhood=null; this.localIncidentNeighborhood=null; this.expandedIncidentScopes=new Set();
    this.incidentPages=new Map();this.nodeHistory=[];
    this.investigativeContext=null;
    this.slotFocusId=null;
    this.labelOverrides=new Map();this.labelButtons=new Map();this.drawerOpen=false;this.physicsFrame=null;this.priorCenter=null;
    this.labelLayer=document.createElement('div');this.labelLayer.className='map-labels';this.canvas.after(this.labelLayer);
    this.showNeighborEdges=true; this.inducedNeighborEdges=[]; this.inducedLoadRevision=0; this.inducedLoading=false; this.inducedError=""; this.focusBands=[]; this.inspectionRevision=0;
    this.orbitFrame=null;this.orbitHoverId=null;this.fitScale=1;
    this.motionFrame=null;this.motionJob=null;this.orbitEnabled=false;this.orbitPhase=0;this.flowElapsedMs=0;
    this.motionStats={frames:0,collisionPasses:0,maxFrameMs:0,maxStepPx:0};
    this.ringLegend=document.createElement('aside');this.ringLegend.className='neighborhood-legend';this.ringLegend.hidden=true;this.canvas.after(this.ringLegend);
    this.ringLegend.addEventListener('pointerenter',()=>clearTimeout(this.legendTimer));
    this.ringLegend.addEventListener('pointerleave',()=>this.hideRingLegendSoon());
    this.bind(); this.resize();
    new ResizeObserver(()=>this.observeResize()).observe(this.canvas.parentElement);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){this.compactLayout();this.startOrbit();}});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{if(guideReducedMotion()){this.compactLayout({immediate:true});this.stopOrbit();}else this.startOrbit();});
  }

  bind() {
    this.canvas.addEventListener("pointerdown",(event)=>this.pointerDown(event));
    this.canvas.addEventListener("pointermove",(event)=>this.pointerMove(event));
    this.canvas.addEventListener("pointerup",(event)=>this.pointerUp(event));
    this.canvas.addEventListener("pointercancel",(event)=>this.pointerCancel(event));
    this.canvas.addEventListener("dblclick",(event)=>{ const node=this.hitNode(this.pointer(event)); if (node) { event.preventDefault(); this.activateNode(node); } });
    this.canvas.addEventListener('keydown',event=>this.keyboard(event));
    this.canvas.addEventListener("wheel",(event)=>this.wheel(event),{passive:false});
    this.canvas.addEventListener("mouseleave",()=>{ if (!this.drag) { this.hover=null; this.tooltip.hidden=true; this.draw(); } });
  }

  resize() {
    const rect=this.canvas.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2);
    const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
    // Assigning even an unchanged backing size clears the canvas. A repeated
    // observer notification must not erase a settled, reduced-motion graph.
    if(this.canvas.width!==width||this.canvas.height!==height||this.dpr!==dpr){
      this.canvas.width=width;this.canvas.height=height;
      this.ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    this.width=rect.width;this.height=rect.height;this.dpr=dpr;
  }

  observeResize() {
    const width=this.width,height=this.height,dpr=this.dpr;
    this.resize();
    if(width!==this.width||height!==this.height){this.fit();this.startOrbit();}
    else if(dpr!==this.dpr)this.draw();
  }

  setGraph(view) {
    this.guideCommunityContext=null;
    this.closeInspector(false);this.labelOverrides.clear();this.priorCenter=null;
    this.slotFocusId=null;
    this.view=view; this.level=state.level; this.trail=[]; this.nodeLimit=nodeLimitFor(this.level);
    this.nodeHistory=[];this.incidentPages.clear();
    this.neighborhood=null; this.localIncidentNeighborhood=null; this.expandedIncidentScopes.clear();
    this.investigativeContext=null;
    this.showNeighborEdges=true; this.inducedNeighborEdges=[]; this.inducedLoadRevision+=1; this.inducedLoading=false; this.inducedError=""; this.focusBands=[];
    this.pinnedFocusIds.clear(); this.searchMatchIds.clear(); this.pinnedSearchRecords.clear(); this.navigationRevision+=1; this.inspectionRevision+=1;
    this.refreshGraph();
  }

  normalizedEvidenceNode(row) {
    const id=row.id||row.node_id;
    const searchRecord=state.searchEvidenceIndexes[this.view.key]?.get(id)||state.searchIndexes[this.view.key]?.get(id)||{};
    return {
      ...searchRecord,
      ...row,
      id,
      type:row.type||row.node_type||searchRecord.type||"Unknown",
      label:row.label||searchRecord.label||row.node_id,
      summary:searchRecord.summary||row.summary||row.description||"",
      mass:Number(row.mass||row.weighted_degree||row.document_count||1),
      mention_count:Number(row.mention_count||searchRecord.mention_count||0),
    };
  }

  visibilityPolicy() {
    return currentOnlyMode ? state.visibilityMode : "show";
  }

  applyVisibilityPolicy(nodes, edges, {preserveIds=new Set()}={}) {
    if(!slotOverlayState.enabled){
      const hidden=new Set(nodes.filter(node=>node.overlay_slot||node.type==='RedactionSlot').map(node=>node.id));
      nodes=nodes.filter(node=>!hidden.has(node.id));
      edges=edges.filter(edge=>!edge.slot_navigation&&!hidden.has(edge.source)&&!hidden.has(edge.target));
    }
    const includeRelease=releaseFilterApplies(this.view);
    const policy=state.guideOverlay?"dim":this.visibilityPolicy();
    const styledNodes=nodes.map((node)=>{
      const id=node.id||node.node_id,reasons=eligibilityReasons(node,{includeRelease});
      const ineligible=reasons.length>0,preserved=preserveIds.has(id);
      return {
        ...node,
        eligibility_ineligible:ineligible,
        eligibility_reasons:reasons,
        visibility_dimmed:ineligible&&(policy==="dim"||!state.showIneligible),
        visibility_hidden_anchor:ineligible&&!state.showIneligible&&preserved,
      };
    });
    const ineligibleIds=new Set(styledNodes.filter((node)=>node.eligibility_ineligible).map((node)=>node.id||node.node_id));
    const retainedNodes=state.guideOverlay||state.showIneligible?styledNodes:styledNodes.filter((node)=>!node.eligibility_ineligible||preserveIds.has(node.id||node.node_id));
    const retainedIds=new Set(retainedNodes.map((node)=>node.id||node.node_id));
    const styledEdges=edges.map((edge)=>{
      const reasons=eligibilityReasons(edge,{includeRelease});
      if(ineligibleIds.has(edge.source)||ineligibleIds.has(edge.target))reasons.push("ineligible endpoint");
      const uniqueReasons=[...new Set(reasons)],ineligible=uniqueReasons.length>0;
      return {
        ...edge,
        eligibility_ineligible:ineligible,
        eligibility_reasons:uniqueReasons,
        visibility_dimmed:ineligible&&(policy==="dim"||!state.showIneligible),
      };
    });
    const retainedEdges=styledEdges.filter((edge)=>retainedIds.has(edge.source)&&retainedIds.has(edge.target)&&(state.guideOverlay||state.showIneligible||!edge.eligibility_ineligible));
    return {
      nodes:retainedNodes,
      edges:retainedEdges,
      excludedNodeCount:styledNodes.filter((node)=>node.eligibility_ineligible).length,
      excludedEdgeCount:styledEdges.filter((edge)=>edge.eligibility_ineligible).length,
    };
  }

  hierarchyNeighborhood(node) {
    const base=this.view.levels[this.level]||{};
    const allNodes=base.catalog_nodes?.length?base.catalog_nodes:(base.nodes||[]);
    const allEdges=base.catalog_edges?.length?base.catalog_edges:(base.edges||[]);
    const nodeById=new Map(allNodes.map((row)=>[row.id,row]));
    const edges=allEdges.filter((edge)=>edge.source===node.id||edge.target===node.id).map((edge)=>{
      const other=nodeById.get(edge.source===node.id?edge.target:edge.source);
      return {...edge,hierarchy_scope:focusScope(this.level,node,other)};
    }).sort((left,right)=>Number(right.layout_weight||right.weight||0)-Number(left.layout_weight||left.weight||0)||String(left.id).localeCompare(String(right.id)));
    const neighbors=edges.map((edge)=>nodeById.get(edge.source===node.id?edge.target:edge.source)).filter(Boolean);
    return {node:{...node},neighbors:[...new Map(neighbors.map((row)=>[row.id,row])).values()],edges,level:this.level};
  }

  applyVisibilityMode() {
    const external=this.external;
    this.refreshGraph(!this.selected?.source?this.selected?.id:null);
    if(external){
      const reasons=eligibilityReasons(external,{includeRelease:releaseFilterApplies(this.view)});
      this.external={...external,eligibility_ineligible:reasons.length>0,eligibility_reasons:reasons,visibility_dimmed:reasons.length>0&&state.visibilityMode==="dim"};
      this.selected=null;this.renderInspector();this.draw();
    }
  }

  graphSelection() {
    if(this.studyContext){
      const c=this.studyContext,focus=c.nodes.find(n=>n.id===c.focus_id);
      return {nodes:c.nodes.map(n=>({...n,focus_scope:n.id===c.focus_id?"focus":hierarchyScope(focus,n)})),edges:c.edges,
        contract:"Case-eligible study context. Membership is navigation, not a historical relation.",
        availableNodeCount:c.available_nodes,availableEdgeCount:c.edges.length,focusMode:c.view_kind==="incident",focusNodeId:c.focus_id};
    }
    const base=this.view.levels[this.level]||{contract:"No level is available.",nodes:[],edges:[]};
    const parent=this.trail[this.trail.length-1]||null;
    const corpusWide=!parent;
    let overviewMode=false;
    let policyExcludedNodeCount=0,policyExcludedEdgeCount=0;
    let allNodes=base.catalog_nodes?.length?base.catalog_nodes:(base.nodes||[]), allEdges=base.catalog_edges?.length?base.catalog_edges:(base.edges||[]), contract=base.contract||"";
    if (this.neighborhood) {
      this.neighborhood=withSlotContext(this.neighborhood);
      const selected={...(this.level==="evidence"?this.normalizedEvidenceNode(this.neighborhood.node):this.neighborhood.node),focus_scope:"focus"};
      const strength=new Map();
      (this.neighborhood.edges||[]).forEach((edge)=>{
        const other=edge.source===selected.id?edge.target:edge.source;
        strength.set(other,Math.max(strength.get(other)||0,Number(edge.layout_weight||edge.weight||0)));
      });
      const pinnedOrder=new Map([...this.pinnedFocusIds].map((id,index)=>[id,index]));
      const neighbors=(this.neighborhood.neighbors||[]).map((row)=>{
        const normalized=this.level==="evidence"?this.normalizedEvidenceNode(row):{...row};
        return {...normalized,focus_scope:focusScope(this.level,selected,normalized)};
      }).sort((left,right)=>{
        const leftPinned=pinnedOrder.has(left.id),rightPinned=pinnedOrder.has(right.id);
        if(leftPinned||rightPinned)return leftPinned&&rightPinned?pinnedOrder.get(left.id)-pinnedOrder.get(right.id):leftPinned?-1:1;
        return Number(strength.get(right.id)||0)-Number(strength.get(left.id)||0)||Number(right.mass||0)-Number(left.mass||0)||left.id.localeCompare(right.id);
      });
      allNodes=[selected,...neighbors.filter((row)=>row.id!==selected.id)];
      allEdges=this.neighborhood.edges||[];
      const eligibility=this.applyVisibilityPolicy(allNodes,allEdges,{preserveIds:new Set([selected.id])});
      allNodes=eligibility.nodes;allEdges=eligibility.edges;
      policyExcludedNodeCount=eligibility.excludedNodeCount;policyExcludedEdgeCount=eligibility.excludedEdgeCount;
      contract="Exact one-hop analyst neighborhood grouped by strict hierarchy distance. Direct edges are always complete; optional neighbor-to-neighbor edges come from the compact published topology index.";
      const totalNodes=allNodes.length,limit=Math.min(totalNodes,this.nodeLimit,MAX_RENDERED_NODES);
      const selection=GraphKG.selectCoverage(allNodes,[...allEdges,...this.inducedNeighborEdges],{limit,pinned:[selected.id,...this.pinnedFocusIds]});
      const selectedNodes=selection.nodes,ids=new Set(selectedNodes.map((row)=>row.id));
      const directEdges=allEdges.filter((edge)=>ids.has(edge.source)&&ids.has(edge.target));
      const directPairs=new Set(directEdges.map((edge)=>[edge.source,edge.target].sort().join("\u241f")));
      let neighborEdges=this.showNeighborEdges?this.inducedNeighborEdges.filter((edge)=>ids.has(edge.source)&&ids.has(edge.target)&&!directPairs.has([edge.source,edge.target].sort().join("\u241f"))):[];
      neighborEdges=this.applyVisibilityPolicy(selectedNodes,neighborEdges).edges;
      const selectedEdges=[...directEdges,...neighborEdges].slice(0,MAX_ALL_RENDERED_EDGES);
      const nativeEdges=allEdges.filter(edge=>!edge.slot_navigation),nativeNodes=allNodes.filter(node=>!node.overlay_slot);
      return {
        contract,nodes:selectedNodes,edges:selectedEdges,selectionAudit:selection.audit,availableNodeCount:totalNodes,
        availableEdgeCount:allEdges.length+neighborEdges.length,scopedEdgeCount:allEdges.length,
        fullGraphNodeCount:base.full_graph_node_count||nativeNodes.length,
        fullGraphEdgeCount:base.full_graph_edge_count||nativeEdges.length,
        representedNodeCount:nativeNodes.length,shownRepresentedNodeCount:selectedNodes.filter(node=>!node.overlay_slot).length,
        overviewGroupCount:0,overviewAggregateEdgeCount:0,corpusWide:false,
        overviewMode:false,assignedNodeCount:nativeNodes.length,assignedEdgeCount:nativeEdges.length,
        communityDetail:false,detailEdgeNodeRankLimit:0,focusMode:true,
        focusNodeId:selected.id,directEdgeCount:nativeEdges.length,
        shownDirectEdgeCount:directEdges.filter(edge=>!edge.slot_navigation).length,neighborEdgeCount:neighborEdges.filter(edge=>!edge.slot_navigation).length,
        contextDirectEdgeCount:allEdges.length-nativeEdges.length,contextNeighborEdgeCount:neighborEdges.filter(edge=>edge.slot_navigation).length,
        showNeighborEdges:this.showNeighborEdges,
        policyExcludedNodeCount,policyExcludedEdgeCount,
      };
    }
    if (this.level==="evidence"&&corpusWide&&base.overview_nodes?.length) {
      allNodes=base.overview_nodes;
      allEdges=base.overview_edges||[];
      contract=base.overview_contract||contract;
      overviewMode=true;
    }
    if (this.level==="evidence"&&parent?.type==="Community") {
      allNodes=(parent.member_nodes||parent.top_nodes||[]).map((row)=>this.normalizedEvidenceNode(row));
      const ids=new Set(allNodes.map((row)=>row.id));
      allEdges=(parent.member_edges||parent.top_edges||[]).filter((edge)=>ids.has(edge.source)&&ids.has(edge.target));
      if(state.guidePath&&this.guideCommunityContext?.community_id===parent.id){
        const published=this.guideCommunityContext.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target));
        allEdges=[...new Map([...allEdges,...published].map(edge=>[edge.id,edge])).values()];
      }
      contract=parent.community_detail_loaded?"Complete ranked Community membership; all published node-pair edges among the first 2,048 ranked members are available.":"Complete Community detail has not loaded.";
    } else if (parent&&this.level==="theme"&&parent.type==="Domain") {
      allNodes=allNodes.filter((row)=>row.domain_id===parent.id);
    } else if (parent&&this.level==="community"&&parent.type==="Theme") {
      allNodes=allNodes.filter((row)=>row.theme_id===parent.id);
    }
    if(this.level==="evidence"&&this.investigativeContext){
      const context=this.investigativeContext;
      const priority=[context.node,...context.neighbors];
      const byId=new Map(allNodes.map((row)=>[row.id,row]));
      priority.forEach((row)=>byId.set(row.id,{...(byId.get(row.id)||{}),...row}));
      const priorityIds=new Set(priority.map((row)=>row.id));
      allNodes=[...priority.map((row)=>byId.get(row.id)),...allNodes.filter((row)=>!priorityIds.has(row.id))];
      allEdges=[...allEdges,...context.edges];
      contract+=" Dashed red strings are temporary investigative leads from visible context; they are not semantic graph edges and do not affect hierarchy or graph metrics.";
    }
    if (this.level==="evidence"&&corpusWide&&this.pinnedSearchRecords.size) {
      const present=new Set(allNodes.map((row)=>row.id||row.node_id));
      const injected=[...this.pinnedSearchRecords.values()].filter((row)=>!row.overlay_slot&&!present.has(row.id)).map((row)=>this.normalizedEvidenceNode({...row,mass:Number(row.document_count||1),search_injected:true}));
      allNodes=[...injected,...allNodes];
    }
    const currentFocus=this.external||this.selected;
    const preserveIds=new Set([...this.pinnedFocusIds,...(this.slotFocusId?[this.slotFocusId]:[]),...(!currentFocus?.source&&currentFocus?.id?[currentFocus.id]:[])]);
    const eligibility=this.applyVisibilityPolicy(allNodes,allEdges,{preserveIds});
    allNodes=eligibility.nodes;allEdges=eligibility.edges;
    policyExcludedNodeCount=eligibility.excludedNodeCount;policyExcludedEdgeCount=eligibility.excludedEdgeCount;
    const overlay=slotGraphRows(this,allNodes,allEdges);
    allNodes=overlay.nodes;allEdges=overlay.edges;
    const scopeIds=new Set(allNodes.map((row)=>row.id||row.node_id));
    const scopedEdges=allEdges.filter((edge)=>scopeIds.has(edge.source)&&scopeIds.has(edge.target));
    const totalNodes=allNodes.length, limit=Math.min(totalNodes,this.nodeLimit,MAX_RENDERED_NODES);
    const selection=GraphKG.selectCoverage(allNodes,scopedEdges,{limit,pinned:[...preserveIds]});
    const selectedNodes=selection.nodes, ids=new Set(selectedNodes.map((row)=>row.id));
    const induced=scopedEdges.filter((edge)=>ids.has(edge.source)&&ids.has(edge.target));
    induced.sort((left,right)=>{
      const leftPinned=this.pinnedFocusIds.has(left.source)&&this.pinnedFocusIds.has(left.target);
      const rightPinned=this.pinnedFocusIds.has(right.source)&&this.pinnedFocusIds.has(right.target);
      return Number(rightPinned)-Number(leftPinned)||Number(right.layout_weight||right.weight||0)-Number(left.layout_weight||left.weight||0)||String(left.id).localeCompare(String(right.id));
    });
    const communityDetail=this.level==="evidence"&&parent?.type==="Community"&&Boolean(parent?.community_detail_loaded);
    // A node ceiling already bounds the drawing. Dropping induced hierarchy
    // edges after that point made connected Communities look like singletons.
    const selectedEdges=induced;
    const nativeEdges=selectedEdges.filter(edge=>!edge.slot_navigation),nativeNodes=allNodes.filter(node=>!node.overlay_slot);
    const connectedIds=new Set(nativeEdges.flatMap((edge)=>[edge.source,edge.target]));
    const displayedIsolateIds=new Set(selectedNodes.filter((node)=>!node.overlay_slot&&!connectedIds.has(node.id)).map((node)=>node.id));
    const hiddenLinkedIds=new Set();
    scopedEdges.forEach((edge)=>{
      if(edge.slot_navigation)return;
      if(displayedIsolateIds.has(edge.source)&&!ids.has(edge.target))hiddenLinkedIds.add(edge.source);
      if(displayedIsolateIds.has(edge.target)&&!ids.has(edge.source))hiddenLinkedIds.add(edge.target);
    });
    return {
      contract,
      nodes:selectedNodes,
      selectionAudit:selection.audit,
      edges:selectedEdges,
      availableNodeCount:totalNodes,
      availableEdgeCount:induced.length,
      scopedEdgeCount:scopedEdges.length,
      fullGraphNodeCount:base.full_graph_node_count||nativeNodes.length,
      fullGraphEdgeCount:base.full_graph_edge_count||allEdges.filter(edge=>!edge.slot_navigation).length,
      representedNodeCount:overviewMode?Number(base.overview_represented_node_count||0):nativeNodes.length,
      shownRepresentedNodeCount:overviewMode?selectedNodes.reduce((sum,row)=>sum+Number(row.represented_node_count||0),0):selectedNodes.filter(node=>!node.overlay_slot).length,
      overviewGroupCount:overviewMode?Number(base.overview_group_count||totalNodes):0,
      overviewAggregateEdgeCount:overviewMode?Number(base.overview_aggregate_edge_count||allEdges.length):0,
      corpusWide,
      overviewMode,
      assignedNodeCount:this.level==="evidence"&&parent?.type==="Community"?Number(parent.mass||nativeNodes.length):nativeNodes.length,
      assignedEdgeCount:this.level==="evidence"&&parent?.type==="Community"?Number(parent.mention_count||nativeEdges.length):nativeEdges.length,
      communityDetail,
      detailEdgeNodeRankLimit:this.level==="evidence"&&parent?.type==="Community"?Number(parent.detail_edge_node_rank_limit||0):0,
      completeEdgesForRankedNodes:this.level==="evidence"&&parent?.type==="Community"&&Boolean(parent.complete_edges_for_ranked_nodes),
      omittedEdgeCount:Math.max(0,induced.length-selectedEdges.length),
      displayedIsolateCount:displayedIsolateIds.size,
      hiddenLinkedDisplayedCount:hiddenLinkedIds.size,
      loadedScopeIsolateCount:Math.max(0,displayedIsolateIds.size-hiddenLinkedIds.size),
      localIncidentFocus:Boolean(this.localIncidentNeighborhood),
      policyExcludedNodeCount,
      policyExcludedEdgeCount,
    };
  }

  refreshGraph(focusId=null) {
    const priorNodes=new Map(this.nodes.map(node=>[node.id,node])),priorKey=this.layoutKey;
    const previousNodeId=focusId||(!this.selected?.source?this.selected?.id:null);
    const previousEdgeId=this.selected?.source?this.selected?.id:null;
    this.graph=this.graphSelection();
    const masses=this.graph.nodes.map((row)=>{const value=Number(row.mass||row.document_count||1);return Number.isFinite(value)?Math.max(1,value):1;});
    const minLog=Math.min(...masses.map(Math.log1p)),maxLog=Math.max(...masses.map(Math.log1p));
    this.nodes=this.graph.nodes.map((row,index)=>{
      const angle=index*2.3999632297+(hashNumber(row.id)%1000)/1000;
      const radius=38+Math.sqrt(index+1)*(this.level==='evidence'?32:62);
      const relative=maxLog>minLog?(Math.log1p(masses[index])-minLog)/(maxLog-minLog):.35;
      const range=this.level==='evidence'?[9,31]:this.level==='community'?[13,37]:[16,42];
      return {...row,index,x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,vx:0,vy:0,r:row.overlay_slot?10:range[0]+Math.pow(relative,.8)*(range[1]-range[0])};
    });
    this.layoutKey=[this.view.key,this.level,...this.trail.map(row=>row.id),this.graph.focusMode?this.graph.focusNodeId:'packed'].join('|');
    const sameScope=priorKey===this.layoutKey;
    const sameMembers=sameScope&&priorNodes.size===this.nodes.length&&this.nodes.every(node=>priorNodes.has(node.id));
    if(!sameScope){this.orbitPhase=0;this.flowElapsedMs=0;}
    this.focusBands=[];
    if(this.graph.focusMode)this.positionFocusRings();
    this.nodeMap=new Map(this.nodes.map((node)=>[node.id,node]));
    this.edges=this.graph.edges.filter((edge)=>this.nodeMap.has(edge.source)&&this.nodeMap.has(edge.target));
    this.selected=previousNodeId&&this.nodeMap.has(previousNodeId)?this.nodeMap.get(previousNodeId):previousEdgeId?this.edges.find((edge)=>edge.id===previousEdgeId)||null:null;
    this.external=null; this.hover=null;
    this.matches=new Set([...this.pinnedFocusIds,...this.searchMatchIds].filter((id)=>this.nodeMap.has(id)));
    this.stopPhysics();this.stopOrbit();
    if(sameMembers&&this.compactHomes){
      for(const node of this.nodes){const old=priorNodes.get(node.id);node.x=old.x;node.y=old.y;node.orbitAngle=old.orbitAngle;node.orbitRadius=old.orbitRadius;}
    }else{
      this.packedLayout=this.nodes.length>700&&!this.graph.focusMode;
      this.layout();
      this.fit();
      if(!this.packedLayout&&!this.graph.focusMode){
        const scale=displayScale(this.transform.scale),points=this.motionPoints();
        GraphKG.relax(points,{steps:32,pull:0,gap:2/scale,maxStep:24/scale});
        if(GraphKG.overlaps(points,0,.4/scale)){this.packedLayout=true;this.planPackedFit();}
        else points.forEach((point,index)=>{this.nodes[index].x=point.x;this.nodes[index].y=point.y;});
      }
      this.compactHomes=new Map(this.nodes.map(node=>[node.id,{x:node.x,y:node.y}]));
      if(sameScope&&!state.guidePath&&!this.v64Busy&&!guideReducedMotion()){
        for(const node of this.nodes){const old=priorNodes.get(node.id);if(old){node.x=old.x;node.y=old.y;}}
        this.compactLayout();
      }
    }
    if(this.graph.focusMode)this.reserveFocusLabelHole();
    this.renderInspector();this.updateChrome();
    if(this.graph.focusMode)this.showRingLegend();else this.ringLegend.hidden=true;
    this.startOrbit();
  }

  positionFocusRings() {
    this.focusBands=[];
    const definitions=[
      ["same_community","Same Community","rgba(71,120,92,.13)","rgba(71,120,92,.45)"],
      ["same_theme","Same Theme","rgba(210,155,46,.12)","rgba(176,124,27,.45)"],
      ["same_domain","Same Domain","rgba(29,83,103,.10)","rgba(29,83,103,.40)"],
      ["cross_domain","Another Domain","rgba(159,63,47,.08)","rgba(159,63,47,.34)"],
      ["outside_hierarchy","Outside hierarchy","rgba(89,105,106,.07)","rgba(89,105,106,.30)"],
    ];
    const focus=this.nodes.find((node)=>node.id===this.graph.focusNodeId)||this.nodes[0];
    if(focus){focus.x=0;focus.y=0;focus.vx=0;focus.vy=0;}
    let inner=Math.max(54,(focus?.r||30)+24);
    definitions.forEach(([scope,label,fill,stroke],scopeIndex)=>{
      const members=this.nodes.filter((node)=>node!==focus&&node.focus_scope===scope);
      if(!members.length)return;
      const largest=Math.max(10,...members.map(node=>node.r));
      let offset=0,radius=inner+largest+8,lastRadius=radius;
      while(offset<members.length){
        const capacity=Math.max(4,Math.floor(2*Math.PI*radius/(2*largest+12)));
        const ring=members.slice(offset,offset+capacity);
        const phase=((hashNumber(`${this.graph.focusNodeId}:${scope}:${radius}`)%1000)/1000)*Math.PI*2;
        ring.forEach((node,index)=>{
          const angle=phase+index*Math.PI*2/ring.length;
          const phaseAngle=angle+this.orbitPhase/(1+scopeIndex*.12);
          node.x=Math.cos(phaseAngle)*radius;node.y=Math.sin(phaseAngle)*radius;node.vx=0;node.vy=0;
          node.ringHomeAngle=angle;node.ringHomeRadius=radius;
          node.orbitRadius=radius;node.orbitAngle=phaseAngle;node.orbitBand=scopeIndex;
          node.orbitClearance=Math.min(largest+3,radius*Math.sin(Math.PI/Math.max(2,ring.length))-3);
        });
        offset+=ring.length;lastRadius=radius;radius+=2*largest+12;
      }
      const outer=lastRadius+largest+8;
      this.focusBands.push({scope,label,fill,stroke,inner,outer,count:members.length,index:scopeIndex});
      inner=outer+8;
    });
  }

  reserveFocusLabelHole(){
    // Labels find a collision-free local caption; they never enlarge hierarchy rings.
    this.draw();
  }

  layout() {
    const nodes=this.nodes, edges=this.edges.filter(GraphKG.semanticEdge);
    if(this.graph?.focusMode)return;
    // Dense corpus-wide layers use the deterministic phyllotaxis seed directly.
    // Pulling hundreds of nodes toward thousands of edges creates an unreadable
    // hairball and hides nodes; scoped branches still receive the force layout.
    if ((this.graph?.corpusWide&&nodes.length>250)||nodes.length>700) return;
    const degrees=new Map(nodes.map(node=>[node.id,0]));
    edges.forEach(edge=>{degrees.set(edge.source,degrees.get(edge.source)+1);degrees.set(edge.target,degrees.get(edge.target)+1);});
    const iterations=nodes.length>500?28:nodes.length>220?65:nodes.length>90?110:220;
    for (let iteration=0;iteration<iterations;iteration+=1) {
      for (let i=0;i<nodes.length;i+=1) for (let j=i+1;j<nodes.length;j+=1) {
        const a=nodes[i],b=nodes[j]; let dx=a.x-b.x,dy=a.y-b.y; const d2=dx*dx+dy*dy+28,d=Math.sqrt(d2),force=2200/d2;
        dx/=d;dy/=d;a.vx+=dx*force;a.vy+=dy*force;b.vx-=dx*force;b.vy-=dy*force;
        const minimum=a.r+b.r+24; if (d<minimum) { const push=(minimum-d)*.04;a.vx+=dx*push;a.vy+=dy*push;b.vx-=dx*push;b.vy-=dy*push; }
      }
      // Normalize drawing springs by endpoint degree so dense evidence cannot collapse into one hub.
      edges.forEach((edge)=>{ const a=this.nodeMap.get(edge.source),b=this.nodeMap.get(edge.target);let dx=b.x-a.x,dy=b.y-a.y;const d=Math.max(1,Math.hypot(dx,dy)),desired=a.r+b.r+(this.level==='evidence'?44:70),force=(d-desired)*.032/Math.sqrt(Math.max(1,degrees.get(a.id)*degrees.get(b.id)));dx/=d;dy/=d;a.vx+=dx*force;a.vy+=dy*force;b.vx-=dx*force;b.vy-=dy*force; });
      nodes.forEach((node)=>{ node.vx+=-node.x*.0006;node.vy+=-node.y*.0006;node.vx*=.84;node.vy*=.84;node.x+=node.vx;node.y+=node.vy; });
    }
  }

  // Display-only broad-phase collisions. No membership, topology, or source weights change.
  resolveCollisions(anchor=null,passes=2) {
    const scale=displayScale(this.transform.scale),points=this.motionPoints();
    GraphKG.relax(points,{steps:1,passes:Math.min(2,passes),pull:0,gap:1/scale,anchor:anchor?.id,maxStep:4/scale});
    points.forEach((point,index)=>{this.nodes[index].x=point.x;this.nodes[index].y=point.y;});
    this.motionStats.collisionPasses+=Math.min(2,passes);
  }

  motionPoints(){
    const scale=displayScale(this.transform.scale);
    return this.nodes.map(node=>({id:node.id,x:node.x,y:node.y,homeX:node.x,homeY:node.y,r:(this.nodeRadius(node,0,3.5)+this.nodeStrokeRadius(node))/scale,
      fixed:this.graph?.focusMode&&node.id===this.graph.focusNodeId,band:this.graph?.focusMode?this.focusBands.find(band=>band.index===node.orbitBand):null}));
  }
  focusPaintClearance(node){
    if(!this.graph?.focusMode)return Infinity;
    const world=node.id===this.graph.focusNodeId?(this.focusBands[0]?.inner||node.r+24)-8:node.orbitClearance;
    return Number.isFinite(world)?Math.max(0,world*displayScale(this.transform.scale)):Infinity;
  }
  nodeStrokeRadius(node){return Math.min(.7,this.focusPaintClearance(node)*.15);}
  packedTargets(scale=displayScale(this.transform.scale)){
    const previous=this.transform.scale,area=this.usableBounds();
    this.transform.scale=scale;
    try{return GraphKG.packed(this.nodes.map(node=>({id:node.id,r:this.nodeRadius(node,0,3.5)+this.nodeStrokeRadius(node)})),{gap:Math.max(1,4/Math.sqrt(this.nodes.length/32))*(this.packingDensity||1),aspect:area.width/area.height});}
    finally{this.transform.scale=previous;}
  }
  planPackedFit(){
    const area=this.usableBounds();this.packingDensity=1;
    let low=.000001,high=3.2,plan=this.packedTargets(low);
    if(plan.width>area.width*.92||plan.height>area.height*.92){
      let lowDensity=.0001,highDensity=1;
      for(let i=0;i<12;i++){
        this.packingDensity=(lowDensity+highDensity)/2;const candidate=this.packedTargets(low);
        if(candidate.width<=area.width*.92&&candidate.height<=area.height*.92)lowDensity=this.packingDensity;else highDensity=this.packingDensity;
      }
      this.packingDensity=lowDensity;plan=this.packedTargets(low);
    }
    this.packingFeasible=plan.width<=area.width*.94&&plan.height<=area.height*.94;
    this.canvas.dataset.packingDensity=String(this.packingDensity);
    this.canvas.dataset.packingFeasible=String(this.packingFeasible);
    // Solve the screen-radius constraint offscreen, never alternate visible fit/repulsion.
    for(let i=0;i<18;i++){
      const scale=(low+high)/2,next=this.packedTargets(scale);
      if(next.width<=area.width*.94&&next.height<=area.height*.94){low=scale;plan=next;}else high=scale;
    }
    this.transform={scale:low,x:(area.left+area.right)/2,y:(area.top+area.bottom)/2};this.fitScale=low;
    this.nodes.forEach((node,index)=>{node.x=plan.points[index].x/low;node.y=plan.points[index].y/low;node.vx=0;node.vy=0;});
  }
  stopPhysics(){
    this.motionJob=null;this.physicsFrame=null;delete this.canvas.dataset.settling;
    if(!this.orbitEnabled&&this.motionFrame!==null){cancelAnimationFrame(this.motionFrame);this.motionFrame=null;}
  }
  resolveFocusCollisions(anchor=null){
    const scale=displayScale(this.transform.scale);
    const points=this.motionPoints();
    GraphKG.relax(points,{steps:1,pull:0,gap:.5/scale,anchor:anchor?.id,maxStep:4/scale});
    points.forEach((point,index)=>{const node=this.nodes[index];node.x=point.x;node.y=point.y;if(!point.fixed){node.orbitRadius=Math.hypot(point.x,point.y);node.orbitAngle=Math.atan2(point.y,point.x);}});
    this.motionStats.collisionPasses+=2;
  }
  stopOrbit(){
    this.orbitEnabled=false;this.orbitFrame=null;this.canvas.dataset.orbitState='stopped';
    if(!this.motionJob&&this.motionFrame!==null){cancelAnimationFrame(this.motionFrame);this.motionFrame=null;}
  }
  startOrbit(){
    if(state.guidePath||this.v64Busy){this.stopPhysics();this.stopOrbit();return;}
    this.orbitEnabled=Boolean(this.nodes.length&&state.neighborhoodMotion&&!guideReducedMotion()&&!state.guidePath&&!this.v64Busy);
    this.scheduleMotion();
  }
  scheduleMotion(){
    if(this.motionFrame!==null||document.hidden||!this.canvas.getClientRects().length||(!this.motionJob&&!this.orbitEnabled&&!this.dragCollisionPending))return;
    let last=performance.now();
    const tick=now=>{
      this.motionFrame=null;this.physicsFrame=null;this.orbitFrame=null;
      if(document.hidden||state.guidePath||this.v64Busy||!this.canvas.getClientRects().length)return;
      const interval=now-last,elapsed=GraphMotion.elapsed(interval,GraphKG.MOTION.stallMs);last=now;
      const started=performance.now(),scale=displayScale(this.transform.scale);let changed=false;
      if(this.dragCollisionPending&&this.drag?.node){
        this.dragCollisionPending=false;
        if(this.graph?.focusMode)this.resolveFocusCollisions(this.drag.node);else this.resolveCollisions(this.drag.node);
        changed=true;
      }
      if(this.motionJob&&!this.drag){
        const job=this.motionJob;job.elapsed+=elapsed;const progress=Math.min(1,job.elapsed/job.duration),ease=GraphMotion.ease(progress);
        let remaining=0;
        this.nodes.forEach((node,index)=>{const from=job.from[index],to=job.to[index];let x=from.x+(to.x-from.x)*ease,y=from.y+(to.y-from.y)*ease;
          if(this.graph?.focusMode&&node.id!==this.graph.focusNodeId){
            const startAngle=Math.atan2(from.y,from.x),endAngle=Math.atan2(to.y,to.x),angle=startAngle+Math.atan2(Math.sin(endAngle-startAngle),Math.cos(endAngle-startAngle))*ease;
            const radius=Math.hypot(from.x,from.y)+(Math.hypot(to.x,to.y)-Math.hypot(from.x,from.y))*ease;
            x=Math.cos(angle)*radius;y=Math.sin(angle)*radius;
          }
          const dx=x-node.x,dy=y-node.y,distance=Math.hypot(dx,dy);
          this.motionStats.maxStepPx=Math.max(this.motionStats.maxStepPx,distance*scale);node.x=x;node.y=y;node.vx=0;node.vy=0;
          remaining=Math.max(remaining,Math.hypot(node.x-to.x,node.y-to.y)*scale);
          if(this.graph?.focusMode&&node.id!==this.graph.focusNodeId){node.orbitRadius=Math.hypot(node.x,node.y);node.orbitAngle=Math.atan2(node.y,node.x);}});
        if(progress===1&&remaining<.05){this.motionStats.lastReturnWallMs=performance.now()-job.startedAt;this.motionStats.lastReturnDurationMs=job.duration;this.motionJob=null;delete this.canvas.dataset.settling;}
        changed=true;
      }
      this.orbitEnabled=Boolean(this.nodes.length&&state.neighborhoodMotion&&!guideReducedMotion());
      const paused=this.motionJob||this.drag||this.drawerOpen||(this.hover&&!this.hover.source)||this.orbitHoverId;
      this.canvas.dataset.orbitState=this.orbitEnabled?(paused?'paused':'moving'):'stopped';
      this.canvas.dataset.motionKind=this.graph?.focusMode?'orbit-and-flow':'flow';
      if(this.orbitEnabled&&!paused&&elapsed){
        this.flowElapsedMs+=elapsed;
        if(this.graph?.focusMode){
          this.orbitPhase+=GraphMotion.orbitDelta(elapsed,0,GraphKG.MOTION);
          for(const node of this.nodes){
          if(node.id===this.graph.focusNodeId||!Number.isFinite(node.orbitAngle))continue;
          node.orbitAngle+=GraphMotion.orbitDelta(elapsed,node.orbitBand||0,GraphKG.MOTION);
          node.x=Math.cos(node.orbitAngle)*node.orbitRadius;node.y=Math.sin(node.orbitAngle)*node.orbitRadius;
          }
        }
        changed=true;
      }
      if(changed){this.draw();this.motionStats.frames++;this.motionStats.maxFrameMs=Math.max(this.motionStats.maxFrameMs,performance.now()-started);}
      if(this.motionJob||this.orbitEnabled||this.dragCollisionPending){
        this.motionFrame=requestAnimationFrame(frame);this.physicsFrame=this.motionJob?this.motionFrame:null;this.orbitFrame=this.orbitEnabled?this.motionFrame:null;
      }
    };
    const frame=now=>{if(now-last<GraphKG.MOTION.frameMs-.5){this.motionFrame=requestAnimationFrame(frame);return;}tick(now);};
    this.motionFrame=requestAnimationFrame(frame);
  }
  hideRingLegendSoon(){clearTimeout(this.legendTimer);this.legendTimer=setTimeout(()=>{this.ringLegend.hidden=true;},12000);}
  showRingLegend(){
    const groups=[['same_community','Same community','#73a184'],['same_theme','Same theme','#d6b465'],['same_domain','Same domain','#80a9bb'],['cross_domain','Other domain','#cf927e']];
    if(this.focusBands.some(band=>band.scope==='outside_hierarchy'))groups.push(['outside_hierarchy','Unassigned','#a4b1b0']);
    this.ringLegend.innerHTML='<header><b>Neighborhood</b><button type="button" aria-label="Hide neighborhood legend">Close</button></header>'+groups.map(([scope,label,color])=>`<div><i style="--ring-color:${color}"></i><span>${label}</span><small>${this.nodes.filter(node=>node.focus_scope===scope).length}</small></div>`).join('');
    this.ringLegend.querySelector('button').onclick=()=>{this.ringLegend.hidden=true;clearTimeout(this.legendTimer);};
    this.ringLegend.hidden=false;this.hideRingLegendSoon();
  }
  settlePhysics(){
    this.compactLayout();
  }

  compactLayout({immediate=false,dragReturn=false}={}){
    const slowReturn=dragReturn||this.motionJob?.dragReturn===true;
    this.stopPhysics();
    if(this.drag||state.guidePath||this.v64Busy||!this.nodes.length)return;
    const scale=displayScale(this.transform.scale),homes=this.compactHomes;
    let targets;
    if(this.graph?.focusMode)targets=this.nodes.map(node=>{
      if(node.id===this.graph.focusNodeId)return {x:0,y:0};
      const angle=node.ringHomeAngle+this.orbitPhase/(1+(node.orbitBand||0)*.12);
      return {x:Math.cos(angle)*node.ringHomeRadius,y:Math.sin(angle)*node.ringHomeRadius};
    });
    else if(this.packedLayout)targets=this.packedTargets(scale).points.map(point=>({x:point.x/scale,y:point.y/scale}));
    else{
      const points=this.motionPoints();
      points.forEach(point=>{const home=homes?.get(point.id)||point;point.x=home.x;point.y=home.y;});
      GraphKG.relax(points,{steps:32,pull:0,gap:2/scale,maxStep:24/scale});
      if(GraphKG.overlaps(points,0,.4/scale)){this.packedLayout=true;targets=this.packedTargets(scale).points.map(point=>({x:point.x/scale,y:point.y/scale}));}
      else targets=points;
    }
    const distance=Math.max(...this.nodes.map((node,index)=>Math.hypot(node.x-targets[index].x,node.y-targets[index].y)*scale));
    if(immediate||guideReducedMotion()||!state.neighborhoodMotion||distance<.05){
      this.nodes.forEach((node,index)=>{node.x=targets[index].x;node.y=targets[index].y;if(this.graph?.focusMode){node.orbitRadius=Math.hypot(node.x,node.y);node.orbitAngle=Math.atan2(node.y,node.x);}});this.draw();return;
    }
    const pathLength=Math.max(...this.nodes.map((node,index)=>GraphMotion.returnPathLength(node,targets[index],Boolean(this.graph?.focusMode&&node.id!==this.graph.focusNodeId))*scale));
    const duration=GraphMotion.returnDuration(distance,GraphKG.MOTION,pathLength,slowReturn);
    this.motionJob={from:this.nodes.map(node=>({x:node.x,y:node.y})),to:targets,elapsed:0,duration,dragReturn:slowReturn,startedAt:performance.now()};
    this.canvas.dataset.settling='true';this.scheduleMotion();
  }

  usableBounds(){
    const rect=this.canvas.getBoundingClientRect(),toolbar=$('.map-toolbar').getBoundingClientRect();
    let top=Math.max(24,toolbar.bottom-rect.top+42),left=28;
    const guide=$('#retrieval-path-guide')||$('#saved-kg-walk');
    if(this.name==='current'&&guide?.getClientRects().length){
      const box=guide.getBoundingClientRect();
      if(this.width>=1000)left=Math.min(this.width*.36,box.right-rect.left+24);
      else top=Math.max(top,box.bottom-rect.top+18);
    }
    const right=Math.max(left+80,this.width-28),bottom=Math.max(top+80,this.height-28);
    return {left,top,right,bottom,width:right-left,height:bottom-top};
  }

  fit() {
    if (!(this.width>0&&this.height>0)) return;
    if (!this.nodes.length) { this.transform={x:0,y:0,scale:1};this.draw();return; }
    if(this.packedLayout&&!this.graph?.focusMode){this.planPackedFit();this.draw();return;}
    const available=this.usableBounds(),diameter=Math.min(available.width,available.height)*(this.graph?.focusMode ? .88 : .78);
    const area={width:diameter,height:diameter,left:available.left+(available.width-diameter)/2,top:available.top+(available.height-diameter)/2};
    const extent=this.graph?.focusMode?Math.max(this.focusBands.at(-1)?.outer||0,...this.nodes.map(n=>n.r+8)):null;
    const minX=extent===null?Math.min(...this.nodes.map(n=>n.x-n.r))-12:-extent,maxX=extent===null?Math.max(...this.nodes.map(n=>n.x+n.r))+12:extent,minY=extent===null?Math.min(...this.nodes.map(n=>n.y-n.r))-12:-extent,maxY=extent===null?Math.max(...this.nodes.map(n=>n.y+n.r))+12:extent;
    const scale=displayScale(Math.min(area.width/(maxX-minX),area.height/(maxY-minY)));
    this.transform={scale,x:area.left+area.width/2-(minX+maxX)/2*scale,y:area.top+area.height/2-(minY+maxY)/2*scale};
    this.fitScale=scale;
    this.draw();
  }

  transition(refresh) {
    if(state.guidePath){
      pauseGuide();const g=state.guidePath;g.busy=true;renderGuideStatus();
      guideCrossfade(refresh).catch(error=>{g.error=error.message;}).finally(()=>{g.busy=false;g.settledAt=performance.now();renderGuideStatus();});
      return;
    }
    this.canvas.classList.add("transitioning");
    window.setTimeout(()=>{ refresh();window.setTimeout(()=>this.canvas.classList.remove("transitioning"),180); },90);
  }

  canEnter(node) { return !this.studyContext&&Boolean(node&&nextLevel[this.level]&&nodeLevel[node.type]===this.level); }
  async enterNode(node) {
    if (!this.canEnter(node)) return;
    const targetLevel=nextLevel[this.level];
    try {
      if (targetLevel!=="evidence") await ensureHierarchyCatalog(this.view,targetLevel);
      else await ensureCommunityDetail(this.view,node);
    } catch (error) {
      this.inspector.innerHTML=`<div class="inspector-empty"><div><b>Hierarchy catalog unavailable</b><p>${esc(error.message)}</p></div></div>`;
      return;
    }
    this.neighborhood=null;this.localIncidentNeighborhood=null;this.investigativeContext=null;this.expandedIncidentScopes.clear();
    this.showNeighborEdges=false;this.inducedNeighborEdges=[];this.inducedLoadRevision+=1;this.inducedLoading=false;this.inducedError="";
    this.trail.push({...node}); this.level=nextLevel[this.level]; this.nodeLimit=nodeLimitFor(this.level);
    this.transition(()=>this.refreshGraph());
  }
  back() {
    if(state.guidePath)pauseGuide();
    if(this.nodeHistory.length){this.restoreLocation(this.nodeHistory.pop());return;}
    if(this.neighborhood){this.returnFromNeighborhood();return;}
    const exited=this.trail.pop(); if (!exited) return;
    this.neighborhood=null;this.localIncidentNeighborhood=null;this.investigativeContext=null;this.expandedIncidentScopes.clear();
    this.showNeighborEdges=false;this.inducedNeighborEdges=[];this.inducedLoadRevision+=1;this.inducedLoading=false;this.inducedError="";
    this.level=nodeLevel[exited.type]||state.level; this.nodeLimit=nodeLimitFor(this.level);
    this.pinnedFocusIds.clear(); this.pinnedSearchRecords.clear(); this.navigationRevision+=1; this.inspectionRevision+=1;
    this.transition(()=>this.refreshGraph(exited.id));
  }
  setNodeCap(rawValue) {
    if(state.guidePath?.caseContext)return guideContextView(this.studyContext?.view_kind==='incident'?'neighborhood':'community',{limit:NODE_CAPS.has(Number(rawValue))?Number(rawValue):DEFAULT_NODE_LIMIT});
    if(state.guidePath){pauseGuide();state.guidePath.limit=NODE_CAPS.has(Number(rawValue))?Number(rawValue):DEFAULT_NODE_LIMIT;}
    const value=Number(rawValue);this.nodeLimit=NODE_CAPS.has(value)?value:nodeLimitFor(this.level);
    this.refreshGraph(!this.selected?.source?this.selected?.id:null);
    if(this.neighborhood&&this.showNeighborEdges)this.loadInducedNeighborEdges();
  }

  levelRows(level) {
    const base=this.view?.levels?.[level]||{};
    return base.catalog_nodes?.length?base.catalog_nodes:(base.nodes||[]);
  }

  async hierarchyNode(level,id) {
    if(!id) return null;
    await ensureHierarchyCatalog(this.view,level);
    return this.levelRows(level).find((row)=>row.id===id)||null;
  }

  centerIds(ids) {
    if(!(this.width>0&&this.height>0))return;
    const points=[...ids].map((id)=>this.nodeMap.get(id)).filter(Boolean);
    if(!points.length)return;
    const minX=Math.min(...points.map((node)=>node.x)),maxX=Math.max(...points.map((node)=>node.x));
    const minY=Math.min(...points.map((node)=>node.y)),maxY=Math.max(...points.map((node)=>node.y));
    const spanX=Math.max(120,maxX-minX+150),spanY=Math.max(120,maxY-minY+150);
    this.transform.scale=displayScale(Math.min(Math.max(1,this.width-90)/spanX,Math.max(1,this.height-90)/spanY,1.35));
    this.transform.x=this.width/2-(minX+maxX)/2*this.transform.scale;
    this.transform.y=this.height/2-(minY+maxY)/2*this.transform.scale;
  }

  pulseIds(ids,duration=3200) {
    this.matches=new Set([...this.pinnedFocusIds,...this.searchMatchIds,...ids].filter((id)=>this.nodeMap.has(id)));
    if(this.pulseTimer!==null)window.clearTimeout(this.pulseTimer);
    this.pulseTimer=window.setTimeout(()=>{this.matches=new Set([...this.pinnedFocusIds,...this.searchMatchIds].filter((id)=>this.nodeMap.has(id)));this.pulseTimer=null;this.draw();},duration);
    this.draw();
  }

  async showNavigationStage(level,trail,focusIds,selectedId,revision) {
    if(revision!==this.navigationRevision)return false;
    this.canvas.classList.add("transitioning");
    await pause(85);
    if(revision!==this.navigationRevision){this.canvas.classList.remove("transitioning");return false;}
    this.neighborhood=null;this.localIncidentNeighborhood=null;this.expandedIncidentScopes.clear();
    this.showNeighborEdges=false;this.inducedNeighborEdges=[];this.inducedLoadRevision+=1;this.inducedLoading=false;this.inducedError="";
    this.level=level;this.trail=[...trail];this.nodeLimit=nodeLimitFor(level);
    this.pinnedFocusIds=new Set(focusIds.filter(Boolean));
    this.refreshGraph(selectedId||null);
    this.centerIds(this.pinnedFocusIds);
    this.canvas.classList.remove("transitioning");this.draw();
    await pause(180);
    return revision===this.navigationRevision;
  }

  async hierarchyRoute(record) {
    const route=[];
    const domain=await this.hierarchyNode("domain",record.domain_id);
    const theme=await this.hierarchyNode("theme",record.theme_id);
    const community=await this.hierarchyNode("community",record.community_id);
    if(domain)route.push(domain);
    if(theme)route.push(theme);
    if(community)route.push(community);
    return {route,domain,theme,community};
  }

  rememberLocation() {
    return {viewKey:this.view?.key,level:this.level,trail:[...this.trail],nodeLimit:this.nodeLimit,neighborhood:this.neighborhood,showNeighborEdges:this.showNeighborEdges,slotFocusId:this.slotFocusId,
      localIncidentNeighborhood:this.localIncidentNeighborhood,selectedId:this.selected?.id||this.external?.id,
      pinnedFocusIds:[...this.pinnedFocusIds],pinnedSearchRecords:[...this.pinnedSearchRecords],
      searchMatchIds:[...this.searchMatchIds],labelOverrides:[...this.labelOverrides],fitScale:this.fitScale,
      transform:{...this.transform},flowElapsedMs:this.flowElapsedMs,width:this.width,height:this.height,positions:this.nodes.map(n=>({id:n.id,x:n.x,y:n.y}))};
  }

  restoreLocation(saved) {
    if(saved.viewKey&&saved.viewKey!==this.view?.key)throw Error('A graph perspective cannot cross a bound projection.');
    this.navigationRevision+=1;this.inspectionRevision+=1;
    Object.assign(this,{level:saved.level,trail:saved.trail,nodeLimit:saved.nodeLimit,neighborhood:saved.neighborhood,
      localIncidentNeighborhood:saved.localIncidentNeighborhood,slotFocusId:saved.slotFocusId||null,showNeighborEdges:saved.showNeighborEdges!==false,inducedNeighborEdges:[],external:null,selected:null});
    this.pinnedFocusIds=new Set(saved.pinnedFocusIds||[]);
    this.pinnedSearchRecords=new Map(saved.pinnedSearchRecords||[]);
    this.searchMatchIds=new Set(saved.searchMatchIds||[]);this.labelOverrides=new Map(saved.labelOverrides||[]);
    this.refreshGraph(saved.selectedId);
    this.flowElapsedMs=Number.isFinite(saved.flowElapsedMs)?saved.flowElapsedMs:0;
    for(const position of saved.positions){const node=this.nodeMap.get(position.id);if(node)Object.assign(node,{x:position.x,y:position.y});}
    if(saved.width===this.width&&saved.height===this.height){this.transform={...saved.transform};this.fitScale=saved.fitScale||this.fitScale;}else this.fit();
    this.draw();this.updateChrome();
  }

  async focusNeighborhood(record,{scroll=true,remember=true}={}) {
    const revision=++this.navigationRevision;
    const detail=this.investigativeContext?.node?.id===record.id?this.investigativeContext:await ensureNodeNeighborhood(this.view,record.id);
    const route=await this.hierarchyRoute(detail.node);
    if(revision!==this.navigationRevision)return;
    if(remember)this.nodeHistory.push(this.rememberLocation());
    this.trail=route.route;
    this.slotFocusId=record.overlay_slot?record.id:null;
    this.level="evidence";this.neighborhood=detail;this.localIncidentNeighborhood=null;this.expandedIncidentScopes.clear();
    this.showNeighborEdges=true;this.inducedNeighborEdges=[];this.inducedLoadRevision+=1;this.inducedLoading=false;this.inducedError="";
    this.pinnedSearchRecords.set(record.id,{...record,...detail.node});
    this.pinnedFocusIds=new Set([record.id]);
    this.nodeLimit=nodeLimitFor(this.level);
    this.refreshGraph(record.id);this.pulseIds([record.id]);
    if(this.showNeighborEdges)this.loadInducedNeighborEdges();
    if(scroll)this.canvas.focus({preventScroll:true});
  }

  focusHierarchyNeighborhood(record,{scroll=true}={}) {
    this.nodeHistory.push(this.rememberLocation());
    this.neighborhood=this.hierarchyNeighborhood(record);this.localIncidentNeighborhood=null;this.expandedIncidentScopes.clear();
    this.showNeighborEdges=true;this.inducedNeighborEdges=[];this.inducedLoadRevision+=1;this.inducedLoading=false;this.inducedError="";
    this.pinnedFocusIds=new Set([record.id]);this.nodeLimit=nodeLimitFor(this.level);
    this.refreshGraph(record.id);this.pulseIds([record.id]);
    if(this.showNeighborEdges)this.loadInducedNeighborEdges();
    if(scroll)this.canvas.focus({preventScroll:true});
  }

  focusDirectConnections(record,{scroll=true}={}) {
    if(this.level==="evidence")return this.focusNeighborhood(record,{scroll});
    this.focusHierarchyNeighborhood(record,{scroll});
  }

  returnFromNeighborhood() {
    if(!this.neighborhood)return;
    const focusId=this.neighborhood.node?.id||null;
    this.neighborhood=null;this.localIncidentNeighborhood=null;this.expandedIncidentScopes.clear();
    this.showNeighborEdges=false;this.inducedNeighborEdges=[];this.inducedLoadRevision+=1;this.inducedLoading=false;this.inducedError="";
    this.pinnedFocusIds=focusId?new Set([focusId]):new Set();
    this.refreshGraph(focusId);
  }

  async openLocalCommunity(record,{scroll=true,remember=true}={}) {
    const revision=++this.navigationRevision;
    this.investigativeContext=null;
    const {domain,theme,community}=await this.hierarchyRoute(record);
    if(!community)throw new Error("No mother Community is recorded in this exploration layout. No membership was invented.");
    const incident=this.neighborhood?.node?.id===record.id?this.neighborhood:await ensureNodeNeighborhood(this.view,record.id);
    await ensureCommunityDetail(this.view,community);
    if(revision!==this.navigationRevision)return;
    if(remember)this.nodeHistory.push(this.rememberLocation());
    this.neighborhood=null;this.localIncidentNeighborhood=incident;this.expandedIncidentScopes.clear();
    this.showNeighborEdges=false;this.inducedNeighborEdges=[];this.inducedLoadRevision+=1;this.inducedLoading=false;this.inducedError="";
    this.level="evidence";this.trail=[domain,theme,community].filter(Boolean);
    this.slotFocusId=record.overlay_slot?record.id:null;
    this.pinnedFocusIds=new Set([record.id]);this.searchMatchIds.clear();this.nodeLimit=nodeLimitFor(this.level);
    this.refreshGraph(record.id);this.pulseIds([record.id]);
    if(scroll)this.canvas.focus({preventScroll:true});
  }

  showInvestigativeContext(record,caseRow) {
    const leads=(caseRow.investigative_leads||[]).filter((lead)=>lead?.target_node?.id);
    const node={...record,investigative_lead_count:leads.length,investigative_slot_id:caseRow.slot_id};
    const neighbors=leads.map((lead)=>this.normalizedEvidenceNode(lead.target_node));
    const edges=leads.map((lead)=>({
      id:lead.lead_id,source:record.id,target:lead.target,edge_type:lead.edge_type,
      edge_class:"investigative_only",investigative_only:true,semantic:false,
      visibility:"redacted_placeholder",contains_redaction_placeholder:true,
      weight:Number(lead.score||0),layout_weight:Number(lead.score||0),
      evidence_count:(lead.supporting_document_ids||[]).length,
      supporting_document_ids:lead.supporting_document_ids||[],
      lead_basis:lead.lead_basis,lead_channels:lead.lead_channels||[],
      description:lead.description,weight_semantics:lead.score_semantics,
      hierarchy_scope:focusScope("evidence",node,lead.target_node),
      source_label:node.label,target_label:lead.target_node.label,
    }));
    this.investigativeContext={node,neighbors,edges,level:"evidence",investigative_only:true};
    this.localIncidentNeighborhood=this.investigativeContext;
    this.pinnedFocusIds=new Set([record.id]);this.searchMatchIds.clear();
    this.refreshGraph(record.id);this.pulseIds([record.id]);
  }

  async loadInducedNeighborEdges() {
    if(!this.neighborhood||!this.showNeighborEdges)return;
    const revision=++this.inducedLoadRevision,focusId=this.neighborhood.node.id;
    this.inducedLoading=true;this.inducedError="";this.renderInspector();
    try{
      const ids=this.nodes.map((node)=>node.id);
      let edges;
      if(this.level==="evidence")edges=await ensureInducedEdges(this.view,ids);
      else{
        const base=this.view.levels[this.level]||{},idSet=new Set(ids);
        const allEdges=base.catalog_edges?.length?base.catalog_edges:(base.edges||[]);
        edges=allEdges.filter((edge)=>idSet.has(edge.source)&&idSet.has(edge.target));
      }
      if(revision!==this.inducedLoadRevision||!this.showNeighborEdges)return;
      this.inducedNeighborEdges=edges;this.inducedLoading=false;
      this.refreshGraph(focusId);
    }catch(error){
      if(revision!==this.inducedLoadRevision)return;
      this.inducedNeighborEdges=[];this.inducedLoading=false;this.inducedError=error.message;this.showNeighborEdges=false;
      this.refreshGraph(focusId);
    }
  }

  toggleNeighborEdges() {
    if(!this.neighborhood)return;
    this.showNeighborEdges=!this.showNeighborEdges;
    this.inducedNeighborEdges=[];this.inducedError="";this.inducedLoadRevision+=1;
    this.refreshGraph(this.neighborhood.node.id);
    if(this.showNeighborEdges)this.loadInducedNeighborEdges();
  }

  async navigateToNode(record) {
    const revision=++this.navigationRevision;
    this.pinnedSearchRecords=new Map([[record.id,record]]);
    const {domain,theme,community}=await this.hierarchyRoute(record);
    if(revision!==this.navigationRevision)return;
    const trail=[];
    if(domain){if(!await this.showNavigationStage("domain",trail,[domain.id],domain.id,revision))return;trail.push(domain);}
    if(theme){if(!await this.showNavigationStage("theme",trail,[theme.id],theme.id,revision))return;trail.push(theme);}
    if(community){
      if(!await this.showNavigationStage("community",trail,[community.id],community.id,revision))return;
      await ensureCommunityDetail(this.view,community);
      if(revision!==this.navigationRevision)return;
      trail.push(community);
    }
    if(!await this.showNavigationStage("evidence",trail,[record.id],record.id,revision))return;
    await this.openLocalCommunity(record,{scroll:false});
    this.canvas.focus({preventScroll:true});
  }

  async navigateToEdge(record) {
    const revision=++this.navigationRevision;
    const source=record.source_record,target=record.target_record;
    this.pinnedSearchRecords=new Map([[source.id,source],[target.id,target]]);
    const sourceRoute=await this.hierarchyRoute(source),targetRoute=await this.hierarchyRoute(target);
    if(revision!==this.navigationRevision)return;
    const trail=[];
    let finalLevel="evidence",endpointIds=[source.id,target.id];
    if(source.domain_id&&source.domain_id===target.domain_id&&sourceRoute.domain){
      if(!await this.showNavigationStage("domain",trail,[source.domain_id],source.domain_id,revision))return;
      trail.push(sourceRoute.domain);
      if(source.theme_id&&source.theme_id===target.theme_id&&sourceRoute.theme){
        if(!await this.showNavigationStage("theme",trail,[source.theme_id],source.theme_id,revision))return;
        trail.push(sourceRoute.theme);
        if(source.community_id&&source.community_id===target.community_id&&sourceRoute.community){
          if(!await this.showNavigationStage("community",trail,[source.community_id],source.community_id,revision))return;
          await ensureCommunityDetail(this.view,sourceRoute.community);
          if(revision!==this.navigationRevision)return;
          trail.push(sourceRoute.community);
        }else{finalLevel="community";endpointIds=[source.community_id,target.community_id];}
      }else{finalLevel="theme";endpointIds=[source.theme_id,target.theme_id];}
    }else if(source.domain_id&&target.domain_id){finalLevel="domain";endpointIds=[source.domain_id,target.domain_id];}
    endpointIds=endpointIds.filter(Boolean);
    if(!endpointIds.length){
      await this.showNavigationStage("evidence",[],[source.id,target.id],null,revision);
      this.external={...record,source:source.id,target:target.id};this.renderInspector();this.draw();return;
    }
    if(!await this.showNavigationStage(finalLevel,trail,endpointIds,null,revision))return;
    const edge=this.edges.find((row)=>(row.source===endpointIds[0]&&row.target===endpointIds[1])||(row.source===endpointIds[1]&&row.target===endpointIds[0]));
    this.centerIds(endpointIds);this.pulseIds(endpointIds);
    if(edge){this.external=null;this.selected=edge;}
    else{
      const inspectedEdge={...record,source:endpointIds[0],target:endpointIds[1],source_label:source.label,target_label:target.label,search_resolved_edge:true};
      this.edges=[inspectedEdge,...this.edges];this.external=null;this.selected=inspectedEdge;
    }
    this.renderInspector();this.draw();this.canvas.focus({preventScroll:true});
  }

  async navigateToHierarchy(record) {
    const revision=++this.navigationRevision;
    const {domain,theme,community}=await this.hierarchyRoute(record);
    if(revision!==this.navigationRevision)return;
    const level=record.hierarchy_level;
    const trail=[];
    if(level==="domain"){
      await this.showNavigationStage("domain",trail,[record.id],record.id,revision);
    }else if(level==="theme"){
      if(domain){if(!await this.showNavigationStage("domain",trail,[domain.id],domain.id,revision))return;trail.push(domain);}
      await this.showNavigationStage("theme",trail,[record.id],record.id,revision);
    }else if(level==="community"){
      if(domain){if(!await this.showNavigationStage("domain",trail,[domain.id],domain.id,revision))return;trail.push(domain);}
      if(theme){if(!await this.showNavigationStage("theme",trail,[theme.id],theme.id,revision))return;trail.push(theme);}
      await this.showNavigationStage("community",trail,[record.id],record.id,revision);
    }
    this.canvas.focus({preventScroll:true});
  }

  async navigateToSearchResult(record) {
    if(record.overlay_slot){await navigateOpaqueSlot(this,record);return;}
    this.slotFocusId=null;
    if(record.kind==="edge")await this.navigateToEdge(record);
    else if(record.kind==="hierarchy")await this.navigateToHierarchy(record);
    else {
      await this.navigateToNode(record);
      const redactionCase=redactionCaseForRecord(record);
      if(redactionCase){
        selectRedactionNavigatorRecord(redactionCase);
        this.showInvestigativeContext(record,redactionCase);
      }
    }
  }

  updateChrome() {
    this.syncMapActions();
    syncPairActions();
    renderSelectionAudit();
    if(this.studyContext){
      const c=this.studyContext;
      $(`#${this.name}-breadcrumb`).textContent="Case source graph / "+(c.community?.label||"Ungrouped state")+" / "+(c.view_kind==="community"?"Community members":"Connections centered on "+guideNodeLabel(c.nodes.find(n=>n.id===c.focus_id)));
      $(`[data-back="${this.name}"]`).disabled=state.guidePath.busy||state.guidePath.index===0;
      const cap=$(`[data-node-cap="${this.name}"]`);cap.value=String(state.guidePath.limit);cap.disabled=state.guidePath.busy;
      $(`#${this.name}-caption`).textContent=fmt(c.displayed_nodes)+" drawn / "+fmt(c.available_nodes)+" eligible states. Solid: source; dashed: membership; dotted: source aggregate. Drawing cap only.";
      return;
    }
    const trail=this.trail.map((row)=>compact(row.label,44));
    if(this.neighborhood)trail.push(`Connections centered on ${compact(this.neighborhood.node?.label||this.neighborhood.node?.id,44)}`);
    const breadcrumb=$(`#${this.name}-breadcrumb`);
    breadcrumb.innerHTML=`<b>${esc(this.level[0].toUpperCase()+this.level.slice(1))}</b> &nbsp;/&nbsp; ${trail.length?trail.map(esc).join(" &rsaquo; "):"Corpus overview"}`;
    breadcrumb.title=["Corpus overview",...this.trail.map((row)=>row.label),...(this.neighborhood?[`Connections centered on ${this.neighborhood.node?.label||this.neighborhood.node?.id}`]:[])].join(" > ");
    const back=$(`[data-back="${this.name}"]`),cap=$(`[data-node-cap="${this.name}"]`);
    const scoped=this.trail.length>0||Boolean(this.neighborhood);
    if(back)back.disabled=!scoped&&!this.nodeHistory.length;
    if(cap){cap.value=String(this.nodeLimit);cap.disabled=this.graph.availableNodeCount<=32;}
    renderPanelCaption(this);
  }

  screen(node) { const scale=displayScale(this.transform.scale),flow=GraphMotion.flow(this.flowElapsedMs);return {x:node.x*scale+this.transform.x+flow.x,y:node.y*scale+this.transform.y+flow.y}; }
  world(point) { const scale=displayScale(this.transform.scale),flow=GraphMotion.flow(this.flowElapsedMs);return {x:(point.x-this.transform.x-flow.x)/scale,y:(point.y-this.transform.y-flow.y)/scale}; }
  nodeRadius(node,padding=0,minimum=0) {
    const scale=displayScale(this.transform.scale),mobile=this.width<600,ceiling=mobile?38:58;
    const denseNeighbor=mobile&&this.graph?.focusMode&&this.nodes.length>96&&node.id!==this.graph.focusNodeId;
    const density=denseNeighbor?Math.max(.45,Math.sqrt(64/this.nodes.length)):1;
    const radius=displayRadius(displayRadius(node.r,5,42)*Math.pow(scale,.62)*(mobile?.9:1)*density+padding,Math.max(2,4*density,minimum),ceiling+padding);
    // A packed dense viewport may lower its pixel floor; never alter stored mass.
    const packedRadius=this.nodes.length>700&&this.packedLayout&&!this.graph?.focusMode?(radius-padding)*(this.packingDensity||1)+padding:radius;
    const clearance=this.focusPaintClearance(node);
    return Number.isFinite(clearance)?Math.min(radius,Math.max(0,clearance-this.nodeStrokeRadius(node))+padding):packedRadius;
  }
  pointer(event) { const rect=this.canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top}; }
  hitNode(point) {
    let best=null,score=Infinity,painted=false;
    for(const node of this.nodes){
      const p=this.screen(node),radius=this.nodeRadius(node),distance=Math.hypot(point.x-p.x,point.y-p.y),inside=distance<=radius;
      if(distance>radius+6||painted&&!inside)continue;
      const candidate=inside?distance/Math.max(1,radius):distance-radius;
      if(inside&&!painted||candidate<score){best=node;score=candidate;painted=inside;}
    }
    return best;
  }
  hitEdge(point) { let best=null,bestDistance=10;this.edges.forEach((edge)=>{ const distance=distanceToSegment(point,this.screen(this.nodeMap.get(edge.source)),this.screen(this.nodeMap.get(edge.target)));if(distance<bestDistance){best=edge;bestDistance=distance;} });return best; }
  clearHold() { if (this.holdTimer!==null) { clearTimeout(this.holdTimer);this.holdTimer=null; } }

  pointerDown(event) {
    if (event.button!==undefined&&event.button!==0) return;
    if(this.studyContext){pauseGuide();if(state.guidePath.busy)return;}
    state.activePanelName=this.name;this.stopPhysics();this.stopOrbit();
    const point=this.pointer(event),node=this.hitNode(point);try{this.canvas.setPointerCapture(event.pointerId);}catch(_error){}
    this.drag={pointerId:event.pointerId,start:point,last:point,node,moved:false};this.canvas.classList.add("dragging");this.clearHold();
    if (this.canEnter(node)) this.holdTimer=window.setTimeout(()=>{ this.holdTimer=null;if(!this.drag||this.drag.moved)return;this.drag=null;this.canvas.classList.remove("dragging");this.enterNode(node); },650);
  }
  pointerMove(event) {
    const point=this.pointer(event);
    if (this.drag) {
      const dx=point.x-this.drag.last.x,dy=point.y-this.drag.last.y;if(Math.hypot(point.x-this.drag.start.x,point.y-this.drag.start.y)>5){this.drag.moved=true;this.clearHold();}
      if(this.drag.node&&!(this.graph?.focusMode&&this.drag.node.id===this.graph.focusNodeId)){
        const scale=displayScale(this.transform.scale);this.drag.node.x+=dx/scale;this.drag.node.y+=dy/scale;
        if(!state.guidePath){this.dragCollisionPending=true;this.scheduleMotion();}
      }else{this.transform.x+=dx;this.transform.y+=dy;}this.drag.last=point;this.draw();return;
    }
    const hit=this.hitNode(point)||this.hitEdge(point);this.hover=hit;
    if(hit){const detail=hit.source?(hit.description||hit.weight_semantics||hit.edge_type||""):(hit.summary||hit.type||"");this.tooltip.innerHTML=`<b>${esc(compact(hit.label||hit.edge_type||"Connection",120))}</b><small>${esc(compact(detail,200))}</small>`;this.tooltip.style.left=`${Math.max(5,Math.min(this.width-275,point.x+13))}px`;this.tooltip.style.top=`${Math.max(5,Math.min(this.height-82,point.y+13))}px`;this.tooltip.hidden=false;}else this.tooltip.hidden=true;this.draw();
  }
  pointerUp(event) {
    if(!this.drag)return;
    this.clearHold();const point=this.pointer(event),moved=this.drag.moved,draggedNode=this.drag.node;this.drag=null;this.canvas.classList.remove("dragging");
    if(!moved){
      const hit=this.hitNode(point)||this.hitEdge(point);this.external=null;
      if(this.studyContext){if(hit?.source){this.selected=hit;inspectStudyEdge(hit);}else if(hit){this.toggleLabel(hit);inspectStudyNode(hit.id);}this.draw();return;}
      if(hit&&!hit.source){this.closeInspector(false);this.toggleLabel(hit);}
      else if(hit?.source){this.selected=hit;this.drawerOpen=true;this.inspectRenderedEdge(hit);}
      else {this.selected=null;this.closeInspector(false);this.compactLayout();}
    }
    if(moved&&draggedNode&&!state.guidePath){
      this.dragCollisionPending=false;this.compactLayout({dragReturn:true});
    }
    this.startOrbit();
    this.syncMapActions();
    this.draw();
  }
  pointerCancel() { const dragReturn=Boolean(this.drag?.moved&&this.drag.node);this.clearHold();this.drag=null;this.dragCollisionPending=false;this.canvas.classList.remove("dragging");this.compactLayout({dragReturn});this.startOrbit(); }
  zoomFloor(){return Math.max(.000001,Math.min(.12,this.fitScale||.12)/16);}
  wheel(event) { event.preventDefault();if(this.studyContext)pauseGuide();const point=this.pointer(event),before=this.world(point),flow=GraphMotion.flow(this.flowElapsedMs),scale=Math.max(this.zoomFloor(),Math.min(3.2,this.transform.scale*Math.exp(-event.deltaY*.0012)));this.transform.scale=scale;this.transform.x=point.x-before.x*scale-flow.x;this.transform.y=point.y-before.y*scale-flow.y;this.compactLayout();this.draw(); }

  toggleLabel(node){
    const shown=this.labelButtons.has(node.id),next=!shown;
    this.selected=node;this.external=null;this.labelOverrides.set(node.id,next);
    this.tooltip.hidden=true;
    $('#map-keyboard-status').textContent=`${node.label}. Selected tag ${next?'shown':'hidden'}. Click again or press Space to toggle. Enter for sources.`;
    if(next){this.reserveLabelSpace();this.revealSelectedTag(node);}
    this.draw();
  }
  revealSelectedTag(node){
    if(this.labelOverrides.get(node.id)===false)return;
    const size=this.mapLabelSize(node);if(!size)return;
    const point=this.screen(node),area=this.usableBounds();
    const box=GraphLabelLayout.lowerHalfBox({point,radius:this.nodeRadius(node),size,bounds:area,required:true});
    if(!box)return;
    const dx=box.x<area.left?area.left-box.x:box.x+box.width>area.right?area.right-box.x-box.width:0;
    const dy=box.y<area.top?area.top-box.y:box.y+box.height>area.bottom?area.bottom-box.y-box.height:0;
    this.transform.x+=dx;this.transform.y+=dy;
  }
  activateNode(node){
    state.activePanelName=this.name;
    clearTimeout(this.labelClickTimer);
    this.closeInspector(false);
    if(this.canEnter(node))return this.enterNode(node);
    if(node.aggregate_kind)return this.openInspector(node);
    return Promise.resolve(this.focusDirectConnections(node)).catch(error=>{this.drawerOpen=true;this.inspectionError(error);});
  }
  openInspector(node){
    state.activePanelName=this.name;
    this.selected=node;this.external=null;this.revealSelectedTag(node);
    for(const panel of Object.values(state.panels))if(panel!==this)panel.closeInspector(false);
    this.drawerOpen=true;this.inspectorReturnFocus=document.activeElement;
    if(this.studyContext){inspectStudyNode(node.id);this.decorateInspector();}
    else if(nodeLevel[node.type])this.inspectHierarchyNode(node);
    else if(node.aggregate_kind){this.selected=node;this.external=null;this.renderInspector();}
    else this.inspectEvidenceNode(node);
    $('[data-close-inspector]',this.inspector)?.focus({preventScroll:true});
    this.syncMapActions();
  }
  closeInspector(restoreFocus=true){this.drawerOpen=false;this.inspector.hidden=true;if(restoreFocus){const target=this.inspectorReturnFocus;if(target?.isConnected)target.focus({preventScroll:true});else this.canvas.focus({preventScroll:true});}}
  syncMapActions(){
    syncPairActions();
    if(this!==activePanel())return;
    const item=this.selected&&!this.selected.source?this.selected:this.neighborhood?.node;
    const context=$('#map-context');if(context){context.textContent=this.neighborhood?'Community':'Neighborhood';context.setAttribute('aria-pressed',String(Boolean(this.neighborhood)));context.disabled=Boolean(this.v64Busy||state.guidePath?.busy||!item||item.aggregate_kind||this.neighborhood&&!item.community_id&&this.level==='evidence');}
    const up=$('#map-up');if(up)up.disabled=Boolean(this.v64Busy||!this.trail.length&&!this.neighborhood);
  }
  keyboard(event){
    state.activePanelName=this.name;
    if(this.v64Busy)return;
    const current=this.selected&&!this.selected.source?this.nodes.findIndex(n=>n.id===this.selected.id):-1;
    if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key)){
      event.preventDefault();const direction=['ArrowRight','ArrowDown'].includes(event.key)?1:-1;
      const node=this.nodes[(current+direction+this.nodes.length)%this.nodes.length];if(!node)return;
      this.selected=node;this.external=null;this.reserveLabelSpace();this.revealSelectedTag(node);this.draw();this.syncMapActions();$('#map-keyboard-status').textContent=`${node.label}. ${node.type}. Enter for sources. Space toggles its tag.`;
    }else if(event.key===' '&&current>=0){event.preventDefault();this.toggleLabel(this.nodes[current]);}
    else if(event.key==='Enter'&&current>=0){event.preventDefault();if(event.shiftKey)this.activateNode(this.nodes[current]);else this.openInspector(this.nodes[current]);}
    else if(['+','=','-'].includes(event.key)){event.preventDefault();const scale=this.transform.scale,factor=event.key==='-'?.85:1.15;this.transform.scale=Math.max(this.zoomFloor(),Math.min(3.2,scale*factor));this.transform.x=this.width/2+(this.transform.x-this.width/2)*this.transform.scale/scale;this.transform.y=this.height/2+(this.transform.y-this.height/2)*this.transform.scale/scale;this.compactLayout();this.draw();}
    else if(event.key==='Escape')this.closeInspector();
  }

  mapLabelNodes(){
    const focus=this.graph?.focusMode?this.nodeMap.get(this.graph.focusNodeId):null;
    const walkIds=new Set(this.savedWalkLabelIds||[]);
    const automatic=focus?this.nodes.filter(node=>node===focus||Math.cos(node.ringHomeAngle)>0&&Math.sin(node.ringHomeAngle)<0):this.nodes;
    const defaults=[...automatic].sort((a,b)=>Number(walkIds.has(b.id))-Number(walkIds.has(a.id))||Number(b===focus)-Number(a===focus)||Number(this.matches.has(b.id)||this.selected===b)-Number(this.matches.has(a.id)||this.selected===a)||Number(b.mass||b.document_count||0)-Number(a.mass||a.document_count||0)||a.id.localeCompare(b.id)).slice(0,5);
    const selectedId=this.selected&&!this.selected.source?this.selected.id:null;
    const ids=GraphMotion.labelIds(defaults.map(node=>node.id),selectedId,[...walkIds].filter(id=>this.nodeMap.has(id)),this.labelOverrides);
    return this.nodes.filter(node=>ids.has(node.id)).sort((a,b)=>Number(b.id===selectedId)-Number(a.id===selectedId)||Number(walkIds.has(b.id))-Number(walkIds.has(a.id))||Number(b===focus)-Number(a===focus)||Number(this.labelOverrides.get(b.id)===true)-Number(this.labelOverrides.get(a.id)===true)||Number(this.matches.has(b.id))-Number(this.matches.has(a.id))||Number(b.mass||0)-Number(a.mass||0));
  }

  mapLabelSize(node){
    const font=Math.round(16*Math.min(1.4,Math.max(1,Math.sqrt(this.transform.scale/this.fitScale)))),area=this.usableBounds(),label=mapDisplayLabel(node),family=getComputedStyle(document.body).fontFamily;
    this.ctx.font=`600 ${font}px ${family}`;
    const widths=this.graph?.focusMode&&node.id===this.graph.focusNodeId?[130,160,Math.min(220,area.width-20)]:[this.width<600?142:176,Math.min(220,area.width-20)];
    for(const width of widths){
      const words=label.split(/\s+/),lines=[];let line='';
      for(const word of words){const next=line?line+' '+word:word;if(line&&this.ctx.measureText(next).width>width){lines.push(line);line=word;}else line=next;}
      if(line)lines.push(line);
      const measured=Math.max(...lines.map(value=>this.ctx.measureText(value).width))+26;
      if(lines.length<=3&&measured<=area.width-8)return {text:lines.join('\n'),font,width:Math.ceil(measured),height:Math.ceil(lines.length*font*1.25+12)};
    }
    if(this.selected?.id===node.id){
      const width=Math.max(60,Math.min(220,area.width-8)),font=14;
      const words=label.split(/\s+/),lines=[];let line='';this.ctx.font=`600 ${font}px ${family}`;
      for(const word of words){if(line&&this.ctx.measureText(line+' '+word).width>width-20){lines.push(line);line=word;}else line=line?line+' '+word:word;}
      if(line)lines.push(line);
      return {text:lines.join('\n'),font,width,height:Math.ceil(lines.length*font*1.25+12)};
    }
    return null;
  }

  reserveLabelSpace(){
    this.compactLayout();
  }

  drawMapLabels(){
    const area=this.usableBounds(),placed=[],visible=new Set();
    const requested=this.mapLabelNodes();
    for(const node of requested){
      const p=this.screen(node),r=this.nodeRadius(node),wrapped=this.mapLabelSize(node);
      if(p.x+r<area.left||p.x-r>area.right||p.y+r<area.top||p.y-r>area.bottom)continue;
      if(!wrapped)continue;
      const required=this.selected?.id===node.id;
      const box=GraphLabelLayout.lowerHalfBox({point:p,radius:r,size:wrapped,bounds:area,placed,required,
        neighbors:this.nodes.filter(other=>other.id!==node.id).map(other=>({...this.screen(other),r:this.nodeRadius(other)}))});
      if(!box)continue;
      let button=this.labelButtons.get(node.id);
      if(!button){
        button=document.createElement('button');button.type='button';button.className='map-label';button.dataset.nodeLabel=node.id;
        button.onclick=event=>{clearTimeout(this.labelClickTimer);if(event.detail>1)return;const open=()=>{const current=this.nodeMap.get(node.id);if(current)this.openInspector(current);};if(event.detail===0)open();else this.labelClickTimer=setTimeout(open,230);};
        button.ondblclick=event=>{event.preventDefault();clearTimeout(this.labelClickTimer);const current=this.nodeMap.get(node.id);if(current)this.activateNode(current);};
        button.onpointerenter=()=>{this.orbitHoverId=node.id;};button.onpointerleave=()=>{this.orbitHoverId=null;};
        this.labelButtons.set(node.id,button);this.labelLayer.append(button);
      }
      if(button.textContent!==wrapped.text)button.textContent=wrapped.text;
      button.title='Open information and sources for '+node.label;button.setAttribute('aria-label',button.title);button.dataset.placement=box.placement;button.dataset.labelText=mapDisplayLabel(node);
      button.dataset.selected=String(required);button.dataset.collision=String(box.collision);
      button.style.setProperty('--label-anchor',Math.max(12,Math.min(box.width-12,p.x-box.x))+'px');
      Object.assign(button.style,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px',fontSize:wrapped.font+'px'});button.classList.toggle('dimmed',Boolean(node.visibility_dimmed));
      placed.push(box);visible.add(node.id);
    }
    for(const [id,button] of this.labelButtons)if(!visible.has(id)){button.remove();this.labelButtons.delete(id);if(this.orbitHoverId===id)this.orbitHoverId=null;}
  }

  setMatchIds(ids) { this.searchMatchIds=new Set(ids);this.matches=new Set([...this.pinnedFocusIds,...this.searchMatchIds].filter((id)=>this.nodeMap.has(id)));if(this.matches.size){const first=this.nodeMap.get(this.matches.values().next().value);this.transform.x=this.width/2-first.x*this.transform.scale;this.transform.y=this.height/2-first.y*this.transform.scale;}this.draw(); }
  setPreviewSearch(query) { const terms=normalize(query).split(/\s+/).filter(Boolean);this.setMatchIds(this.nodes.filter((node)=>terms.length&&terms.every((term)=>normalize(`${node.label} ${node.summary} ${node.id}`).includes(term))).map((node)=>node.id)); }
  showExternalNode(item) { this.selected=null;this.external=item;this.renderInspector();this.draw(); }
  focusNode(id) { const node=this.nodeMap.get(id);if(!node)return;this.external=null;this.selected=node;this.transform.x=this.width/2-node.x*this.transform.scale;this.transform.y=this.height/2-node.y*this.transform.scale;this.renderInspector();this.draw(); }
  inspectEvidenceNode(node) {
    const revision=++this.inspectionRevision;
    if(this.pulseTimer!==null){window.clearTimeout(this.pulseTimer);this.pulseTimer=null;}
    this.external=null;this.selected=node;
    const drawnEdges=this.edges.filter(edge=>edge.source===node.id||edge.target===node.id);
    this.localIncidentNeighborhood=this.neighborhood?.node?.id===node.id?null:this.localIncidentNeighborhood?.node?.id===node.id?this.localIncidentNeighborhood:{node,edges:drawnEdges,neighbors:[...new Set(drawnEdges.flatMap(edge=>[edge.source,edge.target]))].filter(id=>id!==node.id).map(id=>this.nodeMap.get(id)).filter(Boolean),partial_drawn_inventory:true};
    this.pinnedFocusIds.clear();this.searchMatchIds.clear();this.matches.clear();
    this.renderInspector();this.draw();
    if(this.neighborhood?.node?.id===node.id)return;
    ensureNodeNeighborhood(this.view,node.id).then((detail)=>{
      if(revision!==this.inspectionRevision||this.selected?.id!==node.id)return;
      this.localIncidentNeighborhood=detail;this.renderInspector();this.draw();
    }).catch((error)=>{
      if(revision!==this.inspectionRevision||this.selected?.id!==node.id)return;
      this.external={...node,summary:`Direct connections could not be loaded: ${error.message}. ${node.summary||""}`};this.renderInspector();this.draw();
    });
  }
  inspectHierarchyNode(node) {
    if(this.pulseTimer!==null){window.clearTimeout(this.pulseTimer);this.pulseTimer=null;}
    this.external=null;this.selected=node;this.localIncidentNeighborhood=this.hierarchyNeighborhood(node);
    this.pinnedFocusIds.clear();this.searchMatchIds.clear();this.matches.clear();this.renderInspector();this.draw();
  }
  async inspectRenderedEdge(edge) {
    this.external=null;this.selected=edge;this.renderInspector();this.draw();
    if(!edge.compact_induced)return;
    try{
      const detail=await ensureNodeNeighborhood(this.view,edge.source);
      const hydrated=(detail.edges||[]).find((row)=>(row.source===edge.source&&row.target===edge.target)||(row.source===edge.target&&row.target===edge.source));
      if(hydrated){const rendered=this.edges.find((row)=>row===edge||((row.source===hydrated.source&&row.target===hydrated.target)||(row.source===hydrated.target&&row.target===hydrated.source)))||edge;Object.assign(rendered,hydrated,{compact_induced:false});this.selected=rendered;this.renderInspector();this.draw();}
    }catch(error){
      this.selected={...edge,description:`Full provenance could not be loaded: ${error.message}`};this.renderInspector();this.draw();
    }
  }
  inspectEntity(id) {
    const node=this.nodeMap.get(id),neighbor=[this.neighborhood?.node,...(this.neighborhood?.neighbors||[])].find((row)=>row?.id===id),record=node||neighbor||state.searchEvidenceIndexes[this.view.key]?.get(id)||state.searchIndexes[this.view.key]?.get(id);
    if(!record)return;
    if(node&&!record.aggregate_kind){if(nodeLevel[node.type])this.inspectHierarchyNode(node);else this.inspectEvidenceNode(node);return;}
    if(!record.aggregate_kind){this.inspectConnectedNode(id).catch(error=>this.inspectionError(error));return;}
    if(node){this.focusNode(id);return;}
    this.showExternalNode(record);
  }

  inspectionError(error) {
    this.inspector.innerHTML=`<h3>Navigation unavailable</h3><p class="incident-error" role="alert">${esc(error.message)}</p><p>No node, edge or mother Community was substituted.</p>`;
  }

  async inspectConnectedNode(id,{traverse=false,mother=false}={}) {
    const revision=++this.inspectionRevision;
    const known=[this.neighborhood?.node,...(this.neighborhood?.neighbors||[]),this.localIncidentNeighborhood?.node,...(this.localIncidentNeighborhood?.neighbors||[])].find(n=>n?.id===id)
      ||this.nodeMap.get(id)||state.searchEvidenceIndexes[this.view.key]?.get(id)||state.searchIndexes[this.view.key]?.get(id);
    if(!known)throw new Error("This semantic ID is absent from the supplied connection inventory.");
    if(traverse)return this.focusNeighborhood(known);
    if(mother)return this.openLocalCommunity(known);
    const detail=await ensureNodeNeighborhood(this.view,id);
    if(revision!==this.inspectionRevision)return;
    this.localIncidentNeighborhood=detail;
    const rendered=this.nodeMap.get(id);
    this.selected=rendered||null;this.external=rendered?null:detail.node;
    this.renderInspector();this.draw();
  }
  showAssociation(sourceItem,relation) {
    const targetRecord=state.searchIndexes[this.view.key]?.get(relation.other_id);
    const hierarchyPath=(record)=>[record?.domain_label,record?.theme_label,record?.community_label].filter(Boolean).join(" > ");
    this.selected=null;
    this.external={
      id:relation.association_id||"",
      source:sourceItem.id,
      target:relation.other_id,
      source_label:sourceItem.label,
      target_label:relation.other_label||relation.other_id,
      edge_type:"audited related concept",
      weight:Number(relation.weight||0),
      evidence_count:Number(relation.supporting_document_count||0),
      lower_level_edge_count:1,
      supporting_document_ids:relation.supporting_document_ids||[],
      weight_semantics:relation.weight_semantics||relation.derivation||"audited corpus-description association",
      description:`Related concept, not an identity merge. ${compact((relation.evidence_descriptions||[]).map((entry)=>entry.value).join(" / ")||relation.derivation,420)}`,
      source_hierarchy:hierarchyPath(sourceItem),
      target_hierarchy:hierarchyPath(targetRecord),
    };
    this.renderInspector();this.draw();
  }

  drawFocusBands() {
    const ctx=this.ctx,center=this.screen({x:0,y:0});
    [...this.focusBands].reverse().forEach((band)=>{
      const radius=displayRadius(band.outer*displayScale(this.transform.scale));
      ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);
      ctx.arc(center.x,center.y,band.inner*displayScale(this.transform.scale),0,Math.PI*2,true);
      ctx.fillStyle=band.fill;ctx.fill('evenodd');
      ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);
      ctx.strokeStyle=band.stroke;ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.stroke();ctx.setLineDash([]);
    });
  }

  draw() {
    if(!(this.width>0&&this.height>0))this.resize();
    if(!(this.width>0&&this.height>0))return;
    this.transform.scale=displayScale(this.transform.scale);
    const ctx=this.ctx;ctx.clearRect(0,0,this.width,this.height);
    if(!this.nodes.length){const message=compact(this.graph?.contract||"No nodes are available at this level.",220);ctx.font='600 13px Georgia, serif';const words=message.split(/\s+/),lines=[];let line="";words.forEach((word)=>{const candidate=`${line} ${word}`.trim();if(ctx.measureText(candidate).width>Math.min(440,this.width-90)&&line){lines.push(line);line=word;}else line=candidate;});if(line)lines.push(line);ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle="#59696a";lines.forEach((value,index)=>ctx.fillText(value,this.width/2,this.height/2+(index-(lines.length-1)/2)*22));ctx.textAlign="start";return;}
    if(this.graph?.focusMode&&this.focusBands.length)this.drawFocusBands();
    const incidentFocusId=this.neighborhood?.node?.id||null;
    const edgeWeights=this.edges.map((edge)=>Math.max(0,Number(edge.layout_weight||edge.weight||0)));
    const maximumEdgeWeight=Math.max(.000001,...edgeWeights);
    const spokeWeights=this.edges.filter((edge)=>incidentFocusId&&(edge.source===incidentFocusId||edge.target===incidentFocusId)).map((edge)=>Math.max(0,Number(edge.layout_weight||edge.weight||0)));
    const maximumSpokeWeight=Math.max(.000001,...spokeWeights);
    const backgroundEdgeOpacity=this.edges.length>4000?.035:this.edges.length>1200?.055:this.edges.length>400?.09:.15;
    const selectedNodeId=this.selected&&!this.selected.source?this.selected.id:null;
    const selectedAwayFromCenter=Boolean(incidentFocusId&&selectedNodeId&&selectedNodeId!==incidentFocusId);
    this.edges.forEach((edge)=>{
      const a=this.screen(this.nodeMap.get(edge.source)),b=this.screen(this.nodeMap.get(edge.target));
      const centerSpoke=Boolean(this.graph?.focusMode&&incidentFocusId&&(edge.source===incidentFocusId||edge.target===incidentFocusId));
      const selectedIncident=Boolean(selectedNodeId&&(edge.source===selectedNodeId||edge.target===selectedNodeId));
      const explicitlyActive=this.selected===edge||this.hover===edge||this.studyContext?.highlighted_edge_ids.includes(edge.id);
      const relativeStrength=Math.sqrt(Math.max(0,Number(edge.layout_weight||edge.weight||0))/maximumEdgeWeight);
      const spokeRelativeStrength=Math.sqrt(Math.max(0,Number(edge.layout_weight||edge.weight||0))/maximumSpokeWeight);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
      const neutralOpacity=backgroundEdgeOpacity*(.35+.95*relativeStrength);
      const v64Style=guideEdgeVisualV64(this,edge,selectedNodeId);
      if(edge.slot_navigation){ctx.strokeStyle=explicitlyActive?'#806222':'rgba(128,98,34,.62)';ctx.lineWidth=explicitlyActive?2:1.2;
      }else if(v64Style){ctx.strokeStyle=v64Style.color;ctx.lineWidth=v64Style.width;
      }else if(state.guideOverlay&&edge.visibility_dimmed){
        ctx.strokeStyle="rgba(112,128,134,.22)";ctx.lineWidth=.65;
      }else if(edge.investigative_only&&explicitlyActive){
        ctx.strokeStyle="rgba(184,77,54,.82)";
        ctx.lineWidth=2.2;
      }else if(edge.investigative_only){
        const opacity=selectedIncident ? .22+.24*relativeStrength : .12+.16*relativeStrength;
        ctx.strokeStyle=`rgba(184,77,54,${opacity.toFixed(3)})`;
        ctx.lineWidth=.55+1.25*relativeStrength;
      }else if(explicitlyActive){
        ctx.strokeStyle=edge.visibility_dimmed?"rgba(143,56,43,.56)":"#8f382b";
        ctx.lineWidth=2.8;
      }else if(selectedIncident&&state.guideOverlay){
        ctx.strokeStyle=edge.visibility_dimmed?"rgba(112,128,134,.35)":"rgba(159,63,47,.85)";
        ctx.lineWidth=1.8;
      }else if(selectedIncident&&selectedAwayFromCenter){
        ctx.strokeStyle=edge.visibility_dimmed?`rgba(159,63,47,${(.18+.24*relativeStrength).toFixed(3)})`:`rgba(159,63,47,${(.34+.50*relativeStrength).toFixed(3)})`;
        ctx.lineWidth=.8+2.4*relativeStrength;
      }else if(centerSpoke){
        const opacity=selectedAwayFromCenter ? .035+.07*spokeRelativeStrength : .075+.16*spokeRelativeStrength;
        ctx.strokeStyle=edge.visibility_dimmed?`rgba(143,85,73,${Math.max(.06,opacity*.45).toFixed(3)})`:`rgba(159,63,47,${opacity.toFixed(3)})`;
        ctx.lineWidth=(selectedAwayFromCenter ? .3 : .4)+(selectedAwayFromCenter ? .65 : .95)*spokeRelativeStrength;
      }else if(selectedIncident){
        ctx.strokeStyle=edge.visibility_dimmed?`rgba(159,63,47,${(.18+.24*relativeStrength).toFixed(3)})`:`rgba(159,63,47,${(.34+.50*relativeStrength).toFixed(3)})`;
        ctx.lineWidth=.8+2.4*relativeStrength;
      }else{
        ctx.strokeStyle=edge.visibility_dimmed?`rgba(112,128,134,${Math.max(.045,neutralOpacity*.34).toFixed(3)})`:`rgba(69,91,98,${Math.min(.72,neutralOpacity).toFixed(3)})`;
        ctx.lineWidth=edge.visibility_dimmed ? .45 : .35+2.25*relativeStrength;
      }
      if(!state.guidePath&&!edge.slot_navigation&&!edge.investigative_only){
        const incident=selectedIncident&&(!incidentFocusId||selectedAwayFromCenter);
        const density=this.edges.length>1200?.035:this.edges.length>400?.065:this.edges.length>150?.12:.23;
        const opacity=edge.visibility_dimmed?.08:density*(.65+.65*relativeStrength);
        ctx.strokeStyle=explicitlyActive?'rgba(184,77,54,.96)':incident?'rgba(40,121,148,.76)':`rgba(54,75,81,${opacity})`;
        ctx.lineWidth=explicitlyActive?2.7:incident?1.7:edge.visibility_dimmed?.5:.55+1.1*relativeStrength;
      }
      ctx.setLineDash(edge.slot_navigation?[2,5]:this.studyContext?(edge.kind==="NAVIGATION"?[8,6]:edge.kind==="SOURCE_AGGREGATE"?[2,6]:[]):edge.investigative_only?[3,5]:["later_only","redacted_placeholder"].includes(edge.visibility)||edge.contains_redaction_placeholder?[5,4]:[]);ctx.stroke();ctx.setLineDash([]);
    });
    const selectedEdge=this.selected?.source?this.selected:null,hoverEdge=this.hover?.source?this.hover:null;
    this.nodes.forEach((node)=>{
      const point=this.screen(node),match=this.matches.has(node.id),selectedNode=this.selected===node,endpoint=[selectedEdge?.source,selectedEdge?.target,hoverEdge?.source,hoverEdge?.target].includes(node.id),active=selectedNode||this.hover===node||endpoint;
      if(this.priorCenter?.id===node.id&&performance.now()<this.priorCenter.until){ctx.beginPath();ctx.arc(point.x,point.y,this.nodeRadius(node,14,14),0,Math.PI*2);ctx.fillStyle='rgba(164,124,46,.16)';ctx.fill();ctx.strokeStyle='rgba(164,124,46,.75)';ctx.lineWidth=2;ctx.stroke();}
      if(match){ctx.beginPath();ctx.arc(point.x,point.y,this.nodeRadius(node,9,9),0,Math.PI*2);ctx.strokeStyle="#d29b2e";ctx.lineWidth=4;ctx.stroke();}
      if(selectedNode){ctx.beginPath();ctx.arc(point.x,point.y,this.nodeRadius(node,4,4),0,Math.PI*2);ctx.strokeStyle=node.visibility_dimmed?"rgba(159,63,47,.58)":"#9f3f2f";ctx.lineWidth=2.8;ctx.stroke();}
      ctx.beginPath();
      if(node.overlay_slot){const r=this.nodeRadius(node,0,3.5);ctx.moveTo(point.x,point.y-r);ctx.lineTo(point.x+r,point.y);ctx.lineTo(point.x,point.y+r);ctx.lineTo(point.x-r,point.y);ctx.closePath();}
      else ctx.arc(point.x,point.y,this.nodeRadius(node,0,3.5),0,Math.PI*2);
      ctx.globalAlpha=active||!state.neighborhoodMotion||guideReducedMotion()?1:GraphMotion.opacity(this.flowElapsedMs,node.id);
      ctx.fillStyle=node.visibility_dimmed?"rgba(112,128,134,.32)":colors[node.dominant_node_type]||colors[node.type]||colors.Unknown;ctx.fill();ctx.globalAlpha=1;
      ctx.strokeStyle=node.visibility_dimmed?"rgba(112,128,134,.58)":active?"#13242a":"rgba(255,255,255,.78)";ctx.lineWidth=active?3:2*this.nodeStrokeRadius(node);ctx.stroke();
    });
    this.drawMapLabels();
  }

  incidentConnections(item) {
    const detail=this.localIncidentNeighborhood?.node?.id===item.id?this.localIncidentNeighborhood:this.neighborhood?.node?.id===item.id?this.neighborhood:null;
    if(!detail)return "";
    const nodeById=new Map([detail.node,...(detail.neighbors||[])].map((row)=>[row.id,row]));
    const scopeLabels={source_context:"Source-context navigation only (not relationships)",same_community:"Same Community",same_theme:"Same Theme, another Community",same_domain:"Same Domain, another Theme",cross_domain:"Another Domain",outside_hierarchy:"Outside the overview hierarchy"};
    const groups=new Map();
    (detail.edges||[]).forEach((edge)=>{
      const otherId=edge.source===item.id?edge.target:edge.source,other=nodeById.get(otherId);
      const ineligible=eligibilityReasons(edge,{includeRelease:releaseFilterApplies(this.view)}).length>0||eligibilityReasons(other,{includeRelease:releaseFilterApplies(this.view)}).length>0;
      if(!state.showIneligible&&ineligible)return;
      const knownScopes=["same_community","same_theme","same_domain","cross_domain","outside_hierarchy"];
      const inferred=focusScope(this.level,item,other);
      const scope=edge.slot_navigation?"source_context":knownScopes.includes(edge.hierarchy_scope)?edge.hierarchy_scope:knownScopes.includes(inferred)?inferred:"outside_hierarchy";
      if(!groups.has(scope))groups.set(scope,[]);
      groups.get(scope).push(edge);
    });
    const order=["source_context","same_community","same_theme","same_domain","cross_domain","outside_hierarchy"];
    const sections=order.filter((scope)=>groups.has(scope)).map((scope)=>{
      const edges=groups.get(scope),key=`${item.id}:${scope}`,pageSize=8,pages=Math.max(1,Math.ceil(edges.length/pageSize));
      const page=Math.max(0,Math.min(pages-1,this.incidentPages.get(key)||0)),start=page*pageSize,visible=edges.slice(start,start+pageSize);
      this.incidentPages.set(key,page);
      const rows=visible.map((edge)=>{
        const otherId=edge.source===item.id?edge.target:edge.source,other=nodeById.get(otherId)||{label:otherId,type:"Unknown"};
        const channels=Object.keys(edge.channel_counts||{}).join(", ")||edge.edge_type||"connection";
        const ineligible=eligibilityReasons(edge,{includeRelease:releaseFilterApplies(this.view)}).length>0||eligibilityReasons(other,{includeRelease:releaseFilterApplies(this.view)}).length>0;
        const dimmed=this.visibilityPolicy()==="dim"&&ineligible;
        const channelLabel=edge.slot_navigation?'visible-source context / not a factual relationship':esc(channels);
        return `<article class="incident-row${edge.slot_navigation?" context-navigation-row":""}${dimmed?" visibility-dimmed-row":""}" data-incident-row="${esc(edge.id)}"><b>${esc(other.label)}</b><p>${esc(other.type)} / ${channelLabel}${dimmed?" / outside the current display policy":""}</p><div class="incident-row-actions"><button type="button" data-incident-edge="${esc(edge.id)}">${edge.slot_navigation?'Inspect source context':'Inspect relationship'}</button><button type="button" data-connected-node="${esc(otherId)}">Inspect node</button><button type="button" data-traverse-node="${esc(otherId)}">Traverse direct connections</button><button type="button" data-open-mother="${esc(otherId)}">Open node's mother Community</button></div></article>`;
      }).join("");
      const pageButton=(label,target,disabled)=>`<button type="button" data-incident-page="${target}" data-incident-scope="${esc(scope)}" data-incident-owner="${esc(item.id)}" ${disabled?"disabled":""}>${label}</button>`;
      const pager=`<div class="incident-pagination" data-scope="${esc(scope)}"><p role="status">Connections ${start+1}-${start+visible.length} of ${fmt(edges.length)} / page ${page+1} of ${pages}. The canvas node ceiling does not limit this list.</p><div>${pageButton("First",0,page===0)}${pageButton("Previous",page-1,page===0)}${pageButton("Next",page+1,page===pages-1)}${pageButton("Last",pages-1,page===pages-1)}</div></div>`;
      return `<details class="incident-group" open><summary>${esc(scopeLabels[scope])} <b>${fmt(edges.length)}</b></summary>${pager}<div class="incident-list">${rows}</div></details>`;
    }).join("");
    const ego=Boolean(this.neighborhood),isCenter=this.neighborhood?.node?.id===item.id;
    const motherCommunity=detail.node?.community_id?`<button type="button" class="inspector-action secondary" data-open-local-community>Open this node's mother Community</button>`:'<p class="incident-status">No mother Community is recorded for this node in this exploration layout. No membership is invented.</p>';
    const returnHierarchy=ego&&this.level!=="evidence"?`<button type="button" class="inspector-action secondary" data-return-focus-view>Return to ${esc(this.level)} view</button>`:"";
    const recenter=ego&&!isCenter?`<button type="button" class="inspector-action" data-recenter-incident>Recenter direct connections here</button>`:"";
    const switchView=ego?`${motherCommunity}${returnHierarchy}${recenter}`:this.localIncidentNeighborhood?`<button type="button" class="inspector-action secondary" data-open-incident-neighborhood>View all direct connections</button>${item.overlay_slot?motherCommunity:''}`:"";
    const induced=ego&&isCenter?`<button type="button" class="inspector-action tertiary" data-toggle-neighbor-edges ${this.inducedLoading?"disabled":""}>${this.inducedLoading?"Loading published links...":this.showNeighborEdges?"Hide links among neighbors":"Connect displayed neighbors"}</button>`:"";
    const status=this.inducedError?`<p class="incident-error">Neighbor links unavailable: ${esc(this.inducedError)}</p>`:ego&&this.showNeighborEdges&&!this.inducedLoading?`<p class="incident-status">${fmt(this.graph?.neighborEdgeCount||0)} published links among the displayed direct neighbors are rendered in addition to the selected node's spokes.</p>`:"";
    const legend=ego?`<div class="scope-legend"><span class="same-community">Same Community</span><span class="same-theme">Same Theme</span><span class="same-domain">Same Domain</span><span class="cross-domain">Another Domain</span><span class="outside-hierarchy">Outside hierarchy</span></div>`:"";
    const heading=ego?(isCenter?`${item.type||"Node"}-centered connection view`:"Selected neighbor in the centered view"):this.level==="evidence"?"Hierarchy context: mother Community":`${item.type||"Hierarchy"} connections`;
    const explanation=ego?(isCenter?"The center is the selected node. Shaded rings encode increasing hierarchy distance; they do not create or filter edges.":`The graph remains centered on the prior node. Recenter here to make this ${String(item.type||"node").toLowerCase()} the hub${this.level==="evidence"?", or open its mother Community":""}.`):this.level==="evidence"?"The selected node remains in its assigned Community. Only visible local endpoints are drawn here; the complete direct-edge inventory remains grouped below.":"The node remains in the current hierarchy layout. Open its complete direct connections only when you want an ego view.";
    const listed=[...groups.values()].reduce((sum,edges)=>sum+edges.length,0),total=(detail.edges||[]).length;
    const empty=total?'No relationships match the current ineligible-context display controls. The frozen inventory is not empty.':'No published incident edge is recorded for this node. Source provenance is separate from semantic topology.';
    const contextCount=(detail.edges||[]).filter(edge=>edge.slot_navigation).length;
    const counts=`${detail.partial_drawn_inventory?'Loading the complete saved inventory; immediately showing drawn connections only. ':''}${fmt((detail.neighbors||[]).filter(node=>!node.overlay_slot).length)} ordinary graph neighbors and ${fmt(total-contextCount)} published incident relationships.${contextCount?` Separately: ${fmt(contextCount)} source-context navigation links, not factual relationships or corroboration.`:''}`;
    const sc=detail.slot_context;
    const contextPager=sc&&slotOverlayState.enabled?`<div class="slot-pagination"><p data-slot-neighborhood-count>${fmt(sc.total)} Redacted Slots with literal context at this node. Context page ${Math.floor(sc.offset/32)+1}; ${sc.ids.length} fetched, plus any active reciprocal slot. Not published relationships.</p><button data-slot-neighborhood-page="${Math.max(0,sc.offset-32)}" ${sc.offset===0?'disabled':''}>Previous context slots</button><button data-slot-neighborhood-page="${sc.next_offset}" ${sc.next_offset===null?'disabled':''}>Next context slots</button></div>`:'';
    return `<section class="incident-neighborhood"><div class="incident-heading"><p><b>${heading}</b><br>${explanation}<br>${counts} ${fmt(listed)} connections listed across the pages below; ${fmt(total-listed)} hidden by the current display controls.</p><div class="incident-actions">${switchView}${induced}</div></div>${legend}${status}${contextPager}${sections||`<p>${empty}</p>`}</section>`;
  }

  claimTopologyLabels(item, relationType) {
    const detail=this.localIncidentNeighborhood?.node?.id===item.id?this.localIncidentNeighborhood:this.neighborhood?.node?.id===item.id?this.neighborhood:null;
    if(!detail)return [];
    const nodeById=new Map((detail.neighbors||[]).map((row)=>[row.id,row]));
    return [...new Set((detail.edges||[]).filter((edge)=>String(edge.edge_type||"").split(",").some((value)=>value.trim().startsWith(relationType))).map((edge)=>{
      const otherId=edge.source===item.id?edge.target:edge.source;
      return nodeById.get(otherId)?.label||otherId;
    }))];
  }

  async inspectIncidentEdge(edgeId) {
    const detail=this.localIncidentNeighborhood||this.neighborhood;
    const edge=(detail?.edges||[]).find((row)=>row.id===edgeId);
    if(!edge)return false;
    const nodeById=new Map([detail.node,...(detail.neighbors||[])].map((row)=>[row.id,row]));
    const rendered=this.edges.find((row)=>row.id===edgeId||((row.source===edge.source&&row.target===edge.target)||(row.source===edge.target&&row.target===edge.source)));
    this.pinnedFocusIds.clear();this.searchMatchIds.clear();this.matches.clear();
    this.external=rendered?null:{...edge,source_label:nodeById.get(edge.source)?.label||edge.source,target_label:nodeById.get(edge.target)?.label||edge.target};
    this.selected=rendered||null;this.renderInspector();this.draw();
    return true;
  }

  renderInspector() {
    const closeFocused=document.activeElement?.hasAttribute('data-close-inspector');
    const item=this.external||this.selected;
    const itemKey=item?`${this.view?.key||''}:${item.source?'edge':'node'}:${item.id||`${item.source||''}:${item.target||''}`}`:null;
    const sameItem=itemKey!==null&&itemKey===this.inspectorDisclosureItemKey;
    const disclosures=()=>{
      const counts=new Map();
      return $$('details',this.inspector).map(element=>{
        const path=[];
        for(let parent=element;parent&&parent!==this.inspector;parent=parent.parentElement){
          if(parent.tagName!=='DETAILS')continue;
          const summary=$(':scope > summary',parent);
          const label=parent.classList.contains('map-detail-disclosure')?'map-detail-disclosure':parent.id||[...(summary?.childNodes||[])].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim()||summary?.textContent||'details';
          path.unshift(label);
        }
        const pathKey=JSON.stringify(path),occurrence=counts.get(pathKey)||0;counts.set(pathKey,occurrence+1);
        return {element,key:`${pathKey}:${occurrence}`};
      });
    };
    // Async enrichment replaces the DOM, not the user's disclosure choices.
    const saved=sameItem?new Map(disclosures().map(({element,key})=>[key,element.open])):new Map();
    this.renderInspectorContent();this.decorateInspector();this.syncMapActions();
    this.inspectorDisclosureItemKey=itemKey;
    for(const {element,key} of disclosures())if(saved.has(key))element.open=saved.get(key);
    if(closeFocused&&!this.inspector.hidden)$('[data-close-inspector]',this.inspector)?.focus({preventScroll:true});
  }

  decorateInspector(){
    const item=this.external||this.selected;
    this.inspector.hidden=!this.drawerOpen;
    if(!this.drawerOpen||!item)return;
    const close=document.createElement('div');close.className='inspector-close-row';
    close.innerHTML='<span>Information &amp; sources</span><button type="button" data-close-inspector aria-label="Close information">Close</button>';
    close.querySelector('button').onclick=()=>this.closeInspector();
    const description=document.createElement('p');description.className='map-description';description.textContent=mapBriefDescription(item,this);description.dataset.descriptionFor=item.id||'';
    if(item.overlay_slot){
      const provenance=document.createElement('p');provenance.className='slot-readable-provenance';provenance.textContent=`${item.document_id} / ${item.date} / earlier PDF page ${item.source_page}`;
      $('.slot-inspector',this.inspector)?.prepend(provenance);
    }
    const heading=this.inspector.querySelector('.inspector-head')||this.inspector.querySelector('h3');
    const sources=document.createElement('section');sources.className='source-buttons evidence-list map-primary-sources';
    const keys=new Set();
    for(const button of $$('[data-cib-document]',this.inspector)){
      const key=button.dataset.cibDocument+'|'+(button.dataset.cibPage||'');
      if(keys.has(key)){button.remove();continue;}keys.add(key);sources.append(button);
    }
    const technical=document.createElement('details');technical.className='map-technical';technical.innerHTML='<summary>Technical details</summary>';
    if(item.source&&!item.slot_navigation){
      const stats=$('.inspector-stats',this.inspector),metric=stats?.firstElementChild;
      if(metric&&/aggregate edge weight|display priority/.test(metric.textContent)){
        metric.remove();
        const audit=document.createElement('section');audit.dataset.edgeWeightAudit='true';
        const label=item.investigative_only?'Display priority':'Stored graph weight';
        audit.innerHTML=`<p><b>${label}:</b> ${esc(graphWeight(item.weight||0))}</p><p>Summarizes the published graph connection for navigation and line prominence. It is not a support verdict or correctness probability, and it is not recomputed for the selected date.</p>`;
        technical.append(audit);
      }
      if(stats){
        stats.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
        const documents=(item.supporting_document_ids||(item.document_id?[item.document_id]:[])).filter(id=>isDocumentAvailableAsOf(String(id)));
        const count=$('div:first-child b',stats),label=$('div:first-child span',stats);
        if(count)count.textContent=fmt(new Set(documents).size);
        if(label)label.textContent='source documents in view';
      }
      for(const node of $$('.channel-list',this.inspector))technical.append(node);
      for(const node of $$('p',this.inspector))if(/^(Weight|Score) semantics:/.test(node.textContent))technical.append(node);
      for(const node of $$('.bridge-card small',this.inspector))node.textContent=node.textContent.replace(/\s*\u00b7 weight [-+\d.eE]+/,'');
    }
    if(!item.source)for(const metric of $$('.inspector-stats>div',this.inspector)){
      if(/^(hierarchy status|cross-run assignment stability)$/.test($('span',metric)?.textContent||'')){
        metric.classList.add('inspector-stat-audit');technical.append(metric);
      }
    }
    for(const node of $$('.technical-id,.claim-metadata,.identity-audit',this.inspector))technical.append(node);
    for(const paragraph of $$('p',this.inspector))if($('b',paragraph)?.textContent==='Hierarchy identifiers')technical.append(paragraph);
    const detail=document.createElement('section');detail.className='map-detail-content';
    while(this.inspector.firstChild)detail.append(this.inspector.firstChild);
    this.inspector.append(close);if(heading)this.inspector.append(heading);this.inspector.append(description);
    // The existing slot/source actions retain their original listeners and bound IDs.
    for(const action of $$('[data-slot-source],.slot-source-actions',detail))if(detail.contains(action))this.inspector.append(action);
    if(sources.childElementCount){const h=document.createElement('h4');h.textContent='Sources';this.inspector.append(h,sources);}
    this.inspector.append(detail);if(technical.childElementCount>1)this.inspector.append(technical);
    for(const list of $$('.evidence-list,.bridge-list,.association-list',this.inspector)){
      const rows=[...list.children];if(rows.length<=12)continue;
      rows.slice(12).forEach(row=>row.remove());
      const note=document.createElement('p');note.className='list-cap-note';note.textContent=`Showing 12 of ${rows.length} retained entries. Open a source or direct connections for the bounded inventory.`;list.after(note);
    }
    hydrateMapBrief(this,item,description);
    const sourceRecord=[this.localIncidentNeighborhood?.node,this.neighborhood?.node]
      .find(node=>node?.id===item.id);
    hydrateMapSource(this,sourceRecord||item,description);
  }

  renderInspectorContent() {
    if(this.studyContext){renderStudyInspector();return;}
    const selected=this.external||this.selected;
    // Community/search records are compact. The same-view incident record
    // carries exact source quotations without moving the selected node.
    const detail=selected&&!selected.source?[this.localIncidentNeighborhood?.node,this.neighborhood?.node].find((node)=>node?.id===selected.id):null;
    const item=selected?{...detail,...selected,evidence_examples:detail?.evidence_examples??selected.evidence_examples}:null;
    const inspectorItemKey=item?`${item.source?"edge":"node"}:${item.id||`${item.source||""}:${item.target||""}`}`:"empty";
    if(this.inspectorItemKey!==inspectorItemKey){this.inspector.scrollTop=0;this.inspectorItemKey=inspectorItemKey;}
    if(item?.overlay_slot){
      this.inspector.classList.remove('visibility-dimmed');
      this.inspector.innerHTML=opaqueSlotInspectorHTML(this,item);this.bindNodeInspector(item);return;
    }
    if(item?.slot_navigation){
      this.inspector.classList.remove('visibility-dimmed');
      this.inspector.innerHTML=slotContextInspectorHTML(this,item);
      $$('[data-inspect-entity]',this.inspector).forEach(button=>button.onclick=()=>this.inspectEntity(button.dataset.inspectEntity));
      $('[data-context-source]',this.inspector).onclick=()=>openOpaqueSlotSource(opaqueSlot(item.source),item.source_proof);return;
    }
    if(!item){this.inspector.classList.remove("visibility-dimmed");this.inspector.innerHTML=`<div class="inspector-empty"><div><b>Select a node or connection</b><p>Hover previews. Click opens this panel. Double-click or hold a hierarchy node to move inward.</p></div></div>`;return;}
    const itemReasons=item.eligibility_reasons?.length?item.eligibility_reasons:eligibilityReasons(item,{includeRelease:releaseFilterApplies(this.view)});
    const visibilityDimmed=this.visibilityPolicy()==="dim"&&(item.visibility_dimmed||itemReasons.length>0);
    const visibilityHiddenAnchor=Boolean(item.visibility_hidden_anchor);
    const reasonText=itemReasons.length?itemReasons.join("; "):"outside the active evidence policy";
    const visibilityNotice=visibilityHiddenAnchor?`<p class="visibility-dim-notice">This ineligible object is retained only as the current focus anchor so the direct-connections view does not collapse. Hidden neighbors and edges remain excluded.</p>`:visibilityDimmed?`<p class="visibility-dim-notice">Dimmed because this object is outside the active evidence policy: ${esc(reasonText)}. It remains inspectable and keeps its fixed hierarchy assignment.</p>`:"";
    this.inspector.classList.toggle("visibility-dimmed",visibilityDimmed);
    if(item.source){
      const source=this.nodeMap.get(item.source),target=this.nodeMap.get(item.target),sourceLabel=source?.label||item.source_label||item.source,targetLabel=target?.label||item.target_label||item.target,documents=(item.supporting_document_ids||(item.document_id?[item.document_id]:[])).filter((documentId)=>isDocumentAvailableAsOf(String(documentId))),channels=Object.entries(item.channel_counts||{}),bridges=item.representative_bridges||[];
      const channelHtml=channels.length?`<div class="channel-list">${channels.map(([key,value])=>`<span>${esc(key)} ${fmt(value)}</span>`).join("")}</div>`:"";
      const edgeVisibility=laterOnlyShare(item)>0?`<p><b>Release visibility:</b> ${(laterOnlyShare(item)*100).toFixed(1)}% of the aggregated lower-level support is later-only.${isLaterOnly(item)?" This connection does not exist in the earlier projection.":" Earlier-visible support also remains."}</p>`:"";
      const investigativeEdgeNotice=item.investigative_only?`<p class="visibility-dim-notice"><b>Investigative lead, not a graph relation.</b> This dashed red string is generated from earlier-visible adjacent, same-page, same-document, or one-hop context. It suggests where an analyst may search; it is excluded from topology, hierarchy, weights, retrieval scoring, and the final verdict.</p>`:"";
      const redactionEdgeNotice=!item.investigative_only&&(item.visibility==="redacted_placeholder"||item.contains_redaction_placeholder)?`<p class="visibility-dim-notice"><b>Opaque redaction channel.</b> This connection includes one admitted short slot represented as a graph-sized unknown. Any ordinary visible support remains aggregated on the same node pair; the later relation label is deliberately withheld.</p>`:"";
      const hierarchyBridge=item.source_hierarchy||item.target_hierarchy?`<div class="hierarchy-bridge"><div><b>${esc(sourceLabel)}</b><small>${esc(item.source_hierarchy||"Outside the overview core")}</small></div><span>&harr;</span><div><b>${esc(targetLabel)}</b><small>${esc(item.target_hierarchy||"Outside the overview core")}</small></div></div>`:"";
      const bridgeHtml=bridges.length?`<p><b>Representative lower-level bridges</b> (examples, not an exhaustive list)</p><div class="bridge-list">${bridges.map((row)=>{const bridgeDocuments=(row.supporting_document_ids||[]).filter((documentId)=>isDocumentAvailableAsOf(String(documentId)));return `<article class="bridge-card"><b>${esc(row.source_label||row.source_id)} &harr; ${esc(row.target_label||row.target_id)}</b><small>${fmt(row.node_pair_edge_count||1)} constituent node pairs &middot; weight ${Number(row.weight||0).toFixed(3)}${row.channels?.length?` &middot; ${esc(row.channels.join(", "))}`:""}</small>${bridgeDocuments.length?`<div class="bridge-sources">${bridgeDocuments.map((doc)=>`<button type="button" data-cib-document="${esc(doc)}" data-cib-highlight="${esc(`${row.source_label||sourceLabel}||${row.target_label||targetLabel}`)}">${esc(doc)}</button>`).join("")}</div>`:""}</article>`;}).join("")}</div>`:"";
      const scoreLabel=item.investigative_only?"display priority":"aggregate edge weight";
      const technicalId=item.contains_redaction_placeholder||item.edge_type==="REDACTED_RELATION"?"":`<div class="technical-id">${esc(item.id||"")}</div>`;
      this.inspector.innerHTML=`${visibilityNotice}${investigativeEdgeNotice}${redactionEdgeNotice}<div class="inspector-head"><div><p class="eyebrow">${item.investigative_only?"Possible search direction":"Selected connection"}</p><h3>${esc(sourceLabel)} &harr; ${esc(targetLabel)}</h3></div><span class="type-pill">${esc(item.edge_type)}</span></div><div class="edge-endpoints"><button data-inspect-entity="${esc(item.source)}">${esc(sourceLabel)}</button><span>&harr;</span><button data-inspect-entity="${esc(item.target)}">${esc(targetLabel)}</button></div>${hierarchyBridge}<div class="inspector-stats"><div><b>${Number(item.weight||0).toFixed(3)}</b><span>${scoreLabel}</span></div><div><b>${fmt(item.evidence_count||documents.length||1)}</b><span>context documents</span></div><div><b>${fmt(item.lower_level_edge_count||bridges.length||1)}</b><span>${item.investigative_only?"visual lead":"lower-level bridges"}</span></div></div>${item.lead_basis?`<p><b>Why this string exists:</b> ${esc(item.lead_basis.replaceAll("_"," "))}${item.lead_channels?.length?` via ${esc(item.lead_channels.join(", "))}`:""}.</p>`:""}${item.description?`<p>${esc(item.description)}</p>`:""}${edgeVisibility}${channelHtml}${item.evidence_text?`<p>${esc(item.evidence_text)}</p>`:""}${bridgeHtml}${documents.length?`<div class="evidence-list source-buttons">${documents.map((doc)=>`<button type="button" data-cib-document="${esc(doc)}" data-cib-highlight="${esc(`${sourceLabel}||${targetLabel}||${item.evidence_text||""}`)}"><b>${item.investigative_only?"Context document":"Supporting document"}</b><span>${esc(doc)}</span></button>`).join("")}</div>`:""}<p><b>${item.investigative_only?"Score":"Weight"} semantics:</b> ${esc(item.weight_semantics||item.derivation||visibilityLabel(item.visibility)||"explicit relation support")}</p>${technicalId}`;
      $$('[data-inspect-entity]',this.inspector).forEach((button)=>button.addEventListener("click",()=>this.inspectEntity(button.dataset.inspectEntity)));bindCibSourceButtons(this.inspector,this);return;
    }
    if(item.aggregate_kind){
      const typeBreakdown=Object.entries(item.node_type_counts||{}).sort((left,right)=>Number(right[1])-Number(left[1])).map(([key,value])=>`<span>${esc(key)} ${fmt(value)}</span>`).join("");
      const visibilityBreakdown=Object.entries(item.visibility_counts||{}).sort().map(([key,value])=>`<span>${esc(visibilityLabel(key))} ${fmt(value)}</span>`).join("");
      const path=[item.domain_id,item.theme_id,item.community_id].filter(Boolean).map(esc).join("<br>");
      this.inspector.innerHTML=`${visibilityNotice}<div class="inspector-head"><div><p class="eyebrow">Complete evidence aggregate</p><h3>${esc(compact(item.label,180))}</h3></div><span class="type-pill">${esc(item.aggregate_kind.replaceAll("_"," "))}</span></div><div class="inspector-stats"><div><b>${fmt(item.represented_node_count)}</b><span>represented semantic nodes</span></div><div><b>${fmt(item.mention_count)}</b><span>internal or retained links</span></div><div><b>${esc(item.hierarchy_status||"overview")}</b><span>hierarchy status</span></div></div>${item.summary?`<p>${esc(item.summary)}</p>`:""}${typeBreakdown?`<p><b>Node composition</b></p><div class="channel-list">${typeBreakdown}</div>`:""}${visibilityBreakdown?`<p><b>Visibility composition</b></p><div class="channel-list">${visibilityBreakdown}</div>`:""}${path?`<p><b>Hierarchy identifiers</b><br>${path}</p>`:""}<p>This bubble is a complete count-preserving overview aggregate, not one semantic object. Use entity search or enter the corresponding Community from the Community layer for inspectable node-level detail.</p><div class="technical-id">${esc(item.id)}</div>`;
      return;
    }
    const type=item.type||"Entity",hierarchy=item.hierarchy_status||"",hierarchyNode=["Domain","Theme","Community"].includes(type),firstStat=hierarchyNode?fmt(item.mass):fmt(item.document_count),firstLabel=hierarchyNode?"assigned evidence nodes":"source documents",secondStat=type==="Domain"?fmt(item.theme_count):type==="Theme"?fmt(item.community_count):type==="Community"?fmt(item.mention_count):fmt(item.mention_count),secondLabel=type==="Domain"?"member themes":type==="Theme"?"member communities":type==="Community"?"internal evidence links":"mentions",stability=item.partition_stability?.mean_member_jaccard??item.community_assignment_stability??item.theme_assignment_stability??item.domain_assignment_stability,thirdStat=stability===null||stability===undefined?esc(hierarchy||item.domain_id||item.theme_id||item.community_id||"overview"):`${(Number(stability)*100).toFixed(0)}%`,thirdLabel=stability===null||stability===undefined?"hierarchy status":"cross-run assignment stability";
    const visibilityComposition=hierarchyNode&&laterOnlyShare(item)>0?`<p><b>Release composition:</b> ${(laterOnlyShare(item)*100).toFixed(1)}% of assigned semantic nodes are later-only. Dim mutes exact later-only objects while preserving interaction; Hide removes them. A mixed hierarchy container remains because it also contains earlier-visible evidence.</p>`:"";
    const associations=(item.associations||[]).map((row,index)=>`<button type="button" data-association-index="${index}"><b>${esc(row.other_label)}</b> &mdash; related concept, not identity<br>${esc(compact((row.evidence_descriptions||[]).map((entry)=>entry.value).join(" / ")||row.derivation,180))}</button>`).join(""),evidence=(item.evidence_examples||[]).filter((row)=>isDocumentAvailableAsOf(String(row.document_id||""))).map((row)=>`<button type="button" data-cib-document="${esc(row.document_id||"")}" data-cib-page="${esc(row.canonical_page_id||"")}" data-cib-highlight="${esc(`${row.source_label||item.label}||${row.evidence_quote||""}`)}"><b>${esc(row.document_id||"Source evidence")}</b><span>${esc(row.evidence_quote||"")}</span></button>`).join(""),path=item.domain_label||item.theme_label||item.community_label?`<p><b>Hierarchy path</b><br>${esc(item.domain_label||"No domain assignment")}<br>${esc(item.theme_label||"No theme assignment")}<br>${esc(item.community_label||"No community assignment")}</p>`:"",confirmedSpeakers=this.claimTopologyLabels(item,"CLAIM_SPEAKER"),confirmedTargets=this.claimTopologyLabels(item,"CLAIM_TARGET"),claimMetadata=type==="Claim"&&(item.speaker||item.target)?`<div class="claim-metadata"><b>Claim attribution audit</b><span>Model speaker field: ${esc(item.speaker||"not supplied")}</span><span>Accepted CLAIM_SPEAKER edge: ${esc(confirmedSpeakers.join(", ")||"none")}</span><span>Model target field: ${esc(item.target||"not supplied")}</span><span>Accepted CLAIM_TARGET edge: ${esc(confirmedTargets.join(", ")||"none")}</span><span>Stance: ${esc(item.stance||"not supplied")}</span><small>Free-text attributes are model output. Only accepted typed edges enter graph topology. A supplied name with no matching typed edge is unconfirmed and may reflect document-level leakage or coreference error.</small></div>`:"",incidentHtml=this.incidentConnections(item),redactionNodeNotice=type==="RedactionSlot"?`<p class="visibility-dim-notice"><b>Opaque graph object.</b> This stable ID replaces one admitted short redaction. Its hierarchy branch comes from visible adjacent evidence; the later answer is absent. Dashed red strings are investigative leads only and never become semantic edges or scored evidence.</p>`:"";
    const children=item.top_themes||item.top_communities||item.top_nodes||[],childHtml=children.length?`<p><b>Largest retained children</b></p><div class="child-list">${children.slice(0,8).map((row)=>`<div><b>${esc(row.label||row.node_id)}</b><small>${fmt(row.node_count||row.document_count||0)} ${row.node_count?"assigned nodes":"documents"}</small></div>`).join("")}</div>`:"";
    const slotAudit=type!=="RedactionSlot"&&item.introduced_by_slot_ids?.length?`<p><b>Introduced by redaction slot:</b> ${item.introduced_by_slot_ids.map(esc).join(", ")}</p>`:"";
    const technicalId=type==="RedactionSlot"?"":`<div class="technical-id">${esc(item.id)}</div>`;
    this.inspector.innerHTML=`${visibilityNotice}${redactionNodeNotice}<div class="inspector-head"><div><p class="eyebrow">${this.external?"Full-catalog object":"Selected node"}</p><h3>${esc(compact(item.label,180))}</h3></div><span class="type-pill">${esc(type)}${item.visibility?` &middot; ${esc(visibilityLabel(item.visibility))}`:""}</span></div><div class="inspector-stats"><div><b>${firstStat}</b><span>${firstLabel}</span></div><div><b>${secondStat}</b><span>${secondLabel}</span></div><div><b>${thirdStat}</b><span>${thirdLabel}</span></div></div>${this.canEnter(item)?`<button class="inspector-action" data-enter-selected>Open ${esc(nextLevel[this.level])} level</button>`:""}${visibilityComposition}${identityAuditHtml(item)}${item.summary?`<p>${esc(item.summary)}</p>`:""}${item.aliases?.length?`<p><b>Observed surface forms:</b> ${item.aliases.map(esc).join(", ")}</p>`:""}${claimMetadata}${path}${incidentHtml}${childHtml}${associations?`<p><b>Audited related concepts:</b></p><div class="association-list">${associations}</div>`:""}${slotAudit}${evidence?`<div class="evidence-list source-buttons">${evidence}</div>`:""}${technicalId}`;
    this.bindNodeInspector(item);
  }

  bindNodeInspector(item) {
    $('[data-slot-source]',this.inspector)?.addEventListener('click',()=>openOpaqueSlotSource(item));
    $('[data-enter-selected]',this.inspector)?.addEventListener("click",()=>this.enterNode(item));
    $$('[data-association-index]',this.inspector).forEach((button)=>button.addEventListener("click",()=>this.showAssociation(item,(item.associations||[])[Number(button.dataset.associationIndex)])));
    $$('[data-incident-edge]',this.inspector).forEach((button)=>button.addEventListener("click",()=>this.inspectIncidentEdge(button.dataset.incidentEdge)));
    const navigate=action=>Promise.resolve().then(action).catch(error=>this.inspectionError(error));
    $$('[data-slot-neighborhood-page]',this.inspector).forEach(button=>button.onclick=()=>navigate(async()=>{
      button.disabled=true;
      const value=await slotPacket({anchor_id:item.id,offset:button.dataset.slotNeighborhoodPage,limit:32});
      const detail=this.localIncidentNeighborhood?.node.id===item.id?this.localIncidentNeighborhood:this.neighborhood;
      if(!detail||detail.node.id!==item.id)return;
      detail.slot_context={ids:value.slots.map(s=>s.id),total:value.matched_count,offset:value.offset,next_offset:value.next_offset};
      const merged=withSlotContext(detail);
      if(this.localIncidentNeighborhood?.node.id===item.id)this.localIncidentNeighborhood=merged;
      if(this.neighborhood?.node.id===item.id){this.neighborhood=merged;this.refreshGraph(item.id);}else this.renderInspector();
    }));
    $$('[data-incident-page]',this.inspector).forEach(button=>button.addEventListener('click',()=>{this.incidentPages.set(`${button.dataset.incidentOwner}:${button.dataset.incidentScope}`,Number(button.dataset.incidentPage));this.renderInspector();}));
    $$('[data-connected-node]',this.inspector).forEach(button=>button.addEventListener('click',()=>navigate(()=>this.inspectConnectedNode(button.dataset.connectedNode))));
    $$('[data-traverse-node]',this.inspector).forEach(button=>button.addEventListener('click',()=>navigate(()=>this.inspectConnectedNode(button.dataset.traverseNode,{traverse:true}))));
    $$('[data-open-mother]',this.inspector).forEach(button=>button.addEventListener('click',()=>navigate(()=>this.inspectConnectedNode(button.dataset.openMother,{mother:true}))));
    $('[data-open-local-community]',this.inspector)?.addEventListener("click",()=>navigate(()=>this.openLocalCommunity(item)));
    $('[data-return-focus-view]',this.inspector)?.addEventListener("click",()=>this.returnFromNeighborhood());
    $('[data-open-incident-neighborhood]',this.inspector)?.addEventListener("click",()=>navigate(()=>this.focusDirectConnections(item)));
    $('[data-recenter-incident]',this.inspector)?.addEventListener("click",()=>navigate(()=>this.focusDirectConnections(item)));
    $('[data-toggle-neighbor-edges]',this.inspector)?.addEventListener("click",()=>this.toggleNeighborEdges());
    bindCibSourceButtons(this.inspector,this);
    appendHierarchySlots(this,item);
  }
}

function mapBriefDescription(item,panel){
  if(item.overlay_slot)return 'A Redacted Slot with searchable visible source context.';
  if(item.slot_navigation)return 'This link opens visible source context. It is not a factual relationship.';
  if(nodeLevel[item.type]||item.aggregate_kind){
    let labels=[];
    if(!state.guidePath&&panel&&nodeLevel[item.type]){
      const children=item.member_nodes||item.top_nodes||[];
      labels=children.map(child=>panel.nodeMap.get(child.id||child.node_id)||child).filter(child=>child.type==='Entity'&&eligibilityReasons(child,{includeRelease:true}).length===0).map(child=>child.label);
      // At the complete-corpus cutoff, fixed base-projection labels are safe
      // topical names. Earlier cutoffs need individually dated member records.
      if(!labels.length&&state.asOfPolicy.cutoff===state.asOfPolicy.maximum){
        const base=state.data?.views?.[singleCorpusMode?'current_redaction':'current_earlier']?.levels?.[nodeLevel[item.type]];
        const record=[...(base?.catalog_nodes||[]),...(base?.nodes||[])].find(n=>n.id===item.id);
        if(record&&eligibilityReasons(record,{includeRelease:true}).length===0&&laterOnlyShare(record)===0)labels=String(record.label).replace(/^(?:Graph\s+)?(?:domain|theme|community):\s*/i,'').split(/\s*\/\s*/);
      }
    }
    const topics=[...new Set(labels.filter(Boolean).map(label=>String(label).trim()).filter(label=>label.split(/\s+/).length<=7&&!/[;|]/.test(label)&&!/(?:redact|opaque|unknown)/i.test(label)))].slice(0,2);
    if(topics.length)return 'Reports about '+topics.join(' and ')+'.';
    return `This group contains ${fmt(item.mass||item.represented_node_count||0)} graph nodes. Open its members to inspect their sources.`;
  }
  if(eligibilityReasons(item,{includeRelease:true}).length)return 'This object is outside the active evidence policy. Its source details remain separate from eligible evidence.';
  return item.source?'A recorded graph connection. Open its sources to check the supporting text.':'A recorded graph object. Open its sources to check the original wording.';
}

async function hydrateMapBrief(panel,item,element){
  if(item.source||nodeLevel[item.type]||item.aggregate_kind||item.overlay_slot||item.slot_navigation||state.guidePath||eligibilityReasons(item,{includeRelease:true}).length)return;
  const detail=[panel.localIncidentNeighborhood?.node,panel.neighborhood?.node].find(n=>n?.id===item.id);
  const example=(detail?.evidence_examples||item.evidence_examples||[]).find(row=>row.document_id&&row.evidence_quote&&isDocumentAvailableAsOf(String(row.document_id)));
  if(!example)return;
  try{
    const source=await ensureCibSource(panel.view,example.document_id);
    if(!element.isConnected||!panel.drawerOpen||state.guidePath||eligibilityReasons(item,{includeRelease:true}).length||!isDocumentAvailableAsOf(example.document_id,source.document_date_iso||''))return;
    const page=(source.pages||[]).find(p=>(!example.canonical_page_id||p.canonical_page_id===example.canonical_page_id)&&normalize(p.text).includes(normalize(example.evidence_quote)));
    if(!page)return;
    const summary=String(item.summary||'').replace(/\s+/g,' ').trim(),sentence=summary.match(/^[^;|.!?]+[.!?](?:\s|$)/)?.[0]?.trim()||summary;
    if(sentence&&sentence.split(/\s+/).length<20&&!/[;|]/.test(sentence)&&normalize(page.text).includes(normalize(sentence))){element.textContent=sentence;element.dataset.descriptionSource='verified-source-sentence';}
    else{const words=String(example.evidence_quote).replace(/[;|]+/g,',').replace(/\s+/g,' ').trim().split(' ');element.textContent='Source excerpt: '+words.slice(0,16).join(' ')+(words.length>16?'...':'');element.dataset.descriptionSource='verified-source-excerpt';}
    element.title=`${example.document_id} / ${page.canonical_page_id}`;
  }catch(_error){/* Keep the factual fallback when a source cannot be verified. */}
}

function currentViews() {
  const earlyKey=singleCorpusMode?"current_redaction":"current_earlier";
  const currentKey=state.guideProjection==="earlier"&&state.displayMode==="single"?earlyKey:"current_later";
  return {legacy:state.data.views[earlyKey],current:state.data.views[currentKey],keys:{legacy:earlyKey,current:currentKey}};
}

function visiblePanelNames() {
  if(singleCorpusMode)return state.displayMode==="pair"?["legacy","current"]:["current"];
  if(redactionOnlyMode)return ["current"];
  if(!currentOnlyMode||state.displayMode==="pair")return ["legacy","current"];
  return ["current"];
}

function activePanels(){return visiblePanelNames().map(name=>state.panels[name]).filter(Boolean);}
function activePanel(){return state.panels[state.activePanelName]&&visiblePanelNames().includes(state.activePanelName)?state.panels[state.activePanelName]:state.panels.current;}

async function counterpartSearchRecord(panel,row){
  if(row.overlay_slot)return row;
  if(row.kind==='hierarchy'){
    await ensureHierarchyCatalog(panel.view,row.hierarchy_level);
    const base=panel.view.levels[row.hierarchy_level];
    const exact=(base.catalog_nodes||base.nodes||[]).find(node=>node.id===row.id);
    return exact?hierarchySearchRecord(exact,row.hierarchy_level):null;
  }
  await ensureEvidenceSearchCatalog([panel.view.key]);
  const index=state.searchEvidenceIndexes[panel.view.key];
  if(row.kind!=='edge')return index.get(row.id)||null;
  const source=index.get(row.source),target=index.get(row.target);
  if(!source||!target)return null;
  const detail=await ensureNodeNeighborhood(panel.view,source.id);
  const exact=detail.edges.find(edge=>edge.id===row.id||edge.source===source.id&&edge.target===target.id||edge.source===target.id&&edge.target===source.id);
  return exact?{...exact,kind:'edge',label:row.label,source_record:source,target_record:target,source_label:source.label,target_label:target.label}:null;
}

async function navigateSharedSearch(panelName,row,{direct=false}={}){
  const names=state.displayMode==='pair'?visiblePanelNames():[panelName];
  await Promise.all(names.map(async name=>{
    const panel=state.panels[name],record=name===panelName?row:await counterpartSearchRecord(panel,row);
    panel.canvas.dataset.searchTarget=row.id;
    if(!record){
      // A missing object stays missing; only its recorded parent may be opened in the other projection.
      const route=await panel.hierarchyRoute(row.kind==='edge'?row.source_record:row);
      const parent=route.community||route.theme||route.domain;
      if(parent)await panel.navigateToHierarchy(hierarchySearchRecord(parent,nodeLevel[parent.type]));
      panel.canvas.dataset.searchTargetState='absent';
      return;
    }
    await panel.navigateToSearchResult(record);
    if(direct&&record.kind!=='edge'&&record.kind!=='hierarchy')await panel.focusNeighborhood(record);
    panel.canvas.dataset.searchTargetState='present';
  }));
}

async function ensureHierarchyCatalog(view,level) {
  const base=view?.levels?.[level];
  if (level==="evidence") {
    if (!base?.overview_url||base.overview_nodes?.length) return;
    const key=`${view.key}:evidence`;
    if (!state.hierarchyPromises[key]) {
      state.hierarchyPromises[key]=fetch(assetURL(base.overview_url),{cache:"no-store"}).then(async(response)=>{
        if (!response.ok) throw new Error(`${view.key} evidence overview HTTP ${response.status}`);
        const payload=await parseJsonAsset(response,base.overview_url);
        if (payload.schema_version!=="cib-evidence-overview/1.0"||!assetViewMatches(payload,view.key)||payload.level!==level) throw new Error(`Unexpected ${view.key} evidence overview`);
        base.overview_nodes=adaptIdentityRecords(payload.nodes||[],view._identity_authority_mode);base.overview_edges=payload.edges||[];
      });
    }
    await state.hierarchyPromises[key];
    return;
  }
  if (!base?.catalog_url||base.catalog_nodes?.length) return;
  const key=`${view.key}:${level}`;
  if (!state.hierarchyPromises[key]) {
    state.hierarchyPromises[key]=fetch(assetURL(base.catalog_url),{cache:"no-store"}).then(async(response)=>{
      if (!response.ok) throw new Error(`${view.key} ${level} catalog HTTP ${response.status}`);
      const payload=await parseJsonAsset(response,base.catalog_url);
      if (payload.schema_version!=="cib-hierarchy-catalog/2.0"||!assetViewMatches(payload,view.key)||payload.level!==level) throw new Error(`Unexpected ${view.key} ${level} hierarchy catalog`);
      base.catalog_nodes=adaptIdentityRecords(payload.nodes||[],view._identity_authority_mode);base.catalog_edges=payload.edges||[];
    });
  }
  await state.hierarchyPromises[key];
}

async function parseJsonAsset(response,filename) {
  let payload;
  if (!filename.endsWith(".gz")||String(response.headers.get("content-encoding")||"").toLowerCase().includes("gzip")) payload=await response.json();
  else {
    if (!response.body||typeof DecompressionStream==="undefined") throw new Error("This browser cannot open compressed community detail files");
    payload=await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json();
  }
  if(payload.packed_neighborhoods){
    const objects=payload.object_table;
    payload.neighborhoods=Object.fromEntries(Object.entries(payload.packed_neighborhoods).map(([id,row])=>[id,{...row,node:objects[row.node],neighbors:row.neighbors.map((i)=>objects[i]),edges:row.edges.map((i)=>objects[i])}]));
    delete payload.packed_neighborhoods;delete payload.object_table;
  }
  return payload;
}

function assetViewMatches(payload,key){return payload.view_key===key||payload.view_keys?.includes(key);}

async function boundJson(response,expectedSha256) {
  const bytes=await response.arrayBuffer();
  if(expectedSha256){
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    const actual=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
    if(actual!==expectedSha256)throw new Error("Current graph asset checksum differs from its binding");
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function highlightedSourceText(value, terms) {
  return GraphKG.literalMarkup(value,terms);
}

function focalSourceText(value, terms, slotId, revealText="", markerSlotId=slotId) {
  return GraphKG.literalMarkup(value,revealText?[revealText]:terms,{focalSlot:markerSlotId});
}

function sourceMatchScore(page, terms) {
  const text=normalize(page.text),tokens=new Set(text.split(/\s+/).filter(Boolean));
  return (terms||[]).reduce((score,term)=>{
    const normalized=normalize(term);if(!normalized)return score;
    if(text.includes(normalized))return score+1000+normalized.length;
    return score+normalized.split(/\s+/).filter((token)=>token.length>=4&&tokens.has(token)).length*8;
  },0);
}

async function ensureCibSource(view,documentId) {
  const sourceViewKey=view.source_view_key||view.key;
  const catalog=state.data?.source_catalogs?.views?.[sourceViewKey],filename=catalog?.files_by_document?.[documentId];
  if(!filename)throw new Error(`No frozen transcript catalog is available for ${documentId} in ${view.label}.`);
  const key=`${sourceViewKey}:${filename}`;
  if(!state.sourcePromises[key]){
    state.sourcePromises[key]=fetch(assetURL(filename),{cache:"no-store"}).then(async(response)=>{
      if(!response.ok)throw new Error(`Source transcript HTTP ${response.status}`);
      const payload=await parseJsonAsset(response,filename);
      if(!["cib-source-catalog/1.0","matryoshka-source-catalog/1.0"].includes(payload.schema_version)||!assetViewMatches(payload,sourceViewKey))throw new Error("Source shard belongs to another projection");
      state.sourceShards[key]=payload.documents||{};
    }).catch(error=>{delete state.sourcePromises[key];throw error;});
  }
  await state.sourcePromises[key];
  const source=state.sourceShards[key]?.[documentId];
  if(!source)throw new Error("Source document is absent from its frozen transcript shard");
  return source;
}

async function hydrateMapSource(panel,item,renderAnchor) {
  // Compact semantic records can retain a document without excerpt examples.
  // Inspect that recorded document; this does not certify an evidence span.
  const documentId=sourceDocumentId(item?.document_id);
  if(item.source||item.aggregate_kind||panel.studyContext||guideSelection(pageParams)||pageParams.has('walk_case'))return;
  try{
    const {nativeNodeSourceProofs}=await import('./graph-node-source-anchors.js');
    const proofs=(await nativeNodeSourceProofs(item.id,refreshBinding))
      .filter(proof=>isDocumentAvailableAsOf(proof.document_id,proof.date));
    if(!renderAnchor.isConnected||!panel.drawerOpen||(panel.external||panel.selected)?.id!==item.id)return;
    if(proofs.length){
      if(panel.inspector.querySelector('[data-source-action-kind="native-node-source-quotation"]'))return;
      const section=document.createElement('section');section.className='source-buttons evidence-list map-primary-sources';
      for(const proof of proofs.slice(0,12)){
        const button=document.createElement('button');button.type='button';
        button.dataset.cibDocument=proof.document_id;button.dataset.cibPage=proof.canonical_page_id;
        button.dataset.cibHighlight=proof.text;button.dataset.sourceActionKind=proof.proof_kind==='native_source_edge_unit_context'?
          'native-source-connection-context':'native-node-source-quotation';
        if(proof.source_release)button.dataset.sourceRelease=proof.source_release;
        button.graphNodeSourceProof=proof;button.graphNodeSourceId=item.id;
        const heading=document.createElement('b');heading.textContent=proof.proof_kind==='native_source_edge_unit_context'?
          'Inspect connection context / not own-node quotation':proof.source_release==='later'?
          'Inspect later-side node quotation / inspection only':'Inspect recorded node quotation';
        const caption=document.createElement('span');caption.textContent=proof.document_id+' / '+proof.date;
        button.append(heading,caption);section.append(button);
      }
      if(proofs.length>12){const note=document.createElement('p');note.textContent=`Showing 12 of ${proofs.length} retained source records for this node.`;section.append(note);}
      panel.inspector.querySelectorAll('.map-primary-sources').forEach(section=>section.remove());
      renderAnchor.after(section);bindCibSourceButtons(section,panel);return;
    }
    if(!documentId||item.evidence_examples?.length||!isDocumentAvailableAsOf(documentId)||panel.inspector.querySelector('[data-cib-document]'))return;
    const source=await ensureCibSource(panel.view,documentId);
    if(!renderAnchor.isConnected||!panel.drawerOpen
        ||(panel.external||panel.selected)?.id!==item.id
        ||panel.inspector.querySelector('[data-cib-document]')
        ||!isDocumentAvailableAsOf(documentId,String(source.document_date_iso||'')))return;
    const pages=[...(source.pages||[])].filter(page=>page.canonical_page_id&&typeof page.text==='string');
    pages.sort((a,b)=>Number(a.sequence_in_document||0)-Number(b.sequence_in_document||0));
    if(!pages.length)return;
    const page=pages.find(page=>page.canonical_page_id===item.canonical_page_id)||pages[0],section=document.createElement('section');
    section.className='source-buttons evidence-list map-primary-sources';
    const button=document.createElement('button');button.type='button';
    button.dataset.cibDocument=documentId;button.dataset.cibPage=page.canonical_page_id;
    button.dataset.cibHighlight='';
    button.dataset.sourceActionKind='recorded-document-inspection';
    const heading=document.createElement('b');heading.textContent='Inspect recorded document / no own-node quotation';
    const caption=document.createElement('span');caption.textContent=documentId;
    button.append(heading,caption);section.append(button);
    renderAnchor.after(section);bindCibSourceButtons(section,panel);
  }catch(error){
    // Keep the graph usable if its independently bound transcript is unavailable.
    if(renderAnchor.isConnected)renderAnchor.dataset.sourceInspectionUnavailable='true';
  }
}

async function appendGraphPDFPair(host,page,proof={}){
  if(corpusId!=='cib'||!host?.isConnected)return;
  const {appendGraphOriginalPDFs}=await import('./graph-source-reader.js');
  if(!page.source_sha256&&typeof page.text==='string'&&page.canonical_page_id){
    const ascii=JSON.stringify(page.text).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ascii));
    page={...page,source_sha256:[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('')};
  }
  if(!host.isConnected)return;
  const selection=guideSelection(pageParams);
  const section=await appendGraphOriginalPDFs(host,{page,proof,binding:selection?(currentGraphResource()||undefined):undefined,
    caseId:selection?.case_id,config:selection?.config,base:location.href});
  for(const link of section?.querySelectorAll('a')||[]){link.target='_blank';link.rel='noopener';}
}

function clearCibPDFPair(){
  state.pdfPairRequestRevision=(state.pdfPairRequestRevision||0)+1;
  const pair=$('#cib-pdf-pair');if(pair){$$('.graph-original-pdfs',pair).forEach(s=>s.disposeSourcePDFs?.());pair.replaceChildren();pair.hidden=true;}
  $('#cib-source-drawer')?.classList.remove('pdf-pair-open');
  $('[data-cib-pdf-pair]')?.setAttribute('aria-pressed','false');
}

async function openCibPDFPair(panel,documentId,canonicalPageId,revision,{scroll=true}={}){
  const pairRevision=state.pdfPairRequestRevision=(state.pdfPairRequestRevision||0)+1;
  const pair=$('#cib-pdf-pair'),drawer=$('#cib-source-drawer');
  pair.hidden=false;pair.innerHTML='<p role="status">Loading the original release pair...</p>';drawer.classList.add('pdf-pair-open');
  $('[data-cib-pdf-pair]')?.setAttribute('aria-pressed','true');
  const single=$('#cib-pdf-frame');single.hidden=true;single.removeAttribute('src');
  try{
    const source=await ensureCibSource(panel.view,documentId);
    const page=source.pages.find(p=>p.canonical_page_id===canonicalPageId);
    if(!page)throw Error('No exact original PDF page was recorded.');
    if(revision!==state.sourceRequestRevision||pairRevision!==state.pdfPairRequestRevision||pair.hidden)return;
    pair.replaceChildren();
    await appendGraphPDFPair(pair,{...page,document_id:documentId,
      source_page:{release:panel.view.release_view,page:page.source_page}},
      {document_id:documentId,canonical_page_id:canonicalPageId});
    if(scroll&&revision===state.sourceRequestRevision&&pairRevision===state.pdfPairRequestRevision)
      pair.scrollIntoView({block:'start',behavior:guideReducedMotion()?'instant':'smooth'});
  }catch(error){if(revision===state.sourceRequestRevision&&pairRevision===state.pdfPairRequestRevision)pair.innerHTML=`<p role="alert">${esc(error.message)}. No alternate PDF or page is substituted.</p>`;}
}

function closeCibSource() {
  const drawer=$("#cib-source-drawer"),scrim=$("#cib-drawer-scrim");
  if(!drawer)return;
  const wasOpen=drawer.classList.contains('open');drawer.classList.remove("open");drawer.setAttribute("aria-hidden","true");drawer.inert=true;
  clearCibPDFPair();
  if(scrim)scrim.hidden=true;
  const frame=$("#cib-pdf-frame");if(frame){frame.hidden=true;frame.removeAttribute("src");}
  $("#cib-pdf-focus-status")?.remove();
  state.sourceRequestRevision=(state.sourceRequestRevision||0)+1;
  if(wasOpen&&state.sourceReturnFocus?.isConnected)state.sourceReturnFocus.focus({preventScroll:true});
}

async function openCibSource(panel,documentId,{canonicalPageId="",highlights=[],slotId="",revealText="",sourceProof=null,sourceNodeId=""}={}) {
  if(!await allowSavedStorySource(()=>openCibSource(panel,documentId,{canonicalPageId,highlights,slotId,revealText,sourceProof,sourceNodeId})))return;
  const drawer=$("#cib-source-drawer"),scrim=$("#cib-drawer-scrim");
  if(!drawer)return;
  const revision=state.sourceRequestRevision=(state.sourceRequestRevision||0)+1;
  clearCibPDFPair();
  if(!drawer.classList.contains('open'))state.sourceReturnFocus=document.activeElement;
  const previousPdf=$("#cib-pdf-frame");if(previousPdf){previousPdf.hidden=true;previousPdf.removeAttribute("src");}
  $("#cib-pdf-focus-status")?.remove();
  const view=panel.view;
  const release=view.release_view,terms=[...new Set(highlights.filter(Boolean))];
  const markerSlotId=release==="earlier"?(state.redactionProjection?.cases||[]).find(row=>row.slot_id===slotId)?.source_marker_slot_id||slotId:slotId;
  const paired=!singleCorpusMode;
  drawer.inert=false;drawer.classList.add("open");drawer.setAttribute("aria-hidden","false");if(scrim)scrim.hidden=false;$('#cib-source-close').focus({preventScroll:true});
  $("#cib-source-kicker").textContent=singleCorpusMode?"Canonical cable source":`${release==="earlier"?"Earlier release / redacted":"Later release / less redacted"} source`;
  $("#cib-source-title").textContent=documentId;$("#cib-source-meta").innerHTML=`<span>Loading ${paired?"paired transcript":"source record"}...</span>`;$("#cib-source-body").innerHTML="";
  try{
    const source=await ensureCibSource(view,documentId),pages=source.pages||[];
    state.pdfApiAvailable=corpusId==="cib"&&refreshBinding.pdf_available===true;
    if(revision!==state.sourceRequestRevision)return;
    if(!isDocumentAvailableAsOf(documentId,String(source.document_date_iso||"")))throw new Error(`This source is outside the independent explorer's inclusive ${state.asOfPolicy.cutoff} as-of date. No case origin exclusion is applied.`);
    let active=pages.find((page)=>page.canonical_page_id===canonicalPageId);
    if(canonicalPageId&&!active)throw Error('The requested canonical source page is absent. No other passage is substituted.');
    if(!active&&pages.length)active=[...pages].sort((left,right)=>sourceMatchScore(right,terms)-sourceMatchScore(left,terms)||left.sequence_in_document-right.sequence_in_document)[0];
    let exactAnchor=null,sourceAnchorTools=null;
    if(sourceProof){
      sourceAnchorTools=await import('./graph-node-source-anchors.js');
      if(!active)throw Error('The exact node quotation page is unavailable.');
      exactAnchor=await sourceAnchorTools.exactNodeSourceAnchor(sourceProof,{...active,document_id:documentId},{
        nodeId:sourceNodeId,documentId,date:source.document_date_iso||source.date,release});
      if(revision!==state.sourceRequestRevision)return;
    }
    $("#cib-source-title").textContent=source.title?`${source.title} / ${documentId}`:documentId;
    $("#cib-source-meta").innerHTML=[documentId,source.document_date_iso||source.date,`${pages.length} ${paired?"aligned pages":"source segments"}`,active?`${paired?'Original PDF page':'Source segment'} ${active.source_page||active.sequence_in_document}`:'',singleCorpusMode?"Canonical prepared cable transcript":release==="earlier"?"Earlier-release projection":"Later-release projection"].filter(Boolean).map((value)=>`<span>${esc(value)}</span>`).join("");
    $("#cib-source-release-actions").innerHTML=singleCorpusMode?'<span>Canonical prepared cable source; classification projections are not paired redactions.</span>':`<button type="button" class="${release==="earlier"?"active":""}" data-cib-switch-release="current_earlier">Earlier-release transcript</button><button type="button" class="${release==="later"?"active":""}" data-cib-switch-release="current_later">Later-release transcript</button>`;
    if(paired&&state.pdfApiAvailable){
      const button=document.createElement('button');button.type='button';button.dataset.cibPdfPair='';button.textContent='Pair PDFs';button.setAttribute('aria-pressed','false');
      button.onclick=()=>{if(!$('#cib-pdf-pair').hidden){clearCibPDFPair();return;}openCibPDFPair(panel,documentId,active?.canonical_page_id||canonicalPageId,revision);};
      $('#cib-source-release-actions').append(button);
    }
    const pdfNote=sourceProof?(sourceProof.proof_kind==='native_source_edge_unit_context'?
      'Exact native connection-unit context, not a quotation establishing this node\'s own assertion. No identity, factual support or eligibility vote is added.':
      'Exact retained native node quotation. This is source inspection, not certification of the generated summary or a new eligibility or factual-support vote.'):
      state.pdfApiAvailable?"The frozen transcript supplies the release and PDF page. No PDF box coordinates are guessed; highlighted terms are text matches, not exact-offset entailment proofs.":"This frozen source transcript is available. Highlighted terms are text matches, not exact-offset entailment proofs; no PDF box coordinates are guessed.";
    const noPages='<section class="cib-source-page"><p>No canonical aligned transcript page is retained for this pair. No PDF page is inferred.</p></section>';
    const exactMarkup=exactAnchor?(await import('./graph-source-reader.js')).exactContextMarkup(active.text,exactAnchor,esc):null;
    const renderPage=page=>`<section class="cib-source-page ${page===active?'active':''}" data-cib-page="${esc(page.canonical_page_id)}"><header><b>${paired?'Original PDF page '+esc(page.source_page):'Source segment '+fmt(page.sequence_in_document)}</b><span>Transcript segment ${fmt(page.sequence_in_document)}</span></header><div>${page===active&&exactMarkup!==null?exactMarkup:slotId?focalSourceText(page.text,terms,slotId,revealText,markerSlotId):highlightedSourceText(page.text,terms)}</div>${paired&&Number.isInteger(page.source_page)&&page.source_page>0?`<button type="button" class="cib-pdf-button" data-cib-pdf-page="${page.source_page}" ${state.pdfApiAvailable?'':'disabled'}>View both original PDFs at this passage</button>`:''}</section>`;
    const remaining=pages.filter(page=>page!==active);
    $("#cib-source-body").innerHTML=`<p class="cib-pdf-note">${esc(pdfNote)}${markerSlotId!==slotId?' This target shares an earlier masked region with another slot; the region is highlighted without inventing an internal boundary.':''}</p>`+(active?renderPage(active):noPages);
    if(remaining.length){
      const details=document.createElement('details');details.className='graph-source-other-pages';
      details.innerHTML='<summary>Other source segments in original order ('+remaining.length+')</summary>'+remaining.map(renderPage).join('');
      $('#cib-source-body').append(details);
    }
    $$('[data-cib-switch-release]',drawer).forEach((button)=>button.addEventListener("click",()=>openCibSource({...panel,view:state.data.views[button.dataset.cibSwitchRelease]},documentId,{canonicalPageId:active?.canonical_page_id||canonicalPageId,highlights:terms,slotId,revealText,sourceProof,sourceNodeId})));
    $$('[data-cib-pdf-page]',drawer).forEach((button)=>button.addEventListener("click",async()=>{
      active=pages.find(page=>page.canonical_page_id===button.closest('.cib-source-page')?.dataset.cibPage)||active;
      if(revision===state.sourceRequestRevision)await openCibPDFPair(panel,documentId,button.closest('.cib-source-page')?.dataset.cibPage||'',revision);
    }));
    if(active){
      const activeSection=$$('.cib-source-page',drawer).find(section=>section.dataset.cibPage===active.canonical_page_id);
      (activeSection?.querySelector('mark')||activeSection)?.scrollIntoView({block:'center',behavior:'instant'});
    }
    if(paired&&state.pdfApiAvailable&&active)await openCibPDFPair(panel,documentId,active.canonical_page_id,revision,{scroll:false});
  }catch(error){if(revision===state.sourceRequestRevision)$("#cib-source-body").innerHTML=`<p>${esc(error.message)}</p>`;}
}

function bindCibSourceButtons(root,panel) {
  $$('[data-cib-document]',root).forEach((button)=>button.addEventListener("click",()=>{
    const selected=panel.external||panel.selected;
    const focal=redactionCaseForRecord(selected||{});
    const sourceView=button.dataset.sourceRelease?state.data.views['current_'+button.dataset.sourceRelease]:null;
    openCibSource(sourceView?{...panel,view:sourceView}:panel,button.dataset.cibDocument,{canonicalPageId:button.dataset.cibPage||focal?.canonical_page_id||"",highlights:String(button.dataset.cibHighlight||"").split("||").filter(Boolean),slotId:focal?.document_id===button.dataset.cibDocument?focal.slot_id:"",sourceProof:button.graphNodeSourceProof||null,sourceNodeId:button.graphNodeSourceId||""});
  }));
}

async function ensureCommunityDetail(view,node) {
  const base=view?.levels?.evidence;
  const filename=base?.community_detail_files?.[node.id];
  if (!filename) throw new Error(`No complete member catalog is available for ${node.id}`);
  const key=`${view.key}:${filename}`;
  if (!state.communityDetailPromises[key]) {
    state.communityDetailPromises[key]=fetch(assetURL(filename),{cache:"no-store"}).then(async(response)=>{
      if (!response.ok) throw new Error(`${view.key} community detail HTTP ${response.status}`);
      const payload=await parseJsonAsset(response,filename);
      const mode=identityAuthorityMode(payload.schema_version,'community',view._identity_authority_mode||state.data?._identity_authority_mode);
      if (!assetViewMatches(payload,view.key)) throw new Error(`Unexpected ${view.key} community detail shard`);
      Object.values(payload.communities||{}).forEach(detail=>adaptIdentityRecords(detail.nodes,mode));
      recordLegacyAuthoritySchema(payload.schema_version,mode);
      state.communityDetailShards[key]=payload.communities||{};
    });
  }
  await state.communityDetailPromises[key];
  const detail=state.communityDetailShards[key]?.[node.id];
  if (!detail) throw new Error(`Community ${node.id} is absent from ${filename}`);
  node.member_nodes=detail.nodes||[];
  node.member_edges=detail.edges||[];
  node.detail_edge_node_rank_limit=Number(detail.edge_node_rank_limit||0);
  node.complete_edges_for_ranked_nodes=Boolean(detail.complete_edges_for_ranked_nodes);
  node.community_detail_loaded=true;
  if(slotOverlayState.enabled&&!state.guidePath&&slotOverlayState.payload?.coverage.complete){
    await slotPacket({community_id:node.id,limit:32});
  }
}

async function ensureNodeNeighborhood(view,nodeId) {
  let slot=opaqueSlot(nodeId);
  if(!slot&&nodeId.startsWith('opaque_slot_')&&slotOverlayState.enabled&&!state.guidePath){
    await ensureSlotCensus();slot=(await slotPacket({slot_id:nodeId})).slot;
  }
  if(slot)return withSlotContext({node:slot,neighbors:[],edges:[],level:"evidence"});
  const published=await ensurePublishedNodeNeighborhood(view,nodeId);
  if(!slotOverlayState.enabled||state.guidePath||!slotOverlayState.payload?.coverage.complete)return published;
  const context=await slotPacket({anchor_id:nodeId,limit:32});
  return withSlotContext({...published,slot_context:{ids:context.slots.map(s=>s.id),total:context.matched_count,offset:0,next_offset:context.next_offset}});
}

async function ensurePublishedNodeNeighborhood(view,nodeId) {
  const catalog=view?.levels?.evidence?.neighborhood_catalog;
  if(!catalog)throw new Error(`No incident-edge catalog is available for ${view?.key||"this view"}`);
  const shard=hashNumber(nodeId)%Number(catalog.shard_count||1);
  const token=String(shard).padStart(2,"0");
  const filename=catalog.files_by_shard?.[token]||String(catalog.filename_pattern||"").replace("{shard}",token);
  if(!filename)throw new Error(`No neighborhood filename is configured for ${nodeId}`);
  const key=`${view.key}:${filename}`;
  if(!state.neighborhoodPromises[key]){
    state.neighborhoodPromises[key]=fetch(assetURL(filename),{cache:"no-store"}).then(async(response)=>{
      if(!response.ok)throw new Error(`${view.key} neighborhood HTTP ${response.status}`);
      const payload=await parseJsonAsset(response,filename);
      const mode=identityAuthorityMode(payload.schema_version,'neighborhood',view._identity_authority_mode||state.data?._identity_authority_mode);
      if(!assetViewMatches(payload,view.key))throw new Error(`Unexpected ${view.key} neighborhood shard`);
      Object.values(payload.neighborhoods||{}).forEach(detail=>{adaptIdentityRecord(detail.node,mode);adaptIdentityRecords(detail.neighbors,mode);});
      recordLegacyAuthoritySchema(payload.schema_version,mode);
      state.neighborhoodShards[key]=payload.neighborhoods||{};
    });
  }
  await state.neighborhoodPromises[key];
  const detail=state.neighborhoodShards[key]?.[nodeId];
  if(!detail){const error=new Error(`Node ${nodeId} is absent from ${filename}`);error.missingExactNode=true;throw error;}
  for(const node of [detail.node,...(detail.neighbors||[])])for(const [records,indexes] of [
    [state.searchEvidenceViews,state.searchEvidenceIndexes],[state.searchViews,state.searchIndexes]]){
    const record=indexes[view.key]?.get(node.id);
    if(!record)continue;
    const fields=kgSearch.additionalObservedFields(record,node);
    if(fields){Object.assign(record,fields);relatedIndexes.delete(records[view.key]);}
  }
  return detail;
}

async function ensureCompactAdjacency(view,nodeId) {
  const catalog=view?.levels?.evidence?.neighborhood_catalog?.compact_adjacency;
  if(!catalog)throw new Error(`No compact adjacency catalog is available for ${view?.key||"this view"}`);
  const shard=hashNumber(nodeId)%Number(catalog.shard_count||1);
  const token=String(shard).padStart(2,"0");
  const filename=catalog.files_by_shard?.[token]||String(catalog.filename_pattern||"").replace("{shard}",token);
  if(!filename)throw new Error(`No compact adjacency filename is configured for ${nodeId}`);
  const key=`${view.key}:${filename}`;
  if(!state.adjacencyPromises[key]){
    state.adjacencyPromises[key]=fetch(assetURL(filename),{cache:"no-store"}).then(async(response)=>{
      if(!response.ok)throw new Error(`${view.key} compact adjacency HTTP ${response.status}`);
      const payload=await parseJsonAsset(response,filename);
      if(payload.schema_version!=="cib-compact-adjacency/1.2"||!assetViewMatches(payload,view.key))throw new Error(`Unexpected ${view.key} compact adjacency shard`);
      state.adjacencyShards[key]=payload.adjacency||{};
    });
  }
  await state.adjacencyPromises[key];
  return state.adjacencyShards[key]?.[nodeId]||[];
}

async function ensureInducedEdges(view,nodeIds) {
  const ids=[...new Set(nodeIds.filter(Boolean))],selected=new Set(ids);
  const rows=await Promise.all(ids.filter(id=>!opaqueSlot(id)).map(async(id)=>[id,await ensureCompactAdjacency(view,id)]));
  const edges=new Map();
  rows.forEach(([source,neighbors])=>{
    (neighbors||[]).forEach(([target,weight,visibility,minimumDocumentDate])=>{
      if(!selected.has(target)||source===target)return;
      const [left,right]=source<target?[source,target]:[target,source],pair=`${left}\u241f${right}`;
      if(edges.has(pair))return;
      edges.set(pair,{id:`induced:${pair}`,source:left,target:right,weight:Number(weight||0),layout_weight:Number(weight||0),visibility:visibility||"both",minimum_document_date:minimumDocumentDate||"",edge_type:"published neighbor-to-neighbor link",weight_semantics:"Published graph edge loaded from the compact adjacency index; select it to hydrate complete channels and provenance.",compact_induced:true});
    });
  });
  const contexts=slotContextEdges().filter(edge=>selected.has(edge.source)&&selected.has(edge.target));
  return [...edges.values(),...contexts].sort((left,right)=>Number(right.layout_weight)-Number(left.layout_weight)||left.id.localeCompare(right.id));
}

function renderPanelCaption(panel) {
  const graph=panel.graph;
  if (!graph) return;
  const slots=panel.nodes.filter(row=>row.overlay_slot),contextLinks=panel.edges.filter(row=>row.slot_navigation);
  if(slots.length){$(`#${panel.name}-caption`).textContent=`${graph.focusMode?'Direct connections: ':''}${fmt(panel.nodes.length-slots.length)} ordinary graph objects and ${fmt(panel.edges.length-contextLinks.length)} published graph edges drawn, plus ${slots.length} Redacted Slots and ${contextLinks.length} dotted source-context links (not factual relationships). ${graph.focusMode?`${fmt(graph.directEdgeCount)} published selected-node relationships; ${fmt(graph.contextDirectEdgeCount)} separate context links. `:''}Slot size is fixed, not concealed-text length. Native graph totals, weights and memberships are unchanged.`;return;}
  const context=panel.trail.length?` within ${panel.trail[panel.trail.length-1].label}`:" in the corpus view";
  const setCaption=(value)=>{
    const policy=state.guideOverlay
      ? ` Case source context: ${guideScopeCaption(state.guideOverlay.scope)}. Full KG topology and aggregate weights remain unchanged; gray edges are unassessed.`
      : state.asOfPolicy.enabled
      ? ` Independent inclusive as-of orientation: objects with no admissible support by ${state.asOfPolicy.cutoff}, or only undated support, are ineligible for this date. ${fmt(graph.policyExcludedNodeCount)} loaded nodes and ${fmt(graph.policyExcludedEdgeCount)} loaded edges are ${state.showIneligible?visibilityModeLabels[state.visibilityMode]:"hidden"}; the hierarchy and level do not change. Stored weights are orientation metadata, not date-recomputed evidence weights or a workbench verdict.`
      : "";
    $(`#${panel.name}-caption`).textContent=`${value}${policy}`;
  };
  if (graph.focusMode) {
    const ceiling=graph.availableNodeCount>panel.nodes.length?` Marginal coverage selects ${fmt(panel.nodes.length)} of ${fmt(graph.availableNodeCount)} loaded endpoints at this ceiling; the incident inventory remains separately inspectable.`:" The selected ceiling includes every directly connected endpoint.";
    const induced=graph.showNeighborEdges?` ${fmt(graph.neighborEdgeCount)} published links among the displayed neighbors are also shown.`:" Neighbor-to-neighbor links are off.";
    const returnNote=panel.level==="evidence"?"Open the selected node's mother Community to restore its hierarchy branch.":`Return to the ${panel.level} view to restore the prior layout.`;
    setCaption(`${fmt(panel.nodes.length)} of ${fmt(graph.availableNodeCount)} direct-neighborhood nodes / ${fmt(graph.shownDirectEdgeCount)} of ${fmt(graph.directEdgeCount)} complete selected-node edges shown.${induced}${ceiling} ${returnNote}`);
    return;
  }
  if (graph.overviewMode) {
    setCaption(`${fmt(graph.shownRepresentedNodeCount)} of ${fmt(graph.representedNodeCount)} evidence nodes represented in ${fmt(panel.nodes.length)} of ${fmt(graph.overviewGroupCount)} aggregate groups / ${fmt(panel.edges.length)} shown links; ${fmt(graph.overviewAggregateEdgeCount)} published aggregate links summarize ${fmt(graph.fullGraphEdgeCount)} underlying graph edges${context}`);
    return;
  }
  if (graph.communityDetail) {
    const complete=graph.completeEdgesForRankedNodes&&graph.omittedEdgeCount===0?" Every published edge with both endpoints displayed is rendered.":` ${fmt(graph.omittedEdgeCount)} induced edges are not rendered.`;
    const hidden=graph.availableNodeCount>panel.nodes.length?` Edges touching the other ${fmt(graph.availableNodeCount-panel.nodes.length)} Community members are outside this drawing; selecting a node still lists its complete incident neighborhood.`:"";
    const isolates=graph.displayedIsolateCount?` ${fmt(graph.displayedIsolateCount)} displayed nodes have no edge to another displayed node; ${fmt(graph.hiddenLinkedDisplayedCount)} of them connect to hidden members in the loaded Community topology. Every assigned Community member belongs to the connected analyst core, so the remainder connect outside this Community or beyond this drawing; View all direct connections reveals those edges.`:"";
    const incidentNote=graph.localIncidentFocus?" The selected node stays in place; its incident edges use restrained strength-scaled emphasis.":"";
    setCaption(`${fmt(panel.nodes.length)} of ${fmt(graph.assignedNodeCount)} assigned evidence nodes / ${fmt(panel.edges.length)} published node-pair edges among the displayed nodes${context}.${complete}${hidden}${isolates}${incidentNote}`);
    return;
  }
  if (graph.corpusWide) {
    const isolates=graph.displayedIsolateCount?` ${fmt(graph.displayedIsolateCount)} displayed nodes have no displayed endpoint; ${fmt(graph.hiddenLinkedDisplayedCount)} connect only to nodes outside this ceiling.`:"";
    setCaption(`${fmt(panel.nodes.length)} of ${fmt(graph.availableNodeCount)} published ${panel.level} nodes / all ${fmt(panel.edges.length)} aggregate edges induced by those nodes are shown; ${fmt(graph.scopedEdgeCount)} published aggregate edges exist${context}.${isolates}`);
    return;
  }
  const nodesTruncated=panel.nodes.length<graph.availableNodeCount;
  const edgeDenominator=nodesTruncated
    ? `${fmt(graph.availableEdgeCount)} edges induced by the shown nodes; ${fmt(graph.scopedEdgeCount)} in the complete scoped layer`
    : `${fmt(graph.availableEdgeCount)} induced edges`;
  setCaption(`${fmt(panel.nodes.length)} of ${fmt(graph.availableNodeCount)} available ${panel.level} nodes / ${fmt(panel.edges.length)} shown of ${edgeDenominator}${context}`);
}

function metricValue(view, key) {
  const metrics=view.metrics, nodeTypes=metrics.node_type_counts||{};
  const analystConnected=metrics.analyst_connected_node_count ?? metrics.connected_node_count;
  const analystComponents=metrics.analyst_component_count ?? metrics.connected_component_count;
  const analystSingletons=metrics.analyst_singleton_node_count ?? metrics.singleton_node_count;
  const analystLargest=metrics.analyst_largest_component_share ?? metrics.largest_component_share;
  const isolateShare=Number(metrics.semantic_nodes||0)?100*Number(metrics.singleton_node_count||0)/Number(metrics.semantic_nodes):0;
  const analystIsolateShare=Number(metrics.semantic_nodes||0)?100*Number(analystSingletons||0)/Number(metrics.semantic_nodes):0;
  const values={documents:metrics.documents,entities:nodeTypes.Entity,events:nodeTypes.Event,claims:nodeTypes.Claim,nodes:metrics.semantic_nodes,explicitConnected:metrics.connected_node_count,explicitComponents:`${fmt(metrics.connected_component_count)} total / ${fmt(metrics.singleton_node_count)} isolate nodes (${isolateShare.toFixed(1)}%)`,analystConnected,analystComponents:`${fmt(analystComponents)} total / ${fmt(analystSingletons)} isolate nodes (${analystIsolateShare.toFixed(1)}%)`,analystLargest:`${(Number(analystLargest||0)*100).toFixed(1)}%`,explicit:view.family==="legacy"?metrics.explicit_or_materialized_edges:metrics.explicit_semantic_edges,context:view.family==="legacy"?metrics.same_segment_context_edges:0,grounded:view.family==="legacy"?null:metrics.grounded_coevidence_edges,provenance:view.family==="legacy"?null:metrics.provenance_edges,slots:view.family==="legacy"?null:metrics.redaction_slots,hierarchy:`${fmt(metrics.domains)} / ${fmt(metrics.themes)} / ${fmt(metrics.communities)}`};
  return values[key];
}

function renderMetrics(legacy,current) {
  if(!$("#metric-grid"))return;
  const rows=currentOnlyMode?
    [["documents","Paired documents","Both projections use the same 3,009-document paired corpus."],["entities","Entity nodes","Resolved identities visible in each release projection."],["events","Event nodes","Source-scoped events visible in each projection."],["claims","Claim nodes","Source-scoped claims visible in each projection."],["nodes","Semantic nodes","Entity + Event + Claim; provenance objects remain separate."],["explicitConnected","Explicit-topology connected nodes","Nodes joined by accepted typed semantic relations."],["explicitComponents","Explicit components / isolate nodes","An explicit isolate can still retain page and document provenance."],["analystConnected","Analyst-projection connected nodes","Adds only audited associations and tightly overlapping grounded evidence."],["analystComponents","Analyst components / isolate nodes","True full-projection isolates, independent of any drawing ceiling."],["analystLargest","Largest-component share","Share of semantic nodes available to the nested overview hierarchy."],["explicit","Explicit semantic edges","Accepted typed relation topology."],["grounded","Grounded co-evidence edges","Accepted objects linked only when grounded source spans substantially overlap."],["provenance","Separate provenance edges","Queryable source lineage excluded from semantic topology."],["slots","First-class RedactionSlot nodes","Reveal boundaries preserved outside the semantic node count."],["hierarchy","Domains / themes / communities","Strictly nested navigation over the largest connected analyst component."]]:
    [["documents","Documents","Legacy and current denominators differ."],["entities","Entity nodes","After each pipeline's own alias resolution."],["events","Event nodes","Source-scoped in the current contract."],["claims","Claim nodes","Source-scoped in the current contract."],["nodes","Semantic / retrieval nodes","Legacy includes Segment, Document, and RelationEvidence nodes; current semantic count is Entity + Event + Claim."],["explicitConnected","Explicit-topology connected nodes","Current count uses accepted typed relations only."],["explicitComponents","Explicit total components / isolate nodes","An isolate here is still linked to its passage and document in the provenance graph."],["analystConnected","Analyst-projection connected nodes","Current adds only audited associations and 80%-overlapping grounded evidence."],["analystComponents","Analyst total components / isolate nodes","The percentage is isolate nodes divided by all semantic nodes; it is not the share of components."],["analystLargest","Analyst largest-component share","Share of all semantic nodes available to the corpus overview hierarchy."],["explicit","Explicit edge materialization","Legacy and current edge contracts are not one-to-one."],["context","Whole-segment context edges","Legacy broad co-context heuristic; absent from the current projection."],["grounded","Grounded co-evidence edges","Current links accepted objects only when their source spans substantially overlap."],["provenance","Separate provenance edges","Current provenance is queryable but excluded from semantic topology."],["slots","First-class RedactionSlot nodes","Current graph keeps redaction boundaries and reveal provenance."],["hierarchy","Domains / themes / communities","Current hierarchy is strictly nested and reports cross-run assignment stability."]];
  const display=(value)=>value===null||value===undefined?"Not separate":typeof value==="number"?fmt(value):esc(value);
  $("#metric-grid").innerHTML=`<div class="metric-cell header"><b>Full-artifact measure</b><span>Definitions shown row by row</span></div><div class="metric-cell header"><b>${esc(legacy.label)}</b><span>${esc(legacy.metrics.model)}</span></div><div class="metric-cell header current"><b>${esc(current.label)}</b><span>${esc(current.metrics.model)}</span></div>`+rows.map(([key,label,note])=>`<div class="metric-cell label">${esc(label)}<span>${esc(note)}</span></div><div class="metric-cell"><b>${display(metricValue(legacy,key))}</b></div><div class="metric-cell"><b>${display(metricValue(current,key))}</b></div>`).join("");
}

async function renderRelease() {
  const revision=++state.renderRevision;
  const {legacy,current}=currentViews();
  await Promise.all([ensureHierarchyCatalog(legacy,state.level),ensureHierarchyCatalog(current,state.level)]);
  if (revision!==state.renderRevision) return;
  $("#pair-title").textContent=singleCorpusMode?(state.displayMode==="pair"?"Confidential and expanded Secret projections":"Fixed Confidential hierarchy with optional Secret evidence"):(state.displayMode==="pair"?"Earlier and later release projections":"Earlier-release hierarchy with optional later evidence");
  $("#legacy-title").textContent=singleCorpusMode?"Confidential projection":"Earlier release";
  $("#current-title").textContent=singleCorpusMode?(state.displayMode==="pair"?"Confidential + Secret projection":"Independent corpus graph"):(state.displayMode==="pair"?"Later release":"CIB graph");
  if(currentOnlyMode){
    $$('[data-panel]').forEach((card)=>{card.hidden=!visiblePanelNames().includes(card.dataset.panel);});
    $(".graph-grid")?.classList.toggle("single-panel",visiblePanelNames().length===1);
    $(".reveal-control")?.removeAttribute("hidden");
  }
  state.panels.legacy.setGraph(legacy); state.panels.current.setGraph(current); renderMetrics(legacy,current); applySearch();
}

async function ensureSearchCatalog(keys) {
  if (!state.searchManifest) {
    const response=await fetch(searchAsset,{cache:"no-store"});
    if (!response.ok) throw new Error(`Search manifest HTTP ${response.status}`);
    const manifest=await boundJson(response,refreshBinding.search_sha256);
    const mode=identityAuthorityMode(manifest.schema_version,"search",state.data?._identity_authority_mode);
    if((manifest.graph_run_id!==state.data.graph_run_id||manifest.hierarchy_run_id!==state.data.hierarchy_run_id))throw new Error("Search and graph belong to different refresh revisions");
    state.searchManifest=manifest;
    recordLegacyAuthoritySchema(manifest.schema_version,mode);
  }
  await Promise.all(keys.map(async(key)=>{
    if (state.searchViews[key]) return;
    if (!state.searchPromises[key]) {
      const filename=state.searchManifest.view_files[key];
      state.searchPromises[key]=fetch(assetURL(filename),{cache:"no-store"}).then((response)=>{ if (!response.ok) throw new Error(`${key} search index HTTP ${response.status}`); return parseJsonAsset(response,filename); }).then((payload)=>{
        if (payload.schema_version!==state.searchManifest.schema_version||!assetViewMatches(payload,key)) throw new Error(`Unexpected ${key} search payload schema or view`);
        const mode=identityAuthorityMode(payload.schema_version,"search",state.data?._identity_authority_mode);
        adaptIdentityRecords(payload.records,mode);
        if (payload.records.some((row)=>(row.type||row.node_type)!=="Entity")) throw new Error(`Unexpected non-Entity in ${key} entity search`);
        payload.records.forEach((row)=>{row.kind="node";Object.assign(row,kgSearch.searchFields(row));});
        state.searchViews[key]=payload.records;
        state.searchIndexes[key]=new Map(payload.records.map((row)=>[row.id,row]));
      });
    }
    await state.searchPromises[key];
  }));
  return {views:state.searchViews,counts:state.searchManifest.counts};
}

async function ensureEvidenceSearchCatalog(keys) {
  await ensureSearchCatalog([]);
  await Promise.all(keys.map(async(key)=>{
    if(state.searchEvidenceViews[key])return;
    if(!state.searchEvidencePromises[key]){
      const filename=state.searchManifest.evidence_view_files?.[key];
      if(!filename)throw new Error(`No complete evidence-node index exists for ${key}`);
      state.searchEvidencePromises[key]=fetch(assetURL(filename),{cache:"no-store"}).then(async(response)=>{
        if(!response.ok)throw new Error(`${key} evidence search HTTP ${response.status}`);
        const payload=await parseJsonAsset(response,filename);
        if(payload.schema_version!==state.searchManifest.schema_version||!assetViewMatches(payload,key)||payload.record_kind!=="evidence_node")throw new Error(`Unexpected ${key} evidence search payload schema or view`);
        adaptIdentityRecords(payload.records,identityAuthorityMode(payload.schema_version,"search",state.data?._identity_authority_mode));
        payload.records.forEach((row)=>{
          row.kind="node";
          Object.assign(row,kgSearch.searchFields(row));
        });
        state.searchEvidenceViews[key]=payload.records;
        state.searchEvidenceIndexes[key]=new Map(payload.records.map((row)=>[row.id,row]));
      });
    }
    await state.searchEvidencePromises[key];
  }));
  return {views:state.searchEvidenceViews,counts:state.searchManifest.evidence_counts};
}

async function relationshipRecordsForQuery(view,query) {
  const key=view.key,catalog=await ensureSearchCatalog([key]),entities=catalog.views[key]||[];
  const endpointMatches=topMatches(entities,query,4);
  const edges=new Map();
  await Promise.all(endpointMatches.map(async(match)=>{
    const detail=await ensureNodeNeighborhood(view,match.id);
    const localNodes=new Map([detail.node,...(detail.neighbors||[])].map((row)=>[row.id,row]));
    (detail.edges||[]).forEach((raw)=>{
      if(edges.has(raw.id))return;
      const source=localNodes.get(raw.source),target=localNodes.get(raw.target);
      if(!source||!target)return;
      const row={...raw,kind:"edge",source_record:source,target_record:target,source_label:source.label,target_label:target.label,label:`${source.label} ↔ ${target.label}`,document_count:Number(raw.supporting_document_count||raw.evidence_count||0)};
      const matchedAliases=[match.label,...(match._observedForms||kgSearch.observedForms(match))];
      row._surfaces=[row.label,row.source_label,row.target_label,row.edge_type,...Object.keys(row.channel_counts||{}),...matchedAliases].map(kgSearch.normalizeSearchText).filter(Boolean);
      row._search=kgSearch.normalizeSearchText(`${row.label} ${row.edge_type||""} ${Object.keys(row.channel_counts||{}).join(" ")} ${matchedAliases.join(" ")}`);
      edges.set(row.id,row);
    });
  }));
  return {records:[...edges.values()],count:Number(state.searchManifest.relationship_counts[key]||0),matchedEndpointCount:endpointMatches.length};
}

function hierarchySearchRecord(row,level) {
  const record={
    ...row,
    kind:"hierarchy",
    hierarchy_level:level,
    type:level[0].toUpperCase()+level.slice(1),
    domain_id:level==="domain"?row.id:row.domain_id,
    theme_id:level==="theme"?row.id:row.theme_id,
    community_id:level==="community"?row.id:null,
  };
  record._surfaces=[kgSearch.normalizeSearchText(row.label)];
  record._search=kgSearch.normalizeSearchText(`${row.label} ${row.summary||""} ${row.description||""}`);
  return record;
}

async function searchRecordsForScope(view,scope,query) {
  const key=view.key;
  if(scope==='slot'){
    const page=await slotPage({q:query,offset:slotOverlayState.searchOffset});
    slotOverlayState.searchPage=page;
    return {records:page.slots,count:page.matched_count};
  }
  if(scope==="entity"){
    const catalog=await ensureSearchCatalog([key]);
    return {
      records:catalog.views[key]||[],
      count:Number(catalog.counts[key]||0),
    };
  }
  if(scope==="relationship"){
    return relationshipRecordsForQuery(view,query);
  }
  if(["evidence","claim","event","redaction"].includes(scope)){
    const catalog=await ensureEvidenceSearchCatalog([key]);
    const records=catalog.views[key]||[];
    const filtered=scope==="evidence"?records:records.filter((row)=>scope==="redaction"?normalize(row.type)==="redactionslot":normalize(row.type)===scope);
    if(scope==='evidence'&&slotOverlayState.enabled&&query.length>=3){
      const page=await slotPage({q:query,limit:16});
      return {records:[...filtered,...page.slots],relatedRecords:records,count:filtered.length+page.matched_count};
    }
    if(scope==="redaction"){
      const enriched=filtered.map((row)=>{
        const redactionCase=redactionCaseForRecord(row);
        if(!redactionCase)return row;
        const slotSearch=kgSearch.normalizeSearchText(redactionCase.slot_id);
        return {
          ...row,
          slot_id:redactionCase.slot_id,
          _surfaces:[...new Set([...(row._surfaces||[]),slotSearch])],
          _search:`${row._search||""} ${slotSearch} ${kgSearch.normalizeSearchText(redactionCase.context_preview||"")}`.trim(),
        };
      });
      return {records:enriched,count:enriched.length};
    }
    return {records:filtered,relatedRecords:records,count:filtered.length};
  }
  if(["domain","theme","community"].includes(scope)){
    await ensureHierarchyCatalog(view,scope);
    const records=(view.levels[scope]?.catalog_nodes||view.levels[scope]?.nodes||[]).map((row)=>hierarchySearchRecord(row,scope));
    return {records,count:records.length};
  }
  return {records:[],count:0};
}

function searchScore(record, query) {
  if (!query) return 0;
  if (record._surfaces.includes(query)) return 100000+Math.min(9999,Number(record.document_count||0));
  if (record._surfaces.some((surface)=>surface.startsWith(`${query} `))) return 80000+Math.min(9999,Number(record.document_count||0));
  const terms=query.split(/\s+/).filter(Boolean), tokens=record._search.split(" ");
  if (terms.every((term)=>tokens.includes(term))) return 60000+Math.min(9999,Number(record.document_count||0));
  if (query.length>=4 && record._search.includes(query)) return 40000+Math.min(9999,Number(record.document_count||0));
  return 0;
}

function topMatches(records, query, limit=8) {
  const top=[];
  records.forEach((record)=>{ if (state.hideIsolates&&(record.hierarchy_status==="unassigned_isolate"||record.kind==="edge"&&[record.source_record,record.target_record].some((row)=>row.hierarchy_status==="unassigned_isolate"))) return; let score=searchScore(record,query); if (!score) return; if(record.kind==="edge")score-=5000; const item={record,score}; let index=top.findIndex((entry)=>score>entry.score||(score===entry.score&&record.label.localeCompare(entry.record.label)<0)); if (index<0) index=top.length; top.splice(index,0,item); if (top.length>limit) top.pop(); });
  return top.map((entry)=>entry.record);
}

async function rankedSearchMatches(catalog,panelName,query,scope,related) {
  const exact=topMatches(searchableRecords(catalog.records,panelName),query);
  const annotate=record=>({...record,_kgSearchNotice:kgSearch.exactMatchNotice(record,query)});
  if(!related||!['entity','evidence','claim','event'].includes(scope)||exact.length>=8)return exact.map(annotate);
  const source=catalog.relatedRecords||catalog.records;
  if(!relatedIndexes.has(source))relatedIndexes.set(source,kgSearch.createRelatedIndex(source));
  const index=await relatedIndexes.get(source),ids=new Set(exact.map(row=>row.id));
  const view=currentViews()[panelName];
  const visible=record=>!record.overlay_slot&&
    (!state.hideIsolates||record.hierarchy_status!=='unassigned_isolate')&&
    (state.showIneligible||eligibilityReasons(record,{includeRelease:releaseFilterApplies(view)}).length===0);
  const hits=index.search(query,{limit:8-exact.length,accept:record=>
    !ids.has(record.id)&&visible(record)&&(!['claim','event'].includes(scope)||normalize(record.type)===scope),anchorAccept:visible});
  return [...exact.map(annotate),...hits.map(hit=>({...hit.record,_kgSearchNotice:
    `Related wording, not verification.${hit.anchor?` Observed-form anchor: ${hit.anchor}.`:''} Shared: ${hit.matched.join(', ')}.${hit.unmatched.length?` Unmatched: ${hit.unmatched.join(', ')}.`:''}`}))];
}

function initializeLocalSearch() {
  const host=$('#map-search-dropdown'),control=document.createElement('label');
  control.className='isolate-toggle';control.htmlFor='kg-related-search';
  control.innerHTML='<input id="kg-related-search" type="checkbox" aria-describedby="kg-search-method"> Include related wording';
  const note=document.createElement('p');note.id='kg-search-method';note.className='metric-caveat';
  note.textContent='Exact text and observed forms first. Related wording keeps an observed entity-form anchor when available, then uses local word/character similarity. Navigation only, not identity, support or fact verification. No model, dictionary or extra source is queried.';
  host.querySelector('.search-dropdown-heading').after(control,note);
  control.querySelector('input').addEventListener('change',event=>{state.relatedSearch=event.target.checked;state.autoOpenSearch=false;applySearch();});
}

function searchableRecords(records,panelName) {
  let filtered=records;
  const view=currentViews()[panelName];
  if(!state.showIneligible)filtered=filtered.filter((record)=>eligibilityReasons(record,{includeRelease:releaseFilterApplies(view)}).length===0);
  return filtered;
}

function recordHierarchyIds(row,panel) {
  if(row.kind==="hierarchy"){
    if(panel.level==="domain")return [row.domain_id].filter(Boolean);
    if(panel.level==="theme")return [row.theme_id].filter(Boolean);
    if(panel.level==="community")return [row.community_id].filter(Boolean);
    return [];
  }
  const records=row.kind==="edge"?[row.source_record,row.target_record]:[row];
  return records.map((record)=>panel.level==="domain"?record.domain_id:panel.level==="theme"?record.theme_id:panel.level==="community"?record.community_id:record.id).filter(Boolean);
}

function matchHierarchyIds(records, panel) { return records.flatMap((row)=>recordHierarchyIds(row,panel)); }

function renderSearchResults() {
  const container=$("#search-results");
  if (!state.query) { container.hidden=true; container.innerHTML=""; return; }
  const column=(name,label)=>`<section class="search-column"><h3>${esc(label)}</h3>${state.searchResults[name].length?state.searchResults[name].map((row,index)=>{
    const edge=row.kind==="edge",hierarchy=row.kind==="hierarchy";
    const forms=row._observedForms||[];
    const detail=row.overlay_slot?`${row.document_id} / earlier page ${row.source_page} / opaque, context navigation only`:edge?`${fmt(row.evidence_count)} supporting documents / ${row.edge_type}`:hierarchy?`${row.type} / ${fmt(row.mass)} assigned evidence nodes`:`${row.type||"Entity"} / ${fmt(row.document_count)} documents${row.visibility?` / ${visibilityLabel(row.visibility)}`:""}${identityScopeLabel(row)?` / ${identityScopeLabel(row)}`:""}${forms.length?` / observed forms: ${compact(forms.join(", "),90)}`:""}`;
    const action=row.overlay_slot?'Inspect Redacted Slot':edge?"Inspect edge":hierarchy?`Open ${row.hierarchy_level}`:"Inspect node";
    return `<button class="search-hit" type="button" data-search-panel="${name}" data-search-index="${index}"><span><b>${esc(row.label)}</b><small>${esc(detail)}</small>${row._kgSearchNotice?`<small data-kg-search-match>${esc(row._kgSearchNotice)}</small>`:''}</span><span>${esc(action)}</span></button>`;
  }).join(""):`<p class="metric-caveat">No match in the complete selected object index.</p>`}</section>`;
  const {legacy,current}=currentViews(),visible=new Set(visiblePanelNames()); container.innerHTML=(visible.has("legacy")?column("legacy",legacy.label):"")+(visible.has("current")?column("current",current.label):""); container.hidden=false;
  $$('[data-search-panel]',container).forEach((button)=>button.addEventListener("click",async()=>{
    const panel=button.dataset.searchPanel,row=state.searchResults[panel][Number(button.dataset.searchIndex)];
    const actionLabel=button.lastElementChild.textContent;
    button.disabled=true;button.lastElementChild.textContent="Opening...";container.hidden=true;
    try{await navigateSharedSearch(panel,row);}catch(error){state.panels[panel].showExternalNode({...row,summary:`Navigation could not complete: ${error.message}. ${row.summary||""}`});}finally{button.disabled=false;button.lastElementChild.textContent=actionLabel;}
  }));
}

let searchTimer=null,searchSequence=0;
function applySearch(resetSlotOffset=true) {
  const sequence=++searchSequence;
  if(resetSlotOffset!==false)slotOverlayState.searchOffset=0;
  clearTimeout(searchTimer); const raw=$("#graph-search").value.trim(); state.query=kgSearch.normalizeSearchText(raw);state.searchScope=$("#search-scope").value;
  if (!state.query) { $('#slot-search-pagination').hidden=true;$("#search-status").textContent=""; state.panels.legacy.setPreviewSearch(""); state.panels.current.setPreviewSearch(""); renderSearchResults(); return; }
  state.panels.legacy.setPreviewSearch(raw); state.panels.current.setPreviewSearch(raw); $("#search-status").textContent=`Loading complete ${state.searchScope} indexes...`;
  searchTimer=setTimeout(async()=>{
    try {
      const {legacy,current}=currentViews(),query=state.query,scope=state.searchScope,related=state.relatedSearch,revision=state.renderRevision;
      const [legacyCatalog,currentCatalog]=await Promise.all([searchRecordsForScope(legacy,scope,query),searchRecordsForScope(current,scope,query)]);
      const [legacyMatches,currentMatches]=await Promise.all([
        scope==='slot'?searchableRecords(legacyCatalog.records,'legacy'):rankedSearchMatches(legacyCatalog,'legacy',query,scope,related),
        scope==='slot'?searchableRecords(currentCatalog.records,'current'):rankedSearchMatches(currentCatalog,'current',query,scope,related)]);
      if(sequence!==searchSequence||query!==kgSearch.normalizeSearchText($('#graph-search').value)||scope!==$('#search-scope').value||related!==state.relatedSearch||revision!==state.renderRevision)return;
      state.searchResults.legacy=legacyMatches;state.searchResults.current=currentMatches;
      state.panels.legacy.setMatchIds(matchHierarchyIds(state.searchResults.legacy,state.panels.legacy)); state.panels.current.setMatchIds(matchHierarchyIds(state.searchResults.current,state.panels.current));
      const filterNote=state.hideIsolates?" Analyst-projection isolates are hidden.":" Isolates are included.";
      const pairLabels=singleCorpusMode?(state.data.corpus_metadata?.name||"single corpus"):redactionOnlyMode?"redaction-aware earlier":currentOnlyMode?"earlier and later":"legacy and current";
      const basis=singleCorpusMode
        ? scope==="relationship"
          ? ` Complete incident edges were read for ${fmt(currentCatalog.matchedEndpointCount)} matching entity endpoints; this graph contains ${fmt(currentCatalog.count)} published relationships.`
          : ` Matches were ranked across ${fmt(currentCatalog.count)} indexed ${state.searchScope} objects in the complete graph.`
        : redactionOnlyMode
        ? scope==="relationship"
          ? ` Complete incident edges were read for ${fmt(currentCatalog.matchedEndpointCount)} matching entity endpoints; the redaction-aware earlier graph contains ${fmt(currentCatalog.count)} published relationships.`
          : ` Matches were ranked across ${fmt(currentCatalog.count)} indexed ${state.searchScope} objects in the redaction-aware earlier graph.`
        : scope==="relationship"
          ? ` Complete incident edges were read for ${fmt(legacyCatalog.matchedEndpointCount)} and ${fmt(currentCatalog.matchedEndpointCount)} matching entity endpoints in the ${pairLabels} views; those views contain ${fmt(legacyCatalog.count)} and ${fmt(currentCatalog.count)} published relationships.`
          : ` Matches were ranked across ${fmt(legacyCatalog.count)} and ${fmt(currentCatalog.count)} indexed ${state.searchScope} objects in the ${pairLabels} views.`;
      const matchSummary=singleCorpusMode?`${state.searchResults.current.length} corpus`:redactionOnlyMode?`${state.searchResults.current.length} redaction-graph`:currentOnlyMode?visiblePanelNames().map((name)=>`${state.searchResults[name].length} ${name==="legacy"?"earlier":"later"}`).join(" and "):`${state.searchResults.legacy.length} legacy and ${state.searchResults.current.length} current`;
      const relatedNote=related?(['entity','evidence','claim','event'].includes(scope)?' Related wording enabled: deterministic local word/character similarity, not a verified statement. Exact matches stay first.':' Related wording applies only to evidence, entities, claims and events; this scope uses exact search.') : '';
      $("#search-status").textContent=scope==='slot'?`${fmt(currentCatalog.count)} Redacted Slots matched; ${state.searchResults.current.length} displayed on this page. Base-visible context and source IDs only; hidden names and lengths are not indexed. Navigation, not semantic evidence.`:`${matchSummary} matches shown.${basis}${filterNote}${relatedNote}`; renderSearchResults();
      const slotPager=$('#slot-search-pagination');slotPager.hidden=scope!=='slot';
      if(scope==='slot'){
        const page=slotOverlayState.searchPage;
        $('#slot-search-page-status').textContent=`${page.slots.length?page.offset+1:0}-${page.offset+page.slots.length} of ${fmt(page.matched_count)} / 32 per page`;
        $('#slot-search-prev').disabled=page.offset===0;$('#slot-search-next').disabled=page.next_offset===null;
      }
      if(state.autoOpenSearch){
        const openDirect=state.autoOpenDirect;
        state.autoOpenSearch=false;
        state.autoOpenDirect=false;
        const panelName=visiblePanelNames().includes("current")?"current":"legacy";
        const row=state.searchResults[panelName]?.[0];
        if(row){
          $("#search-results").hidden=true;
          await navigateSharedSearch(panelName,row,{direct:openDirect});
        }
      }
    } catch (error) { if(sequence===searchSequence)$("#search-status").textContent=`Full search unavailable: ${error.message}`; }
  },180);
}

function redactionNavigatorRecords() {
  return (state.redactionProjection?.cases||[]).filter((row)=>row.task_group===state.redactionCategory);
}

function redactionCaseForRecord(record) {
  if(!redactionOnlyMode||!record)return null;
  return (state.redactionProjection?.cases||[]).find((row)=>
    row.placeholder_id===record.id||row.slot_id===record.slot_id||row.slot_id===record.id
  )||null;
}

function selectRedactionNavigatorRecord(row) {
  if(!row)return false;
  state.redactionCategory=row.task_group;
  const records=redactionNavigatorRecords();
  const index=records.findIndex((candidate)=>candidate.slot_id===row.slot_id);
  if(index<0)return false;
  state.redactionIndex=index;
  hideRedactionResolution();
  renderRedactionNavigator();
  return true;
}

function redactionNavigatorLabel(row,index) {
  const form=row.representation==="redacted_relation"?"hidden relation":row.task_group==="entity_value"?"value fill":"statement";
  const anchor=row.anchor_label||[row.source_label,row.target_label].filter(Boolean).join(" ↔ ")||"[REDACTION]";
  return `${String(index+1).padStart(3,"0")} · ${form} · ${row.answer_word_count} words · ${row.document_id} p.${row.earlier_page} · ${compact(anchor,45)}`;
}

function currentRedactionNavigatorRecord() {
  const records=redactionNavigatorRecords();
  if(!records.length)return null;
  state.redactionIndex=Math.max(0,Math.min(records.length-1,state.redactionIndex));
  return records[state.redactionIndex];
}

function hideRedactionResolution() {
  const panel=$("#redaction-resolution"),button=$("#redaction-answer");
  if(panel){panel.hidden=true;panel.innerHTML="";}
  if(button){button.textContent="Reveal later answer";button.dataset.revealed="false";}
}

function renderRedactionNavigator() {
  if(!redactionOnlyMode||!state.redactionProjection)return;
  const counts=state.redactionProjection.counts||{},groups=counts.task_groups||{};
  const census=$("#redaction-census");
  census.innerHTML=[
    [counts.all_candidate_source_slots,"logical redaction candidates"],
    [counts.later_visible_slots,"with later-visible text"],
    [counts.verified_later_revealed_slots,"later reveals approved in final v4"],
    [counts.bounded_verified_slots,"verified reveals of at most 12 words"],
    [groups.entity_value||0,"entity or compact-value tasks"],
    [groups.claim_relation||0,"claim, event, or relation tasks"],
    [counts.eligible_cases,"tasks with a direct hierarchy route"],
  ].map(([value,label])=>`<article><b>${typeof value==="number"?fmt(value):esc(value)}</b><span>${esc(label)}</span></article>`).join("");
  const category=$("#redaction-category"),select=$("#redaction-case-select"),records=redactionNavigatorRecords();
  if(category)category.value=state.redactionCategory;
  select.innerHTML=records.map((row,index)=>`<option value="${index}">${esc(redactionNavigatorLabel(row,index))}</option>`).join("");
  if(records.length)select.value=String(state.redactionIndex);
  const row=currentRedactionNavigatorRecord(),detail=$("#redaction-case-detail"),locate=$("#redaction-locate"),source=$("#redaction-source"),answer=$("#redaction-answer");
  $("#redaction-previous").disabled=!records.length;
  $("#redaction-next").disabled=!records.length;
  source.disabled=!row;
  answer.disabled=!row;
  if(!row){locate.disabled=true;detail.innerHTML="<p>No records are available in this inventory.</p>";return;}
  locate.disabled=false;locate.textContent="Open investigative web";
  const isRelation=row.representation==="redacted_relation";
  const title=isRelation?`${row.source_label} ↔ [REDACTION] ↔ ${row.target_label}`:`[REDACTION] in ${row.anchor_label} context`;
  const groupLabel=row.task_group==="entity_value"?"Verified entity / compact value":"Verified claim / event / relation";
  const attachment=isRelation
    ? "The answer contributes one relation between two nodes already visible in the earlier graph, so a dashed mystery edge is defensible."
    : `The mystery node inherits this Community from the named visible context anchor. ${fmt((row.investigative_leads||[]).length)} dashed red strings expose bounded adjacent, same-page, same-document, and one-hop search directions; none is treated as a semantic relation or scored evidence.`;
  detail.innerHTML=`<p class="eyebrow">${esc(groupLabel)} ${fmt(state.redactionIndex+1)} of ${fmt(records.length)}</p><h3>${esc(title)}</h3><div class="redaction-meta"><span>${fmt(row.answer_word_count)} answer words</span><span>${esc(row.document_id)}</span><span>earlier p. ${fmt(row.earlier_page)}</span><span>later p. ${fmt(row.later_page)}</span></div><blockquote>${esc(row.context_preview||"Visible context is retained in the source transcript.")}</blockquote><p>${esc(attachment)}</p>`;
}

async function loadRedactionNavigatorData() {
  if(!redactionOnlyMode)return;
  const projectionResponse=await fetch("data/cib_redaction_graph.json",{cache:"no-store"});
  if(!projectionResponse.ok)throw new Error(`Redaction projection HTTP ${projectionResponse.status}`);
  state.redactionProjection=await projectionResponse.json();
  renderRedactionNavigator();
}

async function locateRedactionNavigatorRecord() {
  const row=currentRedactionNavigatorRecord();
  if(!row)return;
  const panel=state.panels.current,view=currentViews().current;
  await ensureEvidenceSearchCatalog([view.key]);
  const index=state.searchEvidenceIndexes[view.key];
  if(row.representation!=="redacted_relation"){
    const nodeId=row.placeholder_id;
    const record=index.get(nodeId);
    if(!record)throw new Error(`Graph routing record ${nodeId} is unavailable.`);
    await panel.navigateToNode(record);
    panel.showInvestigativeContext(record,row);
  }else{
    const sourceRecord=index.get(row.source_node_id),targetRecord=index.get(row.target_node_id);
    if(!sourceRecord||!targetRecord)throw new Error("One or both visible edge endpoints are unavailable.");
    await panel.navigateToEdge({
      id:`navigator_${row.slot_id}`,
      kind:"edge",
      edge_type:"REDACTED_RELATION",
      label:`${sourceRecord.label} ↔ ${targetRecord.label}`,
      source_record:sourceRecord,
      target_record:targetRecord,
      source_label:sourceRecord.label,
      target_label:targetRecord.label,
      evidence_count:1,
      description:"Verified hidden relation between two earlier-visible graph nodes.",
      introduced_by_slot_ids:[row.slot_id],
      contains_redaction_placeholder:true,
    });
  }
}

function openRedactionNavigatorSource() {
  const row=currentRedactionNavigatorRecord();
  if(!row)return;
  const highlights=[row.left_anchor_preview,"[REDACTION]",row.right_anchor_preview].filter(Boolean);
  openCibSource(state.panels.current,row.document_id,{canonicalPageId:row.canonical_page_id||"",highlights,slotId:row.slot_id});
}

async function toggleRedactionResolution() {
  window.location.assign("index.html");
}

function stepRedactionNavigator(delta) {
  const records=redactionNavigatorRecords();if(!records.length)return;
  state.redactionIndex=(state.redactionIndex+delta+records.length)%records.length;
  hideRedactionResolution();renderRedactionNavigator();
}

function bindRedactionNavigator() {
  if(!redactionOnlyMode)return;
  $("#redaction-category")?.addEventListener("change",(event)=>{state.redactionCategory=event.target.value;state.redactionIndex=0;hideRedactionResolution();renderRedactionNavigator();});
  $("#redaction-case-select")?.addEventListener("change",(event)=>{state.redactionIndex=Number(event.target.value||0);hideRedactionResolution();renderRedactionNavigator();});
  $("#redaction-previous")?.addEventListener("click",()=>stepRedactionNavigator(-1));
  $("#redaction-next")?.addEventListener("click",()=>stepRedactionNavigator(1));
  $("#redaction-locate")?.addEventListener("click",async(event)=>{const button=event.currentTarget;button.disabled=true;try{await locateRedactionNavigatorRecord();}catch(error){$("#redaction-case-detail").insertAdjacentHTML("beforeend",`<p>${esc(error.message)}</p>`);}finally{button.disabled=false;}});
  $("#redaction-source")?.addEventListener("click",openRedactionNavigatorSource);
  $("#redaction-answer")?.addEventListener("click",toggleRedactionResolution);
}

// Included in graph-full-v6.js by guide_derive_v64.py, not a second viewer.
const GUIDE_STEP_DELAY=3000;
let guideEpoch=0,guideSourceEpoch=0;
const guideReducedMotion=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;
const guideNodeLabel=node=>node?.label||node?.id||"Unknown state";
function guideScopeCaption(scope){
  const inclusive=scope.on_or_before||(scope.date_relation==='<='?scope.cutoff:null);
  return (inclusive?'Through '+inclusive+' (inclusive)':'Before '+scope.strictly_before+' (exclusive)')+
    (scope.whole_origin_excluded?'; origin '+scope.whole_origin_excluded+' excluded':'; no whole-origin exclusion');
}

let savedStoryCatalogPromise;
if(pageParams.has('walk_case')){
  const mount=new MutationObserver(()=>{
    const host=$('#saved-kg-walk');if(!host)return;
    host.classList.add('guide-v63');mount.disconnect();
    new ResizeObserver(()=>{const panel=state.panels.current;if(panel?.nodes.length&&!panel.v64Busy)panel.fit();}).observe(host);
  });
  mount.observe($('main'),{childList:true});
}
async function savedStorySourceAccess(caseId){
  const guideId=pageParams.get('guide_case'),walkId=pageParams.get('walk_case');
  if(guideId&&walkId&&guideId!==walkId)throw Error('Mixed saved guide and walkthrough cases are not accepted.');
  const id=caseId||guideId||walkId;
  if(!id)return null;
  if(!savedStoryCatalogPromise)savedStoryCatalogPromise=Promise.all([
    import('./narrative-catalog-v1.js'),import('./narrative-attempts-v1.js'),import('./narrative-guide-access-v1.js')
  ]).then(async([catalog,access,guide])=>{
    const {report}=await catalog.loadSavedCatalog();guide.gateWalkthrough(report);return {report,access};
  });
  const {report,access}=await savedStoryCatalogPromise;
  if(!report.privacy_contract)return null;
  const row=report.cases.find(value=>value.case.case_id===id);
  if(!row||row.case.corpus!==corpusId)throw Error('The saved source access request does not match this released case and corpus.');
  return {report,row,access,status:access.storyAccess(report,row)};
}

async function allowSavedStorySource(action,{landing=false,caseId}={}){
  // Verify the released case/corpus binding, without a second reveal consent.
  await savedStorySourceAccess(caseId);
  return true;
}

async function openSavedWalkSource(proof,{caseInfo,config,resourceBinding}={}){
  if(!caseInfo||!proof?.canonical_page_id)throw Error('An exact saved source and case are required.');
  const [{savedSourceScope,sourcePagePolicyAllows,registeredSuppliedPageInfo,registeredLaterPageInfo,bindRegisteredSourceResponse},{canonicalGateJSON},access]=await Promise.all([
    import('./saved-source-policy.js'),import('./local-decisions-v65.js'),savedStorySourceAccess(caseInfo.case_id)]);
  const row=access?.row,saved=row?.configurations?.[config];
  if(!saved||canonicalGateJSON(row.case)!==canonicalGateJSON(caseInfo)||canonicalGateJSON(row.resource_binding)!==canonicalGateJSON(resourceBinding))throw Error('The source request changes its released case, execution or resource.');
  const scope=savedSourceScope(row.case,saved.source_view_policy);
  guideCloseSource();const epoch=++guideSourceEpoch;
  const drawer=document.createElement('aside');drawer.id='study-guide-drawer';drawer.setAttribute('role','dialog');drawer.setAttribute('aria-label','Original source');
  drawer.innerHTML='<header><h2>Original source</h2><button data-study-close>Close</button></header><div class="study-source-content" role="status">Verifying source...</div>';
  document.body.append(drawer);$('[data-study-close]',drawer).onclick=guideCloseSource;
  try{
    const params=new URLSearchParams({case_id:caseInfo.case_id,config,source_id:proof.canonical_page_id});
    for(const key of ['resource_id','registry_sha256','index_sha256'])if(resourceBinding?.[key])params.set(key,resourceBinding[key]);
    const data=await currentGraphJSON('/api/source-v6?'+params),page=data.page||data;
    if(['supplied_documents_inclusive','later_release_inclusive'].includes(scope.source_view_policy.id)){
      const condition=await currentGraphJSON('/api/condition-v6?'+new URLSearchParams({case_id:caseInfo.case_id,config}));
      const record=condition.configurations?.[config];
      if(!record||canonicalGateJSON(condition.case)!==canonicalGateJSON(caseInfo)||
          canonicalGateJSON(record.native_checkpoint)!==canonicalGateJSON(saved.native_checkpoint))throw Error('The supplied source differs from its saved native execution.');
      await bindRegisteredSourceResponse(data,{record,caseInfo,binding:resourceBinding});
    }
    const reader=await import('./reader-casing.js');await reader.loadReaderCasing();
    const digest=async text=>{const canonical=JSON.stringify(text).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))].map(v=>v.toString(16).padStart(2,'0')).join('');};
    const eligible=p=>p.document_id===proof.document_id&&p.date===proof.date&&sourcePagePolicyAllows(p,caseInfo,scope)&&
      (caseInfo.corpus==='cib'||p.classification==='CONFIDENTIAL');
    if(!eligible(page)||(page.id||page.canonical_page_id)!==proof.canonical_page_id||await digest(page.text)!==proof.page_sha256||!Number.isInteger(proof.start)||!Number.isInteger(proof.end)||proof.start<0||proof.end<=proof.start||Array.from(page.text).slice(proof.start,proof.end).join('')!==proof.text)throw Error('The exact source proof or eligibility check failed.');
    const registered=registeredSuppliedPageInfo(page),pages=(Array.isArray(data.document_pages)?data.document_pages:[page])
      .filter(p=>!registered||registeredSuppliedPageInfo(p)?.edition===registered.edition),seen=new Set();let html='<p>'+esc(proof.document_id)+' / '+esc(proof.date)+'</p>';
    for(const p of pages){
      const id=p.id||p.canonical_page_id;if(seen.has(id))continue;seen.add(id);
      if(!eligible(p)||await digest(p.text)!==(p.source_sha256||p.page_sha256))throw Error('An additional source segment failed verification.');
      const selected=id===proof.canonical_page_id,chars=Array.from(p.text),info=registeredLaterPageInfo(p)||registeredSuppliedPageInfo(p),number=info?.physical_page||p.earlier_page||p.physical_page;
      html+='<h3>'+(info?esc(info.release)+' edition / ':'')+(number?'Page '+esc(number):'Source segment')+'</h3><pre>'+(selected?esc(chars.slice(0,proof.start).join(''))+'<mark class="source-quotation" data-original-text="'+esc(proof.text)+'">'+esc(chars.slice(proof.start,proof.end).join(''))+'</mark>'+esc(chars.slice(proof.end).join('')):esc(chars.join('')))+'</pre>';
    }
    if(!seen.has(proof.canonical_page_id))throw Error('The selected source is missing from its document inventory.');
    if(epoch!==guideSourceEpoch)return;
    drawer.dataset.proofPage=proof.canonical_page_id;drawer.dataset.proofHash=proof.page_sha256;drawer.dataset.proofStart=String(proof.start);drawer.dataset.proofEnd=String(proof.end);
    $('.study-source-content',drawer).innerHTML=html;$('.source-quotation',drawer)?.scrollIntoView({block:'center',behavior:'instant'});
    if(corpusId==='cib')await appendGraphPDFPair($('.study-source-content',drawer),page,proof).catch(()=>{});
  }catch(error){if(epoch===guideSourceEpoch)$('.study-source-content',drawer).textContent=error.message;}
}

async function savedWalkGraphReady(signal){
  const aborted=()=>{if(signal?.aborted)throw new DOMException('Saved walk cancelled','AbortError');};
  aborted();
  if(document.body.dataset.graphReady!=='true')await new Promise((resolve,reject)=>{
    let observer,timer;
    const finish=error=>{observer?.disconnect();clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve();};
    const cancel=()=>finish(new DOMException('Saved walk cancelled','AbortError'));
    observer=new MutationObserver(()=>{if(document.body.dataset.graphReady==='true')finish();});
    observer.observe(document.body,{attributes:true,attributeFilter:['data-graph-ready']});
    timer=setTimeout(()=>finish(Error('The existing corpus map is not ready. No replacement graph is used.')),30000);
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();else if(document.body.dataset.graphReady==='true')finish();
  });
  aborted();
}

const savedNavigationContexts=new Map();
async function verifySavedNavigationContext(context,node,previousNode,connection,resourceBinding){
  if(context?.version!=='saved-walk-navigation/2')throw Error('The saved connection requires its exact navigation context.');
  const [{canonicalGateJSON},{validateTrace},{savedSourceScope,traceSourceScope,sourceScopesEqual}]=await Promise.all([import('./local-decisions-v65.js'),import('./narrative-trace-v1.js'),import('./saved-source-policy.js')]);
  const access=await savedStorySourceAccess(context.caseInfo?.case_id),row=access?.row,saved=row?.configurations?.[context.config];
  const same=(a,b)=>canonicalGateJSON(a)===canonicalGateJSON(b);
  const scope=row&&saved?savedSourceScope(row.case,saved.source_view_policy):null;
  if(!row||!saved||!same(row.case,context.caseInfo)||!same(row.resource_binding,resourceBinding)||
      !same(saved.native_checkpoint,context.native_checkpoint)||!sourceScopesEqual(context,scope)||
      context.reading_id!==(pageParams.get('walk_reading')||'')||
      context.config!==(pageParams.get('walk_config')||'llm_readings')||context.path_id!==pageParams.get('walk_path'))
    throw Error('The navigation context changes the released question, execution, reading or source boundary.');
  const serialized=new TextEncoder().encode(canonicalGateJSON(row.case.query));
  const queryHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',serialized))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(queryHash!==context.query_sha256)throw Error('The saved navigation query hash differs.');
  const key=canonicalGateJSON([row.case.case_id,context.config,context.reading_id,resourceBinding,saved.native_checkpoint,scope]);
  if(!savedNavigationContexts.has(key)){
    const params=new URLSearchParams({case_id:row.case.case_id,config:context.config,reading:context.reading_id});
    for(const k of ['resource_id','registry_sha256','index_sha256'])params.set(k,resourceBinding[k]);
    const pending=currentGraphJSON('/api/narrative-v1/trace?'+params).then(envelope=>validateTrace(envelope,{
      case_id:row.case.case_id,config:context.config,reading_id:context.reading_id,query_sha256:queryHash,
      native_checkpoint:saved.native_checkpoint,resource_binding:resourceBinding,task:row.case.task,
      ...scope}));
    savedNavigationContexts.set(key,pending);
    pending.catch(()=>savedNavigationContexts.delete(key));
  }
  const trace=await savedNavigationContexts.get(key),path=trace.paths.find(p=>p.id===context.path_id),step=trace.steps.find(s=>s.id===context.step_id);
  if(!sourceScopesEqual(context,traceSourceScope(row.case,saved,trace)))throw Error('The saved trace changes the declared source boundary.');
  if(!path||!step||!path.steps.includes(step.id)||path.route_mode!==context.route_mode||context.trace&&!same(context.trace,trace))
    throw Error('The saved navigation step or trace is not in the selected path.');
  const actual=id=>step.nodes.some(n=>n.id===id&&n.is_graph_node===true);
  if(!actual(node.id)||previousNode&&!actual(previousNode.id)||connection&&!step.edges.some(e=>same(e,connection)))
    throw Error('The saved navigation node or edge is not an exact selected-step object.');
  return {path,step};
}

async function navigateSavedWalkNode(node,{resourceBinding,signal,previousNode=null,connection=null,transition='community',context=null}={}){
  if(node?.is_graph_node!==true||typeof node.id!=='string'||!node.id)throw Error('Only an actual saved graph-node ID can be navigated.');
  if(context||connection)await verifySavedNavigationContext(context,node,previousNode,connection,resourceBinding);
  await savedWalkGraphReady(signal);
  const aborted=()=>{if(signal?.aborted)throw new DOMException('Saved walk cancelled','AbortError');};
  const binding=currentGraphResource();
  if(resourceBinding?.corpus!==corpusId||binding&&Object.keys(binding).some(key=>binding[key]!==resourceBinding[key]))throw Error('Saved walk and map resource selectors differ.');
  const sameGraph=refreshBinding.graph_run_id===resourceBinding.graph_id;
  const declaredStudy=refreshBinding.study_graph_id===resourceBinding.graph_id&&refreshBinding.study_hierarchy_id===resourceBinding.hierarchy_id;
  if(!sameGraph&&!declaredStudy)throw Error('The map has no declared lineage for this saved source graph.');
  if(state.guidePath)throw Error('Close the other saved guide before stepping through this walk.');
  const panel=state.panels.current,view=panel.view;
  await ensureEvidenceSearchCatalog([view.key]);aborted();
  if(state.panels.current!==panel||panel.view!==view)throw new DOMException('Map view changed','AbortError');
  const record=state.searchEvidenceIndexes[view.key]?.get(node.id);
  if(!record)return {status:'unavailable',id:node.id,message:'This saved ID is absent from the current map. No label-based substitute is used.'};
  if(panel.v64Busy)return {status:'busy',id:node.id,message:'The map is finishing another navigation. Select this stage again.'};
  panel.stopPhysics();panel.stopOrbit();panel.closeInspector(false);
  const previous=previousNode?.is_graph_node===true?state.searchEvidenceIndexes[view.key]?.get(previousNode.id):null;
  if(previousNode&&!previous)throw Error('The preceding saved graph node is unavailable; no label substitute is used.');
  if(connection){
    const from=connection.traversal_from||connection.source,to=connection.traversal_to||connection.target;
    if(!previous||from!==previous.id||to!==record.id||!guidePairV64(connection,previous.id,record.id))throw Error('The saved connection does not bind the ordered navigation endpoints.');
  }
  const phases=[];let previousCommunity=null,browserEdgeIds=[];
  const phase=name=>{aborted();phases.push(name);panel.canvas.dataset.savedWalkPhase=name;};
  // Reuse the existing map, hierarchy and direct-neighborhood transitions.
  // An inspection is never relabelled as original retrieval chronology.
  const pending=guideRunV64(panel,async motion=>{
    panel.v64Traversal=null;
    panel.savedWalkLabelIds=new Set([previous?.id,record.id].filter(Boolean));
    if(previous&&connection&&transition==='connection'){
      const fromRoute=await panel.hierarchyRoute(previous),toRoute=await panel.hierarchyRoute(record);guideAssertV64(motion);
      previousCommunity=fromRoute.community?.id||null;
      const sameCommunity=Boolean(fromRoute.community&&fromRoute.community.id===toRoute.community?.id);
      if(!panel.nodeMap.has(previous.id)||panel.neighborhood||panel.trail.at(-1)?.id!==fromRoute.community?.id){
        phase('starting-community');await guideMoveRecordV64(panel,previous,motion);
      }
      if(sameCommunity){
        panel.pinnedFocusIds=new Set([previous.id,record.id]);panel.refreshGraph(previous.id);
      }
      let links=panel.edges.filter(edge=>guidePairV64(edge,previous.id,record.id));
      if(!sameCommunity||!links.length){
        const incident=await ensureNodeNeighborhood(view,previous.id);guideAssertV64(motion);
        if(incident.edges.some(edge=>guidePairV64(edge,previous.id,record.id))){
          phase('direct-connections');
          await guideOpenNeighborhoodV64(panel,previous,motion,{remember:false,ids:[previous.id,record.id]});
          links=panel.edges.filter(edge=>guidePairV64(edge,previous.id,record.id));
        }
      }
      if(links.length&&panel.nodeMap.has(previous.id)&&panel.nodeMap.has(record.id)){
        browserEdgeIds=links.map(edge=>edge.id).filter(Boolean);
        phase('origin');await guidePulseV64(panel,previous.id,motion);
        guideSetTraversalV64(panel,previous.id,record.id,{kind:connection.kind||connection.relation});
        panel.v64Traversal.progress=0;phase('connection');
        await guideTweenV64(panel,motion,720,p=>{panel.v64Traversal.progress=p;panel.draw();});
        phase('destination');await guidePulseV64(panel,record.id,motion);
        if(!sameCommunity){
          phase('destination-connections');
          await guideOpenNeighborhoodV64(panel,record,motion,{remember:false,ids:[previous.id,record.id]});
          guideSetTraversalV64(panel,previous.id,record.id,{kind:connection.kind||connection.relation});
          await guideTweenV64(panel,motion,480,()=>{});
          phase('destination-community');panel.v64Traversal=null;await guideMoveRecordV64(panel,record,motion);
        }
      }else{
        // A different browser graph can lack a native edge. Navigate hierarchy
        // honestly rather than drawing an invented connection between them.
        phase('hierarchy-navigation');await guideMoveRecordV64(panel,record,motion);
      }
    }else{
      phase('community');await guideMoveRecordV64(panel,record,motion);
    }
    guideAssertV64(motion);aborted();
    panel.closeInspector(false);
    const selected=panel.nodeMap.get(record.id);
    if(!selected)throw Error('The exact saved node is absent after navigation.');
    panel.selected=selected;
    const area=panel.usableBounds(),point=panel.screen(selected);
    await guideCameraV64(panel,motion,{...panel.transform,x:panel.transform.x+area.left+area.width/2-point.x,
      y:panel.transform.y+area.top+area.height/2-point.y},380);
    phase('arrived');panel.draw();
  }),token=panel.v64Token;
  const cancel=()=>{if(panel.v64Token===token)guideCancelMotionV64(panel);};
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  try{
    await pending;aborted();
    const selected=panel.nodeMap.get(node.id);
    if(!selected||panel.selected?.id!==node.id)throw Error('The exact saved node did not settle in the existing map.');
    panel.pulseIds([node.id]);panel.draw();
    return {status:'focused',id:node.id,label:record.label||node.id,level:panel.level,
      community_id:panel.trail.at(-1)?.id||null,view_key:view.key,
      browser_graph_id:refreshBinding.graph_run_id,source_graph_id:resourceBinding.graph_id,
      phases,existing_map_only:true,original_traversal_claimed:false,
      navigation_contract:'saved-walk-navigation/2',transition,previous_community_id:previousCommunity,
      connection:connection?{trace_edge_id:connection.id,browser_edge_ids:browserEdgeIds,
        verification:browserEdgeIds.length?'context-only':'unmatched'}:null};
  }finally{signal?.removeEventListener('abort',cancel);}
}

function guideSelection(params) {
  if(!params.has("guide_case")){
    if(["guide","guide_data","guide_ref"].some(k=>params.has(k)))throw Error("Only server-saved guides are accepted.");
    return null;
  }
  const selection={};
  for(const [key,param] of Object.entries({case_id:"guide_case",config:"guide_arm",reading:"guide_reading",candidate_id:"guide_candidate",route_index:"guide_route"})){
    const value=params.get(param)||"";
    if(value.length>240||/[\u0000-\u001f]/.test(value))throw Error("Invalid saved-guide selector.");
    selection[key]=value;
  }
  if(!selection.case_id||!selection.config||!selection.candidate_id||!/^\d+$/.test(selection.route_index))throw Error("Incomplete saved-guide selector.");
  return selection;
}

function normalizeSavedGuide(packet,selection) {
  const traceAdapter=packet?.version==="narrative-current-guide-adapter/4";
  if(traceAdapter&&(!/^path_[a-f0-9]{24}$/.test(packet.path_id||"")||!/^[a-f0-9]{64}$/.test(packet.trace_sha256||"")||
      packet.api_calls!==0||packet.factual_support_from_guide!==false||typeof packet.original_traversal_claimed!=="boolean"||
      typeof packet.postrun_view!=="boolean"||packet.original_traversal_claimed&&packet.postrun_view||
      !packet.candidate?.id||packet.source_readout?.outside_kg!==true||!Array.isArray(packet.candidate.sources)||
      JSON.stringify(packet.source_readout.source_refs)!==JSON.stringify(packet.candidate.sources)))throw Error("Invalid source-bound trace guide.");
  // A trace route has its own selector; the readout retains its native outcome ID.
  const target=traceAdapter&&selection.candidate_id.startsWith("path_")?packet.path_id:packet?.candidate?.id;
  if(packet?.case_id!==selection.case_id||packet.corpus!==corpusId||packet.config&&packet.config!==selection.config||target!==selection.candidate_id)throw Error("Saved guide belongs to another case, corpus, condition or candidate.");
  const route=packet.route,nodes=route?.nodes,hops=route?.hops;
  if(!Array.isArray(nodes)||!nodes.length||!Array.isArray(hops)||hops.length!==nodes.length-1||nodes.some(n=>typeof n.id!=="string"||!n.id||n.id.length>600))throw Error("Invalid ordered saved route.");
  const lexical=route.route_kind==="LEXICAL_SOURCE_READOUT";
  hops.forEach((h,i)=>{if(h.source!==nodes[i].id||h.target!==nodes[i+1].id||!(lexical?["SEARCH_RECEIPT_READOUT","EXACT_QUOTATION_READOUT","CONSTRUCTION_READOUT"]:["SOURCE","NAVIGATION","SOURCE_AGGREGATE"]).includes(h.kind))throw Error("Saved connection order or kind differs.");});
  if(lexical&&(nodes.some(n=>n.solver_state!==false||n.readout_only!==true)||hops.map(h=>h.kind).join()!=="SEARCH_RECEIPT_READOUT,EXACT_QUOTATION_READOUT,CONSTRUCTION_READOUT"))throw Error("Malformed lexical source readout.");
  const inventories=[route.citations,route.sources,route.source_quotes,packet.citations,packet.candidate.sources,...hops.map(h=>h.citations)].filter(v=>v!=null);
  if(inventories.some(v=>!Array.isArray(v)))throw Error("Invalid source inventory.");
  const seen=new Set(),citations=inventories.flat().filter(c=>{if(!c||typeof c!=="object")throw Error("Invalid source proof.");const key=JSON.stringify([c.document_id,c.canonical_page_id,c.start,c.end,c.text]);if(seen.has(key))return false;seen.add(key);return true;});
  const steps=lexical?[{type:"receipt",label:"Search to source"}]:[{type:"context",node_index:0,label:"Starting community"},...hops.map((h,i)=>({type:"connection",hop_index:i,node_index:i+1,label:h.kind==="NAVIGATION"?"Hierarchy navigation":"Source context"}))];
  if(citations.length)steps.push({type:"source",label:"Source & wording"});
  else if(lexical||packet.candidate.binding==="source_page_readout")steps.push({type:"readout",label:"Proposed wording"});
  return {packet,selection,nodes,hops,citations,steps,lexical,index:0,busy:false,playing:false,timer:null,error:null,limit:256,settledAt:null,sourceIndex:0};
}

async function selectGuideHandoff(g,params){
  const {sourceScopeAllows}=await import('./saved-source-policy.js');
  const keys=['guide_source','guide_start','guide_end','guide_hash'];
  if(!keys.some(key=>params.has(key)))return;
  if(keys.some(key=>params.getAll(key).length!==1)||!params.get('guide_source')||!/^\d+$/.test(params.get('guide_start'))||!/^\d+$/.test(params.get('guide_end'))||!/^[a-f0-9]{64}$/.test(params.get('guide_hash')))throw Error('Incomplete or mixed exact-quotation handoff. No alternate source is selected.');
  const start=Number(params.get('guide_start')),end=Number(params.get('guide_end'));
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start)throw Error('Invalid exact-quotation coordinates.');
  const inventory=[...(g.packet.candidate.sources||[]),...(g.packet.decision?.used_citations||[]),...(g.packet.candidate.decision?.used_citations||[])].map(c=>c?.citation||c);
  const matches=inventory.filter(c=>c&&(c.canonical_page_id||c.page_id)===params.get('guide_source')&&c.start===start&&c.end===end&&c.page_sha256===params.get('guide_hash'));
  const exact=new Map(matches.map(c=>[JSON.stringify([c.document_id,c.date,c.text]),c]));
  if(exact.size!==1)throw Error('The requested quotation is not one exact bound candidate source or decision-used citation. No same-page substitute is used.');
  const citation=exact.values().next().value;
  if(typeof citation.text!=='string'||!citation.text||!sourceScopeAllows(citation,g.packet.scope))throw Error('The requested quotation is outside this saved guide source policy.');
  let index=g.citations.findIndex(c=>c.canonical_page_id===citation.canonical_page_id&&c.page_sha256===citation.page_sha256&&c.start===citation.start&&c.end===citation.end&&c.text===citation.text);
  if(index<0){g.citations.push(citation);index=g.citations.length-1;}
  g.handoffCitation=citation;g.sourceIndex=index;
}

function guideReturnUrl() {
  let selection=state.guidePath?.selection;
  if(!selection){try{selection=guideSelection(pageParams);}catch(_error){return returnWorkbench;}}
  const arms={llm_readings:"A",llm_atoms:"B",llm_local:"C"};
  if(!selection||!arms[selection.config])return returnWorkbench;
  const url=new URL("/workbench-v6.html",location.origin);
  for(const [key,value] of Object.entries({case:selection.case_id,arm:arms[selection.config],stage:"04",reading:selection.reading,candidate:selection.candidate_id}))if(value)url.searchParams.set(key,value);
  return url.pathname+url.search;
}

function guideHost() {
  let host=$("#retrieval-path-guide");
  if(!host){host=document.createElement("aside");host.id="retrieval-path-guide";host.className="retrieval-path-guide guide-v63 guide-v64";host.setAttribute("aria-label","Saved source-context navigator");$(".graph-grid").before(host);new ResizeObserver(()=>{const panel=state.panels.current;if(panel?.nodes.length&&!panel.v64Busy)panel.fit();}).observe(host);}
  return host;
}

function renderGuideLoading(){
  const host=guideHost();host.setAttribute('aria-busy','true');
  host.innerHTML='<header><h2>KG Navigator</h2></header><p class="guide-current" role="status">Loading saved stages...</p><div class="guide-actions"><button disabled>Previous</button><button disabled>Next</button><button disabled>Play</button></div>';
}

function pauseGuide() {
  const g=state.guidePath;if(!g)return;
  g.playing=false;clearTimeout(g.timer);g.timer=null;
  $$('[data-guide-play]').forEach(b=>{b.textContent="Play";b.setAttribute("aria-pressed","false");});
}

function guideCloseSource() {guideSourceEpoch++;$("#study-guide-drawer")?.remove();$("#study-guide-scrim")?.remove();}

function enterGuideControls(g) {
  g.savedControls=$$('[data-eligibility-style],#hide-ineligible,[data-redactions],#show-slot-overlay,#show-ineligible,#temporal-control input,#temporal-control button').map(node=>[node,node.disabled]);
  g.visibilityNoteNode=$('.visibility-note');g.visibilityNote=g.visibilityNoteNode?.innerHTML;
  const temporal=$('#temporal-control');g.savedTemporalControl=temporal?{node:temporal,hidden:temporal.hidden}:null;
  for(const [node] of g.savedControls)node.disabled=true;
  if(temporal)temporal.hidden=true;
  if(g.visibilityNoteNode)g.visibilityNoteNode.textContent='Case eligibility: '+guideScopeCaption(g.packet.scope)+'. The full KG topology and hierarchy are unchanged; unverified edges stay gray.';
}

function restoreGuideControls(g) {
  for(const [node,disabled] of g.savedControls||[])node.disabled=disabled;
  if(g.visibilityNoteNode&&g.visibilityNote!=null)g.visibilityNoteNode.innerHTML=g.visibilityNote;
  if(g.savedTemporalControl)g.savedTemporalControl.node.hidden=g.savedTemporalControl.hidden;
  for(const [node,text] of g.savedCaseLabels||[])node.textContent=text;
}

function closeSavedGuide() {
  const g=state.guidePath;if(!g)return;
  pauseGuide();guideEpoch++;g.abort?.abort();guideCloseSource();
  const panel=state.panels.current;
  panel.guideCommunityContext=null;
  guideCancelMotionV64(panel);panel.v64Traversal=null;panel.studyContext=null;
  for(const name of ['data-guide-context','data-native-graph-id','data-native-hierarchy-id'])panel.canvas.removeAttribute(name);
  state.guidePath=null;state.guideOverlay=null;document.body.classList.remove("guide-active","guide-v63-active","guide-v64-active");
  restoreGuideControls(g);
  panel.canvas.hidden=false;panel.canvas.removeAttribute("aria-busy");panel.canvas.removeAttribute("data-guide-settled-at");
  $$(".guide-fade-layer").forEach(n=>n.remove());
  if(g.exploration){panel.nodeHistory=[];panel.restoreLocation(g.exploration);}
  $("#retrieval-path-guide")?.remove();
  const url=new URL(location.href);[...url.searchParams.keys()].filter(k=>k.startsWith("guide_")).forEach(k=>url.searchParams.delete(k));history.replaceState(null,"",url);
}

async function validateGuideOverlay(value,g) {
  const {sourceScopesEqual,sourceScopeAllows}=await import('./saved-source-policy.js');
  if(value?.version!=="full-kg-source-overlay/6.4"||value.lens!=="full_browser_overlay"||value.corpus!==corpusId||value.case_id!==g.packet.case_id||value.topology_replaced!==false||
    value.browser_binding?.graph_id!==refreshBinding.graph_run_id||value.browser_binding?.hierarchy_id!==refreshBinding.hierarchy_run_id||value.browser_binding?.comparison_sha256!==refreshBinding.comparison_sha256||
    value.study_binding?.graph_id!==g.packet.graph_binding.graph_id||value.study_binding?.hierarchy_id!==g.packet.graph_binding.hierarchy_id||
    !sourceScopesEqual(value.scope,g.packet.scope)||
    !Array.isArray(value.eligible_ids)||!Array.isArray(value.eligible_group_ids)||!Array.isArray(value.eligible_document_ids)||value.endpoint_mappings?.length!==g.nodes.length||value.connections?.length!==(g.lexical?0:g.hops.length))throw Error("Full KG/source-context binding or eligibility changed. No alternate graph was substituted.");
  value.endpoint_mappings.forEach((m,i)=>{
    if(m.native_id!==g.nodes[i].id||m.browser_id!==null&&(m.browser_id!==m.native_id&&!(m.status==="SAME_PINNED_HIERARCHY"&&value.layout_matches_study&&m.native_id===`hierarchy:${m.level}:${m.browser_id}`))||m.status==="PROVEN_SOURCE_ID"&&(!m.source_identity?.job_id||!m.source_identity?.source_entity_or_node_id||!m.source_identity?.canonical_page_id||!m.source_identity?.document_id))throw Error("Unproven endpoint mapping; label fallback is forbidden.");
  });
  value.connections.forEach((c,i)=>{
    const proofs=c.browser_edge_proofs||[];
    if(c.native_source!==g.hops[i].source||c.native_target!==g.hops[i].target||c.kind!==g.hops[i].kind||c.native_source_verified!==true||typeof c.browser_edge_verified!=='boolean'||c.browser_edge_verified!==(proofs.length>0)||!Array.isArray(c.browser_edge_ids)||JSON.stringify([...new Set(proofs.map(p=>p.id))].sort())!==JSON.stringify(c.browser_edge_ids))throw Error("Native/browser edge correspondence was not proven.");
    proofs.forEach(p=>{
      const s=p.source_identity,q=p.citation;
      if(c.kind!=='SOURCE'||!s?.relation_evidence_id||!s.job_id||s.visibility!=='both'||s.introduced_by_slot_id||!q?.page_sha256||!q.text||!sourceScopeAllows(q,value.scope)||q.canonical_page_id!==s.canonical_page_id||q.document_id!==s.document_id||q.date!==s.document_date_iso||p.relation!==s.relation_type||![p.source,p.target].every(id=>id===c.native_source||id===c.native_target)||![s.source_id,s.target_id].every(id=>id===c.native_source||id===c.native_target))throw Error('Displayed edge lacks exact eligible source-relation/type proof.');
    });
  });
  if(!Array.isArray(value.verified_browser_edges)||JSON.stringify(value.verified_browser_edges)!==JSON.stringify(value.connections.flatMap(c=>c.browser_edge_proofs||[])))throw Error('Unbound browser-edge proof inventory.');
  const edges=new Map();value.verified_browser_edges.forEach(p=>edges.set(p.id,[...(edges.get(p.id)||[]),p]));
  return {...value,eligible:new Set(value.eligible_ids),groups:new Set(value.eligible_group_ids),documents:new Set(value.eligible_document_ids),edges};
}

async function guideFetch(extra={},signal) {
  const {sourceScopesEqual}=await import('./saved-source-policy.js');
  const g=state.guidePath;
  if(extra.phase!=="source"&&!g?.caseContext)throw Error("Guide overlays do not request replacement study graphs.");
  const data=await currentGraphJSON("/api/guide-view-v6?"+new URLSearchParams({...g.selection,...extra}),{signal});
  const current=currentGraphResource();
  if((current?data.version!=='current-context-inspection/1':data.lens!=="study_case")||data.binding?.graph_id!==g.packet.graph_binding.graph_id||data.binding?.hierarchy_id!==g.packet.graph_binding.hierarchy_id||!sourceScopesEqual(data.scope,g.packet.scope))throw Error("Selected source binding changed.");
  if(g.caseContext&&!['source','inspect'].includes(extra.phase)&&data.phase!==extra.phase)throw Error('The source view belongs to another guide phase.');
  return data;
}

function guideControls() {
  const g=state.guidePath;
  return '<button data-guide-previous '+(g.busy||g.index===0?'disabled':'')+'>Previous</button><button data-guide-next '+(g.busy||g.index===g.steps.length-1?'disabled':'')+'>Next</button><button data-guide-play aria-pressed="'+g.playing+'" '+(!g.playing&&(g.busy||g.error||g.index===g.steps.length-1)?'disabled':'')+'>'+(g.playing?'Pause':'Play')+'</button>';
}

function bindGuideControls(root) {
  $('[data-guide-previous]',root)?.addEventListener("click",()=>activateGuideStep(state.guidePath.index-1));
  $('[data-guide-next]',root)?.addEventListener("click",()=>activateGuideStep(state.guidePath.index+1));
  $('[data-guide-play]',root)?.addEventListener("click",()=>{const g=state.guidePath;if(g.playing){pauseGuide();renderGuideStatus();return;}g.playing=true;renderGuideStatus();scheduleGuide();});
}

function scheduleGuide() {
  const g=state.guidePath;clearTimeout(g?.timer);
  if(!g?.playing||g.busy||g.error||document.hidden)return;
  if(g.index===g.steps.length-1){pauseGuide();renderGuideStatus();return;}
  g.timer=setTimeout(()=>activateGuideStep(g.index+1,{automatic:true}),GUIDE_STEP_DELAY);
}

function renderPathGuide() {
  const host=guideHost(),g=state.guidePath;
  if(state.guideError){host.innerHTML='<header><h2>KG Navigator</h2></header><p role="alert">'+esc(state.guideError)+'</p><a href="'+esc(guideReturnUrl())+'">Return to result</a>';host.setAttribute('aria-busy','false');return;}
  if(!g)return;
  host.innerHTML='<header><h2>KG Navigator</h2><button data-guide-close aria-label="Close guide">Close</button></header>'+
    '<div class="guide-stages" role="group" aria-label="Saved guide stages">'+g.steps.map((step,index)=>{
      const node=Number.isInteger(step.node_index)?g.nodes[step.node_index]:null;
      return '<button type="button" data-guide-step="'+index+'" title="'+esc(node?.label||step.label)+'"><span class="guide-stage-number">'+(index+1)+'</span><strong>'+esc(step.label)+'</strong>'+(node?'<small>'+esc(compact(guideNodeLabel(node),52))+'</small>':'')+'</button>';
    }).join('')+'</div><div class="guide-actions"></div><p id="guide-current" class="guide-current" role="status" aria-live="polite"></p>'+
    '<details class="guide-details"><summary>Details</summary><p id="guide-level-v64" class="kg-level-v64" aria-label="Current guide KG level"></p><p id="guide-case-bound">'+esc(guideScopeCaption(g.packet.scope))+'. A route is navigation, not proof.</p><p id="guide-mapping-status"></p><div class="guide-context-actions"><button data-guide-neighborhood>Neighborhood</button><button data-guide-community>Community</button></div><div class="guide-source-buttons">'+g.citations.map((citation,index)=>'<button type="button" data-guide-citation="'+index+'">'+esc(citation.document_id)+' / '+esc(citation.canonical_page_id||citation.page_id)+'</button>').join('')+'</div><a class="guide-return" href="'+esc(guideReturnUrl())+'">Return to result</a></details>';
  $$('[data-guide-step]',host).forEach(button=>button.onclick=()=>activateGuideStep(Number(button.dataset.guideStep)));
  $('[data-guide-close]',host).onclick=closeSavedGuide;
  $('[data-guide-neighborhood]',host).onclick=()=>guideContextView("neighborhood");
  $('[data-guide-community]',host).onclick=()=>guideContextView("community");
  $$('[data-guide-citation]',host).forEach(button=>button.onclick=async()=>{
    pauseGuide();g.busy=true;renderGuideStatus();
    try{g.sourceIndex=Number(button.dataset.guideCitation);await openStudySource(g.citations[g.sourceIndex]);}catch(e){g.error=e.message;}
    finally{g.busy=false;renderGuideStatus();}
  });
  renderGuideStatus();
}

function renderGuideStatus() {
  const g=state.guidePath;if(!g||!$('.guide-stages'))return;
  $$('[data-guide-step]').forEach(button=>{button.disabled=g.busy;button.setAttribute('aria-current',Number(button.dataset.guideStep)===g.index?'step':'false');});
  $('#guide-current').textContent=g.busy?'Loading...':g.error||g.steps[g.index].label;
  $('#guide-current').classList.toggle('guide-warning',Boolean(g.error));
  const actions=$('.guide-actions',guideHost());actions.innerHTML=guideControls();bindGuideControls(actions);
  $$('[data-guide-neighborhood],[data-guide-community]').forEach(b=>b.disabled=g.busy||g.lexical||!g.currentRecord||Boolean(nodeLevel[g.currentRecord.type]));
  $$('[data-guide-citation]').forEach(button=>button.disabled=g.busy);
  $('#guide-mapping-status').textContent=g.caseContext?'Exact saved source graph and recorded memberships.':g.overlay?.endpoint_mappings.filter(m=>m.browser_id===null).map(m=>m.native_id+': '+m.reason).join('\n')||'Exact bound IDs. Uncertified browser edges remain unassessed.';
  const footer=$('#study-guide-drawer footer');if(footer){footer.innerHTML=guideControls();bindGuideControls(footer);}
  guideHost().setAttribute('aria-busy',String(g.busy));
  if(g.caseContext&&state.panels.current.studyContext)state.panels.current.updateChrome();
  guideUpdateLevelV64(state.panels.current);
  window.dispatchEvent(new CustomEvent('kg-guide-state-v64',{detail:guideExportV64()}));
}

async function guideFrames() {await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}

async function guideCrossfade(change) {
  const panel=state.panels.current;
  return guideRunV64(panel,token=>guideTransitionV64(panel,{direction:'crossfade'},change,token));
}

async function guideRecord(nodeIndex) {
  const g=state.guidePath,m=g.overlay.endpoint_mappings[nodeIndex],panel=state.panels.current;
  if(m.browser_id===null)return null;
  if(m.current_mapping){
    if(m.level){const record=await panel.hierarchyNode(m.level,m.browser_id);if(!record||record.id!==m.browser_id||String(record.type).toLowerCase()!==m.level)throw Error('Exact current hierarchy ID is no longer available');return record;}
    const {node:record}=await ensureNodeNeighborhood(panel.view,m.browser_id);
    if(record.id!==m.browser_id||['domain_id','theme_id','community_id'].some(k=>(record[k]||null)!==(m.browser_membership[k]||null)))throw Error('Exact current node or membership changed');
    return record;
  }
  if(m.status==='SAME_PINNED_HIERARCHY')return panel.hierarchyNode(m.level,m.browser_id);
  const detail=await ensureNodeNeighborhood(panel.view,m.browser_id),record=detail.node;
  if(record.id!==m.browser_id||record.type!==m.source_identity.type||['domain_id','theme_id','community_id'].some(k=>(record[k]||null)!==(m.browser_membership[k]||null)))throw Error('Canonical ID or browser membership differs from the verified crosswalk.');
  return record;
}

async function guideCommunity(record) {
  const panel=state.panels.current;
  return guideRunV64(panel,token=>guideMoveRecordV64(panel,record,token));
}

async function guideContextView(kind,{limit}={}) {
  const g=state.guidePath;if(!g||g.busy||!g.currentRecord)return;
  pauseGuide();g.busy=true;renderGuideStatus();
  try{
    const panel=state.panels.current;
    if(g.caseContext){
      const step=g.steps[g.index],target=step.type==='connection'||!['context','connection'].includes(step.type)&&panel.studyContext?.phase.startsWith('target_');
      await guideCaseView((target?'target_':'start_')+(kind==='neighborhood'?'connections':'community'),{limit:limit??(kind==='neighborhood'?32:256)});
      return;
    }
    await guideRunV64(panel,async token=>{
      panel.v64Traversal=null;
      if(kind==='neighborhood'){await guideOpenNeighborhoodV64(panel,g.currentRecord,token,{limit:32});g.limit=32;}
      else {await guideMoveRecordV64(panel,g.currentRecord,token);g.limit=256;}
      const step=g.steps[g.index];
      if(step.type==='connection'&&g.hops[step.hop_index].kind==='SOURCE'){
        const source=g.overlay.endpoint_mappings[step.hop_index].browser_id,target=g.overlay.endpoint_mappings[step.node_index].browser_id;
        guideSetTraversalV64(panel,source,target,g.overlay.connections[step.hop_index]);
      }
    });
  }catch(e){g.error=e.message;}
  finally{if(g===state.guidePath){g.busy=false;g.settledAt=performance.now();renderGuideStatus();}}
}

async function guideShowEndpoint(step) {
  const g=state.guidePath,panel=state.panels.current;
  if(g.caseContext){
    const source=g.nodes[step.hop_index],target=g.nodes[step.node_index];
    const community=node=>node?.community_id||/^hierarchy:community:(.+)$/.exec(node?.parent_id||'')?.[1];
    const same=step.type==='connection'&&g.hops[step.hop_index]?.kind==='SOURCE'&&community(source)&&community(source)===community(target);
    await guideCaseView(step.type==='context'?'start_community':same?'target_community':'target_connections',{limit:step.type==='context'||same?256:32});
    g.movement=same&&panel.edges.some(edge=>edge.kind==='SOURCE'&&guidePairV64(edge,source.id,target.id))?'same_community':step.type==='context'?'community':'case_source_context';
    g.message=step.type==='context'?'Starting in the recorded source community. Only case-eligible source states are shown.':'Following an existing source connection or recorded membership. The highlighted path is not proof of the missing answer.';
    return;
  }
  const record=await guideRecord(step.node_index);
  if(g!==state.guidePath)return;
  if(!record){g.currentRecord=null;g.message='Unmapped native state. '+g.overlay.endpoint_mappings[step.node_index].reason+' The full KG is retained, not substituted.';return;}
  g.currentRecord=record;
  if(step.type==='context'){
    await guideCommunity(record);g.limit=256;
    g.message='Starting in the existing browser community, up to 256 nodes. Browser parents and aliases are retrospective; memberships are navigation, not historical facts.';
    return;
  }
  const hop=g.hops[step.hop_index],sourceMapping=g.overlay.endpoint_mappings[step.hop_index];
  const connection=g.overlay.connections[step.hop_index];
  const sourceId=sourceMapping.browser_id;
  await guideRunV64(panel,async token=>{
    panel.v64Traversal=null;
    if(hop.kind==='SOURCE'&&sourceId&&!nodeLevel[record.type]){
      await guidePulseV64(panel,sourceId,token);
      if(await guideRetainCommunity(panel,sourceId,record,token))g.movement='same_community';
      else if(panel.nodeMap.has(sourceId)&&panel.nodeMap.has(record.id))g.movement='horizontal';
      else{
        const incident=await ensureNodeNeighborhood(panel.view,sourceId);guideAssertV64(token);
        if(incident.neighbors.some(n=>n.id===record.id)&&incident.edges.some(e=>guidePairV64(e,sourceId,record.id))){
          await guideOpenNeighborhoodV64(panel,incident.node,token,{limit:g.limit,remember:false,ids:[sourceId,record.id]});g.movement='direct_neighborhood';
        }else{await guideMoveRecordV64(panel,record,token);g.movement='source_handoff';}
      }
      panel.selected=panel.nodeMap.get(record.id)||null;panel.external=null;
      panel.localIncidentNeighborhood=await ensureNodeNeighborhood(panel.view,record.id);guideAssertV64(token);
      guideSetTraversalV64(panel,sourceId,record.id,connection);await guidePulseV64(panel,record.id,token);
    }else{
      await guideMoveRecordV64(panel,record,token);g.movement=hop.kind==='NAVIGATION'?'browser_hierarchy':'source_handoff';
    }
    panel.renderInspector();panel.draw();
  });
  g.message=(hop.kind==='NAVIGATION'?'Recorded membership is navigation, not a historical relation. ':panel.v64Traversal?.verified?'Exact source-proven existing edge; both endpoints highlighted. ':panel.v64Traversal?.context_edge_ids.length?'Selected browser connection context; its view-specific edge ID is not certified by the saved source proof. ':'Eligible source handoff; no browser-edge traversal is certified. ')+(g.movement==='horizontal'?'Perspective retained. ':g.movement==='direct_neighborhood'?'Existing direct-neighborhood view; no invented link. ':'Actual browser hierarchy retained. ');
  g.activeCitations=connection.citations;
}

async function guideRetainCommunity(panel,sourceId,target,token){
  if(panel.neighborhood||panel.level!=='evidence'||!target.community_id||panel.trail.at(-1)?.id!==target.community_id)return false;
  const incident=panel.localIncidentNeighborhood?.node?.id===sourceId?panel.localIncidentNeighborhood:await ensureNodeNeighborhood(panel.view,sourceId);
  guideAssertV64(token);
  if(incident.node.community_id!==target.community_id)return false;
  const parent=panel.trail.at(-1),members=new Set((parent.member_nodes||[]).map(node=>node.id||node.node_id));
  const edges=incident.edges.filter(edge=>edge.id&&guidePairV64(edge,sourceId,target.id));
  if(!members.has(sourceId)||!members.has(target.id)||!edges.length)return false;
  // These exact edge IDs come from the same bound published incident catalog.
  panel.guideCommunityContext={community_id:parent.id,edges};
  panel.pinnedFocusIds=new Set([sourceId,target.id]);panel.refreshGraph(target.id);
  return panel.nodeMap.has(sourceId)&&panel.nodeMap.has(target.id)&&panel.edges.some(edge=>edges.some(actual=>actual.id===edge.id));
}

async function guideCaseView(phase,{limit=256}={}) {
  const g=state.guidePath,panel=state.panels.current,step=g.steps[g.index],epoch=guideEpoch;
  const hopIndex=step.hop_index??panel.studyContext?.hop_index??0;
  const supplied=await guideFetch({phase,hop_index:String(hopIndex),limit:String(limit)});
  const shown=new Set(supplied.nodes.map(n=>n.id));
  const edges=[...supplied.edges,...(supplied.incident?.edges||[]).filter(e=>shown.has(e.source)&&shown.has(e.target))];
  const data={...supplied,edges:[...new Map(edges.map(e=>[e.id,e])).values()]};
  const {verifyCurrentCaseGuideView}=await import('./local-decisions-v65.js');
  verifyCurrentCaseGuideView(data,g);
  if(g!==state.guidePath||epoch!==guideEpoch)return;
  await guideCrossfade(()=>{
    panel.studyContext=data;panel.level='evidence';panel.trail=[];panel.neighborhood=null;panel.localIncidentNeighborhood=null;
    panel.v64Traversal=null;panel.pinnedFocusIds=new Set(data.highlighted_node_ids);panel.nodeLimit=limit;
    g.limit=limit;g.currentRecord=data.nodes.find(n=>n.id===data.focus_id);g.inspectedCaseNode=null;
    panel.refreshGraph(data.focus_id);
    if(step.type==='connection'){
      const hop=g.hops[hopIndex],ids=data.relation_edges.filter(e=>data.edges.some(row=>row.id===e.id)).map(e=>e.id);
      panel.v64Traversal={source_id:hop.source,target_id:hop.target,native_kind:hop.kind,verified:false,
        edge_ids:[],context_edge_ids:ids,source_context_verified:true,proof_status:'exact_case_source_relation'};
      panel.draw();
    }
    panel.canvas.dataset.guideContext='case-source';panel.canvas.dataset.nativeGraphId=g.packet.resource_binding.graph_id;
    panel.canvas.dataset.nativeHierarchyId=g.packet.resource_binding.hierarchy_id;
  });
}

function renderStudyInspector(){
  const g=state.guidePath,panel=state.panels.current,c=panel.studyContext;if(!g?.caseContext||!c)return;
  const selected=panel.selected||c.nodes.find(n=>n.id===c.focus_id),edge=selected?.source?selected:null;
  const node=edge?null:g.inspectedCaseNode?.id===selected?.id?g.inspectedCaseNode:selected;
  const proofs=edge?.citations||node?.citations||[];
  panel.inspector.innerHTML='<div class="inspector-section"><p class="eyebrow">'+(edge?'Source connection':'Case source node')+'</p><h3>'+esc(edge?.relation||node?.label||'Selected source')+'</h3><p>'+esc(edge?'An eligible source connection, not entailment of the analyst query.':node?.type||'Saved state')+'</p><p>Exact source graph; no identity join to the separate overview.</p>'+proofs.map((p,i)=>'<button type="button" data-case-source-proof="'+i+'">'+esc(p.document_id)+' / '+esc(p.date)+'</button><p>'+esc(p.text)+'</p>').join('')+(!proofs.length?'<p>Recorded membership is navigation, not a historical assertion.</p>':'')+'</div>';
  $$('[data-case-source-proof]',panel.inspector).forEach(b=>b.onclick=()=>openStudySource(proofs[Number(b.dataset.caseSourceProof)]).catch(error=>{g.error=error.message;renderGuideStatus();}));
}
async function inspectStudyNode(id){
  const g=state.guidePath,panel=state.panels.current,epoch=guideEpoch;if(!g?.caseContext)return;
  pauseGuide();
  try{
    const value=await guideFetch({phase:'inspect',node_id:id});
    if(g!==state.guidePath||epoch!==guideEpoch)return;
    if(value.node?.id!==id)throw Error('The inspected source node differs.');
    g.inspectedCaseNode=value.node;panel.selected=panel.nodeMap.get(id)||null;panel.renderInspector();panel.draw();
  }catch(error){if(g===state.guidePath){g.error=error.message;renderGuideStatus();}}
}
function inspectStudyEdge(edge){
  const panel=state.panels.current;panel.selected=edge;panel.renderInspector();panel.draw();
}

function guideVerifiedSourceMarkup(text,start,end,wording){
  const chars=Array.from(text),quote=chars.slice(start,end).join(''),literal=String(wording||'');
  let cursor=0,body='',matches=0;
  const word=char=>/[\p{L}\p{N}_]/u.test(char||'');
  if(literal)for(let index=quote.indexOf(literal);index>=0;index=quote.indexOf(literal,index+literal.length)){
    if(word(literal[0])&&word(quote[index-1])||word(literal.at(-1))&&word(quote[index+literal.length]))continue;
    body+=esc(quote.slice(cursor,index))+'<mark class="proposed-wording">'+esc(literal)+'</mark>';cursor=index+literal.length;matches++;
  }
  body+=esc(quote.slice(cursor));
  return {html:esc(chars.slice(0,start).join(''))+'<mark class="source-quotation">'+body+'</mark>'+esc(chars.slice(end).join('')),matches};
}

async function openStudySource(citation,{manual=true}={}) {
  const {sourceScopeAllows}=await import('./saved-source-policy.js');
  if(!await allowSavedStorySource(()=>openStudySource(citation,{manual})))return;
  if(manual)pauseGuide();guideCloseSource();const epoch=++guideSourceEpoch;
  const scrim=document.createElement('div');scrim.id='study-guide-scrim';scrim.onclick=()=>{pauseGuide();guideCloseSource();};document.body.append(scrim);
  const current=Boolean(currentGraphResource());
  const drawer=document.createElement('aside');drawer.id='study-guide-drawer';drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-label',current?'Verified eligible current-resource source':'Verified eligible study source');
  drawer.innerHTML='<header><h2>Source &amp; wording</h2><button data-study-close>Close source</button></header><div class="study-source-content" role="status">Verifying the exact saved page and quotation...</div><footer>'+guideControls()+'</footer>';
  document.body.append(drawer);$('[data-study-close]',drawer).onclick=()=>{pauseGuide();guideCloseSource();};bindGuideControls($('footer',drawer));$('[data-study-close]',drawer).focus({preventScroll:true});
  const pageId=citation.canonical_page_id||citation.page_id;
  try{
    if(!pageId)throw Error('No exact saved source identity.');
    const {page}=await guideFetch({phase:'source',source_id:pageId});
    const ascii=JSON.stringify(page.text).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ascii));
    const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    const chars=Array.from(page.text),start=citation.start,end=citation.end;
    if(page.id!==pageId||page.document_id!==citation.document_id||page.date!==citation.date||hash!==citation.page_sha256||!sourceScopeAllows(page,state.guidePath.packet.scope)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>chars.length||chars.slice(start,end).join('')!==citation.text)throw Error('Exact saved source proof did not replay. No alternate quote or transcript was substituted.');
    if(epoch!==guideSourceEpoch)return;
    const wording=String(state.guidePath.packet.candidate.fill||''),marked=guideVerifiedSourceMarkup(page.text,start,end,wording);
    drawer.dataset.proofPage=pageId;drawer.dataset.proofHash=hash;drawer.dataset.proofStart=String(start);drawer.dataset.proofEnd=String(end);
    $('.study-source-content',drawer).innerHTML='<section class="study-wording"><h3>Proposed wording</h3><p>'+esc(wording||'No proposed wording saved.')+'</p><small>'+(marked.matches?'Verbatim wording is highlighted inside the verified quotation.':'Not quoted verbatim in this quotation.')+'</small></section><p>'+esc(page.document_id)+' / '+esc(page.date)+'</p><div class="study-mark-legend"><span class="quotation-swatch">Saved quotation</span>'+(marked.matches?'<span class="wording-swatch">Verbatim wording</span>':'')+'</div><pre>'+marked.html+'</pre>';
    $('.source-quotation',drawer)?.scrollIntoView({block:'center',behavior:'instant'});
    if(corpusId==='cib')await appendGraphPDFPair($('.study-source-content',drawer),page,citation).catch(()=>{});
  }catch(e){if(epoch===guideSourceEpoch){$('.study-source-content',drawer).textContent=e.message;$('.study-source-content',drawer).setAttribute('role','alert');}throw e;}
}

async function activateGuideStep(index,{automatic=false}={}) {
  const g=state.guidePath;if(!g||g.busy||index<0||index>=g.steps.length)return;
  if(!automatic)pauseGuide();clearTimeout(g.timer);guideCloseSource();
  const epoch=++guideEpoch;g.index=index;g.busy=true;g.error=null;g.settledAt=null;g.message='';renderGuideStatus();
  const panel=state.panels.current;panel.canvas.setAttribute('aria-busy','true');
  const step=g.steps[index];
  try{
    if(['context','connection'].includes(step.type))await guideShowEndpoint(step);
    else if(step.type==='source'){
      g.message=g.caseContext?'Original eligible source context. The case-source graph stays in place.':'Original source context. The full KG stays in place.';
      await openStudySource(g.handoffCitation||g.citations[g.sourceIndex]||g.citations[0],{manual:false});
    }else if(step.type==='receipt'){
      g.message='Saved lexical search and document receipts, not KG nodes or edges.';
      const hits=g.nodes[0].executed_searches||[];
      g.message+=' '+hits.length+' executed searches; source '+guideNodeLabel(g.nodes[1])+'.';
    }else{
      if(g.handoffCitation)await openStudySource(g.handoffCitation,{manual:false});
      g.message='Proposed wording: '+(g.packet.candidate.fill||g.packet.candidate.id)+'. Constructed source readout, not a KG node.';
    }
    await guideFrames();
  }catch(e){if(epoch===guideEpoch){g.error=e.message;pauseGuide();}}
  finally{
    if(epoch===guideEpoch){
      g.busy=false;g.settledAt=performance.now();panel.canvas.setAttribute('aria-busy','false');panel.canvas.dataset.guideSettledAt=String(g.settledAt);
      const url=new URL(location.href);url.searchParams.set('guide_step',String(index));history.replaceState(null,'',url);
      renderGuideStatus();scheduleGuide();
    }
  }
}

async function loadSavedGuide(params) {
  try{
    const selection=guideSelection(params);if(!selection)return;
    const [{savedSourceScope,sourceScopesEqual},access]=await Promise.all([import('./saved-source-policy.js'),savedStorySourceAccess(selection.case_id)]);
    const row=access?.row,saved=row?.configurations?.[selection.config];
    if(!saved)throw Error('The saved guide has no bound released execution.');
    if(['source_day_inclusive','supplied_documents_inclusive','later_release_inclusive'].includes(saved.source_view_policy?.id)){
      for(const key of ['guide_case','guide_arm','guide_reading','guide_candidate','guide_route'])
        if(params.getAll(key).length>1)throw Error('Conflicting saved-guide selectors.');
      const [{validateTrace},{traceSourceScope},{canonicalGateJSON},{savedGuideWalkURL}]=await Promise.all([
        import('./narrative-trace-v1.js'),import('./saved-source-policy.js'),import('./local-decisions-v65.js'),import('./saved-guide-redirect.js')]);
      const query=new URLSearchParams({case_id:row.case.case_id,config:selection.config,reading:selection.reading,
        ...Object.fromEntries(['resource_id','registry_sha256','index_sha256'].map(key=>[key,row.resource_binding[key]]))});
      const envelope=await currentGraphJSON('/api/narrative-v1/trace?'+query);
      const bytes=new TextEncoder().encode(canonicalGateJSON(row.case.query));
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const trace=validateTrace(envelope,{case_id:row.case.case_id,config:selection.config,reading_id:selection.reading,
        query_sha256:hash,native_checkpoint:saved.native_checkpoint,resource_binding:row.resource_binding,task:row.case.task,
        ...traceSourceScope(row.case,saved,envelope.trace||envelope)});
      location.replace(savedGuideWalkURL(selection,row,trace,location.href));
      return;
    }
    const g=normalizeSavedGuide(await currentGraphJSON('/api/guide-v6?'+new URLSearchParams(selection)),selection);
    if(!sourceScopesEqual(g.packet.scope,savedSourceScope(row.case,saved.source_view_policy)))throw Error('The guide changes its released evidence-policy descriptor.');
    await selectGuideHandoff(g,params);
    // Cable overview exports have a different hierarchy. Select a separate,
    // exact source-context lens instead of weakening the full-map ID check.
    g.caseContext=Boolean(currentGraphResource(params)&&['iran','vietnam'].includes(corpusId));
    if(!g.caseContext)verifyCurrentMapBinding(g.packet.resource_binding);
    const overlay=await currentGraphJSON('/api/guide-overlay-v64?'+new URLSearchParams(selection));
    if(overlay.version==='current-context-inspection/1'){
      const resource=currentGraphResource();if(!resource)throw Error('A current overlay requires explicit URL resource pins');
      const {adaptCurrentGuideOverlay,adaptCurrentCaseGuideOverlay}=await import('./local-decisions-v65.js');
      const panel=state.panels.current;
      g.overlay=g.caseContext?adaptCurrentCaseGuideOverlay(overlay,g,{resourceBinding:resource}):await adaptCurrentGuideOverlay(overlay,g,{resourceBinding:resource,viewer:refreshBinding,
        resolveHierarchy:(level,id)=>panel.hierarchyNode(level,id),resolveNode:async id=>{try{return (await ensureNodeNeighborhood(panel.view,id)).node;}catch(error){if(error.missingExactNode)return null;throw error;}}});
    }else{if(currentGraphResource())throw Error('A current guide cannot use a legacy study overlay');g.overlay=await validateGuideOverlay(overlay,g);}
    state.guidePath=g;state.guideOverlay=g.overlay;
    g.exploration=state.panels.current.rememberLocation();
    enterGuideControls(g);
    if(g.caseContext){
      for(const node of $$('[data-level],[data-display-mode],#full-corpus,#graph-search,#search-scope,#hide-isolates')){g.savedControls.push([node,node.disabled]);node.disabled=true;}
      if(g.visibilityNoteNode)g.visibilityNoteNode.textContent='Case source graph: '+guideScopeCaption(g.packet.scope)+'. Exact saved nodes and hierarchy; the standalone overview is separate.';
      g.savedCaseLabels=[];
      for(const [selector,text] of [
        ['.hero h1','Case source graph'],['#document-count','Saved source-path context'],
        ['#purpose','Inspect the saved route using its exact source graph. Only case-eligible evidence is shown; the separate Corpus Map returns when this guide is closed.'],
        ['#current-title','Case-bound source graph'],['#pair-title','Eligible source connections'],
        ['.graph-legend small','Size reflects eligible source-document counts for orientation, not correctness. Source connections and memberships are not proof of the query.'],
        ['#exploration-binding strong','Saved case graph, not the standalone overview'],
        ['#exploration-scope','Exact saved nodes, source quotations and recorded memberships. No label-based substitution or new inference.'],
        ['#exploration-layout','Source graph '+g.packet.resource_binding.graph_id+' / hierarchy '+g.packet.resource_binding.hierarchy_id+'.'],
        ['#level-explanation','Use the navigator to switch between the selected state\'s community and direct connections. Membership is navigation; a path is not proof of the query.']
      ]){const node=$(selector);if(node){g.savedCaseLabels.push([node,node.textContent]);node.textContent=text;}}
      for(const [selector,text] of [['.graph-legend .edge.solid',' Source connection'],['.graph-legend .edge.dashed',' Recorded membership']]){
        const node=$(selector)?.parentElement?.lastChild;
        if(node?.nodeType===Node.TEXT_NODE){g.savedCaseLabels.push([node,node.textContent]);node.textContent=text;}
      }
    }
    renderPanelCaption(state.panels.current);
    document.body.classList.add('guide-active','guide-v63-active','guide-v64-active');
    renderPathGuide();
    const requested=Number(params.get('guide_step')||0);
    await activateGuideStep(Number.isInteger(requested)&&requested>=0&&requested<g.steps.length?requested:0);
    startBoundGuideAutoplay(g,params);
  }catch(e){state.guideError=e.message;pauseGuide();renderPathGuide();}
}

function startBoundGuideAutoplay(g,params){
  if(params.get('guide_autoplay')!=='1'||state.guidePath!==g||!g.overlay||g.busy||g.error||!Number.isFinite(g.settledAt)||g.index>=g.steps.length-1)return false;
  g.playing=true;renderGuideStatus();scheduleGuide();return true;
}

document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseGuide();Object.values(state.panels).forEach(panel=>panel.stopPhysics());}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){pauseGuide();guideCloseSource();}});
document.addEventListener('pointerdown',e=>{if(state.guidePath&&!e.target.closest('#retrieval-path-guide,#study-guide-drawer'))pauseGuide();},true);
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{pauseGuide();Object.values(state.panels).forEach(panel=>panel.stopPhysics());});


// View-only motion over the original GraphPanel. No node/edge is synthesized.
const GUIDE_MOTION_V64={pulse:180,zoom:220,reveal:360,shrink:260,land:380};
const guideNativeV64={};
const guidePairV64=(edge,a,b)=>a!==b&&((edge.source===a&&edge.target===b)||(edge.source===b&&edge.target===a));

function guideLevelV64(panel=state.panels.current) {
  if(panel?.studyContext)return {key:'evidence',mode:panel.studyContext.view_kind==='incident'?'direct_neighborhood':'community_members',label:'Evidence / '+(panel.studyContext.view_kind==='incident'?'direct connections':'community members'),trail_ids:(panel.studyContext.breadcrumbs||[]).map(n=>n.id)};
  const mode=panel?.neighborhood?'direct_neighborhood':panel?.level==='evidence'&&panel.trail.at(-1)?.type==='Community'?'community_members':'hierarchy';
  const key=panel?.level||'domain';
  return {key,mode,label:key[0].toUpperCase()+key.slice(1)+(mode==='direct_neighborhood'?' / direct neighborhood':mode==='community_members'?' / community members':''),trail_ids:(panel?.trail||[]).map(n=>n.id)};
}

function guideUpdateLevelV64(panel) {
  if(!panel?.canvas)return;
  const level=guideLevelV64(panel);
  let badge=$(`#${panel.name}-level-v64`);
  if(!badge){badge=document.createElement('span');badge.id=panel.name+'-level-v64';badge.className='kg-level-v64';badge.setAttribute('aria-label','Current KG level');panel.canvas.closest('.graph-card').querySelector('.graph-actions').prepend(badge);}
  badge.textContent=level.label;badge.dataset.level=level.key;badge.dataset.view=level.mode;
  const guideBadge=$('#guide-level-v64');if(panel.name==='current'&&guideBadge){guideBadge.textContent=level.label;guideBadge.dataset.level=level.key;}
  panel.canvas.dataset.currentLevel=level.key;panel.canvas.dataset.currentView=level.mode;
  if(panel.v64Busy){$(`[data-back="${panel.name}"]`)?.setAttribute('disabled','');$(`[data-node-cap="${panel.name}"]`)?.setAttribute('disabled','');}
}

function guideExportV64() {
  const g=state.guidePath,p=state.panels.current;
  if(!g)return null;
  return JSON.parse(JSON.stringify({schema_version:'kg-guide-presentation/6.4',case_id:g.packet.case_id,config:g.selection.config,reading:g.selection.reading||null,
    candidate_id:g.selection.candidate_id,route_index:Number(g.selection.route_index),native_route_kind:g.packet.route.route_kind,
    native_node_ids:g.nodes.map(n=>n.id),native_hops:g.hops.map(h=>({source:h.source,target:h.target,kind:h.kind})),
    index:g.index,steps:g.steps.map(s=>({type:s.type,node_index:s.node_index??null,hop_index:s.hop_index??null})),
    current_level:guideLevelV64(p),movement:g.movement||null,traversal:p.v64Traversal||null,busy:g.busy,playing:g.playing,
    settled_at:g.settledAt,layout_only:true,native_route_changed:false,case_source_context:g.caseContext===true,
    source_resource_binding:g.caseContext?g.packet.resource_binding:null}));
}
window.guideExportV64=guideExportV64;

function guideEdgeVisualV64(panel,edge,selectedId) {
  if(!state.guideOverlay)return null;
  if(state.guidePath?.caseContext&&panel.studyContext)return {color:edge.kind==='NAVIGATION'?'#b08a39':'#347d78',width:1.2,kind:'case_source_context'};
  if(state.guideOverlay.version==='current-context-inspection/1')return {color:'rgba(120,130,133,.42)',width:1,kind:'current_browser_edge_unassessed'};
  const traversal=panel.v64Traversal;
  if(traversal?.verified&&traversal.edge_ids.includes(edge.id)&&state.guideOverlay.edges.has(edge.id))return {color:'#9f3325',width:3.2,kind:'source_proven_traversal'};
  // Selection is a full-KG UI affordance, not a positive source assessment.
  if(selectedId&&(edge.source===selectedId||edge.target===selectedId))return {color:edge.visibility_dimmed?'rgba(159,63,47,.50)':'rgba(159,63,47,.86)',width:1.9,kind:'selected_context_only'};
  return null;
}

function guideDrawV64(panel) {
  if(!panel.width||!panel.height)return;
  const ctx=panel.ctx,t=panel.v64Traversal;
  if(t){
    for(const id of t.context_edge_ids||[]){
      const edge=panel.edges.find(e=>e.id===id);if(!edge)continue;
      const first=panel.nodeMap.get(t.source_id),last=panel.nodeMap.get(t.target_id);if(!first||!last)continue;
      const a=panel.screen(first),end=panel.screen(last),progress=Number.isFinite(t.progress)?Math.max(0,Math.min(1,t.progress)):1,
        b={x:a.x+(end.x-a.x)*progress,y:a.y+(end.y-a.y)*progress};
      ctx.save();ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='rgba(255,253,248,.86)';ctx.lineWidth=7;ctx.stroke();ctx.strokeStyle='rgba(159,63,47,.92)';ctx.lineWidth=3.6;ctx.stroke();ctx.restore();
    }
    for(const id of t.edge_ids){
      const edge=panel.edges.find(e=>e.id===id);
      if(!edge||!t.verified||!state.guideOverlay?.edges.has(id))continue;
      const a=panel.screen(panel.nodeMap.get(edge.source)),b=panel.screen(panel.nodeMap.get(edge.target));
      ctx.save();ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='rgba(220,169,58,.52)';ctx.lineWidth=8;ctx.stroke();ctx.strokeStyle='#9f3325';ctx.lineWidth=3.2;ctx.stroke();ctx.restore();
    }
    for(const id of [t.source_id,t.target_id]){
      const node=panel.nodeMap.get(id);if(!node)continue;const point=panel.screen(node);
      ctx.save();ctx.beginPath();ctx.arc(point.x,point.y,panel.nodeRadius(node,7,9),0,Math.PI*2);ctx.strokeStyle='#a73324';ctx.lineWidth=3;ctx.stroke();ctx.beginPath();ctx.arc(point.x,point.y,panel.nodeRadius(node,12,14),0,Math.PI*2);ctx.strokeStyle='#dca93a';ctx.lineWidth=2.5;ctx.stroke();ctx.restore();
    }
  }
  const pulse=panel.v64Pulse,node=pulse&&panel.nodeMap.get(pulse.id);
  if(node){const point=panel.screen(node);ctx.save();ctx.beginPath();ctx.arc(point.x,point.y,panel.nodeRadius(node,8+16*pulse.progress,12),0,Math.PI*2);ctx.strokeStyle=`rgba(159,51,37,${1-pulse.progress*.7})`;ctx.lineWidth=3;ctx.stroke();ctx.restore();}
}

function guideTokenV64(panel) {
  const token={cancelled:false,animations:new Set(),frames:new Set(),stops:new Set()};
  panel.v64Token=token;return token;
}
function guideCancelMotionV64(panel) {
  const t=panel?.v64Token;if(!t)return;t.cancelled=true;
  t.animations.forEach(a=>a.cancel());t.frames.forEach(id=>cancelAnimationFrame(id));t.stops.forEach(stop=>stop());
  panel.v64Pulse=null;panel.v64Busy=false;panel.canvas.removeAttribute('data-motion-phase');panel.canvas.removeAttribute('aria-busy');
  $$('.guide-motion-layer-v64',panel.canvas.parentElement).forEach(n=>n.remove());
}
function guideAssertV64(token) {if(token.cancelled)throw new DOMException('KG motion cancelled','AbortError');}

function guideTweenV64(panel,token,duration,frame) {
  guideAssertV64(token);
  if(guideReducedMotion()){frame(1);return Promise.resolve();}
  return new Promise(resolve=>{
    const start=performance.now();let id;
    const stop=()=>{token.stops.delete(stop);resolve();};token.stops.add(stop);
    const tick=now=>{
      token.frames.delete(id);
      if(token.cancelled){stop();return;}
      const p=Math.min(1,(now-start)/duration),ease=p*p*(3-2*p);frame(ease);
      if(p<1){id=requestAnimationFrame(tick);token.frames.add(id);}else stop();
    };
    id=requestAnimationFrame(tick);token.frames.add(id);
  });
}
async function guideCameraV64(panel,token,target,duration) {
  const from={...panel.transform};
  await guideTweenV64(panel,token,duration,p=>{panel.transform=p===1?{...target}:{x:from.x+(target.x-from.x)*p,y:from.y+(target.y-from.y)*p,scale:from.scale+(target.scale-from.scale)*p};panel.draw();});
  guideAssertV64(token);
}
async function guidePulseV64(panel,id,token) {
  if(!id||!panel.nodeMap.has(id))return;
  panel.selected=panel.nodeMap.get(id);panel.external=null;panel.draw();
  await guideTweenV64(panel,token,GUIDE_MOTION_V64.pulse,p=>{panel.v64Pulse={id,progress:p};panel.draw();});
  panel.v64Pulse=null;guideAssertV64(token);panel.draw();
}
async function guideAnimateV64(element,frames,duration,token) {
  guideAssertV64(token);if(guideReducedMotion())return;
  const a=element.animate(frames,{duration,easing:'cubic-bezier(.22,.65,.3,1)'});token.animations.add(a);
  try{await a.finished;}catch(e){if(!token.cancelled)throw e;}finally{token.animations.delete(a);}
  guideAssertV64(token);
}

function graphPerspectiveKey(saved){
  return JSON.stringify([saved.viewKey,saved.level,saved.trail.map(n=>n.id),saved.neighborhood?.node?.id||null,saved.nodeLimit]);
}

async function guideTransitionV64(panel,{direction='crossfade',anchor_id=null,remember=true},change,token) {
  guideAssertV64(token);
  const prior=remember?panel.rememberLocation():null;
  const from=guideLevelV64(panel),canvas=panel.canvas,anchor=panel.nodeMap.get(anchor_id);
  const oldTransform={...panel.transform};let layer;
  const event={direction,anchor_id,from,to:null,phases:[],landing:null};
  const phase=name=>{event.phases.push(name);canvas.dataset.motionPhase=name;};
  const pointFor=node=>{const p=panel.screen(node);return {x:Math.max(16,Math.min(panel.width-16,p.x)),y:Math.max(16,Math.min(panel.height-16,p.y))};};
  try{
    if(direction==='down'&&anchor){
      phase('select-parent');await guidePulseV64(panel,anchor_id,token);
      const point=pointFor(anchor),scale=displayScale(Math.min(3.2,oldTransform.scale*2.8));
      phase('zoom-parent');await guideCameraV64(panel,token,{scale,x:point.x-anchor.x*scale,y:point.y-anchor.y*scale},GUIDE_MOTION_V64.zoom);
      event.landing=point;
    }
    if(!guideReducedMotion()){
      layer=document.createElement('img');layer.className='guide-motion-layer-v64';layer.alt='';layer.setAttribute('aria-hidden','true');layer.src=canvas.toDataURL();canvas.parentElement.append(layer);
    }
    guideAssertV64(token);await change();guideAssertV64(token);guideUpdateLevelV64(panel);event.to=guideLevelV64(panel);
    if(prior&&graphPerspectiveKey(prior)!==graphPerspectiveKey(panel.rememberLocation())){
      const last=panel.nodeHistory.at(-1);
      if(!last||graphPerspectiveKey(last)!==graphPerspectiveKey(prior))panel.nodeHistory.push(prior);
    }
    const landingNode=panel.nodeMap.get(anchor_id),final={...panel.transform};
    if(direction==='up'&&landingNode){
      const point=pointFor(landingNode),scale=displayScale(Math.min(3.2,final.scale*2.8));event.landing=point;
      panel.selected=landingNode;panel.external=null;panel.transform={scale,x:point.x-landingNode.x*scale,y:point.y-landingNode.y*scale};panel.draw();
      phase('shrink-to-parent');
      if(layer){const origin=`${point.x}px ${point.y}px`;await Promise.all([
        guideAnimateV64(layer,[{transform:'scale(1)',opacity:1,transformOrigin:origin},{transform:'scale(.025)',opacity:0,transformOrigin:origin}],GUIDE_MOTION_V64.shrink,token),
        guideAnimateV64(canvas,[{opacity:.08},{opacity:1}],GUIDE_MOTION_V64.shrink,token)
      ]);layer.remove();layer=null;}
      phase('land-parent');await guideCameraV64(panel,token,final,GUIDE_MOTION_V64.land);await guidePulseV64(panel,anchor_id,token);
    }else if(layer){
      phase(direction==='down'?'reveal-children':'crossfade');
      const point=event.landing||{x:panel.width/2,y:panel.height/2},origin=`${point.x}px ${point.y}px`;
      await Promise.all([
        guideAnimateV64(canvas,direction==='down'?[{opacity:0,transform:'scale(.025)',transformOrigin:origin},{opacity:1,transform:'scale(1)',transformOrigin:origin}]:[{opacity:0},{opacity:1}],GUIDE_MOTION_V64.reveal,token),
        guideAnimateV64(layer,[{opacity:1},{opacity:0}],GUIDE_MOTION_V64.reveal,token)
      ]);
    }
    guideAssertV64(token);await guideFrames();guideAssertV64(token);
    panel.v64LastMotion=event;panel.v64Motions=[...(panel.v64Motions||[]),event].slice(-24);
    return event;
  }finally{layer?.remove();panel.v64Pulse=null;canvas.removeAttribute('data-motion-phase');}
}

async function guideRunV64(panel,work,{manual=false}={}) {
  if(panel.v64Busy)return;
  const g=state.guidePath,owns=Boolean(g&&!g.busy);
  if(manual){pauseGuide();panel.savedWalkLabelIds=null;}
  if(owns){g.busy=true;clearTimeout(g.timer);renderGuideStatus();}
  const token=guideTokenV64(panel);panel.v64Busy=true;panel.canvas.setAttribute('aria-busy','true');guideUpdateLevelV64(panel);
  try{return await work(token);}catch(e){if(e.name!=='AbortError'){if(g&&state.guidePath===g)g.error=e.message;throw e;}}
  finally{
    if(panel.v64Token===token){panel.v64Busy=false;panel.canvas.setAttribute('aria-busy','false');panel.updateChrome();panel.startOrbit();}
    if(owns&&g===state.guidePath&&!token.cancelled){g.busy=false;g.settledAt=performance.now();renderGuideStatus();scheduleGuide();}
  }
}

function guideResetViewV64(panel,level,trail,focusIds=[]) {
  panel.guideCommunityContext=null;
  panel.neighborhood=null;panel.localIncidentNeighborhood=null;panel.investigativeContext=null;panel.expandedIncidentScopes.clear();
  panel.showNeighborEdges=false;panel.inducedNeighborEdges=[];panel.inducedLoadRevision++;panel.inducedLoading=false;panel.inducedError='';
  panel.level=level;panel.trail=[...trail];panel.nodeLimit=nodeLimitFor(level);panel.external=null;panel.pinnedFocusIds=new Set(focusIds.filter(Boolean));panel.searchMatchIds.clear();
  panel.refreshGraph(focusIds.at(-1)||null);
}

async function guideParentV64(panel,token,{remember=true}={}) {
  if(panel.neighborhood){
    const focus=panel.neighborhood.node,community=panel.trail.at(-1);
    if(community?.type==='Community')await ensureCommunityDetail(panel.view,community);
    guideAssertV64(token);
    return guideTransitionV64(panel,{direction:'up',anchor_id:focus.id,remember},()=>{
      panel.nodeLimit=nodeLimitFor(panel.level);guideNativeV64.returnFromNeighborhood.call(panel);panel.refreshGraph(focus.id);
    },token);
  }
  const parent=panel.trail.at(-1);if(!parent)return;
  const level=nodeLevel[parent.type];await ensureHierarchyCatalog(panel.view,level);guideAssertV64(token);
  return guideTransitionV64(panel,{direction:'up',anchor_id:parent.id,remember},()=>guideResetViewV64(panel,level,panel.trail.slice(0,-1),[parent.id]),token);
}

async function guideMoveRecordV64(panel,record,token) {
  const route=await panel.hierarchyRoute(record);guideAssertV64(token);
  const targetLevel=nodeLevel[record.type]||'evidence';
  const targetTrail=nodeLevel[record.type]?route.route.filter(n=>['domain','theme','community'].indexOf(nodeLevel[n.type])<['domain','theme','community'].indexOf(targetLevel)):route.route;
  if(targetLevel==='evidence'&&route.community)await ensureCommunityDetail(panel.view,route.community);
  const incident=!nodeLevel[record.type]?await ensureNodeNeighborhood(panel.view,record.id):null;guideAssertV64(token);
  if(panel.neighborhood)await guideParentV64(panel,token);
  const prefix=()=>panel.trail.every((n,i)=>targetTrail[i]?.id===n.id);
  while(panel.trail.length&&!prefix())await guideParentV64(panel,token);
  if(panel.level==='evidence'&&!panel.trail.length&&targetTrail.length){
    await guideTransitionV64(panel,{direction:'crossfade'},()=>guideResetViewV64(panel,'domain',[]),token);
  }
  while(panel.trail.length<targetTrail.length){
    const parent=targetTrail[panel.trail.length],level=nodeLevel[parent.type];
    if(panel.level!==level)await guideTransitionV64(panel,{direction:'crossfade'},()=>guideResetViewV64(panel,level,panel.trail,[parent.id]),token);
    if(!panel.nodeMap.has(parent.id)){panel.pinnedFocusIds=new Set([parent.id]);panel.refreshGraph(parent.id);}
    if(!panel.nodeMap.has(parent.id))throw Error('The exact full-KG parent is not present. No substitute was inserted.');
    const childLevel=nextLevel[level];
    if(childLevel!=='evidence')await ensureHierarchyCatalog(panel.view,childLevel);
    guideAssertV64(token);
    await guideTransitionV64(panel,{direction:'down',anchor_id:parent.id},()=>guideResetViewV64(panel,childLevel,[...panel.trail,parent],childLevel===targetLevel?[record.id]:[targetTrail[panel.trail.length+1]?.id]),token);
  }
  if(panel.level!==targetLevel)await guideTransitionV64(panel,{direction:'crossfade'},()=>guideResetViewV64(panel,targetLevel,targetTrail,[record.id]),token);
  if(targetLevel==='evidence'&&!route.community){
    await guideOpenNeighborhoodV64(panel,record,token,{limit:256,remember:false});
  }else{
    if(!panel.nodeMap.has(record.id)){panel.pinnedFocusIds=new Set([record.id]);panel.refreshGraph(record.id);}
    if(!panel.nodeMap.has(record.id))throw Error('The exact canonical endpoint is not in its recorded browser view.');
    panel.selected=panel.nodeMap.get(record.id);panel.external=null;panel.localIncidentNeighborhood=incident;panel.renderInspector();panel.draw();
  }
  guideUpdateLevelV64(panel);
}

async function guideOpenNeighborhoodV64(panel,record,token,{limit=256,remember=true,ids=[record.id]}={}) {
  const detail=await ensureNodeNeighborhood(panel.view,record.id),route=await panel.hierarchyRoute(detail.node);guideAssertV64(token);
  await guideTransitionV64(panel,{direction:panel.nodeMap.has(record.id)?'down':'crossfade',anchor_id:record.id},()=>{
    panel.neighborhood=detail;panel.localIncidentNeighborhood=null;panel.level='evidence';panel.trail=route.route;panel.nodeLimit=limit;
    panel.investigativeContext=null;panel.showNeighborEdges=true;panel.inducedNeighborEdges=[];panel.inducedLoadRevision++;
    panel.pinnedFocusIds=new Set(ids);panel.external=null;panel.refreshGraph(record.id);
  },token);
  if(!state.guidePath?.caseContext)await panel.loadInducedNeighborEdges();
}

function guideSetTraversalV64(panel,sourceId,targetId,connection) {
  const proofs=connection?.browser_edge_proofs||[];
  const ids=connection?.browser_edge_verified?connection.browser_edge_ids.filter(id=>panel.edges.some(e=>e.id===id&&
    guidePairV64(e,sourceId,targetId)&&proofs.some(p=>p.id===id&&String(e.edge_type||'').split(',').map(s=>s.trim()).includes(p.relation)))):[];
  const contextIds=state.guideOverlay?.version==='current-context-inspection/1'?[]:panel.edges.filter(e=>guidePairV64(e,sourceId,targetId)&&!ids.includes(e.id)).map(e=>e.id);
  panel.v64Traversal={source_id:sourceId,target_id:targetId,native_kind:connection?.kind||null,verified:ids.length>0,edge_ids:ids,
    context_edge_ids:contextIds,source_proof_available:Boolean(connection?.browser_edge_verified),proof_status:ids.length?'exact_displayed_edge_id':contextIds.length?'view_edge_id_unmatched':'source_handoff'};
  panel.matches=new Set([sourceId,targetId].filter(id=>panel.nodeMap.has(id)));panel.draw();
}

function guideInstallV64() {
  const p=GraphPanel.prototype;
  for(const name of ['draw','updateChrome','enterNode','back','focusNeighborhood','openLocalCommunity','returnFromNeighborhood','pointerDown','wheel'])guideNativeV64[name]=p[name];
  p.draw=function(){guideNativeV64.draw.call(this);guideDrawV64(this);};
  p.updateChrome=function(){guideNativeV64.updateChrome.call(this);guideUpdateLevelV64(this);};
  p.pointerDown=function(e){if(!this.v64Busy)return guideNativeV64.pointerDown.call(this,e);};
  p.wheel=function(e){if(this.v64Busy){e.preventDefault();return;}return guideNativeV64.wheel.call(this,e);};
  p.enterNode=function(node){
    if(this.v64Busy||!this.canEnter(node))return;
    return guideRunV64(this,async token=>{
      this.v64Traversal=null;const level=nextLevel[this.level];
      if(level==='evidence')await ensureCommunityDetail(this.view,node);else await ensureHierarchyCatalog(this.view,level);
      guideAssertV64(token);
      await guideTransitionV64(this,{direction:'down',anchor_id:node.id},()=>guideResetViewV64(this,level,[...this.trail,node]),token);
    },{manual:true}).catch(e=>this.inspectionError(e));
  };
  p.back=function(){
    if(this.v64Busy)return;
    if(state.guidePath?.caseContext)return activateGuideStep(state.guidePath.index-1);
    return guideRunV64(this,async token=>{
      this.v64Traversal=null;
      if(this.nodeHistory.length){const saved=this.nodeHistory.pop();await guideTransitionV64(this,{direction:'up',anchor_id:saved.selectedId,remember:false},()=>this.restoreLocation(saved),token);}
      else await guideParentV64(this,token,{remember:false});
    },{manual:true}).catch(e=>this.inspectionError(e));
  };
  p.focusNeighborhood=function(record,{scroll=true,remember=true}={}){
    const previous=this.neighborhood?.node?.id;
    return guideRunV64(this,async token=>{this.v64Traversal=null;await guideOpenNeighborhoodV64(this,record,token,{remember});if(previous&&previous!==record.id&&!state.guidePath){this.priorCenter={id:previous,until:performance.now()+3000};setTimeout(()=>{this.priorCenter=null;this.draw();},3000);this.draw();}if(scroll)this.canvas.focus({preventScroll:true});},{manual:true});
  };
  p.openLocalCommunity=function(record,{scroll=true,remember=true}={}){
    return guideRunV64(this,async token=>{this.v64Traversal=null;await guideMoveRecordV64(this,record,token);if(scroll)this.canvas.focus({preventScroll:true});},{manual:true});
  };
  p.returnFromNeighborhood=function(){return guideRunV64(this,async token=>{this.v64Traversal=null;await guideParentV64(this,token);},{manual:true});};
}
guideInstallV64();


function syncVisibilityControl() {
  $$('[data-eligibility-style]').forEach((button)=>{
    const active=state.showIneligible&&button.dataset.eligibilityStyle===state.visibilityMode;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
  const checkbox=$("#show-ineligible");
  if(checkbox)checkbox.checked=state.showIneligible;
  const hide=$('#hide-ineligible');hide?.classList.toggle('active',!state.showIneligible);hide?.setAttribute('aria-pressed',String(!state.showIneligible));
}

function setRedactionVisibility(show,refresh=true){
  slotOverlayState.enabled=Boolean(show);
  $('#show-slot-overlay').checked=slotOverlayState.enabled;
  $$('[data-redactions]').forEach(button=>{const active=(button.dataset.redactions==='show')===slotOverlayState.enabled;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  if(!refresh)return;
  for(const panel of Object.values(state.panels)){
    if(!show){
      if(panel.neighborhood?.node.overlay_slot)panel.neighborhood=null;
      panel.slotFocusId=null;
      if(panel.selected?.overlay_slot||panel.selected?.slot_navigation){panel.selected=null;panel.closeInspector(false);}
      if(panel.external?.overlay_slot||panel.external?.slot_navigation){panel.external=null;panel.closeInspector(false);}
    }
    if(panel.neighborhood)panel.neighborhood=withSlotContext(panel.neighborhood);
    if(panel.localIncidentNeighborhood)panel.localIncidentNeighborhood=panel.localIncidentNeighborhood.node.overlay_slot&&!show?null:withSlotContext(panel.localIncidentNeighborhood);
    panel.inducedNeighborEdges=panel.inducedNeighborEdges.filter(edge=>!edge.slot_navigation);panel.refreshGraph();
  }
}

function syncPairActions(){
  const panels=activePanels(),back=$('[data-back="all"]'),fit=$('[data-fit="all"]'),pair=state.displayMode==='pair';
  if(back){back.textContent=pair?'Back both maps':'Back';back.disabled=!panels.some(panel=>!panel.v64Busy&&(panel.nodeHistory?.length||panel.neighborhood||panel.trail?.length||state.guidePath?.index>0));}
  if(fit){fit.textContent=pair?'Fit both maps':'Fit';fit.disabled=!panels.length;}
}

function renderSelectionAudit(){
  const host=$('#selection-audit-content');if(!host||!$('#selection-audit').open)return;
  host.replaceChildren();
  for(const panel of activePanels()){
    const audit=panel.graph?.selectionAudit,section=document.createElement('section');
    const heading=document.createElement('h4');heading.textContent=panel.name+' map';section.append(heading);
    const pre=document.createElement('pre');pre.textContent=JSON.stringify(audit||{note:'Exact saved study context; no independent overview selection.'},null,2);section.append(pre);host.append(section);
  }
}

function bindPanelNavigation(){
  $$('[data-fit]').forEach(button=>button.addEventListener('click',()=>{pauseGuide();const panels=button.dataset.fit==='all'?activePanels():[state.panels[button.dataset.fit]];panels.filter(Boolean).forEach(panel=>{panel.compactLayout({immediate:true});panel.fit();});}));
  $$('[data-back]').forEach(button=>button.addEventListener('click',()=>{const panels=button.dataset.back==='all'?activePanels():[state.panels[button.dataset.back]];Promise.all(panels.filter(Boolean).map(panel=>panel.back())).catch(error=>$('#search-status').textContent=error.message);}));
}

function setVisibilityMode(mode) {
  if(!visibilityModes.includes(mode)){syncVisibilityControl();return;}
  const changed=mode!==state.visibilityMode||!state.showIneligible;
  state.visibilityMode=mode;state.showIneligible=true;syncVisibilityControl();
  const url=new URL(window.location.href);url.searchParams.set("ineligible",mode);url.searchParams.set("show_ineligible","1");url.searchParams.delete('visibility');history.replaceState(null,"",url);
  if(!changed)return;
  Object.values(state.panels).forEach((panel)=>panel?.applyVisibilityMode());applySearch();
}

function setIneligiblePresence(show) {
  if(show){setVisibilityMode(state.visibilityMode);return;}
  state.showIneligible=false;syncVisibilityControl();
  const url=new URL(window.location.href);url.searchParams.set("show_ineligible","0");url.searchParams.set("ineligible","hide");url.searchParams.delete('visibility');history.replaceState(null,"",url);
  Object.values(state.panels).forEach((panel)=>panel?.applyVisibilityMode());
  applySearch();
}

function utcDay(value) {
  const text=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return null;
  const day=Date.parse(`${text}T00:00:00.000Z`)/86400000;
  return Number.isInteger(day)&&dateFromUtcDay(day)===text?day:null;
}

function dateFromUtcDay(day) {
  return new Date(Number(day)*86400000).toISOString().slice(0,10);
}

function configureTemporalControl(params) {
  const range=state.data?.corpus_metadata?.date_range||{};
  const minimum=String(range.minimum||""),maximum=String(range.maximum||"");
  const minDay=utcDay(minimum),maxDay=utcDay(maximum),control=$("#temporal-control"),slider=$("#as-of-slider"),dateInput=$("#as-of-date"),ticks=$("#as-of-ticks");
  const minus=$("#as-of-minus"),plus=$("#as-of-plus"),error=$("#as-of-date-error");
  if(!control||!slider||!dateInput||minDay===null||maxDay===null||maxDay<minDay)return;
  state.asOfPolicy.minimum=minimum;state.asOfPolicy.maximum=maximum;
  const hint=$('#as-of-range-hint');
  if(hint)hint.textContent=`Available dates: ${minimum} to ${maximum}. Dates outside this range use the nearest available date.`;
  dateInput.dataset.minimum=minimum;dateInput.dataset.maximum=maximum;
  const requested=String(params.get("as_of")||"");
  let selectedDay=maxDay;
  if(requested&&utcDay(requested)!==null){selectedDay=Math.max(minDay,Math.min(maxDay,utcDay(requested)));state.asOfPolicy.inclusive=true;}
  else if(state.asOfPolicy.cutoff&&utcDay(state.asOfPolicy.cutoff)!==null){selectedDay=Math.max(minDay,Math.min(maxDay,utcDay(state.asOfPolicy.cutoff)-1));state.asOfPolicy.inclusive=true;}
  state.asOfPolicy.enabled=true;state.asOfPolicy.inclusive=true;state.asOfPolicy.cutoff=dateFromUtcDay(selectedDay);
  slider.min=String(minDay);slider.max=String(maxDay);slider.value=String(selectedDay);
  const syncTrack=()=>slider.style.setProperty("--as-of-progress",`${(100*(Number(slider.value)-minDay)/Math.max(1,maxDay-minDay)).toFixed(2)}%`);
  if(ticks){
    const tickCount=5,span=Math.max(1,maxDay-minDay);
    ticks.innerHTML=Array.from({length:tickCount},(_value,index)=>{
      const fraction=index/(tickCount-1),day=Math.round(minDay+fraction*span),date=dateFromUtcDay(day);
      return `<span style="left:${(fraction*100).toFixed(2)}%" title="${esc(date)}">${esc(date.slice(0,4))}</span>`;
    }).join("");
  }
  const clearError=()=>{dateInput.removeAttribute("aria-invalid");if(error){error.hidden=true;error.textContent="";}};
  const preview=(day)=>{dateInput.value=dateFromUtcDay(day);slider.setAttribute("aria-valuetext",dateInput.value);if(minus)minus.disabled=day<=minDay;if(plus)plus.disabled=day>=maxDay;clearError();syncTrack();};
  const sync=()=>{slider.value=String(utcDay(state.asOfPolicy.cutoff));preview(Number(slider.value));};sync();control.hidden=false;
  const selectDay=(value)=>{
    if(!Number.isInteger(value))return;
    const day=Math.max(minDay,Math.min(maxDay,value)),cutoff=dateFromUtcDay(day),changed=state.asOfPolicy.cutoff!==cutoff;
    state.asOfPolicy.enabled=true;state.asOfPolicy.inclusive=true;state.asOfPolicy.cutoff=cutoff;sync();
    const url=new URL(window.location.href);url.searchParams.set("as_of",cutoff);history.replaceState(null,"",url);
    if(changed){Object.values(state.panels).forEach((panel)=>panel?.applyVisibilityMode());applySearch();}
  };
  const commitDate=()=>{
    const day=utcDay(dateInput.value.trim());
    if(day===null){
      dateInput.setAttribute("aria-invalid","true");
      if(error){error.textContent=`Enter a valid date from ${minimum} to ${maximum} (YYYY-MM-DD). The graph's date has not changed.`;error.hidden=false;}
      return;
    }
    selectDay(day);
  };
  dateInput.addEventListener("input",clearError);
  dateInput.addEventListener('focus',()=>{if(hint)hint.hidden=false;});
  dateInput.addEventListener('blur',()=>{commitDate();if(hint)hint.hidden=true;});
  dateInput.addEventListener("change",commitDate);
  dateInput.addEventListener("keydown",(event)=>{if(event.key==="Enter"){event.preventDefault();commitDate();}else if(event.key==="Escape"){event.preventDefault();sync();}});
  slider.addEventListener("input",()=>preview(Number(slider.value)));
  slider.addEventListener("change",()=>selectDay(Number(slider.value)));
  minus?.addEventListener("click",()=>selectDay(utcDay(state.asOfPolicy.cutoff)-1));
  plus?.addEventListener("click",()=>selectDay(utcDay(state.asOfPolicy.cutoff)+1));
  $("#as-of-reset")?.addEventListener("click",()=>selectDay(maxDay));
}

function hasSavedGuide(params=pageParams) {
  return ["guide_case","guide","guide_data","guide_ref"].some(key=>params.has(key));
}

function viewerBindingURL(params=pageParams) {
  if(params.getAll("graph_revision").some(value=>value!=="study"))throw new Error("Unsupported graph revision");
  const query=new URLSearchParams({corpus:corpusId});
  if(hasSavedGuide(params)||params.get("graph_revision")==="study")query.set("revision","study");
  return "/api/graph-v4-viewer?"+query;
}

function currentCorpusMapURL() {
  const url=new URL(window.location.href);
  for(const key of [...url.searchParams.keys()]){
    if(key==="guide"||key.startsWith("guide_")||["graph_revision","node","node_id","q","inspect","connections","path_seed_id","path_neighbor_id"].includes(key))url.searchParams.delete(key);
  }
  url.hash="";
  return url.pathname+url.search;
}

function renderExplorationBinding(params=pageParams) {
  const study=hasSavedGuide(params)||params.get("graph_revision")==="study";
  $("#exploration-scope").textContent=study?"Saved study graph. This immutable browser binding preserves the original saved guide IDs and paths; it does not use the newer current map.":refreshBinding.scope_note||"A frozen independent exploration export. Workbench eligibility is narrower and is not inherited here.";
  const differs=refreshBinding.study_hierarchy_id&&refreshBinding.study_hierarchy_id!==refreshBinding.hierarchy_run_id;
  $("#exploration-layout").textContent=study?`Saved study graph ${refreshBinding.graph_run_id} / hierarchy ${refreshBinding.hierarchy_run_id}. Saved paths are unchanged; node IDs are never remapped by labels. The current Corpus Map is a separate selection.`:`Exploration graph ${refreshBinding.graph_run_id} / hierarchy ${refreshBinding.hierarchy_run_id}. ${differs?`This layout differs from study graph ${refreshBinding.study_graph_id||""} / hierarchy ${refreshBinding.study_hierarchy_id}; it is not the study-flow hierarchy.`:"The declared graph/hierarchy IDs match this corpus's study lineage; full exploration still has a different evidence scope."} No case origin exclusion or case cutoff is inherited. Explicit as-of dates are inclusive and do not refit the hierarchy.`;
  if(study){
    const heading=$("#exploration-binding strong");if(heading)heading.textContent="Saved study graph, not the current Corpus Map.";
    let link=$("#current-corpus-map-link");
    if(!link){link=document.createElement("a");link.id="current-corpus-map-link";$("#exploration-layout").after(link);}
    link.href=currentCorpusMapURL();link.textContent="Open current Corpus Map without this saved guide";
  }
}

async function init() {
  try {
    await kgSearchReady;
    const bindingResponse=await fetch(viewerBindingURL(),{cache:"no-store"});
    if(!bindingResponse.ok)throw new Error("The frozen full-corpus viewer binding is unavailable");
    refreshBinding=await bindingResponse.json();
    if(refreshBinding.asset_base!==`/graph-assets-v4/${corpusId}/`||!refreshBinding.graph_run_id||!refreshBinding.hierarchy_run_id)throw new Error("Invalid independent viewer binding");
    assetBase=refreshBinding.asset_base;comparisonAsset=assetURL(refreshBinding.comparison_asset);searchAsset=assetURL(refreshBinding.search_asset);
    const response=await fetch(comparisonAsset,{cache:"no-store"}); if (!response.ok) throw new Error(`HTTP ${response.status}`); state.data=await boundJson(response,refreshBinding.comparison_sha256);
    if(state.data.graph_run_id!==refreshBinding.graph_run_id||state.data.hierarchy_run_id!==refreshBinding.hierarchy_run_id)throw new Error("Graph and viewer binding belong to different refresh revisions");
    if(refreshBinding.prepared_source_root&&state.data.prepared_source_root!==refreshBinding.prepared_source_root)throw new Error("Source provenance differs from the frozen viewer binding");
    state.data=adaptComparisonAuthority(state.data);
    for(const [key,view] of Object.entries(state.data.views))view.label=singleCorpusMode?(key==="current_redaction"?"Confidential projection":"Confidential + Secret projection"):(view.release_view==="earlier"?"Earlier release":"Later release");
    state.pdfApiAvailable=corpusId==="cib"&&refreshBinding.pdf_available===true;
    document.title="Matryoshka | "+(state.data.corpus_metadata?.name||"Paired corpus graph");
    $("#document-count").textContent=`${fmt(state.data.corpus_metadata?.document_count)} ${singleCorpusMode?"prepared documents":"paired Central Intelligence Bulletins"}`;
    renderExplorationBinding();
    const params=new URLSearchParams(window.location.search); if (["earlier","later"].includes(params.get("release"))) state.release=params.get("release"); if (["single","pair"].includes(params.get("view"))) state.displayMode=params.get("view"); const requestedVisibility=params.get('ineligible')||params.get('visibility');state.visibilityMode=visibilityModes.includes(requestedVisibility)?requestedVisibility:'dim';state.showIneligible=params.get("show_ineligible")!=="0"&&requestedVisibility!=='hide'; if (["domain","theme","community","evidence"].includes(params.get("level"))) state.level=params.get("level"); state.guidePath=null;state.autoOpenSearch=params.get("inspect")==="1"&&!params.has("guide_case")&&!params.has('node_id')&&!params.has('node');state.autoOpenDirect=params.get("connections")==="1"&&!params.has("guide_case");
    $("#purpose").textContent=singleCorpusMode?state.data.comparison_contract.purpose:"Start from the fixed earlier-release hierarchy. Later-only, post-cutoff and undated evidence can remain dimmed or hidden without refitting assignments. Pair compares the two release-visibility projections, not source classification labels.";
    if(singleCorpusMode){
      $(".visibility-note").textContent="Eligibility display: the fixed Confidential taxonomy is retained when the permitted SECRET projection is added. Added, post-date or undated context may be dimmed or hidden. These are classification projections, not paired redactions; no workbench case cutoff or document exclusion is inherited.";
      const added=$$('.graph-legend span').find(item=>item.textContent.includes('Later-only addition'));
      if(added)added.innerHTML='<i class="edge dashed"></i>Added classification evidence';
      const legacyKicker=$('[data-panel="legacy"] .eyebrow');if(legacyKicker)legacyKicker.textContent="Base classification projection";
      const visibilityArticle=$$('.conclusion-grid article')[2];
      if(visibilityArticle)$('p',visibilityArticle).textContent="The expanded classification view adds the export's permitted SECRET evidence to the fixed Confidential taxonomy. Added evidence is not a newly revealed cable redaction. Date filters do not refit that retrospective hierarchy.";
    }
    if(refreshMode){
      const notice=document.createElement("section");
      notice.className="refresh-binding-notice";notice.id="refresh-binding-notice";notice.setAttribute("role","status");
      notice.innerHTML=`<strong>Current CIB graph binding</strong><p>${fmt(refreshBinding.documents)} document pairs. Graph ${esc(refreshBinding.graph_run_id)} / hierarchy ${esc(refreshBinding.hierarchy_run_id)}.</p><small>Search and graph paths use this binding. The workbench independently reports local completion, pending cases, and separate model support grades. No historical results are loaded here.</small>`;
      if($("#document-count"))$("#document-count").textContent=`${fmt(refreshBinding.documents)} paired Central Intelligence Bulletins`;
      $(".hero")?.after(notice);
    }
    if($("#comparison-notes"))$("#comparison-notes").innerHTML=state.data.comparison_contract.comparability.map((note)=>`<p>${esc(note)}</p>`).join(""); $("#build-label").textContent=`${state.data.graph_run_id} / ${state.data.hierarchy_run_id} / built ${new Date(state.data.generated_at_utc).toLocaleString()}`;
    state.searchScope=$("#search-scope")?.value||state.searchScope;configureTemporalControl(params);
    state.panels.legacy=new GraphPanel("legacy"); state.panels.current=new GraphPanel("current");initializeLocalSearch();bindRedactionNavigator();
    $$('[data-release]').forEach((button)=>button.classList.toggle("active",button.dataset.release===state.release)); $$('[data-level]').forEach((button)=>button.classList.toggle("active",button.dataset.level===state.level)); $("#level-explanation").textContent=levelCopy[state.level]; syncVisibilityControl(); await renderRelease();await loadRedactionNavigatorData();
    $$('[data-release]').forEach((button)=>button.addEventListener("click",async()=>{ state.release=button.dataset.release; $$('[data-release]').forEach((item)=>item.classList.toggle("active",item===button)); const url=new URL(window.location.href); url.searchParams.set("release",state.release); history.replaceState(null,"",url); await renderRelease(); }));
    $$('[data-display-mode]').forEach((button)=>{button.classList.toggle("active",button.dataset.displayMode===state.displayMode);button.addEventListener("click",async()=>{state.displayMode=button.dataset.displayMode;$$('[data-display-mode]').forEach((item)=>item.classList.toggle("active",item===button));const url=new URL(window.location.href);url.searchParams.set("view",state.displayMode);history.replaceState(null,"",url);await renderRelease();});});
    $$('[data-eligibility-style]').forEach((button)=>button.addEventListener("click",()=>setVisibilityMode(button.dataset.eligibilityStyle)));
    $("#show-ineligible")?.addEventListener("change",(event)=>setIneligiblePresence(event.target.checked));
    $$('[data-level]').forEach((button)=>button.addEventListener("click",async()=>{ state.level=button.dataset.level; $$('[data-level]').forEach((item)=>item.classList.toggle("active",item===button)); $("#level-explanation").textContent=levelCopy[state.level]; const url=new URL(window.location.href); url.searchParams.set("level",state.level); history.replaceState(null,"",url); await renderRelease(); }));
    bindPanelNavigation();
    $$('[data-node-cap]').forEach((select)=>select.addEventListener("change",()=>{const panels=select.closest('.map-toolbar')?activePanels():[state.panels[select.dataset.nodeCap]];panels.filter(Boolean).forEach(panel=>panel.setNodeCap(select.value));}));
    $("#graph-search").addEventListener("input",applySearch); $("#search-scope").addEventListener("change",applySearch); $("#hide-isolates").addEventListener("change",(event)=>{ state.hideIsolates=event.target.checked; applySearch(); });
    await initializeSlotOverlay();
    const requestedScope=params.get("scope"),requestedQuery=params.get("q")||"";
    if(requestedScope&&[...$("#search-scope").options].some((option)=>option.value===requestedScope))$("#search-scope").value=requestedScope;
    if(hasSavedGuide(params)){
      await loadSavedGuide(params);
    }else if(requestedQuery){
      $("#graph-search").value=requestedQuery;
      const requestedRedaction=requestedScope==="redaction"
        ? (state.redactionProjection?.cases||[]).find((row)=>row.slot_id===requestedQuery||row.placeholder_id===requestedQuery)
        : null;
      if(requestedRedaction){
        selectRedactionNavigatorRecord(requestedRedaction);
        if(state.autoOpenSearch){
          state.autoOpenSearch=false;
          $("#search-status").textContent="Opening the verified redaction and its investigative web...";
          await locateRedactionNavigatorRecord();
          $("#search-status").textContent=`Opened ${requestedRedaction.slot_id} with ${fmt((requestedRedaction.investigative_leads||[]).length)} bounded investigative leads.`;
        }else applySearch();
      }else applySearch();
    }
    $("#cib-source-close")?.addEventListener("click",closeCibSource);$("#cib-drawer-scrim")?.addEventListener("click",closeCibSource);window.addEventListener("keydown",(event)=>{if(event.key==="Escape")closeCibSource();});
    const focusId=params.get("node_id")||params.get("node");
    if(focusId&&!state.guidePath&&!state.guideError){
      const views=currentViews(),names=visiblePanelNames().includes('legacy')?['current','legacy']:['current'];
      await ensureEvidenceSearchCatalog(names.map(name=>views[name].key));
      const name=names.find(name=>opaqueSlot(focusId)||state.searchEvidenceIndexes[views[name].key]?.has(focusId));
      const record=name&&(opaqueSlot(focusId)||state.searchEvidenceIndexes[views[name].key].get(focusId));
      if(record)await navigateSharedSearch(name,record);
      else $("#search-status").textContent="The requested semantic ID is not in this separately bound exploration catalog. No substitute identity or route was invented.";
    }
    document.body.dataset.graphReady="true";
    const scrollReceipt=sessionStorage.getItem("graph-v6-scroll");sessionStorage.removeItem("graph-v6-scroll");
    if(scrollReceipt){try{const xy=JSON.parse(scrollReceipt);if(Array.isArray(xy)&&xy.length===2&&xy.every(v=>Number.isFinite(v)&&v>=0))window.scrollTo({left:xy[0],top:xy[1],behavior:"instant"});}catch(_error){/* An invalid optional viewport receipt has no effect. */}}
  } catch (error) {
    $("#purpose").textContent=`Frozen exploration graph unavailable: ${error.message}. No different graph or mutable latest fallback is used.`;
    $("#build-label").textContent="Awaiting current graph assets";
    $(".graph-grid").innerHTML=`<p class="hero-note" role="alert">${esc(error.message)}. The current graph assets are not ready. You can still open the Redaction workbench from the navigation above.</p>`;
  }
}

$("#full-corpus").value=corpusId;
$("#nav-workbench").href=returnWorkbench;
$("#nav-home").href=$("#nav-brand").href="index.html";
$("#nav-graph").href=location.pathname+location.search;
function graphCorpusURL(href,corpus){
  if(!['cib','iran','vietnam'].includes(corpus))throw Error('Unknown corpus selection.');
  const url=new URL(href);url.searchParams.set('corpus',corpus);
  // A corpus switch starts independent exploration, never a relabelled saved case.
  const bound=new Set(['node','node_id','q','scope','inspect','slot_source','connections','as_of',
    'path_seed_id','path_neighbor_id','resource_id','registry_sha256','index_sha256','graph_revision','revision',
    'case_id','case','config','reading','candidate_id','route_index','exclude_document']);
  for(const key of [...url.searchParams.keys()])if(key.startsWith('guide_')||key.startsWith('walk_')||bound.has(key))url.searchParams.delete(key);
  return url;
}
$("#full-corpus").addEventListener("change",event=>{
  const url=graphCorpusURL(location.href,event.target.value);
  sessionStorage.setItem("graph-v6-scroll",JSON.stringify([scrollX,scrollY]));
  location.assign(url);
});
// Presentation-only provenance. Append before the existing graph init call.
function guideRouteBadgeV65(packet) {
  const route=packet?.route||{};
  if(packet?.postrun_view===true||route.route_kind==='POSTRUN_GRAPH_VIEW')return {kind:'postrun_inspection',label:'Post-run graph inspection',note:'Inspection of the actual saved graph, not an original retrieval traversal or new factual support.'};
  if(route.route_kind==='LEXICAL_SOURCE_READOUT')return {kind:'readout',label:'Source readout',note:'Document and quote readout, not a numerical KG walk.'};
  const derived=route.derived_witness===true||route.route_kind==='DERIVED_BOUNDED_PROJECTION_WITNESS';
  if(derived)return {kind:'derived',label:'Derived projection witness',note:'Selected from actual bounded projection edges and the bound native kernel. Not a native-saved witness or a correctness probability.'};
  if(route.native_witness===true)return {kind:'native_saved',label:'Native-saved witness',note:'The unchanged complete native-saved sequence; presentation selection does not change its rank or support.'};
  return {kind:'saved_positive',label:'Saved positive walk',note:'An existing positive finite walk, not a newly derived path or a correctness probability.'};
}

function guideRenderRouteBadgeV65() {
  const host=document.querySelector('#retrieval-path-guide'),g=state.guidePath;
  if(!host||!g)return;
  const badge=guideRouteBadgeV65(g.packet);
  let node=host.querySelector('#guide-route-provenance-v65');
  if(!node){node=document.createElement('p');node.id='guide-route-provenance-v65';node.className='guide-case-bound';node.setAttribute('role','note');host.querySelector('.guide-details')?.append(node);}
  node.dataset.routeProvenance=badge.kind;
  node.textContent=badge.label;node.title=badge.note;node.setAttribute('aria-label',badge.label+'. '+badge.note);
}

const guideOriginalRenderV65=renderPathGuide;
renderPathGuide=function(){guideOriginalRenderV65();guideRenderRouteBadgeV65();};

function bindMapToolbar(){
  const toolbar=$('.map-toolbar'),search=$('#graph-search'),dropdown=$('#map-search-dropdown');
  if(!toolbar||!search||!dropdown)return;
  const resize=()=>{const bottom=Math.ceil(toolbar.getBoundingClientRect().bottom),origin=$('main').getBoundingClientRect().top;document.documentElement.style.setProperty('--toolbar-height',Math.max(0,bottom-origin)+'px');document.documentElement.style.setProperty('--toolbar-bottom',bottom+'px');for(const panel of Object.values(state.panels))panel.fit();};
  new ResizeObserver(resize).observe(toolbar);
  const closePopovers=except=>$$('.toolbar-popover[open]').forEach(d=>{if(d!==except)d.open=false;});
  $$('.toolbar-popover').forEach(d=>d.addEventListener('toggle',()=>{if(d.open){closePopovers(d);dropdown.hidden=true;}}));
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.toolbar-popover'))closePopovers();if(!event.target.closest('.search-box'))dropdown.hidden=true;});
  $('#hide-ineligible').onclick=()=>setIneligiblePresence(false);
  $$('[data-redactions]').forEach(button=>button.onclick=()=>setRedactionVisibility(button.dataset.redactions==='show'));
  $('#selection-audit').addEventListener('toggle',renderSelectionAudit);
  $('#map-up').onclick=()=>{for(const panel of activePanels()){if(panel.v64Busy)continue;panel.closeInspector(false);guideRunV64(panel,token=>guideParentV64(panel,token),{manual:true}).catch(e=>panel.inspectionError(e));}};
  $('#map-context').onclick=()=>{const selected=activePanel();if(!selected||selected.v64Busy)return;
    if(state.guidePath)return guideContextView(selected.neighborhood?'community':'neighborhood');
    const showNeighborhood=!selected.neighborhood;
    for(const p of activePanels()){
      if(p.v64Busy)continue;const item=p.selected&&!p.selected.source?p.selected:p.neighborhood?.node;if(!item)continue;
      p.closeInspector(false);Promise.resolve(showNeighborhood?p.focusDirectConnections(item):p.neighborhood?(p.level==='evidence'?p.openLocalCommunity(p.neighborhood.node):p.returnFromNeighborhood()):null).catch(e=>{p.drawerOpen=true;p.inspectionError(e);});
    }
  };
  $('#neighborhood-motion')?.addEventListener('change',event=>{state.neighborhoodMotion=event.target.checked;for(const p of activePanels()){if(state.neighborhoodMotion)p.startOrbit();else{p.compactLayout({immediate:true});p.stopOrbit();p.draw();}}});
  $('#show-neighborhood-legend')?.addEventListener('click',()=>activePanels().filter(p=>p.graph?.focusMode).forEach(p=>p.showRingLegend()));
  $('#reset-map-labels').onclick=()=>{for(const p of activePanels()){p.labelOverrides.clear();p.compactLayout();}};
  const openSearch=()=>{if(search.value||$('#search-scope').value==='slot'){dropdown.hidden=false;closePopovers();}};
  search.addEventListener('input',()=>{dropdown.hidden=!search.value;closePopovers();});search.addEventListener('focus',openSearch);
  $('#search-scope').addEventListener('change',()=>{dropdown.hidden=false;});
  $('#close-search').onclick=()=>{search.focus({preventScroll:true});dropdown.hidden=true;};
  $('#browse-source-slots').addEventListener('click',()=>{closePopovers();dropdown.hidden=false;search.focus({preventScroll:true});});
  $('#search-results').addEventListener('click',e=>{if(e.target.closest('button'))dropdown.hidden=true;});
  new MutationObserver(()=>{if($('#search-results').hidden&&!search.value&&$('#search-scope').value!=='slot')dropdown.hidden=true;}).observe($('#search-results'),{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('keydown',event=>{
    const editing=event.target.matches('input,select,textarea,[contenteditable=true]');
    if(event.key==='/'&&!editing){event.preventDefault();search.focus();}
    if(event.key==='Escape'){closePopovers();for(const panel of Object.values(state.panels))if(panel.drawerOpen)panel.closeInspector();dropdown.hidden=true;}
    const dialog=$('#study-guide-drawer')||($('#cib-source-drawer').classList.contains('open')?$('#cib-source-drawer'):null);
    if(event.key==='Tab'&&dialog){const focusable=$$('button:not(:disabled),a[href],input,select,iframe,[tabindex="0"]',dialog).filter(n=>n.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  const syncPressed=()=>{$$('[data-display-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.displayMode===state.displayMode)));$$('[data-level]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.level===state.level)));};
  toolbar.addEventListener('click',()=>queueMicrotask(syncPressed));syncPressed();resize();
}
bindMapToolbar();

if(hasSavedGuide(pageParams))renderGuideLoading();
if (!redirectCibRoute) init();

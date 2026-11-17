import {createViewportAnchor} from "./viewport-anchor-v64.js";
import {direction as humanDirection,displayText,coverage as recordedCoverage,localTaskVerdict,factual,feasibility,localDecisions,selectionSummary,llmReview} from "./verdict-v64.js";
import {decisionLabel,packetFor,unitFor,overviewFor,reviewDisclosure,guideDisclosure,routeProvenance,exactGateReview} from "./local-decisions-v65.js";
const $ = selector => document.querySelector(selector);
const list = value => Array.isArray(value) ? value : [];
const CORPORA = {cib:"Central Intelligence Bulletins",iran:"Iran",vietnam:"Vietnam"};
const TASKS = {redaction:"Redaction",hypothesis:"Hypothesis",reconstruction:"Reconstruction"};
const ARMS = {
  A:{key:"llm_readings",name:"Model extraction + atoms + slot readings + direct questions",origin:"Model slot readings + direct questions"},
  B:{key:"llm_atoms",name:"Same extraction + atoms / no readings or questions",origin:"Shared model extraction + atoms only"},
  C:{key:"llm_local",name:"Same extraction + atoms + local slot readings",origin:"Local grammatical readings / no model questions"}
};
const STAGES = [["01","Question"],["02","Search plan"],["03","Hierarchical diffusion"],["04","Graph retrieval paths"],["05","Saved results"],["06","Findings"]];
const GRAPH_SCOPE = "The full Corpus Map is separate from this question's evidence view. Ordinary map lookup does not inherit the strict cutoff or whole-origin exclusion; a saved Guide Path carries its own case scope. Map context is not automatically eligible proof.";
const state = {report:null,sourceReport:null,catalog:null,row:null,saved:null,gateReview:null,home:false,arm:"A",reading:"",candidate:"",originalPath:0,stage:"01",reference:false,loading:false,pending:"",epoch:0,drawerEpoch:0,flow:null,paths:null,projection:null,compareReadings:false,reviewReading:""};
const conditionCache = new Map();
const projectionCache = new Map();
const originCache = new Map();
const sourceContextCache = new Map();
let request, sourceRequest, flowModule;
if(matchMedia("(max-width:760px)").matches)$("#catalog-browser").open=false;

const viewportAnchor=createViewportAnchor();

// BEGIN SHOWCASE_SELECTION_V66
const SHOWCASE_SELECTION_VERSION = "presentation-selection/6.6";
function canonicalSelectionJSON(value) {
  const ordered = item => Array.isArray(item) ? item.map(ordered) :
    item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,ordered(item[key])])) : item;
  return JSON.stringify(ordered(value)).replace(/[\u007f-\uffff]/g,char=>"\\u"+char.charCodeAt(0).toString(16).padStart(4,"0"));
}
async function embeddedShowcaseSelection(doc=document) {
  const nodes=doc.querySelectorAll("#showcase-selection-v66");
  if(!nodes.length)return null;
  if(nodes.length!==1||nodes[0].tagName!=="SCRIPT"||nodes[0].type!=="application/json")throw Error("The public casebook selection is malformed.");
  let selection;
  try{selection=JSON.parse(nodes[0].textContent);}catch{throw Error("The public casebook selection is not readable JSON.");}
  if(!selection||typeof selection!=="object"||Array.isArray(selection))throw Error("The public casebook selection is malformed.");
  const {sha256:expected,...payload}=selection;
  if(!/^[a-f0-9]{64}$/.test(expected||"")||await sha256(new TextEncoder().encode(canonicalSelectionJSON(payload)))!==expected)throw Error("The public casebook selection failed its integrity check.");
  return selection;
}
function selectShowcaseCatalog(report,selection,sourceByteHash) {
  if(!selection)return null;
  if(selection.version!==SHOWCASE_SELECTION_VERSION||selection.status!=="APPROVED"||
      selection.outcome_informed!==true||selection.benchmark!==false)throw Error("The public casebook selection has not been approved.");
  if(!/^[a-f0-9]{64}$/.test(selection.source_report_sha256||"")||
      selection.source_report_sha256!==sourceByteHash||selection.source_report_run!==report.run_id||
      selection.source_report_digest!==report.sha256)throw Error("The public casebook selection belongs to another source report.");
  if(!Array.isArray(report.cases)||!Array.isArray(selection.presentation)||!Array.isArray(selection.bench)||
      !selection.presentation.length)throw Error("The public casebook selection has no valid groups.");
  const sourceRows=new Map();
  for(const row of report.cases){
    const id=row.case?.case_id;
    if(typeof id!=="string"||!id||sourceRows.has(id))throw Error("The source report has an ambiguous case identity.");
    sourceRows.set(id,row);
  }
  const seenCases=new Set(),seenFamilies=new Set(),cases=[];
  for(const group of ["presentation","bench"])for(const entry of selection[group]){
    const id=entry?.case_id,family=entry?.family_id;
    if(typeof id!=="string"||!sourceRows.has(id)||seenCases.has(id))throw Error("The public casebook selection contains an unknown or repeated case.");
    if(typeof family!=="string"||!family||family.trim()!==family||seenFamilies.has(family))throw Error("The active casebook repeats or omits a fact family.");
    seenCases.add(id);seenFamilies.add(family);
    const source=sourceRows.get(id);
    cases.push({...source,presentation_selection:{...source.presentation_selection,
      group,family_id:family,reason:entry.reason||"",version:SHOWCASE_SELECTION_VERSION,selection_sha256:selection.sha256}});
  }
  return {cases,metadata:{version:SHOWCASE_SELECTION_VERSION,selection_sha256:selection.sha256,
    source_report_run:report.run_id,source_report_sha256:sourceByteHash,source_report_digest:report.sha256,
    source_case_count:report.cases.length,active_case_count:cases.length,
    outcome_informed:true,benchmark:false,native_outputs_modified:false}};
}
// END SHOWCASE_SELECTION_V66
function catalogCases(){return state.catalog?.cases||list(state.report?.cases);}


function el(tag,text,attrs={}) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  for (const [key,value] of Object.entries(attrs)) if (value != null) node.setAttribute(key,String(value));
  return node;
}
function box(...children) { const node=el("div");node.append(...children.filter(Boolean));return node; }
function button(text,fn,className="",attrs={}) { const node=el("button",text,{type:"button",class:className,...attrs});node.addEventListener("click",event=>viewportAnchor.run(()=>fn(event)));return node; }
function note(text,className="note") { return el("p",text,{class:className}); }
function badge(text,kind="") { return el("span",text,{class:"badge "+kind}); }
function heading(text) { return el("h3",text,{class:"section-title"}); }
function short(text,n=12) { const words=String(text||"").trim().split(/\s+/);return words.slice(0,n).join(" ")+(words.length>n?"...":""); }
function title(row) { return row.display_title || row.case.title || short(row.case.query.replace(/^(?:\s*\[REDACTED\]\s*)+/i,"").replace(/\[(?:REDACTED|REDACTION[^\]]*)\]/gi,"masked passage"),11); }
function presentationGroup(row) { const group=row.presentation_selection?.group;return ["presentation","bench","archive"].includes(group)?group:"archive"; }
function queryKind(row) { return row.presentation_selection?.query_kind||row.query_kind||originCache.get(row.case?.case_id+"/0")?.query_kind; }
function analystAlternativeKind(kind) { return typeof kind==="string"&&kind.startsWith("ANALYST_ALTERNATIVE_"); }
function syntheticMaskKind(kind) { return typeof kind==="string"&&/^SYNTHETIC_LITERAL_(?:CABLE|SOURCE)_MASK/.test(kind); }
function queryKindNotice(row) {
  if(syntheticMaskKind(queryKind(row)))return "Synthetic literal source-span mask, not an observed release redaction. The saved question is unchanged and its origin is excluded from evidence.";
  if(analystAlternativeKind(queryKind(row)))return "Analyst-authored alteration of the origin assertion, not verbatim source wording. The saved query is unchanged.";
  return "Synthetic analyst counterhypothesis: analyst-authored, not natural source wording. The saved query is unchanged.";
}
function queryKindBadge(row) {
  const kind=queryKind(row),alternative=analystAlternativeKind(kind),mask=syntheticMaskKind(kind);
  if(kind!=="SYNTHETIC_ANALYST_COUNTERHYPOTHESIS"&&!alternative&&!mask)return null;
  const node=badge(mask?"Synthetic source-span mask":alternative?"Analyst-authored alternative":"Synthetic counterhypothesis","review");node.dataset.testid="synthetic-question-kind";node.dataset.queryKind=kind;
  node.title=kind+(mask?" / source-span mask, not an observed release redaction":" / analyst-authored alteration, not verbatim source wording");return node;
}
function primitive(value) { return value===true?"Yes":value===false?"No":value==null||value===""?"Not supplied":typeof value==="object"?"Not supplied":String(value).replaceAll("_"," "); }
function fmt(value) { return Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:5}):"Not supplied"; }
function fields(entries) { const dl=el("dl",null,{class:"field-list"});for(const [label,value,literal=false] of entries){dl.append(el("dt",label),el("dd",literal&&value!=null?String(value):primitive(value)));}return dl; }
function link(text,path,className="") { const url=localURL(path);return el("a",text,{href:url.pathname+url.search+url.hash,class:className,target:"_blank",rel:"noopener"}); }
function localURL(path) { const url=new URL(path,location.href);if(url.origin!==location.origin||!["http:","https:"].includes(url.protocol))throw Error("Only this local collection server may supply saved data.");return url; }
async function sha256(bytes) { if(!crypto.subtle)throw Error("This browser cannot verify saved data.");return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function getJSON(path,options={}) { return viewportAnchor.run(()=>readJSON(path,options)); }
async function readJSON(path,{hash,signal}={}) {
  const response=await fetch(localURL(path),{cache:"no-store",signal});
  if(!response.ok){const error=Error(`Saved data is unavailable (${response.status}). No result has been substituted.`);error.status=response.status;throw error;}
  const bytes=await response.arrayBuffer();
  if(hash&&(!/^[a-f0-9]{64}$/i.test(hash)||(await sha256(bytes))!==hash.toLowerCase()))throw Error("Saved data failed its integrity check. No result is shown.");
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw Error("The server did not return a readable saved record.");}
}
function caseQuery(extra={}) { return new URLSearchParams({case_id:state.row.case.case_id,config:ARMS[state.arm].key,...extra}); }
function graphURL({node_id,source_id}={}) {
  const c=state.row?.case;
  const params=new URLSearchParams({corpus:c?.corpus||$("#case-corpus").value||"cib"});
  params.set("return_to",location.pathname+location.search);
  if(node_id)params.set("node",node_id);
  if(source_id)params.set("source_id",source_id);
  return "graph-full-v6.html?"+params;
}
function updateNavigation() {
  $("#graph-tab").href=fullGraphURL(state.row?.case.corpus||$("#case-corpus").value||"cib");
  $("#graph-tab").title="Full reference corpus explorer; task evidence boundaries are not inherited.";
  const home=new URL(location.href),workbench=new URL(location.href);home.searchParams.set("view","home");workbench.searchParams.delete("view");
  $("#home-tab").href=home.pathname+home.search;
  $("#workbench-tab").href=workbench.pathname+workbench.search;
  for(const [selector,active] of [["#home-tab",state.home],["#workbench-tab",!state.home]]){if(active)$(selector).setAttribute("aria-current","page");else $(selector).removeAttribute("aria-current");}
}
function fullGraphURL(corpus) { return "graph-full-v6.html?"+new URLSearchParams({corpus,return_to:location.pathname+location.search}); }
function savePosition({push=false}={}) {
  const url=new URL(location.href);
  if(!state.home)url.searchParams.delete("view");
  if(state.row)url.searchParams.set("case",state.row.case.case_id);else url.searchParams.delete("case");
  url.searchParams.set("arm",state.arm);url.searchParams.set("stage",state.stage);
  if(state.reading)url.searchParams.set("reading",state.reading);else url.searchParams.delete("reading");
  if(state.candidate)url.searchParams.set("candidate",state.candidate);else url.searchParams.delete("candidate");
  if($("#case-task").value)url.searchParams.set("task",$("#case-task").value);else url.searchParams.delete("task");
  if($("#case-corpus").value)url.searchParams.set("corpus",$("#case-corpus").value);else url.searchParams.delete("corpus");
  url.searchParams.set("show",$("#case-show").value);
  history[push?"pushState":"replaceState"]({},"",url);
  updateNavigation();
  document.querySelectorAll(".workflow-nav a").forEach(a=>{if(a.dataset.stage===state.stage)a.setAttribute("aria-current","step");else a.removeAttribute("aria-current");});
}
function stagePosition(number,{scroll=true,push=true}={}) { if(scroll)viewportAnchor.cancel();state.stage=number;savePosition({push});if(scroll)document.getElementById("stage-"+number)?.scrollIntoView({block:"start",behavior:"instant"}); }
function stage(number,titleText,label,kind="") {
  const outer=el("section",null,{class:"stage"+(number==="03"?" stage-diffusion":""),id:"stage-"+number});
  const card=el("div",null,{class:"stage-card"}),header=el("header"),body=el("div",null,{class:"stage-body"});
  header.append(el("h2",titleText),badge(label,kind));card.append(header,body);outer.append(el("span",number,{class:"stage-number"}),card);return {outer,body};
}
function showError(message) { $("#page-error").hidden=false;$("#page-error").textContent=message; }
function clearError() { $("#page-error").hidden=true;$("#page-error").textContent=""; }
function destroyVisuals({disconnectCitations=true}={}) { state.flow?.destroy();state.paths?.destroy();state.flow=null;state.paths=null;if(disconnectCitations)citationObserver.disconnect(); }
function pendingRecord(value) { return value&&["PENDING","NOT_RUN","UNAVAILABLE","NOT_PUBLISHED","PREPARING"].includes(String(value.status||value.execution_status||"").toUpperCase()); }
function recordedFailure(value){return !!value&&(!!value.failure||!!value.error||/FAIL|ERROR|BLOCKED|PARSE/i.test(String(value.execution_status||value.status||"")));}
function publicationNote(value) { return value?.provenance_notice||value?.release_note||value?.notice||""; }
function closeDrawer() { sourceRequest?.abort();state.drawerEpoch++;if($("#detail-drawer").open){viewportAnchor.cancel();$("#detail-drawer").close();} }
function openDrawer(titleText,kicker,body,back) {
  viewportAnchor.cancel();
  sourceRequest?.abort();state.drawerEpoch++;
  $("#detail-title").textContent=titleText;$("#detail-kicker").textContent=kicker;
  $("#detail-body").replaceChildren(body);
  $("#detail-back").hidden=!back;$("#detail-back").onclick=back||null;
  if(!$("#detail-drawer").open)$("#detail-drawer").showModal();
  $("#detail-close").focus({preventScroll:true});return state.drawerEpoch;
}
$("#detail-close").addEventListener("click",closeDrawer);
$("#detail-drawer").addEventListener("close",()=>{if(!$("#detail-drawer").open){sourceRequest?.abort();state.drawerEpoch++;}});

function visibleCases() {
  const corpus=$("#case-corpus").value,task=$("#case-task").value,show=$("#case-show").value,search=$("#case-search").value.trim().toLowerCase();
  return catalogCases().filter(r=>(show==="all"||presentationGroup(r)===show)&&(!corpus||r.case.corpus===corpus)&&(!task||r.case.task===task)&&(!search||[r.case.query,r.case.document_id,r.case.case_id,r.display_title].join(" ").toLowerCase().includes(search)));
}
function renderRail() {
  const rows=visibleCases();$("#case-count").textContent=rows.length+" questions";
  $("#case-list").replaceChildren(...rows.map(row=>{
    const b=button("",()=>chooseCase(row),"case-button",{"aria-current":String(state.row?.case.case_id===row.case.case_id),"data-case":row.case.case_id});
    b.append(el("small",`${CORPORA[row.case.corpus]} / ${TASKS[row.case.task]}`,{class:"case-kind"}),el("strong",title(row)),el("small",`${row.case.document_id} / ${row.case.date}`));const kind=queryKindBadge(row);if(kind)b.append(kind);return b;
  }));
  if(!rows.length)$("#case-list").append(note("No published questions match these filters.","empty"));
}
function readingRows() { return list((state.saved?.result?.redaction||state.saved?.result)?.readings); }
function currentReading() { const rows=readingRows();return rows.find(r=>r.reading?.id===state.reading)||rows[0]; }
function candidates() { return list(currentReading()?.candidates).slice(0,5); }
function flowItems() {
  if(state.row.case.task==="redaction")return candidates();
  return list(state.saved?.result?.flow_targets).map(target=>({...target,fill:target.fill||target.label||target.atom_id}));
}
function selectedItem() { return flowItems().find(c=>c.id===state.candidate)||flowItems()[0]; }
function nativeFlow() { return state.saved?.result?.flow||state.saved?.flow_v3||state.saved?.result?.flow_v3; }
function contributor(item) { return state.projection?.candidates?.find(c=>c.id===item?.id)||nativeFlow()?.candidate_flows?.[item?.id]||state.saved?.result?.candidate_flows?.[item?.id]; }

async function chooseCase(row,{push=true,reading,candidate,scroll=false}={}) {
  const epoch=++state.epoch;request?.abort();request=new AbortController();destroyVisuals();state.projection=null;closeDrawer();
  state.home=false;state.row=row;state.saved=null;state.gateReview=null;state.loading=true;state.pending="";state.reference=false;state.originalPath=0;state.reading=reading??"";state.candidate=candidate??"";state.compareReadings=false;state.reviewReading="";
  clearError();renderRail();renderWorkspace();savePosition({push});
  $("#page-state").textContent=`Loading saved arm ${state.arm}; other conditions are not substituted.`;
  const arm=state.arm,key=ARMS[arm].key,cacheKey=state.report.run_id+"/"+row.case.case_id+"/"+key;
  try {
    let detail=conditionCache.get(cacheKey);
    if(!detail){
      detail=await getJSON("/api/condition-v6?"+new URLSearchParams({case_id:row.case.case_id,config:key}),{signal:request.signal});
      if(pendingRecord(detail)&&!detail.case){if(epoch!==state.epoch)return;state.pending=publicationNote(detail)||"The selected v6 condition is not published yet.";state.loading=false;renderWorkspace();$("#page-state").textContent=state.pending;return;}
      for(const field of ["case_id","corpus","task","query","date","document_id","focal_marker"])if(detail.case?.[field]!==row.case[field])throw Error("The saved condition belongs to a different question.");
      const saved=detail.configurations?.[key]??detail.configurations?.[arm];
      if(saved){
        if(saved.config&&![key,arm].includes(saved.config))throw Error("The saved condition does not match the selected arm.");
        const pin=row.configurations?.[key]?.native_checkpoint||row.configurations?.[arm]?.native_checkpoint;
        if(pin&&(saved.native_checkpoint?.sha256!==pin.sha256||saved.native_checkpoint?.path!==pin.path))throw Error("The saved native-checkpoint binding changed.");
        const nativeRun=row.configurations?.[key]?.native_run_id||row.configurations?.[arm]?.native_run_id||state.report.run_id;
        if(saved.run_id&&nativeRun&&saved.run_id!==nativeRun&&saved.frozen_control!==true)throw Error("The saved execution belongs to another publication run.");
      }
      if(!pendingRecord(detail)&&saved?.result&&!pendingRecord(saved)&&!pendingRecord(saved.result))conditionCache.set(cacheKey,detail);
    }
    if(epoch!==state.epoch)return;
    state.row={...detail,selected_demo:row.selected_demo??detail.selected_demo,presentation_selection:row.presentation_selection??detail.presentation_selection,query_kind:row.query_kind??detail.query_kind};state.saved=detail.configurations?.[key]??detail.configurations?.[arm]??null;state.loading=false;
    if(state.saved?.local_decisions_v65){
      const packet=packetFor(state.saved,state.row.case),serialized=JSON.stringify(state.row.case.query).replace(/[\u007f-\uffff]/g,char=>"\\u"+char.charCodeAt(0).toString(16).padStart(4,"0"));
      const queryHash=await sha256(new TextEncoder().encode(serialized));
      if(epoch!==state.epoch)return;
      if(packet.query_sha256!==queryHash||packet.binding.query_sha256!==queryHash)throw Error("The V6.5 decision supplement has another public-query binding.");
      state.gateReview=await exactGateReview(state.saved,packet);
      if(epoch!==state.epoch)return;
    }
    if(!state.saved?.result&&!recordedFailure(state.saved)||pendingRecord(state.saved)||pendingRecord(state.saved?.result)||pendingRecord(detail)){state.pending=publicationNote(state.saved)||publicationNote(detail)||`No completed v6 arm ${arm} execution is published. No older run or other arm is substituted.`;state.saved=null;}
    const rows=readingRows();
    if(!rows.some(r=>r.reading?.id===state.reading)){
      const ordinal=/^reading_(\d+)$/.exec(state.reading);state.reading=(ordinal?rows[Number(ordinal[1])-1]:rows[0])?.reading?.id||"";
    }
    if(!flowItems().some(c=>c.id===state.candidate))state.candidate=flowItems()[0]?.id||"";
    renderWorkspace();renderRail();savePosition();
    $("#page-state").textContent=state.saved?`Arm ${arm} / ${ARMS[arm].name}. Saved execution only.`:state.pending;
    if(state.saved)await hydrateFlow(epoch);
    if(scroll&&epoch===state.epoch&&state.stage!=="01")stagePosition(state.stage,{push:false});
  } catch(error){if(epoch===state.epoch&&error.name!=="AbortError"){state.saved=null;state.loading=false;state.pending="Saved results could not be loaded. See the error above, or try again.";showError(error.message);$("#page-state").textContent="Saved condition could not be loaded.";renderWorkspace();}}
}
function changeFilters() {
  renderRail();if(state.home){renderWorkspace();savePosition({push:true});return;}
  const rows=visibleCases();
  if(!state.row||!rows.some(r=>r.case.case_id===state.row.case.case_id)){
    if(rows.length)return chooseCase(rows[0]);
    state.epoch++;request?.abort();destroyVisuals();state.projection=null;closeDrawer();state.row=null;state.saved=null;state.loading=false;clearError();renderWorkspace();
  }
  savePosition({push:true});
}
for(const id of ["#case-show","#case-corpus","#case-task"])$(id).addEventListener("change",()=>viewportAnchor.run(changeFilters));
$("#case-search").addEventListener("input",renderRail);
$("#arm-select").addEventListener("change",()=>viewportAnchor.run(async()=>{state.arm=$("#arm-select").value;state.reading="";state.candidate="";if(state.row)await chooseCase(list(state.report.cases).find(r=>r.case.case_id===state.row.case.case_id));}));

function renderWorkspace() {
  destroyVisuals();
  const host=$("#case-view");host.replaceChildren();host.setAttribute("aria-busy",String(state.loading));
  $(".workspace-toolbar").hidden=state.home;
  if(state.home){renderHome();return;}
  if(!state.row){host.append(note("Choose a saved question from the catalog.","empty"));return;}
  const c=state.row.case;
  const hero=el("header",null,{class:"case-hero"});hero.append(el("p",`${CORPORA[c.corpus]} / ${TASKS[c.task]}`,{class:"eyebrow"}),el("h1",title(state.row)));
  const meta=el("div",null,{class:"case-meta"});meta.append(el("span",c.document_id),el("span",c.date),el("span",`Arm ${state.arm} / ${ARMS[state.arm].name}`));hero.append(meta);host.append(hero);
  const nav=el("nav",null,{class:"workflow-nav","aria-label":"Pipeline stages"});
  for(const [number,name] of STAGES){const a=el("a",`${number} / ${name}`,{href:"#stage-"+number,"data-stage":number});if(number===state.stage)a.setAttribute("aria-current","step");a.onclick=e=>{e.preventDefault();stagePosition(number);};nav.append(a);}host.append(nav);
  const workflow=el("div",null,{class:"workflow","data-arm":state.arm});host.append(workflow);
  workflow.append(renderQuestion());
  if(state.loading){workflow.append(el("p",`Loading saved results for arm ${state.arm}. Source verification may take a moment.`,{class:"empty",role:"status","aria-live":"polite","data-testid":"condition-loading"}));return;}
  if(!state.saved){workflow.append(note(state.pending||"No completed result is currently loaded for this selected arm. No archived result is substituted.","empty"));return;}
  if(state.saved.frozen_control===true||state.saved.fallback===true||state.row.fallback===true)workflow.append(note(publicationNote(state.saved)||"Explicit frozen control / fallback record. This is not a new v6 execution.","notice"));
  else if(publicationNote(state.saved))workflow.append(note(publicationNote(state.saved),"notice"));
  workflow.append(renderPlan(),renderDiffusion(),renderPathsStage(),renderResultsStage(),renderFindings());
  host.setAttribute("aria-busy","false");
}

function renderHome() {
  const host=$("#case-view");host.replaceChildren();host.setAttribute("aria-busy","false");
  const hero=el("header",null,{class:"case-hero"});hero.append(el("p","The source collections",{class:"eyebrow"}),el("h1","Explore a corpus"),note("Open the full reference graph, or return to the saved analyst questions for a source-bound task."));host.append(hero);
  host.append(note("Full corpus graphs do not inherit a question's cutoff or whole-origin exclusion. Saved Guide Paths carry explicit case bindings; ordinary map lookup remains context, not eligible proof.","notice"));
  const cards=el("div",null,{class:"corpus-cards"});
  const descriptions={iran:"Diplomatic cables / Iran collection",vietnam:"Diplomatic cables / Vietnam collection",cib:"Paired-release Central Intelligence Bulletins"};
  for(const corpus of ["iran","vietnam","cib"]){
    const rows=catalogCases().filter(row=>row.case.corpus===corpus),card=el("section",null,{class:"corpus-card","data-testid":"corpus-card","data-corpus":corpus});
    const selected=rows.filter(row=>presentationGroup(row)==="presentation").length,bench=rows.filter(row=>presentationGroup(row)==="bench").length,archived=rows.filter(row=>presentationGroup(row)==="archive").length;
    const counts=state.catalog?`${selected} presentation / ${bench} bench / ${rows.length} current public questions`:`${selected} presentation / ${bench} bench / ${archived} archive / ${rows.length} evaluated questions`;
    card.append(el("span",corpus==="cib"?"CIB":corpus==="iran"?"IR":"VN",{class:"corpus-mark","aria-hidden":"true"}),el("h2",CORPORA[corpus]),note(descriptions[corpus]),el("p",counts,{class:"note","data-testid":"corpus-selection-counts","data-presentation-count":selected,"data-bench-count":bench,"data-archive-count":archived}));
    const actions=el("div",null,{class:"actions"});actions.append(link("Open full knowledge graph",fullGraphURL(corpus),"button primary"),el("a","Open saved questions",{href:"workbench-v6.html?"+new URLSearchParams({corpus,show:$("#case-show").value}),class:"button"}));card.append(actions);cards.append(card);
  }
  host.append(cards);renderReserveCatalogue(host);$("#page-state").textContent="Corpus home / published sources and saved questions only.";updateNavigation();
}

function renderReserveCatalogue(host) {
  if(state.catalog)return;
  const proposals=list(state.report.reserve_proposals);if(!proposals.length)return;
  const corpus=$("#case-corpus").value,task=$("#case-task").value,rows=proposals.filter(p=>(!corpus||p.corpus===corpus)&&(!task||p.task===task));
  const section=el("section",null,{class:"reserve-catalogue","data-testid":"reserve-catalogue"});
  section.append(heading("Reserve source catalogue"),note("Source/legacy proposals, not completed current executions.","notice"),note(`${rows.length} of ${proposals.length} proposals match the collection/task filters. Separate from the evaluated bench; fixed/legacy labels are not current-execution verdicts.`));
  if(rows.length)section.append(compactEvidence(rows,{label:"source/legacy proposals",render:proposal=>{
    const card=el("article",null,{class:"assembly-card reserve-proposal","data-testid":"reserve-proposal","data-proposal-id":proposal.id});
    card.append(el("p",`${CORPORA[proposal.corpus]||"Collection not supplied"} / ${TASKS[proposal.task]||"Task not supplied"}`,{class:"eyebrow"}),el("h3",short(proposal.query||proposal.name||"Source/legacy proposal",18)));
    const synthetic=queryKindBadge({query_kind:proposal.kind});if(synthetic)card.append(synthetic);
    card.append(note(proposal.scope||"Scope not supplied."),fields([["Fixed/legacy status / not current execution",proposal.current_fixed_status,true],["Proposal kind",primitive(proposal.kind).toLowerCase()],["Origin source",proposal.origin||proposal.origin_page_id,true],["Source documents",list(proposal.documents).join(", ")||"Not supplied",true],["Source pages",list(proposal.evidence_page_ids).join(", ")||"Not supplied",true]]));
    if(proposal.query){const query=el("details");query.append(el("summary","Proposed analyst question / unchanged"),el("p",proposal.query,{class:"cue"}));card.append(query);}
    else card.append(note("Query text is not supplied in this public catalogue."));
    const saved=list(state.report.cases).find(row=>row.case.case_id===proposal.id);
    if(saved)card.append(el("a","Open saved case",{class:"button",href:"workbench-v6.html?"+new URLSearchParams({case:saved.case.case_id,show:presentationGroup(saved)})}));
    return card;
  }}));else section.append(note("No source/legacy proposals match these collection/task filters.","empty"));
  host.append(section);
}

function renderQuestion() {
  const c=state.row.case,s=stage("01","Analyst question and provenance",TASKS[c.task]);
  const query=el("div",null,{class:"query-block","data-testid":"query-text"}),at=c.focal_marker?c.query.indexOf(c.focal_marker):-1;
  const key=state.row.reference_answer;
  if(at>=0){query.append(document.createTextNode(c.query.slice(0,at)),button(state.reference&&key!=null?String(key):c.focal_marker,toggleReference,"focal-mask",{"aria-pressed":state.reference,"data-testid":"focal-mask",...(key==null?{disabled:""}:{})}),document.createTextNode(c.query.slice(at+c.focal_marker.length)));}
  else query.textContent=c.query;
  const questionKind=queryKindBadge(state.row);if(questionKind)s.body.append(questionKind);s.body.append(query);
  const actions=el("div",null,{class:"actions"});
  actions.append(button("Original input",()=>openDrawer("Original analyst question","Saved input / unchanged",el("div",c.query,{class:"raw-text","data-testid":"raw-query"}))));
  if(key!=null)actions.append(button(state.reference?"Hide reference":"Reveal reference",toggleReference,"",{"data-testid":"reference-toggle"}));
  actions.append(link("Corpus Map / separate view",graphURL(),"button"));s.body.append(actions,note(GRAPH_SCOPE));
  if(state.reference&&key!=null){const ref=el("section",null,{class:"reference-box","data-testid":"reference-key"});ref.append(badge("Post-run reference / not a system proposal","review"),el("strong",key),note("Presentation overlay only. The saved masked input and evidence policy are unchanged."));s.body.append(ref);}
  const kind=state.row.reference_answer_kind;
  const kindNote=note(questionKind?queryKindNotice(state.row):kind==="synthetic_source_span"?"Synthetic source-span mask, not an observed release redaction.":kind==="paired_earlier_redacted_later_revealed"?"Paired-release redaction. The later reference is not eligible evidence.":"Source-derived complete question; its presence is not proof of its truth.");kindNote.dataset.testid="query-kind-note";s.body.append(kindNote);
  const origin=el("div",null,{class:"source-origin"});origin.append(el("span",`Origin: ${c.document_id} / ${c.date}`));
  const provenance=el("section",null,{class:"origin-panel","data-testid":"origin-panel"});
  provenance.append(heading("Where this query came from"),note("Loading the audited source proof. This privileged origin is not evidence for the result."));
  s.body.append(origin,provenance,note(`Evidence must predate ${c.date}. The entire origin document is excluded. Unknown adjacent masks stay visible.`));
  queueMicrotask(()=>loadOrigin(provenance,{...c},state.reference));return s.outer;
}
function toggleReference(){state.reference=!state.reference;$("#stage-01").replaceWith(renderQuestion());if($("#stage-06"))$("#stage-06").replaceWith(renderFindings());}

function highlightedText(text,anchors,attrs={}) {
  const host=el("div",null,{class:"source-document",...attrs}),chars=Array.from(text);let cursor=0;
  for(const a of [...anchors].sort((a,b)=>a.start-b.start)){
    if(!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<cursor||a.end<=a.start||a.end>chars.length||chars.slice(a.start,a.end).join("")!==a.text)throw Error("The exact source quotation does not replay.");
    host.append(document.createTextNode(chars.slice(cursor,a.start).join("")),el("mark",a.text));cursor=a.end;
  }
  host.append(document.createTextNode(chars.slice(cursor).join("")));return host;
}
async function textDigest(text) {
  const serialized=JSON.stringify(text).replace(/[\u007f-\uffff]/g,char=>"\\u"+char.charCodeAt(0).toString(16).padStart(4,"0"));
  return sha256(new TextEncoder().encode(serialized));
}
function paragraphContext(text,proof) {
  const chars=Array.from(text),before=chars.slice(0,proof.start).join(""),after=chars.slice(proof.end).join("");
  // Paragraph/numbered-section boundaries, never a fabricated sentence snippet.
  const breaks=[...before.matchAll(/\n\s*\n|\n(?=\d+\.\s|--[A-Z]\.\s)/g)];
  const boundary=breaks.at(-1),start=boundary?Array.from(before.slice(0,boundary.index+boundary[0].length)).length:0;
  const next=/\n\s*\n|\n(?=\d+\.\s|--[A-Z]\.\s)/.exec(after),end=next?proof.end+Array.from(after.slice(0,next.index)).length:chars.length;
  return {text:chars.slice(start,end).join(""),anchors:[{start:proof.start-start,end:proof.end-start,text:proof.text}]};
}
async function loadOrigin(host,c,reveal) {
  const key=c.case_id+"/"+(reveal?"1":"0");
  try{
    let data=originCache.get(key);
    if(!data){data=await getJSON("/api/origin-v63?"+new URLSearchParams({case_id:c.case_id,reveal_focal:reveal?"1":"0"}));
      if(data.case_id!==c.case_id||data.query!==c.query||data.document_id!==c.document_id||data.date!==c.date||data.eligible_evidence!==false||data.focal_revealed!==(c.task==="redaction"&&reveal)||await textDigest(data.text)!==data.text_sha256||await textDigest(c.query)!==data.query_sha256)throw Error("Origin provenance does not match the saved query or text binding.");
      if(data.full_transcription&&await textDigest(data.full_transcription.text)!==data.full_transcription.text_sha256)throw Error("Full original transcription failed its body hash check.");
      originCache.set(key,data);
    }
    if(!host.isConnected||state.row.case.case_id!==c.case_id||state.reference!==reveal)return;
    const kindBadge=queryKindBadge(state.row);
    if(kindBadge){
      const body=host.closest(".stage-body"),previous=body.querySelector(":scope > [data-testid=synthetic-question-kind]");
      if(previous)previous.replaceWith(kindBadge);else body.insertBefore(kindBadge,body.querySelector("[data-testid=query-text]"));
      body.querySelector("[data-testid=query-kind-note]").textContent=queryKindNotice(state.row);
    }
    const category=({CIB_SHARED_VISIBLE_TEXT:"Shared-visible / not a secret reveal",CIB_VERIFIED_REVEAL:"Verified CIB reveal",SECRET_CABLE_RAW_BODY_VERIFIED:"Audited SECRET cable",CABLE_CLASSIFICATION_IN_SEALED_PROOF:"Recorded SECRET source / segment",CIB_UNIT_UNVERIFIED:"CIB unit unverified",CIB_MIXED_OR_UNVERIFIED_UNITS:"CIB origin not fully certified"})[data.source_category]||"Source category not supplied";
    const summary=el("div",null,{class:"origin-summary"});summary.append(badge(category,"review"),el("span",data.derivation));
    const body=box(heading("Query origin"),summary,note("Provenance only, not eligible evidence. The executed question above is unchanged."));
    if(data.warning&&data.source_category?.startsWith("CIB_"))body.append(note(data.warning,"origin-category-warning"));
    if(data.anchors.length){
      const a=data.anchors[0],context=paragraphContext(data.text,a);
      const excerpt=highlightedText(context.text,context.anchors,{"data-testid":"origin-paragraph"});
      const details=el("details",null,{class:"origin-paragraph-expand"});details.append(el("summary","Original source paragraph / exact anchor"),excerpt);
      if(Array.from(a.text).length===Array.from(data.text).length)details.append(note("The saved anchor covers the audited transcription. A narrower per-claim derivation was not recorded; no precise paraphrase alignment is invented."));
      body.append(details);
    }
    const actions=el("div",null,{class:"actions"});actions.append(button(data.full_transcription?"Open full original cable transcription":"Open audited origin page / segment",()=>originDrawer(data),"",{"data-testid":"origin-transcription"}));
    if(data.pdf)actions.append(originPDF(data));
    if(c.task==="redaction")actions.append(button(reveal?"Hide focal origin reference":"Explicitly reveal focal origin reference",toggleReference,"",{"data-testid":"origin-reveal"}));
    const audit=el("details",null,{class:"origin-audit-details"});audit.append(el("summary","Provenance details / source verification"),fields([["Origin",`${data.document_id} / ${data.date}`,true],["Recorded classification / not proof of reveal",data.classification],["Verified source category",data.source_category,true],["Canonical unit / raw-body audit verified",data.unit_verified],["Secret-derived query certified by this source audit",data.secret_derived],["Recorded construction",data.query_kind,true]]),note(data.source_review||"Source mapping is not independent historical validation."),note(data.scope),note("Source proof SHA-256: "+data.proof_sha256,"proof-hash"));
    const mapping=originMappingDetails(data);if(mapping)audit.append(mapping);
    if(data.warning&&!data.source_category?.startsWith("CIB_"))audit.append(note(data.warning));
    body.append(actions,audit);host.replaceChildren(body);
  }catch(error){if(host.isConnected)host.replaceChildren(heading("Origin provenance unavailable"),note(error.message+" No evidence API or arbitrary private file is used as a fallback.","error-card"));}
}
function originPDF(data) {
  const mapping=data.source_mapping?.kind==="withholding_notice_block"?data.source_mapping:null;
  const label=mapping?(data.pdf.release==="later"?"Origin PDF / later content":"Origin PDF / earlier withholding notice"):`Origin PDF / ${data.pdf.release} release`;
  const pdf=link(label+(data.pdf.page?` / page ${data.pdf.page}`:" / page not recorded"),"/api/cib-pdf?"+new URLSearchParams({doc_id:data.document_id,release:data.pdf.release})+(Number.isInteger(data.pdf.page)&&data.pdf.page>0?"#page="+data.pdf.page:""),"button");
  if(!mapping)return pdf;
  const host=el("div",null,{"data-testid":"origin-pdf-proxy"});host.append(pdf,note(`Earlier page ${mapping.earlier_notice_page??"not recorded"} is a withholding-notice proxy, not the same-content page. See provenance details for the whole-region mapping.`));return host;
}
function originMappingDetails(data) {
  const m=data.source_mapping;if(m?.kind!=="withholding_notice_block")return null;
  const boundary=side=>{const a=m.boundary_anchors?.[side]||{};return `earlier ${a.earlier_page??"unrecorded"} / later ${a.later_page??"unrecorded"}; accepted: ${primitive(a.accepted)}`;};
  const panel=el("section",null,{"data-testid":"origin-source-mapping"});panel.append(heading("Whole-region withholding proxy / not page-for-page"),fields([
    ["Earlier notice / not a same-content page",m.earlier_notice_page],["Later content page",m.later_content_page],
    ["Notice declares / region covers",`${m.declared_page_count??"unrecorded"} next pages / ${m.covered_page_count??"unrecorded"} covered pages`,true],
    ["Covered later pages",list(m.later_pages).join(", ")||"Not recorded",true],["Count interpretation",m.count_interpretation,true],
    ["Mapping policy",m.policy,true],["Left boundary anchor",boundary("left"),true],["Right boundary anchor",boundary("right"),true],
    ["Source annotation pending",m.source_annotation_pending]]),note("The earlier locator is a notice for a withheld region, not a surviving copy of this later content page. This mapping alone does not certify absence across the whole earlier release."));
  if(m.notice_quote)panel.append(el("blockquote",m.notice_quote,{class:"cue"}));
  if(m.source_annotation_pending)panel.append(note("Source annotation remains pending; the recorded mapping is not final source annotation."));
  if(Number.isInteger(m.earlier_notice_page)&&m.earlier_notice_page>0)panel.append(link(`Earlier withholding notice / page ${m.earlier_notice_page}`,"/api/cib-pdf?"+new URLSearchParams({doc_id:data.document_id,release:"earlier"})+"#page="+m.earlier_notice_page,"button"));
  return panel;
}
function originDrawer(data) {
  const transcription=data.full_transcription||data;
  const body=box(note(data.notice,"notice"),fields([["Document",data.document_id,true],["Source",data.source_id,true],["Recorded classification",data.classification],["Source category",data.source_category,true],["Display scope",transcription.scope]]),note("Verified sealed source proof and transcription hash. Highlights use exact Unicode character offsets; the origin is excluded from every evidence count.","verified"));
  if(data.warning)body.append(note(data.warning,"origin-category-warning"));
  if(data.pdf)body.append(originPDF(data));
  const mapping=originMappingDetails(data);if(mapping)body.append(mapping);
  body.append(highlightedText(transcription.text,transcription.anchors,{"data-testid":"origin-document"}));
  openDrawer("Query origin / audited transcription","Privileged provenance / not eligible evidence",body);
}

function inspectRow(id,text,meta,fn,attrs={}) { const b=button("",fn,"inspect-row",attrs);b.append(el("span",id,{class:"row-id"}),el("span",text,{class:"row-copy"}));if(meta)b.append(el("span",meta,{class:"row-meta"}));return b; }
function readingText(r) { return r.explanation||r.notes||"No saved interpretation explanation was published."; }
function readingControl(testid) {
  const label=el("label","Choose the active reading / controls stages 03-05"),select=el("select",null,{"aria-label":"Search plan reading","data-testid":testid});
  for(const row of readingRows())select.append(el("option",`${row.reading.id} / ${primitive(row.reading.form)}`,{value:row.reading.id}));
  select.value=state.reading;
  select.onchange=()=>viewportAnchor.run(async()=>{state.reading=select.value;state.candidate="";await changeReading();});
  const panel=el("section",null,{class:"reading-master","data-testid":"reading-master"});label.append(select);panel.append(heading("One reading. All downstream results."),label,note("This is the only reading selector for stages 02-05. It selects the targets, routes and ranked fills you inspect; it does not rerun inference or change the arm's shared saved diffusion."));return panel;
}
function readingDetail(r) {
  const body=box(note(readingText(r)),note(`${ARMS[state.arm].origin}. This is an interpretation of visible query text, not an answer or a support verdict.`,"notice"),fields([["Form",r.form],["Role",r.role],["Referent kind",r.target_kind||r.referent_kind],["Number",r.grammatical_number],["Finite clause",r.finite]]));
  for(const [label,text] of [["Left boundary",r.left_quote],["Right boundary",r.right_quote],["Attachment cue",r.attachment_quote],["Kind cue",r.kind_cue_quote]])if(text)body.append(heading(label),el("blockquote",text,{class:"cue"}));
  openDrawer("Reading "+r.id,`Arm ${state.arm} / ${ARMS[state.arm].origin}`,body);
}
function renderPlan() {
  const s=stage("02","Search clues, readings and questions",ARMS[state.arm].origin,state.arm==="A"?"model":"");
  const failure=failureReceipt();if(failure)s.body.append(failure);
  const plan=state.saved.plan||{},atoms=list(plan.atoms),reads=list(plan.slot_readings),leads=list(plan.leads);
  if(readingRows().length)s.body.append(readingControl("plan-reading-select"));
  s.body.append(modelStages(),note("Atoms and discovery questions guide source search. Their presence is not substantive evidence for a proposed answer."));
  const rows=el("div",null,{class:"compact-list"});for(const atom of atoms)rows.append(inspectRow(atom.id,atom.text||atom.source_quote,atom.required===false?"Optional":"Required",()=>atomDetail(atom),{"data-testid":"plan-atom"}));
  s.body.append(rows);if(!atoms.length)s.body.append(note("No shared atoms were published for this condition.","empty"));
  const extraction=plan.extractions||{};const counts=Object.entries(extraction).filter(([,v])=>Array.isArray(v)).map(([k,v])=>`${v.length} ${k}`);
  if(counts.length)s.body.append(note("Shared query extraction: "+counts.join(" / ")));
  s.body.append(heading("Saved interpretation"));
  if(leads.length)s.body.append(note("Question IDs (for example q1) are saved identifiers, not scores or a sequence of reasoning. Linked s1/s2 identifiers refer to slot readings, while a1/a2 refer to atoms. The model produced direct questions from the visible query and its shared extraction/atoms, with literal anchors. No origin, answer or retrieved evidence was in that planning input; zero questions is allowed.","notice"));
  if(!reads.length)s.body.append(note("No planned slot readings were supplied for this task. A mechanical pool is not a model interpretation."));
  for(const r of reads.filter(r=>!state.reading||r.id===state.reading)){
    const card=el("article",null,{class:"reading-plan","data-reading-id":r.id});card.append(el("h3",`${r.id} / ${primitive(r.form)}`),note(readingText(r)),button("Reading details",()=>readingDetail(r)));
    const linked=leads.filter(l=>list(l.reading_ids).includes(r.id));
    if(linked.length){const details=el("details"),summary=el("summary",`${linked.length} direct discovery question${linked.length===1?"":"s"} linked to reading ${r.id}`);details.append(summary);for(const l of linked)details.append(inspectRow(l.id,l.question,"Reading IDs: "+list(l.reading_ids).join(", "),()=>leadDetail(l),{"data-testid":"discovery-question"}));card.append(details);}s.body.append(card);
  }
  const unlinked=leads.filter(l=>!list(l.reading_ids).length);
  if(unlinked.length){s.body.append(heading("Context discovery questions"));for(const lead of unlinked)s.body.append(inspectRow(lead.id,lead.question,"Query-derived",()=>leadDetail(lead),{"data-testid":"discovery-question"}));}
  s.body.append(button("Saved prompts and instructions",promptDrawer,"",{"data-testid":"planning-instructions"}));return s.outer;
}
function leadDetail(lead) { const body=box(note(lead.question,"notice"),fields([["Question ID / not a score",lead.id,true],["Linked reading IDs",list(lead.reading_ids).join(", ")||"No reading link",true],["Linked atom IDs",list(lead.atom_ids).join(", ")||"No atom link",true]]),note(lead.rationale||lead.reason||"Model-authored direct question from visible query anchors and shared extraction/atoms, not a source-established event."));for(const q of list(lead.anchor_quotes))body.append(el("blockquote",typeof q==="string"?q:q.text,{class:"cue"}));openDrawer("Discovery question "+lead.id,`Arm ${state.arm} / saved plan`,body); }
function modelStages() {
  const host=el("section",null,{class:"model-stages","data-testid":"model-stages"});
  host.append(heading("What called a model, and when?"),note("Saved requests, never live calls. A/B/C reuse the same model extraction and atoms. The local engine retrieves and decides offline; an independent post-run LLM judge and analyst digest cannot change that result."));
  const stages=[["1. Shared model extraction","KG 2.32 entities, events, claims and relations from the visible query only."],["2. Shared model atoms","Source-faithful propositions from the visible query and extraction. Any saved repair/retry is listed below."],["3. Arm-specific planning",state.arm==="A"?"Model slot readings for redaction plus direct-context questions; H/R have no slot readings.":state.arm==="B"?"No readings or questions. The local source-derived construction pool is not a model interpretation.":"Local grammatical slot readings for redaction; no model readings/questions. H/R repeats are consistency controls."]];
  for(const [title,text] of stages)host.append(el("h4",title),note(text));
  const prompts=list(state.saved.planning_prompts);
  host.append(note("Published request receipts for this condition: "+(prompts.map(p=>`${p.stage} [${p.model||"model unrecorded"}]`).join("; ")||"None published. No call count inferred.")+". Shared receipts can repeat across arms; they are not independent new calls."));
  return host;
}
function promptDrawer() {
  const prompts=list(state.saved.planning_prompts),body=box(note("Actual published frozen request instructions. Nothing is reconstructed from current code or executed here.","notice"));
  if(!prompts.length)body.append(note("No saved prompt text was published for this arm. No model instructions are substituted.","empty"));
  for(const item of prompts){const section=el("section");section.append(heading(item.stage||"Saved request"),badge(item.model||"Model not supplied","model"),el("div",typeof item.prompt==="string"?item.prompt:"Exact request text was not supplied.",{class:"raw-text","data-testid":"frozen-prompt"}));body.append(section);}openDrawer("Saved planning instructions",`Arm ${state.arm} / no live calls`,body);
}

function renderDiffusion() {
  const s=stage("03","Hierarchical diffusion","Saved numerical replay");
  const r=state.saved.result||{},retrieval=r.retrieval||{},scope=state.saved.inspection_scope||{};
  const metrics=el("div",null,{class:"metric-strip"});
  for(const [value,label] of [[scope.eligible_pages_scored??retrieval.eligible_pages,"eligible pages scored"],[scope.primary_page_count??r.source_pages_inspected??retrieval.pages_admitted,"primary pages inspected"],[retrieval.document_budget,"document admission cap"]])if(Number.isFinite(value)){const m=el("div",null,{class:"metric"});m.append(el("strong",fmt(value)),el("span",label));metrics.append(m);}
  s.body.append(metrics);
  const grid=el("div",null,{class:"diffusion-grid"}),host=el("div",null,{id:"diffusion-v6",class:"flow-host","data-testid":"flow-host","aria-label":`Hierarchical diffusion replay / arm ${state.arm}`});
  host.append(note("Loading the bound hierarchy projection...","empty"));
  const aside=el("aside",null,{class:"diffusion-context","aria-label":"Routing and evidence boundaries"});
  const documents=el("section",null,{class:"flow-sidecard document-panel",id:"document-panel-v6"});documents.append(el("h3","Relevant documents"),el("div",null,{id:"flow-documents-v6"}));
  const route=el("section",null,{class:"flow-sidecard"});route.append(el("h3","Routing, not a verdict"),note("Published atomic clues and other saved starters enter the graph in parallel. The original query remains in Stage 01; this page never rematches it."),note("This arm's searches share one saved diffusion. Choosing a reading changes the displayed targets and fill ranking, not the saved transition matrix."),diffusionFormula(),note("Each step combines restart at the query matches with transport over the saved transition matrix. Alpha is the transport fraction, p the restart distribution, and x the relevance vector. Routing mass is not a probability of truth."));
  const policy=el("section",null,{class:"flow-sidecard"});policy.append(el("h3","One pinned source view"),note(`Strictly before ${state.row.case.date}. Entire origin excluded.`),note(state.row.case.corpus==="cib"?"Earlier-visible CIB source material only.":"Bound CONFIDENTIAL cable evidence view only."),note("Identity and hierarchy assignments are retrospective. Display and inspection limits are not corpus completeness."));
  aside.append(documents,route,policy);grid.append(host,aside);s.body.append(grid);return s.outer;
}

function diffusionFormula() {
  const ns="http://www.w3.org/1998/Math/MathML";
  const m=(tag,text,...children)=>{const node=document.createElementNS(ns,tag);if(text)node.textContent=text;node.append(...children);return node;};
  const math=m("math",null,m("mrow",null,
    m("msub",null,m("mi","x"),m("mrow",null,m("mi","t"),m("mo","+"),m("mn","1"))),
    m("mo","="),m("mo","("),m("mn","1"),m("mo","\u2212"),m("mi","\u03b1"),m("mo",")"),m("mi","p"),
    m("mo","+"),m("mi","\u03b1"),m("msup",null,m("mi","P"),m("mi","T")),m("msub",null,m("mi","x"),m("mi","t"))));
  math.setAttribute("display","block");math.setAttribute("aria-label","x at t plus one equals one minus alpha times p plus alpha times transpose P times x at t");return math;
}

function edgeDrawer(edge) {
  const nav=edge.kind==="NAVIGATION",nodes=new Map(list(state.projection?.nodes).map(n=>[n.id,n]));
  const body=box(note(nav?"Hierarchy navigation moves between a member and its community, theme or domain container. This is a navigation assignment, not historical evidence or a source assertion.":"A source connection associates states through a saved source unit. An attached quotation supplies provenance for that association; it does not necessarily assert a historical relationship between the endpoints or establish the completed claim.","notice"),
    fields([["From",nodes.get(edge.source)?.label||edge.source,true],["To",nodes.get(edge.target)?.label||edge.target,true],["Connection",edge.kind],["Transition / not truth confidence",edge.transition]]));
  if(nav){
    const a=nodes.get(edge.source),b=nodes.get(edge.target),membership=a?.parent_id===b?.id||b?.parent_id===a?.id;
    body.append(note(membership?"The saved parent assignment confirms this membership in the projected hierarchy.":"The saved edge is marked navigation; a direct parent assignment was not supplied for these two rows. No membership fact beyond the saved connection is asserted."));
  }
  const proofs=list(edge.citations);for(const proof of proofs)body.append(sourceButton(proof));
  if(!proofs.length)body.append(note("No localized source citation is attached to this connection. This is unquoted transport, not quoted evidence. Candidate quotations are not substituted for edge proof."));
  const localized=proofs.some(p=>typeof p.text==="string"&&p.text.length&&Number.isInteger(p.start)&&Number.isInteger(p.end)&&p.end>p.start&&p.canonical_page_id);
  openDrawer(nav?"Navigation connection":"Saved source connection",nav?"Dashed gold / membership, not facts":localized?"Solid teal / attached source quotations":"Unquoted saved transport",body);
}

async function hydrateFlow(epoch) {
  if(!state.saved)return;
  const host=$("#diffusion-v6"),pathsHost=$("#retrieval-paths-v6");if(!host||!pathsHost)return;
  if((recordedFailure(state.saved.result)||recordedFailure(state.saved))&&!nativeFlow()){
    host.replaceChildren(note("The saved execution failed. Its actual receipt is shown in stages 02 and 05; no numerical replay is substituted.","empty"));renderPaths();return;
  }
  const params=caseQuery({reading:state.reading,limit:"1024"});
  const cacheKey=state.report.run_id+"/"+params;
  try {
    let data=projectionCache.get(cacheKey);
    if(!data){data=await getJSON("/api/flow-v6?"+params,{signal:request?.signal});if(!pendingRecord(data))projectionCache.set(cacheKey,data);}
    if(epoch!==state.epoch||!host.isConnected)return;
    const projection=data.projection||data.flow||data;
    if(projection.case_id&&projection.case_id!==state.row.case.case_id)throw Error("The flow projection belongs to another case.");
    if(projection.config&&![ARMS[state.arm].key,state.arm].includes(projection.config))throw Error("The flow projection belongs to another arm.");
    if(projection.reading_id!=null&&projection.reading_id!==state.reading)throw Error("The flow projection belongs to another reading.");
    if(!Array.isArray(projection.nodes)||!Array.isArray(projection.frames))throw Error("The hierarchy projection is not a readable saved flow.");
    state.projection=projection;
    flowModule ||= import("./flow-view-v6.js");
    const {mountFlow,mountPaths}=await flowModule;
    if(epoch!==state.epoch||!host.isConnected)return;
    host.replaceChildren();
    const callbacks={projection,formatDirection:humanDirection,
      localDecisionFor:item=>newDecision(item),onLocalDecision:item=>decisionDrawer(item),derivedGuideDisclosure:guideDisclosure,formatRouteProvenance:routeProvenance,
      preserveViewport:fn=>viewportAnchor.run(fn),onLayoutChange:()=>viewportAnchor.schedule(),onBeforeNavigate:()=>viewportAnchor.cancel(),
      onSource:proof=>{if(epoch===state.epoch)sourceDrawer(proof);},
      onNode:node=>{if(epoch===state.epoch)nodeDrawer(node);},
      onEdge:edge=>{if(epoch===state.epoch)edgeDrawer(edge);},
      onSelectCandidate:item=>{if(epoch===state.epoch)selectCandidate(typeof item==="string"?item:item?.id,{fromFlow:true});}
    };
    const instance=await mountFlow(host,callbacks);
    if(epoch!==state.epoch){instance?.destroy();return;}
    state.flow=instance;
    state.flow?.selectCandidate?.(state.candidate);
    if(typeof mountPaths==="function"){
      pathsHost.replaceChildren();
      const paths=await mountPaths(pathsHost,{...callbacks,onGuidePath:value=>{if(epoch===state.epoch)guidePath(value);}});
      if(epoch!==state.epoch){paths?.destroy();return;}state.paths=paths;state.paths?.selectCandidate?.(state.candidate);
    }else renderPaths();
    renderDocuments();
  } catch(error){
    if(epoch!==state.epoch||error.name==="AbortError"||!host.isConnected)return;
    destroyVisuals({disconnectCitations:false});
    host.replaceChildren(note("The v6 numerical projection or renderer is unavailable. Saved source paths remain inspectable below; no graph has been fabricated.","empty"),note(error.message));
    renderPaths();
  }
}

function renderPathsStage() {
  const s=stage("04","Graph retrieval paths","Native-saved and derived provenance");s.outer.setAttribute("data-testid","paths-stage");
  s.body.append(note("Follow the saved route to a source and its readout. A graph hop, document readout and substantive support decision are different operations."),el("div",null,{id:"derived-decision-guide-v65"}),el("div",null,{id:"retrieval-paths-v6"}));
  queueMicrotask(renderDecisionGuide);
  queueMicrotask(renderPaths);return s.outer;
}
function renderPaths() {
  if(state.paths)return;
  const host=$("#retrieval-paths-v6");if(!host)return;host.replaceChildren();
  const item=selectedItem(),trace=contributor(item);
  host.append(note("Selected saved item: "+(item?.fill||"none"),"notice"));
  if(!trace){host.append(note("No saved contributor routes were supplied for this item. None are inferred from nearby graph nodes.","empty"));return;}
  host.append(note(trace.readout_explanation||((trace.binding==="source_page_readout")?"Source-page contributors are context for an unbound phrase, not its graph identity.":"Saved routing witnesses describe relevance, not factual entailment.")));
  const routes=list(trace.routes||trace.witnesses||trace.paths).slice(0,3);
  for(const [i,route] of routes.entries()){
    const provenance=routeProvenance(route),card=el("section",null,{class:"path-card path-chart","data-testid":"routing-witness"});card.append(el("h3",provenance.label+" "+(i+1)),note(provenance.note));
    const chain=el("div",null,{class:"path-chain"});
    for(const [j,value] of list(route.nodes).entries()){
      const id=typeof value==="string"?value:value.id,node=typeof value==="string"?(nativeFlow()?.nodes||[]).find(n=>n.id===id):value;
      if(j)chain.append(el("span","to",{class:"arrow"}));
      chain.append(button(node?.label||"Saved graph state",()=>nodeDrawer(node||{id}),"",{"data-node-id":id}));
    }
    card.append(chain);
    for(const hop of list(route.hops||route.edges)){card.append(note(`${primitive(hop.kind)} / transition ${fmt(hop.transition)}. Navigation is not a source assertion.`));for(const proof of list(hop.citations))card.append(sourceButton(proof));}
    card.append(note(route.meaning||"One saved witness, not an exhaustive path enumeration."),button("Guide Path in Corpus Map",()=>guidePath({candidate:{...item,...trace},route,route_index:i})));host.append(card);
  }
  if(!routes.length)host.append(note("No route witness was saved. Incoming contributors do not imply a complete path."));
  const pages=list(trace.source_pages);if(pages.length){host.append(heading("Source-page readout"));for(const p of pages.slice(0,5)){const proof=typeof p==="string"?list(item?.sources).find(s=>s.canonical_page_id===p)||{canonical_page_id:p}:p;host.append(sourceButton(proof));}}
}

function renderDocuments() {
  const host=$("#flow-documents-v6");if(!host)return;host.replaceChildren();
  const integrated=Boolean($("#diffusion-v6 .flow-documents-v6"));$("#document-panel-v6").hidden=integrated;if(integrated)return;
  for(const doc of list(state.projection?.documents).slice(0,12)){
    const card=el("section",null,{class:"document-readout"});card.append(button(doc.title||doc.id,()=>{state.flow?.selectDocument?.(doc.id);host.querySelectorAll("[aria-pressed]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.documentId===doc.id)));},"",{"aria-pressed":"false","data-document-id":doc.id}),note(doc.date||doc.source?.date||"Source date not supplied"));
    if(proofOf(doc.source)?.canonical_page_id)card.append(button("Inspect source",()=>sourceDrawer(doc.source),"",{"data-testid":"inspect-document"}));host.append(card);
  }
  if(!list(state.projection?.documents).length)host.append(note("No document readout was published for this view. No source is inferred from nearby nodes.","empty"));
  else host.append(note("Select a document to highlight its shown nodes; inspect separately for raw text. Displayed membership is not an assertion or an exhaustive source list."));
}

function guidePath({candidate,route,route_index}={}) {
  if(!candidate?.id||!route)return;
  const params=new URLSearchParams({corpus:state.row.case.corpus,guide_case:state.row.case.case_id,guide_arm:ARMS[state.arm].key,
    guide_reading:state.reading,guide_candidate:candidate.id,guide_route:String(route_index),return_to:location.pathname+location.search});
  const provenance=routeProvenance(route),body=box(badge(provenance.label),note(provenance.note),note("The Corpus Map resolves this case-bound path against the pinned source policy. Membership navigation is not factual entailment.","notice"),link("Guide Path in Corpus Map","graph-full-v6.html?"+params,"button primary"));
  for(const node of list(route.nodes))body.append(note(node.label||node.id));
  if(candidate.binding==="source_page_readout")body.append(note("Source-only proposal: the guide follows source contributors. No answer identity is invented."));
  openDrawer("Guide source path","Case-bound path handoff / independent map context",body);
}

function selectCandidate(id,{fromFlow=false}={}) {
  if(!id||id===state.candidate)return;
  if(state.row.case.task==="redaction"){
    const row=readingRows().find(r=>list(r.candidates).some(c=>c.id===id));
    if(!row)return;
    if(row.reading.id!==state.reading){openDrawer("A different reading is required","Only Stage 02 changes the active reading",box(note(`This target belongs to ${row.reading.id}; the active reading is ${state.reading}. Choose its reading explicitly in Stage 02.`),button("Go to Stage 02",()=>{closeDrawer();stagePosition("02");$("[data-testid=plan-reading-select]")?.focus({preventScroll:true});})));return;}
  }else if(!flowItems().some(a=>a.id===id))return;
  state.candidate=id;savePosition();renderResultBody();renderPaths();renderDecisionGuide();
  state.flow?.selectCandidate?.(id);state.paths?.selectCandidate?.(id);
}
async function changeReading() {
  state.epoch++;state.projection=null;
  if(!flowItems().some(c=>c.id===state.candidate))state.candidate=flowItems()[0]?.id||"";
  renderWorkspace();savePosition();await hydrateFlow(state.epoch);
}
function renderResultsStage() {
  const c=state.row.case,s=stage("05",c.task==="redaction"?"Five candidate fills":"Propositions and source assembly","New V6.5 sufficiency / saved candidates");
  s.body.append(decisionChain(c.task));
  s.body.append(el("div",null,{id:"result-body"}));queueMicrotask(renderResultBody);return s.outer;
}
function atomVerdict(value) {
  const raw=String(value||"").toUpperCase();
  return ({SUPPORT:"FOR",SUPPORTED:"FOR",FOR:"FOR",COUNTER:"AGAINST",CONTRADICTED:"AGAINST",AGAINST:"AGAINST",PARTIAL:"SOME",SOME:"SOME",MIXED:"FOR + AGAINST",CONFLICT:"FOR + AGAINST",INSUFFICIENT:"MISSING",UNSUPPORTED:"MISSING",UNRESOLVED:"MISSING",MISSING:"MISSING"})[raw]||"Unreported";
}
function atomLabel(value) {
  const status=atomVerdict(value);
  return state.row.case.task==="reconstruction"?recordedCoverage(value)||"Coverage not recorded":humanDirection(status);
}
function contradictionWarning(atom) {
  if(state.row.case.task!=="reconstruction")return null;
  if(!["AGAINST","FOR + AGAINST"].includes(atomVerdict(atom.status))&&!list(atom.evidence).some(e=>evidenceDirection(e.direction)==="AGAINST"))return null;
  return note("Counterevidence is present. This warning is separate from coverage; it is not a Missing label. Inspect the recorded local status and counterevidence quotations.","contradiction-warning");
}
function evidenceDirection(value) {
  const raw=String(value||"").toUpperCase();
  return ({SUPPORT:"FOR",SUPPORTED:"FOR",FOR:"FOR",COUNTER:"AGAINST",CONTRADICTED:"AGAINST",AGAINST:"AGAINST",PARTIAL:"SOME","PARTIAL / DIRECTION UNESTABLISHED":"SOME",SOME:"SOME",RELATED:"CONTEXT",BACKGROUND:"CONTEXT",MISSING:"MISSING",UNRESOLVED:"MISSING"})[raw]||"UNCLASSIFIED";
}
function atomEvidence(atom) {
  const host=el("div",null,{class:"evidence-lanes"+(state.row.case.task==="reconstruction"?" reconstruction-evidence":"")});
  const reconstruction=state.row.case.task==="reconstruction",rows=list(atom.evidence);
  const labels=reconstruction?{FOR:"Support for this requirement",AGAINST:"Counterevidence / separate from coverage",SOME:"Partial evidence"}:
    {FOR:"Support / source documents",AGAINST:"Counterevidence / source documents",SOME:"Partial / source clues"};
  const extra={CONTEXT:"Context only / not support",MISSING:"Unresolved / not counterevidence",UNCLASSIFIED:"Unresolved / direction not classified"};
  for(const direction of ["FOR","AGAINST","SOME",...Object.keys(extra)]){
    const records=rows.filter(e=>evidenceDirection(e.direction)===direction);
    if(!records.length&&(reconstruction||Object.hasOwn(extra,direction)))continue;
    const lane=el("section",null,{class:"evidence-lane "+direction.toLowerCase(),"data-direction":direction});
    lane.append(el("h4",labels[direction]||extra[direction]));
    if(records.length)lane.append(groupedSources(records,"Published source",{back:()=>atomDetail(atom)}));
    else lane.append(note("No "+humanDirection(direction).toLowerCase()+" record published. Nothing is inferred from this absence."));
    const target=flowItems().find(item=>item.atom_id===atom.id&&evidenceDirection(item.direction)===direction);
    if(target&&["FOR","AGAINST","SOME"].includes(direction))lane.append(button("Highlight "+humanDirection(direction).toLowerCase()+" route",()=>selectAtomTarget(atom,direction)));
    host.append(lane);
  }
  if(!rows.length&&reconstruction)host.append(note("No substantive evidence records were published. Missing evidence is not counterevidence.","empty"));
  if(rows.length)host.append(note("The same document can appear in multiple saved directions. Counts describe source provenance, not independent votes or a new verdict.","evidence-direction-note note"));
  return host;
}
function evidenceOmission(atom) {
  const count=atom.presentation_omitted_evidence;
  return Number.isInteger(count)&&count>0?note(`${count} additional native evidence records are omitted from this published presentation. Counts and expansion cover only the published sources, not all native evidence or the corpus. Open the saved native record in Stage 06 for the full artifact.`,"notice"):null;
}
function selectAtomTarget(atom,direction) {
  const target=flowItems().find(item=>item.atom_id===atom.id&&(!direction||evidenceDirection(item.direction)===direction));
  if(target){selectCandidate(target.id);stagePosition("04");}else atomDetail(atom);
}
function nativeTaskReadout(host,result) {
  const atoms=list(result.atoms),required=atoms.filter(a=>a.required!==false),task=state.row.case.task;
  if(task==="hypothesis")host.append(el("p","Local verdict / "+localTaskVerdict(task,result),{class:"task-verdict","data-testid":"hypothesis-verdict"}));
  else{
    const total=Number.isInteger(result.required_atoms)?result.required_atoms:required.length;
    const count=Number.isInteger(result.covered_atoms)?result.covered_atoms:required.filter(a=>atomVerdict(a.status)==="FOR").length;
    host.append(el("p",total===0?"No required atoms published":Number.isInteger(total)&&total>0&&Number.isInteger(count)&&count>=0&&count<=total?`${count} / ${total} required atoms covered`:"Coverage count not published",{class:"task-verdict","data-testid":"reconstruction-coverage"}));
    host.append(note("Coverage counts supplied requirements established by the native engine. Partial assembly is not complete reconstruction: COMPLETE status and support for every required atom are both required. Narrative order and causal bridges are separate."));
  }
  host.append(note(`Recorded local verdict: ${localTaskVerdict(task,result)}. Unresolved support is not counterevidence.`,"notice"));
  if(result.query_coverage?.complete===false)host.append(note("The supplied atom plan does not cover every query requirement. Atom coverage is not whole-query certification.","notice"));
  for(const atom of atoms){
    const status=atomVerdict(atom.status),card=el("article",null,{class:"atom-card","data-testid":"result-atom","data-atom-id":atom.id});
    const header=el("header"),coverageUnknown=task==="reconstruction"&&!recordedCoverage(atom.status);
    header.append(coverageUnknown?note("Coverage not recorded","coverage-unrecorded"):badge(atomLabel(atom.status),status==="FOR"?"supported":status==="AGAINST"?"against":"inferred"),el("h3",atom.text||atom.source_quote),badge(atom.required===false?"Optional atom":"Required atom"));card.append(header);
    card.append(atomEvidence(atom),button("Inspect atom and source checks",()=>atomDetail(atom),"",{"data-testid":"atom-detail"}));
    const contradiction=contradictionWarning(atom);if(contradiction)card.append(contradiction);
    const omission=evidenceOmission(atom);if(omission)card.append(omission);
    if(status==="MISSING")card.append(note("The requirement remains unestablished, not contradicted.","notice"));
    const context=list(atom.exploratory_passages).length;if(context)card.append(note(context+" exploratory passages remain context-only; inspect them without promoting them to support."));
    host.append(card);
  }
  if(!atoms.length)host.append(note("No executed atom records were published. No verdict is reconstructed from the plan alone.","empty"));
}
function disposition(candidate) {
  const saved=candidate.disposition;
  if(saved&&typeof saved==="object")return {...saved,recorded:true};
  const assessment=candidate.support_assessment||{},grammar=candidate.grammar_admission,joint=candidate.v21_joint_fit;
  const feasible=null;
  const factual=assessment.factual_status||assessment.status||assessment.label;
  const evidence=({SUPPORT:"Supported",Supported:"Supported",PARTIAL:"Partial evidence",COUNTER:"Contradicted",MIXED:"Partial evidence"})[factual]||
    (assessment.partial_clue||assessment.level==="partial_clue"?"Local property clue / not certified":factual==="Inferred"?"Contextual inference":"Evidence state not published");
  return {feasible,fit_label:feasible===true?"Passed saved insertion gates":feasible===false?"Did not pass saved insertion gates":"Admission details not published",evidence_label:evidence,
    explanation:assessment.explanation||candidate.interpretation,needed:assessment.needed,recorded:false};
}
function dispositionPanel(candidate) {
  const d=disposition(candidate),dims=supportDimensions(candidate),panel=el("div",null,{class:"candidate-disposition","data-testid":"candidate-disposition"});
  const fit=feasibility(candidate);
  const tags=[["Grammar",fit.label],["Decision",localDecisions(candidate).length?selectionSummary(candidate):"Not recorded"],
    ["Identity",dims.identity],["Wording",dims.wording],["Support",dims.factual],["Inference",candidate.derived_disposition?"Typed property conversion / inspect scope":candidate.support_assessment?.supports_completed_slot===false?"Focal claim unproved":candidate.interpretation||d.explanation?"Source-bound rationale / inspect":"Unreported"]];
  for(const [term,value] of tags)panel.append(button(`${term}: ${value}`,()=>glossaryDrawer(term),"dimension-tag",{"data-testid":"candidate-tag","data-dimension":term,
    "data-support":term==="Support"?(candidate.support_assessment?.substantive_support===true?"established":candidate.support_assessment?.same_scoped_counterevidence===true?"counter":"unestablished"):null}));
  return panel;
}
const GLOSSARY={
  Grammar:"Insertion feasibility is the saved grammatical admission, not factual truth. Conflicting admission fields remain explicit.",
  Decision:"V6.5 adds a separately versioned local sufficiency decision: every applicable raw-source, focal-fact and fit criterion must pass. It does not relabel the frozen native support or introduce a confidence cutoff.",
  Identity:"Whether the source occurrence identifies the proposed entity. An attested name is not proof that it performed the missing action.",
  Wording:"Whether the candidate phrase is attested or source-derived. Quoted words do not by themselves entail the queried relationship.",
  Support:"V6.5 checks raw eligible quotations against typed focal requirements. Frozen native support remains unchanged in the audit drawer. Routing mass, lexical rank and co-occurrence are retrieval relevance, never support.",
  Inference:"A saved interpretation or typed property conversion may connect a phrase to a slot. It cannot invent an event, identity, chronology or causal bridge. Open the candidate rationale.",
  Rank:"Saved ordering within this reading only. It is not a confidence, correctness or support probability."
};
function glossaryDrawer(term) {const body=box();for(const [key,text] of Object.entries(GLOSSARY))body.append(heading(key+(key===term?" / selected":"")),note(text));openDrawer("Result tags / short glossary","Separate dimensions / no new scoring",body);}
function resultGlossary() {const host=el("div",null,{class:"tag-glossary","data-testid":"tag-glossary"});host.append(el("strong","Tag key / click to explain: "));for(const term of Object.keys(GLOSSARY))host.append(button(term,()=>glossaryDrawer(term)));return host;}
function supportDimensions(candidate) {
  const dims=candidate.support_dimensions||{},d=disposition(candidate);
  return {identity:({UNIQUE_EXACT_ELIGIBLE_OCCURRENCE:"Source-attested",UNBOUND_OR_AMBIGUOUS:"Unresolved"})[dims.identity]||primitive(dims.identity),wording:primitive(dims.wording),
    factual:factual(candidate).label,scope:primitive(dims.property_scope??candidate.support_assessment?.scope)};
}
function decisionChain(task) {
  const host=el("ol",null,{class:"decision-chain","data-testid":"decision-chain","aria-label":"Decision provenance"});
  const steps=task==="redaction"?["Saved query and ranked fills","Raw-source provenance replay","New V6.5 focal sufficiency criteria","Separate original-packet LLM review"]:
    ["Saved query and required atoms","Raw-source provenance replay","New V6.5 typed sufficiency criteria","Separate original-native LLM review"];
  for(const text of steps)host.append(el("li",text));return host;
}
function recordedLocalDecisionPanel(candidate) {
  const host=el("section",null,{class:"local-decision-panel","data-testid":"local-decision"}),fit=feasibility(candidate),rows=localDecisions(candidate);
  host.append(heading("Recorded local output / no reference key"),fields([["Construction / rank","Ranked source-derived candidate; rank is not acceptance"],["Feasibility",fit.label],...rows.map(r=>[r.label,r.value,true]),["Factual support",factual(candidate).label]]));
  if(!rows.length)host.append(note("No local acceptance or recommendation decision, rejection gate or score threshold is recorded here. An unresolved claim is not a rejected candidate.","note"));
  if(factual(candidate).detail)host.append(note(factual(candidate).detail));
  return host;
}
function rawInspector(value,title="Raw saved local fields / unchanged") {
  const host=el("details",null,{"data-raw-inspector":"true"});host.append(el("summary",title),el("pre",JSON.stringify(value,null,2),{class:"raw-text"}));return host;
}
function decisionPacket() { return state.saved?.local_decisions_v65||null; }
function newDecision(item) {const unit=unitFor(decisionPacket(),item,state.row?.case.task);return unit?{...unit,task:state.row.case.task}:null;}
function newDecisionBadge(unit) {const node=badge(decisionLabel(unit,state.row?.case.task),unit?.status==="evidence_backed_suggestion"?"supported":unit?.status==="incompatible_not_viable"?"against":"inferred");node.dataset.testid="new-local-status";node.dataset.decisionStatus=unit?.status||"unavailable";return node;}
function checkList(checks) {
  const ul=el("ul",null,{class:"sufficiency-checks","data-testid":"sufficiency-checklist"});
  for(const check of list(checks)){const li=el("li",null,{"data-check-state":check.state});li.append(el("strong",({pass:"Pass",missing:"Missing",conflict:"Conflict"})[check.state]||"Unresolved"),el("span",`${check.label}: ${check.detail}`));ul.append(li);}return ul;
}
function sufficiencyPanel(unit,{compact=false}={}) {
  const host=el("section",null,{class:"sufficiency-panel","data-testid":"sufficiency-panel"});
  host.append(newDecisionBadge(unit));
  if(!unit){host.append(note("The new local decision supplement is not published for this item. No decision is inferred from rank, frozen support, or the LLM grade."));return host;}
  if(state.row.case.task==="redaction")host.append(note(({
    evidence_backed_suggestion:"Passes the local corpus-evidence gate, not a hidden-answer correctness test.",
    partial_grounding:"Does not yet pass the complete-evidence gate; integral support is incomplete.",
    exploratory_contextual:"Does not pass the corpus-evidence gate; this remains a proposal to investigate.",
    incompatible_not_viable:"Fails an explicit insertion or factual compatibility check."
  })[unit.status]||"The evidence decision is unresolved.","evidence-gate-result"));
  if(decisionPacket()?.pool_replay?.applied)host.append(note(`New task-decision evidence from the exact ${decisionPacket().pool_replay.inspected_pages}-page saved inspected pool. These quotations are not retroactively native candidate endpoints or numerical graph walks.`,"notice"));
  if(state.row.case.task==="reconstruction")host.append(note("Requirement coverage: "+unit.coverage,"derived-coverage"));
  if(unit.counterevidence)host.append(note("Same-scoped counterevidence is present. This warning is separate from coverage.","contradiction-warning"));
  if(compact){host.append(button("Decision checks and what would suffice",()=>decisionDrawer(unit),"",{"data-testid":"decision-checks"}));return host;}
  host.append(checkList(unit.checklist));
  for(const fact of list(unit.requirements)){
    const detail=el("details",null,{class:"sufficiency-fact"});detail.append(el("summary",`${fact.kind==="PROPERTY"?"Property":"Requirement"}: ${fact.predicate}${list(fact.actors).length?" / "+fact.actors.join(" + "):""} / ${fact.coverage}${fact.counterevidence?" / Counterevidence present":""}`),checkList(fact.checks));
    if(list(fact.evidence).length)detail.append(compactEvidence(fact.evidence,{label:"Typed witnesses",render:witness=>box(
      el("h4",witness.direction+" / "+(witness.adapter==="EXPLICIT_DEFINITE_NP_PROPERTY/6.5"?"Focal property recheck":"Typed source comparison")),
      note(witness.derivation_note||witness.explanation||"Raw eligible source witness; no key or grade used."),checkList(witness.checks),groupedSources(witness.citations,"Rechecked raw source"))}));
    if(list(fact.context_citations).length){const context=el("details");context.append(el("summary","Context only / not substantive proof"),groupedSources(fact.context_citations));detail.append(context);}
    detail.append(note(fact.aggregation));host.append(detail);
  }
  host.append(heading("What would suffice"));for(const text of list(unit.what_would_suffice))host.append(note(text));
  host.append(note(`${decisionPacket()?.version||"V6.5"} / derived reporting decision, not a frozen native result. No answer key, grade or confidence threshold is used.`,"note"));return host;
}
function decisionDrawer(item) { const unit=item?.checklist?item:newDecision(item);openDrawer("V6.5 local evidence sufficiency","New derived decision / no key or model grade",sufficiencyPanel(unit)); }
function localDecisionPanel(candidate) {return sufficiencyPanel(newDecision(candidate));}
function renderDecisionGuide() {
  const host=$("#derived-decision-guide-v65");if(!host)return;host.replaceChildren();
  const item=selectedItem(),unit=newDecision(item),section=el("section",null,{class:"derived-decision-guide","data-testid":"derived-decision-guide"});
  section.append(heading("Evidence-decision guide / V6.5"),note(guideDisclosure),note("Saved query/slot > recorded source quote > eligibility replay > typed focal facts > explicit sufficiency decision."));
  if(item)section.append(note("Selected item: "+(item.fill||item.atom_id||item.id)),newDecisionBadge(unit),button("Inspect the derived decision",()=>decisionDrawer(item)));
  section.append(note("Routing relevance remains the saved native calculation. The decision guide neither reranks candidates nor adds transport edges."));host.append(section);
}
function taskReadout(host,result) {
  const atoms=list(result.atoms);host.append(note("New deterministic V6.5 task decisions below. Frozen native fields remain unchanged and can be inspected separately."));
  for(const atom of atoms){const unit=newDecision(atom),card=el("article",null,{class:"atom-card","data-testid":"result-atom","data-atom-id":atom.id});
    card.append(el("h3",atom.text||atom.source_quote),sufficiencyPanel(unit,{compact:true}));
    if(unit){const sources=list(unit.requirements).flatMap(f=>list(f.evidence).flatMap(e=>list(e.citations)));if(sources.length)card.append(groupedSources(sources,"Rechecked raw source"));}
    card.append(button("Inspect frozen atom and source checks",()=>atomDetail(atom),"",{"data-testid":"atom-detail"}));host.append(card);
  }
  if(!atoms.length)host.append(note("No executed atom records were published; no new requirements are fabricated.","empty"));
  host.append(button("Inspect frozen native output",frozenAuditDrawer,"",{"data-testid":"frozen-native-audit"}));
}
function frozenAuditDrawer() {
  const r=state.saved.result||{},body=box(note("Unchanged original native output and its original LLM review. These fields are not the V6.5 decision supplement.","notice"),verdictOverview(r));
  if(state.row.case.task!=="redaction"){nativeTaskReadout(body,r);renderTaskAssembly(body,r[state.row.case.task]||{});}
  else for(const candidate of candidates())body.append(el("h3",candidate.fill),recordedLocalDecisionPanel(candidate));
  openDrawer("Frozen native output / audit","Original record / never relabelled V6.5",body);
}
function renderResultBody() {
  const host=$("#result-body");if(!host||!state.saved)return;host.replaceChildren();
  const result=state.saved.result||{};
  const failure=failureReceipt();if(failure)host.append(failure);
  if(state.row.case.task!=="redaction"){
    taskReadout(host,result);
    return;
  }
  const rows=readingRows(),entry=currentReading(),controls=el("div",null,{class:"result-controls"});
  if(rows.length)controls.append(el("strong","Active reading: "+(entry?.reading?.id||"not supplied"),{"data-testid":"active-reading"}),button("Change reading in Stage 02",()=>{stagePosition("02");$("[data-testid=plan-reading-select]")?.focus({preventScroll:true});},"",{"data-testid":"change-reading-link"}));else controls.append(badge("No saved reading rows"));
  controls.append(note("Up to five saved alternatives, not five endorsements. Only Evidence-backed passes the local corpus-evidence gate. A quotation can explain a candidate's origin without supporting this slot; rank is not acceptance."));host.append(controls);
  const planned=list(state.saved.plan?.slot_readings).find(r=>r.id===entry?.reading?.id);
  host.append(resultGlossary());
  if(planned)host.append(el("p",readingText(planned),{class:"reading-explanation","data-testid":"selected-reading-explanation"}));
  const candidatesHost=el("div",null,{class:"candidate-list"});
  for(const [i,candidate] of candidates().entries()){
    const card=el("article",null,{class:"candidate","data-proposal-id":candidate.id,"data-selected":String(state.candidate===candidate.id)}),top=el("div",null,{class:"candidate-top"});
    const choose=button("",()=>selectCandidate(candidate.id),"candidate-select",{"aria-pressed":state.candidate===candidate.id,"data-testid":"candidate-select"});choose.append(el("span",String(i+1).padStart(2,"0"),{class:"candidate-rank"}),el("span",candidate.fill));
    top.append(choose);card.append(top,sufficiencyPanel(newDecision(candidate),{compact:true}),el("p","Source wording: "+(candidate.source_wording||"Not supplied"),{class:"source-wording"}));
    const actions=el("div",null,{class:"actions"});actions.append(button("Sources and explanation",()=>{selectCandidate(candidate.id);candidateDetail(candidate);},"",{"data-testid":"candidate-detail"}),button("Contributors and paths",()=>{selectCandidate(candidate.id);stagePosition("04");},"",{"data-testid":"candidate-paths"}));card.append(actions);
    if(candidate.assessment){const review=llmReview(candidate,"redaction"),grade=el("div",null,{class:"grade-line","data-testid":"candidate-grade"});grade.append(el("span","Original-packet LLM / not a review of V6.5"),el("span","Answer correctness: "+review.correctness),el("span","LLM evidence review: "+review.evidence),el("span","LLM grammar: "+review.grammar));card.append(grade);}else card.append(note("Post-run LLM review not published. No correctness grade is inferred from rank or feasibility."));
    candidatesHost.append(card);
  }
  host.append(candidatesHost);if(!candidates().length)host.append(note("No candidates were supplied for this reading. No other reading or arm is substituted.","empty"));
}

let evidenceListId=0;
function countLabel(count,singular,plural=singular+"s") { return `${count} ${count===1?singular:plural}`; }
function compactEvidence(items,{label,render,preview=3}) {
  const host=el("div",null,{class:"compact-evidence","data-testid":"compact-evidence","data-anchor-scope":label}),id="evidence-list-"+(++evidenceListId);
  const content=el("div",null,{id,class:"evidence-preview-items"}),caption=note("","evidence-preview-meta");
  const nodes=items.map((item,index)=>{const node=el("div",null,{"data-preview-item":"true","data-anchor-scope":"item:"+index});node.hidden=index>=preview;node.append(render(item,index));content.append(node);return node;});
  let expanded=false;
  function update(){
    nodes.forEach((node,index)=>{node.hidden=!expanded&&index>=preview;});
    caption.textContent=`Showing ${expanded?items.length:Math.min(preview,items.length)} of ${items.length} published ${label}.`;
    if(toggle){toggle.textContent=expanded?"Show preview":`Expand all ${items.length} published ${label}`;toggle.setAttribute("aria-expanded",String(expanded));}
  }
  const toggle=items.length>preview?button("",()=>{expanded=!expanded;update();},"evidence-expand",{"aria-controls":id,"aria-expanded":"false","data-testid":"evidence-expand"}):null;
  update();host.append(caption,content);if(toggle)host.append(toggle);return host;
}
function sourceGroups(citations) {
  const groups=new Map();let unbound=0;
  for(const value of list(citations)){
    const supplied=proofOf(value),doc=supplied?.document_id||value?.document_id;
    if(!supplied||!doc&&!supplied.canonical_page_id){unbound++;continue;}
    const proof={...supplied,...(doc?{document_id:doc}:{})},key=JSON.stringify(doc?["doc",doc]:["page",proof.canonical_page_id]);
    if(!groups.has(key))groups.set(key,{document_id:doc,page_id:proof.canonical_page_id,proofs:new Map()});
    // Deduplicate only identical source bindings, retaining changed text/hash bindings for inspection.
    groups.get(key).proofs.set(JSON.stringify([proof.canonical_page_id,proof.start,proof.end,proof.text,proof.page_sha256,proof.date]),proof);
  }
  return {groups:[...groups.values()],unbound};
}
function sourceCountText(citations) {
  const {groups}=sourceGroups(citations),known=groups.filter(g=>g.document_id).length,unknown=groups.length-known;
  return countLabel(known,"unique source document")+" in this published list"+(unknown?`; ${countLabel(unknown,"page group")} without document identity (not counted as documents)`:"");
}
function groupedSources(citations,titleText="Source references",{back}={}) {
  const {groups,unbound}=sourceGroups(citations),host=el("div",null,{class:"grouped-sources","data-testid":"grouped-sources","data-anchor-scope":titleText});
  host.append(note(sourceCountText(citations)+". Counts describe provenance, not independent corroboration.","source-count"));
  if(groups.length)host.append(compactEvidence(groups,{label:"source groups",render:group=>{
    const proofs=[...group.proofs.values()],details=el("details",null,{class:"source-group","data-document-id":group.document_id});
    const summary=el("summary",`${titleText} / ${group.document_id||"Unidentified document / page "+group.page_id} / ${countLabel(proofs.length,"quotation")}`);
    summary.append(el("span",short(proofs[0]?.text,14)||"Open saved source quotations",{class:"source-preview"}));details.append(summary);
    details.append(compactEvidence(proofs,{label:"quotations in this source group",preview:2,render:proof=>sourceButton(proof,{back})}));return details;
  }}));
  if(unbound)host.append(note(`${countLabel(unbound,"saved record")} without document or page identity; not counted as source documents.`));
  return host;
}
function reviewChart(rows,{task=false}={}) {
  const ns="http://www.w3.org/2000/svg",width=920,rowHeight=48,header=42;
  const svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox",`0 0 ${width} ${header+Math.max(1,rows.length)*rowHeight}`);
  svg.setAttribute("role","img");svg.setAttribute("aria-label",task?"Saved atom coverage and separate model review":"Ranked proposals, native support without key, and separate model answer review");
  svg.setAttribute("data-testid","review-chart");svg.classList.add("review-chart");
  const text=(x,y,value,cls="")=>{const n=document.createElementNS(ns,"text");n.setAttribute("x",x);n.setAttribute("y",y);if(cls)n.setAttribute("class",cls);n.textContent=value;svg.append(n);};
  text(10,22,task?"Required atom / requirement":"Rank / constructed candidate");text(400,22,task?"Local direction / coverage":"Local factual support / no key");text(680,22,task?"LLM decision review":"LLM correctness / key-aware");
  for(const [i,row] of rows.entries()){
    const y=header+i*rowHeight,rect=document.createElementNS(ns,"rect");rect.setAttribute("x","0");rect.setAttribute("y",y-7);rect.setAttribute("width",width);rect.setAttribute("height",rowHeight);rect.setAttribute("fill",i%2?"#edf5f4":"#faf8f1");svg.append(rect);
    const label=String(row.label||"Unreported");text(10,y+12,label.length>48?label.slice(0,45)+"...":label);
    text(400,y+12,String(row.native||"Unreported").slice(0,36));text(680,y+12,String(row.review||"Not published").slice(0,31));
    const title=document.createElementNS(ns,"title");title.textContent=`${label}. Native: ${row.native}. Post-run: ${row.review||"Not published"}.`;rect.append(title);
  }
  const wrapper=el("div",null,{class:"review-chart-scroll",tabindex:"0"});wrapper.append(svg);return wrapper;
}
function failureReceipt() {
  const r=state.saved?.result||{},receipt=r.failure||r.error||state.saved?.failure||state.saved?.error;
  const status=String(r.execution_status||r.status||state.saved?.status||"");
  if(!receipt&&!/FAIL|ERROR|BLOCKED|PARSE/i.test(status))return null;
  const body=el("section",null,{class:"failure-receipt","data-testid":"failure-receipt"});
  const message=typeof receipt==="string"?receipt:receipt?.message||receipt?.reason||receipt?.error;
  body.append(heading("Recorded execution / parsing failure"),note(message||r.reason||r.explanation||status,"notice"),
    fields([["Saved status",status],["Failure stage",receipt?.stage||r.failure_stage],["Recorded retries",receipt?.retry_count??r.retry_count],["Receipt",receipt?.path||r.failure_receipt,true]]));
  body.append(note("This is a saved failure, not a negative task decision. Reload reads the saved record only; it cannot execute or retry a model."),
    button("Reload saved receipt",()=>{conditionCache.clear();projectionCache.clear();chooseCase(catalogCases().find(row=>row.case.case_id===state.row.case.case_id));}));
  return body;
}
function supportRepresentations(record) {
  const rows=[record,...list(record?.evidence),...list(record?.support_assessment?.evidence)];
  const values=rows.map(row=>row?.support_representation??row?.match_representation??row?.support_dimensions?.representation);
  return [...new Set(values.filter(value=>typeof value==="string"&&value.trim()))];
}
function representationName(value) {
  return ["KG_MEDIATED_ROLE","SOURCE_LOCAL_KG_ROLE_ALIGNMENT"].includes(value)?"KG-mediated role alignment":primitive(value);
}
function representationPanel(record) {
  const panel=el("div",null,{"data-testid":"support-representation"}),values=supportRepresentations(record);
  if(!values.length){panel.append(note("Support representation not supplied; it is not inferred from the native status, citations, identity attestation or graph routing."));return panel;}
  for(const value of values){
    panel.append(note("Support representation: "+representationName(value)),fields([["Saved representation",value,true]]));
    panel.append(note(["KG_MEDIATED_ROLE","SOURCE_LOCAL_KG_ROLE_ALIGNMENT"].includes(value)?
      "A saved source-local KG role alignment is not direct whole-claim quotation and not general entailment. Inspect the published source proofs and any role certificate. The method label alone does not establish unrelated actions, dates or other atoms.":
      "This is the saved evidence representation, not an added support verdict or a correctness score."));
  }
  return panel;
}
function renderFindings() {
  const s=stage("06","Local sufficiency and separate review","New V6.5 decision / unchanged native record","review"),r=state.saved.result||{};
  s.body.append(sufficiencyOverview(),exactGateReviewPanel(),button("Inspect frozen native output",frozenAuditDrawer,"",{"data-testid":"frozen-native-audit"}));
  if(state.row.case.task==="redaction"){
    const displayed=currentReading();
    s.body.append(note(`Reviewing the active reading ${state.reading}. Change it only in Stage 02.`));
    const proposals=list(displayed?.candidates).slice(0,5);
    for(const [i,c] of proposals.entries()){
      const row=el("details",null,{class:"review-row","data-proposal-id":c.id});row.append(el("summary",`${i+1} / ${short(c.fill,10)} / ${decisionLabel(newDecision(c))}`),localDecisionPanel(c),
        advisory(c)||note("No post-run model review was published."));
      const local=c.local_reference_comparison||c.post_unmask_comparison;
      if(state.reference&&local)row.append(heading("Separate local post-unmask comparison"),fields([["Exact comparison",local.label??local.status??local.exact_match],["Comparison method",local.method]]),note("This is only the supplied local comparison, not semantic correctness."));
      row.append(groupedSources(c.sources));s.body.append(row);
    }
    if(!state.reference)s.body.append(note("The reference remains masked. No local answer-key comparison is displayed."));
  }else{
    const atoms=list(r.atoms);
    for(const atom of atoms){const details=el("details",null,{class:"review-row","data-atom-id":atom.id});details.append(el("summary",(atom.text||atom.id)+" / "+decisionLabel(newDecision(atom))),sufficiencyPanel(newDecision(atom)),button("Inspect frozen atom",()=>atomDetail(atom)));
      const review=advisory(atom);if(review)details.append(review);s.body.append(details);}
    s.body.append(note("Unestablished requirements remain unknown, not counterevidence. Event dates and causal bridges require their own facts."));
  }
  if(typeof state.report.assessment_note==="string")s.body.append(note(state.report.assessment_note));
  s.body.append(note("These are exposed development examples, not a benchmark accuracy sample."));
  if(state.saved.native_checkpoint)s.body.append(link("Open public inference receipt","/api/native-v6?"+caseQuery(),"button"));
  if(r.assessment)s.body.append(advisory(r));
  const digest=r.analyst_digest||state.saved.analyst_digest;
  if(digest){s.body.append(heading("Original saved analyst digest"));const text=typeof digest==="string"?digest:digest.text||digest.summary;
    s.body.append(note("Original-packet commentary, not a review of the new V6.5 gate. It cannot change decisions, source eligibility or bindings.","notice"));
    if(text)s.body.append(el("div",displayText(text),{class:"digest-text","data-testid":"analyst-digest"}),rawInspector(digest,"Raw saved analyst commentary / unchanged"));else s.body.append(note(publicationNote(digest)||"Digest text is not published.","empty"));
    s.body.append(groupedSources(digest.citations));}
  return s.outer;
}

function sufficiencyOverview() {
  const packet=decisionPacket(),task=state.row.case.task,overall=overviewFor(packet,task,state.reading),host=el("section",null,{class:"verdict-overview sufficiency-overview","data-testid":"sufficiency-overview"});
  host.append(heading("New local evidence-sufficiency decision / V6.5"));
  const grid=el("div",null,{class:"verdict-grid"}),local=el("section",null,{class:"verdict-native"}),judge=el("section",null,{class:"verdict-judge"});
  local.append(newDecisionBadge(overall),note(packet?`${packet.version} / derived after native execution, without keys, grades, rank scores or a confidence cutoff.`:"The new local decision supplement has not been published. Frozen native output is available separately."));
  if(packet?.pool_replay?.applied)local.append(note(`New deterministic task decision over exactly ${packet.pool_replay.inspected_pages} saved inspected pages, not all ${packet.pool_replay.larger_admitted_count??"eligible"} admitted pages. No fresh retrieval, inferred graph walk or re-ranking.`,"notice"));
  if(overall?.conclusion)local.append(note(overall.conclusion,"notice"));
  const items=task==="redaction"?candidates():list(state.saved?.result?.atoms);
  for(const item of items){const unit=newDecision(item),row=el("div",null,{class:"verdict-unit","data-testid":"derived-unit-verdict"});row.append(el("strong",item.fill||item.text||item.id),newDecisionBadge(unit));
    if(task==="reconstruction"&&unit)row.append(note("Coverage: "+unit.coverage));
    if(task==="hypothesis"&&unit){const counts=["Support","Counterevidence","Partial"].map(direction=>{const docs=new Set(list(unit.requirements).flatMap(f=>list(f.evidence).filter(e=>e.direction===direction).flatMap(e=>list(e.citations).map(c=>c.document_id))));return `${direction}: ${docs.size} source documents`;});row.append(note(counts.join("; ")+". Distinct provenance, not independent votes."));}
    if(unit?.counterevidence)row.append(badge("Counterevidence present","against"));
    row.append(button("Inspect criteria",()=>decisionDrawer(item)));local.append(row);
  }
  if(overall){if(overall.counterevidence)local.append(note("Counterevidence is present. No absent requirement has been counted as opposition.","contradiction-warning"));if(task!=="redaction")local.append(checkList(overall.checklist));for(const text of list(overall.what_would_suffice))local.append(note(text));}
  judge.append(el("h3","Separate LLM / original saved packet"),note(reviewDisclosure,"notice"));
  for(const item of items){const review=llmReview(item,task);judge.append(note(`${item.fill||item.id}: ${review.summary}${review.recorded?" / evidence review: "+review.evidence:""}`));}
  judge.append(note("Redaction correctness is key-aware; H/R review concerns the original native decision. Neither judges this new gate. No live model calls."));
  grid.append(local,judge);host.append(grid);return host;
}

function exactGateReviewPanel() {
  const panel=el("section",null,{class:"grade-panel","data-testid":"exact-gate-review"}),review=state.gateReview,packet=decisionPacket(),task=state.row.case.task;
  panel.append(heading("Separate review of the exact new gate"));
  if(review?.status!=="complete"){
    panel.append(note(review?.reason||"No new exact-gate model review is published yet."),note(reviewDisclosure));return panel;
  }
  panel.append(note(`New method-blinded post-run assessment of ${packet.version}. This does not replace original native grades, change the local decision, or constitute human validation.`,"notice"));
  const rows=review.grades.filter(row=>task!=="redaction"||row.scope==="overall"||row.reading_id===state.reading);
  for(const row of rows){
    const unit=row.scope==="overall"?packet.overall:packet.atoms?.[row.decision_id]||packet.candidates?.[row.decision_id],grade=row.grade,body=el("details",null,{class:"review-row","data-decision-id":row.decision_id||"overall"});
    body.append(el("summary",`${row.scope==="overall"?"Whole query":unit?.text||row.decision_id}: ${displayText(grade.judgment)}`),
      fields([["Exact-gate decision review",displayText(grade.judgment)],["Quoted evidence review",displayText(grade.evidence_support)],
        ...(task==="redaction"?[["Key-aware answer correctness",llmReview({assessment:grade},"redaction").correctness],["Insertion grammar",grade.grammatical]]:[])]),
      note(displayText(grade.explanation)||"No explanation supplied."));panel.append(body);
  }
  if(!rows.length)panel.append(note("No new review item is published for this reading; another reading's assessment is not substituted."));
  panel.append(note(`Exact decision SHA-256: ${review.gate_sha256}`,"proof-hash"));return panel;
}

function verdictOverview(result) {
  const task=state.row.case.task,host=el("section",null,{class:"verdict-overview","data-testid":"verdict-overview"});
  host.append(heading("The result at a glance"));
  const grid=el("div",null,{class:"verdict-grid"}),native=el("section",null,{class:"verdict-native"}),judge=el("section",null,{class:"verdict-judge"});
  native.append(el("h3","Local engine / no reference key"));judge.append(el("h3","Separate LLM / post-run review"));
  const atoms=list(result.atoms),required=atoms.filter(a=>a.required!==false);
  if(task==="redaction"){
    const proposals=candidates();native.append(el("strong",`${proposals.length} constructed, ranked candidates / ${state.reading||"no reading"}`,{class:"verdict-headline"}),note("Rank is not acceptance. Fit, explicit local selection and factual support are independent recorded dimensions."));
    native.append(note(result.native_verdict?"Recorded final local verdict: "+localTaskVerdict(task,result):"No final local answer verdict is recorded; this saved output is a ranked candidate list."));
    if(!proposals.some(c=>localDecisions(c).length))native.append(note("No local acceptance/recommendation gate or threshold is recorded in these candidate outputs. Unresolved support does not mean rejection.","selection-absence"));
    const strip=el("div",null,{class:"verdict-strip"});
    for(const [i,c] of proposals.entries())strip.append(el("span",`${i+1}. ${c.fill} / fit: ${feasibility(c).label} / ${localDecisions(c).length?selectionSummary(c):"selection unrecorded"} / factual support: ${factual(c).label}`,{class:"verdict-unit","data-testid":"local-candidate-verdict"}));native.append(strip);
    judge.append(note("Key-aware reference-answer correctness is a post-run LLM grade, not a local selection or factual-support gate. Its evidence and grammar reviews are separate advisory judgments, not independent human validation."));
    for(const [i,c] of proposals.entries()){const review=llmReview(c,"redaction");judge.append(note(`${i+1}. ${c.fill}: correctness ${review.correctness||review.summary}; LLM evidence review ${review.evidence||"Not recorded"}; grammar ${review.grammar||"Not recorded"}`,"llm-candidate-verdict"));}
  }else if(task==="reconstruction"){
    const total=Number.isInteger(result.required_atoms)?result.required_atoms:required.length,covered=Number.isInteger(result.covered_atoms)?result.covered_atoms:required.filter(a=>atomVerdict(a.status)==="FOR").length;
    native.append(el("strong",`${covered} / ${total} required atoms established`,{class:"verdict-headline"}),note("Recorded local verdict: "+localTaskVerdict(task,result)));
    const strip=el("div",null,{class:"verdict-strip","aria-label":"Requirement coverage"});
    for(const atom of required){const status=atomLabel(atom.status);strip.append(el("span",`${atom.id}: ${status}`,{class:"verdict-unit","data-coverage":recordedCoverage(atom.status),title:atom.text}));}
    native.append(strip,note("Established / Partial / Missing describe coverage, not votes. Ordering or causal bridges require their own evidence."));
    for(const atom of atoms){const warning=contradictionWarning(atom);if(warning)native.append(warning);}
    judge.append(note("The LLM reviews recorded local coverage and its saved evidence packet, not a redaction reference-answer match. It cannot fill a Missing requirement, create a bridge or overwrite local coverage."));
  }else{
    native.append(el("strong",localTaskVerdict(task,result),{class:"verdict-headline"}));
    for(const atom of atoms){
      const counts=Object.fromEntries(["FOR","AGAINST","SOME"].map(direction=>[direction,new Set(list(atom.evidence).filter(e=>evidenceDirection(e.direction)===direction).map(e=>proofOf(e)?.document_id||e.document_id).filter(Boolean)).size]));
      native.append(note(`${atom.id} / ${atomLabel(atom.status)}: Support ${counts.FOR}; Counterevidence ${counts.AGAINST}; Partial ${counts.SOME} distinct source documents.`,"claim-direction"));
    }
    native.append(note("Distinct documents per claim and direction, not independent votes. The same source may occur on both sides. No absent or merely related record counts as opposition."));
    judge.append(note("The LLM reviews the local claim decision against the saved evidence packet, not a redaction reference-answer match. Its judgment is not another source document or an extra Support/Counterevidence vote."));
  }
  if(task!=="redaction"){
    for(const atom of atoms){const review=llmReview(atom,task);judge.append(note(`${atom.id}: ${review.summary}${review.recorded?" / "+review.explanation:""}`));}
    judge.append(note(result.assessment?.judgment?"Recorded overall LLM review: "+displayText(result.assessment.judgment):"No overall LLM verdict was published; per-claim judgments are not combined into an invented overall grade."));
  }
  judge.append(note("Saved review only. No live model is called by this interface."));grid.append(native,judge);host.append(grid);return host;
}

function advisory(item,{reference=false}={}) {
  const a=item?.assessment;if(!a||typeof a!=="object")return null;
  const panel=el("section",null,{class:"grade-panel","data-testid":"advisory-assessment"});
  const review=llmReview(item,state.row.case.task);
  panel.append(el("h3","Separate post-run LLM review"),note(reviewDisclosure,"notice"),note(state.row.case.task==="redaction"?"The LLM saw the original candidate/evidence packet and reference key. Correctness is key-aware, not a local acceptance decision.":"The LLM reviewed the original native decision and evidence packet. Redaction reference-answer correctness is not applicable to this task."),note("Advisory model output, not human verification and not a replacement for the local result."));
  const entries=state.row.case.task==="redaction"?[["Key-aware answer correctness",review.correctness],["LLM evidence review",review.evidence],["LLM grammar review",review.grammar]]:
    [["Local-verdict review",review.summary],["LLM evidence review",review.evidence],["Reference-answer correctness","Not applicable to this task"]];
  panel.append(fields(entries.filter(([,v])=>v!==undefined)));
  if(state.row.case.task==="redaction")panel.append(note(reference?"Original-reference units are reviewed separately. The redaction judgment field is unscored.":"Native support labels were not a defined redaction grading dimension. Reviewer explanation is unscored free text."));
  panel.append(note(displayText(a.explanation)||"No reviewer explanation was supplied."),rawInspector(a,"Raw saved LLM assessment / unchanged"));return panel;
}
function proofOf(value) {
  const p=value?.citation||value?.source_proof||(value?.source&&typeof value.source==="object"?value.source:value);
  return typeof p==="string"?{canonical_page_id:p}:p&&typeof p==="object"?{...p,canonical_page_id:p.canonical_page_id||p.page_id||p.id}:null;
}
const citationObserver=new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){citationObserver.unobserve(entry.target);entry.target.loadContext?.();}
},{rootMargin:"200px"});
async function citationContext(proof,c) {
  const key=c.case_id+"/"+proof.canonical_page_id;
  if(!sourceContextCache.has(key)){
    if(sourceContextCache.size>100)sourceContextCache.clear();
    sourceContextCache.set(key,getJSON("/api/source-v6?"+new URLSearchParams({case_id:c.case_id,source_id:proof.canonical_page_id})).then(async data=>{
      const page=data.page||data;
      if((page.canonical_page_id||page.id)!==proof.canonical_page_id)throw Error("Source identity mismatch");
      await verifySourcePage(page,c);return page;
    }));
  }
  const page=await sourceContextCache.get(key);
  if(proof.document_id&&proof.document_id!==page.document_id||proof.date&&proof.date!==page.date||proof.page_sha256!==(page.source_sha256||page.page_sha256))throw Error("Quotation source binding mismatch");
  const chars=Array.from(page.text);
  if(!Number.isInteger(proof.start)||!Number.isInteger(proof.end)||proof.start<0||proof.end<=proof.start||proof.end>chars.length||chars.slice(proof.start,proof.end).join("")!==proof.text)throw Error("Exact quotation does not replay");
  return paragraphContext(page.text,proof);
}
function sourceButton(value,{back}={}) {
  const proof=proofOf(value);if(!proof?.canonical_page_id)return note("No source-bound quotation was supplied.");
  const b=button("",()=>sourceDrawer(proof,{back}),"source-card",{"data-testid":"source-proof","data-anchor-key":JSON.stringify([proof.canonical_page_id,proof.start,proof.end,proof.page_sha256])});
  const copy=el("span",proof.text||"Open original source text"),status=el("small","Open to verify the full source transcription",{class:"context-status"});
  b.append(el("small",`${proof.document_id||"Saved source page"} / ${proof.date||"Date in source record"}`),copy,status);
  const c={...state.row.case};
  b.loadContext=async()=>{
    try{
      const context=await citationContext(proof,c);
      if(!b.isConnected)return;
      const highlighted=highlightedText(context.text,context.anchors,{class:"citation-context","data-testid":"citation-paragraph"});
      copy.replaceWith(highlighted);status.textContent="Full source paragraph / exact relevant quotation highlighted / open full transcription";
    }catch{if(b.isConnected)status.textContent="Saved quotation only / paragraph context could not be verified. Open source details to inspect.";}
  };
  citationObserver.observe(b);return b;
}
async function sourceDrawer(value,{back}={}) {
  const proof=proofOf(value);if(!proof?.canonical_page_id)return;
  const c={...state.row.case};const epoch=openDrawer("Original source","Pinned evidence / raw text",note("Loading original text and verifying the quotation..."),back);
  sourceRequest=new AbortController();
  try {
    const data=await getJSON("/api/source-v6?"+new URLSearchParams({case_id:c.case_id,source_id:proof.canonical_page_id}),{signal:sourceRequest.signal});
    const page=data.page||data;
    if(epoch!==state.drawerEpoch||!$("#detail-drawer").open)return;
    if(typeof page.text!=="string"||(page.canonical_page_id||page.id)!==proof.canonical_page_id)throw Error("The source identity does not match the saved citation.");
    if(!page.date||page.date>=c.date||page.document_id===c.document_id)throw Error("This page violates the selected case's strict cutoff or whole-origin exclusion.");
    if(proof.document_id&&proof.document_id!==page.document_id||proof.date&&proof.date!==page.date)throw Error("The source document or date differs from the saved quotation.");
    if(page.permitted===false||page.visibility==="later"||c.corpus!=="cib"&&page.classification&&page.classification!=="CONFIDENTIAL"||list(page.handling).includes("NOFORN"))throw Error("This page is outside the bound evidence policy.");
    const pageHash=await verifySourcePage(page,c);
    const additional=[],seen=new Map([[proof.canonical_page_id,pageHash]]);
    for(const other of list(data.document_pages)){
      if(other.document_id!==page.document_id||other.date!==page.date)throw Error("An additional source segment belongs to another document or date.");
      const hash=await verifySourcePage(other,c),id=other.canonical_page_id||other.id;
      if(seen.has(id)){if(seen.get(id)!==hash)throw Error("A repeated source segment changed its text binding.");continue;}
      seen.set(id,hash);additional.push(other);
    }
    const chars=Array.from(page.text),hasInterval=Number.isInteger(proof.start)&&Number.isInteger(proof.end)&&typeof proof.text==="string";
    let verified=false;
    if(hasInterval){
      if(proof.start<0||proof.end<=proof.start||proof.end>chars.length||chars.slice(proof.start,proof.end).join("")!==proof.text)throw Error("The source does not reproduce a nonempty saved quotation. No verified highlight is shown.");
      if(pageHash!==proof.page_sha256)throw Error("The original source failed its integrity check. No verified highlight is shown.");
      verified=true;
    }
    if(epoch!==state.drawerEpoch||!$("#detail-drawer").open)return;
    const body=box(fields([["Document",page.document_id,true],["Source date",page.date],["View",c.corpus==="cib"?"Earlier-visible CIB":"Bound CONFIDENTIAL evidence"],["Canonical page",proof.canonical_page_id,true]]),
      note(verified?"Original quotation verified":"Original segment text/hash verified / no localized quotation supplied","verified"));
    body.append(note("The highlight uses raw Unicode character offsets within the selected segment, not the entire cable or PDF. A matching text hash does not certify a historical assertion."));
    if(c.corpus==="cib"){
      const earlierPage=proof.earlier_page??page.earlier_page;
      body.append(link("Open earlier-release PDF"+(Number.isInteger(earlierPage)?" / page "+earlierPage:""),"/api/cib-pdf?"+new URLSearchParams({doc_id:page.document_id,release:"earlier"})+(Number.isInteger(earlierPage)&&earlierPage>0?"#page="+earlierPage:""),"button"));
    }
    body.append(link("Look up this source in the corpus graph",graphURL({source_id:proof.canonical_page_id}),"button"),note(GRAPH_SCOPE,"notice"));
    const raw=el("div",null,{class:"source-document","data-testid":"source-document"});
    if(verified)raw.append(document.createTextNode(chars.slice(0,proof.start).join("")),el("mark",proof.text),document.createTextNode(chars.slice(proof.end).join("")));else raw.textContent=page.text;
    body.append(heading("Selected source segment"),raw);
    if(Array.isArray(data.document_pages))body.append(heading("Other supplied eligible segments of this source document"),note(`${additional.length} other segments supplied and independently verified. This is the eligible text packet returned by the server, not a guarantee that every original page or format is represented.`));
    else body.append(note("Only the selected segment was published in this response. It must not be mistaken for the whole document.","notice"));
    for(const [index,other] of additional.entries()){
      const section=el("section",null,{class:"additional-source-segment"});section.append(el("h3",`Segment ${index+1} / ${other.canonical_page_id||other.id}`),note("Original segment text/hash verified","verified"),el("div",other.text,{class:"source-document","data-testid":"additional-source-segment"}));body.append(section);
    }
    $("#detail-body").replaceChildren(body);
  }catch(error){if(epoch===state.drawerEpoch&&error.name!=="AbortError")$("#detail-body").replaceChildren(note(error.message,"error-card"));}
}

async function verifySourcePage(page,c) {
  if(typeof page.text!=="string"||!(page.canonical_page_id||page.id))throw Error("A source segment has no replayable text or identity.");
  if(!page.date||page.date>=c.date||page.document_id===c.document_id)throw Error("This page violates the selected case's strict cutoff or whole-origin exclusion.");
  if(page.permitted===false||page.visibility==="later"||c.corpus!=="cib"&&page.classification&&page.classification!=="CONFIDENTIAL"||list(page.handling).includes("NOFORN"))throw Error("This page is outside the bound evidence policy.");
  const serialized=JSON.stringify(page.text).replace(/[\u007f-\uffff]/g,char=>"\\u"+char.charCodeAt(0).toString(16).padStart(4,"0"));
  const hash=await sha256(new TextEncoder().encode(serialized));
  if(hash!==(page.source_sha256||page.page_sha256))throw Error("The original source failed its integrity check. No verified highlight is shown.");
  return hash;
}

async function nodeDrawer(value) {
  const supplied=typeof value==="string"?{id:value}:value||{},id=supplied.id||supplied.node_id;
  if(!id)return;
  const node={...supplied,...state.projection?.nodes?.find(n=>n.id===id)},type=String(node.type||"").toLowerCase();
  if(type==="query"){
    openDrawer(node.label||"Query restart input","Planning / not a historical graph node",box(note(node.explanation||"A visible-query restart input; it is not a source assertion.","notice")));return;
  }
  if(node.readout_only||node.solver_state===false){
    if(node.citation){sourceDrawer(node.citation);return;}
    const body=box(note("Saved search/construction readout only. This is not a solver state, semantic entity or historical connection.","notice"),fields([["Readout type",node.type],["Saved text",node.label,true]]));
    for(const search of list(node.executed_searches))body.append(note(search.query||search.text||"Search text not supplied"));
    if(node.receipt)body.append(fields([["Source document",node.receipt.document_id,true],["Receipt method",node.receipt.method],["Primary construction page",node.receipt.primary_construction_page],["Construction page rank",node.receipt.construction_page_rank]]));
    openDrawer("Saved source readout","Provenance / no graph identity",body);return;
  }
  const hierarchy=/^hierarchy:(domain|theme|community):(.+)$/.exec(id);
  if(node.layout_only||hierarchy||["domain","theme","community"].includes(type)){
    const groupId=node.group_id||hierarchy?.[2],children=list(state.projection?.nodes).filter(n=>n.parent_id===id);
    const body=box(note(node.layout_only?"Layout container only. No solver mass has been invented for this group.":"A recorded hierarchy/navigation group, not a historical relation.","notice"),fields([["Type",node.type||hierarchy?.[1]],["Parent",node.parent_id,true],["Projection group ID",id,true],["Bare group ID",groupId,true]]));
    if(!node.layout_only){const index=Number($("#diffusion-v6 [data-frame-number]")?.value||0),frame=state.projection?.frames?.[index],mass=Number.isInteger(node.mass_index)?frame?.weights?.[node.mass_index]:null;body.append(note(Number.isFinite(mass)?`Saved iteration ${frame.iteration} / solver mass ${fmt(mass)}. Routing influence, not source support.`:"No saved solver mass was supplied for this group in the selected frame."));}
    body.append(heading("Projected membership / not factual relations"),note(`${children.length} direct children shown in this saved projection; this is not exhaustive corpus membership.`));
    for(const child of children.slice(0,12))body.append(button(child.label||child.id,()=>nodeDrawer(child)));
    if(children.length>12)body.append(note("The first twelve projected children are listed."));
    if(groupId)body.append(link("Open Corpus Map / separate scope",graphURL({node_id:groupId}),"button"),note(GRAPH_SCOPE));
    openDrawer(node.label||"Hierarchy group","Navigation, not historical evidence",body);return;
  }
  const c={...state.row.case},epoch=openDrawer(node.label||"Source-connected node","Case-scoped knowledge graph",note("Loading eligible source connections..."));
  try{
    const data=await getJSON("/api/node-v6?"+new URLSearchParams({case_id:c.case_id,node_id:id}));
    if(epoch!==state.drawerEpoch||!$("#detail-drawer").open)return;
    if(data.cutoff&&data.cutoff!==c.date||data.whole_origin_excluded&&data.whole_origin_excluded!==c.document_id)throw Error("The node view belongs to another source boundary.");
    const body=box(note("Eligible source connections, not proof of a new assertion. Hierarchy navigation is separate from source testimony.","notice"),link("Open Corpus Map / separate scope",graphURL({node_id:id}),"button"),note(GRAPH_SCOPE));
    if(data.scope==="SAVED_DISPLAY_PROJECTION_ONLY"&&typeof data.note==="string"&&data.note.trim())body.append(note(data.note,"notice"));
    for(const edge of list(data.edges)){const item=el("section",null,{class:"path-card"});item.append(heading(edge.relation||primitive(edge.kind)));for(const proof of list(edge.citations))item.append(sourceButton(proof));body.append(item);}
    if(!list(data.edges).length)body.append(note(data.scope==="SAVED_DISPLAY_PROJECTION_ONLY"?"No source connections are saved for this node in the displayed projection. The full corpus graph is separate.":"No eligible source edges were returned for this node.","empty"));
    $("#detail-body").replaceChildren(body);
  }catch(error){if(epoch===state.drawerEpoch)$("#detail-body").replaceChildren(note(error.message,"error-card"));}
}

function candidateDetail(candidate) {
  const support=candidate.support_assessment||{},d=disposition(candidate),body=box(el("blockquote",candidate.fill,{class:"cue"}),dispositionPanel(candidate),
    note(support.scope||"Focal contribution only, not a whole-event guarantee.","notice"));
  body.append(localDecisionPanel(candidate),note(displayText(d.explanation||support.explanation)||"No local explanation supplied."),fields([["Recorded insertion fit",feasibility(candidate).label],["Source identity binding / saved value",candidate.support_dimensions?.identity],["Support scope",supportDimensions(candidate).scope]]));
  body.append(rawInspector({candidate_feasibility:candidate.candidate_feasibility,disposition:candidate.disposition,grammar_admission:candidate.grammar_admission,v21_joint_fit:candidate.v21_joint_fit,
    support_dimensions:candidate.support_dimensions,support_assessment:{...support,evidence:undefined},local_fields:Object.fromEntries(
      ["accepted","rejected","recommended","local_acceptance","local_recommendation","local_decision"].filter(key=>Object.hasOwn(candidate,key)).map(key=>[key,candidate[key]]))}));
  body.append(heading("Original source wording"),el("div",candidate.source_wording||"Not supplied",{class:"raw-text"}));
  const needed=d.needed??support.needed;
  if(needed&&(Array.isArray(needed)?needed.length:true)){body.append(heading("What is still needed"));for(const text of Array.isArray(needed)?needed:[needed])body.append(note(text));}
  if(candidate.ranking_explanation)body.append(heading("Why this position"),note(candidate.ranking_explanation));
  const rank=candidate.ranking_comparison;
  if(rank?.criterion_label)body.append(note(`${rank.criterion_label}: ${primitive(rank.candidate_value)} versus ${primitive(rank.other_value)} for ${rank.other_fill||"the adjacent proposal"}. Ordered relevance, not correctness probability.`));
  if(list(candidate.insertion_edits).length){body.append(heading("Saved insertion edits"));for(const edit of candidate.insertion_edits)body.append(note(edit.explanation||edit.reason||primitive(edit.kind)));}
  body.append(advisory(candidate)||note("No separate post-run review was published."),heading("Source quotations"));
  const seen=new Set();
  for(const source of [...list(candidate.sources),...list(support.evidence).map(e=>e.citation).filter(Boolean)]){
    const key=[source.canonical_page_id,source.start,source.end].join("/");if(seen.has(key))continue;seen.add(key);body.append(sourceButton(source,{back:()=>candidateDetail(candidate)}));
  }
  if(!seen.size)body.append(note("No source quotations were supplied.","empty"));
  openDrawer("Candidate / "+short(candidate.fill,9),`Arm ${state.arm} / saved rank, not probability`,body);
}
function roleCertificatePanel(evidence,atom,back) {
  const cert=evidence.source_local_role_certificate;if(!cert)return null;
  const trace=list(cert.interpretation_trace),one=step=>{const rows=trace.filter(row=>row?.step===step);return rows.length===1?rows[0]:null;};
  const identity=one("EXACT_LOCAL_ENTITY_LABEL"),raw=one("LITERAL_PROPER_NAME_APPOSITION"),proof=proofOf(cert.apposition_quote);
  const currentText=atom.text||atom.source_quote;
  const supported=evidence.match_representation==="SOURCE_LOCAL_KG_ROLE_ALIGNMENT"&&
    cert.version==="source-local-role-certificate/6.1"&&cert.status==="KG_MEDIATED_ROLE_ALIGNMENT"&&
    cert.case_id===state.row.case.case_id&&cert.atom_id===atom.id&&cert.atom_binding?.id===atom.id&&
    cert.claim===currentText&&cert.atom_binding?.text===currentText&&cert.certificate_only===true&&
    cert.certifies_whole_query===false&&cert.canonical_identity_merge===false&&cert.global_node_aggregate_used===false&&
    [identity?.query_label,cert.source_actor_label,raw?.raw_person,raw?.raw_role,raw?.raw_organization,proof?.text]
      .every(value=>typeof value==="string"&&value.trim())&&proof?.canonical_page_id&&
    Number.isInteger(proof.start)&&Number.isInteger(proof.end)&&proof.start>=0&&proof.end>proof.start;
  if(!supported){const notice=note("A saved role certificate is present but its version, atom binding or scope is not supported here; it is not interpreted. The unchanged native evidence and ordinary source proof remain available.","notice");notice.dataset.testid="role-certificate-notice";return{node:notice,proof:null};}
  const panel=el("section",null,{class:"path-card","data-testid":"role-certificate"});
  panel.append(heading("Source-local role alignment"),fields([
    ["Query label / local",identity.query_label,true],["Exact label in source",cert.source_actor_label,true],
    ["Full name in this apposition",raw.raw_person,true],["Source role",raw.raw_role,true],
    ["Source organization",raw.raw_organization,true],["Bound atom",cert.atom_id,true]]),
    note(`Applies to only this atom (${cert.atom_id}); not whole-query proof. No global alias or canonical identity merge is licensed. This source statement is not a world-truth certification.`,"notice"));
  const remaining=list(cert.remaining_query_atom_ids).filter(id=>typeof id==="string");
  if(remaining.length)panel.append(note("Not certified by this certificate: "+remaining.join(", ")+". Their own native evidence must be assessed separately."));
  panel.append(el("h4","Original source apposition"),sourceButton(proof,{back}),note("Saved raw wording. Open the source to replay its character bounds and text hash; a matching quotation does not establish unrelated actions or dates."));
  return{node:panel,proof};
}
function atomDetail(atom) {
  const executed=list(state.saved.result?.atoms).find(a=>a.id===atom.id)||atom;
  const label=atomLabel(executed.status),body=box(el("blockquote",atom.text||atom.source_quote,{class:"cue"}),
    state.row.case.task==="reconstruction"&&!recordedCoverage(executed.status)?note(label):badge(label),rawInspector({status:executed.status,state:executed.state}),
    note("An input proposition is not established merely by appearing in a plan. These labels present recorded local states; they are not new verdicts.","notice"),advisory(executed));
  const contradiction=contradictionWarning(executed);if(contradiction)body.append(contradiction);
  for(const issue of list(executed.binding_issues))body.append(note(primitive(issue),"notice"));
  body.append(heading("Saved source records / directions retained"));
  for(const evidence of list(executed.evidence)){
    body.append(badge(humanDirection(evidence.direction)));
    const role=roleCertificatePanel(evidence,executed,()=>atomDetail(atom));if(role)body.append(role.node);
    const ordinary=proofOf(evidence.citation||evidence),sameProof=role?.proof&&ordinary&&
      ["canonical_page_id","start","end","text","page_sha256"].every(key=>role.proof[key]===ordinary[key]);
    if(!sameProof)body.append(sourceButton(evidence.citation||evidence,{back:()=>atomDetail(atom)}));
    const diagnostics=evidence.diagnostics;if(diagnostics){const dl=[];for(const [key,value] of Object.entries(diagnostics))if(value?.status)dl.push([key,displayText(value.status)]);body.append(fields(dl));}
  }
  if(!list(executed.evidence).length)body.append(note("No substantive evidence records were published. Missing evidence is not counterevidence.","empty"));
  const omission=evidenceOmission(executed);if(omission)body.append(omission);
  if(list(executed.exploratory_passages).length){body.append(heading("Exploratory context / not support votes"));for(const quote of executed.exploratory_passages)body.append(sourceButton(quote.citation||quote,{back:()=>atomDetail(atom)}));}
  openDrawer("Proposition / "+atom.id,`Arm ${state.arm} / ${TASKS[state.row.case.task]}`,body);
}

function renderTaskAssembly(host,task) {
  const complete=state.row.case.task==="reconstruction";
  host.append(heading(complete?"Established source assembly":"Exploratory source account / not established"));
  const items=complete?list(task.assembled_components):list(task.exploratory_source_cited_account||task.alternative_interpretations||task.source_cited_account);
  function component(item,parent){
    const card=el("section",null,{class:"assembly-card"});card.append(note(item.account||item.text||item.proposition||item.interpretation||item.source_quote||item.planned_proposition||"Saved source component"));
    card.append(groupedSources(item.citation?[item.citation]:list(item.citations)));
    const atom=list(state.saved.result?.atoms).find(a=>a.id===item.atom_id);if(atom)card.append(button("Trace linked proposition",()=>selectAtomTarget(atom)));parent.append(card);
  }
  function components(rows,parent){
    if(!rows.length)return;
    const citations=rows.flatMap(item=>item.citation?[item.citation]:list(item.citations));
    parent.append(note(sourceCountText(citations)+". Repeated components do not add covered requirements."),compactEvidence(rows,{label:"source components",render:item=>{const wrapper=box();component(item,wrapper);return wrapper;}}));
  }
  components(items,host);
  if(!items.length)host.append(note(complete?"No established assembly components were published. No narrative bridge is filled in.":"No source-cited account was published.","empty"));
  if(complete&&list(task.exploratory_source_cited_account).length){const details=el("details");details.append(el("summary","Exploratory components / not established assembly"),note("Related source accounts do not become certified components or fill gaps in the narrative."));components(task.exploratory_source_cited_account,details);host.append(details);}
  if(list(task.retrieved_source_accounts).length){const details=el("details");details.append(el("summary","Retrieved source quotations / not query entailment"),note(task.retrieved_source_account_meaning||"A chronology of source reports, not a certified chronology or causal account of events."));components(task.retrieved_source_accounts,details);host.append(details);}
  host.append(heading("Unresolved gaps"));if(list(task.gaps).length)host.append(compactEvidence(task.gaps,{label:"gaps",render:gap=>note(gap.proposition||gap.text||gap.reason||gap.required_proposition||"Unresolved requirement","notice")}));
  if(!list(task.gaps).length)host.append(note("No separate gap list was supplied. This does not certify completeness."));
  for(const bridge of list(task.hypothetical_bridges)){host.append(heading("Conditional bridge / not established"),note(bridge.required_proposition||bridge.text||bridge.condition||"Additional source evidence would be required."));}
}

async function navigateFromURL({push=false,scroll=true}={}) {
  const params=new URLSearchParams(location.search),requestedArm=params.get("arm")||"A";
  if(requestedArm.toUpperCase()==="D"||requestedArm==="legacy_reference"){
    state.row=null;state.saved=null;state.loading=false;renderRail();renderWorkspace();
    showError("D is not an active condition in this public casebook. Its older records remain archived locally; no arm has been substituted.");return;
  }
  $("#case-corpus").value=Object.hasOwn(CORPORA,params.get("corpus"))?params.get("corpus"):"";
  $("#case-task").value=Object.hasOwn(TASKS,params.get("task"))?params.get("task"):"";
  $("#case-show").value=params.get("show")==="reserve"?"all":["presentation","bench","all"].includes(params.get("show"))?params.get("show"):"presentation";
  state.arm=Object.hasOwn(ARMS,requestedArm.toUpperCase())?requestedArm.toUpperCase():Object.keys(ARMS).find(k=>ARMS[k].key===requestedArm)||"A";
  $("#arm-select").value=state.arm;state.stage=/^0[1-6]$/.test(params.get("stage")||"")?params.get("stage"):"01";
  if(params.get("view")==="home"){state.epoch++;request?.abort();destroyVisuals();state.projection=null;state.row=null;state.saved=null;state.home=true;state.loading=false;closeDrawer();clearError();renderRail();renderWorkspace();return;}
  state.home=false;
  const id=params.get("case"),matches=id?catalogCases().filter(r=>r.case.case_id===id||r.case.case_id.endsWith("_"+id)):[];
  if(id&&matches.length!==1){state.epoch++;request?.abort();destroyVisuals();state.projection=null;closeDrawer();state.row=null;state.saved=null;state.loading=false;renderWorkspace();renderRail();showError(matches.length?"This case alias is ambiguous. Select its full published identity.":"This question is not in the published casebook. No other case has been substituted.");return;}
  const row=matches[0]||visibleCases()[0];
  if(row){
    if(matches.length){
      if($("#case-show").value!=="all"&&$("#case-show").value!==presentationGroup(row))$("#case-show").value=presentationGroup(row)==="archive"?"all":presentationGroup(row);
      if($("#case-corpus").value&&$("#case-corpus").value!==row.case.corpus)$("#case-corpus").value=row.case.corpus;
      if($("#case-task").value&&$("#case-task").value!==row.case.task)$("#case-task").value=row.case.task;
      if(!visibleCases().some(r=>r.case.case_id===row.case.case_id))$("#case-search").value="";
    }
    await chooseCase(row,{push,reading:params.get("reading")||"",candidate:params.get("candidate")||"",scroll});
  }else{
    state.epoch++;request?.abort();destroyVisuals();state.projection=null;closeDrawer();state.row=null;state.saved=null;state.loading=false;clearError();renderRail();renderWorkspace();savePosition({push});
    $("#page-state").textContent="No saved questions match these filters. No other case has been substituted.";
  }
}
window.addEventListener("popstate",()=>{viewportAnchor.cancel();navigateFromURL({scroll:false});});
try{
  const selection=await embeddedShowcaseSelection();
  state.sourceReport=await getJSON("/data/report-v6.json",{hash:selection?.source_report_sha256});
  state.report=state.sourceReport;
  if(!Array.isArray(state.report.cases))throw Error("The publication contains no case catalog.");
  state.catalog=selectShowcaseCatalog(state.sourceReport,selection,selection?.source_report_sha256);
  if(state.catalog){const note=$("#showcase-curation-note");if(note){note.hidden=false;note.textContent=selection.curation_note||"Curated, outcome-informed demonstrations: one case per fact family across this public casebook, not benchmark accuracy. Other saved records remain archived locally.";}}
  if(state.report.status==="PARTIAL"){const scope=$("#publication-scope");scope.hidden=false;scope.textContent=`Development preview: ${state.report.completed_cases??0} replayed questions; ${state.report.pending_cases??0} declared questions await new execution. This is not the final presentation selection.`;}
  await navigateFromURL();
}catch(error){state.catalog=null;state.report=null;state.sourceReport=null;showError(error.message);$("#page-state").textContent="The bound public casebook is unavailable. No archived data has been substituted.";$("#case-view").setAttribute("aria-busy","false");$("#case-view").replaceChildren(note("The unchanged source report and approved catalog selection must agree before questions can be displayed.","empty"));}

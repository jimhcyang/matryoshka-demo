import {createViewportAnchor} from "./viewport-anchor-v64.js";
import {formatNumber,formatTargetText} from "./flow-layout-v4.js";
import {direction as humanDirection,displayText,coverage as recordedCoverage,localTaskVerdict,factual,feasibility,localDecisions,selectionSummary,llmReview} from "./verdict-v64.js";
import {decisionLabel,packetFor,unitFor,overviewFor,reviewDisclosure,guideDisclosure,routeProvenance,exactGateReview,verdictSummary,exactOriginAnchors,sidebarDecisionSummary,decisionSummaryFor,preferredReading,canonicalGateJSON,isCounterhypothesis,presentationDecisionReview,presentationTitle,hasRequestedAnalystDigest,hypothesisReadout,assertionDecision,currentResourceURL,verifyCurrentResourceResponse,readingExplanation,currentPDFURL,currentReportStatusBadge,publishedConditionStatus,readingLabel} from "./local-decisions-v65.js";
import {preparePostrunReview,verifyPostrunReview} from "./postrun-review-v74.js";
import {mountSavedRoutes,uniqueProofs,decisionProofs,digestProofs,renderScoreChart,renderTerminalScoreCards,studyCompanionCases,workbenchSourceScope,recordedAtomLinks,guideRoutes,groupDuplicateFills} from "./workbench-visuals.js";
import {computeDecisionScores,formatDecisionScore} from './decision-scores.js';
import {sourceScopeAllows} from './saved-source-policy.js';
import {mountEvidenceMap} from './evidence-map.js';
import {loadSourceLookups} from './source-lookups-v1.js';
import {loadReaderCasing,readerText} from './reader-casing.js';
import {exactSourceAnchor,focalReferenceFromOrigin,appendCIBPDFPair} from './source-inspection.js';
await loadReaderCasing();
const $ = selector => document.querySelector(selector);
const list = value => Array.isArray(value) ? value : [];
const CORPORA = {cib:"Central Intelligence Bulletins",iran:"Iran",vietnam:"Vietnam"};
const TASKS = {redaction:"Redaction",hypothesis:"Hypothesis",mosaic:"Mosaic",reconstruction:"Mosaic"};
// BEGIN_CASEBOOK_FILTERS
export function casebookTask(task){return task==='mosaic'?'reconstruction':task;}
export function filterCasebook(manifest,{corpus="",task=""}={}){
  if(!["","vietnam","iran","cib"].includes(corpus)||!["","mosaic","reconstruction","hypothesis","redaction"].includes(task))throw Error("Unknown casebook filter.");
  const primary=Array.isArray(manifest?.primary)?manifest.primary:[];
  const matches=row=>(!corpus||row.corpus===corpus)&&(!task||casebookTask(row.task)===casebookTask(task));
  if(task==="redaction"&&(!corpus||corpus==="cib"))return (Array.isArray(manifest?.special_redactions)?manifest.special_redactions:[]).filter(matches);
  return primary.filter(matches);
}
export function bindCasebook(manifest,rows,{reportSHA,reportRun}={}){
  if(manifest?.version!=="workbench-casebook/1"||!/^[a-f0-9]{64}$/.test(reportSHA||'')||!reportRun||manifest.source_report_sha256!==reportSHA||manifest.source_report_run!==reportRun)throw Error("The examples manifest belongs to another publication.");
  const readySubset=manifest.selection_scope==='ready_subset';
  if(!Array.isArray(manifest.primary)||manifest.primary.length>9||readySubset&&!manifest.primary.length)throw Error("The examples manifest must declare nine primary cases or their explicit availability.");
  const byId=new Map(rows.map(row=>[row.case.case_id,row])),corpora=["vietnam","iran","cib"],tasks=["reconstruction","hypothesis","redaction"];
  const primaryIds=new Set(),cells=new Set();
  const resolve=entry=>{
    const row=byId.get(entry?.case_id),c=row?.case;
    if(!c||!corpora.includes(c.corpus)||!tasks.includes(casebookTask(c.task))||entry.corpus!==c.corpus||entry.task!==c.task)throw Error("An examples entry is not an exact active case.");
    if(entry.case&&["case_id","corpus","task","query","document_id","date","focal_marker"].some(key=>entry.case[key]!==c[key]))throw Error("An examples entry changes the saved question.");
    if(entry.resource_binding&&["resource_id","registry_sha256","index_sha256"].some(key=>entry.resource_binding[key]!==row.resource_binding?.[key]))throw Error("An examples entry changes the active resource.");
    return {case_id:c.case_id,corpus:c.corpus,task:c.task,row,source_label:typeof entry.source_label==='string'?entry.source_label:''};
  };
  const primary=manifest.primary.map(entry=>{
    const value=resolve(entry),cell=value.corpus+"/"+casebookTask(value.task);
    if(primaryIds.has(value.case_id)||!readySubset&&cells.has(cell))throw Error("The examples manifest repeats a primary case or corpus/task cell.");
    primaryIds.add(value.case_id);cells.add(cell);return value;
  });
  const availabilityKeys=['requested_primary_count','completed_primary_count','pending_primary','requested_primary_slots'];
  if(readySubset){
    if(['requested_primary_count','completed_primary_count'].some(key=>Object.hasOwn(manifest,key)&&manifest[key]!==primary.length)||Object.hasOwn(manifest,'pending_primary')&&(!Array.isArray(manifest.pending_primary)||manifest.pending_primary.length))throw Error('A ready subset may contain only its explicitly completed primary cases.');
    if(Object.hasOwn(manifest,'requested_primary_slots')&&(!Array.isArray(manifest.requested_primary_slots)||manifest.requested_primary_slots.length!==primary.length||new Set(manifest.requested_primary_slots.map(slot=>slot?.public_case?.case_id)).size!==primary.length||manifest.requested_primary_slots.some(slot=>slot?.execution_state!=='COMPLETED'||!primaryIds.has(slot?.public_case?.case_id)||['case_id','corpus','task','query','document_id','date','focal_marker'].some(key=>slot.public_case[key]!==byId.get(slot.public_case.case_id)?.case[key]))))throw Error('Ready subset slots must match their exact completed cases.');
  }else if(primary.length!==9||availabilityKeys.some(key=>Object.hasOwn(manifest,key))){
    const pending=manifest.pending_primary,slots=manifest.requested_primary_slots;
    if(manifest.requested_primary_count!==9||manifest.completed_primary_count!==primary.length||!Array.isArray(pending)||!Array.isArray(slots)||slots.length!==9||primary.length+pending.length!==9)throw Error("Incomplete primary examples require an exact nine-slot availability declaration.");
    const publicKeys=['case_id','corpus','task','query','document_id','date','focal_marker'];
    const sameCase=(a,b)=>a&&b&&publicKeys.every(key=>Object.hasOwn(a,key)&&Object.hasOwn(b,key)&&a[key]===b[key]);
    const slotIds=new Set(),slotCells=new Set(),pendingIds=new Set();
    const hasSavedData=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>item!=null&&(/native|(?:^|_)ref(?:erence)?$|^(?:row|current_row|saved_result|configurations|resource_binding|checkpoint)$/.test(key)||hasSavedData(item)));
    for(const entry of pending){
      const c=entry?.public_case;
      if(!c||entry.execution_state!=='PENDING_NO_NATIVE'||byId.has(c.case_id)||primaryIds.has(c.case_id)||pendingIds.has(c.case_id)||hasSavedData(entry))throw Error("A pending primary must have no saved native result, reference or current row.");
      const slot=slots.find(value=>value?.public_case?.case_id===c.case_id);
      if(!slot||slot.execution_state!==entry.execution_state||!sameCase(slot.public_case,c))throw Error("A pending primary changes its declared public case or execution state.");
      if(entry.planning_or_execution_outcome&&(entry.planning_or_execution_outcome.case_id!==c.case_id||!sameCase(entry.planning_or_execution_outcome.public_case,c)))throw Error("A pending planning outcome changes its declared public case.");
      pendingIds.add(c.case_id);
    }
    for(const slot of slots){
      const c=slot?.public_case,cell=c?.corpus+'/'+casebookTask(c?.task);
      if(!c||!corpora.includes(c.corpus)||!tasks.includes(casebookTask(c.task))||slotIds.has(c.case_id)||slotCells.has(cell))throw Error("Requested primary slots must be nine unique corpus/task cells and cases.");
      if(primaryIds.has(c.case_id)){
        if(slot.execution_state!=='COMPLETED'||!sameCase(c,byId.get(c.case_id)?.case))throw Error("A completed primary changes its declared public case or execution state.");
      }else if(!pendingIds.has(c.case_id)||slot.execution_state!=='PENDING_NO_NATIVE')throw Error("A requested primary slot has no exact completed or pending declaration.");
      slotIds.add(c.case_id);slotCells.add(cell);
    }
  }
  if(!Array.isArray(manifest.special_redactions)||manifest.special_redactions.length>5)throw Error("The special CIB redactions group is malformed.");
  const seenSpecial=new Set(),special_redactions=manifest.special_redactions.map(entry=>{
    const value=resolve(entry);
    if(value.corpus!=="cib"||value.task!=="redaction"||seenSpecial.has(value.case_id))throw Error("The special CIB redaction group repeats or changes a case.");
    seenSpecial.add(value.case_id);return value;
  });
  const backgrounds={};
  for(const corpus of corpora){
    const entries=manifest.backgrounds?.[corpus]||[];
    if(!Array.isArray(entries))throw Error("Corpus backgrounds are malformed.");
    const seen=new Set();backgrounds[corpus]=entries.map(entry=>{
      const row=primary.find(value=>value.case_id===entry.case_id&&value.corpus===corpus);
      if(!row||seen.has(entry.case_id)||typeof entry.background!=="string"&&typeof entry.historical_setup!=="string")throw Error("A corpus background is not bound to its primary case.");
      if(entry.citation&&(entry.citation.document_id!==row.row.case.document_id||entry.citation.date!==row.row.case.date||entry.citation.eligible_evidence!==false))throw Error("A corpus background changes its query-origin provenance.");
      seen.add(entry.case_id);return entry;
    });
  }
  primary.sort((a,b)=>['iran','cib','vietnam'].indexOf(a.corpus)-['iran','cib','vietnam'].indexOf(b.corpus)||
    ['reconstruction','hypothesis','redaction'].indexOf(casebookTask(a.task))-
    ['reconstruction','hypothesis','redaction'].indexOf(casebookTask(b.task)));
  return {primary,special_redactions,backgrounds,selection_scope:readySubset?'ready_subset':'primary_grid',requested_primary_count:readySubset?primary.length:9,completed_primary_count:primary.length,notice:typeof manifest.notice==="string"?manifest.notice:""};
}
export function caseBackgroundSetup(entry){
  if(typeof entry?.historical_setup==='string')return entry.historical_setup.trim();
  const text=typeof entry?.background==='string'?entry.background.trim():'';
  return text.match(/^.*?[.!?](?:\s|$)/)?.[0].trim()||text;
}
// END_CASEBOOK_FILTERS
const ARMS = {
  A:{key:"llm_readings",name:"LLM readings",origin:"Visible-query atoms and model grammatical readings"},
  B:{key:"llm_atoms",name:"Atoms only",origin:"Required assertions without additional readings"},
  C:{key:"llm_local",name:"Local readings",origin:"Required assertions and local grammatical readings"}
};
for(const option of $("#arm-select").options)if(ARMS[option.value])option.textContent=ARMS[option.value].name;
const STAGES = [["01","Input"],["02","Facts"],["03","Routes"],["04","Sources"],["05","Construction"],["06","Review"]];
const GRAPH_SCOPE = "The full Corpus Map is separate from this question's evidence view. Ordinary map lookup does not inherit the strict cutoff or whole-origin exclusion; a saved Guide Path carries its own case scope. Map context is not automatically eligible proof.";
const state = {report:null,sourceReport:null,manifest:null,trace:null,catalog:null,casebook:null,casebookPending:"Loading the source-bound examples catalog...",filters:{corpus:"",task:""},row:null,saved:null,gateReview:null,home:false,arm:"A",reading:"",candidate:"",originalPath:0,stage:"01",reference:false,loading:false,pending:"",epoch:0,drawerEpoch:0,flow:null,paths:null,projection:null,compareReadings:false,reviewReading:"",independentReview:null,reviewEpoch:0};
const conditionCache = new Map();
const projectionCache = new Map();
const originCache = new Map();
const originRequests = new Map();
const originFocalReferences = new Map();
const referenceRequests = new Map();
const originKinds = new Map();
const sourceContextCache = new Map();
const endpointCache=new Map();
const railDecisionCache = new Map(),railMetadataChecks = new Map();
const publicationByteHashes=new WeakMap();
const verifiedCurrentPublications=new WeakSet();
const staticCurrentPublications=new WeakSet();
let request, sourceRequest, reviewRequest, flowModule,narrativeUI,narrativeAccess,narrativeEndpoints;
const viewportAnchor=createViewportAnchor();
function toggleExamples(open){
  viewportAnchor.cancel();
  const rail=$("#examples-rail"),toggle=$("#examples-toggle");
  rail.classList.toggle("is-open",open);$(".workbench-shell").classList.toggle("examples-open",open);rail.inert=!open;toggle.setAttribute("aria-expanded",String(open));
  if(open)rail.querySelector('[data-corpus][aria-pressed=true]')?.focus({preventScroll:true});else toggle.focus({preventScroll:true});
}
$("#examples-toggle").onclick=()=>toggleExamples(!$("#examples-rail").classList.contains("is-open"));
$("#examples-close").onclick=()=>toggleExamples(false);
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&$("#examples-rail").classList.contains("is-open"))toggleExamples(false);});

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
async function loadCasebook(){
  try{
    const supplied=document.querySelector('link[rel="workbench-casebook"]'),url=new URL(supplied?.getAttribute('href')||'/api/current/casebook',location.href);
    if(url.origin!==location.origin||!['http:','https:'].includes(url.protocol))throw Error('The examples manifest must use the local viewer.');
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw Error('The compatible examples catalog is not published yet.');
    const bytes=await response.arrayBuffer();
    if(supplied){const pin=supplied.dataset.sha256;if(!/^[a-f0-9]{64}$/.test(pin||'')||await sha256(bytes)!==pin)throw Error('The static examples manifest failed its byte pin.');}
    const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    state.casebook=bindCasebook(manifest,catalogCases(),{reportSHA:publicationByteHashes.get(state.report),reportRun:state.report.run_id});
    const methods=new Set([...state.casebook.primary,...state.casebook.special_redactions].flatMap(entry=>Object.keys(entry.row.configurations||{})));
    state.readySingleMethod=state.casebook.selection_scope==='ready_subset'&&methods.size===1;
    $('.workspace-toolbar').hidden=state.readySingleMethod;
    state.casebookPending='';
  }catch(error){state.casebook=null;state.casebookPending=error.message+' No alternate engine or unselected cases are substituted.';}
}

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
function readable(text) { return readerText(text,state.row?.case?.corpus); }
function short(text,n=12) { const words=String(text||"").trim().split(/\s+/);return words.slice(0,n).join(" ")+(words.length>n?"...":""); }
function title(row) { return typeof row.presentation_title==="string"&&row.presentation_title.trim()?presentationTitle(row):row.display_title || row.case.title || short(row.case.query.replace(/^(?:\s*\[REDACTED\]\s*)+/i,"").replace(/\[(?:REDACTED|REDACTION[^\]]*)\]/gi,"masked passage"),11); }
let livePacket=null;
function isLivePublication(){return state.report?.version==='matryoshka-live-report/1';}
function isNarrativePublication(){return isLivePublication()||state.report?.version==='narrative-workbench-publication/1';}
function isCurrentPublication(){return isNarrativePublication()||state.report?.version==='current-workbench-publication/1';}
function hasOpenedResult(){return true;}
function isStaticPublicReplay(){return staticCurrentPublications.has(state.report);}
function publicAuditNotice(){
  return isStaticPublicReplay()&&[state.row,state.saved,state.saved?.result].some(value=>value?.public_audit_projection&&typeof value.public_audit_projection==='object'&&!Array.isArray(value.public_audit_projection))?
    'This public export abbreviates internal comparison-audit arrays. Recorded counts and hashes describe the omitted audit rows; the full native checkpoint is not included.':null;
}
function presentationGroup(row) {
  if(isCurrentPublication()&&row.current_resource_execution===true)return row.selected_demo===true&&row.selected_bench!==true?'presentation':row.selected_bench===true&&row.selected_demo!==true?'bench':'archive';
  const group=row.presentation_selection?.group;if(["presentation","bench","archive"].includes(group))return group;
  return 'archive'; }
function queryKind(row) { return row.presentation_selection?.query_kind||row.query_kind||originKinds.get(row.case?.case_id); }
function analystAlternativeKind(kind) { return typeof kind==="string"&&kind.startsWith("ANALYST_ALTERNATIVE_"); }
function syntheticMaskKind(kind) { return typeof kind==="string"&&/^SYNTHETIC_LITERAL_(?:CABLE|SOURCE)_MASK/.test(kind); }
function queryKindNotice(row) {
  if(isCounterhypothesis(row.case?.task||row.task,queryKind(row)))return "Analyst-authored counterhypothesis: the source assertion was deliberately altered, not quoted verbatim. The saved question is unchanged.";
  if(syntheticMaskKind(queryKind(row)))return "Synthetic literal source-span mask, not an observed release redaction. The saved question is unchanged; its input-origin attachment is not evidence.";
  if(analystAlternativeKind(queryKind(row)))return "Analyst-authored alteration of the origin assertion, not verbatim source wording. The saved query is unchanged.";
  return "Synthetic analyst counterhypothesis: analyst-authored, not natural source wording. The saved query is unchanged.";
}
function queryKindBadge(row) {
  const kind=queryKind(row),alternative=analystAlternativeKind(kind),mask=syntheticMaskKind(kind),counter=isCounterhypothesis(row.case?.task||row.task,kind);
  if(!counter&&kind!=="SYNTHETIC_ANALYST_COUNTERHYPOTHESIS"&&!alternative&&!mask)return null;
  const node=badge(counter?"Counterhypothesis":mask?"Synthetic source-span mask":alternative?"Analyst-authored alternative":"Synthetic counterhypothesis","review");node.dataset.testid="synthetic-question-kind";node.dataset.queryKind=kind;
  if(counter){node.dataset.counterhypothesis="true";node.title="Analyst-authored alternative to the source assertion, not verbatim source wording.";}
  else node.title=kind+(mask?" / source-span mask, not an observed release redaction":" / analyst-authored alteration, not verbatim source wording");
  return node;
}
function refreshRailQuestionKind(row){
  const host=$("#case-list"),scroll=host.scrollTop;
  const card=[...host.querySelectorAll("[data-case]")].find(n=>n.dataset.case===row.case.case_id);
  if(!card)return;
  const old=card.querySelector(":scope > [data-testid=synthetic-question-kind]"),chip=queryKindBadge(row);
  if(chip){if(old)old.replaceWith(chip);else card.append(chip);}else old?.remove();
  host.scrollTop=scroll;
}
function primitive(value) { return value===true?"Yes":value===false?"No":value==null||value===""?"Not supplied":typeof value==="number"?fmt(value):typeof value==="object"?"Not supplied":String(value).replaceAll("_"," "); }
const fmt=formatNumber;
function fields(entries) { const dl=el("dl",null,{class:"field-list"});for(const [label,value,literal=false] of entries){dl.append(el("dt",label),el("dd",typeof value==="number"?fmt(value):literal&&value!=null?String(value):primitive(value)));}return dl; }
function link(text,path,className="") { const url=localURL(path);return el("a",text,{href:url.pathname+url.search+url.hash,class:className,target:"_blank",rel:"noopener"}); }
function currentBinding(caseId,corpus){
  const id=caseId||(state.row?.case&&state.row.case.corpus===corpus?state.row.case.case_id:null);
  const row=id?catalogCases().find(value=>value.case.case_id===id):null;
  const metadata=row?.current_resource_metadata??state.report?.current_resource_metadata??(isCurrentPublication()&&row?.current_resource_execution===true?row.resource_binding:undefined);
  const binding=metadata?.by_corpus?metadata.by_corpus[corpus]:metadata;
  if(binding?.corpus&&binding.corpus!==corpus)throw Error("The current source resource belongs to another corpus.");
  return binding;
}
function localURL(path) {
  const url=new URL(path,location.href);if(url.origin!==location.origin||!["http:","https:"].includes(url.protocol))throw Error("Only this local collection server may supply saved data.");
  const id=url.searchParams.get("case_id"),row=id?catalogCases().find(value=>value.case.case_id===id):state.row;
  const binding=currentBinding(id,row?.case?.corpus);
  const caseAPI=/^\/api\/(?:current\/)?(?:condition-v6|flow-v6|source-v6|node-v6|native-v6|guide-v6|guide-view-v6|guide-overlay-v63|guide-overlay-v64|origin-v63|postrun-review|analyst-digest)$/.test(url.pathname);
  if(binding&&id&&caseAPI&&!url.searchParams.has('config')&&ARMS[state.arm])url.searchParams.set('config',ARMS[state.arm].key);
  if(binding&&/^\/api\/(?:current\/)?analyst-digest$/.test(url.pathname)){
    const pinned=new URL(url);pinned.pathname="/api/condition-v6";
    const verified=currentResourceURL(pinned,binding);verified.pathname="/api/current/analyst-digest";return verified;
  }
  return /^\/api\/(?:current\/)?cib-pdf$/.test(url.pathname)?currentPDFURL(url,{binding,caseId:state.row?.case?.case_id,config:ARMS[state.arm]?.key}):currentResourceURL(url,binding);
}
function pinGraphQuery(params){
  const binding=currentBinding(params.get("guide_case"),params.get("corpus"));
  if(binding){const url=currentResourceURL('/api/guide-v6',binding);for(const key of ['resource_id','registry_sha256','index_sha256'])params.set(key,url.searchParams.get(key));}
  return params;
}
async function sha256(bytes) { if(!crypto.subtle)throw Error("This browser cannot verify saved data.");return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function getJSON(path,options={}) { return viewportAnchor.run(()=>readJSON(path,options)); }
async function readJSON(path,{hash,signal,captureHash=false}={}) {
  if(livePacket){
    const url=new URL(path,location.href),params=url.searchParams;
    if(params.has('case_id')&&params.get('case_id')!==state.row.case.case_id)throw Error('The Live source belongs to another run.');
    if(/\/source-v6$/.test(url.pathname)){
      const page=livePacket.sources[params.get('source_id')];
      if(!page)throw Error('This source was not retained by the Live execution.');
      return {page,document_pages:livePacket.document_pages?.[page.document_id]||Object.values(livePacket.sources).filter(p=>p.document_id===page.document_id)};
    }
    throw Error('No matching Live artifact was retained. Saved data is not substituted.');
  }
  const url=localURL(path),response=await fetch(url,{cache:"no-store",signal});
  if(!response.ok){const error=Error(`Saved data is unavailable (${response.status}). No result has been substituted.`);error.status=response.status;throw error;}
  const bytes=await response.arrayBuffer();
  const byteHash=hash||captureHash?await sha256(bytes):null;
  if(hash&&(!/^[a-f0-9]{64}$/i.test(hash)||byteHash!==hash.toLowerCase()))throw Error("Saved data failed its integrity check. No result is shown.");
  let value;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw Error("The server did not return a readable saved record.");}
  if(captureHash&&value&&typeof value==='object')publicationByteHashes.set(value,byteHash);
  return verifyCurrentResourceResponse(url,value);
}
function caseQuery(extra={}) { return new URLSearchParams({case_id:state.row.case.case_id,config:ARMS[state.arm].key,...extra}); }
function graphURL({node_id,source_id,focus_graph_id,focus_hierarchy_id}={}) {
  const c=state.row?.case;
  const params=new URLSearchParams({corpus:c?.corpus||state.filters.corpus||"cib"});
  params.set("return_to",location.pathname+location.search);
  if(node_id)params.set("node",node_id);
  if(source_id)params.set("source_id",source_id);
  if(focus_graph_id)params.set('focus_graph_id',focus_graph_id);
  if(focus_hierarchy_id)params.set('focus_hierarchy_id',focus_hierarchy_id);
  return "graph-full-v6.html?"+pinGraphQuery(params);
}
function updateNavigation() {
  $("#nav-graph").href=fullGraphURL(state.row?.case.corpus||state.filters.corpus||"cib");
  $("#nav-graph").title="Full reference corpus explorer; task evidence boundaries are not inherited.";
  const workbench=new URL(location.href);workbench.searchParams.delete("view");
  $("#nav-home").href="index.html";$("#nav-brand").href="index.html";
  $("#nav-workbench").href=workbench.pathname+workbench.search;
  for(const [selector,active] of [["#nav-home",state.home],["#nav-workbench",!state.home]]){if(active)$(selector).setAttribute("aria-current","page");else $(selector).removeAttribute("aria-current");}
}
function fullGraphURL(corpus) { return "graph-full-v6.html?"+pinGraphQuery(new URLSearchParams({corpus,return_to:location.pathname+location.search})); }
function savePosition({push=false}={}) {
  const url=new URL(location.href);
  if(!state.home)url.searchParams.delete("view");
  if(state.row)url.searchParams.set("case",state.row.case.case_id);else url.searchParams.delete("case");
  url.searchParams.set("arm",state.arm);url.searchParams.set("stage",state.stage);
  if(state.reading)url.searchParams.set("reading",state.reading);else url.searchParams.delete("reading");
  if(state.candidate)url.searchParams.set("candidate",state.candidate);else url.searchParams.delete("candidate");
  if(state.filters.task)url.searchParams.set("task",state.filters.task);else url.searchParams.delete("task");
  if(state.filters.corpus)url.searchParams.set("corpus",state.filters.corpus);else url.searchParams.delete("corpus");
  url.searchParams.delete("show");
  history[push?"pushState":"replaceState"]({},"",url);
  updateNavigation();
  document.querySelectorAll(".workflow-nav a").forEach(a=>{if(a.dataset.stage===state.stage)a.setAttribute("aria-current","step");else a.removeAttribute("aria-current");});
}
function stagePosition(number,{scroll=true,push=true}={}) { if(scroll)viewportAnchor.cancel();state.stage=number;savePosition({push});if(scroll)document.getElementById("stage-"+number)?.scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"}); }
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
  return filterCasebook(state.casebook,state.filters).map(value=>value.row);
}
function renderRail() {
  for(const b of document.querySelectorAll('.filter-buttons [data-corpus]'))b.setAttribute('aria-pressed',String(b.dataset.corpus===state.filters.corpus));
  for(const b of document.querySelectorAll('.filter-buttons [data-task]'))b.setAttribute('aria-pressed',String(casebookTask(b.dataset.task)===casebookTask(state.filters.task)));
  const rows=visibleCases();$("#case-count").textContent=rows.length+" questions";
  const notice=$("#casebook-notice"),special=state.filters.task==='redaction'&&['','cib'].includes(state.filters.corpus);
  const available=state.casebook?.special_redactions.length??0;
  const shortage=special&&state.casebook&&available<5?`${available} of 5 CIB redactions are compatible with this saved viewer. No substitutes.`:'';
  const partial=state.casebook&&state.casebook.selection_scope!=='ready_subset'&&state.casebook.completed_primary_count<9?`${state.casebook.completed_primary_count} of 9 primary examples available.`:'';
  notice.textContent=state.casebookPending||shortage||[partial,state.casebook?.notice].filter(Boolean).join(' ');notice.hidden=!notice.textContent;
  $("#case-list").replaceChildren(...rows.map(row=>{
    const b=button("",()=>chooseCase(row),"case-button",{"aria-current":String(state.row?.case.case_id===row.case.case_id),"data-case":row.case.case_id,"aria-label":`${CORPORA[row.case.corpus]} / ${TASKS[row.case.task]}. ${presentationTitle(row)}`,'aria-describedby':'case-status-'+row.case.case_id});
    const status=railStatus(row);
    b.append(el("small",`${row.case.corpus==='cib'?'CIB':CORPORA[row.case.corpus]} / ${TASKS[row.case.task]}`,{class:"case-kind"}),el("strong",presentationTitle(row),{"data-testid":"case-presentation-title",title:row.case.query}),el("span",status?.badge||"NOT LOADED",{id:'case-status-'+row.case.case_id,class:"case-evidence-status","data-testid":"case-evidence-status","data-tone":status?.tone||"unresolved",'data-status-basis':status?.basis||'not-loaded',title:status?.detail||'This method has not been loaded.'}),el("small",`${row.case.document_id} / ${row.case.date}`));const kind=queryKindBadge(row);if(kind)b.append(kind);
    const source=[...list(state.casebook?.primary),...list(state.casebook?.special_redactions)].find(entry=>entry.case_id===row.case.case_id&&entry.source_label);
    if(source)b.append(el('small',source.source_label,{class:'case-engine-label','data-testid':'case-engine-label'}));
    if(presentationCaveatEntries(row).length){const caveat=badge("Scope caveat","scope-caveat");caveat.dataset.testid="case-scope-caveat";caveat.title="Open this question to read its published scope limit beside the local verdict.";b.append(caveat);}return b;
  }));
  if(!rows.length)$("#case-list").append(note(state.casebookPending?"The curated examples catalog is not available yet. Pinned case links still open their saved records.":"No published questions match these filters.","empty"));
  queueMicrotask(()=>loadRailMetadata(rows,state.arm));
}
function railKey(row,arm=state.arm){return `${state.report?.run_id}/${row.case.case_id}/${ARMS[arm].key}`;}
function railStatus(row,arm=state.arm){
  if(!hasOpenedResult(row))return publishedConditionStatus(row,ARMS[arm].key,state.report.version)||{badge:'SAVED QUESTION',tone:'unresolved',basis:'unopened-saved-task',detail:'Open this saved result to inspect its actual decision.'};
  if(isCurrentPublication()&&!row.configurations?.[ARMS[arm].key])return {badge:'PENDING',tone:'unresolved',basis:'unpublished-method',detail:'This method is not published in the pinned report.'};
  const cached=railDecisionCache.get(railKey(row,arm));if(!cached)return currentReportStatusBadge(row,ARMS[arm].key,verifiedCurrentPublications.has(state.report)?state.report.version:null);
  const reading=state.arm===arm&&state.row?.case.case_id===row.case.case_id?state.reading:"";
  const summary=cached.dto?sidebarDecisionSummary(cached.dto,row.case,ARMS[arm].key,reading):
    cached.record?verdictSummary(cached.record,row.case,reading||preferredReading(cached.record,row.case)):cached.summary;
  return {...summary,basis:cached.dto?'bound-summary':cached.record?'loaded-gate':'unavailable'};
}
function updateRailStatus(row,arm){
  if(state.arm!==arm)return;
  const summary=railStatus(row,arm);if(!summary)return;
  const item=[...$("#case-list").querySelectorAll("[data-case]")].find(n=>n.dataset.case===row.case.case_id),badge=item?.querySelector("[data-testid=case-evidence-status]");
  if(badge){badge.textContent=summary.badge;badge.dataset.tone=summary.tone;badge.dataset.statusBasis=summary.basis||'not-loaded';badge.title=`Method ${arm}: ${summary.detail}`;}
}
function unavailableRail(row,arm){
  railDecisionCache.set(railKey(row,arm),{summary:{badge:"UNAVAILABLE",tone:"unresolved",detail:"A bound decision for this selected method is unavailable."}});
  updateRailStatus(row,arm);
}
async function loadRailMetadata(rows,arm){
  const config=ARMS[arm].key;
  for(const row of rows){
    if(!hasOpenedResult(row))continue;
    const cacheKey=railKey(row,arm),dto=row.decision_summary_by_arm?.[config];
    if(dto===undefined||railDecisionCache.has(cacheKey)||railMetadataChecks.has(cacheKey))continue;
    const pending=(async()=>{
      try{
        sidebarDecisionSummary(dto,row.case,config);
        if(dto.query_sha256!==await textDigest(row.case.query))throw Error("Sidebar query binding changed.");
        const native=row.configurations?.[config];
        if(native?.native_run_id&&dto.native_run_id!==native.native_run_id||native?.native_checksum!=null&&canonicalGateJSON(dto.native_checksum)!==canonicalGateJSON(native.native_checksum))throw Error("Sidebar native binding changed.");
        if(!railDecisionCache.has(cacheKey))railDecisionCache.set(cacheKey,{dto});
        updateRailStatus(row,arm);
      }catch{if(!railDecisionCache.has(cacheKey))unavailableRail(row,arm);}
    })();
    railMetadataChecks.set(cacheKey,pending);
    pending.finally(()=>railMetadataChecks.delete(cacheKey));
  }
}
async function bindCurrentRail(row,arm,record){
  const dto=row.decision_summary_by_arm?.[ARMS[arm].key];
  try{
    if(dto!==undefined){
      const actual=await decisionSummaryFor(record,row.case);
      if(!actual||canonicalGateJSON(dto)!==canonicalGateJSON(actual))throw Error("Sidebar metadata differs from the loaded gate.");
      railDecisionCache.set(railKey(row,arm),{dto});
    }else railDecisionCache.set(railKey(row,arm),{record});
  }catch{unavailableRail(row,arm);}
}
function readingRows() { return list((state.saved?.result?.redaction||state.saved?.result)?.readings); }
function initialDisplayReading(record,caseInfo){
  const rows=list((record?.result?.redaction||record?.result)?.readings),preferred=preferredReading(record||{},caseInfo);
  return rows.find(row=>row.reading?.id===preferred&&list(row.candidates).length)?.reading.id||rows.find(row=>list(row.candidates).length)?.reading?.id||preferred||rows[0]?.reading?.id||'';
}
function currentReading() { const rows=readingRows();return rows.find(r=>r.reading?.id===state.reading)||rows[0]; }
function candidates() { return groupDuplicateFills(currentReading()?.candidates).slice(0,5); }
function flowItems() {
  if(state.row.case.task==="redaction")return candidates();
  if(isNarrativePublication())return list(state.saved?.result?.atoms).map(atom=>({...atom,fill:atom.text||atom.id,atom_id:atom.id}));
  return list(state.saved?.result?.flow_targets||nativeFlow()?.targets).map(target=>({...target,fill:target.fill||target.label||target.atom_id}));
}
function selectedItem() { return flowItems().find(c=>c.id===state.candidate)||flowItems()[0]; }
function nativeFlow() { return state.saved?.result?.flow||state.saved?.flow_v3||state.saved?.result?.flow_v3; }
function contributor(item) { return state.projection?.candidates?.find(c=>c.id===item?.id)||nativeFlow()?.candidate_flows?.[item?.id]||state.saved?.result?.candidate_flows?.[item?.id]; }

async function chooseCase(row,{push=true,reading,candidate,scroll=false}={}) {
  if(livePacket){
    if(row.case.case_id!==livePacket.row.case.case_id)throw Error('A Live run cannot select a saved case.');
    state.reading=reading||state.reading;state.candidate=candidate||state.candidate;
    renderWorkspace();renderRail();savePosition({push});await hydrateFlow(state.epoch);return;
  }
  const epoch=++state.epoch;request?.abort();request=new AbortController();destroyVisuals();state.projection=null;state.trace=null;clearIndependentReview();
  state.home=false;state.row=row;state.saved=null;state.gateReview=null;state.loading=true;state.pending="";state.reference=false;state.originalPath=0;state.reading=reading??"";state.candidate=candidate??"";state.compareReadings=false;state.reviewReading="";
  for(const option of $("#arm-select").options){const available=!isCurrentPublication()||!!row.configurations?.[ARMS[option.value]?.key];option.disabled=!available;option.textContent=ARMS[option.value].name+(available?"":" / not published");}
  clearError();renderRail();renderWorkspace();savePosition({push});
  $("#page-state").textContent=`Loading saved evidence for method ${state.arm}.`;
  const arm=state.arm,key=ARMS[arm].key,cacheKey=state.report.run_id+"/"+row.case.case_id+"/"+key;
  if(isCurrentPublication()&&!row.configurations?.[key]){state.loading=false;state.pending=`${ARMS[arm].name}: this method's saved result is not published yet. No other method is substituted.`;renderWorkspace();$("#page-state").textContent=state.pending;return;}
  try {
    let detail=conditionCache.get(cacheKey);
    if(!detail){
      detail=await getJSON("/api/condition-v6?"+new URLSearchParams({case_id:row.case.case_id,config:key}),{signal:request.signal});
      if(pendingRecord(detail)&&!detail.case){if(epoch!==state.epoch)return;state.pending=publicationNote(detail)||"The selected v6 condition is not published yet.";state.loading=false;renderWorkspace();$("#page-state").textContent=state.pending;return;}
      for(const field of ["case_id","corpus","task","query","date","document_id","focal_marker"])if(detail.case?.[field]!==row.case[field])throw Error("The saved condition belongs to a different question.");
      const saved=detail.configurations?.[key]??detail.configurations?.[arm];
      if(saved){
        if(isNarrativePublication()&&saved.version!=='narrative-condition-projection/1')throw Error('A saved narrative condition must retain its explicit projection version.');
        if(saved.config&&![key,arm].includes(saved.config))throw Error("The saved condition does not match the selected arm.");
        const pin=row.configurations?.[key]?.native_checkpoint||row.configurations?.[arm]?.native_checkpoint;
        if(pin&&(saved.native_checkpoint?.sha256!==pin.sha256||saved.native_checkpoint?.path!==pin.path))throw Error("The saved native-checkpoint binding changed.");
        const nativeRun=row.configurations?.[key]?.native_run_id||row.configurations?.[arm]?.native_run_id||(isCurrentPublication()?row.configurations?.[key]?.run_id:null)||state.report.run_id;
        if(saved.run_id&&nativeRun&&saved.run_id!==nativeRun&&saved.frozen_control!==true)throw Error("The saved execution belongs to another publication run.");
      }
      if(!pendingRecord(detail)&&saved?.result&&!pendingRecord(saved)&&!pendingRecord(saved.result))conditionCache.set(cacheKey,detail);
    }
    if(epoch!==state.epoch)return;
    // The pinned catalogue owns presentation-only references omitted by native details.
    state.row={...row,...detail,reference_answer:detail.reference_answer??row.reference_answer,reference_answer_kind:detail.reference_answer_kind??row.reference_answer_kind,presentation_title:row.presentation_title??detail.presentation_title,selected_demo:row.selected_demo??detail.selected_demo,presentation_selection:row.presentation_selection??detail.presentation_selection,query_kind:row.query_kind??detail.query_kind,decision_summary_by_arm:row.decision_summary_by_arm,presentation_caveats:row.presentation_caveats};state.saved=detail.configurations?.[key]??detail.configurations?.[arm]??null;state.loading=false;
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
      const ordinal=/^reading_(\d+)$/.exec(state.reading);state.reading=(ordinal?rows[Number(ordinal[1])-1]?.reading?.id:null)||initialDisplayReading(state.saved,state.row.case);
    }
    if(!flowItems().some(c=>c.id===state.candidate))state.candidate=flowItems()[0]?.id||"";
    if(state.saved)await bindCurrentRail(state.row,arm,state.saved);
    if(state.saved)await initializeIndependentReview();
    if(epoch!==state.epoch)return;
    renderWorkspace();renderRail();savePosition();
    if(state.saved)updateRailStatus(state.row,arm);
    $("#page-state").textContent=state.saved?`${ARMS[arm].name}. Saved evidence only.`:state.pending;
    if(state.saved)await hydrateFlow(epoch);
    if(scroll&&epoch===state.epoch&&state.stage!=="01")stagePosition(state.stage,{push:false});
  } catch(error){if(epoch===state.epoch&&error.name!=="AbortError"){state.saved=null;state.loading=false;state.pending="Saved results could not be loaded. See the error above, or try again.";unavailableRail(row,arm);showError(error.message);$("#page-state").textContent="Saved condition could not be loaded.";renderWorkspace();}}
}
function changeFilters() {
  renderRail();if(state.home){renderWorkspace();savePosition({push:true});return;}
  if(!state.casebook){savePosition({push:true});return;}
  const rows=visibleCases();
  if(!state.row||!rows.some(r=>r.case.case_id===state.row.case.case_id)){
    if(rows.length)return chooseCase(rows[0]);
    state.epoch++;request?.abort();destroyVisuals();state.projection=null;closeDrawer();state.row=null;state.saved=null;state.loading=false;clearError();renderWorkspace();
  }
  savePosition({push:true});
}
for(const b of document.querySelectorAll('[data-corpus],[data-task]')){
  b.addEventListener('click',()=>viewportAnchor.run(()=>{
    const key=Object.hasOwn(b.dataset,'corpus')?'corpus':'task',value=b.dataset[key];
    if(state.filters[key]===value)return;state.filters[key]=value;return changeFilters();
  }));
  if(b.dataset.corpus){
    b.addEventListener('dblclick',()=>corpusBackground(b.dataset.corpus));
    b.addEventListener('keydown',event=>{
      if(event.shiftKey&&['Enter',' '].includes(event.key)){event.preventDefault();corpusBackground(b.dataset.corpus);}
    });
  }
}
function corpusBackground(corpus){
  const body=box();
  const rows=state.casebook?.primary.filter(row=>row.corpus===corpus)||[];
  if(!rows.length)body.append(note('The source-bound examples catalog is pending. No background is generated.','empty'));
  for(const value of rows){
    const row=value.row,background=state.casebook.backgrounds[corpus]?.find(entry=>entry.case_id===value.case_id),card=el('section',null,{class:'corpus-background-case','data-testid':'corpus-background-case','data-case':value.case_id});
    card.append(heading(TASKS[value.task]),note(caseBackgroundSetup(background)||'Background not attached.'));
    if(background?.citation){const p=background.citation;const inspect=()=>{const source=box(note('Query-origin provenance, not eligible evidence or a new decision.'),fields([['Document',p.document_id,true],['Date',p.date,true]]));if(typeof p.text==='string')source.append(el('blockquote',p.text,{class:'cue'}));openDrawer('Source context',CORPORA[corpus],source,()=>corpusBackground(corpus));};card.append(button('Source context',()=>{if(allowPrivileged(inspect,row))inspect();},'quiet'));}
    card.append(button('Open saved case',()=>chooseCase(row)));body.append(card);
  }
  openDrawer(CORPORA[corpus]+' / three examples','Collection background',body);
}
$("#arm-select").addEventListener("change",()=>viewportAnchor.run(async()=>{state.arm=$("#arm-select").value;state.reading="";state.candidate="";if(state.row)await chooseCase(list(state.report.cases).find(r=>r.case.case_id===state.row.case.case_id));}));

function renderWorkspace() {
  destroyVisuals();
  const host=$("#case-view");host.replaceChildren();host.setAttribute("aria-busy",String(state.loading));
  host.dataset.reading=state.reading;
  $(".workspace-toolbar").hidden=state.home||state.readySingleMethod===true;
  if(state.home){renderHome();return;}
  if(!state.row){host.append(note(state.casebookPending||"Choose a saved question from the catalog.","empty"));return;}
  const c=state.row.case;
  const nav=el("nav",null,{class:"workflow-nav","aria-label":"Pipeline stages"});
  for(const [number,name] of STAGES){const a=el("a",null,{href:"#stage-"+number,"data-stage":number});a.append(el("strong",number,{class:"workflow-step-number"}),el("span",name));if(number===state.stage)a.setAttribute("aria-current","step");a.onclick=e=>{e.preventDefault();stagePosition(number);};nav.append(a);}host.append(nav);
  const workflow=el("div",null,{class:"workflow","data-arm":state.arm});host.append(workflow);
  workflow.append(renderQuestion());
  if(state.loading){workflow.append(el("p",`Loading saved results for arm ${state.arm}. Source verification may take a moment.`,{class:"empty",role:"status","aria-live":"polite","data-testid":"condition-loading"}));return;}
  if(!state.saved){workflow.append(note(state.pending||"No completed result is currently loaded for this selected arm. No archived result is substituted.","empty"));return;}
  if(state.saved.frozen_control===true||state.saved.fallback===true||state.row.fallback===true)workflow.append(note(publicationNote(state.saved)||"Explicit frozen control / fallback record. This is not a new v6 execution.","notice"));
  else if(publicationNote(state.saved))workflow.append(note(publicationNote(state.saved),"notice"));
  workflow.append(renderVerdictStrip(),renderPlan(),renderDiffusion(),renderPathsStage(),renderResultsStage(),renderFindings());
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
    const actions=el("div",null,{class:"actions"});actions.append(link("Open full knowledge graph",fullGraphURL(corpus),"button primary"),el("a","Open saved questions",{href:"workbench-v6.html?"+new URLSearchParams({corpus}),class:"button"}));card.append(actions);cards.append(card);
  }
  host.append(cards);renderReserveCatalogue(host);$("#page-state").textContent="Corpus home / published sources and saved questions only.";updateNavigation();
}

function renderReserveCatalogue(host) {
  if(state.catalog)return;
  const proposals=list(state.report.reserve_proposals);if(!proposals.length)return;
  const {corpus,task}=state.filters,rows=proposals.filter(p=>(!corpus||p.corpus===corpus)&&(!task||p.task===task));
  const section=el("section",null,{class:"reserve-catalogue","data-testid":"reserve-catalogue"});
  section.append(heading("Reserve source catalogue"),note("Source/legacy proposals, not completed current executions.","notice"),note(`${rows.length} of ${proposals.length} proposals match the collection/task filters. Separate from the evaluated bench; fixed/legacy labels are not current-execution verdicts.`));
  if(rows.length)section.append(compactEvidence(rows,{label:"source/legacy proposals",render:proposal=>{
    const card=el("article",null,{class:"assembly-card reserve-proposal","data-testid":"reserve-proposal","data-proposal-id":proposal.id});
    card.append(el("p",`${CORPORA[proposal.corpus]||"Collection not supplied"} / ${TASKS[proposal.task]||"Task not supplied"}`,{class:"eyebrow"}),el("h3",short(proposal.query||proposal.name||"Source/legacy proposal",18)));
    const synthetic=queryKindBadge({task:proposal.task,query_kind:proposal.kind});if(synthetic)card.append(synthetic);
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
  const c=state.row.case,s=stage("01",title(state.row),TASKS[c.task]);
  s.outer.querySelector(".stage-card > header h2").replaceWith(el("h1",title(state.row),{class:"question-title"}));
  const companions=studyCompanionCases(state.row,catalogCases());
  if(companions.length){
    const tabs=el('nav',null,{class:'study-case-tabs','aria-label':'Focal gap','data-testid':'study-case-tabs'});
    for(const row of companions)tabs.append(el('a',row.study_slot==='first'?'First gap':'Last gap',{
      href:'workbench-v6.html?'+new URLSearchParams({case:row.case.case_id,arm:state.arm,corpus:row.case.corpus}),
      'aria-current':row.case.case_id===c.case_id?'page':null,'data-study-slot':row.study_slot}));
    s.body.append(tabs);
  }
  const query=el("div",null,{class:"query-block","data-testid":"query-text","data-task":c.task}),at=c.focal_marker?c.query.indexOf(c.focal_marker):-1;
  const attachment=currentOriginAttachment(c),context=originContext(c),sourceReference=attachment.refs?.masked!=null;
  const key=c.task==="redaction"?(sourceReference?originFocalReferences.get(context.key):state.row.reference_answer):null;
  const canReveal=c.task==="redaction"&&(key!=null||sourceReference&&attachment.refs?.revealed!=null);
  const awaitingReference=canReveal&&state.reference&&key==null;
  const queryDisplay=readable(c.query);
  if(at>=0){query.append(document.createTextNode(queryDisplay.slice(0,at)),button(state.reference&&key!=null?readable(String(key)):c.focal_marker,toggleReference,"focal-mask",{"aria-pressed":state.reference,"aria-busy":awaitingReference,"data-testid":"focal-mask","data-reference-ready":key!=null,...(!canReveal?{disabled:""}:{})}),document.createTextNode(queryDisplay.slice(at+c.focal_marker.length)));}
  else query.textContent=queryDisplay;
  const questionKind=queryKindBadge(state.row);if(questionKind)s.body.append(questionKind);s.body.append(query);
  if(awaitingReference)s.body.append(el("p","Loading the verified reference. Click the redaction again to keep it hidden.",{class:"note",role:"status","aria-live":"polite","data-testid":"reference-loading"}));
  const actions=el("div",null,{class:"actions"});
  actions.append(button("Origin",async()=>{
    if(livePacket){openDrawer('Analyst input','Live query provenance',box(note(c.query,'cue'),fields([['As of',c.date],['Excluded origin',c.document_id,true]]),note('Entered in the Live form. No historical origin transcription or hidden answer was supplied.')));return;}
    if(!allowPrivileged(()=>$('#stage-01 [data-testid=origin-open]')?.click()))return;
    if(attachment.missing){openDrawer("Origin not attached","Question provenance",box(note("No verified origin attachment is published. No source is substituted."),note(c.query)));return;}
    openDrawer("Origin","Question provenance / excluded from evidence",note("Verifying the saved origin..."));
    const epoch=state.drawerEpoch;
    try{const data=await auditedOrigin(c,state.reference,context);if(epoch===state.drawerEpoch&&$("#detail-drawer").open)originDrawer(data);}catch(error){if(epoch===state.drawerEpoch)$("#detail-body").replaceChildren(note(error.message,"error-card"));}
  },"",{"data-testid":"origin-open"}));
  s.outer.querySelector('.stage-card > header').append(actions);
  if(state.reference&&key!=null){const ref=el("p","Post-run reference only; the saved question is unchanged.",{class:"reference-box","data-testid":"reference-key"});s.body.append(ref);}
  const kind=state.row.reference_answer_kind;
  const kindNote=note(questionKind?queryKindNotice(state.row):kind==="synthetic_source_span"?"Synthetic source-span mask, not an observed release redaction.":kind==="paired_earlier_redacted_later_revealed"?"Paired-release redaction. The later reference is not eligible evidence.":"Source-derived complete question; its presence is not proof of its truth.");kindNote.dataset.testid="query-kind-note";
  const provenance=el("section",null,{class:"origin-panel","data-testid":"origin-panel",hidden:""});
  provenance.append(heading("Where this query came from"),note(attachment.missing?"Original-source transcription is not attached in this temporary preview. The saved question and eligible evidence remain inspectable.":"Loading the audited source proof. This privileged origin is not evidence for the result."));
  s.body.append(provenance);
  if(sourceReference&&attachment.refs?.revealed!=null)void prepareFocalReference({...c},context);
  const reveal=state.reference;
  if(!livePacket&&!attachment.missing&&(!isNarrativePublication()||state.reference))queueMicrotask(()=>loadOrigin(provenance,{...c},reveal,context));return s.outer;
}
function syncFocalReference(c,context){
  if(state.row?.case.case_id!==c.case_id||context&&originContext(c)?.key!==context.key)return;
  const mask=$('#stage-01 [data-testid=focal-mask]');if(!mask)return;
  const reference=context?originFocalReferences.get(context.key):state.row.reference_answer;
  mask.dataset.referenceReady=String(reference!=null);
  mask.setAttribute('aria-pressed',String(state.reference));
  mask.setAttribute('aria-busy',String(state.reference&&reference==null));
  mask.textContent=state.reference&&reference!=null?readable(String(reference)):c.focal_marker;
  if(reference!=null){
    $('#stage-01 [data-testid=reference-loading]')?.remove();
    if(state.reference&&!$('#stage-01 [data-testid=reference-key]'))
      $('#stage-01 .stage-body').append(el('p','Post-run reference only; the saved question is unchanged.',{class:'reference-box','data-testid':'reference-key'}));
  }
}
async function prepareFocalReference(c,context){
  if(!context||originFocalReferences.has(context.key)){syncFocalReference(c,context);return;}
  if(!referenceRequests.has(context.key))referenceRequests.set(context.key,(async()=>{
    const [masked,revealed]=await Promise.all([auditedOrigin(c,false,context),auditedOrigin(c,true,context)]);
    originFocalReferences.set(context.key,focalReferenceFromOrigin(c,masked,revealed));
  })());
  const pending=referenceRequests.get(context.key);
  try{await pending;syncFocalReference(c,context);}
  catch(error){
    if(state.row?.case.case_id===c.case_id&&state.reference){
      const status=$('#stage-01 [data-testid=reference-loading]');
      if(status)status.textContent='Reference unavailable: '+error.message;
      $('#stage-01 [data-testid=focal-mask]')?.setAttribute('aria-busy','false');
    }
  }finally{if(referenceRequests.get(context.key)===pending)referenceRequests.delete(context.key);}
}
function toggleReference(){
  if(!state.reference&&!allowPrivileged(toggleReference))return;
  state.reference=!state.reference;
  const previous=state.independentReview,prepared=previous?.prepared;
  clearIndependentReview();
  if(prepared)state.independentReview={status:'masked',prepared,record:state.saved};
  else if(previous)state.independentReview={status:previous.status,record:state.saved};
  $("#stage-01").replaceWith(renderQuestion());refreshIndependentReview();
  if(state.reference)void loadIndependentReview();
}

function allowPrivileged(action,row=state.row){
  return true;
}
function currentRedactionReview(){return !isNarrativePublication()&&state.row?.case?.task==='redaction'&&state.saved?.current_resource_execution===true;}
function clearIndependentReview(){
  reviewRequest?.abort();reviewRequest=null;state.reviewEpoch++;state.independentReview=null;
  closeDrawer();$("#detail-body").replaceChildren();$("#detail-back").onclick=null;
}
async function initializeIndependentReview(){
  if(!currentRedactionReview())return;
  const record=state.saved,epoch=state.epoch;
  try{
    const summary=catalogCases().find(row=>row.case.case_id===state.row.case.case_id)?.configurations?.[record.config];
    const prepared=await preparePostrunReview(record,state.row.case,summary);
    if(epoch===state.epoch&&record===state.saved)state.independentReview={status:prepared?'masked':'pending',prepared,record};
  }catch{
    if(epoch===state.epoch&&record===state.saved)state.independentReview={status:'unavailable',record};
  }
}
function refreshIndependentReview(){
  if($("#result-body"))renderResultBody();
  if($("#stage-06"))$("#stage-06").replaceWith(renderFindings());
}
async function loadIndependentReview(){
  const review=state.independentReview;
  if(!state.reference||!currentRedactionReview()||!review?.prepared)return;
  // Display a source-verified fill before requesting its potentially large grading packet.
  if(currentOriginAttachment(state.row.case).refs?.masked&&!originFocalReferences.has(originContext(state.row.case).key))return;
  const epoch=++state.reviewEpoch,record=state.saved,reading=state.reading;
  reviewRequest?.abort();reviewRequest=new AbortController();review.status='loading';refreshIndependentReview();
  try{
    const value=await getJSON('/api/current/postrun-review?'+caseQuery({reveal:'1'}),{signal:reviewRequest.signal});
    const verified=await verifyPostrunReview(value,review.prepared);
    if(epoch!==state.reviewEpoch||!state.reference||record!==state.saved||reading!==state.reading||review!==state.independentReview)return;
    review.status='verified';review.verified=verified;review.reading=reading;refreshIndependentReview();
  }catch(error){
    if(epoch!==state.reviewEpoch||!state.reference||record!==state.saved||reading!==state.reading||review!==state.independentReview)return;
    if(error.name!=='AbortError'){review.status='unavailable';delete review.verified;refreshIndependentReview();}
  }
}
function independentItem(candidate){
  const review=state.independentReview;
  if(!state.reference||review?.status!=='verified'||review.record!==state.saved||review.reading!==state.reading||
      review.verified?.key!==review.prepared?.key)return null;
  return review.verified.items.find(item=>item.reading_id===state.reading&&item.candidate_id===candidate.id)||null;
}
function independentGrade(item,{citations=false}={}){
  const body=el('div',null,{'data-testid':'independent-review-grade'}),grade=item.grade;
  const formatted=llmReview({assessment:grade},'redaction');
  body.append(fields([['Answer match / reference-aware',formatted.correctness],['Source-evidence opinion',formatted.evidence],
    ['Insertion-grammar opinion',grade.grammatical===true?'Grammatical':grade.grammatical===false?'Not grammatical':'Not assessed']]),note(grade.explanation));
  if(citations)for(const id of grade.cited_source_ids){
    body.append(el('h4','Reviewer citation '+id),sourceButton(item.sources[Number(id.slice(1))-1]));
  }
  return body;
}
function independentCandidateReview(candidate,{expanded=false}={}){
  const item=independentItem(candidate);if(!item)return null;
  const body=el(expanded?'section':'details',null,{class:expanded?'grade-panel':'grade-line','data-testid':expanded?'independent-review-detail':'candidate-grade'});
  body.append(expanded?heading('Independent insertion review'):el('summary','Independent insertion review / not the local verdict'),
    note('Answer-aware model opinion, not a support upgrade, decision-calibration judgment or independent historical validation.'),independentGrade(item,{citations:expanded}));return body;
}
function independentReviewPanel(){
  const review=state.independentReview,status=review?.status||'pending';
  const panel=el('section',null,{class:'grade-panel','data-testid':'independent-postrun-review','data-review-panel':'postrun','data-review-status':status});
  panel.append(heading('Independent insertion review'));
  if(status!=='verified'||!state.reference){
    const text=status==='unavailable'?'The independent review is unavailable or does not match this saved output. No grades are substituted.':
      status==='loading'?'Loading the saved independent review.':status==='masked'?'Unmask the reference to view this saved answer-aware review.':
      `Independent insertion review is not published for ${ARMS[state.arm].name}.`;
    const message=note(text+' The local evidence decision is unchanged.');if(status==='pending')message.dataset.testid='postrun-review-pending';
    panel.append(message);return panel;
  }
  panel.append(badge('Verified attachment','review'),note('Model opinions about the supplied insertion, reference and source quotations. The native assertion status was not supplied; this is not a calibration judgment or independent historical verification.','notice'));
  for(const candidate of candidates()){
    const item=independentItem(candidate);if(!item)continue;
    const row=el('details',null,{class:'review-row','data-testid':'independent-review-item','data-proposal-id':candidate.id});
    row.append(el('summary',`${item.rank} / ${item.fill} / independent review`),independentGrade(item,{citations:true}));panel.append(row);
  }
  const binding=el('details',null,{class:'method-audit'});binding.append(el('summary','Review attachment details'),
    fields([['Native execution',review.prepared.meta.binding.native_run_id,true],['Native checksum',review.prepared.meta.binding.native_checksum,true],
      ['Projection SHA-256',review.prepared.reference.sha256,true],['Assessment SHA-256',review.prepared.meta.review_sha256,true],['Review protocol',review.prepared.meta.protocol_version,true]]),
    note('The backend replays pinned receipts, the native checkpoint and source quotations. This display checks their published native, candidate and source bindings; it does not change local decisions or ranks.'));
  panel.append(binding);return panel;
}

function highlightedText(text,anchors,attrs={}) {
  const host=el("div",null,{class:"source-document",...attrs}),chars=Array.from(text),display=Array.from(readable(text));let cursor=0;
  host.dataset.originalText=text;
  for(const a of [...anchors].sort((a,b)=>a.start-b.start)){
    if(!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<cursor||a.end<=a.start||a.end>chars.length||chars.slice(a.start,a.end).join("")!==a.text)throw Error("The exact source quotation does not replay.");
    const mark=el("mark",display.slice(a.start,a.end).join(""));mark.dataset.originalText=a.text;
    host.append(document.createTextNode(display.slice(cursor,a.start).join("")),mark);cursor=a.end;
  }
  host.append(document.createTextNode(display.slice(cursor).join("")));return host;
}
function originalCaseControl(body) {
  if(!['iran','vietnam'].includes(state.row.case.corpus))return null;
  const label=el('label',null,{class:'original-case-control'}),input=el('input',null,{type:'checkbox'});
  label.append(input,document.createTextNode('Original capitalization'));
  input.onchange=()=>{
    for(const source of body.querySelectorAll('.source-document[data-original-text]')){
      const original=source.dataset.originalText,chars=Array.from(input.checked?original:readable(original));let cursor=0;
      for(const child of source.childNodes){
        const size=Array.from(child.nodeType===Node.TEXT_NODE?child.textContent:child.dataset.originalText||child.textContent).length;
        child.textContent=chars.slice(cursor,cursor+size).join('');cursor+=size;
      }
    }
  };
  return label;
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
function originContext(c){
  if(!isCurrentPublication())return null;
  const config=ARMS[state.arm].key,summary=catalogCases().find(row=>row.case.case_id===c.case_id)?.configurations?.[config];
  return {config,summary,key:canonicalGateJSON([c.case_id,config,summary?.run_id,summary?.native_checksum,summary?.native_checkpoint,currentBinding(c.case_id,c.corpus)])};
}
function currentOriginAttachment(c){
  if(!isCurrentPublication())return {missing:false};
  const row=catalogCases().find(value=>value.case.case_id===c.case_id),config=ARMS[state.arm].key;
  const declared=row?.current_resource_execution===true&&(Object.hasOwn(row,'origin_refs')||row.configurations?.[config]?.native_checkpoint!=null);
  const bundle=row?.origin_refs,refs=bundle&&Object.hasOwn(bundle,'by_arm')?bundle.by_arm?.[config]:bundle;
  return {refs,missing:declared&&refs?.masked==null};
}
async function auditedOrigin(c,reveal,context){
  const key=(context?.key||c.case_id)+"/"+(reveal?"1":"0");
  if(context&&!context.summary)throw Error('The selected method has no published original-source binding. No other method is substituted.');
  if(originCache.has(key))return originCache.get(key);
  let pending=originRequests.get(key);
  if(!pending){
    pending=(async()=>{
      const data=await getJSON("/api/origin-v63?"+new URLSearchParams({case_id:c.case_id,reveal_focal:reveal?"1":"0",...(context?{config:context.config}:{})}));
      if(data.case_id!==c.case_id||data.query!==c.query||data.document_id!==c.document_id||data.date!==c.date||data.eligible_evidence!==false||data.focal_revealed!==(c.task==="redaction"&&reveal)||await textDigest(data.text)!==data.text_sha256||await textDigest(c.query)!==data.query_sha256)throw Error("Origin provenance does not match the saved query or text binding.");
      if(data.full_transcription&&await textDigest(data.full_transcription.text)!==data.full_transcription.text_sha256)throw Error("Full original transcription failed its body hash check.");
      if(isNarrativePublication()&&data.full_transcription){
        const full=data.full_transcription,mapping=full.display_segment_mapping;
        if(mapping){
          if(reveal||c.task!=='redaction'||mapping.marker!==c.focal_marker)throw Error('Unsupported masked origin mapping.');
          const original=await auditedOrigin(c,true,context),raw=original.full_transcription;
          if(!raw||raw.display_segment_mapping||canonicalGateJSON(raw.segments)!==canonicalGateJSON(full.segments)||canonicalGateJSON(raw.separator_spans)!==canonicalGateJSON(full.separator_spans)||raw.segment_separator_contract!==full.segment_separator_contract||canonicalGateJSON(original.source_proof_ref)!==canonicalGateJSON(data.source_proof_ref)||await sha256(new TextEncoder().encode(raw.text))!==mapping.source_text_utf8_sha256||await sha256(new TextEncoder().encode(full.text))!==mapping.display_text_utf8_sha256)throw Error('The masked origin does not replay its original text binding.');
          const chars=Array.from(raw.text),a=mapping.source_focal_start,b=mapping.source_focal_end;
          if(chars.length!==mapping.source_length||list(original.anchors).filter(anchor=>anchor.start===a&&anchor.end===b&&chars.slice(a,b).join('')===anchor.text).length!==1||chars.slice(0,a).join('')+mapping.marker+chars.slice(b).join('')!==full.text)throw Error('The masked origin changes more than its exact focal span.');
        }
        const chars=Array.from(full.text);
        for(const segment of narrativeUI.originTranscriptSegments(full)){
          const text=chars.slice(segment.start,segment.end).join(''),actual=Number.isInteger(segment.raw_start)||segment.text_hash_encoding==='utf8'?await sha256(new TextEncoder().encode(text)):await textDigest(text);
          if(segment.text_sha256!=null&&actual!==segment.text_sha256)throw Error('An original source segment failed its exact text hash.');
        }
      }
      originCache.set(key,data);return data;
    })();
    originRequests.set(key,pending);
  }
  try{return await pending;}finally{if(originRequests.get(key)===pending)originRequests.delete(key);}
}
async function loadOrigin(host,c,reveal,context) {
  try{
    const data=await auditedOrigin(c,reveal,context);
    const reference=reveal&&c.task==='redaction'&&currentOriginAttachment(c).refs?.masked!=null?focalReferenceFromOrigin(c,await auditedOrigin(c,false,context),data):null;
    if(!host.isConnected||state.row.case.case_id!==c.case_id||state.reference!==reveal||context?.config&&context.config!==ARMS[state.arm].key)return;
    if(reference!=null){
      originFocalReferences.set(context.key,reference);
      syncFocalReference(c,context);
    }
    if(data.query_kind)originKinds.set(c.case_id,data.query_kind);
    const kindBadge=queryKindBadge(state.row);
    refreshRailQuestionKind(state.row);
    if(kindBadge){
      const body=host.closest(".stage-body"),previous=body.querySelector(":scope > [data-testid=synthetic-question-kind]");
      if(previous)previous.replaceWith(kindBadge);else body.insertBefore(kindBadge,body.querySelector("[data-testid=query-text]"));
      const kindNote=body.querySelector("[data-testid=query-kind-note]");if(kindNote)kindNote.textContent=queryKindNotice(state.row);
    }
    const category=({CIB_SHARED_VISIBLE_TEXT:"Shared-visible / not a secret reveal",CIB_VERIFIED_REVEAL:"Verified CIB reveal",SECRET_CABLE_RAW_BODY_VERIFIED:"Audited SECRET cable",CABLE_CLASSIFICATION_IN_SEALED_PROOF:"Recorded SECRET source / segment",CIB_UNIT_UNVERIFIED:"CIB unit unverified",CIB_MIXED_OR_UNVERIFIED_UNITS:"CIB origin not fully certified"})[data.source_category]||"Source category not supplied";
    const summary=el("div",null,{class:"origin-summary"});summary.append(badge(category,"review"),el("span",data.derivation));
    const body=box(heading("Query origin"),summary,note("Provenance only, not eligible evidence. The executed question above is unchanged."));
    if(data.warning&&data.source_category?.startsWith("CIB_"))body.append(note(data.warning,"origin-category-warning"));
    const birthAnchors=exactOriginAnchors({...data,full_transcription:null});
    if(birthAnchors.length){
      const excerpt=highlightedText(data.text,birthAnchors,{"data-testid":"origin-paragraph"});
      const details=el("details",null,{class:"origin-paragraph-expand"});details.append(el("summary","Original source paragraph / exact anchor"),excerpt);
      body.append(details);
    }else body.append(note("Precise birth-of-question quotations are not supplied. The audited transcript is available below; a whole-page highlight or a match to a rewritten hypothesis is not invented.","origin-category-warning"));
    const actions=el("div",null,{class:"actions"});actions.append(button(data.full_transcription?"Open full original cable transcription":"Open audited origin page / segment",()=>originDrawer(data),"",{"data-testid":"origin-transcription"}));
    if(data.pdf)actions.append(originPDF(data));
    if(c.task==="redaction")actions.append(button(reveal?"Hide focal origin reference":"Explicitly reveal focal origin reference",toggleReference,"",{"data-testid":"origin-reveal"}));
    const audit=el("details",null,{class:"origin-audit-details"});audit.append(el("summary","Provenance details / source verification"),fields([["Origin",`${data.document_id} / ${data.date}`,true],["Recorded classification / not proof of reveal",data.classification],["Verified source category",data.source_category,true],["Canonical unit / raw-body audit verified",data.unit_verified],["Secret-derived query certified by this source audit",data.secret_derived],["Recorded construction",data.query_kind,true]]),note(data.source_review||"Source mapping is not independent historical validation."),note(data.scope),note("Source proof SHA-256: "+data.proof_sha256,"proof-hash"));
    const mapping=originMappingDetails(data);if(mapping)audit.append(mapping);
    if(data.warning&&!data.source_category?.startsWith("CIB_"))audit.append(note(data.warning));
    body.append(actions,audit);host.replaceChildren(body);
  }catch(error){if(host.isConnected){
    host.replaceChildren(heading("Origin provenance unavailable"),note(error.message+" No evidence API or arbitrary private file is used as a fallback.","error-card"));
    const stage=host.closest('#stage-01');stage?.querySelector('[data-testid=focal-mask]')?.setAttribute('aria-busy','false');
    const status=stage?.querySelector('[data-testid=reference-loading]');if(status)status.textContent="The verified reference could not be loaded. Hide and reveal the redaction to retry.";
  }}
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
  const body=box(note(data.notice,"notice"),fields([["Document",data.document_id,true],["Source",data.source_id,true],["Recorded classification",data.classification],["Source category",data.source_category,true],["Display scope",transcription.scope]]),note("Original transcript hashes and exact recorded offsets verified. This input-origin attachment is provenance, not evidence or independent historical confirmation.","verified"));
  if(data.warning)body.append(note(data.warning,"origin-category-warning"));
  const scope=el('details');scope.append(el('summary','Question scope and saved inventory'),fields([['Collection',CORPORA[state.row.case.corpus]],['Task',TASKS[state.row.case.task]],['Published case inventory',`${catalogCases().length} cases`,true]]),note(queryKindNotice(state.row)||'Original query provenance; not eligible result evidence.'),note(GRAPH_SCOPE),note(sourceScopeText()));if(state.saved)scope.append(button('Saved prompts',promptDrawer));
  const caseControl=originalCaseControl(body);if(caseControl)scope.append(caseControl);body.append(scope);
  if(data.pdf)body.append(originPDF(data));
  const mapping=originMappingDetails(data);if(mapping)body.append(mapping);
  const anchors=exactOriginAnchors(data);
  if(!anchors.length)body.append(note("No precise birth-quote spans were recorded. This document is not highlighted as if its whole text were the query.","notice"));
  const segments=isNarrativePublication()?narrativeUI.originTranscriptSegments(transcription):list(transcription.segments);
  body.append(transcriptDocument(transcription.text,anchors,segments,{testid:"origin-document",sourceId:data.source_id,documentId:data.document_id,separators:isNarrativePublication()?list(transcription.display_segment_mapping?.separator_spans||transcription.separator_spans):[]}));
  openDrawer("Original document","Question provenance / excluded from evidence",body);
  scrollToSource();
}
function transcriptDocument(text,anchors,segments,{testid,sourceId,documentId,separators=[]}={}){
  const chars=Array.from(text),host=el("div",null,{class:"document-transcript","data-testid":testid});
  const rows=segments.length?segments:[{start:0,end:chars.length,source_id:sourceId}];let end=0;
  for(const [i,segment] of rows.entries()){
    const join=segment.start===end||separators.some(gap=>gap.raw_start===end&&gap.raw_end===segment.start&&chars.slice(end,segment.start).join('')===gap.text);
    if(!Number.isInteger(segment.start)||!Number.isInteger(segment.end)||!join||segment.end<segment.start||segment.end>chars.length)throw Error("Document segment boundaries do not replay.");
    end=segment.end;
    const physical=Number.isInteger(segment.physical_page)&&segment.physical_page>0;
    const section=el("section",null,{class:"transcript-segment","data-source-id":segment.source_id||sourceId||""}),boundary=el("h3",`${physical?"Page "+segment.physical_page:"Logical segment "+(i+1)} / ${documentId||"Source document"}`,{class:"transcript-boundary","data-testid":"transcript-boundary","data-boundary-kind":physical?"physical-page":"logical-segment"});
    section.append(boundary);
    const clipped=anchors.filter(a=>a.start<segment.end&&a.end>segment.start).map(a=>{const start=Math.max(a.start,segment.start),stop=Math.min(a.end,segment.end);return {start:start-segment.start,end:stop-segment.start,text:chars.slice(start,stop).join("")};});
    section.append(highlightedText(chars.slice(segment.start,segment.end).join(""),clipped,{class:"source-document transcript-text","data-testid":"transcript-text"}));host.append(section);
  }
  if(end!==chars.length)throw Error("Document segment inventory omits source text.");
  return host;
}
function scrollToSource(){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const drawer=$("#detail-drawer");if(!drawer.open)return;
    const source=drawer.querySelector(".document-transcript mark,[data-testid=source-document] mark")||drawer.querySelector("[data-source-selected=true] .transcript-boundary")||drawer.querySelector(".transcript-boundary");
    source?.scrollIntoView({block:"start",behavior:"instant"});
  }));
}

function inspectRow(id,text,meta,fn,attrs={}) { const b=button("",fn,"inspect-row",attrs);b.append(el("span",id,{class:"row-id"}),el("span",text,{class:"row-copy"}));if(meta)b.append(el("span",meta,{class:"row-meta"}));return b; }
function readingText(r) { return readingExplanation(r,{local:state.arm==='C'}); }
function readingControl(testid) {
  const panel=el("section",null,{class:"reading-master","data-testid":"reading-master",id:"reading-thoughts",hidden:"",tabindex:"-1"});
  panel.append(heading(state.arm==='B'?"Source-phrase branches":"What could fit here?"),note(state.arm==='B'?"Mechanical branches, not model interpretations.":"Grammatical possibilities, not answers. One selection carries through every later stage."));
  for(const row of readingRows()){
    const r=list(state.saved.plan?.slot_readings).find(r=>r.id===row.reading.id)||row.reading;
    const b=button("",async()=>{state.reading=row.reading.id;state.candidate="";await changeReading();const chooser=$("#reading-thoughts");if(chooser){chooser.hidden=false;$("[data-testid=reading-choice][aria-pressed=true]")?.focus({preventScroll:true});}},"reading-thought",{"data-testid":"reading-choice","data-reading-id":row.reading.id,"aria-pressed":state.reading===row.reading.id});
    b.append(el("span",isNarrativePublication()?readingLabel(r,readingRows().indexOf(row)+1):`${row.reading.id} / ${primitive(r.form)}`,{class:"eyebrow"}),el("p",state.arm==='B'?(r.explanation||r.notes||"Saved source-phrase branch; no grammatical reading was authored."):readingText(r)));
    panel.append(b);
  }
  panel.append(button("Reading details",()=>{const r=list(state.saved.plan?.slot_readings).find(r=>r.id===state.reading)||currentReading()?.reading;if(r)readingDetail(r);},"quiet"));return panel;
}
function readingDetail(r) {
  const body=box(note(readingText(r)),note(`${ARMS[state.arm].origin}. This is an interpretation of visible query text, not an answer or a support verdict.`,"notice"),fields([["Form",r.form],["Role",r.role],["Referent kind",r.target_kind||r.referent_kind],["Number",r.grammatical_number],["Finite clause",r.finite]]));
  for(const [label,text] of [["Left boundary",r.left_quote],["Right boundary",r.right_quote],["Attachment cue",r.attachment_quote],["Kind cue",r.kind_cue_quote]])if(text)body.append(heading(label),el("blockquote",text,{class:"cue"}));
  if(r.notes){const provenance=el('details');provenance.append(el('summary','Technical provenance'),el('pre',r.notes,{class:'raw-record'}));body.append(provenance);}
  openDrawer("Reading "+r.id,ARMS[state.arm].name,body);
}
function openReadingThoughts(){
  const panel=$("#reading-thoughts");if(!panel)return;
  panel.hidden=!panel.hidden;
  $("[data-testid=atom-focal-mask]")?.setAttribute("aria-expanded",String(!panel.hidden));
  if(!panel.hidden)panel.focus({preventScroll:true});
}
function renderPlan(){
  const s=stage("02","Facts to look for",ARMS[state.arm].name),plan=state.saved.plan||{},cards=el("div",null,{class:"fact-cards"});
  const failure=failureReceipt();if(failure)s.body.append(failure);
  for(const [index,atom] of list(plan.atoms).entries()){
    const text=atom.text||atom.source_quote||atom.id,marker=state.row.case.focal_marker,at=marker?text.indexOf(marker):-1;
    const focal=at>=0,card=el("article",null,{class:"fact-card"+(focal?" is-focal":""),"data-testid":"plan-atom","data-atom-id":atom.id});
    card.append(el("span",'F'+(index+1),{class:"eyebrow",title:atom.id}));
    const copy=el("p");
    const display=readable(text);
    if(focal){copy.append(document.createTextNode(display.slice(0,at)),button(marker,openReadingThoughts,"atom-mask",{"data-testid":"atom-focal-mask","aria-expanded":"false","aria-controls":"reading-thoughts",disabled:readingRows().length?null:""}),document.createTextNode(display.slice(at+marker.length)));}
    else copy.textContent=display;
    card.append(copy,button("i",()=>atomDetail(atom),"fact-inspect",{"aria-label":"Inspect fact "+atom.id,title:"Inspect fact "+atom.id}));cards.append(card);
  }
  s.body.append(note("Query assertions, not established facts."),cards);
  if(!list(plan.atoms).length)s.body.append(note("No saved atoms published.","empty"));
  if(readingRows().length){
    const r=list(plan.slot_readings).find(r=>r.id===state.reading)||currentReading()?.reading;
    const summary=button("",openReadingThoughts,"active-reading-thought",{"data-testid":"plan-reading-select","aria-controls":"reading-thoughts"});
    summary.append(el("small",`Active ${state.arm==='B'?"branch":"reading"}`),el("span",state.arm==='B'?"Inspect the saved source-phrase branch":readingText(r)));
    s.body.append(summary,readingControl("plan-reading-select"));
  }
  const details=button("Search questions and plan",()=>{const audit=renderPlanAudit();openDrawer("Saved search plan",ARMS[state.arm].origin,audit.querySelector(".stage-body"));},"quiet");s.body.append(details);return s.outer;
}
function usedProofs(item){return decisionProofs(item,newDecision(item));}
function quoteCard(proof){
  const refs=proof.digest_ids?.join(', ')||(/^S\d+$/.test(proof.id||'')?proof.id:'');
  const b=el('article',null,{class:'exact-quote'}),bar=el('header',null,{class:'quote-toolbar'});
  bar.append(el("small",[refs,...list(proof.atom_ids)].filter(Boolean).join(' / ')||'Selected evidence'));
  const matchingPaths=list(state.trace?.paths).filter(path=>
    (!proof.atom_ids?.length||proof.atom_ids.includes(path.query_atom_id)||proof.atom_ids.includes(path.candidate_or_atom_id))&&
    list(path.decision_source_refs?.length?path.decision_source_refs:path.source_refs).some(p=>typeof p==='object'&&p.canonical_page_id===proof.canonical_page_id&&p.page_sha256===proof.page_sha256&&p.start===proof.start&&p.end===proof.end&&p.text===proof.text));
  const path=matchingPaths.find(path=>path.graph_hops>0)||matchingPaths[0];
  if(path){
    const index=state.trace.paths.filter(p=>p.candidate_or_atom_id===path.candidate_or_atom_id).findIndex(p=>p.id===path.id);
    bar.append(button('View on KG',()=>guidePath({candidate:{id:path.candidate_or_atom_id},route:path,route_index:index,proof}),'quote-kg',{'data-testid':'quote-view-on-kg'}));
    b.dataset.tone=/^(FOR|SUPPORT|SUPPORTED)$/.test(path.direction)?'support':/^(AGAINST|OPPOSE|OPPOSED|COUNTER|COUNTEREVIDENCE)$/.test(path.direction)?'oppose':'context';
  }
  const text=button('',()=>sourceDrawer(proof),'excerpt-text',{"data-testid":"used-source-quote","data-source-id":proof.canonical_page_id,"data-document-id":proof.document_id,"data-digest-ids":proof.digest_ids?.join(' '),'aria-label':'Inspect source'});
  text.append(el('blockquote',readable(proof.text),{'data-original-text':proof.text}),el('footer',[proof.date,proof.earlier_page?'Page '+proof.earlier_page:''].filter(Boolean).join(' / ')));
  b.append(bar,text);return b;
}
function renderDiffusion(){
  const s=stage("03","Facts to evidence","Source map");
  s.body.append(el("div",null,{id:"diffusion-v6","data-testid":"flow-host"}));
  return s.outer;
}
function narrativeFlowExpected(){
  return {case_id:state.row.case.case_id,config:ARMS[state.arm].key,reading_id:state.reading,query_sha256:decisionPacket()?.query_sha256,native_checkpoint:state.saved.native_checkpoint,resource_binding:state.row.resource_binding||state.saved.resource_binding,task:state.row.case.task,
    ...selectedSourceScope(state.row.case),allowed_endpoint_ids:state.row.case.task==='redaction'?list(currentReading()?.candidates).flatMap(item=>[item.id,state.reading+'/'+item.id]):list(state.saved.result.atoms).map(atom=>atom.id)};
}
async function hydrateNarrativeTrace(epoch){
  const host=$('#diffusion-v6'),paths=$('#retrieval-paths-v6');if(!host||!paths)return;
  host.replaceChildren(note('Loading the exact saved narrative trace...'));
  try{
    const envelope=livePacket?null:await getJSON('/api/flow-v6?'+caseQuery({reading:state.reading,limit:'256'}),{signal:request?.signal});
    if(epoch!==state.epoch||!host.isConnected)return;
    const expected=narrativeFlowExpected();
    if(!livePacket&&(envelope.version!=='narrative-saved-flow/1'||envelope.case_id!==expected.case_id||envelope.config!==expected.config||envelope.reading_id!==expected.reading_id||envelope.query_sha256!==expected.query_sha256||canonicalGateJSON(envelope.native_checkpoint)!==canonicalGateJSON(expected.native_checkpoint)||canonicalGateJSON(envelope.resource_binding)!==canonicalGateJSON(expected.resource_binding)||!['narrative-local-execution/2','narrative-local-execution/3'].includes(envelope.native_version)||envelope.execution_kind!=='saved_narrative'||envelope.current_native_execution!==false||envelope.numerical_projection_available!==false||envelope.native_decisions_or_ranks_modified!==false||envelope.frames!=null||envelope.projection!=null))throw Error('The narrative flow envelope changed its exact saved execution or source binding.');
    if(!livePacket&&envelope.available!==true){
      if(envelope.trace!=null)throw Error('An unavailable narrative trace must not include substituted steps.');
      state.trace=null;host.dataset.status='unavailable';host.replaceChildren(note('No saved trace or graph route is published for this execution.','empty'));renderPaths();return;
    }
    const trace=livePacket?{...livePacket.trace,reading_id:state.reading}:narrativeUI.validateTrace(envelope,expected);state.trace=trace;host.dataset.status='available';host.dataset.readingId=state.reading;
    const pageLookups=!livePacket&&state.row.case.task==='redaction'?await loadSourceLookups({
      row:catalogCases().find(row=>row.case.case_id===state.row.case.case_id),record:state.saved,trace,
      reportSHA:publicationByteHashes.get(state.report),config:ARMS[state.arm].key,reading:state.reading}):null;
    if(epoch!==state.epoch||!host.isConnected)return;
    const safe=fn=>(...args)=>{if(epoch===state.epoch)fn(...args);};
    state.flow?.destroy();state.paths?.destroy();
    state.flow=mountEvidenceMap(host,{trace,plan:state.saved.plan,items:flowItems(),task:state.row.case.task,pageLookups,
      nativeCandidates:currentReading()?.candidates||[],formatText:readable,onSource:safe(sourceDrawer),onNode:safe(value=>{
      if(value.is_graph_node===true){void nodeDrawer(value,{navigation:false});return;}
      if(value.id&&list(state.saved.plan?.atoms).some(atom=>atom.id===value.id)){atomDetail(value);return;}
      const body=box(note(value.label||value.text||value.name||'Query lookup'));
      if(value.citation)body.append(sourceButton(value.citation));openDrawer('Saved trace object','Recorded query or source readout',body);
    }),onEdge:safe(edge=>{
      if(edge.kind==='SOURCE_PAGE_LOOKUP'){
        const body=box(note('The fact search matched this source page.'));
        const seen=new Set();
        for(const record of list(edge.records?.length?edge.records:[edge.record])){
          if(!record)continue;
          const key=canonicalGateJSON([record.atom_id,record.search?.id,record.basis,record.witness?.bm25]);
          if(seen.has(key))continue;seen.add(key);
          const index=list(state.saved.plan?.atoms).findIndex(atom=>atom.id===record.atom_id);
          body.append(heading((index>=0?'F'+(index+1)+' / ':'')+readable(record.search?.query||'')),
            fields([['Match',record.basis==='SEARCH_TOP_NODE_SAME_PAGE'?'Extracted node on this page':'Source page'],
              ['BM25',formatNumber(record.witness?.bm25)]]));
        }
        body.append(note('Search relevance, not a support verdict.'));
        if(edge.citation)body.append(sourceButton(edge.citation));
        openDrawer('Page match','Saved search',body);return;
      }
      const body=box(note((edge.record?.relation||edge.kind||'Source connection').replaceAll('_',' ')));
      if(edge.inspectionOnly)body.append(note('A source-inspection route, recorded after evidence selection.'));
      const lookup=trace.sources||trace.source_refs_by_id||{};
      for(const proof of uniqueProofs([edge.citation,...list(edge.records?.length?edge.records:[edge.record]).filter(Boolean).flatMap(record=>[record.citation,...list(record.citations),...list(record.source_refs).map(ref=>typeof ref==='string'?lookup[ref]:ref)])].filter(Boolean)))body.append(sourceButton(proof));
      openDrawer('Connection','Source map',body);
    }),onGuide:livePacket?null:safe(path=>{
      const lookup=trace.sources||trace.source_refs_by_id||{},raw=list(path.decision_source_refs||path.source_refs)[0],proof=typeof raw==='string'?lookup[raw]:raw;
      const route_index=trace.paths.filter(p=>p.candidate_or_atom_id===path.candidate_or_atom_id).findIndex(p=>p.id===path.id);
      guidePath({candidate:{id:path.candidate_or_atom_id},route:{...path,nodes:[]},route_index,proof});
    })});
    paths.replaceChildren();state.paths=null;renderPaths();
    renderNarrativeScores();viewportAnchor.schedule();
  }catch(error){
    if(epoch!==state.epoch||error.name==='AbortError'||!host.isConnected)return;
    state.trace=null;host.dataset.status='unavailable';host.replaceChildren(note('The exact saved trace is unavailable. No current-native flow or other reading is substituted.','empty'),note(error.message));renderPaths();
  }
}
async function verifiedNarrativeEndpoint(path,epoch){
  const record=state.saved,c={...state.row.case},reading=state.reading,binding=state.row.resource_binding||record.resource_binding;
  const saved=narrativeEndpoints.savedEndpointForPath(record,c,reading,path);if(!saved)return null;
  const key=canonicalGateJSON([c.case_id,record.config,record.native_checkpoint,reading,saved]);
  let pending=endpointCache.get(key);
  if(!pending){pending=(async()=>{
    const packet=await getJSON('/api/node-v6?'+new URLSearchParams({case_id:c.case_id,config:record.config,node_id:saved.node_id}));
    const endpoint=narrativeEndpoints.verifyEndpointPacket(packet,saved,c,binding);
    const response=await getJSON('/api/source-v6?'+new URLSearchParams({case_id:c.case_id,config:record.config,source_id:endpoint.quote.canonical_page_id})),page=response.page||response,hash=await verifySourcePage(page,c);
    narrativeEndpoints.verifyEndpointSource(page,endpoint.quote,c,hash);
    if(endpoint.source_label_proof)narrativeEndpoints.verifyEndpointSource(page,endpoint.source_label_proof.native_quote,c,hash);
    return endpoint;
  })();endpointCache.set(key,pending);pending.catch(()=>{if(endpointCache.get(key)===pending)endpointCache.delete(key);});}
  const endpoint=await pending;if(epoch!==state.epoch||record!==state.saved)return null;
  if(['iran','vietnam'].includes(c.corpus)&&path.source_endpoint){const choices=state.trace.paths.filter(p=>p.candidate_or_atom_id===path.candidate_or_atom_id),routeIndex=path.guide_route_index??path.route_index??choices.findIndex(p=>p.id===path.id);return {...endpoint,href:narrativeEndpoints.endpointInspectionURL({caseInfo:c,config:record.config,reading,path,endpoint,routeIndex,binding}),href_label:'Inspect saved endpoint in case source graph',source_endpoint_inspection_only:true};}
  return {...endpoint,href:graphURL({node_id:endpoint.node_id,focus_graph_id:endpoint.graph_id,focus_hierarchy_id:endpoint.hierarchy_id})};
}
function renderNarrativeScores(host=$('#narrative-scorecards-v1')){
  if(host&&state.trace?.scorecards)narrativeUI.renderScorecards(host,state.trace.scorecards,{readingId:state.reading,onSource:sourceDrawer});
}
async function hydrateFlow(epoch){
  if(!state.saved)return;
  if(isNarrativePublication())return hydrateNarrativeTrace(epoch);
  const host=$("#diffusion-v6");if(!host)return;
  host.replaceChildren(note("Loading saved routes...","empty"));
  try{
    const params=caseQuery({reading:state.reading,limit:"256"}),key=state.report.run_id+"/"+params;
    let data=projectionCache.get(key);
    if(!data){data=await getJSON("/api/flow-v6?"+params,{signal:request?.signal});if(!pendingRecord(data))projectionCache.set(key,data);}
    if(epoch!==state.epoch||!host.isConnected)return;
    const projection=data.projection||data.flow||data;
    if(projection.case_id!==state.row.case.case_id||![ARMS[state.arm].key,state.arm].includes(projection.config)||projection.reading_id!=null&&projection.reading_id!==state.reading)throw Error("Saved route binding differs from the selected case, method or reading.");
    if(!Array.isArray(projection.nodes)||!Array.isArray(projection.frames))throw Error("No saved route projection is published.");
    state.projection=projection;state.flow?.destroy();
    const routeItems=flowItems().map(item=>{const atoms=guideRoutes(contributor(item)||{}).flatMap(route=>recordedAtomLinks(route,state.saved.plan)),label=[...new Set(atoms.map(a=>a.id))].join(', ')||'Saved clue';return {...item,fill:`${label} / ${short(usedProofs(item)[0]?.text||'Source readout',7)}`};});
    const fills=candidates().map(item=>item.fill).filter(Boolean),safeLabel=value=>fills.reduce((text,fill)=>text.split(fill).join('saved target'),String(value||''));
    const routeProjection={...projection,nodes:list(projection.nodes).map(node=>({...node,label:safeLabel(node.label)}))};
    state.flow=mountSavedRoutes(host,{projection:routeProjection,plan:state.saved.plan,items:routeItems,selected:state.candidate,traceFor:item=>{const trace=contributor(item);if(!trace)return trace;const clean=route=>({...route,nodes:list(route.nodes).map(node=>typeof node==='string'?node:{...node,label:safeLabel(node.label)})});return {...trace,represented_routes:guideRoutes(trace).map(clean),lexical_routes:list(trace.lexical_routes).map(clean)};},proofsFor:usedProofs,
      onSelect:selectCandidate,onAtom:atomDetail,onNode:value=>value.workbench_route_detail?openDrawer(value.label,"Saved route / unchanged",value.workbench_route_detail):nodeDrawer(value),onSource:sourceDrawer,onGuide:guidePath,provenance:routeProvenance});
    renderPaths();
  }catch(error){
    if(epoch!==state.epoch||error.name==="AbortError"||!host.isConnected)return;
    host.replaceChildren(note("Saved routes unavailable. Exact used quotations remain in 04; no path is substituted.","empty"),note(error.message));renderPaths();
  }
}
function renderPathsStage(){
  const s=stage("04","Selected evidence","Sources");s.outer.dataset.testid="paths-stage";
  s.body.append(el("div",null,{id:"retrieval-paths-v6"}));queueMicrotask(renderPaths);return s.outer;
}
function renderPaths(){
  const host=$("#retrieval-paths-v6");if(!host)return;host.replaceChildren();
  const items=state.row.case.task==='redaction'?candidates():list(state.saved.result?.atoms).filter(a=>verdictSummary(state.saved,state.row.case,state.reading).units.some(u=>u.id===a.id));
  if(state.row.case.task!=='redaction'){
    for(const item of items){
      const section=el('section',null,{class:'fact-evidence-group','data-atom-id':item.id});
      const index=list(state.saved.plan?.atoms).findIndex(atom=>atom.id===item.id);
      section.append(el('h3',(index>=0?'F'+(index+1)+' / ':'')+readable(item.text||item.source_quote||item.id)));
      const proofs=uniqueProofs(usedProofs(item)).map(proof=>({...proof,atom_ids:[item.id]})),grid=el('div',null,{class:'matched-quotation-grid'});
      for(const proof of proofs)grid.append(quoteCard(proof));
      section.append(grid);if(!proofs.length)section.append(note('No selected source establishes this fact.','empty'));
      host.append(section);
    }
    return;
  }
  const proofs=uniqueProofs(items.flatMap(usedProofs)).map(proof=>({...proof,atom_ids:[...new Set([...list(proof.atom_ids),...items.filter(item=>state.row.case.task!=='redaction'&&usedProofs(item).some(p=>p.canonical_page_id===proof.canonical_page_id&&p.start===proof.start&&p.end===proof.end&&p.text===proof.text)).map(item=>item.id)])]})),docs=new Map();
  for(const proof of proofs){const id=proof.document_id||proof.canonical_page_id;if(!docs.has(id))docs.set(id,new Map());const pages=docs.get(id);if(!pages.has(proof.canonical_page_id))pages.set(proof.canonical_page_id,[]);pages.get(proof.canonical_page_id).push(proof);}
  const groups=el("div",null,{class:"matched-quotation-grid"});
  for(const proof of proofs)groups.append(quoteCard(proof));
  host.append(groups);if(!proofs.length)host.append(note("No exact used source quotations are published for this selection.","empty"));
}
function renderVerdictStrip(){
  const summary=verdictSummary(state.saved,state.row.case,state.reading),task=state.row.case.task;
  const hero=el('section',null,{class:'construction-verdict verdict-strip','data-tone':summary.tone,'data-testid':'compact-verdict','aria-label':'Verdict'});
  hero.append(el('p','Verdict',{class:'eyebrow'}),el('h2',summary.title,{'data-testid':'local-verdict-title'}));
  if(summary.recommendation)hero.append(el('p',readable(summary.recommendation.text),{class:'recommended-fill','data-testid':'recommended-fill'}));
  else if(task==='redaction'){
    const first=candidates()[0];
    if(first)hero.append(el('p','Top candidate: '+readable(first.fill)+' / '+decisionLabel(newDecision(first)),{class:'first-saved-fill','data-testid':'first-saved-fill'}));
  }
  if(task!=='redaction'){
    const mosaic=el('div',null,{class:'verdict-facts','aria-label':'Native fact judgments'});
    for(const unit of summary.units){
      const index=list(state.saved.plan?.atoms).findIndex(atom=>atom.id===unit.id);
      const chip=button((index>=0?'F'+(index+1)+': ':'')+unit.label,()=>{
        const atom=list(state.saved.result?.atoms).find(atom=>atom.id===unit.id);
        if(atom)atomDetail(atom);else decisionDrawer(unit.unit);
      },'verdict-fact',{'data-kind':unit.kind,'data-atom-id':unit.id,title:readable(unit.text)});
      mosaic.append(chip);
    }
    hero.append(mosaic);
  }
  const caveats=presentationCaveats(state.row);if(caveats)hero.append(caveats);
  hero.append(button('Why this verdict',()=>openDrawer('Recorded evidence decision','Saved evidence checks',localVerdictPanel()),'quiet'));
  return hero;
}
function renderResultBody(){
  const host=$("#result-body");if(!host||!state.saved)return;host.replaceChildren();
  const summary=verdictSummary(state.saved,state.row.case,state.reading),task=state.row.case.task;
  const items=task==='redaction'?candidates():list(state.saved.result?.atoms).filter(a=>summary.units.some(u=>u.id===a.id));
  host.append(el('div',null,{id:'terminal-decision-scores','data-testid':'terminal-decision-scores'}));
  if(state.reading){const rows=readingRows(),index=rows.findIndex(row=>row.reading.id===state.reading);host.append(el("p",readingLabel(rows[index]?.reading||{},index+1),{class:"scope-line","data-testid":"active-reading"}));}
  if(task==='redaction')host.append(note("Up to five saved fills. Rank is not acceptance."));
  else host.append(note(task==='hypothesis'?"Support, oppose and context retain their recorded scope.":"One tile per required atom. Gaps stay gaps; coverage is not confidence."));
  const grid=el("div",null,{class:task==='redaction'?"construction-grid":"atom-mosaic","data-testid":"construction-grid"});
  for(const [index,item] of items.entries()){
    const unit=newDecision(item),readout=task==='redaction'?{kind:unit?.status==='evidence_backed_suggestion'?'supported':unit?.status==='incompatible_not_viable'?'opposed':'context',label:decisionLabel(unit)}:assertionDecision(unit,task);
    const card=el("article",null,{class:"construction-card","data-testid":task==='redaction'?"candidate-card":"result-atom","data-proposal-id":item.id,"data-atom-id":task==='redaction'?null:item.id,"data-kind":readout.kind});
    card.append(el("span",task==='redaction'?String(index+1).padStart(2,"0"):item.id,{class:"eyebrow"}),el("h3",readable(item.fill||item.text||item.source_quote||item.id)),badge(readout.label));
    if(task!=='redaction'){
      const evidence=[...list(unit?.evidence),...list(unit?.requirements).flatMap(r=>list(r.evidence))],directions=new Set(evidence.map(e=>String(e.direction||'').toLowerCase()).filter(Boolean).map(d=>['support','for'].includes(d)?'Support':['counterevidence','against','oppose'].includes(d)?'Oppose':['partial','context','contextual'].includes(d)?'Context':null).filter(Boolean));
      if(task==='hypothesis'){const scopes=el("div",null,{class:"evidence-directions","aria-label":"Saved evidence directions"});for(const direction of ['Support','Oppose','Context'])scopes.append(el("span",direction,{"data-direction":direction,"data-active":directions.has(direction)}));card.append(scopes);}
      const checks=el("div",null,{class:"coverage-checks","aria-label":"Recorded checks, not a numerical score"});
      for(const check of list(unit?.checklist))checks.append(button(check.label,()=>decisionCheckDrawer(check,unit),"coverage-check",{"data-state":check.state,title:check.detail}));const details=el('details');details.append(el('summary','Decision checks'),checks);card.append(details);
    }
    const proofs=usedProofs(item),sources=new Set(proofs.map(p=>p.document_id||p.canonical_page_id));
    card.append(button(`Sources / ${sources.size}`,()=>task==='redaction'?candidateDetail(item):atomDetail(item),"",{"data-testid":task==='redaction'?"candidate-detail":"atom-detail"}));
    if(task==='redaction')card.append(button("Routes",()=>{selectCandidate(item.id);stagePosition("03");},"quiet"));grid.append(card);
  }
  host.append(grid);if(!items.length)host.append(note("No saved alternatives for this selection. No other reading or method is substituted.","empty"));
  const groupedOccurrences=task==='redaction'&&items.some(item=>list(item.presentation_variants).length>1);
  if(groupedOccurrences){
    const counts={backed:0,context:0,other:0};
    for(const item of items){const status=newDecision(item)?.status;counts[status==='evidence_backed_suggestion'?'backed':status==='exploratory_contextual'?'context':'other']++;}
    host.append(note(`${items.length} distinct fills / ${counts.backed} evidence-backed / ${counts.context} contextual${counts.other?' / '+counts.other+' other':''}. Repeated source occurrences are grouped, not counted as extra corroboration.`));
  }else{const recordedCounts=localVerdictPanel().querySelector('.verdict-counts');if(recordedCounts)host.append(recordedCounts);}
  renderTerminalScores();
  if(task==='redaction'&&items.length){
    const details=el('details');details.append(el('summary','Historical raw ranking inputs'),renderScoreChart(items));host.append(details);
  }
  host.append(button("Detailed construction and original audit",frozenAuditDrawer,"quiet",{"data-testid":"frozen-native-audit"}));
}
function renderTerminalScores(){
  const host=$('#terminal-decision-scores');if(!host)return;
  try{
    const scores=computeDecisionScores(state.saved);
    host.replaceChildren(renderTerminalScoreCards(state.saved,scores,{formatScore:formatDecisionScore,formatText:readable,
      readingTitle:r=>readingLabel(r,readingRows().findIndex(row=>row.reading.id===r.id)+1),onExplain:item=>{
        const body=box(note('Saved arithmetic only; source judgments and citations retain their recorded scope.'));
        if(item.source_function_band){
          body.append(heading('Final ranking'),fields([
            ['Final score',formatDecisionScore(item.score)],['Evidence tier',item.evidence_tier],
            ['Source-function band',item.source_function_band.value],['Source fit',formatDecisionScore(item.fit)]]));
          body.append(note('Evidence sufficiency comes first, then source-owned function checks, then accumulated evidence and fit. More background context cannot overrule a stronger source-function match.'));
          const checks=list(item.source_function_band.source_checks).filter(check=>check.satisfied);
          if(checks.length)body.append(fields(checks.map(check=>[check.name.replaceAll('_',' '),check.contribution])));
          if(item.source_function_band.declared_visible_attachment)body.append(note('Verified visible-role attachment: 512.'));
        }
        for(const contribution of list(item.contributions)){
          body.append(heading(humanDirection(contribution.direction)),fields([['Contribution',formatDecisionScore(contribution.contribution)],['Retrieval weight',formatDecisionScore(contribution.retrieval_weight)],['Page rank',contribution.page_rank],['Fit',formatDecisionScore(contribution.fit)]]));
          if(contribution.citation)body.append(sourceButton(contribution.citation));
        }
        if(!list(item.contributions).length)body.append(note('No individual source contributions were saved.'));
        openDrawer('Source contributions','Terminal score breakdown',body);
      }}));
  }catch(error){host.replaceChildren(note(error.message+' No score is substituted.','notice'));}
}
const digestCache=new Map();
function renderFindings(){
  const s=stage("06","Analyst digest","Saved post-run review"),host=el("div",null,{class:"analyst-digest","data-testid":"analyst-digest","data-status":"pending"});
  host.append(el("p","Source-bound analyst digest pending.",{role:"status"}));
  s.body.append(host,button("Evidence review and detailed checks",()=>{const audit=renderFindingsAudit();openDrawer("Evidence review","Recorded criteria and separate post-run opinions",audit.querySelector(".stage-body"));}));
  queueMicrotask(()=>loadAnalystDigest(host,state.epoch,state.reading));return s.outer;
}
async function loadAnalystDigest(host,epoch,reading){
  try{
    let data;
    if(livePacket)data=livePacket.analyst_digest||{available:false};
    else{
      const params=caseQuery(),key=canonicalGateJSON([params.toString(),state.saved.native_checksum,state.saved.resource_binding]);
      data=digestCache.get(key);if(!data){data=await getJSON("/api/current/analyst-digest?"+params);if(data.available===true)digestCache.set(key,data);}
    }
    if(epoch!==state.epoch||reading!==state.reading||!host.isConnected)return;
    if(data.available!==true){host.dataset.status='unavailable';host.replaceChildren(el('p','No analyst digest is attached.'),note('The native verdict and selected evidence remain available above.'));return;}
    if(data.version==='source-bound-postrun-digest/1'){
      if(data.native_checksum!==state.saved.native_checksum||data.query_sha256!==await textDigest(state.row.case.query)||
          canonicalGateJSON(data.resource_binding)!==canonicalGateJSON(state.saved.resource_binding)||
          !Array.isArray(data.sources)||data.source_count!==data.sources.length||data.sources.some((source,index)=>source.id!=='S'+(index+1))||
          [...data.text.matchAll(/\bS(\d+)\b/g)].some(match=>+match[1]<1||+match[1]>data.sources.length))throw Error('The digest does not match the native result and sources.');
    }else if(livePacket||isNarrativePublication()&&(!['narrative-saved-digest/1','narrative-saved-digest/2'].includes(data.version)||data.case_id!==state.row.case.case_id||data.config!==ARMS[state.arm].key||canonicalGateJSON(data.native_checkpoint)!==canonicalGateJSON(state.saved.native_checkpoint)||!['narrative-local-execution/2','narrative-local-execution/3'].includes(data.native_version)||data.current_native_execution!==false))throw Error('No matching saved narrative digest is attached.');
    const words=typeof data.text==='string'?data.text.trim().split(/\s+/):[];
    if(data.postrun!==true||data.used_for_inference!==false||words.length<50||words.length>100)throw Error("No matching 50-100 word post-run digest is available.");
    const expectedScope=list(state.row.presentation_caveats).map(({title,text})=>({title,text}));
    if(data.source_scope_notes&&(data.source_scope_notes.postrun_only!==true||data.source_scope_notes.used_for_local_inference!==false||data.source_scope_notes.changes_native_verdict!==false||canonicalGateJSON(data.source_scope_notes.notes)!==canonicalGateJSON(expectedScope)))throw Error("Digest source scope differs from the selected question.");
    if(epoch!==state.epoch||reading!==state.reading||!host.isConnected)return;
    host.dataset.status="available";host.replaceChildren(el("p",data.text),note("Separate post-run source review. Not an answer-key judgment or a new evidence vote."));
    const scope=presentationCaveats(state.row);if(scope)host.append(scope);
    const sources=digestProofs(data.sources);
    if(sources.length)host.append(button("Sources",()=>{const body=box();for(const proof of sources)body.append(quoteCard(proof));openDrawer("Digest sources","Verified saved review quotations",body);},"",{"data-testid":"digest-sources"}));
  }catch{if(host.isConnected&&epoch===state.epoch){host.dataset.status=isNarrativePublication()?'unavailable':'pending';host.replaceChildren(el("p",isNarrativePublication()?'Saved analyst digest unavailable.':"Source-bound analyst digest pending.",{role:"status"}),note("No generated text or historical commentary is substituted."));}}
}
function renderPlanAudit() {
  const s=stage("02","Search clues, readings and questions",ARMS[state.arm].origin,state.arm==="A"?"model":"");
  const failure=failureReceipt();if(failure)s.body.append(failure);
  const plan=state.saved.plan||{},atoms=list(plan.atoms),reads=list(plan.slot_readings),leads=list(plan.leads);
  if(readingRows().length)s.body.append(note("Active saved reading / branch: "+state.reading));
  s.body.append(note("These required assertions and search clues locate sources. A search clue is not evidence that the assertion is true."));
  const rows=el("div",null,{class:"compact-list"});for(const atom of atoms)rows.append(inspectRow(atom.id,atom.text||atom.source_quote,atom.required===false?"Optional":"Required",()=>atomDetail(atom),{"data-testid":"plan-atom"}));
  s.body.append(rows);if(!atoms.length)s.body.append(note("No shared atoms were published for this condition.","empty"));
  const extraction=plan.extractions||{};const counts=Object.entries(extraction).filter(([,v])=>Array.isArray(v)).map(([k,v])=>`${v.length} ${k}`);
  if(counts.length)s.body.append(note("Shared query extraction: "+counts.join(" / ")));
  s.body.append(heading("Saved interpretation"));
  if(leads.length)s.body.append(note("Discovery questions locate potentially relevant sources. They are search aids, not assertions established by evidence.","notice"));
  if(!reads.length)s.body.append(note("This task searches the recorded assertions without a missing-span interpretation."));
  for(const r of reads.filter(r=>!state.reading||r.id===state.reading)){
    const card=el("article",null,{class:"reading-plan","data-reading-id":r.id});card.append(el("h3",`${r.id} / ${primitive(r.form)}`),note(readingText(r)),button("Reading details",()=>readingDetail(r)));
    const linked=leads.filter(l=>list(l.reading_ids).includes(r.id));
    if(linked.length){const details=el("details"),summary=el("summary",`${linked.length} direct discovery question${linked.length===1?"":"s"} linked to reading ${r.id}`);details.append(summary);for(const l of linked)details.append(inspectRow(l.id,l.question,"Reading IDs: "+list(l.reading_ids).join(", "),()=>leadDetail(l),{"data-testid":"discovery-question"}));card.append(details);}s.body.append(card);
  }
  const unlinked=leads.filter(l=>!list(l.reading_ids).length);
  if(unlinked.length){s.body.append(heading("Context discovery questions"));for(const lead of unlinked)s.body.append(inspectRow(lead.id,lead.question,"Query-derived",()=>leadDetail(lead),{"data-testid":"discovery-question"}));}
  const methods=el("details",null,{class:"method-audit"});methods.append(el("summary","Search preparation / technical details"),modelStages(),button("Saved prompts and instructions",promptDrawer,"",{"data-testid":"planning-instructions"}));s.body.append(methods);return s.outer;
}
function leadDetail(lead) { const body=box(note(lead.question,"notice"),fields([["Question ID / not a score",lead.id,true],["Linked reading IDs",list(lead.reading_ids).join(", ")||"No reading link",true],["Linked atom IDs",list(lead.atom_ids).join(", ")||"No atom link",true]]),note(lead.rationale||lead.reason||"Model-authored direct question from visible query anchors and shared extraction/atoms, not a source-established event."));for(const q of list(lead.anchor_quotes))body.append(el("blockquote",typeof q==="string"?q:q.text,{class:"cue"}));openDrawer("Discovery question "+lead.id,`Arm ${state.arm} / saved plan`,body); }
function modelStages() {
  const host=el("section",null,{class:"model-stages","data-testid":"model-stages"});
  if(isNarrativePublication()){
    host.append(heading('Saved narrative execution'),note('This is the saved narrative planner, constructor and evidence decision, not a current-native execution or numerical diffusion replay.'),fields([['Projection',state.saved?.version,true],['Native checkpoint',state.saved?.native_checkpoint?.path,true],['Checkpoint SHA-256',state.saved?.native_checkpoint?.sha256,true]]));return host;
  }
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

function renderDiffusionAudit() {
  const s=stage("03","Discover relevant sources","Relevance, not confidence");
  const r=state.saved.result||{},retrieval=r.retrieval||{},scope=state.saved.inspection_scope||{};
  const metrics=el("div",null,{class:"metric-strip"});
  for(const [value,label] of [[scope.eligible_pages_scored??retrieval.eligible_pages,"eligible pages scored"],[scope.primary_page_count??r.source_pages_inspected??retrieval.pages_admitted,"primary pages inspected"],[retrieval.document_budget,"document admission cap"]])if(Number.isFinite(value)){const m=el("div",null,{class:"metric"});m.append(el("strong",fmt(value)),el("span",label));metrics.append(m);}
  s.body.append(metrics);
  const grid=el("div",null,{class:"diffusion-grid"}),host=el("div",null,{id:"diffusion-v6",class:"flow-host","data-testid":"flow-host","aria-label":`Hierarchical diffusion replay / arm ${state.arm}`});
  host.append(note("Loading the bound hierarchy projection...","empty"));
  const aside=el("aside",null,{class:"diffusion-context","aria-label":"Routing and evidence boundaries"});
  const documents=el("section",null,{class:"flow-sidecard document-panel",id:"document-panel-v6"});documents.append(el("h3","Relevant documents"),el("div",null,{id:"flow-documents-v6"}));
  const route=el("section",null,{class:"flow-sidecard"});route.append(el("h3","Relevance is not a verdict"),note("The search clues contribute to the same saved source search. Choosing an interpretation changes the displayed targets, not the recorded calculation."),note("High relevance does not mean that a source supports the assertion or that a proposed fill is correct."));
  const calculation=el("details");calculation.append(el("summary","How source relevance is calculated"),diffusionFormula(),note("Saved numerical transport combines query matches and graph transitions; it is not a correctness probability."));route.append(calculation);
  const policy=el("section",null,{class:"flow-sidecard"});policy.append(el("h3","One pinned source view"),note(sourceScopeText()),note(state.row.case.corpus==="cib"?"Earlier-visible CIB source material only.":"Bound CONFIDENTIAL cable evidence view only."),note("Identity and hierarchy assignments are retrospective. Display and inspection limits are not corpus completeness."));
  aside.append(documents);grid.append(host,aside);
  s.body.append(note(sourceScopeText()+" Relevance is not factual support."),button("Source scope and display limits",()=>openDrawer("Source scope and relevance","Saved source boundaries, not confidence",box(route,policy))),grid);return s.outer;
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

async function hydrateFlowAudit(epoch,{expanded=false}={}) {
  if(!state.saved)return;
  const host=$("#diffusion-v6"),pathsHost=$("#retrieval-paths-v6");if(!host||!pathsHost)return;
  if((recordedFailure(state.saved.result)||recordedFailure(state.saved))&&!nativeFlow()){
    host.replaceChildren(note("The saved execution failed. Its actual receipt is shown in stages 02 and 05; no numerical replay is substituted.","empty"));renderPaths();return;
  }
  const requestedLimit=isCurrentPublication()?(expanded?2048:256):Number.isInteger(state.report.flow_drawing_limit)&&state.report.flow_drawing_limit>=32&&state.report.flow_drawing_limit<=2048?state.report.flow_drawing_limit:1024;
  const params=caseQuery({reading:state.reading,limit:String(requestedLimit)});
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
    state.flow?.destroy();state.paths?.destroy();state.flow=null;state.paths=null;host.replaceChildren();
    const callbacks={projection,task:state.row.case.task,formatDirection:humanDirection,
      localDecisionFor:item=>newDecision(item),onLocalDecision:item=>decisionDrawer(item),qualifiedAccountSummaryFor:item=>qualifiedAccountSummary(newDecision(item)),derivedGuideDisclosure:guideDisclosure,formatRouteProvenance:routeProvenance,
      preserveViewport:fn=>viewportAnchor.run(fn),onLayoutChange:()=>viewportAnchor.schedule(),onBeforeNavigate:()=>viewportAnchor.cancel(),
      onInspect:({title,body})=>openDrawer(title,"Display explanation / not an evidence decision",body),
      onSource:proof=>{if(epoch===state.epoch)sourceDrawer(proof);},
      onNode:node=>{if(epoch===state.epoch)nodeDrawer(node);},
      onEdge:edge=>{if(epoch===state.epoch)edgeDrawer(edge);},
      onSelectCandidate:item=>{if(epoch===state.epoch)selectCandidate(typeof item==="string"?item:item?.id,{fromFlow:true});}
    };
    if(isCurrentPublication()&&!expanded)callbacks.onExpand=async()=>{
      const trigger=host.querySelector('[data-testid=expand-flow-v6]');
      if(trigger){trigger.disabled=true;trigger.textContent='Loading larger saved graph...';}
      await hydrateFlow(epoch,{expanded:true});
      if(epoch===state.epoch)state.flow?.openExpanded?.();
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
    host.replaceChildren(note("The source graph cannot be displayed. Saved source paths remain available below; no graph has been substituted.","empty"),note(error.message));
    renderPaths();
  }
}

function renderPathsStageAudit() {
  const s=stage("04","Follow the sources","Paths are not proof");s.outer.setAttribute("data-testid","paths-stage");
  s.body.append(note("Follow a route to its source. Paths locate evidence; they do not establish the claim."),el("div",null,{id:"derived-decision-guide-v65"}),el("div",null,{id:"retrieval-paths-v6"}));
  queueMicrotask(renderDecisionGuide);
  queueMicrotask(renderPaths);return s.outer;
}
function renderPathsAudit() {
  if(state.paths)return;
  const host=$("#retrieval-paths-v6");if(!host)return;host.replaceChildren();
  const item=selectedItem(),trace=contributor(item);
  host.append(note("Selected saved item: "+(item?formatTargetText(item,state.row.case.task):"none"),"notice"));
  if(!trace){host.append(note("No saved contributor routes were supplied for this item. None are inferred from nearby graph nodes.","empty"));return;}
  host.append(note(trace.readout_explanation||((trace.binding==="source_page_readout")?"Source-page contributors are context for an unbound phrase, not its graph identity.":"Saved routing witnesses describe relevance, not factual entailment.")));
  const routes=list(trace.routes||trace.witnesses||trace.paths).slice(0,3);
  for(const [i,route] of routes.entries()){
    const provenance=routeProvenance(route),card=el("section",null,{class:"path-card path-chart","data-testid":"routing-witness"});card.append(el("h3",provenance.label+" "+(i+1)),note("Relevance route, not a factual proof chain."));
    const chain=el("div",null,{class:"path-chain"});
    for(const [j,value] of list(route.nodes).entries()){
      const id=typeof value==="string"?value:value.id,node=typeof value==="string"?(nativeFlow()?.nodes||[]).find(n=>n.id===id):value;
      if(j)chain.append(el("span","to",{class:"arrow"}));
      chain.append(button(node?.label||"Saved graph state",()=>nodeDrawer(node||{id}),"",{"data-node-id":id}));
    }
    card.append(chain);
    for(const hop of list(route.hops||route.edges))for(const proof of list(hop.citations))card.append(sourceButton(proof));
    card.append(button("Inspect route details",()=>{
      const body=box(note(provenance.note),note(route.meaning||"One saved witness, not an exhaustive path enumeration."));
      for(const hop of list(route.hops||route.edges)){body.append(note(`${primitive(hop.kind)} / transition ${fmt(hop.transition)}. Navigation is not a source assertion.`));for(const proof of list(hop.citations))body.append(sourceButton(proof));}
      openDrawer("Route scope and source anchors","Relevance, not factual entailment",body);
    }),button("Guide Path in Corpus Map",()=>guidePath({candidate:{...item,...trace},route,route_index:i})));host.append(card);
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

function guidePath({candidate,route,route_index,proof}={}) {
  if(!candidate?.id||!route)return;
  if(!allowPrivileged(()=>guidePath({candidate,route,route_index,proof})))return;
  const params=new URLSearchParams({corpus:state.row.case.corpus,guide_case:state.row.case.case_id,guide_arm:ARMS[state.arm].key,
    guide_reading:state.reading,guide_candidate:candidate.id,guide_route:String(route_index),guide_autoplay:'1',return_to:location.pathname+location.search});
  if(isNarrativePublication()&&/^path_[a-f0-9]{24}$/.test(route.id||'')){params.set('guide_candidate',route.id);params.set('guide_route','0');}
  if(proof){
    const item=flowItems().find(item=>item.id===candidate.id),path=isNarrativePublication()?state.trace?.paths.find(p=>p.id===route.id&&p.candidate_or_atom_id===candidate.id):null,lookup=state.trace?.sources||state.trace?.source_refs_by_id||{};
    const inventory=path?uniqueProofs(list(path.decision_source_refs||path.source_refs).map(ref=>typeof ref==='string'?lookup[ref]:ref)):usedProofs(item);
    const bound=inventory.find(p=>p.canonical_page_id===proof.canonical_page_id&&p.page_sha256===proof.page_sha256&&p.start===proof.start&&p.end===proof.end&&p.text===proof.text);
    if(!bound)throw Error("The guide destination is not a saved used quotation.");
    for(const [key,value] of Object.entries({guide_source:bound.canonical_page_id,guide_start:bound.start,guide_end:bound.end,guide_hash:bound.page_sha256}))params.set(key,String(value));
  }
  pinGraphQuery(params);
  if(isNarrativePublication()&&/^path_[a-f0-9]{24}$/.test(route.id||'')){
    const walk=new URLSearchParams({corpus:state.row.case.corpus,walk_case:state.row.case.case_id,walk_config:ARMS[state.arm].key,walk_reading:state.reading,walk_path:route.id,walk_autoplay:'1',return_to:location.pathname+location.search});
    if(proof)for(const [key,value]of Object.entries({walk_source:proof.canonical_page_id,walk_start:proof.start,walk_end:proof.end,walk_hash:proof.page_sha256}))walk.set(key,String(value));
    for(const key of ['resource_id','registry_sha256','index_sha256'])if(params.has(key))walk.set(key,params.get(key));
    location.assign('graph-full-v6.html?'+walk);return;
  }
  location.assign('graph-full-v6.html?'+params);
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
  clearIndependentReview();state.epoch++;state.projection=null;state.trace=null;
  if(!flowItems().some(c=>c.id===state.candidate))state.candidate=flowItems()[0]?.id||"";
  updateRailStatus(state.row,state.arm);
  await initializeIndependentReview();renderWorkspace();savePosition();
  if(state.reference)void loadIndependentReview();
  await hydrateFlow(state.epoch);
}
function renderResultsStage() {
  const c=state.row.case,s=stage("05",c.task==="redaction"?"Saved fills":TASKS[c.task],"Local verdict");
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
  const artifact=isStaticPublicReplay()?'Stage 06 links to a saved inference receipt, not the full native checkpoint.':'Open the saved native record in Stage 06 for the full artifact.';
  return Number.isInteger(count)&&count>0?note(`${count} additional native evidence records are omitted from this published presentation. Counts and expansion cover only the published sources, not all native evidence or the corpus. ${artifact}${publicAuditNotice()?' '+publicAuditNotice():''}`,"notice"):null;
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
  Decision:"A recommendation requires the applicable source, focal-fact and insertion checks to pass. Open the checks to see which quotation meets each requirement or what is still missing.",
  Identity:"Whether the source occurrence identifies the proposed entity. An attested name is not proof that it performed the missing action.",
  Wording:"Whether the candidate phrase is attested or source-derived. Quoted words do not by themselves entail the queried relationship.",
  Support:"Eligible quotations are checked against the missing fact. A source can establish a property or role without establishing the surrounding action. Graph relevance alone does not establish either.",
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
  const steps=task==="redaction"?["Question and proposed fills","Check original quotations","Check the missing fact","Independent model summary"]:
    ["Question and required facts","Check original quotations","Check each requirement","Independent model summary"];
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
  const host=el("details",null,{"data-raw-inspector":"true"});host.append(el("summary",title));
  function record(v,parent){
    if(v==null)return;
    if(typeof v!=="object"){parent.append(note(primitive(v)));return;}
    for(const [key,item] of Object.entries(v)){
      if(item==null)continue;
      if(typeof item!=="object")parent.append(fields([[key.replaceAll("_"," "),item,true]]));
      else{const detail=el("details");detail.append(el("summary",key.replaceAll("_"," ")));record(item,detail);parent.append(detail);}
    }
  }
  let expanded=false;host.addEventListener("toggle",()=>{if(host.open&&!expanded){expanded=true;record(value,host);}});return host;
}
function decisionPacket() { return state.saved?.local_decisions_v65||null; }
function presentationCaveatEntries(row){
  const entries=list(row.presentation_caveats).filter(value=>value&&typeof value.title==="string"&&value.title.trim()&&typeof value.text==="string"&&value.text.trim());
  const review=row.showcase_review;
  if(review?.qualified===false&&review.assessment_ref?.sha256&&review.native_checksum){
    entries.push({title:"Showcase criteria not met",text:"The saved local result is retained with its contextual or unresolved decision. A reference match alone does not establish corpus support."});
  }
  return entries;
}
function presentationCaveats(row){
  const entries=presentationCaveatEntries(row);
  if(!entries.length)return null;
  const host=el("aside",null,{class:"presentation-caveats",role:"note","aria-label":"Scope caveats","data-testid":"presentation-caveats"});
  host.append(el("h3",entries.length===1?"Scope caveat":"Scope caveats"));
  for(const value of entries){const item=el("div",null,{"data-testid":"presentation-caveat"});item.append(el("h4",value.title.trim()),el("p",value.text.trim()));host.append(item);}
  return host;
}
function localVerdictPanel(){
  const summary=verdictSummary(state.saved,state.row.case,state.reading),host=el("section",null,{class:"local-verdict-hero","data-testid":"local-verdict-panel","data-tone":summary.tone,"aria-label":"Local verdict"});
  const title=el("div",null,{class:"local-verdict-heading"});title.append(el("p","Local Verdict",{class:"eyebrow"}),el("h2",summary.title,{"data-testid":"local-verdict-title"}),note(summary.detail));
  const caveats=presentationCaveats(state.row);if(caveats)title.append(caveats);
  if(summary.recommendation){
    title.append(el("p",summary.recommendation.text,{class:"recommended-fill","data-testid":"recommended-fill","data-candidate-id":summary.recommendation.id}),button("Inspect recommended fill",()=>{selectCandidate(summary.recommendation.id);stagePosition("05");}));
  }else if(summary.task==="redaction"){
    title.append(el('strong','No evidence-backed fill',{class:'abstain-label','data-testid':'no-backed-fill'}),el("strong","ABSTAIN from a corpus-backed fill",{class:"abstain-label","data-testid":"corpus-abstention"}));
    const first=summary.units[0];
    if(first?.kind==='context')title.append(el('p','Exploratory lead: '+first.text,{class:'exploratory-lead','data-testid':'exploratory-lead','data-candidate-id':first.id}),note('The top-ranked contextual candidate is a lead to investigate, not an asserted answer or a recommendation as fact.','exploratory-lead-scope'));
  }
  host.append(title);
  if(!summary.available)return host;
  const labels={supported:summary.task==="hypothesis"?"Supported by eligible evidence":casebookTask(summary.task)==="reconstruction"?"Evidence-backed":"Backed fills",opposed:summary.task==="hypothesis"?"Opposed by eligible evidence":"Opposed",mixed:"Conflicting witnesses",context:"Context",partial:"Partial",conflict:"Conflicting",incompatible:"Not viable",unresolved:casebookTask(summary.task)==="reconstruction"?"Insufficient":"Unresolved"};
  const chart=el("div",null,{class:"verdict-counts"}),bar=el("div",null,{class:"verdict-category-bar",role:"img","data-testid":"verdict-count-bar","aria-label":Object.entries(summary.counts).map(([kind,n])=>`${labels[kind]} ${n} of ${summary.total}`).join("; ")});
  for(const unit of summary.units)bar.append(el("span",null,{"data-kind":unit.kind,title:`${unit.text}: ${unit.label}`}));
  const legend=el("div",null,{class:"verdict-count-legend"});
  for(const [kind,count] of Object.entries(summary.counts))legend.append(el("span",`${labels[kind]} ${count}/${summary.total}`,{"data-kind":kind}));
  chart.append(el("h3",summary.task==="redaction"?"Candidates in this reading":"Required assertions"),bar,legend,note("One segment per "+(summary.task==="redaction"?"candidate":"required assertion")+". Categories and counts, not confidence or correctness probabilities."));host.append(chart);
  if(summary.task!=="redaction"){
    const units=el("ol",null,{class:"verdict-assertions"});
    for(const unit of summary.units){const row=el("li",null,{"data-testid":"verdict-assertion","data-atom-id":unit.id,"data-kind":unit.kind});row.append(el("span",unit.text),el("strong",unit.label));const qualified=mainQualifiedAccount(unit.unit);if(qualified)row.append(qualified);units.append(row);}host.append(units);
  }
  if(summary.task==='reconstruction'){
    const backed=summary.units.filter(unit=>unit.kind==='supported'),citations=backed.flatMap(unit=>list(unit.unit?.requirements).flatMap(fact=>list(fact.evidence).flatMap(witness=>list(witness.citations))));
    if(citations.length){
      const documents=new Set(citations.map(c=>c.document_id).filter(Boolean)),unknown=citations.some(c=>!c.document_id);
      host.append(el('p',`${backed.length} evidence-backed required assertions draw on ${documents.size} ${unknown?'identified ':''}unique source document${documents.size===1?'':'s'}. Multiple assertions from the same document are not independent corroboration.${unknown?' Some citation document identities are unavailable; this count is incomplete.':''}`,{class:'notice','data-testid':'reconstruction-source-scope'}));
    }
  }
  if(summary.total<2&&summary.task!=="redaction")host.append(note("Only one required assertion is recorded; no additional assertion is invented."));
  host.append(note(sourceScopeText()+" Missing evidence is not a negative historical finding."));
  return host;
}
function refreshLocalVerdict(){
  const current=$("[data-testid=local-verdict-panel]");if(current&&state.saved)current.replaceWith(localVerdictPanel());
}
function newDecision(item) {const unit=unitFor(decisionPacket(),item,state.row?.case.task);return unit?{...unit,task:state.row.case.task}:null;}
function newDecisionBadge(unit) {const node=badge(decisionLabel(unit,state.row?.case.task),unit?.status==="evidence_backed_suggestion"?"supported":unit?.status==="incompatible_not_viable"?"against":"inferred");node.dataset.testid="new-local-status";node.dataset.decisionStatus=unit?.status||"unavailable";return node;}
function checkList(checks,context=null) {
  const ul=el("ul",null,{class:"sufficiency-checks","data-testid":"sufficiency-checklist"});
  for(const check of list(checks)){const li=el("li",null,{"data-check-state":check.state}),label=({pass:"Pass",missing:"Missing",conflict:"Conflict",resolved:"Resolved",opposed:"Opposed"})[check.state]||"Unresolved";
    const inspect=button("",()=>decisionCheckDrawer(check,context),"decision-check-button",{"data-testid":"inspect-decision-check","aria-label":`${label}: ${check.label}. Inspect why and source citations`});
    inspect.append(el("strong",label),el("span",check.label));li.append(inspect);ul.append(li);}return ul;
}
function sourceQualificationNotes(value={}){
  const notes=[];
  if(value.scope==='HISTORICAL_ROLE_ASCRIPTION'||value.qualified_scope==='HISTORICAL_ROLE_ASCRIPTION'||
      value.evidence_semantics==='HISTORICAL_SOURCE_ASCRIPTION_NOT_CASE_DATE_ROLE_TRUTH'||value.no_current_tenure===true)
    notes.push('Historical source ascription only: this does not establish tenure at the question date or certify the role as world truth.');
  if(value.source_identification_only===true)notes.push('The source identifies a role; this alone does not establish appointment, continuous tenure or unrelated actions.');
  if(value.actual_inner_event_established===false)notes.push('The underlying event is not established by this account. This is not a finding that it did not occur.');
  if(value.continuous_tenure_established===false)notes.push('Continuous tenure is not established.');
  if(value.purpose_or_requested_goal_performed===false)notes.push('Completion of a stated purpose or requested goal is not established.');
  if(value.source_qualifications?.event_clock_unresolved===true)notes.push('Event time remains unresolved; the source publication date is not substituted for an event date.');
  return [...new Set(notes)];
}
function qualifiedAccountEntries(unit){
  const entries=[];
  for(const account of list(unit?.qualified_accounts)){
    if(!account||typeof account!=='object')continue;
    const text=typeof account.text==='string'?account.text:typeof account.wording==='string'?account.wording:null;
    if(!text?.trim())continue;
    const boundRequirements=list(unit.requirements).filter(fact=>account.claim_binding_id&&fact.claim_binding_id===account.claim_binding_id);
    const boundEvidence=[...list(unit.evidence),...list(unit.requirements).flatMap(fact=>list(fact.evidence))].filter(witness=>account.claim_binding_id&&witness.claim_binding_id===account.claim_binding_id);
    const valid=!(account.atom_id&&account.atom_id!==unit.id||account.claim_binding_id&&!boundRequirements.length&&!boundEvidence.length);
    entries.push({account,text,boundRequirements,boundEvidence,valid});
  }
  return entries;
}
function qualifiedAccountSummary(unit){
  const task=state.row?.case.task;
  if(!['hypothesis','reconstruction'].includes(task)||assertionDecision(unit,task).kind!=='supported')return null;
  const entry=qualifiedAccountEntries(unit).find(value=>value.valid);if(!entry)return null;
  const historical=entry.account.scope==='HISTORICAL_ROLE_ASCRIPTION'||entry.account.no_current_tenure===true||entry.boundRequirements.some(fact=>fact.qualified_scope==='HISTORICAL_ROLE_ASCRIPTION');
  return {label:historical?'Historical source identification':'Source-qualified account',text:entry.text};
}
function mainQualifiedAccount(unit){
  const summary=qualifiedAccountSummary(unit);if(!summary)return null;
  const line=el('p',null,{class:'note source-qualified-summary','data-testid':'source-qualified-summary'});
  line.append(el('strong',summary.label+': '),document.createTextNode(summary.text));return line;
}
function qualifiedAccountsPanel(unit){
  if(!['hypothesis','reconstruction'].includes(state.row?.case.task)||!list(unit?.qualified_accounts).length)return null;
  const host=el('section',null,{class:'path-card','data-testid':'qualified-source-accounts'});
  host.append(heading('Source-qualified account'),note('Saved source-qualified account and scope, not independent world-truth verification. The evidence decision above is unchanged.','notice'));
  for(const {account,text,boundRequirements,boundEvidence,valid}of qualifiedAccountEntries(unit)){
    if(!valid){host.append(note('This saved account does not bind to this assertion; its wording is not presented here.','notice'));continue;}
    const item=el('article',null,{'data-testid':'qualified-source-account'});
    item.append(el('p',text,{class:'cue','data-testid':'qualified-source-account-text'}));
    for(const scope of new Set([...sourceQualificationNotes(unit),...sourceQualificationNotes(account),...boundRequirements.flatMap(sourceQualificationNotes),...boundEvidence.flatMap(sourceQualificationNotes)]))item.append(note(scope,'notice'));
    const citations=list(account.citations).length?account.citations:[...boundEvidence,...boundRequirements.flatMap(fact=>list(fact.evidence))].flatMap(witness=>[...list(witness.citations),...(witness.citation?[witness.citation]:[])]);
    if(citations.length)item.append(groupedSources(citations,'Account-bound original quotation'));
    else item.append(note('No separate account-bound quotation is supplied here; the assertion source records remain available below.'));
    host.append(item);
  }
  return host;
}
function decisionCheckDrawer(check,context){
  const recorded=list(context?.checklist||context?.checks).find(value=>value.id===check.id);
  const body=box(heading(check.label),fields([["Displayed result",check.state],["Recorded check",recorded?.state??check.state]]),note(check.detail||"No check-specific explanation was supplied.","notice"));
  const qualified=qualifiedAccountsPanel(context);if(qualified)body.append(qualified);
  else for(const scope of sourceQualificationNotes(context||{}))body.append(note(scope,'notice'));
  const direct=list(check.citations);if(check.citation)direct.push(check.citation);
  let witnesses=list(context?.citations);
  witnesses.push(...list(context?.evidence).flatMap(value=>list(value.citations)),...list(context?.requirements).flatMap(fact=>list(fact.evidence).flatMap(value=>list(value.citations))));
  if(!context)witnesses=verdictSummary(state.saved,state.row.case,state.reading).units.flatMap(value=>list(value.unit?.requirements).flatMap(fact=>list(fact.evidence).flatMap(e=>list(e.citations))));
  body.append(heading(direct.length?"Check-bound source quotations":"Recorded witnesses in this scope"));
  if(!direct.length)body.append(note("No separate per-check citation binding is supplied. The following are this scope's recorded witnesses, not additional evidence or a new entailment judgment."));
  const proofs=direct.length?direct:witnesses;
  if(proofs.length)body.append(groupedSources(proofs,"Exact recorded source quotation"));
  else body.append(note("No exact source citation is recorded for this check. Missing evidence is not filled from nearby context."));
  if(recorded&&recorded.state!==check.state)body.append(note("The displayed hypothesis outcome distinguishes opposition from positive-claim coverage. The recorded positive-coverage check has not been rewritten."));
  openDrawer("Evidence check","Why this check passes, fails or remains unresolved",body);
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
  if(decisionPacket()?.pool_replay?.applied)host.append(note(`Checks use ${decisionPacket().pool_replay.inspected_pages} inspected pages, not an exhaustive corpus search. Source relevance and substantive support remain separate.`,"notice"));
  if(state.row.case.task==="reconstruction")host.append(note("Requirement coverage: "+unit.coverage,"derived-coverage"));
  const opposed=state.row.case.task==="hypothesis"&&assertionDecision(unit,"hypothesis").kind==="opposed";
  if(unit.counterevidence)host.append(note(opposed?"Eligible same-scoped opposing evidence resolves this assertion as opposed, not missing. It does not establish the positive claim.":"Same-scoped counterevidence is present. This warning is separate from coverage.","contradiction-warning"));
  if(compact){host.append(button("Decision checks and what would suffice",()=>decisionDrawer(unit),"",{"data-testid":"decision-checks"}));return host;}
  const qualified=qualifiedAccountsPanel(unit);if(qualified)host.append(qualified);
  const checks=opposed?list(unit.checklist).map(check=>["facts","conflicts"].includes(check.id)?{...check,state:"opposed",label:check.id==="facts"?"Same-scoped opposing evidence":"Hypothesis opposition resolved",detail:"Eligible opposing evidence resolves the assertion without establishing its positive claim."}:check):unit.checklist;
  host.append(checkList(checks,unit));
  for(const fact of list(unit.requirements)){
    const detail=el("details",null,{class:"sufficiency-fact"});detail.append(el("summary",`${fact.kind==="PROPERTY"?"Property":"Requirement"}: ${fact.predicate}${list(fact.actors).length?" / "+fact.actors.join(" + "):""} / ${state.row.case.task==="hypothesis"?"Positive-claim coverage: ":""}${fact.coverage}${fact.counterevidence?" / Counterevidence present":""}`),checkList(fact.checks,fact));
    for(const scope of sourceQualificationNotes(fact))detail.append(note(scope,'notice'));
    if(list(fact.evidence).length)detail.append(compactEvidence(fact.evidence,{label:"Typed witnesses",render:witness=>box(
      el("h4",witness.direction+" / "+(witness.adapter==="EXPLICIT_DEFINITE_NP_PROPERTY/6.5"?"Focal property recheck":"Typed source comparison")),
      note(witness.derivation_note||witness.explanation||"Raw eligible source witness; no key or grade used."),...sourceQualificationNotes(witness).map(scope=>note(scope,'notice')),checkList(witness.checks,witness),groupedSources(witness.citations,"Rechecked raw source"))}));
    if(list(fact.context_citations).length){const context=el("details");context.append(el("summary","Context only / not substantive proof"),groupedSources(fact.context_citations));detail.append(context);}
    detail.append(note(fact.aggregation));host.append(detail);
  }
  host.append(heading(opposed?"Scope of this decision":"What would suffice"));
  if(opposed)host.append(note("This assertion is resolved by opposing evidence. Other assertions, event truth, dates and causal links require their own evidence."),positiveCoverageAudit(unit));
  else for(const text of list(unit.what_would_suffice))host.append(note(text));
  host.append(note("These bounded source checks do not use the hidden answer, review grades or a confidence threshold.","note"));return host;
}
function positiveCoverageAudit(unit){
  const audit=el("details",null,{class:"method-audit","data-testid":"positive-coverage-audit"});
  audit.append(el("summary","Recorded positive-claim coverage diagnostics"),note("These unchanged checks concern support for the positive claim, not whether opposition resolves the hypothesis."),checkList(unit.checklist,unit));
  for(const text of list(unit.what_would_suffice))audit.append(note(text));return audit;
}
function decisionDrawer(item) { const unit=item?.checklist?item:newDecision(item);openDrawer("Evidence checks","Recorded source criteria",sufficiencyPanel(unit)); }
function localDecisionPanel(candidate) {return sufficiencyPanel(newDecision(candidate));}
function renderDecisionGuide() {
  const host=$("#derived-decision-guide-v65");if(!host)return;host.replaceChildren();
  const item=selectedItem(),unit=newDecision(item),section=el("section",null,{class:"derived-decision-guide","data-testid":"derived-decision-guide"});
  section.append(heading("Check the source support"));
  if(item)section.append(note("Selected item: "+formatTargetText(item,state.row.case.task)),newDecisionBadge(unit),button("Inspect the derived decision",()=>decisionDrawer(item)));
  host.append(section);
}
function taskReadout(host,result) {
  const required=new Set(verdictSummary(state.saved,state.row.case,state.reading).units.map(a=>a.id)),atoms=list(result.atoms).filter(a=>required.has(a.id));host.append(note("Each required assertion is assessed separately. Only evidence-backed components may be reconstructed; unresolved facts remain gaps."));
  for(const atom of atoms){const unit=newDecision(atom),card=el("article",null,{class:"atom-card","data-testid":"result-atom","data-atom-id":atom.id});
    card.append(el("h3",atom.text||atom.source_quote),sufficiencyPanel(unit,{compact:true}));
    const qualified=mainQualifiedAccount(unit);if(qualified)card.append(qualified);
    if(unit){const sources=list(unit.requirements).flatMap(f=>list(f.evidence).flatMap(e=>list(e.citations)));if(sources.length)card.append(groupedSources(sources,"Rechecked raw source"));}
    card.append(button("Inspect assertion and sources",()=>atomDetail(atom),"",{"data-testid":"atom-detail"}));host.append(card);
  }
  if(!atoms.length)host.append(note("No executed atom records were published; no new requirements are fabricated.","empty"));
  host.append(button("Original output / audit",frozenAuditDrawer,"",{"data-testid":"frozen-native-audit"}));
}
function frozenAuditDrawer() {
  const r=state.saved.result||{},audit=publicAuditNotice(),body=box(note(audit?"Saved public inference output and recorded reviews, not the complete native checkpoint. These fields are not the separate evidence-decision supplement.":"Unchanged original native output and its original LLM review. These fields are not the V6.5 decision supplement.","notice"),audit?note(audit,"notice"):null,verdictOverview(r));
  if(state.row.case.task!=="redaction"){nativeTaskReadout(body,r);renderTaskAssembly(body,r[state.row.case.task]||{});}
  else for(const candidate of candidates())body.append(el("h3",candidate.fill),recordedLocalDecisionPanel(candidate));
  if(typeof state.report.assessment_note==="string")body.append(note(state.report.assessment_note));
  const commentary=r.analyst_digest||state.saved.analyst_digest;
  if(hasRequestedAnalystDigest(commentary))body.append(rawInspector(commentary,"Original saved analyst commentary / historical record"));
  openDrawer("Frozen native output / audit","Original record / never relabelled V6.5",body);
}
function renderResultBodyAudit() {
  const host=$("#result-body");if(!host||!state.saved)return;host.replaceChildren();
  const result=state.saved.result||{};refreshLocalVerdict();
  const failure=failureReceipt();if(failure)host.append(failure);
  if(state.row.case.task!=="redaction"){
    taskReadout(host,result);
    return;
  }
  const rows=readingRows(),entry=currentReading(),controls=el("div",null,{class:"result-controls"});
  if(rows.length){
    const branch=state.arm==='B',total=rows.reduce((n,row)=>n+list(row.candidates).length,0),empty=rows.filter(row=>!list(row.candidates).length).length;
    controls.append(el("strong",(branch?'Active branch: ':"Active reading: ")+(entry?.reading?.id||"not supplied"),{"data-testid":"active-reading"}),button(branch?'Change branch in Stage 02':"Change reading in Stage 02",()=>{stagePosition("02");$("[data-testid=plan-reading-select]")?.focus({preventScroll:true});},"",{"data-testid":"change-reading-link"}),el('p',`${candidates().length} displayed alternatives in this ${branch?'branch':'reading'}; ${total} saved across ${rows.length} ${branch?'branches':'readings'}${empty?` (${empty} empty)`:''}. Counts are not a matched search budget.`,{class:'note','data-testid':'reading-candidate-counts'}));
  }else controls.append(badge("No saved reading rows"));
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
    if(currentRedactionReview()){const review=independentCandidateReview(candidate);if(review)card.append(review);}
    else if(candidate.assessment){const review=llmReview(candidate,"redaction"),grade=el("details",null,{class:"grade-line","data-testid":"candidate-grade"});grade.append(el("summary","Separate post-run review / not the local verdict"),el("span","Answer correctness: "+review.correctness),el("span","Evidence review: "+review.evidence),el("span","Grammar review: "+review.grammar));card.append(grade);}
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
function renderFindingsAudit() {
  const s=stage("06","Review the evidence","Scope and limitations","review"),r=state.saved.result||{};
  s.body.append(sufficiencyOverview());
  const hasPresentationReview=state.saved.presentation_decision_assessment!=null;
  s.body.append(currentRedactionReview()?independentReviewPanel():!hasPresentationReview&&state.gateReview?.status==="complete"?exactGateReviewPanel():presentationDecisionOpinionPanel());
  const reviewAudit=el("details",null,{class:"method-audit"});reviewAudit.append(el("summary","Original execution audit"),
    note("The original execution and its historical reviews are available in the saved-output audit. They do not assess the evidence decision displayed here."),
    button("Inspect original saved output",frozenAuditDrawer,"",{"data-testid":"frozen-native-audit"}));s.body.append(reviewAudit);
  if(state.row.case.task==="redaction"){
    const displayed=currentReading();
    s.body.append(note(`Reviewing the active reading ${state.reading}. Change it only in Stage 02.`));
    const proposals=list(displayed?.candidates).slice(0,5);
    for(const [i,c] of proposals.entries()){
      const row=el("details",null,{class:"review-row","data-proposal-id":c.id});row.append(el("summary",`${i+1} / ${short(c.fill,10)} / ${decisionLabel(newDecision(c))}`),localDecisionPanel(c));
      const local=c.local_reference_comparison||c.post_unmask_comparison;
      if(state.reference&&local)row.append(heading("Separate local post-unmask comparison"),fields([["Exact comparison",local.label??local.status??local.exact_match],["Comparison method",local.method]]),note("This is only the supplied local comparison, not semantic correctness."));
      row.append(groupedSources(c.sources));s.body.append(row);
    }
    if(!state.reference)s.body.append(note("The reference remains masked. No local answer-key comparison is displayed."));
  }else{
    const atoms=list(r.atoms);
    for(const atom of atoms){const details=el("details",null,{class:"review-row","data-atom-id":atom.id});details.append(el("summary",(atom.text||atom.id)+" / "+decisionLabel(newDecision(atom))),sufficiencyPanel(newDecision(atom)),button("Inspect frozen atom",()=>atomDetail(atom)));
      s.body.append(details);}
    s.body.append(note("Unestablished requirements remain unknown, not counterevidence. Event dates and causal bridges require their own facts."));
  }
  s.body.append(note("These curated examples illustrate successes and limits; they are not an accuracy estimate."));
  if(state.saved.native_checkpoint)reviewAudit.append(button("Inspect saved inference receipt",async()=>{
    const epoch=openDrawer("Saved inference receipt","Original native fields / unchanged",note("Loading the pinned receipt..."));
    try{const value=await getJSON("/api/native-v6?"+caseQuery());if(epoch===state.drawerEpoch)$("#detail-body").replaceChildren(rawInspector(value,"Original saved record fields"));}catch(error){if(epoch===state.drawerEpoch)$("#detail-body").replaceChildren(note(error.message,"error-card"));}
  }));
  return s.outer;
}

function sufficiencyOverview() {
  const packet=decisionPacket(),task=state.row.case.task,overall=overviewFor(packet,task,state.reading),host=el("section",null,{class:"verdict-overview sufficiency-overview","data-testid":"sufficiency-overview"});
  host.append(heading("Evidence by assertion"));
  const grid=el("div",null,{class:"verdict-grid"}),local=el("section",null,{class:"verdict-native"});
  local.append(newDecisionBadge(overall),note(packet?"Decisions use the recorded source checks, not rank scores, answer keys or review grades.":"A bound evidence decision is not available."));
  if(packet?.pool_replay?.applied)local.append(note(`Evidence checks cover ${packet.pool_replay.inspected_pages} inspected pages, not every eligible document. This view does not change the source search or candidate ranks.`,"notice"));
  if(overall?.conclusion)local.append(note(overall.conclusion,"notice"));
  const required=new Set(verdictSummary(state.saved,state.row.case,state.reading).units.map(a=>a.id));
  const items=task==="redaction"?candidates():list(state.saved?.result?.atoms).filter(a=>required.has(a.id));
  for(const item of items){const unit=newDecision(item),row=el("div",null,{class:"verdict-unit","data-testid":"derived-unit-verdict"});row.append(el("strong",item.fill||item.text||item.id),newDecisionBadge(unit));
    if(task==="reconstruction"&&unit)row.append(note("Coverage: "+unit.coverage));
    if(task==="hypothesis"&&unit){const counts=["Support","Counterevidence","Partial"].map(direction=>{const docs=new Set(list(unit.requirements).flatMap(f=>list(f.evidence).filter(e=>e.direction===direction).flatMap(e=>list(e.citations).map(c=>c.document_id))));return `${direction}: ${docs.size} source documents`;});row.append(note(counts.join("; ")+". Distinct provenance, not independent votes."));}
    if(unit?.counterevidence)row.append(badge("Counterevidence present","against"));
    row.append(button("Inspect criteria",()=>decisionDrawer(item)));local.append(row);
  }
  const resolution=hypothesisReadout(state.saved,state.row.case);
  if(resolution){
    local.append(note(resolution.detail,"notice"));
    const checks=checkList(resolution.checks);checks.dataset.testid="hypothesis-resolution-checklist";local.append(checks,note(resolution.guidance,"notice"));
    if(resolution.otherFailures)for(const text of list(overall?.what_would_suffice))local.append(note(text));
    if(overall&&resolution.opposed)local.append(positiveCoverageAudit(overall));
  }else if(overall){if(overall.counterevidence)local.append(note("Counterevidence is present. No absent requirement has been counted as opposition.","contradiction-warning"));if(task!=="redaction")local.append(checkList(overall.checklist));for(const text of list(overall.what_would_suffice))local.append(note(text));}
  grid.append(local);host.append(grid);return host;
}

function exactGateReviewPanel() {
  const panel=el("section",null,{class:"grade-panel","data-testid":"exact-gate-review","data-review-panel":"postrun","data-review-status":"verified"}),review=state.gateReview,packet=decisionPacket(),task=state.row.case.task;
  panel.append(heading("Post-run opinion"));
  if(review?.status!=="complete"){
    panel.dataset.reviewStatus="unavailable";panel.append(note("A matching opinion attachment is unavailable for this displayed decision."));return panel;
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

function presentationDecisionOpinionPanel(){
  const review=presentationDecisionReview(state.saved),packet=decisionPacket(),task=state.row.case.task;
  const panel=el("section",null,{class:"grade-panel","data-testid":"presentation-decision-opinion","data-review-panel":"postrun","data-review-status":review.status});
  panel.append(heading("Post-run opinion"));
  if(review.status!=="verified"){
    const message=note(review.reason||`Post-run opinion is pending for ${ARMS[state.arm].name}. The local evidence decision is unchanged.`);
    if(review.status==="pending")message.dataset.testid="postrun-review-pending";
    panel.append(message);return panel;
  }
  panel.append(badge("VERIFIED","review"),note("The attachment matches this displayed evidence decision. It is a post-run opinion, not the local decision or independent historical verification.","notice"));
  const opinions=review.grades.filter(row=>task!=="redaction"||row.reading_id==null||row.reading_id===state.reading);
  for(const row of opinions){
    const unit=packet.atoms?.[row.decision_id]||packet.candidates?.[row.decision_id],grade=row.grade;
    const details=el("details",null,{class:"review-row","data-testid":"presentation-opinion-item","data-decision-id":row.decision_id||"overall"});
    details.append(el("summary",`${row.scope==="overall"?"Whole question":unit?.text||row.decision_id} / reviewer opinion`),
      fields([["Reviewer judgment",displayText(grade.judgment)],["Quoted evidence opinion",displayText(grade.evidence_support)]]),
      note(displayText(grade.explanation)||"No explanation supplied."));panel.append(details);
  }
  if(!opinions.length)panel.append(note("No opinion is attached for the active interpretation. Another interpretation's opinion is not substituted."));
  const binding=el("details",null,{class:"method-audit"});binding.append(el("summary","Opinion attachment details"),
    fields([["Decision version",review.gate_version,true],["Committed decision SHA-256",review.gate_sha256,true]]),
    note("The backend verifies the immutable attachment at build time. This display checks its bound hash and version; it does not change source eligibility, assertion counts, recommendations or ranks."));
  panel.append(binding);return panel;
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
    if(currentRedactionReview())judge.append(note('Independent insertion reviews are separate from this unchanged native audit. Inspect the independent review after explicitly unmasking the reference.'));
    else{
      judge.append(note("Key-aware reference-answer correctness is a post-run LLM grade, not a local selection or factual-support gate. Its evidence and grammar reviews are separate advisory judgments, not independent human validation."));
      for(const [i,c] of proposals.entries()){const review=llmReview(c,"redaction");judge.append(note(`${i+1}. ${c.fill}: correctness ${review.correctness||review.summary}; LLM evidence review ${review.evidence||"Not recorded"}; grammar ${review.grammar||"Not recorded"}`,"llm-candidate-verdict"));}
    }
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
  if(currentRedactionReview())return independentCandidateReview(item,{expanded:true});
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
  const binding=currentBinding(c.case_id,c.corpus),key=canonicalGateJSON([c.case_id,proof.canonical_page_id,binding?ARMS[state.arm].key:null,binding||null,selectedSourceScope(c),state.saved?.native_checksum]);
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
  const copy=el("span",readable(proof.text||"Inspect source")),status=el("small",proof.date||'',{class:"context-status"});
  b.append(copy,status);
  const c={...state.row.case};
  b.loadContext=async()=>{
    try{
      const context=await citationContext(proof,c);
      if(!b.isConnected)return;
      const highlighted=highlightedText(context.text,context.anchors,{class:"citation-context","data-testid":"citation-paragraph"});
      copy.replaceWith(highlighted);status.textContent=proof.date||'';
    }catch{if(b.isConnected)status.textContent="Saved quotation only / paragraph context could not be verified. Open source details to inspect.";}
  };
  citationObserver.observe(b);return b;
}
async function sourceDrawer(value,{back}={}) {
  if(!allowPrivileged(()=>sourceDrawer(value,{back})))return;
  const proof=proofOf(value);if(!proof?.canonical_page_id)return;
  const c={...state.row.case};const epoch=openDrawer("Original source","Pinned evidence / raw text",note("Loading original text and verifying the quotation..."),back);
  sourceRequest=new AbortController();
  try {
    const data=await getJSON("/api/source-v6?"+new URLSearchParams({case_id:c.case_id,source_id:proof.canonical_page_id}),{signal:sourceRequest.signal});
    const page=data.page||data;
    if(epoch!==state.drawerEpoch||!$("#detail-drawer").open)return;
    if(typeof page.text!=="string"||(page.canonical_page_id||page.id)!==proof.canonical_page_id)throw Error("The source identity does not match the saved citation.");
    if(!sourceWithinScope(page,c))throw Error("This page violates the selected case's source cutoff or origin policy.");
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
    const body=box(el('p',`${page.title||page.document_id} / ${page.date}`,{class:'source-document-meta'}));
    const technical=el('details',null,{class:'source-technical'});technical.append(el('summary','Source details'),fields([["Document",page.document_id,true],["Source date",page.date],["View",c.corpus==="cib"?"Earlier-visible CIB":"Bound CONFIDENTIAL evidence"],["Canonical page",proof.canonical_page_id,true]]),note(verified?'Exact quotation and source hash verified.':'Source hash verified; no localized quotation was supplied.'));
    const caseControl=originalCaseControl(body);if(caseControl)technical.append(caseControl);
    technical.append(link("View source on KG",graphURL({source_id:proof.canonical_page_id}),"button"),note(Array.isArray(data.document_pages)?`${additional.length+1} independently verified supplied segments. This inventory does not certify original-format completeness.`:'Only one source segment is supplied; other pages are unavailable.'));
    body.append(technical);
    const supplied=list(data.document_pages),ordered=supplied.length?supplied.filter((p,i,all)=>all.findIndex(q=>(q.canonical_page_id||q.id)===(p.canonical_page_id||p.id))===i):[page];
    if(!ordered.some(p=>(p.canonical_page_id||p.id)===proof.canonical_page_id))ordered.unshift(page);
    const physical=p=>c.corpus==="cib"?(p.earlier_page??p.physical_page??((p.canonical_page_id||p.id)===proof.canonical_page_id?proof.earlier_page:undefined)):p.physical_page;
    if(ordered.every(p=>Number.isInteger(physical(p))&&physical(p)>0))ordered.sort((a,b)=>physical(a)-physical(b));
    const transcript=el("div",null,{class:"document-transcript"});
    for(const [index,segment] of ordered.entries()){
      const selected=(segment.canonical_page_id||segment.id)===proof.canonical_page_id,number=physical(segment),known=Number.isInteger(number)&&number>0;
      const section=el("section",null,{class:"transcript-segment","data-source-id":segment.canonical_page_id||segment.id,"data-source-selected":String(selected)});
      section.append(el("h3",`${known?"Page "+number:"Logical segment "+(index+1)} / ${segment.document_id}`,{class:"transcript-boundary","data-testid":"transcript-boundary","data-boundary-kind":known?"physical-page":"logical-segment"}));
      const highlights=selected&&verified?[exactSourceAnchor(segment.text,proof)]:[];
      if(selected&&verified){section.dataset.proofStart=String(proof.start);section.dataset.proofEnd=String(proof.end);section.dataset.proofHash=proof.page_sha256;}
      section.append(highlightedText(segment.text,highlights,{class:"source-document transcript-text","data-testid":selected?"source-document":"additional-source-segment"}));transcript.append(section);
    }
    body.append(transcript);
    if(c.corpus==='cib'){
      try{await appendCIBPDFPair(body,{page,proof,binding:currentBinding(c.case_id,c.corpus),caseId:c.case_id,config:ARMS[state.arm].key});}
      catch{body.append(note('PDF page locators could not be verified. The exact source text remains available.'));}
    }
    if(epoch!==state.drawerEpoch||!$('#detail-drawer').open)return;
    $("#detail-body").replaceChildren(body);
    scrollToSource();
  }catch(error){if(epoch===state.drawerEpoch&&error.name!=="AbortError")$("#detail-body").replaceChildren(note(error.message,"error-card"));}
}

function sourceWithinScope(page,c){
  const scope=selectedSourceScope(c);
  if(c.corpus==='cib'&&!scope.whole_origin_excluded&&page.document_id===c.document_id&&
      !['earlier','both'].includes(String(page.visibility||page.release||page.native_page?.view||'').toLowerCase()))return false;
  return sourceScopeAllows(page,scope);
}
function selectedSourceScope(c){
  const row=catalogCases().find(row=>row.case.case_id===c.case_id),reportItem=row?.configurations?.[ARMS[state.arm].key];
  return workbenchSourceScope(c,{reportItem,condition:state.saved,liveScope:livePacket?.source_scope});
}
function sourceScopeText(){
  const scope=selectedSourceScope(state.row.case),date=scope.on_or_before||scope.strictly_before;
  return `Inspected sources ${scope.on_or_before?'on or before':'before'} ${date}. `+
    (scope.whole_origin_excluded?'The whole origin document is excluded.':'Only earlier/both CIB release text is eligible, including the origin when admitted by this saved view.');
}
async function verifySourcePage(page,c) {
  if(typeof page.text!=="string"||!(page.canonical_page_id||page.id))throw Error("A source segment has no replayable text or identity.");
  if(!sourceWithinScope(page,c))throw Error("This page violates the selected case's source cutoff or origin policy.");
  if(page.permitted===false||page.visibility==="later"||c.corpus!=="cib"&&page.classification&&page.classification!=="CONFIDENTIAL"||list(page.handling).includes("NOFORN"))throw Error("This page is outside the bound evidence policy.");
  const serialized=JSON.stringify(page.text).replace(/[\u007f-\uffff]/g,char=>"\\u"+char.charCodeAt(0).toString(16).padStart(4,"0"));
  const hash=await sha256(new TextEncoder().encode(serialized));
  if(hash!==(page.source_sha256||page.page_sha256))throw Error("The original source failed its integrity check. No verified highlight is shown.");
  return hash;
}

async function nodeDrawer(value,{navigation=true}={}) {
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
  if(livePacket){
    const traceSteps=list(livePacket.trace.steps).filter(step=>list(step.nodes).some(n=>n.id===id));
    const refs=uniqueProofs(traceSteps.flatMap(step=>list(step.source_refs)));
    const body=box(note(node.label||'Recorded source object'));
    for(const proof of refs)body.append(sourceButton(proof));
    if(!refs.length)body.append(note('No exact source quotation was retained for this object.'));
    openDrawer('Source object','Live execution',body);return;
  }
  const c={...state.row.case},epoch=openDrawer(node.label||"Source-connected node","Case-scoped knowledge graph",note("Loading eligible source connections..."));
  try{
    const data=await getJSON("/api/node-v6?"+new URLSearchParams({case_id:c.case_id,node_id:id}));
    if(epoch!==state.drawerEpoch||!$("#detail-drawer").open)return;
    const scope=selectedSourceScope(c);
    if(data.cutoff&&data.cutoff!==c.date||Object.hasOwn(data,'whole_origin_excluded')&&data.whole_origin_excluded!==scope.whole_origin_excluded||
        Object.hasOwn(data,'strictly_before')&&data.strictly_before!==scope.strictly_before||
        Object.hasOwn(data,'on_or_before')&&data.on_or_before!==scope.on_or_before)throw Error("The node view belongs to another source boundary.");
    const body=box();
    if(navigation)body.append(link("View on KG",graphURL({node_id:id}),"button"));
    if(data.scope==="SAVED_DISPLAY_PROJECTION_ONLY"&&typeof data.note==="string"&&data.note.trim())body.append(note(data.note,"notice"));
    const edges=list(data.edges);let count=0;
    const addConnections=()=>{const end=Math.min(count+6,edges.length);for(;count<end;count++){const edge=edges[count],item=el('section',null,{class:'path-card'});item.append(heading(edge.relation||primitive(edge.kind)));for(const proof of uniqueProofs(list(edge.citations)).slice(0,3))item.append(sourceButton(proof));body.append(item);}more.hidden=count>=edges.length;more.textContent=`More connections / ${edges.length-count}`;body.append(more);};
    const more=button('More connections',addConnections,'quiet');addConnections();
    if(!list(data.edges).length)body.append(note(data.scope==="SAVED_DISPLAY_PROJECTION_ONLY"?"No source connections are saved for this node in the displayed projection. The full corpus graph is separate.":"No eligible source edges were returned for this node.","empty"));
    $("#detail-body").replaceChildren(body);
  }catch(error){if(epoch===state.drawerEpoch)$("#detail-body").replaceChildren(note(error.message,"error-card"));}
}

const MODIFIER_CARRIER_TIER="source_owned_local_modifier_carrier";
const MODIFIER_CARRIER_LABEL="Matches the noun being described";
function rankingText(value){return typeof value==="string"?value.replaceAll(MODIFIER_CARRIER_TIER,MODIFIER_CARRIER_LABEL):"";}
function modifierCarrierPanel(candidate){
  const metadata=state.saved?.result?.current_owned_modifier_construction;
  if(state.row.case.task!=="redaction"||state.saved?.current_resource_execution!==true||
      !["current-owned-compound-construction/2","current-owned-compound-construction/2.1"].includes(metadata?.version)||metadata.factual_support_certified!==false||
      packetFor(state.saved,state.row.case)?.version!=="current-evidence-decision/1")return null;
  const features=[candidate.features,candidate.v21_features].filter(value=>value&&Object.hasOwn(value,"current_modifier_carrier_aligned"));
  const records=[candidate.source_fit,candidate.v21_joint_fit].map(value=>value?.current_modifier_checks).filter(Boolean);
  if(!records.length&&!features.length)return null;
  const panel=el("section",null,{class:"path-card","data-testid":"modifier-carrier-check"}),checks=records[0]||{},alignment=checks.alignment||{};
  const consistent=records.every(value=>canonicalSelectionJSON(value)===canonicalSelectionJSON(checks))&&
    features.every(value=>value.current_modifier_carrier_aligned===features[0].current_modifier_carrier_aligned);
  const supported=consistent&&features.length&&records.length&&
    features[0].current_modifier_carrier_aligned===true&&alignment.positive===true&&
    alignment.factual_support_certified===false&&alignment.named_identity_certified===false&&alignment.title_equivalence_certified===false;
  const token=value=>value&&typeof value.text==="string"&&value.text.trim()&&Number.isInteger(value.start)&&
    Number.isInteger(value.end)&&value.start>=0&&value.end>value.start&&Array.from(value.text).length===value.end-value.start;
  const source=alignment.source_carrier,query=alignment.query_carrier,c=state.row.case,parts=c.query.split(c.focal_marker);
  const completed=parts.length===2?parts[0]+candidate.fill+parts[1]:null;
  const queryBound=token(query)&&completed&&Array.from(completed).slice(query.start,query.end).join("")===query.text;
  const citation=list(candidate.sources).map(proofOf).find(proof=>proof?.canonical_page_id===alignment.source_page_id&&
    /^[a-f0-9]{64}$/.test(alignment.source_sha256||"")&&proof.page_sha256===alignment.source_sha256);
  const positive=Boolean(supported&&token(source)&&queryBound&&citation);
  panel.append(heading(positive?MODIFIER_CARRIER_LABEL:"Noun-match context check"));
  if(positive){
    const wording=el("dl",null,{class:"field-list"});
    for(const [label,text]of [["Question noun",query.text],["Recorded source noun",source.text]]){
      const value=el("dd");value.append(el("q",text));wording.append(el("dt",label),value);
    }
    panel.append(wording,note("Positive context priority only. This saved local noun match is not confidence, factual support, owner identity or title equivalence. It does not certify the missing fact.","notice"),
      note("Recorded source wording, not a new source-support verdict. Open the saved span to replay its exact text and source hash."),
      sourceButton({...citation,start:source.start,end:source.end,text:source.text},{back:()=>candidateDetail(candidate)}));
  }else{
    const missing=alignment.positive===false&&features.every(value=>value.current_modifier_carrier_aligned===false);
    panel.append(note(missing?"No positive noun match is recorded. Missing alignment is neutral, not opposing evidence or proof that the candidate is wrong.":
      "The saved noun-match flags, literal spans or source bindings are incomplete or inconsistent. No positive match is interpreted here.","notice"));
  }
  const comparative=checks.comparative;
  if(consistent&&comparative?.applies===true){
    const licensed=new Set(["LICENSED_ADJECTIVAL_PARTICIPIAL_OR_SOURCE_MODIFIER","LICENSED_SOURCE_ATTESTED_NOMINAL_DEGREE"]);
    const label=comparative.omit===false&&licensed.has(comparative.status)?"Comparative wording admitted by the saved local check":
      comparative.omit===true&&comparative.status==="UNLICENSED_NOMINAL_COMPARATIVE_PROPERTY"?"Comparative wording not admitted by the saved local check":"Comparative wording unresolved";
    panel.append(el("h4",label),note("A bounded insertion policy, not a factual verdict, confidence score or general proof of English grammaticality. This display does not admit, omit or reorder candidates."));
  }
  return panel;
}
function candidateDetail(candidate) {
  const support=candidate.support_assessment||{},d=disposition(candidate),body=box(el("blockquote",candidate.fill,{class:"cue"}),badge(decisionLabel(newDecision(candidate))));
  const quotes=uniqueProofs([...list(candidate.sources),...list(support.evidence).map(e=>e.citation).filter(Boolean)]);
  for(const proof of quotes)body.append(sourceButton(proof,{back:()=>candidateDetail(candidate)}));
  if(list(candidate.presentation_variants).length>1){
    const other=el('details');other.append(el('summary',`${candidate.presentation_variants.length} separately assessed source occurrences`));
    for(const variant of candidate.presentation_variants){other.append(heading(decisionLabel(newDecision(variant))));for(const proof of uniqueProofs(variant.sources))other.append(sourceButton(proof,{back:()=>candidateDetail(candidate)}));}
    body.append(other);
  }
  const audit=el('details');audit.append(el('summary','Construction and ranking details'));body.append(audit);
  const detailBody=body; // Main evidence is immediate; the original audit stays available below.
  const auditBody=box(dispositionPanel(candidate));audit.append(auditBody);
  renderCandidateAudit(candidate,support,d,auditBody);
  openDrawer('Candidate',`Recorded local decision`,detailBody);
}
function renderCandidateAudit(candidate,support,d,body){
  body.append(localDecisionPanel(candidate));
  const explanation=displayText(d.explanation||support.explanation);if(explanation)body.append(note(explanation));
  body.append(fields([["Recorded insertion fit",feasibility(candidate).label],["Source identity binding",candidate.support_dimensions?.identity],["Support scope",supportDimensions(candidate).scope]].filter(([,value])=>value!=null)));
  body.append(heading("Original source wording"),el("div",candidate.source_wording||"Not supplied",{class:"raw-text"}));
  const needed=d.needed??support.needed;
  if(needed&&(Array.isArray(needed)?needed.length:true)){body.append(heading("What is still needed"));for(const text of Array.isArray(needed)?needed:[needed])body.append(note(text));}
  const modifier=modifierCarrierPanel(candidate);if(modifier)body.append(modifier);
  const attachment=candidate.focal_visible_attachment_priority;
  if(candidate.context_ordering?.mode==='focal_visible_attachment'&&candidate.local_decision?.status==='exploratory_contextual'&&attachment?.matched===true&&attachment.producer_replayed===true&&attachment.saved_observation_equal===true){
    body.append(heading('Why this position'),note('The saved check associates the complete source role with the exact name visible beside the gap. This rechecked grammatical association comes first within contextual ordering, but does not establish the later action. Evidence-backed and established partial results remain ahead of context.'));
  }else{
    const order=candidate.ranking_explanation||candidate.ranking?.canonical_order;
    if(typeof order==='string'&&order.trim())body.append(heading('Why this position'),note(rankingText(order)));
  }
  const rank=candidate.ranking_comparison;
  if(rank?.criterion_label||rank?.criterion===MODIFIER_CARRIER_TIER)body.append(note(`${rank.criterion===MODIFIER_CARRIER_TIER?MODIFIER_CARRIER_LABEL:rankingText(rank.criterion_label)}: ${primitive(rank.candidate_value)} versus ${primitive(rank.other_value)} for ${rank.other_fill||"the adjacent proposal"}. Ordered relevance, not correctness probability.`));
  if(list(candidate.insertion_edits).length){body.append(heading("Saved insertion edits"));for(const edit of candidate.insertion_edits)body.append(note(edit.explanation||edit.reason||primitive(edit.kind)));}
  body.append(advisory(candidate)||note(currentRedactionReview()?"The independent review is hidden until reference unmask, or is unavailable for this selection.":"No separate post-run review was published."),heading("Source quotations"));
  const seen=new Set();
  for(const source of [...list(candidate.sources),...list(support.evidence).map(e=>e.citation).filter(Boolean)]){
    const key=[source.canonical_page_id,source.start,source.end].join("/");if(seen.has(key))continue;seen.add(key);body.append(sourceButton(source,{back:()=>candidateDetail(candidate)}));
  }
  if(!seen.size)body.append(note("No source quotations were supplied.","empty"));
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
  const qualified=qualifiedAccountsPanel(newDecision(executed));if(qualified)body.append(qualified);
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
  state.filters.corpus=Object.hasOwn(CORPORA,params.get("corpus"))?params.get("corpus"):"";
  state.filters.task=Object.hasOwn(TASKS,params.get("task"))?params.get("task"):"";
  state.arm=Object.hasOwn(ARMS,requestedArm.toUpperCase())?requestedArm.toUpperCase():Object.keys(ARMS).find(k=>ARMS[k].key===requestedArm)||"A";
  $("#arm-select").value=state.arm;state.stage=/^0[1-6]$/.test(params.get("stage")||"")?params.get("stage"):"01";
  if(params.get("view")==="home"){state.epoch++;request?.abort();destroyVisuals();state.projection=null;state.row=null;state.saved=null;state.home=true;state.loading=false;closeDrawer();clearError();renderRail();renderWorkspace();return;}
  state.home=false;
  const id=params.get("case"),matches=id?catalogCases().filter(r=>r.case.case_id===id||r.case.case_id.endsWith("_"+id)):[];
  if(id&&matches.length!==1){state.epoch++;request?.abort();destroyVisuals();state.projection=null;closeDrawer();state.row=null;state.saved=null;state.loading=false;renderWorkspace();renderRail();showError(matches.length?"This case alias is ambiguous. Select its full published identity.":"This question is not in the published casebook. No other case has been substituted.");return;}
  const row=matches[0]||visibleCases()[0];
  if(row){
    if(matches.length){
      if(state.filters.corpus&&state.filters.corpus!==row.case.corpus)state.filters.corpus=row.case.corpus;
      if(state.filters.task&&state.filters.task!==row.case.task)state.filters.task=row.case.task;
    }
    await chooseCase(row,{push,reading:params.get("reading")||"",candidate:params.get("candidate")||"",scroll});
  }else{
    state.epoch++;request?.abort();destroyVisuals();state.projection=null;closeDrawer();state.row=null;state.saved=null;state.loading=false;clearError();renderRail();renderWorkspace();savePosition({push});
    $("#page-state").textContent="No saved questions match these filters. No other case has been substituted.";
  }
}
window.addEventListener("popstate",()=>{viewportAnchor.cancel();navigateFromURL({scroll:false});});
async function mountLiveWorkbench(packet){
  livePacket=packet;state.report=packet.report;state.sourceReport=packet.report;
  state.row=packet.row;state.saved=packet.condition;state.arm='A';state.stage='01';
  state.loading=false;state.pending='';state.epoch++;state.catalog=null;state.casebookPending='';
  [narrativeUI,narrativeAccess,narrativeEndpoints]=await Promise.all([import('./narrative-trace-v1.js'),import('./narrative-attempts-v1.js'),import('./narrative-endpoint-v1.js')]);
  state.casebook={primary:[{case_id:packet.row.case.case_id,corpus:packet.row.case.corpus,task:packet.row.case.task,row:packet.row}],special_redactions:[],backgrounds:{},selection_scope:'live',completed_primary_count:1};
  state.readySingleMethod=true;$('.workspace-toolbar').hidden=true;
  state.reading=initialDisplayReading(state.saved,state.row.case);
  state.candidate=flowItems()[0]?.id||'';
  railDecisionCache.set(railKey(state.row),{record:state.saved});
  renderWorkspace();renderRail();savePosition();await hydrateFlow(state.epoch);
  $('#casebook-notice').hidden=true;
  $('#page-state').textContent=packet.execution_kind==='live'?'Live execution / local evidence decisions.':'Transport test fixture / not an inference.';
}
window.MatryoshkaLiveWorkbench=Object.freeze({mount:mountLiveWorkbench});
try{
  const liveRun=new URLSearchParams(location.search).get('live_run');
  if(liveRun){
    $('#page-state').textContent='Receiving the authenticated Live execution...';
    const {loadWorkbenchRun}=await import('./live-result-adapter.js');
    await mountLiveWorkbench(await loadWorkbenchRun(liveRun));
  }else{
  let selection=null;
  state.sourceReport=await getJSON("/data/report-v6.json",{captureHash:true});
  state.report=state.sourceReport;
  if(!Array.isArray(state.report.cases))throw Error("The publication contains no case catalog.");
  if(isNarrativePublication()){
    [narrativeUI,narrativeAccess,narrativeEndpoints]=await Promise.all([import('./narrative-trace-v1.js'),import('./narrative-attempts-v1.js'),import('./narrative-endpoint-v1.js')]);
    state.manifest=await getJSON('/api/narrative-v1/manifest');
    const health=await getJSON('/api/health');
    narrativeUI.validateManifest(state.manifest,health,state.report,publicationByteHashes.get(state.report));
    narrativeAccess.validatePrivacyContract(state.report);
    verifiedCurrentPublications.add(state.report);state.catalog=null;
    const sheet=el('link',null,{rel:'stylesheet',href:'./narrative-trace-v1.css'});
    document.head.insertBefore(sheet,document.querySelector('link[href="workbench-v6.css"]'));
  }else if(isCurrentPublication()){
    const health=await getJSON('/api/health'),ref=health.report_ref;
    const staticPublication=health.static_publication===true;
    const replay=globalThis.PublicReplay,hasReplay=replay!==null&&['object','function'].includes(typeof replay);
    const sourceRef=health.source_report_ref;
    const sourceLineage=!staticPublication||sourceRef?.path?.startsWith('experiments/current_refresh/publication/')&&
      /^[a-f0-9]{64}$/.test(sourceRef.sha256||'')&&state.report.source_report_ref!=null&&canonicalGateJSON(sourceRef)===canonicalGateJSON(state.report.source_report_ref);
    const publicationPath=staticPublication?hasReplay&&ref?.path==='data/report-v6.json':/^experiments\/(?:current_refresh|stable_release_20261120)\/publication\//.test(ref?.path||'');
    if(health.service!=='current-resource-workbench'||health.live_inference!==false||!publicationPath||!sourceLineage||
        ref.sha256!==publicationByteHashes.get(state.report)||health.cases!==state.report.cases.length||
        state.report.cases.some(row=>row.current_resource_execution!==true||!row.resource_binding)||
        new Set(state.report.cases.map(row=>row.case.case_id)).size!==state.report.cases.length)throw Error('The explicit current publication/server byte pin does not match. No old casebook is substituted.');
    verifiedCurrentPublications.add(state.report);if(staticPublication)staticCurrentPublications.add(state.report);state.catalog=null;
  }else{
    selection=await embeddedShowcaseSelection();
    if(selection&&publicationByteHashes.get(state.report)!==selection.source_report_sha256)throw Error('Saved data failed its integrity check. No result is shown.');
    state.catalog=selectShowcaseCatalog(state.sourceReport,selection,selection?.source_report_sha256);
  }
  if(state.catalog){const note=$("#showcase-curation-note");if(note){note.hidden=false;note.textContent=selection.curation_note||"Curated, outcome-informed demonstrations: one case per fact family across this public casebook, not benchmark accuracy. Other saved records remain archived locally.";}}
  if(state.report.status==="PARTIAL"){const scope=$("#publication-scope");scope.hidden=true;scope.textContent=`Preview: ${state.report.completed_cases??0} saved questions; ${state.report.pending_cases??0} declared questions are pending. This is not the final question selection.`;}
  await loadCasebook();
  await navigateFromURL();
  }
}catch(error){state.catalog=null;state.report=null;state.sourceReport=null;showError(error.message);$("#page-state").textContent="The bound public casebook is unavailable. No archived data has been substituted.";$("#case-view").setAttribute("aria-busy","false");$("#case-view").replaceChildren(note("The explicitly selected publication, reader and server pins must agree before saved questions can be displayed.","empty"));}

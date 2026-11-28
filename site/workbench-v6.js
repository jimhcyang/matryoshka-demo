import {createViewportAnchor} from "./viewport-anchor-v64.js";
import {formatNumber,formatTargetText} from "./flow-layout-v4.js";
import {direction as humanDirection,displayText,coverage as recordedCoverage,localTaskVerdict,factual,feasibility,localDecisions,selectionSummary,llmReview} from "./verdict-v64.js";
import {decisionLabel as nativeDecisionLabel,packetFor,unitFor,overviewFor,reviewDisclosure,guideDisclosure,routeProvenance,exactGateReview,verdictSummary,exactOriginAnchors,sidebarDecisionSummary,decisionSummaryFor,preferredReading,canonicalGateJSON,isCounterhypothesis,presentationDecisionReview,presentationTitle,hasRequestedAnalystDigest,hypothesisReadout,assertionDecision,currentResourceURL,verifyCurrentResourceResponse,readingExplanation,currentPDFURL,currentReportStatusBadge,publishedConditionStatus,readingLabel} from "./local-decisions-v65.js";
import {preparePostrunReview,verifyPostrunReview} from "./postrun-review-v74.js";
import {mountSavedRoutes,uniqueProofs,decisionProofs,factPresentationProofs,digestProofs,renderScoreChart,renderTerminalScoreCards,renderIdentityConsolidation,studyCompanionCases,workbenchSourceScope,recordedAtomLinks,guideRoutes,groupDuplicateFills,readerEvidenceState,readerRedactionVerdict} from "./workbench-visuals.js";
import {computeDecisionScores,formatDecisionScore,verifyContextualScoreBindings,CONTEXT_PRIORITY_VERSION,isContextPriorityVersion,renderContextPriorityCards} from './decision-scores.js';
import {studyInputPrimary,studyInspection,loadStudyPublication} from './delegation-entry.js';
import {counterPolicyNotice} from './counter-policy-ui.js';
import {sourceScopeAllows,sourcePagePolicyAllows,sourcePolicyCaption,isSuppliedSourcePage,registeredSuppliedPageInfo,registeredLaterPageInfo,bindRegisteredSourceResponse} from './saved-source-policy.js';
import {mountEvidenceMap} from './evidence-map.js?v=20261128-polish1';
import {loadSourceLookups} from './source-lookups-v1.js';
import {loadReaderCasing,readerText} from './reader-casing.js';
import {exactSourceAnchor,focalReferenceFromOrigin,cibPDFPair} from './source-inspection.js';
import originPageLocators from './source-pdf-locators.js';
import {inputOriginPDFLocators} from './input-origin-locators.js';
import {originBoundary,originDisplaySections,originPDFLocator,originHighlightPlan} from './workbench-origin.js?v=20261128-polish1';
import {prepareCasebookStatuses,historicalStudyStatus,renderCasebookStatusDot,unifyCasebookCatalog} from './workbench-casebook-status.js?v=20261128-polish1';
import {displayReportSHA,casebookSourceSummaries,minimalOriginSelections,casebookEpisodeGroups} from './workbench-display-catalog.js?v=20261128-polish1';
import {loadFreshPublication,loadFreshSavedInput,freshPublicationStatuses,freshPublicationOriginals,assertLoadedFreshInput} from './workbench-fresh-saved.js?v=20261128-polish1';
import {manifestRef as freshManifestRef,reportRef as freshReportRef,secondaryCatalogRef as freshSecondaryCatalogRef} from './workbench-fresh-publication-catalog.js?v=20261128-polish1';
import {showWorkbenchPDFs} from './workbench-pdf.js';
import {savedReserveCandidates} from './workbench-reserves.js';
import {workbenchStudyTarget,linkWorkbenchStudyNavigation} from './workbench-study-entry.js';
import {nativeControllerWithholdingViews,controllerWithholdingEmptyText,renderControllerWithholding,renderControllerWithheldAudit} from './controller-withholding-ui.js';
import {verifyProposalPool,corpusOnlyProposalExecution,preferredProposalReading,proposalSourceLabel,renderProposalOrder,renderSuppliedProposalTrace} from './proposal-pool.js';
import {displayReadings,displayReadingId,sourceGraphHops,sourceLocation,appendDigestText} from './workbench-display.js';
import {loadReviewedSourceMethod,renderReviewedSourceWorkspace,reviewedSourceSummary} from './workbench-reviewed-source.js?v=20261128-polish1';
import {renderSavedSourceDigest} from './workbench-saved-digest.js';
import {renderStandardSourceWorkspace} from './workbench-source-presentation.js?v=20261128-polish1';
import {mountSourceAccountMap} from './workbench-source-map.js?v=20261128-polish1';
import {renderEvidenceDetails,evidenceRoles} from './workbench-evidence-details.js?v=20261128-polish1';
import {mountEvidenceInspection} from './workbench-kg-inspection-host.js?v=20261128-polish1';
import {loadRecoveryStudies,loadRecoveryStudy,renderRecoveryStudy,recoverySourcePacket,recoveryOriginHighlights} from './workbench-recovery-studies.js?v=20261128-polish1';
import {renderLiveSourceWorkspace,liveSourceSummary,liveSourceInspectionBinding} from './workbench-live-source.js?v=20261128-polish1';
import {renderRecoveryDigest} from './workbench-recovery-digests.js?v=20261128-polish1';
await loadReaderCasing();
const $ = selector => document.querySelector(selector);
const list = value => Array.isArray(value) ? value : [];
function decisionLabel(unit,task=unit?.task){
  return (task==='redaction'?readerEvidenceState(unit?.status)?.label:null)||nativeDecisionLabel(unit,task);
}
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
    if(entry.case&&["case_id","corpus","task","query","document_id","date","focal_marker"].some(key=>entry.case[key]!==c[key]))throw Error("An examples entry changes the saved input.");
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
  if(!Array.isArray(manifest.special_redactions)||manifest.special_redactions.length>rows.length)throw Error("The special CIB redactions group is malformed.");
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
      if(entry.citation&&(entry.citation.document_id!==row.row.case.document_id||entry.citation.date!==row.row.case.date||entry.citation.eligible_evidence!==false))throw Error("A corpus background changes its input-origin provenance.");
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
  A:{key:"llm_readings",name:"LLM readings",origin:"Visible-input atoms and model grammatical readings"},
  B:{key:"llm_atoms",name:"Atoms only",origin:"Required assertions without additional readings"},
  C:{key:"llm_local",name:"Local readings",origin:"Required assertions and local grammatical readings"}
};
for(const option of $("#arm-select").options)if(ARMS[option.value])option.textContent=ARMS[option.value].name;
const STAGES = [["01","Input"],["02","Facts"],["03","Map"],["04","Evidence"],["05","Results"],["06","Summary"]];
const GRAPH_SCOPE = "The full Corpus Map is separate from this input's evidence view. Ordinary map lookup does not inherit the input's date boundary or origin policy; a saved Guide Path carries its own case scope. Map context is not automatically eligible proof.";
const state = {report:null,sourceReport:null,manifest:null,trace:null,reviewedSource:null,sourceMethodMode:'reviewed',catalog:null,casebook:null,casebookPending:"Loading the source-bound examples catalog...",filters:{corpus:"",task:""},row:null,saved:null,gateReview:null,home:false,arm:"A",reading:"",candidate:"",originalPath:0,stage:"01",reference:false,loading:false,pending:"",epoch:0,drawerEpoch:0,flow:null,paths:null,projection:null,compareReadings:false,reviewReading:"",independentReview:null,reviewEpoch:0,recoveryHistorical:false};
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
function catalogCases(){return [...(state.catalog?.cases||list(state.report?.cases)),...list(state.freshRows)];}
async function loadPublishedFreshCatalog(){
  if(!freshManifestRef)return;
  if(publicationByteHashes.get(state.sourceReport)!==freshReportRef.sha256)throw Error('The fresh input catalog belongs to another base publication.');
  if(typeof globalThis.PublicReplay?.staticBytes!=='function')throw Error('The verified saved-result transport is unavailable.');
  const publication=await loadFreshPublication({manifestRef:freshManifestRef,reportRef:freshReportRef,secondaryCatalogRef:freshSecondaryCatalogRef,base:location.href,
    fetchBytes:(ref,options)=>globalThis.PublicReplay.staticBytes(ref,options)});
  state.freshPublication=publication;state.freshEntries=new Map(publication.entries.map(entry=>[entry.case.case_id,entry]));
  state.freshRows=[];
  for(const entry of publication.replacements){
    const original=catalogCases().find(row=>row.case.case_id===entry.original_case_id);
    if(!original)throw Error('A revised input has no verified original case.');
    const row={...original,case:entry.case,fresh_source_entry:true,source_query_spans:[]};
    state.freshRows.push(row);
    state.casebook.primary=state.casebook.primary.map(item=>item.case_id===entry.original_case_id?{...item,case_id:entry.case.case_id,row}:item);
    for(const [corpus,backgrounds]of Object.entries(state.casebook.backgrounds))state.casebook.backgrounds[corpus]=backgrounds.map(item=>
      item.case_id===entry.original_case_id?{...item,case_id:entry.case.case_id}:item);
  }
  for(const original of freshPublicationOriginals(publication)){
    const entry=publication.entries.find(item=>item.original_case_id===original.case.case_id);
    if(!entry)continue; // Only explicitly approved fresh results become active rows.
    state.freshRows.push({case:entry.case,fresh_source_entry:true,original_catalog_kind:original.kind,
      source_query_spans:[],reference_answer:null,reference_answer_available:false,
      configurations:{llm_readings:{source_view_policy:original.source_view_policy}}});
  }
  state.casebookStatuses=Object.freeze({...state.casebookStatuses,...freshPublicationStatuses(publication)});
}
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
// BEGIN_INPUT_MARKER_VIEW
function inputPresentationStart(text){
  const label=String(text).match(/^\s*Comment:\s*/i);
  return label?Array.from(label[0]).length:0;
}
function inputMarkerTokens(text,focalMarker=''){
  const raw=String(text),chars=Array.from(raw),tokens=[];
  const focal=focalMarker&&raw.indexOf(focalMarker)===raw.lastIndexOf(focalMarker)?raw.indexOf(focalMarker):-1;
  let at=0;
  for(const match of raw.matchAll(/\[\[REDACTION_SLOT:[^\]]+\]\]|\[(?:REDACTION(?:[ _]\d+)?|REDACTED|STILL REDACTED|MASKED|MASK)\]/gi)){
    const start=Array.from(raw.slice(0,match.index)).length,end=start+Array.from(match[0]).length;
    if(start>at)tokens.push({start:at,end:start,raw:chars.slice(at,start).join(''),kind:'text'});
    const selected=match.index===focal&&match[0]===focalMarker;
    tokens.push({start,end,raw:match[0],kind:selected?'focal':'masked',label:selected?'[REDACTION]':'[MASKED]'});at=end;
  }
  if(at<chars.length)tokens.push({start:at,end:chars.length,raw:chars.slice(at).join(''),kind:'text'});
  return tokens;
}
// END_INPUT_MARKER_VIEW
function appendInputView(host,text,{focalMarker='',focalNode=null,hideCommentLabel=false}={}){
  const display=Array.from(readable(text)),start=hideCommentLabel?inputPresentationStart(text):0;
  for(const token of inputMarkerTokens(text,focalMarker)){
    if(token.kind==='text'){host.append(document.createTextNode(display.slice(Math.max(start,token.start),token.end).join('')));continue;}
    const node=token.kind==='focal'&&focalNode?focalNode(token):el('span',token.label);
    node.dataset.nativeMarker=token.raw;node.dataset.nativeStart=String(token.start);node.dataset.nativeEnd=String(token.end);
    node.dataset.markerView=token.kind;host.append(node);
  }
  return host;
}
function short(text,n=12) { const words=String(text||"").trim().split(/\s+/);return words.slice(0,n).join(" ")+(words.length>n?"...":""); }
function title(row) { return typeof row.presentation_title==="string"&&row.presentation_title.trim()?presentationTitle(row):row.display_title || row.case.title || short(row.case.query.replace(/^(?:\s*\[REDACTED\]\s*)+/i,"").replace(/\[(?:REDACTED|REDACTION[^\]]*)\]/gi,"masked passage"),11); }
let livePacket=null;
let savedSourcePacket=null;
function currentSourcePacket(){return livePacket||savedSourcePacket;}
const controllerAuditCache=new WeakMap();
const inputContextCache=new WeakMap();
const proposalPoolCache=new WeakMap();
async function prepareInputContext(record,caseInfo){
  if(!record||inputContextCache.has(record))return;
  try{inputContextCache.set(record,{view:await nativeInputContextView(record,caseInfo)});}
  catch{inputContextCache.set(record,{error:'The recorded supplied-context suggestions could not be verified against this input and its declared readings. No suggestion is substituted.'});}
}
async function prepareProposalPool(record,caseInfo){
  if(!record||proposalPoolCache.has(record))return;
  try{
    const input=inputContextCache.get(record);
    if(record.result?.proposal_pool!=null&&input?.error)throw Error(input.error);
    proposalPoolCache.set(record,{view:await verifyProposalPool(record,caseInfo,input?.view)});
  }catch(error){proposalPoolCache.set(record,{error:error.message});}
}
function currentProposalReading(){return proposalPoolCache.get(state.saved)?.view?.readings.find(row=>row.id===state.reading)||null;}
async function prepareControllerAudit(record,caseInfo){
  if(!record||controllerAuditCache.has(record))return;
  try{controllerAuditCache.set(record,{views:await nativeControllerWithholdingViews(record,caseInfo)});}
  catch(error){controllerAuditCache.set(record,{error:error.message});}
}
function currentControllerAudit(){return controllerAuditCache.get(state.saved);}
function currentControllerView(){return currentControllerAudit()?.views?.get(state.reading)||null;}
function emptyControllerShortlist(){const view=currentControllerView();return view?.candidates.length&&view.displayedCount===0?view:null;}
function isLivePublication(){return state.report?.version==='matryoshka-live-report/1';}
function isNarrativePublication(){return isLivePublication()||state.report?.version==='narrative-workbench-publication/1';}
function isCurrentPublication(){return isNarrativePublication()||state.report?.version==='current-workbench-publication/1';}
function hasOpenedResult(){return true;}
function isStaticPublicReplay(){return staticCurrentPublications.has(state.report);}
function publicAuditNotice(){
  return isStaticPublicReplay()&&[state.row,state.saved,state.saved?.result].some(value=>value?.public_audit_projection&&typeof value.public_audit_projection==='object'&&!Array.isArray(value.public_audit_projection))?
    'This export abbreviates internal comparison records. Recorded counts and hashes describe the omitted rows; the full execution record is not included.':null;
}
function presentationGroup(row) {
  if(isCurrentPublication()&&row.current_resource_execution===true)return row.selected_demo===true&&row.selected_bench!==true?'presentation':row.selected_bench===true&&row.selected_demo!==true?'bench':'archive';
  const group=row.presentation_selection?.group;if(["presentation","bench","archive"].includes(group))return group;
  return 'archive'; }
function queryKind(row) { return row.presentation_selection?.query_kind||row.query_kind||originKinds.get(row.case?.case_id); }
function analystAlternativeKind(kind) { return typeof kind==="string"&&kind.startsWith("ANALYST_ALTERNATIVE_"); }
function syntheticMaskKind(kind) { return typeof kind==="string"&&/^SYNTHETIC_LITERAL_(?:CABLE|SOURCE)_MASK/.test(kind); }
function queryKindNotice(row) {
  if(isCounterhypothesis(row.case?.task||row.task,queryKind(row)))return "Analyst-authored counterhypothesis: the source assertion was deliberately altered, not quoted verbatim. The saved input is unchanged.";
  if(syntheticMaskKind(queryKind(row)))return "Synthetic literal source-span mask, not an observed release redaction. The saved input is unchanged; its input-origin attachment is not evidence.";
  if(analystAlternativeKind(queryKind(row)))return "Analyst-authored alteration of the origin assertion, not verbatim source wording. The saved input is unchanged.";
  return "Synthetic analyst counterhypothesis: analyst-authored, not natural source wording. The saved input is unchanged.";
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
  const metadata=(row?.current_resource_execution===true?row.resource_binding:undefined)??row?.current_resource_metadata??state.report?.current_resource_metadata;
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
  const sourcePacket=currentSourcePacket();
  if(sourcePacket){
    const url=new URL(path,location.href),params=url.searchParams;
    if(params.has('case_id')&&params.get('case_id')!==state.row.case.case_id)throw Error('The source belongs to another input.');
    if(/\/source-v6$/.test(url.pathname)){
      const page=sourcePacket.sources[params.get('source_id')];
      if(!page)throw Error('This source was not retained by this execution.');
      const response={page,document_pages:sourcePacket.document_pages?.[page.document_id]||Object.values(sourcePacket.sources).filter(p=>p.document_id===page.document_id)};
      if(sourcePacket.source_scope?.source_view_policy?.id==='later_release_inclusive'){
        const binding=liveSourceInspectionBinding(sourcePacket.source_method_handle),scope=sourcePacket.source_scope;
        Object.assign(response,{binding:sourcePacket.condition.resource_binding,resource_binding:binding,
          source_view_policy:scope.source_view_policy,cutoff:state.row.case.date,whole_origin_excluded:false});
        await bindRegisteredSourceResponse(response,{record:{...sourcePacket.condition,resource_binding:binding},caseInfo:state.row.case,binding});
      }
      return response;
    }
    if(livePacket)throw Error('No matching Live artifact was retained. Saved data is not substituted.');
  }
  const url=localURL(path),response=await fetch(url,{cache:"no-store",signal});
  if(!response.ok){const error=Error(`Saved data is unavailable (${response.status}). No result has been substituted.`);error.status=response.status;throw error;}
  const bytes=await response.arrayBuffer();
  const byteHash=hash||captureHash?await sha256(bytes):null;
  if(hash&&(!/^[a-f0-9]{64}$/i.test(hash)||byteHash!==hash.toLowerCase()))throw Error("Saved data failed its integrity check. No result is shown.");
  let value;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw Error("The server did not return a readable saved record.");}
  if(captureHash&&value&&typeof value==='object')publicationByteHashes.set(value,byteHash);
  const verified=verifyCurrentResourceResponse(url,value);
  if(url.pathname==='/api/current/source-v6'&&([verified.page||verified,...list(verified.document_pages)].some(isSuppliedSourcePage)||state.saved?.result?.source_view_policy?.id==='later_release_inclusive'||state.saved?.source_view_policy?.id==='later_release_inclusive')){
    if(state.row?.case.case_id!==url.searchParams.get('case_id')||!state.saved)throw Error('The supplied source has no matching loaded execution.');
    await bindRegisteredSourceResponse(verified,{record:state.saved,caseInfo:state.row.case,binding:currentBinding(state.row.case.case_id,state.row.case.corpus)});
  }
  return verified;
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
  if(state.recoveryRequestedId&&state.recoveryHistorical===true)url.searchParams.set('historical','1');
  else url.searchParams.delete('historical');
  if(state.recoveryRequestedId){url.searchParams.set('recovery',state.recoveryRequestedId);url.searchParams.delete('case');url.searchParams.delete('study');}
  else{url.searchParams.delete('recovery');if(state.row)url.searchParams.set("case",state.row.case.case_id);else url.searchParams.delete("case");}
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
function destroyVisuals({disconnectCitations=true}={}) { state.standardPanels?.destroy();state.standardPanels=null;state.flow?.destroy();state.paths?.destroy();state.flow=null;state.paths=null;if(disconnectCitations)citationObserver.disconnect(); }
function pendingRecord(value) { return value&&["PENDING","NOT_RUN","UNAVAILABLE","NOT_PUBLISHED","PREPARING"].includes(String(value.status||value.execution_status||"").toUpperCase()); }
function recordedFailure(value){return !!value&&(!!value.failure||!!value.error||/FAIL|ERROR|BLOCKED|PARSE/i.test(String(value.execution_status||value.status||"")));}
function publicationNote(value) { return value?.provenance_notice||value?.release_note||value?.notice||""; }
function disposeDrawerPDFs(){for(const host of $('#detail-body').querySelectorAll('[data-testid="origin-pdf-pair"]'))host.disposeWorkbenchPDFs?.();}
function closeDrawer() { state.inspectionRequest?.abort();state.inspectionMount?.destroy();state.inspectionMount=null;sourceRequest?.abort();disposeDrawerPDFs();state.drawerEpoch++;if($("#detail-drawer").open){viewportAnchor.cancel();$("#detail-drawer").close();} }
function openDrawer(titleText,kicker,body,back) {
  viewportAnchor.cancel();
  state.inspectionRequest?.abort();state.inspectionMount?.destroy();state.inspectionMount=null;
  sourceRequest?.abort();state.drawerEpoch++;
  $("#detail-title").textContent=titleText;$("#detail-kicker").textContent=kicker;
  disposeDrawerPDFs();
  $("#detail-body").replaceChildren(body);
  $("#detail-drawer").classList.toggle('workbench-origin-drawer',!!body.querySelector?.('[data-testid="origin-document"]'));
  $("#detail-drawer").classList.toggle('workbench-kg-drawer',body.dataset?.testid==='workbench-kg-inspection');
  $("#detail-back").hidden=!back;$("#detail-back").onclick=back||null;
  if(!$("#detail-drawer").open)$("#detail-drawer").showModal();
  $("#detail-close").focus({preventScroll:true});return state.drawerEpoch;
}
$("#detail-close").addEventListener("click",closeDrawer);
$("#detail-drawer").addEventListener("cancel",disposeDrawerPDFs);
$("#detail-drawer").addEventListener("close",()=>{if(!$("#detail-drawer").open){state.inspectionRequest?.abort();state.inspectionMount?.destroy();state.inspectionMount=null;sourceRequest?.abort();state.drawerEpoch++;}});

function visibleCases() {
  if(!livePacket&&state.filters.task==='redaction'&&['','cib'].includes(state.filters.corpus)){
    const rows=[...catalogCases().filter(row=>row.case.corpus==='cib'&&row.case.task==='redaction'),...list(state.recoveryRows).filter(row=>!state.freshEntries?.has(row.case.case_id))];
    const ids=new Set(rows.map(row=>row.case.case_id));
    const groups=casebookEpisodeGroups.filter(group=>group.case_ids.every(id=>ids.has(id)));
    return unifyCasebookCatalog(rows,{groups}).map(group=>group.representative);
  }
  return filterCasebook(state.casebook,state.filters).map(value=>value.row);
}
function renderRail() {
  let studies=$('#recovery-studies-shortcut');
  if(!studies&&state.recoveryRows?.length){studies=button('CIB redaction casebook',()=>{
    state.filters.corpus='cib';state.filters.task='redaction';renderRail();savePosition();
  },'quiet',{'data-testid':'recovery-studies-shortcut',id:'recovery-studies-shortcut'});$('#case-list').before(studies);}
  if(studies)studies.hidden=!!livePacket;
  for(const b of document.querySelectorAll('.filter-buttons [data-corpus]'))b.setAttribute('aria-pressed',String(b.dataset.corpus===state.filters.corpus));
  for(const b of document.querySelectorAll('.filter-buttons [data-task]'))b.setAttribute('aria-pressed',String(casebookTask(b.dataset.task)===casebookTask(state.filters.task)));
  const rows=visibleCases();$("#case-count").textContent=rows.length+" inputs";
  const notice=$("#casebook-notice"),special=state.filters.task==='redaction'&&['','cib'].includes(state.filters.corpus);
  const available=state.casebook?.special_redactions.length??0;
  const shortage=special&&state.casebook&&available<5?`${available} of 5 CIB redactions are compatible with this saved viewer. No substitutes.`:'';
  const partial=state.casebook&&state.casebook.selection_scope!=='ready_subset'&&state.casebook.completed_primary_count<9?`${state.casebook.completed_primary_count} of 9 primary examples available.`:'';
  notice.textContent=state.casebookPending||shortage||[partial,state.casebook?.notice].filter(Boolean).join(' ');notice.hidden=!notice.textContent;
  $("#case-list").replaceChildren(...rows.map(row=>{
    const b=button("",()=>chooseCase(row),"case-button",{"aria-current":String(state.row?.case.case_id===row.case.case_id),"data-case":row.case.case_id,"aria-label":`${CORPORA[row.case.corpus]} / ${TASKS[row.case.task]}. ${presentationTitle(row)}`,'aria-describedby':'case-status-'+row.case.case_id});
    const status=state.freshEntries?.has(row.case.case_id)?state.casebookStatuses?.[row.case.case_id]:row.recovery_metadata?historicalStudyStatus(row.recovery_metadata):state.casebookStatuses?.[row.case.case_id];
    const meta=el('div',null,{class:'casebook-meta'});
    meta.append(el('small',`${row.case.document_id} / ${row.case.date}`));
    if(status){const dot=renderCasebookStatusDot(status);dot.id='case-status-'+row.case.case_id;meta.append(dot);
      b.setAttribute('aria-label',b.getAttribute('aria-label')+'. '+status.label);}
    b.append(el("small",`${row.case.corpus==='cib'?'CIB':CORPORA[row.case.corpus]} / ${TASKS[row.case.task]}`,{class:"case-kind"}),
      el("strong",presentationTitle(row),{"data-testid":"case-presentation-title",title:row.case.query}),meta);return b;
  }));
  if(!rows.length)$("#case-list").append(note(state.casebookPending?"The curated examples catalog is not available yet. Pinned case links still open their saved records.":"No published inputs match these filters.","empty"));
  queueMicrotask(()=>loadRailMetadata(rows.filter(row=>!row.recovery_metadata),state.arm));
}
function railKey(row,arm=state.arm){return `${state.report?.run_id}/${row.case.case_id}/${ARMS[arm].key}`;}
function railStatus(row,arm=state.arm){
  if(!hasOpenedResult(row))return publishedConditionStatus(row,ARMS[arm].key,state.report.version)||{badge:'SAVED INPUT',tone:'unresolved',basis:'unopened-saved-task',detail:'Open this saved result to inspect its actual decision.'};
  if(isCurrentPublication()&&!row.configurations?.[ARMS[arm].key])return {badge:'PENDING',tone:'unresolved',basis:'unpublished-method',detail:'This method is not published in the pinned report.'};
  const cached=railDecisionCache.get(railKey(row,arm));if(!cached)return currentReportStatusBadge(row,ARMS[arm].key,verifiedCurrentPublications.has(state.report)?state.report.version:null);
  const reading=state.arm===arm&&state.row?.case.case_id===row.case.case_id?state.reading:"";
  const summary=cached.dto?sidebarDecisionSummary(cached.dto,row.case,ARMS[arm].key,reading):
    cached.record?verdictSummary(cached.record,row.case,reading||preferredReading(cached.record,row.case)):cached.summary;
  return {...summary,basis:cached.dto?'bound-summary':cached.record?'loaded-gate':'unavailable'};
}
function updateRailStatus(row,arm){
  if(state.casebookStatuses)return;
  if(state.arm!==arm)return;
  const method=activeReviewedSource()&&row.case.case_id===state.row.case.case_id?reviewedSourceSummary(state.reviewedSource):null;
  const summary=method?{badge:row.case.task==='mosaic'?'SOURCE '+method.complete+'/'+method.total:
    row.case.task==='redaction'?(method.direct_candidates?'EVIDENCE':'CONTEXTUAL'):'SOURCE VIEWS',
    tone:method.tone,basis:'reviewed-source-method',detail:'Model-reviewed source method; structural native unchanged.'}:railStatus(row,arm);if(!summary)return;
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
        if(dto.query_sha256!==await textDigest(row.case.query))throw Error("Sidebar input binding changed.");
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
function readingDescription(record,r){return readingText(list(record?.plan?.slot_readings).find(item=>item.id===r.id)||r);}
function displayReadingRows(){return displayReadings(readingRows(),r=>readingDescription(state.saved,r),{preferredId:state.reading});}
// BEGIN_READER_READING_CHOICE
function curatedDisplayReading(record,caseInfo,row,{live=false}={}){
  const choice=row?.presentation_selection?.reading_choice,gate=record?.local_decisions_v65;
  const rows=list((record?.result?.redaction||record?.result)?.readings);
  if(live||caseInfo?.task!=='redaction'||!choice||choice.version!=='curated-reading-choice/1'||
    choice.presentation_only!==true||choice.answer_aware!==true||choice.benchmark!==false||choice.reference_verified!==true||
    choice.case_id!==caseInfo.case_id||choice.config!==record?.config||choice.query_sha256!==gate?.query_sha256||
    !/^[a-f0-9]{64}$/.test(choice.query_sha256||'')||choice.native_run_id!==record?.run_id||
    choice.native_checksum!==record?.native_checksum||!/^[a-f0-9]{64}$/.test(choice.native_checksum||'')||
    row.reference_answer_available===false||/unknown|unavailable|withheld/i.test(row.reference_answer_kind||'')||
    rows.filter(value=>value.reading?.id===choice.reading_id).length!==1||
    list(record?.plan?.slot_readings).filter(value=>value.id===choice.reading_id).length!==1)return '';
  return choice.reading_id;
}
function initialDisplayReading(record,caseInfo,row,options={}){
  const preferred=curatedDisplayReading(record,caseInfo,row,options)||preferredProposalReading(record,caseInfo,{pool:proposalPoolCache.get(record)?.view,inputView:inputContextCache.get(record)?.view});
  return displayReadingId(list((record?.result?.redaction||record?.result)?.readings),r=>readingDescription(record,r),preferred);
}
// END_READER_READING_CHOICE
function currentReading() { const rows=displayReadingRows();return rows.find(r=>r.reading?.id===state.reading)||rows[0]; }
function candidates() {
  const rows=list(currentReading()?.candidates);
  const version=(state.saved?.result?.terminal_scores??state.saved?.terminal_scores)?.version;
  return (['terminal-evidence-fit/5','terminal-evidence-fit/6','terminal-evidence-fit/7','terminal-evidence-fit/8','terminal-context-priority/10'].includes(version)?rows:groupDuplicateFills(rows)).slice(0,5);
}
function flowItems() {
  if(state.row.case.task==="redaction")return candidates();
  if(isNarrativePublication())return list(state.saved?.result?.atoms).map(atom=>({...atom,fill:atom.text||atom.id,atom_id:atom.id}));
  return list(state.saved?.result?.flow_targets||nativeFlow()?.targets).map(target=>({...target,fill:target.fill||target.label||target.atom_id}));
}
function selectedItem() { return flowItems().find(c=>c.id===state.candidate)||flowItems()[0]; }
function nativeFlow() { return state.saved?.result?.flow||state.saved?.flow_v3||state.saved?.result?.flow_v3; }
function contributor(item) { return state.projection?.candidates?.find(c=>c.id===item?.id)||nativeFlow()?.candidate_flows?.[item?.id]||state.saved?.result?.candidate_flows?.[item?.id]; }

async function chooseCase(row,{push=true,reading,candidate,scroll=false}={}) {
  state.recoveryHistorical=false;
  savedSourcePacket=null;
  state.activeFreshInput=null;
  if(row.recovery_metadata){
    const fresh=state.freshEntries?.has(row.case.case_id)&&state.freshRows?.find(item=>item.case.case_id===row.case.case_id);
    if(fresh)return chooseCase(fresh,{push,reading,candidate,scroll});
    return chooseRecoveryStudy(row.recovery_metadata.case_id,{push,reading});
  }
  state.recoveryStudy=null;state.recoveryRequestedId=null;
  if(livePacket){
    if(row.case.case_id!==livePacket.row.case.case_id)throw Error('A Live run cannot select a saved case.');
    state.reading=reading||state.reading;state.candidate=candidate||state.candidate;
    renderWorkspace();renderRail();savePosition({push});await hydrateFlow(state.epoch);return;
  }
  const epoch=++state.epoch;request?.abort();request=new AbortController();destroyVisuals();state.projection=null;state.trace=null;state.reviewedSource=null;state.sourceReading=reading||'';state.sourceMethodMode='reviewed';clearIndependentReview();
  state.home=false;state.row=row;state.saved=null;state.gateReview=null;state.loading=true;state.pending="";state.reference=false;state.originalPath=0;state.reading=reading??"";state.candidate=candidate??"";state.compareReadings=false;state.reviewReading="";
  for(const option of $("#arm-select").options){const available=!isCurrentPublication()||!!row.configurations?.[ARMS[option.value]?.key];option.disabled=!available;option.textContent=ARMS[option.value].name+(available?"":" / not published");}
  $('.workspace-toolbar').hidden=Array.from($('#arm-select').options).filter(option=>!option.disabled).length<2;
  clearError();renderRail();renderWorkspace();savePosition({push});
  $("#page-state").textContent=`Loading saved evidence for method ${state.arm}.`;
  const arm=state.arm,key=ARMS[arm].key,cacheKey=state.report.run_id+"/"+row.case.case_id+"/"+key;
  if(isCurrentPublication()&&!row.configurations?.[key]){state.loading=false;state.pending=`${ARMS[arm].name}: this method's saved result is not published yet. No other method is substituted.`;renderWorkspace();$("#page-state").textContent=state.pending;return;}
  try {
    if(state.freshEntries?.has(row.case.case_id)){
      const input=await loadFreshSavedInput(row.case.case_id,{publication:state.freshPublication,signal:request.signal,
        assertCurrent:()=>epoch===state.epoch});
      if(epoch!==state.epoch)return;
      assertLoadedFreshInput(input);
      if(canonicalGateJSON(input.inputCase)!==canonicalGateJSON(row.case))throw Error('The fresh execution changes the selected input.');
      savedSourcePacket=input.packet;state.activeFreshInput=input;
      state.saved=input.packet.condition;state.trace=input.packet.source_method_handle.method.trace;
      state.row={...row,resource_binding:liveSourceInspectionBinding(input.packet.source_method_handle)};
      const readings=input.packet.source_method_handle.method.readings||[];
      state.reading=readings.some(item=>item.reading.id===reading)?reading:input.packet.source_method_handle.method.selected_reading_id||'';
      state.candidate='';state.loading=false;
      renderWorkspace();renderRail();savePosition();$('#page-state').textContent='';
      if(scroll&&state.stage!=='01')stagePosition(state.stage,{push:false});
      return;
    }
    let detail=conditionCache.get(cacheKey);
    if(!detail){
      detail=await getJSON("/api/condition-v6?"+new URLSearchParams({case_id:row.case.case_id,config:key}),{signal:request.signal});
      if(pendingRecord(detail)&&!detail.case){if(epoch!==state.epoch)return;state.pending=publicationNote(detail)||"The selected v6 condition is not published yet.";state.loading=false;renderWorkspace();$("#page-state").textContent=state.pending;return;}
      for(const field of ["case_id","corpus","task","query","date","document_id","focal_marker"])if(detail.case?.[field]!==row.case[field])throw Error("The saved condition belongs to a different input.");
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
    state.row={...row,...detail,reference_answer:detail.reference_answer??row.reference_answer,reference_answer_kind:detail.reference_answer_kind??row.reference_answer_kind,presentation_title:row.presentation_title??detail.presentation_title,selected_demo:row.selected_demo??detail.selected_demo,presentation_selection:row.presentation_selection??detail.presentation_selection,query_kind:row.query_kind??detail.query_kind,decision_summary_by_arm:row.decision_summary_by_arm,presentation_caveats:row.presentation_caveats,reviewed_source_assessment:row.reviewed_source_assessment,reviewed_source_digest:row.reviewed_source_digest,source_realized_digest:row.source_realized_digest};state.saved=detail.configurations?.[key]??detail.configurations?.[arm]??null;state.loading=false;
    if(state.saved?.local_decisions_v65){
      const packet=packetFor(state.saved,state.row.case),serialized=JSON.stringify(state.row.case.query).replace(/[\u007f-\uffff]/g,char=>"\\u"+char.charCodeAt(0).toString(16).padStart(4,"0"));
      const queryHash=await sha256(new TextEncoder().encode(serialized));
      if(epoch!==state.epoch)return;
      if(packet.query_sha256!==queryHash||packet.binding.query_sha256!==queryHash)throw Error("The V6.5 decision supplement has another public-input binding.");
      state.gateReview=await exactGateReview(state.saved,packet);
      if(epoch!==state.epoch)return;
    }
    if(!state.saved?.result&&!recordedFailure(state.saved)||pendingRecord(state.saved)||pendingRecord(state.saved?.result)||pendingRecord(detail)){state.pending=publicationNote(state.saved)||publicationNote(detail)||`No completed v6 arm ${arm} execution is published. No older run or other arm is substituted.`;state.saved=null;}
    if(state.saved)await prepareControllerAudit(state.saved,state.row.case);
    if(state.saved){
      const digest=value=>sha256(new TextEncoder().encode(canonicalGateJSON(value)));
      if(isContextPriorityVersion(state.saved.result?.terminal_scores?.version)){
        const wire=await globalThis.PublicReplay.verified(localURL('/api/native-v6?'+caseQuery()).href,request.signal);
        if(epoch!==state.epoch)return;
        await verifyContextualScoreBindings(state.saved,state.row.case,digest,{
          publicResourceBinding:currentBinding(state.row.case.case_id,state.row.case.corpus),
          rawVerifiedJSON:new TextDecoder('utf-8',{fatal:true}).decode(wire.decoded),
          nativePath:['native'],narrativeProjection:true});
      }else await verifyContextualScoreBindings(state.saved,state.row.case,digest);
    }
    if(state.saved)await prepareInputContext(state.saved,state.row.case);
    if(state.saved)await prepareProposalPool(state.saved,state.row.case);
    if(state.saved&&row.reviewed_source_assessment!=null){
      const reviewed=await loadReviewedSourceMethod({row:state.row,record:state.saved,config:key,
        resourceBinding:currentBinding(row.case.case_id,row.case.corpus),signal:request.signal,
        verified:(url,signal)=>globalThis.PublicReplay.verified(url,signal),base:location.href});
      if(epoch!==state.epoch)return;
      state.reviewedSource=reviewed;
    }
    if(epoch!==state.epoch)return;
    const rows=readingRows();
    if(!rows.some(r=>r.reading?.id===state.reading)){
      const ordinal=/^reading_(\d+)$/.exec(state.reading);state.reading=(ordinal?rows[Number(ordinal[1])-1]?.reading?.id:null)||initialDisplayReading(state.saved,state.row.case,state.row);
    }
    state.reading=displayReadingId(rows,r=>readingDescription(state.saved,r),state.reading);
    if(!flowItems().some(c=>c.id===state.candidate))state.candidate=flowItems()[0]?.id||"";
    if(state.saved)await bindCurrentRail(state.row,arm,state.saved);
    if(state.saved)await initializeIndependentReview();
    if(epoch!==state.epoch)return;
    renderWorkspace();renderRail();savePosition();
    if(state.saved)updateRailStatus(state.row,arm);
    $("#page-state").textContent=state.saved?`${ARMS[arm].name}. Saved evidence only.`:state.pending;
    if(state.saved&&!activeReviewedSource())await hydrateFlow(epoch);
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
    if(background?.citation){const p=background.citation;const inspect=()=>{const source=box(note('Input-origin provenance, not eligible evidence or a new decision.'),fields([['Document',p.document_id,true],['Date',p.date,true]]));if(typeof p.text==='string')source.append(el('blockquote',p.text,{class:'cue'}));openDrawer('Source context',CORPORA[corpus],source,()=>corpusBackground(corpus));};card.append(button('Source context',()=>{if(allowPrivileged(inspect,row))inspect();},'quiet'));}
    card.append(button('Open saved case',()=>chooseCase(row)));body.append(card);
  }
  openDrawer(CORPORA[corpus]+' / three examples','Collection background',body);
}
$("#arm-select").addEventListener("change",()=>viewportAnchor.run(async()=>{state.arm=$("#arm-select").value;state.reading="";state.candidate="";if(state.row)await chooseCase(list(state.report.cases).find(r=>r.case.case_id===state.row.case.case_id));}));

function activeReviewedSource(){return state.reviewedSource&&state.sourceMethodMode==='reviewed'?state.reviewedSource:null;}
function selectSourceMethod(mode){
  if(!['reviewed','structural'].includes(mode)||!state.reviewedSource)return;
  state.sourceMethodMode=mode;renderWorkspace();updateRailStatus(state.row,state.arm);
  if(mode==='structural')void hydrateFlow(state.epoch);
}
function renderWorkspace() {
  destroyVisuals();
  const host=$("#case-view");host.replaceChildren();host.setAttribute("aria-busy",String(state.loading));
  host.dataset.reading=state.reading;
  delete host.dataset.sourceMethodSha;delete host.dataset.sourceRunId;
  $(".workspace-toolbar").hidden=true;
  if(state.home){renderHome();return;}
  if(!state.row){host.append(note(state.casebookPending||"Choose a saved input from the catalog.","empty"));return;}
  if(state.recoveryStudy){renderRecoveryWorkspace(host);return;}
  const c=state.row.case;
  const nav=el("nav",null,{class:"workflow-nav","aria-label":"Pipeline stages"});
  for(const [number,name] of STAGES){const a=el("a",null,{href:"#stage-"+number,"data-stage":number});a.append(el("strong",number,{class:"workflow-step-number"}),el("span",name));if(number===state.stage)a.setAttribute("aria-current","step");a.onclick=e=>{e.preventDefault();stagePosition(number);};nav.append(a);}host.append(nav);
  const workflow=el("div",null,{class:"workflow","data-arm":state.arm});host.append(workflow);
  workflow.append(renderQuestion());
  if(state.loading){workflow.append(el("p",`Loading saved results for arm ${state.arm}. Source verification may take a moment.`,{class:"empty",role:"status","aria-live":"polite","data-testid":"condition-loading"}));return;}
  if(!state.saved){workflow.append(note(state.pending||"No completed result is currently loaded for this selected arm. No archived result is substituted.","empty"));return;}
  if(currentSourcePacket()?.source_method_handle){
    host.dataset.sourceMethodSha=currentSourcePacket().source_method.sha256;
    host.dataset.sourceRunId=currentSourcePacket().run_id;
    const handle=currentSourcePacket().source_method_handle,epoch=state.epoch;
    const panels=renderLiveSourceWorkspace(handle,{stage,formatText:readable,
      selectedReadingId:state.reading||undefined,onSource:sourceDrawer,onKG:openEvidenceInspection,
      assertCurrent:()=>epoch===state.epoch&&currentSourcePacket()?.source_method_handle===handle,
      onDetails:value=>sourcePresentationDetails({...value,details:{...value.details,completedInput:value.details?.completed_input}}),
      onReadingChange:id=>viewportAnchor.run(()=>{state.reading=id;renderWorkspace();savePosition();}),
      onMapMount:(mapHost,data)=>{
        state.flow=mountSourceAccountMap(mapHost,{data,onSource:sourceDrawer,onDetails:sourcePresentationDetails,formatText:readable,
          assertCurrent:()=>{if(epoch!==state.epoch)throw new DOMException('Live selection changed','AbortError');}});
      }});
    state.standardPanels=panels;workflow.append(...panels);host.setAttribute('aria-busy','false');return;
  }
  if(activeReviewedSource()){
    const digestRow=list(state.sourceReport?.cases).find(row=>row.case.case_id===state.row.case.case_id);
    const digestOptions={row:digestRow,record:state.saved,signal:request.signal,
      reportRef:{sha256:publicationByteHashes.get(state.sourceReport)},
      endpoint:localURL('/api/current/analyst-digest?'+caseQuery()).href,
      verified:(url,signal)=>globalThis.PublicReplay.verified(url,signal),base:location.href};
    const panels=renderStandardSourceWorkspace(activeReviewedSource(),{record:state.saved,stage,formatText:readable,
      selectedReadingId:state.sourceReading,
      policyText:sourceScopeText(),onSource:proof=>sourceDrawer(proof),
      onKG:proof=>openEvidenceInspection(proof),
      onOrigin:()=>$('#stage-01 [data-testid=origin-open]')?.click(),
      onBaseline:undefined,
      onDetails:sourcePresentationDetails,
      onReadingChange:id=>viewportAnchor.run(()=>{state.sourceReading=id;state.reading=id;state.candidate='';renderWorkspace();savePosition();}),
      onMapMount:(mapHost,data)=>{
        state.flow?.destroy();
        state.flow=mountSourceAccountMap(mapHost,{data,formatText:readable,onSource:sourceDrawer,
          onDetails:sourcePresentationDetails,assertCurrent:()=>reviewedSourceSummary(activeReviewedSource())});
      },
      renderVerifiedDigest:state.row.reviewed_source_digest||state.row.source_realized_digest
        ?context=>renderSavedSourceDigest(context,digestOptions):null});
    state.standardPanels=panels;
    const sourceNotes=presentationCaveats(state.row);if(sourceNotes)panels.at(-1).querySelector('.stage-body').append(sourceNotes);
    workflow.append(...panels);
    host.setAttribute('aria-busy','false');return;
  }
  if(state.saved.frozen_control===true||state.saved.fallback===true||state.row.fallback===true)workflow.append(note(publicationNote(state.saved)||"Saved control record.","notice"));
  else if(publicationNote(state.saved))workflow.append(note(publicationNote(state.saved),"notice"));
  const inputContext=state.saved.result?.proposal_pool==null?renderSuppliedContext():null;if(inputContext)workflow.append(inputContext);
  workflow.append(renderVerdictStrip());
  workflow.append(renderPlan(),renderDiffusion(),renderPathsStage(),renderResultsStage(),renderFindings());
  host.setAttribute("aria-busy","false");
}

function sourcePresentationDetails(value={}){
  const epoch=state.epoch,body=renderEvidenceDetails(value,{onSource:sourceDrawer,
    assertCurrent:()=>epoch===state.epoch});
  if(body){openDrawer('Evidence and checks','Recorded assessment',body);return;}
  if(value.proof){sourceDrawer(value.proof);return;}
  if(value.text)openDrawer('Source context','Recorded information',note(value.text));
}

async function chooseRecoveryStudy(id,{push=true,reading='',historical=false}={}){
  savedSourcePacket=null;
  state.activeFreshInput=null;
  if(livePacket)throw Error('A Live execution cannot substitute a saved recovery study.');
  state.recoveryHistorical=historical===true;
  if(!historical&&state.freshEntries?.has(id)){
    const fresh=state.freshRows.find(row=>row.case.case_id===id);
    if(!fresh)throw Error('Verified fresh original is missing; no historical result is substituted.');
    return chooseCase(fresh,{push,reading});
  }
  const epoch=++state.epoch;request?.abort();request=new AbortController();destroyVisuals();closeDrawer();clearError();
  state.recoveryStudy=null;state.recoveryRequestedId=id;state.reviewedSource=null;state.row=null;state.saved=null;state.home=false;
  state.loading=true;state.sourceReading=reading;state.reading=reading;state.trace=null;state.candidate='';renderWorkspace();savePosition({push});
  $('#page-state').textContent='Loading the recorded recovery study...';
  try{
    const handle=await loadRecoveryStudy(id,{catalog:state.recoveryCatalog,signal:request.signal,
      assertSelectionCurrent:()=>{if(epoch!==state.epoch)throw new DOMException('Study changed','AbortError');}});
    if(epoch!==state.epoch)return;
    state.recoveryStudy=handle;state.row={case:handle.case,recovery_metadata:handle.metadata,resource_binding:handle.resourceBinding,presentation_title:handle.metadata.title};
    state.saved=handle.packet;state.loading=false;state.reading=reading||handle.primaryReadingId;
    renderRail();renderWorkspace();savePosition();$('#page-state').textContent='';
  }catch(error){if(error.name!=='AbortError'&&epoch===state.epoch){state.loading=false;showError(error.message);}}
}

function renderRecoveryWorkspace(host){
  const handle=state.recoveryStudy,epoch=state.epoch,workflow=el('div',null,{class:'workflow','data-recovery-study':handle.case.case_id});
  const nav=el('nav',null,{class:'workflow-nav','aria-label':'Pipeline stages'});
  for(const [number,label]of STAGES){const item=el('a',null,{href:'#stage-'+number});item.append(el('strong',number,{class:'workflow-step-number'}),el('span',label));item.onclick=e=>{e.preventDefault();stagePosition(number);};nav.append(item);}
  host.append(nav,workflow);$('.workspace-toolbar').hidden=true;
  const onSource=(proof,packet)=>recoverySourceDrawer(proof,packet||recoverySourcePacket(handle,proof));
  const panels=renderRecoveryStudy(handle,{stage,formatText:readable,selectedReadingId:state.reading,
    renderDigest:(digestHost,context)=>renderRecoveryDigest(digestHost,context,{signal:request.signal}),
    assertSelectionCurrent:()=>{if(state.recoveryStudy!==handle||state.epoch!==epoch)throw new DOMException('Study changed','AbortError');},
    onSource,onKG:(proof,inspection)=>openRecoveryInspection(proof,inspection,onSource),onOrigin:recoveryOriginDrawer,
    onReadingChange:id=>viewportAnchor.run(()=>{state.reading=id;state.sourceReading=id;renderWorkspace();savePosition();}),
    onDetails:value=>sourcePresentationDetails({...value,details:{...value.details,qualification:null}}),
    onMapMount:(mapHost,data)=>{state.flow=mountSourceAccountMap(mapHost,{data,onSource,onDetails:sourcePresentationDetails,
      formatText:readable,assertCurrent:()=>{if(state.recoveryStudy!==handle)throw new DOMException('Study changed','AbortError');}});},
    onError:error=>showError(error.message)});
  state.standardPanels=panels;const input=panels.find(panel=>panel.id==='stage-01');
  workflow.append(input,...panels.filter(panel=>panel!==input));host.setAttribute('aria-busy','false');
}

function recoverySourceDrawer(proof,packet){
  const page=packet.page,body=box(fields([['Document',page.document_id,true],['Date',page.date]]));
  const sections=state.recoveryStudy.sourcePages.filter(p=>p.document_id===page.document_id);
  for(const p of sections){const section=el('section',null,{'data-testid':'source-document','data-source-id':p.id});
    section.append(heading('Page '+(p.earlier_page||p.source_page||'')),highlightedText(p.text,p.id===proof.canonical_page_id?[proof]:[],{'data-testid':'source-page-text'}));body.append(section);}
  const pdf=el('section',null,{'data-testid':'origin-pdf-pair'});body.append(pdf);
  openDrawer('Source',page.document_id+' / '+page.date,body);
  void cibPDFPair({page,proof}).then(links=>showWorkbenchPDFs(pdf,links)).catch(error=>pdf.append(note(error.message)));
  body.querySelector('mark')?.scrollIntoView({block:'center',behavior:'smooth'});
}

function recoveryOriginDrawer(origin){
  const body=box(fields([['Document',origin.case.document_id,true],['Date',origin.case.date]])),pdf=el('section',null,{'data-testid':'origin-pdf-pair'});
  for(const page of origin.earlier_masked_pages){const section=el('section',null,{'data-testid':'origin-document'});
    section.append(heading('Earlier release / page '+(page.physical_page||'')),highlightedText(page.text,recoveryOriginHighlights(page,origin.case)));body.append(section);}
  body.append(pdf);openDrawer('Origin',origin.case.document_id+' / '+origin.case.date,body);
  const page={document_id:origin.case.document_id,earlier_page:origin.pdfs.earlier?.physical_page,later_page:origin.pdfs.later?.physical_page};
  void cibPDFPair({page}).then(links=>{for(const item of links)if(item.sha256!==origin.pdfs[item.release].ref.sha256)throw Error('The origin PDF binding differs.');return showWorkbenchPDFs(pdf,links);}).catch(error=>pdf.append(note(error.message)));
}

async function openRecoveryInspection(proof,options,onSource){
  const body=box('workbench-kg-inspection');body.dataset.testid='workbench-kg-inspection';
  const epoch=openDrawer('KG Navigator','Selected source',body),controller=new AbortController();state.inspectionRequest=controller;
  try{state.inspectionMount=await mountEvidenceInspection({...options,host:body,signal:controller.signal,onSource,
    sourceIndex:{url:'./data/source-inspection-v1/cib/manifest.json',content_sha256:SOURCE_INSPECTION_PINS.cib}});}
  catch(error){if(error.name!=='AbortError'&&state.drawerEpoch===epoch)body.replaceChildren(note(error.message,'error-card'),button('Inspect source',()=>onSource(proof)));}
}

function renderHome() {
  const host=$("#case-view");host.replaceChildren();host.setAttribute("aria-busy","false");
  const hero=el("header",null,{class:"case-hero"});hero.append(el("p","The source collections",{class:"eyebrow"}),el("h1","Explore a corpus"),note("Open the full reference graph, or return to the saved analyst inputs for a source-bound task."));host.append(hero);
  host.append(note("Full corpus graphs do not inherit an input's cutoff or whole-origin exclusion. Saved Guide Paths carry explicit case bindings; ordinary map lookup remains context, not eligible proof.","notice"));
  const cards=el("div",null,{class:"corpus-cards"});
  const descriptions={iran:"Diplomatic cables / Iran collection",vietnam:"Diplomatic cables / Vietnam collection",cib:"Paired-release Central Intelligence Bulletins"};
  for(const corpus of ["iran","vietnam","cib"]){
    const rows=catalogCases().filter(row=>row.case.corpus===corpus),card=el("section",null,{class:"corpus-card","data-testid":"corpus-card","data-corpus":corpus});
    const selected=rows.filter(row=>presentationGroup(row)==="presentation").length,bench=rows.filter(row=>presentationGroup(row)==="bench").length,archived=rows.filter(row=>presentationGroup(row)==="archive").length;
    const counts=state.catalog?`${selected} presentation / ${bench} bench / ${rows.length} current public inputs`:`${selected} presentation / ${bench} bench / ${archived} archive / ${rows.length} evaluated inputs`;
    card.append(el("span",corpus==="cib"?"CIB":corpus==="iran"?"IR":"VN",{class:"corpus-mark","aria-hidden":"true"}),el("h2",CORPORA[corpus]),note(descriptions[corpus]),el("p",counts,{class:"note","data-testid":"corpus-selection-counts","data-presentation-count":selected,"data-bench-count":bench,"data-archive-count":archived}));
    const actions=el("div",null,{class:"actions"});actions.append(link("Open full knowledge graph",fullGraphURL(corpus),"button primary"),el("a","Open saved inputs",{href:"workbench-v6.html?"+new URLSearchParams({corpus}),class:"button"}));card.append(actions);cards.append(card);
  }
  host.append(cards);$("#page-state").textContent="Home / published sources and saved inputs only.";updateNavigation();
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
    if(proposal.query){const query=el("details");query.append(el("summary","Proposed analyst input / unchanged"),el("p",proposal.query,{class:"cue"}));card.append(query);}
    else card.append(note("Input text is not supplied in this public catalogue."));
    const saved=list(state.report.cases).find(row=>row.case.case_id===proposal.id);
    if(saved)card.append(el("a","Open saved case",{class:"button",href:"workbench-v6.html?"+new URLSearchParams({case:saved.case.case_id,show:presentationGroup(saved)})}));
    return card;
  }}));else section.append(note("No source/legacy proposals match these collection/task filters.","empty"));
  host.append(section);
}

function renderQuestion() {
  const c=state.row.case,s=stage("01",title(state.row),TASKS[c.task]);
  s.outer.querySelector(".stage-card > header h2").replaceWith(el("h1",title(state.row),{class:"question-title"}));
  const companions=state.studyPublication?state.studyPublication.caseIds.length>1&&state.studyPublication.caseIds.includes(c.case_id)?
    state.studyPublication.caseIds.map(id=>catalogCases().find(row=>row.case.case_id===id)).filter(Boolean):[]:
    studyCompanionCases(state.row,catalogCases());
  if(companions.length){
    const tabs=el('nav',null,{class:'study-case-tabs','aria-label':'Focal gap','data-testid':'study-case-tabs'});
    for(const row of companions)tabs.append(el('a',row.study_slot==='first'?'First gap':'Last gap',{
      href:'workbench-v6.html?'+new URLSearchParams({case:row.case.case_id,arm:state.arm,corpus:row.case.corpus}),
      'aria-current':row.case.case_id===c.case_id?'page':null,'data-study-slot':row.study_slot}));
    s.body.append(tabs);
  }
  if(state.row.reference_answer_kind==='unknown_still_withheld'){
    const notice=note('The answer is not given.','notice');
    notice.dataset.testid='study-unknown-truth';s.body.append(notice);
  }
  const query=el("div",null,{class:"query-block","data-testid":"query-text","data-task":c.task});
  // Override the old redaction-only uppercase style, not the source characters.
  query.style.textTransform='none';
  const attachment=currentOriginAttachment(c),context=originContext(c),sourceReference=attachment.refs?.masked!=null;
  const key=c.task==="redaction"?(sourceReference?originFocalReferences.get(context.key):state.row.reference_answer):null;
  const canReveal=c.task==="redaction"&&(key!=null||sourceReference&&attachment.refs?.revealed!=null);
  const awaitingReference=canReveal&&state.reference&&key==null;
  query.dataset.nativeText=c.query;
  appendInputView(query,c.query,{focalMarker:c.focal_marker,hideCommentLabel:true,focalNode:()=>button(state.reference&&key!=null?readable(String(key)):'[REDACTION]',toggleReference,"focal-mask",{"aria-pressed":state.reference,"aria-busy":awaitingReference,"data-testid":"focal-mask","data-reference-ready":key!=null,...(!canReveal?{disabled:""}:{})})});
  const questionKind=queryKindBadge(state.row);if(questionKind)s.body.append(questionKind);s.body.append(query);
  if(awaitingReference)s.body.append(el("p","Loading the verified reference. Click the redaction again to keep it hidden.",{class:"note",role:"status","aria-live":"polite","data-testid":"reference-loading"}));
  const actions=el("div",null,{class:"actions"});
  actions.append(button("Origin",async()=>{
    const fresh=state.activeFreshInput;
    if(fresh?.link.original_catalog_kind==='HISTORICAL_RECOVERY_TEN'&&fresh.inputCase.case_id===c.case_id){
      assertLoadedFreshInput(fresh);recoveryOriginDrawer(fresh.origin);return;
    }
    if(livePacket){openDrawer('Origin','Live input provenance',box(appendInputView(el('p',null,{class:'cue','data-testid':'live-input-origin'}),c.query,{focalMarker:c.focal_marker}),fields([['As of',c.date],['Declared origin',c.document_id,true]]),note('Entered in the Live form. No historical origin transcription or hidden answer was supplied.')));return;}
    if(!allowPrivileged(()=>$('#stage-01 [data-testid=origin-open]')?.click()))return;
    if(attachment.missing){openDrawer("Origin not attached","Input provenance",box(note("No verified origin attachment is published. No source is substituted."),note(c.query)));return;}
    openDrawer("Origin",originEvidenceKicker(),note("Verifying the saved origin..."));
    const epoch=state.drawerEpoch;
    try{const data=await auditedOrigin(c,false,context);if(epoch===state.drawerEpoch&&$("#detail-drawer").open)originDrawer(data);}catch(error){if(epoch===state.drawerEpoch)$("#detail-body").replaceChildren(note(error.message,"error-card"));}
  },"",{"data-testid":"origin-open"}));
  s.outer.querySelector('.stage-card > header').append(actions);
  if(state.reference&&key!=null){const ref=el("p","Post-run reference only; the saved input is unchanged.",{class:"reference-box","data-testid":"reference-key"});s.body.append(ref);}
  if(state.reference&&sourceReference&&attachment.refs?.revealed!=null)void prepareFocalReference({...c},context);
  return s.outer;
}
function syncFocalReference(c,context){
  if(state.row?.case.case_id!==c.case_id||context&&originContext(c)?.key!==context.key)return;
  const mask=$('#stage-01 [data-testid=focal-mask]');if(!mask)return;
  const reference=context?originFocalReferences.get(context.key):state.row.reference_answer;
  mask.dataset.referenceReady=String(reference!=null);
  mask.setAttribute('aria-pressed',String(state.reference));
  mask.setAttribute('aria-busy',String(state.reference&&reference==null));
  mask.textContent=state.reference&&reference!=null?readable(String(reference)):'[REDACTION]';
  if(reference!=null){
    $('#stage-01 [data-testid=reference-loading]')?.remove();
    if(state.reference&&!$('#stage-01 [data-testid=reference-key]'))
      $('#stage-01 .stage-body').append(el('p','Post-run reference only; the saved input is unchanged.',{class:'reference-box','data-testid':'reference-key'}));
  }
}
async function prepareFocalReference(c,context){
  if(!context||originFocalReferences.has(context.key)){syncFocalReference(c,context);return;}
  if(!referenceRequests.has(context.key))referenceRequests.set(context.key,(async()=>{
    const [masked,revealed]=await Promise.all([auditedOrigin(c,false,context),auditedOrigin(c,true,context)]);
    originFocalReferences.set(context.key,focalReferenceFromOrigin(c,masked,revealed));
  })());
  const pending=referenceRequests.get(context.key);
  try{
    await pending;syncFocalReference(c,context);
    if(state.row?.case.case_id===c.case_id&&state.reference&&originContext(c).key===context.key)void loadIndependentReview();
  }
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
  const {rawText=false,...attributes}=attrs;
  const host=el("div",null,{class:"source-document",...attributes}),chars=Array.from(text),display=Array.from(rawText?text:readable(text));let cursor=0;
  host.dataset.originalText=text;
  if(rawText)host.dataset.displayRaw='true';
  for(const a of [...anchors].sort((a,b)=>a.start-b.start)){
    if(!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<cursor||a.end<=a.start||a.end>chars.length||chars.slice(a.start,a.end).join("")!==a.text)throw Error("The exact source quotation does not replay.");
    const mark=el("mark",display.slice(a.start,a.end).join(""));mark.dataset.originalText=a.text;
    host.append(document.createTextNode(display.slice(cursor,a.start).join("")),mark);cursor=a.end;
  }
  host.append(document.createTextNode(display.slice(cursor).join("")));return host;
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
  const fresh=state.activeFreshInput;
  if(fresh?.link.replacement&&fresh.inputCase.case_id===c.case_id)return {refs:{masked:fresh.link.origin_ref},missing:false};
  if(!isCurrentPublication())return {missing:false};
  const row=catalogCases().find(value=>value.case.case_id===c.case_id),config=ARMS[state.arm].key;
  const declared=row?.current_resource_execution===true&&(Object.hasOwn(row,'origin_refs')||row.configurations?.[config]?.native_checkpoint!=null);
  const bundle=row?.origin_refs,refs=bundle&&Object.hasOwn(bundle,'by_arm')?bundle.by_arm?.[config]:bundle;
  return {refs,missing:declared&&refs?.masked==null};
}
async function auditedOrigin(c,reveal,context){
  const fresh=state.activeFreshInput;
  if(fresh?.link.replacement&&fresh.inputCase.case_id===c.case_id){
    if(reveal)throw Error('This complete input has no hidden reference to reveal.');
    return fresh.origin;
  }
  const key=(context?.key||c.case_id)+"/"+(reveal?"1":"0");
  if(context&&!context.summary)throw Error('The selected method has no published original-source binding. No other method is substituted.');
  if(originCache.has(key))return originCache.get(key);
  let pending=originRequests.get(key);
  if(!pending){
    pending=(async()=>{
      const data=await getJSON("/api/origin-v63?"+new URLSearchParams({case_id:c.case_id,reveal_focal:reveal?"1":"0",...(context?{config:context.config}:{})}));
      if(data.case_id!==c.case_id||data.query!==c.query||data.document_id!==c.document_id||data.date!==c.date||data.eligible_evidence!==false||data.focal_revealed!==(c.task==="redaction"&&reveal)||await textDigest(data.text)!==data.text_sha256||await textDigest(c.query)!==data.query_sha256)throw Error("Origin provenance does not match the saved input or text binding.");
      if(data.full_transcription&&await textDigest(data.full_transcription.text)!==data.full_transcription.text_sha256)throw Error("Full original transcription failed its body hash check.");
      if(isNarrativePublication()&&data.full_transcription){
        const full=data.full_transcription,mapping=full.display_segment_mapping;
        if(mapping){
          if(reveal||c.task!=='redaction'||mapping.marker!==c.focal_marker)throw Error('Unsupported masked origin mapping.');
          const opaque=data.focal_still_withheld===true&&data.reveal_available===false&&data.reference_answer_available===false&&data.reference_answer===null&&data.focal_reference===null&&currentOriginAttachment(c).refs?.revealed==null;
          if(await sha256(new TextEncoder().encode(full.text))!==mapping.display_text_utf8_sha256)throw Error('The masked origin failed its display-text hash.');
          // Still-withheld origins have no revealed branch. Verify the pinned display
          // and its segment mapping below without inventing or requesting a reference.
          if(!opaque){
            const original=await auditedOrigin(c,true,context),raw=original.full_transcription;
            if(!raw||raw.display_segment_mapping||canonicalGateJSON(raw.segments)!==canonicalGateJSON(full.segments)||canonicalGateJSON(raw.separator_spans)!==canonicalGateJSON(full.separator_spans)||raw.segment_separator_contract!==full.segment_separator_contract||canonicalGateJSON(original.source_proof_ref)!==canonicalGateJSON(data.source_proof_ref)||await sha256(new TextEncoder().encode(raw.text))!==mapping.source_text_utf8_sha256)throw Error('The masked origin does not replay its original text binding.');
            const chars=Array.from(raw.text),a=mapping.source_focal_start,b=mapping.source_focal_end;
            if(chars.length!==mapping.source_length||list(original.anchors).filter(anchor=>anchor.start===a&&anchor.end===b&&chars.slice(a,b).join('')===anchor.text).length!==1||chars.slice(0,a).join('')+mapping.marker+chars.slice(b).join('')!==full.text)throw Error('The masked origin changes more than its exact focal span.');
          }
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
function originPDF(data,{segment=null}={}) {
  const host=el('section',null,{'data-testid':'origin-pdf-pair'}),c={...state.row.case};
  const binding=currentBinding(c.case_id,c.corpus),config=ARMS[state.arm].key;
  const context=originContext(c),maskedOriginRef=currentOriginAttachment(c).refs?.masked;
  host.append(note('Checking the original PDF page mappings...'));
  void (async()=>{
    try{
      const full=data.full_transcription||data,anchors=exactOriginAnchors(data);
      const segments=segment?[segment]:isNarrativePublication()?narrativeUI.originTranscriptSegments(full):list(full.segments);
      const sources=originPDFSources(data,segments,anchors),links=[];
      let supplement=null;
      if(!sources.length){
        const masked=data.focal_revealed===true?await auditedOrigin(c,false,context):data;
        const catalogSHA256=document.querySelector('meta[name="source-api-index-sha256"]')?.content;
        supplement=await inputOriginPDFLocators({caseInfo:c,origin:masked,maskedOriginRef,catalogSHA256});
        if(supplement)sources.push({document_id:supplement.document_id,canonical_page_id:supplement.canonical_page_id,
          ...Object.fromEntries(supplement.pdfs.map(item=>[item.release+'_page',item.page]))});
      }
      for(const page of sources){
        const pair=await cibPDFPair({page,binding,caseId:c.case_id,config});
        for(const item of pair){
          if(!item.page)continue;
          const physical=data.physical_source_pair?.[item.release];
          if(item.wire_sha256!==item.sha256||physical&&(physical.sha256!==item.sha256||item.page>physical.physical_page_count))throw Error('The PDF differs from the recorded physical source.');
          if(supplement){
            const expected=supplement.pdfs.find(value=>value.release===item.release);
            if(!expected||item.sha256!==expected.sha256||item.page!==expected.page)throw Error('The PDF differs from the audited input-provenance supplement.');
          }
          if(!links.some(previous=>previous.release===item.release&&previous.page===item.page))links.push(item);
        }
      }
      host.replaceChildren();
      if(links.length)await showWorkbenchPDFs(host,links);
      if(!links.length)host.append(note('No verified PDF page mapping is published.'));
      if(supplement&&links.length){host.dataset.locatorVersion=supplement.version;host.dataset.locatorAuditSha256=supplement.audit_sha256;host.dataset.sourceTargetId=supplement.source_target_id;}
      if(links.length)host.append(note('Recorded release locators do not guarantee identical content: an earlier-release page may be a withholding notice.'));
      if(data.source_mapping?.kind==='withholding_notice_block')host.append(note('The earlier page is a withholding notice, not a same-content page.'));
    }catch(error){host.replaceChildren(note(error.message+' No PDF is substituted.','notice'));}
  })();
  return host;
}
// BEGIN_ORIGIN_PDF_SOURCES
function originPDFSources(data,segments,anchors){
  const positive=value=>Number.isSafeInteger(value)&&value>0?value:null;
  const pages=[],mapping=data.source_mapping;
  if(data.physical_document_id&&data.physical_document_id!==data.document_id)throw Error('The original PDF belongs to another document.');
  for(const segment of segments.filter(segment=>anchors.some(anchor=>anchor.start<segment.end&&anchor.end>segment.start))){
    const locator=segment.locator||{},id=segment.canonical_page_id||segment.source_id;
    if(locator.document_id&&locator.document_id!==data.document_id)throw Error('The origin segment belongs to another document.');
    const page={document_id:data.document_id,canonical_page_id:id};
    if(['CANONICAL_EARLIER_PROJECTION_WITH_ONE_PRIVATE_FOCAL_REVEAL','CANONICAL_EARLIER_PDF_PROJECTION'].includes(locator.kind)){
      page.earlier_page=positive(locator.physical_page_1based);page.later_page=positive(locator.paired_later_page_1based);
    }else Object.assign(page,originPDFLocator(segment));
    const paired=originPageLocators[id];
    if(paired&&paired.document_id!==data.document_id)throw Error('The paired PDF locator belongs to another document.');
    if(paired&&['earlier','later'].some(release=>page[release+'_page']&&paired[release+'_page']&&page[release+'_page']!==paired[release+'_page']))throw Error('Conflicting original PDF page mappings.');
    // Join exact source/document identities only when a recorded release page agrees.
    if(paired?.document_id===data.document_id&&['earlier','later'].some(release=>page[release+'_page']&&page[release+'_page']===paired[release+'_page'])){
      for(const release of ['earlier','later']){
        const field=release+'_page';
        if(page[field]&&paired[field]&&page[field]!==paired[field])throw Error('Conflicting original PDF page mappings.');
        page[field]??=positive(paired[field]);
      }
    }
    if(page.earlier_page||page.later_page)pages.push(page);
  }
  if(!pages.length&&data.pdf){
    const page={document_id:data.document_id};
    if(['earlier','later'].includes(data.pdf.release))page[data.pdf.release+'_page']=positive(data.pdf.page);
    if(mapping?.kind==='withholding_notice_block'){
      for(const [release,value]of [['earlier',mapping.earlier_notice_page],['later',mapping.later_content_page]]){
        const field=release+'_page',number=positive(value);
        if(page[field]&&number&&page[field]!==number)throw Error('Conflicting original PDF page mappings.');
        page[field]=number;
      }
    }
    if(page.earlier_page||page.later_page)pages.push(page);
  }
  return pages;
}
// END_ORIGIN_PDF_SOURCES
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
  return panel;
}
function originDrawer(data) {
  const transcription=data.full_transcription||data;
  if(data.query_kind){originKinds.set(state.row.case.case_id,data.query_kind);refreshRailQuestionKind(state.row);}
  const registeredOrigin=state.row.case.corpus==='cib'&&['supplied_documents_inclusive','later_release_inclusive'].includes(selectedSourceScope(state.row.case).source_view_policy.id);
  const metadata=[["Document",data.document_id,true],["Date",data.date]];
  if(data.classification&&!['unknown','not supplied'].includes(String(data.classification).toLowerCase()))metadata.push(["Classification",data.classification]);
  const body=box(fields(metadata));
  if(data.warning)body.append(note(data.warning,"origin-category-warning"));
  const audit=el('details',null,{class:'origin-audit-details'});audit.append(el('summary','Provenance details / source verification'),
    fields([['Derivation',data.derivation],['Canonical unit / raw-body audit verified',data.unit_verified],['Secret-derived input certified by this source audit',data.secret_derived],['Recorded construction',data.query_kind,true]]),
    note(data.source_review||'Source mapping is not independent historical validation.'),note(registeredOrigin?'Input provenance. Corpus citations appear under Sources.':data.scope),note('Source proof SHA-256: '+data.proof_sha256,'proof-hash'));body.append(audit);
  const scope=el('details');scope.append(el('summary','Input scope and saved inventory'),fields([['Collection',CORPORA[state.row.case.corpus]],['Task',TASKS[state.row.case.task]],['Published case inventory',`${catalogCases().length} cases`,true]]),note(registeredOrigin?'Input provenance. Corpus citations appear under Sources.':queryKindNotice(state.row)||'Original input provenance; not eligible result evidence.'),note(GRAPH_SCOPE),note(sourceScopeText()));if(state.saved&&!savedSourcePacket)scope.append(button('Saved prompts',promptDrawer));
  body.append(scope);
  const mapping=originMappingDetails(data);if(mapping)body.append(mapping);
  const originalSegments=isNarrativePublication()?narrativeUI.originTranscriptSegments(transcription):list(transcription.segments);
  const freshOriginSelection=state.activeFreshInput?.link.replacement?(data.minimal_selection||{version:'origin-minimal-selection/1',
    case_id:state.row.case.case_id,query_sha256:data.query_sha256,source_text_sha256:transcription.text_sha256,
    spans:transcription.query_anchors}):null;
  const highlightPlan=originHighlightPlan(data,state.row.case,{sourceQuerySpans:state.row.source_query_spans||[],
    minimalSpans:freshOriginSelection||minimalOriginSelections[state.row.case.case_id]||null});
  const anchors=highlightPlan.anchors;
  if(highlightPlan.requiresReview)body.append(note('The original text is available; its precise input correspondence needs review.','note'));
  const segments=originDisplaySections(transcription.text,originalSegments);
  const document=transcriptDocument(transcription.text,anchors,segments,{testid:"origin-document",sourceId:data.source_id,documentId:data.document_id,separators:isNarrativePublication()?list(transcription.display_segment_mapping?.separator_spans||transcription.separator_spans):[]});
  if(state.row.case.corpus==='cib'){
    let attached=false;
    for(const [index,section] of [...document.children].entries())if(section.querySelector('mark')){
      section.insertBefore(originPDF(data,{segment:segments[index]||null}),section.querySelector('[data-testid=transcript-text]'));
      attached=true;
    }
    if(!attached)document.prepend(originPDF(data));
  }
  const context=box(heading('Original source context'),document);context.dataset.testid='origin-context';body.append(context);
  openDrawer("Origin",`${data.document_id} / ${data.date} / ${originEvidenceKicker()}`,body);
  scrollToSource();
}
function transcriptDocument(text,anchors,segments,{testid,sourceId,documentId,separators=[]}={}){
  const chars=Array.from(text),host=el("div",null,{class:"document-transcript","data-testid":testid});
  const rows=segments.length?segments:[{start:0,end:chars.length,source_id:sourceId}];let end=0;
  for(const [i,segment] of rows.entries()){
    const join=segment.start===end||separators.some(gap=>gap.raw_start===end&&gap.raw_end===segment.start&&chars.slice(end,segment.start).join('')===gap.text);
    if(!Number.isInteger(segment.start)||!Number.isInteger(segment.end)||!join||segment.end<segment.start||segment.end>chars.length)throw Error("Document segment boundaries do not replay.");
    end=segment.end;
    const label=originBoundary(segment,i);
    const section=el("section",null,{class:"transcript-segment","data-source-id":segment.source_id||sourceId||""}),boundary=el("h3",`${label.label} / ${documentId||"Source document"}`,{class:"transcript-boundary","data-testid":"transcript-boundary","data-boundary-kind":label.kind});
    section.append(boundary);
    const clipped=anchors.filter(a=>a.start<segment.end&&a.end>segment.start).map(a=>{const start=Math.max(a.start,segment.start),stop=Math.min(a.end,segment.end);return {start:start-segment.start,end:stop-segment.start,text:chars.slice(start,stop).join("")};});
    section.dataset.rawStart=String(segment.start);section.dataset.rawEnd=String(segment.end);
    section.append(highlightedText(chars.slice(segment.start,segment.end).join(""),clipped,{class:"source-document transcript-text","data-testid":"transcript-text",rawText:testid==='origin-document'}));host.append(section);
  }
  if(end!==chars.length)throw Error("Document segment inventory omits source text.");
  return host;
}
function scrollToSource(){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const drawer=$("#detail-drawer");if(!drawer.open)return;
    const source=drawer.querySelector('[data-testid="origin-document"] [data-testid="origin-pdf-pair"]')||drawer.querySelector(".document-transcript mark,[data-testid=source-document] mark")||drawer.querySelector("[data-source-selected=true] .transcript-boundary")||drawer.querySelector(".transcript-boundary");
    source?.scrollIntoView({block:"start",behavior:"instant"});
  }));
}

function inspectRow(id,text,meta,fn,attrs={}) { const b=button("",fn,"inspect-row",attrs);b.append(el("span",id,{class:"row-id"}),el("span",text,{class:"row-copy"}));if(meta)b.append(el("span",meta,{class:"row-meta"}));return b; }
// BEGIN_PLAIN_READING_TEXT
function plainReadingText(r={}, {local=false}={}){
  if(local)return readingExplanation(r,{local:true});
  const attachment=r.attachment_quote||list(r.attachment_spans).find(span=>typeof span.text==='string')?.text;
  const near=attachment?' near '+JSON.stringify(attachment):'';
  const descriptions={adjectival:'A description could fit here',modifier:'A description could fit here',
    nominal:'A noun phrase could fit here',noun_phrase:'A noun phrase could fit here',possessive:'A possessive phrase could show whose or which',
    nominal_specifier:'A word or phrase could specify which or how many',quantity:'A quantity could fit here',
    verbal:'A verb phrase could complete the action',finite_clause:'A clause with its own subject and verb could fit here',
    clausal:'A clause could fit here',nonfinite_clause:'A clause without a finite verb could fit here',
    adverbial:'A phrase could describe how, when or where',prepositional:'A prepositional phrase could fit here'};
  return (descriptions[r.form||r.outer_family]||'The visible grammar allows this possible reading')+near+'.';
}
// END_PLAIN_READING_TEXT
function readingText(r) { return plainReadingText(r,{local:state.arm==='C'}); }
function readingControl(testid) {
  const panel=el("section",null,{class:"reading-master","data-testid":"reading-master",id:"reading-thoughts",hidden:"",tabindex:"-1"});
  panel.append(heading("What could fit here?"),note("Choose an interpretation with recorded candidates. Grammar alone is not evidence."));
  const visible=displayReadingRows();
  for(const [index,row] of visible.entries()){
    const r=list(state.saved.plan?.slot_readings).find(r=>r.id===row.reading.id)||row.reading;
    const b=button("",async()=>{state.reading=row.reading.id;state.candidate="";await changeReading();const chooser=$("#reading-thoughts");if(chooser){chooser.hidden=false;$("[data-testid=reading-choice][aria-pressed=true]")?.focus({preventScroll:true});}},"reading-thought",{"data-testid":"reading-choice","data-reading-id":row.reading.id,"aria-pressed":state.reading===row.reading.id});
    b.append(el("span",'Interpretation '+(index+1),{class:"eyebrow"}),el("p",readingText(r)));
    if(livePacket)b.append(el('small',`${list(row.candidates).length} recorded candidates / rank is not acceptance`,{'data-testid':'reading-candidate-count'}));
    panel.append(b);
  }
  panel.append(button("Reading details",()=>{const r=list(state.saved.plan?.slot_readings).find(r=>r.id===state.reading)||currentReading()?.reading;if(r)readingDetail(r);},"quiet"));return panel;
}
function readingDetail(r) {
  const body=box(note(readingText(r)),note(`${ARMS[state.arm].origin}. This is an interpretation of visible input text, not an answer or a support verdict.`,"notice"),fields([["Form",r.form],["Role",r.role],["Referent kind",r.target_kind||r.referent_kind],["Number",r.grammatical_number],["Finite clause",r.finite]]));
  for(const [label,text] of [["Left boundary",r.left_quote],["Right boundary",r.right_quote],["Attachment cue",r.attachment_quote],["Kind cue",r.kind_cue_quote]])if(text)body.append(heading(label),el("blockquote",text,{class:"cue"}));
  openDrawer("Interpretation",ARMS[state.arm].name,body);
}
function openReadingThoughts(){
  const panel=$("#reading-thoughts");if(!panel)return;
  panel.hidden=!panel.hidden;
  $("[data-testid=atom-focal-mask]")?.setAttribute("aria-expanded",String(!panel.hidden));
  if(!panel.hidden)panel.focus({preventScroll:true});
}
function renderPlan(){
  const s=stage("02","Facts to look for","Input"),plan=state.saved.plan||{},cards=el("div",null,{class:"fact-cards"});
  const failure=failureReceipt();if(failure)s.body.append(failure);
  for(const [index,atom] of list(plan.atoms).entries()){
    const text=atom.text||atom.source_quote||atom.id,marker=state.row.case.focal_marker,at=marker?text.indexOf(marker):-1;
    const focal=at>=0,card=el("article",null,{class:"fact-card"+(focal?" is-focal":""),"data-testid":"plan-atom","data-atom-id":atom.id});
    card.append(el("span",'F'+(index+1),{class:"eyebrow",title:atom.id}));
    const copy=el("p");
    appendInputView(copy,text,{focalMarker:marker,focalNode:()=>button('[REDACTION]',openReadingThoughts,"atom-mask",{"data-testid":"atom-focal-mask","aria-expanded":"false","aria-controls":"reading-thoughts",disabled:displayReadingRows().length?null:""})});
    card.append(copy,button("i",()=>atomDetail(atom),"fact-inspect",{"aria-label":"Inspect fact "+atom.id,title:"Inspect fact "+atom.id}));cards.append(card);
  }
  s.body.append(note("Input assertions, not established facts."),cards);
  if(!list(plan.atoms).length)s.body.append(note("No facts available.","empty"));
  if(displayReadingRows().length){
    const r=list(plan.slot_readings).find(r=>r.id===state.reading)||currentReading()?.reading;
    const summary=button("",openReadingThoughts,"active-reading-thought",{"data-testid":"plan-reading-select","aria-controls":"reading-thoughts"});
    summary.append(el("small",`Active ${state.arm==='B'?"branch":"reading"}`),el("span",state.arm==='B'?"Inspect the saved source-phrase branch":readingText(r)));
    s.body.append(summary,readingControl("plan-reading-select"));
  }
  const details=button("Search plan details",()=>{const audit=renderPlanAudit();openDrawer("Saved search plan",ARMS[state.arm].origin,audit.querySelector(".stage-body"));},"quiet");s.body.append(details);return s.outer;
}
function usedProofs(item){return decisionProofs(item,newDecision(item));}
function quoteCard(proof){
  const refs=proof.digest_ids?.join(', ')||(/^S\d+$/.test(proof.id||'')?proof.id:'');
  const b=el('article',null,{class:'exact-quote'}),bar=el('header',null,{class:'quote-toolbar'});
  bar.append(el("small",[refs,...list(proof.atom_ids)].filter(Boolean).join(' / ')||'Selected evidence'));
  const matchingPaths=list(state.trace?.paths).filter(path=>
    (!proof.atom_ids?.length||proof.atom_ids.includes(path.query_atom_id)||proof.atom_ids.includes(path.candidate_or_atom_id))&&
    list(path.decision_source_refs?.length?path.decision_source_refs:path.source_refs).some(p=>typeof p==='object'&&p.canonical_page_id===proof.canonical_page_id&&p.page_sha256===proof.page_sha256&&p.start===proof.start&&p.end===proof.end&&p.text===proof.text));
  const graphPaths=matchingPaths.filter(path=>sourceGraphHops(state.trace,path)>1);
  const path=graphPaths[0]||matchingPaths[0];
  if(path){
    if(graphPaths.length&&!livePacket){const hops=sourceGraphHops(state.trace,graphPaths[0]);bar.append(button('View on KG ('+hops+' source-graph hops)',()=>openSelectedEvidenceKG(proof,graphPaths),'quote-kg',{'data-testid':'quote-view-on-kg','data-source-graph-hops':String(hops)}));}
    const roles=evidenceRoles(matchingPaths.map(path=>path.direction));
    b.dataset.tone=roles.palette;b.dataset.evidenceRoles=roles.palette;
    bar.title=roles.description;
  }
  if(!bar.querySelector('.quote-kg'))bar.append(button('View on KG',()=>openEvidenceInspection(proof),'quote-kg',{'data-testid':'quote-view-on-kg','data-route-mode':'POSTSELECTION_SOURCE_INSPECTION'}));
  const text=button('',()=>sourceDrawer(proof),'excerpt-text',{"data-testid":"used-source-quote","data-source-id":proof.canonical_page_id,"data-document-id":proof.document_id,"data-digest-ids":proof.digest_ids?.join(' '),'aria-label':'Inspect source'});
  text.append(el('blockquote',readable(proof.text),{'data-original-text':proof.text}),el('footer',sourceLocation({...proof,corpus:proof.corpus||state.row.case.corpus})));
  b.append(bar,text);return b;
}
// BEGIN_SELECTED_EVIDENCE_KG
async function openSelectedEvidenceKG(proof,paths){
  paths=paths.filter(path=>sourceGraphHops(state.trace,path)>1);if(!paths.length)return;
  const savedPath=paths.find(path=>state.trace?.paths?.includes(path));
  if(savedPath){
    const siblings=state.trace.paths.filter(path=>path.candidate_or_atom_id===savedPath.candidate_or_atom_id);
    guidePath({candidate:{id:savedPath.candidate_or_atom_id},route:{...savedPath,nodes:[]},
      route_index:siblings.findIndex(path=>path.id===savedPath.id),proof});
    return;
  }
}
const SOURCE_INSPECTION_PINS={cib:'006f944a08c38fa10d898dc19a28c706e4cf3a01b2fba99afb842a1d05385b15',
  iran:'fd35f3aa6131edd0b4027ac4fbe23249ead78b0a6b97c71654ed8b7b681b7260',
  vietnam:'d7ab02e78974462334e9c6d5db6bc1b5db119fd940b72e829906d25bf9347c3b'};
async function openEvidenceInspection(proof){
  const c=state.row.case,record=state.saved,epoch=state.epoch,binding=currentSourcePacket()?.source_method_handle
    ?liveSourceInspectionBinding(currentSourcePacket().source_method_handle):state.row.resource_binding||currentBinding(c.case_id,c.corpus);
  const scope=selectedSourceScope(c),policy=scope.source_view_policy,body=box('workbench-kg-inspection');body.dataset.testid='workbench-kg-inspection';
  const drawerEpoch=openDrawer('KG Navigator','Selected evidence',body),controller=new AbortController();state.inspectionRequest=controller;
  const assertCurrent=()=>{if(epoch!==state.epoch||record!==state.saved||drawerEpoch!==state.drawerEpoch||!$('#detail-drawer').open)throw new DOMException('Inspection changed','AbortError');};
  try{
    state.inspectionMount=await mountEvidenceInspection({host:body,caseInfo:c,config:ARMS[state.arm].key,binding,
      facts:list(record.plan?.atoms),proof,sourcePolicy:policy,signal:controller.signal,assertCurrent,
      sourceIndex:policy.id==='later_release_inclusive'?null:
        {url:'./data/source-inspection-v1/'+c.corpus+'/manifest.json',content_sha256:SOURCE_INSPECTION_PINS[c.corpus]},
      getSourcePage:async selected=>{
        const response=await getJSON('/api/current/source-v6?'+caseQuery({source_id:selected.canonical_page_id}),{signal:controller.signal});assertCurrent();
        return currentSourcePacket()?{...response,resource_binding:binding,source_view_policy:policy,cutoff:c.date,whole_origin_excluded:scope.whole_origin_excluded}:response;
      },
      getNode:async id=>{
        if(livePacket)return null;
        const path='/api/current/node-v6?'+caseQuery({node_id:id}),url=localURL(path);
        if(!globalThis.PublicReplay.hasSaved(url))return null;
        return getJSON(path,{signal:controller.signal});
      },onSource:sourceDrawer});
  }catch(error){if(error.name!=='AbortError'&&drawerEpoch===state.drawerEpoch){body.replaceChildren(note(error.message,'error-card'),button('Inspect selected source',()=>sourceDrawer(proof)));}}
}
// END_SELECTED_EVIDENCE_KG
function renderDiffusion(){
  const s=stage("03","Facts to evidence","Source map");
  s.body.append(el("div",null,{id:"diffusion-v6","data-testid":"flow-host"}));
  return s.outer;
}
function liveRetrievalNote(){
  return note(livePacket.retrieval_summary.text+' Relevance and inspection are not factual support. Diffusion is retrieval influence, not a candidate score.','notice');
}
function renderLiveSearchMap(){
  const host=el('div',null,{'data-testid':'live-search-map'}),data=livePacket.retrieved_sources;
  host.append(heading('Recorded atom searches'),note('Recorded search-to-inspected-page matches only; these are not graph edges or support votes.'));
  if(!data.pages.length){host.append(note('This envelope contains no verified inspected source text. Only retrieval counts can be shown.','empty'));return host;}
  for(const [index,search] of data.searches.entries()){
    const row=el('details',null,{'data-search-id':search.id});
    row.open=index===0;
    row.append(el('summary',(search.atom_ids.join(', ')||search.id)+' / '+search.query));
    const pages=data.pages.filter(page=>page.matches.some(match=>match.search_id===search.id));
    for(const page of pages){
      const label=[page.document_id,page.date,page.earlier_page?'Page '+page.earlier_page:page.id].join(' / ');
      row.append(page.citation?button(label,()=>sourceDrawer(page.citation),'quiet'):note(label));
    }
    if(!pages.length)row.append(note('No matching inspected page is retained for this search. Other search hits are not presented as inspected.'));
    host.append(row);
  }
  if(!data.searches.length)host.append(note('Exact atom search records were not supplied. No associations are inferred.'));
  return host;
}
function renderLiveRetrievedSources(){
  const host=el('section',null,{'data-testid':'live-retrieved-sources'}),data=livePacket.retrieved_sources;
  host.append(heading('Retrieved sources'),liveRetrievalNote(),note('Run-wide inspected pages, not evidence for a selected reading. Exact unmasked excerpts from hash-verified pages; a match is search relevance, not a claim or candidate decision. Open an excerpt for the supplied source document.'));
  if(!data.pages.length){
    host.append(note('This older envelope supplies no inspected source text to verify. Retrieval counts above do not imply that no search occurred.','empty'));return host;
  }
  const grid=el('div',null,{class:'matched-quotation-grid'});host.append(grid);
  let shown=0;
  const more=button('More inspected pages',()=>append(),'quiet');
  const append=()=>{
    const end=Math.min(shown+8,data.pages.length);
    for(;shown<end;shown++){
      const page=data.pages[shown],card=el('article',null,{class:'exact-quote','data-testid':'retrieved-source','data-source-id':page.id});
      card.style.overflowWrap='anywhere';card.style.padding='12px';card.style.gap='8px';
      const title=el('h4',[page.document_id,page.date,page.earlier_page?'Page '+page.earlier_page:null].filter(Boolean).join(' / '));title.style.margin='0';card.append(title);
      const atomIds=[...new Set(page.matches.flatMap(match=>match.atom_ids))];
      const matches=el('details');matches.append(el('summary',page.matches.length?`${atomIds.join(', ')} / ${page.matches.length} recorded atom searches / relevance only`:'Inspected page / no retained atom match'));
      for(const match of page.matches){
        const item=el('p',null,{'data-search-id':match.search_id});
        item.append(el('strong',match.atom_ids.join(', ')+' / '),document.createTextNode(match.query),
          el('small',` ${match.basis}; BM25 ${formatNumber(match.bm25)} (relevance, not support).`));matches.append(item);
      }
      card.append(matches);
      if(page.citation){
        const open=button('',()=>sourceDrawer(page.citation),'excerpt-text',{'data-testid':'retrieved-source-quote','aria-label':'Inspect retrieved source / not selected evidence'});
        open.style.height='auto';
        // Do not apply reader casing or paragraph expansion to an exact preview.
        open.append(el('blockquote',page.citation.text,{'data-original-text':page.citation.text}),el('footer','Open full supplied source'));card.append(open);
      }else card.append(note('No nonempty unmasked excerpt is available.'));
      grid.append(card);
    }
    more.hidden=shown>=data.pages.length;
    more.textContent=`More inspected pages / ${data.pages.length-shown}`;
  };
  append();host.append(more);return host;
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
    if(!livePacket&&(envelope.version!=='narrative-saved-flow/1'||envelope.case_id!==expected.case_id||envelope.config!==expected.config||envelope.reading_id!==expected.reading_id||envelope.query_sha256!==expected.query_sha256||canonicalGateJSON(envelope.native_checkpoint)!==canonicalGateJSON(expected.native_checkpoint)||canonicalGateJSON(envelope.resource_binding)!==canonicalGateJSON(expected.resource_binding)||!['narrative-local-execution/2','narrative-local-execution/3','narrative-local-execution/4'].includes(envelope.native_version)||envelope.execution_kind!=='saved_narrative'||envelope.current_native_execution!==false||envelope.numerical_projection_available!==false||envelope.native_decisions_or_ranks_modified!==false||envelope.frames!=null||envelope.projection!=null))throw Error('The narrative flow envelope changed its exact saved execution or source binding.');
    if(!livePacket&&envelope.available!==true){
      if(envelope.trace!=null)throw Error('An unavailable narrative trace must not include substituted steps.');
      state.trace=null;host.dataset.status='unavailable';host.replaceChildren(note('No saved trace or graph route is published for this execution.','empty'));renderPaths();return;
    }
    const trace=livePacket?{...livePacket.trace,reading_id:state.reading}:narrativeUI.validateTrace(envelope,expected);state.trace=trace;host.dataset.status='available';host.dataset.readingId=state.reading;
    if(livePacket&&(!trace.paths.length||state.row.case.task==='redaction'&&!candidates().length)){
      state.flow?.destroy();state.paths?.destroy();
      host.replaceChildren(liveRetrievalNote(),renderLiveSearchMap(),note('No final evidence path is shown for this selection. The recorded searches above are not a reconstructed graph.'));
      paths.replaceChildren();state.paths=null;renderPaths();renderNarrativeScores();viewportAnchor.schedule();return;
    }
    const pageLookups=!livePacket&&state.row.case.task==='redaction'?await loadSourceLookups({
      row:catalogCases().find(row=>row.case.case_id===state.row.case.case_id),record:state.saved,trace,
      reportSHA:publicationByteHashes.get(state.report),config:ARMS[state.arm].key,reading:state.reading}):null;
    if(epoch!==state.epoch||!host.isConnected)return;
    const safe=fn=>(...args)=>{if(epoch===state.epoch)fn(...args);};
    state.flow?.destroy();state.paths?.destroy();
    let mapHost=host;
    if(livePacket){mapHost=el('div');host.replaceChildren(liveRetrievalNote(),mapHost);}
    state.flow=mountEvidenceMap(mapHost,{trace,plan:state.saved.plan,items:flowItems(),task:state.row.case.task,pageLookups,
      nativeCandidates:currentReading()?.candidates||[],formatText:readable,onSource:safe(sourceDrawer),onNode:safe(value=>{
      if(value.is_graph_node===true){void nodeDrawer(value,{navigation:false});return;}
      if(value.id&&list(state.saved.plan?.atoms).some(atom=>atom.id===value.id)){atomDetail(value);return;}
      const body=box(note(value.label||value.text||value.name||'Input lookup'));
      if(value.citation)body.append(sourceButton(value.citation));openDrawer('Saved trace object','Recorded input or source readout',body);
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
      const lookup=trace.sources||trace.source_refs_by_id||{},raw=list(path.decision_source_refs?.length?path.decision_source_refs:path.source_refs)[0],proof=typeof raw==='string'?lookup[raw]:raw;
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
  const record=state.saved,c={...state.row.case,source_view_policy:state.saved.result?.source_view_policy||state.saved.source_view_policy},reading=state.reading,binding=state.row.resource_binding||record.resource_binding;
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
  return {...endpoint,href:graphURL({node_id:endpoint.node_id,source_id:endpoint.quote.canonical_page_id,focus_graph_id:endpoint.graph_id,focus_hierarchy_id:endpoint.hierarchy_id})};
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
  const s=stage("04",livePacket?"Retrieved sources and selected evidence":"Selected evidence","Sources");s.outer.dataset.testid="paths-stage";
  s.outer.dataset.readingId=state.reading;
  s.body.append(el("div",null,{id:"retrieval-paths-v6"}));queueMicrotask(renderPaths);return s.outer;
}
function renderPaths(){
  const host=$("#retrieval-paths-v6");if(!host)return;host.replaceChildren();
  host.dataset.readingId=state.reading;
  if(livePacket)host.append(renderLiveRetrievedSources(),heading('Selected evidence'));
  const items=state.row.case.task==='redaction'?candidates():list(state.saved.result?.atoms).filter(a=>verdictSummary(state.saved,state.row.case,state.reading).units.some(u=>u.id===a.id));
  if(state.row.case.task!=='redaction'){
    for(const item of items){
      const section=el('section',null,{class:'fact-evidence-group','data-atom-id':item.id});
      const index=list(state.saved.plan?.atoms).findIndex(atom=>atom.id===item.id);
      section.append(el('h3',(index>=0?'F'+(index+1)+' / ':'')+readable(item.text||item.source_quote||item.id)));
      const proofs=factPresentationProofs(item,newDecision(item)).map(proof=>({...proof,atom_ids:[item.id]})),grid=el('div',null,{class:'matched-quotation-grid'});
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
  const corpusOnly=corpusOnlyProposalExecution(state.saved,proposalPoolCache.get(state.saved)?.view);
  const poolPresent=task==='redaction'&&state.saved.result?.proposal_pool!=null&&!corpusOnly,poolLead=poolPresent?currentProposalReading()?.proposals[0]:null;
  const legacyPrimary=corpusOnly||state.saved.result?.input_nomination==null?null:studyInputPrimary(state.saved,state.row.case,state.row,inputContextCache.get(state.saved)?.view,state.reading);
  const primary=poolPresent?(poolLead?.proposal.provenance==='INPUT'?{available:true,fill:poolLead.proposal.fill,channel:'input_nomination'}:null):legacyPrimary;
  const hero=el('section',null,{class:'construction-verdict verdict-strip','data-tone':primary?'context':summary.tone,'data-testid':'compact-verdict','aria-label':'Verdict','data-primary-channel':primary?.channel});
  const compatibilityEmpty=emptyControllerShortlist();
  if(primary){
    hero.append(el('p','From supplied context',{class:'eyebrow','data-testid':'study-primary-channel'}),
      el('h2',primary.available?'Exploratory suggestion: '+primary.fill:'Exploratory suggestion unavailable',{'data-testid':'local-verdict-title'}),
      note('Input-derived only, not independent corpus recovery or factual support. Corpus evidence decisions and scores remain separate.'));
    const inspection=legacyPrimary?.available&&(!poolPresent||legacyPrimary.nomineeId===poolLead?.proposal.input_nomination_id)?
      studyInspection(legacyPrimary,state.saved,state.row.case,state.row):null;
    if(inspection){
      const target=new URL(graphURL(inspection),location.href);target.searchParams.set('release',inspection.release);
      const inspect=link('Inspect source connection',target.href,'button');inspect.dataset.testid='study-source-inspection';
      inspect.dataset.sourceDocument=inspection.document_id;inspect.dataset.sourcePage=inspection.source_id;
      inspect.dataset.pageSha256=inspection.page_sha256;hero.append(inspect,
        note('Retrospective inspection of the origin document in the separate later-release Corpus Map. Not ordinary retrieval proof, an identity join or a confidence score.'));
    }
  }else{
    const nativeReader=readerRedactionVerdict(summary),reader=nativeReader?.tier==='stance'?nativeReader:
      poolLead?(readerEvidenceState(poolLead.proposal.status)||nativeReader):nativeReader;
    hero.dataset.readerTier=compatibilityEmpty?'unavailable':reader?.tier||'';
    hero.append(el('p','Verdict',{class:'eyebrow'}),el('h2',compatibilityEmpty?'Compatibility unresolved':livePacket?.retrieval_summary.noCandidate?'No candidate passed':reader?.title||reader?.label||summary.title,
      {'data-testid':'local-verdict-title','data-native-title':summary.title}));
    if(reader?.tier==='none'&&!compatibilityEmpty&&!livePacket?.retrieval_summary.noCandidate)hero.append(note('No supporting or contextual evidence is recorded for a fill in this reading.'));
  }
  if(compatibilityEmpty)hero.append(note(controllerWithholdingEmptyText(compatibilityEmpty)));
  if(livePacket)hero.append(liveRetrievalNote());
  if(poolPresent&&!primary&&poolLead)hero.append(el('p','Top proposal: '+readable(poolLead.proposal.fill),{class:'recommended-fill','data-testid':'recommended-fill'}));
  else if(!poolPresent&&!primary&&summary.recommendation)hero.append(el('p',readable(summary.recommendation.text),{class:'recommended-fill','data-testid':'recommended-fill'}));
  else if(!poolPresent&&!primary&&task==='redaction'){
    const first=candidates()[0];
    if(first){
      const label=decisionLabel(newDecision(first)),same=label===readerRedactionVerdict(summary)?.title;
      hero.append(el('p','Top candidate: '+readable(first.fill)+(same?'':' / '+label),{class:'first-saved-fill','data-testid':'first-saved-fill'}));
    }
  }
  if(task==='redaction'){const scope=counterPolicyScopeNote();if(scope)hero.append(scope);}
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
  hero.append(button(primary?'Corpus evidence decision':'Why this verdict',()=>openDrawer('Recorded evidence decision','Saved evidence checks',localVerdictPanel()),'quiet'));
  return hero;
}
// BEGIN_NATIVE_INPUT_CONTEXT
async function nativeInputContextView(record,caseInfo){
  const value=record?.result?.input_nomination;
  if(value==null)return null;
  const check=ok=>{if(!ok)throw Error('The supplied-context record has another input, reading or provenance binding.');};
  const hash=object=>sha256(new TextEncoder().encode(canonicalGateJSON(object)));
  const same=(a,b)=>canonicalGateJSON(a)===canonicalGateJSON(b);
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const provenance='ANALYST_INPUT_NOT_INDEPENDENT_CORPUS_EVIDENCE';
  const noEvidence=value=>object(value)&&value.independent_corpus_evidence===false&&value.independent_evidence_votes===0&&
    value.substantive_support===false&&value.same_actor_or_event_certified===false&&value.same_delegation_identity_certified===false;
  check(value.version==='public-input-noun-adjective-nomination/1'&&value.provenance_kind===provenance&&noEvidence(value)&&
    value.output_contract==='ASSIGN_ONLY_TO_RESULT_INPUT_NOMINATION_NOT_CORPUS_CANDIDATES_OR_SCORES'&&
    value.input_sentence_policy==='COMPLETE_VISIBLE_SENTENCE_NO_OPAQUE_MASKS'&&
    value.ranking_policy==='LEXICOGRAPHIC_SENTENCE_DISTANCE_CHARACTER_DISTANCE_RAW_SPAN_STABLE_FORM'&&
    value.ranking_is_confidence===false&&value.ranking_is_semantic_identity===false&&value.empty_readings_are_not_padded===true&&
    value.corpus_retrieval_or_admission_performed===false&&value.source_policy_modified===false&&
    value.native_corpus_recovery_claimed===false&&value.corpus_candidates_or_scores_modified===false&&value.api_calls===0);
  const c=Object.fromEntries(['case_id','corpus','task','query','document_id','date','focal_marker'].map(key=>[key,caseInfo?.[key]]));
  check(c.task==='redaction'&&typeof c.query==='string'&&typeof c.focal_marker==='string'&&c.focal_marker);
  const parts=c.query.split(c.focal_marker);check(parts.length===2);
  const querySHA=await hash(c.query),binding=value.binding,packet=record.plan?.readings_packet;
  const nativePins=[record.result.provided_plan_sha256,record.result.reading_adapter?.source_plan_sha256].filter(pin=>pin!=null);
  check(nativePins.every(pin=>/^[a-f0-9]{64}$/.test(pin)&&pin===nativePins[0]));
  const planSHA=nativePins[0]||await hash(record.plan);
  check(object(binding)&&binding.query_sha256===querySHA&&binding.case_sha256===await hash(c)&&binding.plan_sha256===planSHA&&
    packet&&binding.readings_packet_sha256===await hash(packet)&&
    binding.lexical_policy_version==='source-noun-slot-adjective-realization/2'&&binding.final_form_version==='narrative-completed-outer-form/2');
  const declared=packet.readings,rows=value.readings,chars=Array.from(c.query);
  check(Array.isArray(declared)&&Array.isArray(rows)&&rows.length===declared.length&&new Set(declared.map(r=>r.id)).size===declared.length);
  const span=raw=>{
    check(object(raw)&&raw.query_sha256===querySHA&&raw.provenance_kind===provenance&&
      Number.isSafeInteger(raw.start)&&Number.isSafeInteger(raw.end)&&raw.start>=0&&raw.end>raw.start&&raw.end<=chars.length&&
      typeof raw.text==='string'&&chars.slice(raw.start,raw.end).join('')===raw.text);return raw;
  };
  const contains=(outer,inner)=>outer.start<=inner.start&&inner.end<=outer.end;
  const observation=raw=>{
    check(object(raw));const noun=span(raw.input_noun_span),part=span(raw.input_constituent_span),sentence=span(raw.input_sentence_span);
    check(contains(sentence,part)&&contains(part,noun));
    const cls=raw.input_class_observation;
    check(object(cls)&&cls.basis==='INPUT_PARSER_NORP_OR_EXACT_PERSON_SPAN_NOT_PLANNER_TYPE_HINT'&&
      cls.lexical_resource_does_not_certify_ner===true&&cls.ambiguity_resolved===false&&cls.identity_certified===false&&cls.factual_support_certified===false&&
      Array.isArray(cls.norp_observations)&&Array.isArray(cls.person_observations)&&cls.norp_observations.length+cls.person_observations.length>0);
    for(const witness of [...cls.norp_observations,...cls.person_observations])check(contains(sentence,span(witness))&&contains(witness,noun));
    return noun;
  };
  const corpusRows=list((record.result.redaction||record.result).readings),seen=new Set(),view=[];
  let count=0;
  for(let index=0;index<rows.length;index++){
    const row=rows[index],reading=declared[index],readingSHA=await hash(reading);
    check(typeof reading.id==='string'&&reading.id&&row.reading_id===reading.id&&row.declared_reading_sha256===readingSHA&&
      typeof row.applicable==='boolean'&&Array.isArray(row.nominations));
    check(row.status===(row.nominations.length?'INPUT_CONTEXT_NOMINATIONS':row.applicable?'NO_INPUT_DERIVED_NOMINATIONS':'NOT_APPLICABLE'));
    const items=[];
    for(const [ordinal,item]of row.nominations.entries()){
      check(row.applicable&&object(item)&&typeof item.id==='string'&&item.id&&!seen.has(item.id)&&
        item.reading_id===reading.id&&item.declared_reading_sha256===readingSHA&&typeof item.fill==='string'&&item.fill.trim()&&
        item.provenance_kind===provenance&&item.status==='INPUT_DERIVED_GRAMMATICAL_CONTEXT_ONLY'&&noEvidence(item)&&
        item.coreference_inference_performed===false&&item.corpus_citation===null&&item.corpus_score===null&&item.factual_decision===null);
      seen.add(item.id);const noun=observation(item),lex=item.lexical_realization,rank=item.ranking,fit=item.surface_fit;
      check(object(rank)&&rank.scope==='INPUT_CONTEXT_ONLY_NOT_CORPUS_RANK_OR_CONFIDENCE'&&rank.input_context_ordinal===ordinal+1&&
        ['sentence_distance','character_distance'].every(key=>Number.isSafeInteger(rank[key])&&rank[key]>=0));
      check(object(lex)&&lex.version===binding.lexical_policy_version&&lex.context_only===true&&lex.identity_or_event_certified===false&&
        lex.factual_support_certified===false&&same(lex.resource,value.lexical_resource)&&lex.resource?.resource==='WordNet'&&
        lex.resource.version==='3.0'&&lex.resource.availability==='AVAILABLE'&&/^[a-f0-9]{64}$/.test(lex.resource.sha256||'')&&
        lex.resource.named_entity_identity_lookup===false&&lex.resource.relation_scope==='LEXICAL_CLASS_MEMBERSHIP_AND_PERTAINYM_ONLY');
      const form=lex.selected_form,edit=lex.transformations?.[0];
      check(object(form)&&typeof form.fill==='string'&&Array.isArray(form.derivations)&&form.derivations.length>0&&
        form.operation==='PERSON_NOUN_MEMBER_HOLONYM_TO_ADJECTIVE_PERTAINYM'&&edit?.kind===form.operation&&
        edit.before===noun.text&&edit.after===form.fill&&same(edit.derivations,form.derivations)&&edit.grammar_only===true&&
        edit.input_text_modified===false&&edit.source_evidence_credit===false&&edit.identity_or_event_certified===false);
      check(Array.isArray(item.input_occurrences)&&item.input_occurrences.length>0&&same(item.input_occurrences[0].input_noun_span,noun));
      for(const occurrence of item.input_occurrences)observation(occurrence);
      check(fit?.version===binding.final_form_version&&fit.state==='pass'&&fit.outer_family===reading.outer_family&&
        fit.reading_modified===false&&fit.pos_coercion===false&&fit.factual_support_certified===false&&
        fit.unlicensed_form_is_counterevidence===false&&fit.full_english_grammar_certified===false&&
        same(fit.inserted_span,[Array.from(parts[0]).length,Array.from(parts[0]+item.fill).length])&&
        fit.completed_query_sha256===await hash(parts[0]+item.fill+parts[1]));
      items.push({id:item.id,fill:item.fill,source:noun,inputRank:rank.input_context_ordinal,proof:item});count++;
    }
    view.push({id:reading.id,label:readingLabel(reading,index+1),explanation:plainReadingText(reading),
      corpusAvailable:corpusRows.filter(row=>row.reading?.id===reading.id).length===1,candidates:items});
  }
  check(value.status===(count?'INPUT_CONTEXT_NOMINATIONS':'NO_INPUT_DERIVED_NOMINATIONS'));
  return {version:'input-context-view/1',query:c.query,readings:view};
}
// END_NATIVE_INPUT_CONTEXT
function renderSuppliedContext(){
  const cached=inputContextCache.get(state.saved);
  if(cached?.error)return note(cached.error,'notice');
  const record=state.saved;
  return renderInputContextView(cached?.view,{activeReadingId:state.reading,onReading:async id=>{
    if(record!==state.saved||!readingRows().some(row=>row.reading?.id===id))return;
    state.reading=id;state.candidate='';await changeReading();stagePosition('05');
  }});
}
// BEGIN_INPUT_CONTEXT_VIEW
// Private presentation view, not the native input_nomination serialization.
function renderInputContextView(view,{activeReadingId,onReading}={}){
  if(view==null)return null;
  const check=value=>{if(!value)throw Error('A complete, bound supplied-context presentation is required.');};
  check(view.version==='input-context-view/1'&&typeof view.query==='string'&&Array.isArray(view.readings));
  const chars=Array.from(view.query),seen=new Set();
  for(const reading of view.readings){
    check(typeof reading.id==='string'&&reading.id&&!seen.has(reading.id)&&typeof reading.label==='string'&&
      typeof reading.explanation==='string'&&typeof reading.corpusAvailable==='boolean'&&Array.isArray(reading.candidates));seen.add(reading.id);
    const ids=new Set();
    for(const item of reading.candidates){
      const source=item.source;
      check(typeof item.id==='string'&&item.id&&!ids.has(item.id)&&typeof item.fill==='string'&&item.fill.trim()&&
        source&&Number.isSafeInteger(source.start)&&Number.isSafeInteger(source.end)&&source.start>=0&&source.end>source.start&&
        source.end<=chars.length&&typeof source.text==='string'&&chars.slice(source.start,source.end).join('')===source.text&&
        (item.inputRank==null||Number.isSafeInteger(item.inputRank)&&item.inputRank>0)&&item.proof&&typeof item.proof==='object');
      ids.add(item.id);
    }
  }
  if(!view.readings.some(reading=>reading.candidates.length))return null;
  const host=el('section',null,{class:'method-audit','data-testid':'input-context-nominations','aria-label':'From the supplied context'});
  host.append(heading('From the supplied context'),note('These suggestions come from the text you supplied, not independent corpus evidence. They are separate from corpus candidates, rankings, scores and evidence decisions. A grammar fit does not establish identity or verify the input claim.'));
  for(const reading of view.readings.filter(reading=>reading.candidates.length)){
    const group=el('section',null,{'data-testid':'input-context-reading','data-reading-id':reading.id,'data-current-reading':String(reading.id===activeReadingId)});
    group.append(el('h4',reading.label),note(reading.explanation));
    if(reading.id===activeReadingId)group.append(note('This is the currently selected corpus reading.','scope-line'));
    else if(reading.corpusAvailable&&typeof onReading==='function')group.append(button('Open this reading in corpus results',()=>onReading(reading.id),'quiet',{'data-testid':'input-context-open-reading','data-reading-id':reading.id}));
    else group.append(note('No matching corpus-reading view is available. No other reading is substituted.','scope-line'));
    for(const item of reading.candidates){
      const card=el('article',null,{class:'method-audit','data-testid':'input-context-candidate','data-input-nominee-id':item.id,'data-reading-id':reading.id});
      card.append(el('strong',item.fill),badge('Input-derived exploratory / truth unknown','review'));
      if(item.inputRank!=null)card.append(note('Input-only order: '+item.inputRank+'. This is not a corpus rank.','scope-line'));
      card.append(note('Supplied wording: "'+item.source.text+'".'));
      const start=Math.max(0,item.source.start-100),end=Math.min(chars.length,item.source.end+140);
      const quote=el('blockquote',null,{class:'cue','data-testid':'input-context-snippet','data-input-start':start,'data-input-end':end});
      quote.style.whiteSpace='pre-wrap';quote.style.overflowWrap='anywhere';
      const mark=el('mark',item.source.text,{'data-input-start':item.source.start,'data-input-end':item.source.end});
      quote.append(document.createTextNode((start?'...':'')+chars.slice(start,item.source.start).join('')),mark,
        document.createTextNode(chars.slice(item.source.end,end).join('')+(end<chars.length?'...':'')));
      card.append(quote);
      const details=el('details');details.append(el('summary','Recorded form derivation / input only'));
      let rendered=false;details.addEventListener('toggle',()=>{
        if(rendered||!details.open)return;rendered=true;
        const raw=el('pre',JSON.stringify(item.proof,null,2),{class:'raw-record'});raw.style.whiteSpace='pre-wrap';raw.style.overflowWrap='anywhere';details.append(raw);
      });card.append(details);group.append(card);
    }
    host.append(group);
  }
  return host;
}
// END_INPUT_CONTEXT_VIEW
function renderResultBody(){
  const host=$("#result-body");if(!host||!state.saved)return;host.replaceChildren();
  host.dataset.readingId=state.reading;
  const summary=verdictSummary(state.saved,state.row.case,state.reading),task=state.row.case.task;
  if(task==='redaction'&&state.saved.result?.proposal_pool!=null&&
    (state.saved.result.input_nomination?.readings?.some(row=>row.nominations?.length)||!corpusOnlyProposalExecution(state.saved,proposalPoolCache.get(state.saved)?.view))){renderProposalPoolResult(host);return;}
  const items=task==='redaction'?candidates():list(state.saved.result?.atoms).filter(a=>summary.units.some(u=>u.id===a.id));
  host.append(el('div',null,{id:'terminal-decision-scores','data-testid':'terminal-decision-scores'}));
  if(state.reading){const rows=readingRows(),index=rows.findIndex(row=>row.reading.id===state.reading);host.append(el("p",readingLabel(rows[index]?.reading||{},index+1),{class:"scope-line","data-testid":"active-reading"}));}
  if(task==='redaction')host.append(note("Up to five saved fills. Rank is not acceptance."));
  else host.append(note(task==='hypothesis'?"Support, oppose and context retain their recorded scope.":"One tile per required atom. Gaps stay gaps; coverage is not confidence."));
  const grid=el("div",null,{class:task==='redaction'?"construction-grid":"atom-mosaic","data-testid":"construction-grid"});
  for(const [index,item] of items.entries()){
    const unit=newDecision(item),readout=task==='redaction'?(readerEvidenceState(unit?.status)||{kind:'unresolved',label:decisionLabel(unit)}):assertionDecision(unit,task);
    const card=el("article",null,{class:"construction-card","data-testid":task==='redaction'?"candidate-card":"result-atom","data-proposal-id":item.id,"data-provenance":task==='redaction'?'CORPUS':null,"data-atom-id":task==='redaction'?null:item.id,"data-kind":readout.kind});
    card.append(el("span",task==='redaction'?String(index+1).padStart(2,"0"):item.id,{class:"eyebrow"}),el("h3",readable(item.fill||item.text||item.source_quote||item.id)),badge(readout.label));
    if(task==='redaction'){const identity=renderIdentityConsolidation(item);if(identity)card.append(identity);}
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
  host.append(grid);
  if(task==='redaction'){
    const reserve=savedReserveCandidates(currentReading());
    if(reserve.length){
      const disclosure=el('details',null,{class:'workbench-reserve-candidates','data-testid':'saved-ranks-6-10'});
      disclosure.append(el('summary',`Saved ranks 6–${reserve.at(-1).rank}`),
        note('Additional candidates saved for this exact reading. Original ranks and evidence states are unchanged; these are not extra support votes.'));
      for(const item of reserve){
        const card=el('article',null,{class:'workbench-reserve-card','data-testid':'reserve-candidate','data-candidate-id':item.id,'data-saved-rank':item.rank});
        card.append(el('h3',`${item.rank}. ${readable(item.fill)}`),note(readerEvidenceState(item.local_decision?.status)?.label||'Saved evidence state not supplied'));
        for(const proof of uniqueProofs(list(item.sources)))card.append(sourceButton(proof));
        disclosure.append(card);
      }
      host.append(disclosure);
    }
  }
  const compatibility=currentControllerView(),audit=currentControllerAudit();
  if(compatibility?.candidates.length)host.append(controllerWithholdingDisclosure(compatibility));
  if(audit?.error){
    host.append(note('The saved compatibility audit could not be verified. No candidate or earlier result is substituted. '+audit.error,'notice'),
      button('Original shortlist audit record',()=>{
        const result=state.saved.result.redaction||state.saved.result;
        openDrawer('Original shortlist audit','Unverified saved metadata / no display decision inferred',el('pre',JSON.stringify({controller_shortlist:result.controller_shortlist,assessed_candidates:result.assessed_candidates},null,2),{class:'raw-record'}));
      },'quiet',{'data-testid':'controller-audit-unavailable'}));
  }
  if(!items.length&&!emptyControllerShortlist()&&!audit?.error)host.append(note(livePacket?.retrieval_summary.noCandidate?'No candidate passed. Retrieved sources remain available above; inspection is not acceptance.':"No saved alternatives for this selection. No other reading or method is substituted.","empty"));
  const groupedOccurrences=task==='redaction'&&items.some(item=>list(item.presentation_variants).length>1);
  if(groupedOccurrences){
    const counts={backed:0,partial:0,context:0,incompatible:0,unresolved:0};
    for(const item of items)counts[readerEvidenceState(newDecision(item)?.status)?.tier||'unresolved']++;
    host.append(note(`${items.length} distinct fills / ${counts.backed} evidence-backed${counts.partial?' / '+counts.partial+' partial evidence':''} / ${counts.context} contextual${counts.incompatible?' / '+counts.incompatible+' not viable':''}${counts.unresolved?' / '+counts.unresolved+' unresolved':''}. Repeated source occurrences are grouped, not counted as extra corroboration.`));
  }else{const recordedCounts=localVerdictPanel().querySelector('.verdict-counts');if(recordedCounts)host.append(recordedCounts);}
  renderTerminalScores();
}
function suppliedProposalDrawer(item){
  const body=renderSuppliedProposalTrace(item,state.row.case.query);
  body.append(button('Origin',()=>$('#stage-01 [data-testid=origin-open]')?.click(),'quiet',{'data-testid':'proposal-input-origin'}));
  openDrawer('Supplied context','Public-input provenance / not corpus evidence',body);
}
function renderProposalPoolResult(host){
  const reading=currentProposalReading(),audit=proposalPoolCache.get(state.saved),rows=readingRows();
  const index=rows.findIndex(row=>row.reading.id===state.reading);
  host.append(el('p',readingLabel(rows[index]?.reading||{},index+1),{class:'scope-line','data-testid':'active-reading'}));
  if(!reading)host.append(note('The native proposal pool could not be verified. No alternative pool or reading is substituted. '+(audit?.error||''),'notice'));
  else{
    host.append(renderProposalOrder(reading,{formatText:readable}));
    const grid=el('div',null,{class:'construction-grid proposal-pool-grid','data-testid':'construction-grid'});
    for(const item of reading.proposals){
      const p=item.proposal,readout=readerEvidenceState(p.status)||{kind:'context',label:'Contextual suggestion'};
      const card=el('article',null,{class:'construction-card','data-testid':'candidate-card','data-proposal-id':p.id,
        'data-proposal-rank':p.rank,'data-provenance':p.provenance,'data-kind':readout.kind});
      card.append(el('span',String(p.rank).padStart(2,'0'),{class:'eyebrow'}),el('h3',readable(p.fill)),badge(readout.label),
        el('span',p.provenance==='INPUT'?'Input-derived context':proposalSourceLabel(p),{class:'badge proposal-source-family','data-testid':'proposal-source-family'}));
      card.append(el('p','Fusion index: '+p.fusion_score.toFixed(4),{class:'proposal-fusion-index','data-fusion-score':p.fusion_score,title:String(p.fusion_score)}));
      const actions=el('div',null,{class:'actions'});
      if(item.corpus){
        const identity=renderIdentityConsolidation(item.corpus);if(identity)card.append(identity);
        const documents=new Set(usedProofs(item.corpus).map(proof=>proof.document_id||proof.canonical_page_id));
        actions.append(button('Sources / '+documents.size,()=>candidateDetail(item.corpus),'',{'data-testid':'candidate-detail'}),
          button('Routes',()=>{selectCandidate(item.corpus.id);stagePosition('03');},'quiet'));
      }
      if(item.input)actions.append(button('Supplied context',()=>suppliedProposalDrawer(item.input),'quiet',{'data-testid':'proposal-supplied-context'}));
      card.append(actions);grid.append(card);
    }
    host.append(grid);
    if(!reading.proposals.length)host.append(note('No proposals for this reading. No other reading is substituted.','empty'));
  }
  const details=el('details',null,{class:'proposal-corpus-audit','data-testid':'proposal-corpus-audit'});
  details.append(el('summary','Corpus candidates and original scores / audit'),
    note('Original corpus order and evidence points, not a second proposal slate. Input nominations add no corpus support, votes or points.'));
  const scoreHost=el('div',null,{id:'terminal-decision-scores','data-testid':'terminal-decision-scores'});details.append(scoreHost);
  for(const candidate of list(currentReading()?.candidates)){
    const row=el('div',null,{class:'proposal-corpus-audit-row','data-testid':'corpus-candidate-audit','data-candidate-id':candidate.id});
    row.append(el('strong',candidate.rank+'. '+readable(candidate.fill)),badge(decisionLabel(newDecision(candidate))),
      button('Sources',()=>candidateDetail(candidate),'quiet'),button('Routes',()=>{selectCandidate(candidate.id);stagePosition('03');},'quiet'));details.append(row);
  }
  const context=renderSuppliedContext();if(context)details.append(context);
  const compatibility=currentControllerView();if(compatibility?.candidates.length)details.append(controllerWithholdingDisclosure(compatibility));
  const controllerAudit=currentControllerAudit();if(controllerAudit?.error)details.append(note('Compatibility audit unavailable: '+controllerAudit.error,'notice'));
  host.append(details);renderTerminalScores(scoreHost);
}
function renderTerminalScores(host=$('#terminal-decision-scores')){
  if(!host)return;
  try{
    if(isContextPriorityVersion(state.saved?.result?.terminal_scores?.version)){
      host.replaceChildren(renderContextPriorityCards(state.saved,{caseInfo:state.row.case,readingId:state.reading,formatText:readable,
        onInspect:candidate=>candidateDetail(candidate)}));
      return;
    }
    const scores=computeDecisionScores(state.saved);
    host.replaceChildren(renderTerminalScoreCards(state.saved,scores,{formatScore:formatDecisionScore,formatText:readable,readingId:state.reading,
      readingTitle:r=>readingLabel(r,readingRows().findIndex(row=>row.reading.id===r.id)+1),onExplain:item=>{
        const body=box(note('Saved arithmetic only; source judgments and citations retain their recorded scope.'));
        const candidate=Number.isFinite(item.evidence_tier),sourcePoints=['terminal-evidence-fit/6','terminal-evidence-fit/7'].includes(scores.version),points=candidate&&['terminal-evidence-fit/4','terminal-evidence-fit/5','terminal-evidence-fit/6','terminal-evidence-fit/7'].includes(scores.version);
        body.append(fields([[points?'Ranking points':candidate?'Raw priority index':'Signed evidence index',formatDecisionScore(item.score)],['Recorded units',item.score_units||'Index'],['Evidence tier',item.evidence_tier]]));
        if(item.formula)body.append(heading('Saved formula'),el('pre',item.formula,{class:'raw-record'}));
        body.append(note(!candidate?'Fact-wise support, opposition and context totals from the saved contributions. These are evidence indices, not candidate points, independent votes or correctness probabilities.':sourcePoints?
          'Saved ranking points: 100 per logical evidence tier, 40 for a source nomination cue, up to 25 from the source-function band and 35 evidence/fit points. A nomination cue is not a factual-support certificate or correctness confidence.':scores.version==='terminal-evidence-fit/5'?
          'Native v5 ranking points: 100 per logical evidence tier, up to 65 source-priority points and 35 evidence/fit points. Not correctness confidence; rank and pool position add no points.':scores.version==='terminal-evidence-fit/4'?
          'Evidence/fit points on the saved 0 to 300 scale, not a probability or confidence in the missing words. Evidence tiers are preserved; accumulated evidence and fit order candidates within a tier. No rank rescaling is applied.':
          'Saved evidence/fit indices, not probabilities or correctness confidence. Candidate rank and the native evidence decision are separate.'));
        if(item.source_function_band){
          body.append(heading('Saved ranking inputs'),fields([
            [points?'Ranking points':'Raw priority index',formatDecisionScore(item.score)],['Evidence tier',item.evidence_tier],
            ['Source-function band',item.source_function_band.value],['Source fit',formatDecisionScore(item.fit)]]));
          body.append(note(sourcePoints?
            'The 40-point nomination cue excludes the type-only and no-name-penalty bits (16 and 2). Remaining source priority uses 25*B/1023. Evidence/fit retains its 35-point budget; these components do not change the logical evidence class.':scores.version==='terminal-evidence-fit/5'?
            'Logical evidence tiers remain separate. Within each tier, source priority and accumulated evidence/fit are combined with the saved 65/35 point budgets.':
            'Evidence sufficiency comes first, then source-owned function checks, then accumulated evidence and fit. More background context cannot overrule a stronger source-function match.'));
          const checks=list(item.source_function_band.source_checks).filter(check=>check.satisfied);
          if(checks.length)body.append(fields(checks.map(check=>[check.name.replaceAll('_',' '),check.contribution])));
          if(item.source_function_band.declared_visible_attachment)body.append(note('A visible-role attachment contribution is declared in the saved band. This is a ranking input, not an evidence assertion.'));
        }
        if(sourcePoints&&candidate)body.append(heading('Source nomination cue'),fields([
          ['Recorded cue',item.source_function_context.matched?'Present':'Not recorded'],['Excluded cue bits','16, 2'],
          ['Meaning','Positive functional nomination cue, not factual support']]));
        if(item.ranking_components){const parts=item.ranking_components;body.append(heading('Native point components'),fields([
          ['Evidence class points',formatDecisionScore(parts.evidence_tier_points)],['Source-priority points / 65',formatDecisionScore(parts.source_function_points)],
          ['Evidence/fit points / 35',formatDecisionScore(parts.evidence_fit_points)],['Utility',formatDecisionScore(parts.utility)],
          ['Saturated utility',formatDecisionScore(parts.saturated_utility)]]));}
        if(item.fit_components)body.append(heading('Source fit components'),fields(Object.entries(item.fit_components).map(([key,value])=>[key.replaceAll('_',' '),formatDecisionScore(value)])));
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
  const s=stage("06","Analyst Summary","Post-run summary"),host=el("div",null,{class:"analyst-digest","data-testid":"analyst-digest","data-status":"pending"});
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
    if(data.available!==true){host.dataset.status='unavailable';host.replaceChildren(el('p','No analyst digest is attached.'),note('The verdict and selected evidence remain available above.'));return;}
    if(['source-bound-postrun-digest/1','source-bound-postrun-digest/2'].includes(data.version)){
      if(data.native_checksum!==state.saved.native_checksum||data.query_sha256!==await textDigest(state.row.case.query)||
          canonicalGateJSON(data.resource_binding)!==canonicalGateJSON(state.saved.resource_binding)||
          !Array.isArray(data.sources)||data.source_count!==data.sources.length||data.sources.some((source,index)=>source.id!=='S'+(index+1))||
          [...data.text.matchAll(/\bS(\d+)\b/g)].some(match=>+match[1]<1||+match[1]>data.sources.length))throw Error('The digest does not match the native result and sources.');
    }else if(livePacket||isNarrativePublication()&&(!['narrative-saved-digest/1','narrative-saved-digest/2'].includes(data.version)||data.case_id!==state.row.case.case_id||data.config!==ARMS[state.arm].key||canonicalGateJSON(data.native_checkpoint)!==canonicalGateJSON(state.saved.native_checkpoint)||!['narrative-local-execution/2','narrative-local-execution/3','narrative-local-execution/4'].includes(data.native_version)||data.current_native_execution!==false))throw Error('No matching saved narrative digest is attached.');
    const words=typeof data.text==='string'?data.text.trim().split(/\s+/):[];
    if(data.postrun!==true||data.used_for_inference!==false||words.length<50||words.length>100)throw Error("No matching 50-100 word post-run digest is available.");
    const expectedScope=list(state.row.presentation_caveats).map(({title,text})=>({title,text}));
    if(data.source_scope_notes&&(data.source_scope_notes.postrun_only!==true||data.source_scope_notes.used_for_local_inference!==false||data.source_scope_notes.changes_native_verdict!==false||canonicalGateJSON(data.source_scope_notes.notes)!==canonicalGateJSON(expectedScope)))throw Error("Digest source scope differs from the selected input.");
    if(epoch!==state.epoch||reading!==state.reading||!host.isConnected)return;
    host.dataset.status="available";
    const digestSources=list(data.sources).map(proof=>({...proof,corpus:proof.corpus||state.row.case.corpus}));
    const text=appendDigestText(el('p'),data.text,digestSources,sourceDrawer);
    const mapping=el('nav',null,{class:'workbench-digest-source-key','aria-label':'Summary sources','data-testid':'digest-source-mapping'});
    mapping.append(heading('Sources in this summary'));
    for(const proof of digestSources)mapping.append(button(proof.id+' / '+sourceLocation(proof),()=>sourceDrawer(proof),'workbench-digest-source',{'data-testid':'digest-source-mapping-item','data-digest-source':proof.id}));
    host.replaceChildren(text,mapping,note('Post-run summary, not new evidence.'));
    const scope=presentationCaveats(state.row);if(scope)host.append(scope);
    const sources=digestProofs(data.sources);
    if(sources.length)host.append(button("Sources",()=>{const body=box();for(const proof of sources)body.append(quoteCard(proof));openDrawer("Digest sources","Verified saved review quotations",body);},"",{"data-testid":"digest-sources"}));
  }catch{if(host.isConnected&&epoch===state.epoch){host.dataset.status=isNarrativePublication()?'unavailable':'pending';host.replaceChildren(el("p",isNarrativePublication()?'Saved analyst digest unavailable.':"Source-bound analyst digest pending.",{role:"status"}),note("No generated text or historical commentary is substituted."));}}
}
function renderPlanAudit() {
  const s=stage("02","Search clues, readings and discovery questions",ARMS[state.arm].origin,state.arm==="A"?"model":"");
  const failure=failureReceipt();if(failure)s.body.append(failure);
  const plan=state.saved.plan||{},atoms=list(plan.atoms),reads=list(plan.slot_readings),leads=list(plan.leads);
  if(readingRows().length)s.body.append(note("Active saved reading / branch: "+state.reading));
  s.body.append(note("These required assertions and search clues locate sources. A search clue is not evidence that the assertion is true."));
  const rows=el("div",null,{class:"compact-list"});for(const atom of atoms)rows.append(inspectRow(atom.id,atom.text||atom.source_quote,atom.required===false?"Optional":"Required",()=>atomDetail(atom),{"data-testid":"plan-atom"}));
  s.body.append(rows);if(!atoms.length)s.body.append(note("No shared atoms were published for this condition.","empty"));
  const extraction=plan.extractions||{};const counts=Object.entries(extraction).filter(([,v])=>Array.isArray(v)).map(([k,v])=>`${v.length} ${k}`);
  if(counts.length)s.body.append(note("Shared input extraction: "+counts.join(" / ")));
  s.body.append(heading("Saved interpretation"));
  if(leads.length)s.body.append(note("Discovery questions locate potentially relevant sources. They are search aids, not assertions established by evidence.","notice"));
  if(!reads.length)s.body.append(note("This task searches the recorded assertions without a missing-span interpretation."));
  for(const r of reads.filter(r=>!state.reading||r.id===state.reading)){
    const card=el("article",null,{class:"reading-plan","data-reading-id":r.id});card.append(el("h3",`${r.id} / ${primitive(r.form)}`),note(readingText(r)),button("Reading details",()=>readingDetail(r)));
    const linked=leads.filter(l=>list(l.reading_ids).includes(r.id));
    if(linked.length){const details=el("details"),summary=el("summary",`${linked.length} direct discovery question${linked.length===1?"":"s"} linked to reading ${r.id}`);details.append(summary);for(const l of linked)details.append(inspectRow(l.id,l.question,"Reading IDs: "+list(l.reading_ids).join(", "),()=>leadDetail(l),{"data-testid":"discovery-question"}));card.append(details);}s.body.append(card);
  }
  const unlinked=leads.filter(l=>!list(l.reading_ids).length);
  if(unlinked.length){s.body.append(heading("Context discovery questions"));for(const lead of unlinked)s.body.append(inspectRow(lead.id,lead.question,"Input-derived",()=>leadDetail(lead),{"data-testid":"discovery-question"}));}
  const methods=el("details",null,{class:"method-audit"});methods.append(el("summary","Search preparation / technical details"),modelStages(),button("Saved prompts and instructions",promptDrawer,"",{"data-testid":"planning-instructions"}));s.body.append(methods);return s.outer;
}
function leadDetail(lead) { const body=box(note(lead.question,"notice"),fields([["Discovery question ID / not a score",lead.id,true],["Linked reading IDs",list(lead.reading_ids).join(", ")||"No reading link",true],["Linked atom IDs",list(lead.atom_ids).join(", ")||"No atom link",true]]),note(lead.rationale||lead.reason||"Model-authored discovery question from visible input anchors and shared extraction/atoms, not a source-established event."));for(const q of list(lead.anchor_quotes))body.append(el("blockquote",typeof q==="string"?q:q.text,{class:"cue"}));openDrawer("Discovery question "+lead.id,`Arm ${state.arm} / saved plan`,body); }
function modelStages() {
  const host=el("section",null,{class:"model-stages","data-testid":"model-stages"});
  if(isNarrativePublication()){
    host.append(heading('Saved narrative execution'),note('This is the saved narrative planner, constructor and evidence decision, not a current-native execution or numerical diffusion replay.'),fields([['Projection',state.saved?.version,true],['Native checkpoint',state.saved?.native_checkpoint?.path,true],['Checkpoint SHA-256',state.saved?.native_checkpoint?.sha256,true]]));return host;
  }
  host.append(heading("What called a model, and when?"),note("Saved requests, never live calls. A/B/C reuse the same model extraction and atoms. The local engine retrieves and decides offline; an independent post-run LLM judge and analyst digest cannot change that result."));
  const stages=[["1. Shared model extraction","KG 2.32 entities, events, claims and relations from the visible input only."],["2. Shared model atoms","Source-faithful propositions from the visible input and extraction. Any saved repair/retry is listed below."],["3. Arm-specific planning",state.arm==="A"?"Model slot readings for redaction plus discovery questions; H/R have no slot readings.":state.arm==="B"?"No readings or discovery questions. The local source-derived construction pool is not a model interpretation.":"Local grammatical slot readings for redaction; no model readings or discovery questions. H/R repeats are consistency controls."]];
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
  const calculation=el("details");calculation.append(el("summary","How source relevance is calculated"),diffusionFormula(),note("Saved numerical transport combines input matches and graph transitions; it is not a correctness probability."));route.append(calculation);
  const policy=el("section",null,{class:"flow-sidecard"});policy.append(el("h3","One pinned source view"),note(sourceScopeText()),note(state.row.case.corpus==="cib"?
    sourcePolicyCaption(selectedSourceScope(state.row.case)):
    "Bound CONFIDENTIAL cable evidence view only."),note("Identity and hierarchy assignments are retrospective. Display and inspection limits are not corpus completeness."));
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
  if(livePacket){if(proof)void sourceDrawer(proof);return;}
  if(!allowPrivileged(()=>guidePath({candidate,route,route_index,proof})))return;
  const params=new URLSearchParams({corpus:state.row.case.corpus,guide_case:state.row.case.case_id,guide_arm:ARMS[state.arm].key,
    guide_reading:state.reading,guide_candidate:candidate.id,guide_route:String(route_index),guide_autoplay:'1',return_to:location.pathname+location.search});
  if(isNarrativePublication()&&/^path_[a-f0-9]{24}$/.test(route.id||'')){params.set('guide_candidate',route.id);params.set('guide_route','0');}
  if(proof){
    const item=flowItems().find(item=>item.id===candidate.id),path=isNarrativePublication()?state.trace?.paths.find(p=>p.id===route.id&&p.candidate_or_atom_id===candidate.id):null,lookup=state.trace?.sources||state.trace?.source_refs_by_id||{};
    const inventory=path?uniqueProofs(list(path.decision_source_refs?.length?path.decision_source_refs:path.source_refs).map(ref=>typeof ref==='string'?lookup[ref]:ref)):usedProofs(item);
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
  state.reading=displayReadingId(readingRows(),r=>readingDescription(state.saved,r),state.reading);
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
  return ({ESTABLISHED:"FOR",SUPPORT:"FOR",SUPPORTED:"FOR",FOR:"FOR",COUNTER:"AGAINST",CONTRADICTED:"AGAINST",AGAINST:"AGAINST",PARTIAL:"SOME",SOME:"SOME",MIXED:"FOR + AGAINST",CONFLICT:"FOR + AGAINST",INSUFFICIENT:"MISSING",UNSUPPORTED:"MISSING",UNRESOLVED:"MISSING",MISSING:"MISSING"})[raw]||"Unreported";
}
function atomLabel(value) {
  const status=atomVerdict(value);
  return state.row.case.task==="reconstruction"?recordedCoverage(status)||"Coverage not recorded":humanDirection(status);
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
  if(result.query_coverage?.complete===false)host.append(note("The supplied atom plan does not cover every input requirement. Atom coverage is not whole-input certification.","notice"));
  for(const atom of atoms){
    const status=atomVerdict(atom.status),card=el("article",null,{class:"atom-card","data-testid":"result-atom","data-atom-id":atom.id});
    const header=el("header"),coverageUnknown=task==="reconstruction"&&!recordedCoverage(atomVerdict(atom.status));
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
  const steps=task==="redaction"?["Input and proposed fills","Check original quotations","Check the missing fact","Independent model summary"]:
    ["Input and required facts","Check original quotations","Check each requirement","Independent model summary"];
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
  return document.createDocumentFragment();
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
  const details=el('details',null,{class:'scope-caveat-details'});
  details.append(el('summary',entries.length===1?'Scope caveat: '+entries[0].title.trim():`Scope caveats (${entries.length})`));
  for(const value of entries){const item=el("div",null,{"data-testid":"presentation-caveat"});item.append(el("h4",value.title.trim()),el("p",value.text.trim()));details.append(item);}
  host.append(details);
  return host;
}
function counterPolicyScopeNote(){
  const scope=counterPolicyNotice(candidates());
  if(!scope)return null;
  return el('p',scope.text,{class:'note','data-testid':'counter-policy-scope',role:'note','data-coverage-warning':String(scope.warning)});
}
function localVerdictPanel(){
  const compatibilityEmpty=emptyControllerShortlist();
  if(compatibilityEmpty)return box(heading('Compatibility unresolved'),note(controllerWithholdingEmptyText(compatibilityEmpty)),controllerWithholdingDisclosure(compatibilityEmpty));
  const summary=verdictSummary(state.saved,state.row.case,state.reading),host=el("section",null,{class:"local-verdict-hero","data-testid":"local-verdict-panel","data-tone":summary.tone,"aria-label":"Local verdict"});
  const reader=readerRedactionVerdict(summary);
  const title=el("div",null,{class:"local-verdict-heading"});title.append(el("p","Local Verdict",{class:"eyebrow"}),el("h2",reader?.title||summary.title,{"data-testid":"local-verdict-title","data-native-title":summary.title}),note(summary.detail));
  if(summary.task==='redaction'){const scope=counterPolicyScopeNote();if(scope)title.append(scope);}
  const caveats=presentationCaveats(state.row);if(caveats)title.append(caveats);
  if(summary.recommendation){
    title.append(el("p",summary.recommendation.text,{class:"recommended-fill","data-testid":"recommended-fill","data-candidate-id":summary.recommendation.id}),button("Inspect recommended fill",()=>{selectCandidate(summary.recommendation.id);stagePosition("05");}));
  }else if(summary.task==="redaction"&&summary.available){
    const abstention=el('p',null,{class:'note','data-testid':'corpus-abstention'});
    abstention.append(el('span','No corpus-backed fill passes the saved checks.',{'data-testid':'no-backed-fill'}));title.append(abstention);
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
    notes.push('Historical source ascription only: this does not establish tenure at the input date or certify the role as world truth.');
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
    body.append(el("summary",`${row.scope==="overall"?"Whole input":unit?.text||row.decision_id}: ${displayText(grade.judgment)}`),
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
    details.append(el("summary",`${row.scope==="overall"?"Whole input":unit?.text||row.decision_id} / reviewer opinion`),
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
    for(const atom of required){const status=atomLabel(atom.status);strip.append(el("span",`${atom.id}: ${status}`,{class:"verdict-unit","data-coverage":recordedCoverage(atomVerdict(atom.status)),title:atom.text}));}
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
  const c={...state.row.case};const epoch=openDrawer("Original source",proof.inspection_only?"Retrieved source / inspection, not factual support":"Pinned evidence / raw text",note("Loading original text and verifying the quotation..."),back);
  sourceRequest=new AbortController();
  try {
    const data=await getJSON("/api/source-v6?"+new URLSearchParams({case_id:c.case_id,source_id:proof.canonical_page_id}),{signal:sourceRequest.signal});
    const page=data.page||data;
    if(epoch!==state.drawerEpoch||!$("#detail-drawer").open)return;
    if(typeof page.text!=="string"||(page.canonical_page_id||page.id)!==proof.canonical_page_id)throw Error("The source identity does not match the saved citation.");
    if(!sourceWithinScope(page,c))throw Error("This page violates the selected case's source cutoff or origin policy.");
    if(proof.document_id&&proof.document_id!==page.document_id||proof.date&&proof.date!==page.date)throw Error("The source document or date differs from the saved quotation.");
    if(!sourcePagePolicyAllows(page,c,selectedSourceScope(c)))throw Error("This page is outside the bound evidence policy.");
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
    if(proof.inspection_only)body.append(note('Retrieved and inspected source. Search relevance and exact quotation verification do not establish factual support or candidate acceptance. Additional supplied pages are provenance only; inspection is not implied.','notice'));
    const registered=registeredSuppliedPageInfo(page),later=registeredLaterPageInfo(page);
    const technical=el('details',null,{class:'source-technical'});technical.append(el('summary','Source details'),fields([["Document",page.document_id,true],["Source date",page.date],["View",later?'Later-release CIB':registered?'Registered '+registered.release+' edition':c.corpus==="cib"?"Earlier-visible CIB":"CONFIDENTIAL"],["Canonical page",proof.canonical_page_id,true]]));
    body.append(technical);
    const supplied=list(data.document_pages).filter(p=>!registered||registeredSuppliedPageInfo(p)?.edition===registered.edition),ordered=supplied.length?supplied.filter((p,i,all)=>all.findIndex(q=>(q.canonical_page_id||q.id)===(p.canonical_page_id||p.id))===i):[page];
    if(!ordered.some(p=>(p.canonical_page_id||p.id)===proof.canonical_page_id))ordered.unshift(page);
    const physical=p=>registeredLaterPageInfo(p)?.physical_page??registeredSuppliedPageInfo(p)?.physical_page??(c.corpus==="cib"?(p.earlier_page??p.physical_page??((p.canonical_page_id||p.id)===proof.canonical_page_id?(proof.earlier_page??proof.physical_page):undefined)):p.physical_page);
    if(ordered.every(p=>Number.isInteger(physical(p))&&physical(p)>0))ordered.sort((a,b)=>physical(a)-physical(b));
    const transcript=el("div",null,{class:"document-transcript"});
    for(const [index,segment] of ordered.entries()){
      const selected=(segment.canonical_page_id||segment.id)===proof.canonical_page_id,number=physical(segment),known=Number.isInteger(number)&&number>0;
      const section=el("section",null,{class:"transcript-segment","data-source-id":segment.canonical_page_id||segment.id,"data-source-selected":String(selected)});
      const edition=registeredSuppliedPageInfo(segment)?.release;
      section.append(el("h3",`${edition?edition+' edition / ':''}${known?"Page "+number:index?'Source text continuation':'Original source text'} / ${segment.document_id}`,{class:"transcript-boundary","data-testid":"transcript-boundary","data-boundary-kind":known?"physical-page":"source-text"}));
      const highlights=selected&&verified?[exactSourceAnchor(segment.text,proof)]:[];
      if(selected&&verified){section.dataset.proofStart=String(proof.start);section.dataset.proofEnd=String(proof.end);section.dataset.proofHash=proof.page_sha256;}
      section.append(highlightedText(segment.text,highlights,{class:"source-document transcript-text","data-testid":selected?"source-document":"additional-source-segment"}));transcript.append(section);
    }
    body.append(transcript);
    let sourcePairHost=null,sourcePDFLinks=[];
    if(c.corpus==='cib'){
      try{
        sourcePDFLinks=await cibPDFPair({page,proof,binding:currentBinding(c.case_id,c.corpus),caseId:c.case_id,config:ARMS[state.arm].key});
        if(sourcePDFLinks.length!==2||new Set(sourcePDFLinks.map(item=>item.release)).size!==2||
            sourcePDFLinks.some(item=>!Number.isSafeInteger(item.page)||item.page<1||item.page>1000000))
          throw Error('Both original PDFs require exact recorded page locators.');
        sourcePairHost=el('section',null,{class:'source-pdf-pair','data-testid':'source-pdf-pair'});
        sourcePairHost.append(el('h3','Original release PDFs'));body.append(sourcePairHost);
      }
      catch{body.append(note('PDF page locators could not be verified. The exact source text remains available.'));}
    }
    if(epoch!==state.drawerEpoch||!$('#detail-drawer').open)return;
    $("#detail-body").replaceChildren(body);
    scrollToSource();
    if(sourcePairHost)void showWorkbenchPDFs(sourcePairHost,sourcePDFLinks);
  }catch(error){if(epoch===state.drawerEpoch&&error.name!=="AbortError")$("#detail-body").replaceChildren(note(error.message,"error-card"));}
}

function sourceWithinScope(page,c){
  const scope=selectedSourceScope(c);
  if(scope.source_view_policy.id==='later_release_inclusive')return sourcePagePolicyAllows(page,c,scope);
  if(isSuppliedSourcePage(page))return sourcePagePolicyAllows(page,c,scope);
  if(c.corpus==='cib'&&!scope.whole_origin_excluded&&page.document_id===c.document_id&&
      !['earlier','both'].includes(String(page.visibility||page.release||page.native_page?.view||'').toLowerCase()))return false;
  return sourceScopeAllows(page,scope);
}
function selectedSourceScope(c){
  const row=catalogCases().find(row=>row.case.case_id===c.case_id),reportItem=row?.configurations?.[ARMS[state.arm].key];
  return workbenchSourceScope(c,{reportItem,condition:state.saved,liveScope:currentSourcePacket()?.source_scope});
}
function sourceScopeText(){
  const scope=selectedSourceScope(state.row.case),date=scope.on_or_before||scope.strictly_before;
  return `Inspected sources ${scope.on_or_before?'on or before':'before'} ${date}. `+
    sourcePolicyCaption(scope);
}
function originEvidenceKicker(){
  return 'Input provenance';
}
async function verifySourcePage(page,c) {
  if(typeof page.text!=="string"||!(page.canonical_page_id||page.id))throw Error("A source segment has no replayable text or identity.");
  if(!sourceWithinScope(page,c))throw Error("This page violates the selected case's source cutoff or origin policy.");
  if(!sourcePagePolicyAllows(page,c,selectedSourceScope(c)))throw Error("This page is outside the bound evidence policy.");
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
    openDrawer(node.label||"Input restart node","Planning / not a historical graph node",box(note(node.explanation||"A visible-input restart node; it is not a source assertion.","notice")));return;
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
    if(navigation)body.append(link("Open graph context",graphURL({node_id:id}),"button"));
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
    for(const [label,text]of [["Input noun",query.text],["Recorded source noun",source.text]]){
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
// These are original audit snapshots, not selectable shortlist candidates.
function controllerWithholdingDisclosure(view){
  return renderControllerWithholding(view,{activeReadingId:state.reading,onInspect:withheldCandidateDrawer});
}
function withheldCandidateDrawer(candidate){
  const body=renderControllerWithheldAudit(candidate,{
    decisionText:unit=>decisionLabel(unit,state.row.case.task),
    makeSourceButton:proof=>sourceButton(proof,{back:()=>withheldCandidateDrawer(candidate)})});
  openDrawer('Compatibility unresolved','Withheld from automatic shortlist / original record',body);
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
    ["Input label / local",identity.query_label,true],["Exact label in source",cert.source_actor_label,true],
    ["Full name in this apposition",raw.raw_person,true],["Source role",raw.raw_role,true],
    ["Source organization",raw.raw_organization,true],["Bound atom",cert.atom_id,true]]),
    note(`Applies to only this atom (${cert.atom_id}); not whole-input proof. No global alias or canonical identity merge is licensed. This source statement is not a world-truth certification.`,"notice"));
  const remaining=list(cert.remaining_query_atom_ids).filter(id=>typeof id==="string");
  if(remaining.length)panel.append(note("Not certified by this certificate: "+remaining.join(", ")+". Their own native evidence must be assessed separately."));
  panel.append(el("h4","Original source apposition"),sourceButton(proof,{back}),note("Saved raw wording. Open the source to replay its character bounds and text hash; a matching quotation does not establish unrelated actions or dates."));
  return{node:panel,proof};
}
function atomDetail(atom) {
  const executed=list(state.saved.result?.atoms).find(a=>a.id===atom.id)||atom;
  const label=atomLabel(executed.status),body=box(el("blockquote",atom.text||atom.source_quote,{class:"cue"}),
    state.row.case.task==="reconstruction"&&!recordedCoverage(atomVerdict(executed.status))?note(label):badge(label),rawInspector({status:executed.status,state:executed.state}),
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
  if(list(task.retrieved_source_accounts).length){const details=el("details");details.append(el("summary","Retrieved source quotations / not input entailment"),note(task.retrieved_source_account_meaning||"A chronology of source reports, not a certified chronology or causal account of events."));components(task.retrieved_source_accounts,details);host.append(details);}
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
  if(params.get("view")==="home"){state.recoveryHistorical=false;state.recoveryRequestedId=null;state.recoveryStudy=null;state.epoch++;request?.abort();destroyVisuals();state.projection=null;state.row=null;state.saved=null;state.home=true;state.loading=false;closeDrawer();clearError();renderRail();renderWorkspace();return;}
  state.home=false;
  const recovery=params.get('recovery');
  if(recovery!=null){if(params.getAll('recovery').length!==1||params.has('case')||params.has('study'))throw Error('Select one saved input or one recovery study.');
    if(params.getAll('historical').length>1||params.has('historical')&&params.get('historical')!=='1')throw Error('Invalid historical archive selector.');
    await chooseRecoveryStudy(recovery,{push,reading:params.get('reading')||'',historical:params.get('historical')==='1'});return;}
  const study=params.get('study');
  let id=params.get("case");
  if(study!=null){
    if(params.getAll('study').length!==1||id)throw Error('Choose either a published case or one study position.');
    id=(await workbenchStudyTarget(state.sourceReport,{slot:study})).searchParams.get('case');
  }
  const matches=id?catalogCases().filter(r=>r.case.case_id===id||r.case.case_id.endsWith("_"+id)):[];
  if(id&&matches.length!==1){state.epoch++;request?.abort();destroyVisuals();state.projection=null;closeDrawer();state.row=null;state.saved=null;state.loading=false;renderWorkspace();renderRail();showError(matches.length?"This case alias is ambiguous. Select its full published identity.":"This input is not in the published casebook. No other case has been substituted.");return;}
  const row=matches[0]||visibleCases()[0];
  if(row){
    if(matches.length){
      if(state.filters.corpus&&state.filters.corpus!==row.case.corpus)state.filters.corpus=row.case.corpus;
      if(state.filters.task&&state.filters.task!==row.case.task)state.filters.task=row.case.task;
    }
    await chooseCase(row,{push,reading:params.get("reading")||"",candidate:params.get("candidate")||"",scroll});
  }else{
    state.epoch++;request?.abort();destroyVisuals();state.projection=null;closeDrawer();state.row=null;state.saved=null;state.loading=false;clearError();renderRail();renderWorkspace();savePosition({push});
    $("#page-state").textContent="No saved inputs match these filters. No other case has been substituted.";
  }
}
window.addEventListener("popstate",()=>{viewportAnchor.cancel();navigateFromURL({scroll:false});});
async function mountLiveWorkbench(packet){
  state.recoveryHistorical=false;state.recoveryStudy=null;state.recoveryRequestedId=null;
  savedSourcePacket=null;state.activeFreshInput=null;
  livePacket=packet;state.report=packet.report;state.sourceReport=packet.report;
  state.row=packet.row;state.saved=packet.condition;state.arm='A';state.stage='01';
  state.loading=false;state.pending='';state.epoch++;state.catalog=null;state.casebookPending='';
  [narrativeUI,narrativeAccess,narrativeEndpoints]=await Promise.all([import('./narrative-trace-v1.js'),import('./narrative-attempts-v1.js'),import('./narrative-endpoint-v1.js')]);
  state.casebook={primary:[{case_id:packet.row.case.case_id,corpus:packet.row.case.corpus,task:packet.row.case.task,row:packet.row}],special_redactions:[],backgrounds:{},selection_scope:'live',completed_primary_count:1};
  state.readySingleMethod=true;$('.workspace-toolbar').hidden=true;
  if(packet.source_method_handle){
    state.reading=packet.source_method_handle.method.selected_reading_id||'';state.reviewedSource=null;
    state.trace=packet.source_method_handle.method.trace;state.candidate='';
    renderWorkspace();renderRail();savePosition();$('#casebook-notice').hidden=true;
    $('#page-state').textContent='';return;
  }
  await prepareControllerAudit(state.saved,state.row.case);
  await prepareInputContext(state.saved,state.row.case);
  await prepareProposalPool(state.saved,state.row.case);
  state.reading=initialDisplayReading(state.saved,state.row.case,state.row,{live:true});
  state.candidate=flowItems()[0]?.id||'';
  railDecisionCache.set(railKey(state.row),{record:state.saved});
  renderWorkspace();renderRail();savePosition();await hydrateFlow(state.epoch);
  $('#casebook-notice').hidden=true;
  $('#page-state').textContent=packet.execution_kind==='live'?`Live execution. ${packet.retrieval_summary.text}${emptyControllerShortlist()?' Compatibility unresolved; original candidates remain in the audit.':packet.retrieval_summary.noCandidate?' No candidate passed.':''}`:'Transport test fixture / not an inference.';
}
window.MatryoshkaLiveWorkbench=Object.freeze({mount:mountLiveWorkbench});
try{
  const liveRun=new URLSearchParams(location.search).get('live_run');
  if(liveRun){
    $('#page-state').textContent='Receiving the authenticated Live execution...';
    const {loadWorkbenchRun}=await import('./live-result-adapter.js?v=20261128-polish1');
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
    await narrativeUI.validateManifest(state.manifest,health,state.report,publicationByteHashes.get(state.report));
    narrativeAccess.validatePrivacyContract(state.report);
    verifiedCurrentPublications.add(state.report);state.catalog=null;
    const sheet=el('link',null,{rel:'stylesheet',href:'./narrative-trace-v1.css'});
    document.head.insertBefore(sheet,document.querySelector('link[href^="workbench-v6.css"]'));
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
  if(state.report.status==="PARTIAL"){const scope=$("#publication-scope");scope.hidden=true;scope.textContent=`Preview: ${state.report.completed_cases??0} saved inputs; ${state.report.pending_cases??0} declared inputs are pending. This is not the final input selection.`;}
  if(state.report.cases.some(row=>row.study_slot)){
    try{state.studyPublication=await loadStudyPublication(state.sourceReport,publicationByteHashes.get(state.sourceReport));}
    catch(error){state.studyPublication={caseIds:[],error:error.message};}
  }
  await loadCasebook();
  state.casebookStatuses=await prepareCasebookStatuses(catalogCases(),{verifiedReportVersion:state.report.version,
    sourceDescriptors:publicationByteHashes.get(state.report)===displayReportSHA?casebookSourceSummaries:[]});
  try{
    state.recoveryCatalog=await loadRecoveryStudies();
    state.recoveryRows=state.recoveryCatalog.cases.map(metadata=>({recovery_metadata:metadata,presentation_title:metadata.title,
      case:{case_id:metadata.case_id,corpus:'cib',task:'redaction',date:metadata.date,document_id:metadata.document_id,query:''}}));
  }catch(error){state.recoveryRows=[];state.recoveryCatalogError=error.message;}
  await loadPublishedFreshCatalog();
  linkWorkbenchStudyNavigation();
  await navigateFromURL();
  }
}catch(error){state.catalog=null;state.report=null;state.sourceReport=null;showError(error.message);$("#page-state").textContent="The bound public casebook is unavailable. No archived data has been substituted.";$("#case-view").setAttribute("aria-busy","false");$("#case-view").replaceChildren(note("The explicitly selected publication, reader and server pins must agree before saved inputs can be displayed.","empty"));}


"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[char]);
const fmt = (value) => new Intl.NumberFormat("en-US").format(Number(value || 0));
const graphWeight=value=>{const n=Number(value);return Number.isFinite(n)?n!==0&&Math.abs(n)<1e-4?n.toExponential(2):String(Number(n.toPrecision(5))):"not supplied";};
// Canvas-only bounds: raw node masses, source weights and memberships are unchanged.
const displayRadius=(value,minimum=0,maximum=Number.MAX_VALUE)=>Math.min(maximum,Math.max(minimum,Number.isFinite(value)?value:minimum));
const displayScale=value=>Number.isFinite(value)&&value>0?Math.min(3.2,value):1;
const compact = (value, limit = 220) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 3).trim()}...`;
};
const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pause = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const redactionOnlyMode = false;
const singleCorpusMode = new URLSearchParams(window.location.search).get("corpus") !== "cib" && ["iran","vietnam"].includes(new URLSearchParams(window.location.search).get("corpus"));
const currentOnlyMode = true;
const pageParams = new URLSearchParams(window.location.search);
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
$$('.preview-caption').forEach(caption=>caption.closest('.graph-card').append(caption));
const releaseFilterApplies = (view) => currentOnlyMode && state.displayMode !== "pair" && ["current_reveal","current_later"].includes(view?.key);
const colors = {Domain:"#176e70",Theme:"#a47c2e",Community:"#315e78",EvidenceGroup:"#68787b",Entity:"#176e70",Event:"#a47c2e",Claim:"#b75e48",RedactionSlot:"#b75e48",RelationEvidence:"#176e70",Segment:"#68787b",Document:"#283f49",Unknown:"#68787b"};
const visibilityLabel = (value) => (singleCorpusMode?{both:"present in Confidential and expanded classification views",later_only:"added by the Secret projection",redacted_placeholder:"opaque redaction placeholder"}:{both:"visible in earlier + later releases",later_only:"present in later release only",redacted_placeholder:"opaque redaction placeholder"})[value] || String(value || "");
const visibilityModes = ["dim","show"];
const visibilityModeLabels = {dim:"ineligible evidence dimmed",show:"ineligible evidence fully colored"};
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
const state = {data:null,searchManifest:null,searchViews:{},searchIndexes:{},searchEvidenceViews:{},searchEvidenceIndexes:{},searchEvidencePromises:{},searchPromises:{},hierarchyPromises:{},communityDetailPromises:{},communityDetailShards:{},neighborhoodPromises:{},neighborhoodShards:{},adjacencyPromises:{},adjacencyShards:{},sourcePromises:{},sourceShards:{},renderRevision:0,release:"earlier",displayMode:"single",visibilityMode:"dim",showIneligible:true,level:"domain",hideIsolates:true,query:"",searchScope:"entity",autoOpenSearch:false,autoOpenDirect:false,pdfApiAvailable:false,redactionResolutionApiAvailable:false,redactionProjection:null,redactionCategory:"entity_value",redactionIndex:0,redactionResolutionCache:{},guidePath:null,guideStep:0,guideBusy:false,panels:{},searchResults:{legacy:[],current:[]},asOfPolicy:{enabled:false,cutoff:"",inclusive:true,excludedDocument:"",caseId:"",minimum:"",maximum:""}};
const nextLevel = {domain:"theme",theme:"community",community:"evidence"};
const nodeLevel = {Domain:"domain",Theme:"theme",Community:"community"};
const DEFAULT_NODE_LIMIT = 256;
const NODE_CAPS = new Set([32,256,2048]);
const MAX_RENDERED_NODES = 2048;
const MAX_ALL_RENDERED_EDGES = 16384;

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
    this.nodes=[]; this.edges=[]; this.nodeMap=new Map(); this.matches=new Set();
    this.transform={x:0,y:0,scale:1}; this.drag=null; this.hover=null; this.selected=null; this.external=null;
    this.level=state.level; this.trail=[]; this.nodeLimit=DEFAULT_NODE_LIMIT; this.holdTimer=null;
    this.pinnedFocusIds=new Set(); this.searchMatchIds=new Set(); this.pinnedSearchRecords=new Map(); this.navigationRevision=0; this.pulseTimer=null;
    this.neighborhood=null; this.localIncidentNeighborhood=null; this.expandedIncidentScopes=new Set();
    this.incidentPages=new Map();this.nodeHistory=[];
    this.investigativeContext=null;
    this.showNeighborEdges=false; this.inducedNeighborEdges=[]; this.inducedLoadRevision=0; this.inducedLoading=false; this.inducedError=""; this.focusBands=[]; this.inspectionRevision=0;
    this.bind(); this.resize();
    new ResizeObserver(()=>{ this.resize(); this.fit(); }).observe(this.canvas.parentElement);
  }

  bind() {
    this.canvas.addEventListener("pointerdown",(event)=>this.pointerDown(event));
    this.canvas.addEventListener("pointermove",(event)=>this.pointerMove(event));
    this.canvas.addEventListener("pointerup",(event)=>this.pointerUp(event));
    this.canvas.addEventListener("pointercancel",(event)=>this.pointerCancel(event));
    this.canvas.addEventListener("dblclick",(event)=>{ const node=this.hitNode(this.pointer(event)); if (node) { event.preventDefault(); this.enterNode(node); } });
    this.canvas.addEventListener("wheel",(event)=>this.wheel(event),{passive:false});
    this.canvas.addEventListener("mouseleave",()=>{ if (!this.drag) { this.hover=null; this.tooltip.hidden=true; this.draw(); } });
  }

  resize() {
    const rect=this.canvas.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2);
    this.canvas.width=Math.max(1,Math.round(rect.width*dpr)); this.canvas.height=Math.max(1,Math.round(rect.height*dpr));
    this.ctx.setTransform(dpr,0,0,dpr,0,0); this.width=rect.width; this.height=rect.height; this.dpr=dpr;
  }

  setGraph(view) {
    this.view=view; this.level=state.level; this.trail=[]; this.nodeLimit=DEFAULT_NODE_LIMIT;
    this.nodeHistory=[];this.incidentPages.clear();
    this.neighborhood=null; this.localIncidentNeighborhood=null; this.expandedIncidentScopes.clear();
    this.investigativeContext=null;
    this.showNeighborEdges=false; this.inducedNeighborEdges=[]; this.inducedLoadRevision+=1; this.inducedLoading=false; this.inducedError=""; this.focusBands=[];
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
    const includeRelease=releaseFilterApplies(this.view);
    const policy=state.guideOverlay?"dim":this.visibilityPolicy();
    const styledNodes=nodes.map((node)=>{
      const id=node.id||node.node_id,reasons=eligibilityReasons(node,{includeRelease});
      const ineligible=reasons.length>0,preserved=preserveIds.has(id);
      return {
        ...node,
        eligibility_ineligible:ineligible,
        eligibility_reasons:reasons,
        visibility_dimmed:ineligible&&(policy==="dim"||!state.showIneligible||preserved),
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
      const selectedNodes=allNodes.slice(0,Math.max(1,limit)),ids=new Set(selectedNodes.map((row)=>row.id));
      const directEdges=allEdges.filter((edge)=>ids.has(edge.source)&&ids.has(edge.target));
      const directPairs=new Set(directEdges.map((edge)=>[edge.source,edge.target].sort().join("\u241f")));
      let neighborEdges=this.showNeighborEdges?this.inducedNeighborEdges.filter((edge)=>ids.has(edge.source)&&ids.has(edge.target)&&!directPairs.has([edge.source,edge.target].sort().join("\u241f"))):[];
      neighborEdges=this.applyVisibilityPolicy(selectedNodes,neighborEdges).edges;
      const selectedEdges=[...directEdges,...neighborEdges].slice(0,MAX_ALL_RENDERED_EDGES);
      return {
        contract,nodes:selectedNodes,edges:selectedEdges,availableNodeCount:totalNodes,
        availableEdgeCount:allEdges.length+neighborEdges.length,scopedEdgeCount:allEdges.length,
        fullGraphNodeCount:base.full_graph_node_count||totalNodes,
        fullGraphEdgeCount:base.full_graph_edge_count||allEdges.length,
        representedNodeCount:totalNodes,shownRepresentedNodeCount:selectedNodes.length,
        overviewGroupCount:0,overviewAggregateEdgeCount:0,corpusWide:false,
        overviewMode:false,assignedNodeCount:totalNodes,assignedEdgeCount:allEdges.length,
        communityDetail:false,detailEdgeNodeRankLimit:0,focusMode:true,
        focusNodeId:selected.id,directEdgeCount:allEdges.length,
        shownDirectEdgeCount:directEdges.length,neighborEdgeCount:neighborEdges.length,
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
      const injected=[...this.pinnedSearchRecords.values()].filter((row)=>!present.has(row.id)).map((row)=>this.normalizedEvidenceNode({...row,mass:Number(row.document_count||1),search_injected:true}));
      allNodes=[...injected,...allNodes];
    }
    if (this.pinnedFocusIds.size) {
      const naturalLimit=Math.min(allNodes.length,this.nodeLimit,MAX_RENDERED_NODES);
      const naturallyVisible=new Set(allNodes.slice(0,naturalLimit).map((row)=>row.id||row.node_id));
      const requiresInjection=[...this.pinnedFocusIds].some((id)=>!naturallyVisible.has(id));
      if(requiresInjection){
        const order=new Map([...this.pinnedFocusIds].map((id,index)=>[id,index]));
        allNodes=[...allNodes].sort((left,right)=>{
          const leftRank=order.has(left.id||left.node_id)?order.get(left.id||left.node_id):-1;
          const rightRank=order.has(right.id||right.node_id)?order.get(right.id||right.node_id):-1;
          if(leftRank>=0||rightRank>=0) return leftRank<0?1:rightRank<0?-1:leftRank-rightRank;
          return 0;
        });
      }
    }
    const eligibility=this.applyVisibilityPolicy(allNodes,allEdges);
    allNodes=eligibility.nodes;allEdges=eligibility.edges;
    policyExcludedNodeCount=eligibility.excludedNodeCount;policyExcludedEdgeCount=eligibility.excludedEdgeCount;
    const scopeIds=new Set(allNodes.map((row)=>row.id||row.node_id));
    const scopedEdges=allEdges.filter((edge)=>scopeIds.has(edge.source)&&scopeIds.has(edge.target));
    const totalNodes=allNodes.length, limit=Math.min(totalNodes,this.nodeLimit,MAX_RENDERED_NODES);
    const selectedNodes=allNodes.slice(0,limit), ids=new Set(selectedNodes.map((row)=>row.id));
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
    const connectedIds=new Set(selectedEdges.flatMap((edge)=>[edge.source,edge.target]));
    const displayedIsolateIds=new Set(selectedNodes.filter((node)=>!connectedIds.has(node.id)).map((node)=>node.id));
    const hiddenLinkedIds=new Set();
    scopedEdges.forEach((edge)=>{
      if(displayedIsolateIds.has(edge.source)&&!ids.has(edge.target))hiddenLinkedIds.add(edge.source);
      if(displayedIsolateIds.has(edge.target)&&!ids.has(edge.source))hiddenLinkedIds.add(edge.target);
    });
    return {
      contract,
      nodes:selectedNodes,
      edges:selectedEdges,
      availableNodeCount:totalNodes,
      availableEdgeCount:induced.length,
      scopedEdgeCount:scopedEdges.length,
      fullGraphNodeCount:base.full_graph_node_count||totalNodes,
      fullGraphEdgeCount:base.full_graph_edge_count||allEdges.length,
      representedNodeCount:overviewMode?Number(base.overview_represented_node_count||0):totalNodes,
      shownRepresentedNodeCount:overviewMode?selectedNodes.reduce((sum,row)=>sum+Number(row.represented_node_count||0),0):selectedNodes.length,
      overviewGroupCount:overviewMode?Number(base.overview_group_count||totalNodes):0,
      overviewAggregateEdgeCount:overviewMode?Number(base.overview_aggregate_edge_count||allEdges.length):0,
      corpusWide,
      overviewMode,
      assignedNodeCount:this.level==="evidence"&&parent?.type==="Community"?Number(parent.mass||totalNodes):totalNodes,
      assignedEdgeCount:this.level==="evidence"&&parent?.type==="Community"?Number(parent.mention_count||induced.length):induced.length,
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
    const previousNodeId=focusId||(!this.selected?.source?this.selected?.id:null);
    const previousEdgeId=this.selected?.source?this.selected?.id:null;
    this.graph=this.graphSelection();
    const masses=this.graph.nodes.map((row)=>{const value=Number(row.mass||row.document_count||1);return Number.isFinite(value)?Math.max(1,value):1;});
    const maxLog=Math.max(1,...masses.map((value)=>Math.log1p(value)));
    this.nodes=this.graph.nodes.map((row,index)=>{
      const angle=index*2.3999632297+(hashNumber(row.id)%1000)/1000;
      const radius=45+Math.sqrt(index+1)*(this.level==="domain"?105:this.level==="theme"?70:this.level==="community"?43:35);
      const relative=Math.sqrt(Math.log1p(masses[index])/maxLog);
      return {...row,index,x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,vx:0,vy:0,r:displayRadius(5.5+relative*8.5,5.5,14)};
    });
    this.focusBands=[];
    if(this.graph.focusMode)this.positionFocusRings();
    this.nodeMap=new Map(this.nodes.map((node)=>[node.id,node]));
    this.edges=this.graph.edges.filter((edge)=>this.nodeMap.has(edge.source)&&this.nodeMap.has(edge.target));
    this.selected=previousNodeId&&this.nodeMap.has(previousNodeId)?this.nodeMap.get(previousNodeId):previousEdgeId?this.edges.find((edge)=>edge.id===previousEdgeId)||null:null;
    this.external=null; this.hover=null;
    this.matches=new Set([...this.pinnedFocusIds,...this.searchMatchIds].filter((id)=>this.nodeMap.has(id)));
    this.layout(); this.fit(); this.renderInspector(); this.updateChrome();
  }

  positionFocusRings() {
    const definitions=[
      ["same_community","Same Community","rgba(71,120,92,.13)","rgba(71,120,92,.45)"],
      ["same_theme","Same Theme","rgba(210,155,46,.12)","rgba(176,124,27,.45)"],
      ["same_domain","Same Domain","rgba(29,83,103,.10)","rgba(29,83,103,.40)"],
      ["cross_domain","Another Domain","rgba(159,63,47,.08)","rgba(159,63,47,.34)"],
      ["outside_hierarchy","Outside hierarchy","rgba(89,105,106,.07)","rgba(89,105,106,.30)"],
    ];
    const focus=this.nodes.find((node)=>node.id===this.graph.focusNodeId)||this.nodes[0];
    if(focus){focus.x=0;focus.y=0;focus.vx=0;focus.vy=0;}
    let inner=48;
    definitions.forEach(([scope,label,fill,stroke],scopeIndex)=>{
      const members=this.nodes.filter((node)=>node!==focus&&node.focus_scope===scope);
      if(!members.length)return;
      let offset=0,radius=inner+42,lastRadius=radius;
      while(offset<members.length){
        const capacity=Math.max(7,Math.floor(2*Math.PI*radius/52));
        const ring=members.slice(offset,offset+capacity);
        const phase=((hashNumber(`${this.graph.focusNodeId}:${scope}:${radius}`)%1000)/1000)*Math.PI*2;
        ring.forEach((node,index)=>{
          const angle=phase+index*Math.PI*2/ring.length;
          node.x=Math.cos(angle)*radius;node.y=Math.sin(angle)*radius;node.vx=0;node.vy=0;
        });
        offset+=ring.length;lastRadius=radius;radius+=54;
      }
      const outer=lastRadius+32;
      this.focusBands.push({scope,label,fill,stroke,inner,outer,count:members.length,index:scopeIndex});
      inner=outer+12;
    });
  }

  layout() {
    const nodes=this.nodes, edges=this.edges;
    if(this.graph?.focusMode)return;
    // Dense corpus-wide layers use the deterministic phyllotaxis seed directly.
    // Pulling hundreds of nodes toward thousands of edges creates an unreadable
    // hairball and hides nodes; scoped branches still receive the force layout.
    if ((this.graph?.corpusWide&&nodes.length>250)||nodes.length>700) return;
    const iterations=nodes.length>500?28:nodes.length>220?55:nodes.length>90?100:220;
    for (let iteration=0;iteration<iterations;iteration+=1) {
      for (let i=0;i<nodes.length;i+=1) for (let j=i+1;j<nodes.length;j+=1) {
        const a=nodes[i],b=nodes[j]; let dx=a.x-b.x,dy=a.y-b.y; const d2=dx*dx+dy*dy+28,d=Math.sqrt(d2),force=1500/d2;
        dx/=d;dy/=d;a.vx+=dx*force;a.vy+=dy*force;b.vx-=dx*force;b.vy-=dy*force;
        const minimum=a.r+b.r+24; if (d<minimum) { const push=(minimum-d)*.04;a.vx+=dx*push;a.vy+=dy*push;b.vx-=dx*push;b.vy-=dy*push; }
      }
      edges.forEach((edge)=>{ const a=this.nodeMap.get(edge.source),b=this.nodeMap.get(edge.target);let dx=b.x-a.x,dy=b.y-a.y;const d=Math.max(1,Math.hypot(dx,dy));const desired=this.level==="domain"?250:this.level==="theme"?190:this.level==="community"?135:92,force=(d-desired)*.0035;dx/=d;dy/=d;a.vx+=dx*force;a.vy+=dy*force;b.vx-=dx*force;b.vy-=dy*force; });
      nodes.forEach((node)=>{ node.vx+=-node.x*.0006;node.vy+=-node.y*.0006;node.vx*=.84;node.vy*=.84;node.x+=node.vx;node.y+=node.vy; });
    }
  }

  fit() {
    if (!(this.width>0&&this.height>0)) return;
    if (!this.nodes.length) { this.transform={x:0,y:0,scale:1};this.draw();return; }
    const xs=this.nodes.map((node)=>node.x),ys=this.nodes.map((node)=>node.y),minX=Math.min(...xs)-55,maxX=Math.max(...xs)+55,minY=Math.min(...ys)-55,maxY=Math.max(...ys)+55;
    const scale=displayScale(Math.min(Math.max(1,this.width-74)/(maxX-minX),Math.max(1,this.height-74)/(maxY-minY),1.08));
    this.transform={scale,x:this.width/2-(minX+maxX)/2*scale,y:this.height/2-(minY+maxY)/2*scale};this.draw();
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
    this.trail.push({...node}); this.level=nextLevel[this.level]; this.nodeLimit=DEFAULT_NODE_LIMIT;
    this.transition(()=>this.refreshGraph());
  }
  back() {
    if(state.guidePath)pauseGuide();
    if(this.nodeHistory.length){this.restoreLocation(this.nodeHistory.pop());return;}
    if(this.neighborhood){this.returnFromNeighborhood();return;}
    const exited=this.trail.pop(); if (!exited) return;
    this.neighborhood=null;this.localIncidentNeighborhood=null;this.investigativeContext=null;this.expandedIncidentScopes.clear();
    this.showNeighborEdges=false;this.inducedNeighborEdges=[];this.inducedLoadRevision+=1;this.inducedLoading=false;this.inducedError="";
    this.level=nodeLevel[exited.type]||state.level; this.nodeLimit=DEFAULT_NODE_LIMIT;
    this.pinnedFocusIds.clear(); this.pinnedSearchRecords.clear(); this.navigationRevision+=1; this.inspectionRevision+=1;
    this.transition(()=>this.refreshGraph(exited.id));
  }
  setNodeCap(rawValue) {
    if(state.guidePath){pauseGuide();state.guidePath.limit=NODE_CAPS.has(Number(rawValue))?Number(rawValue):DEFAULT_NODE_LIMIT;}
    const value=Number(rawValue);this.nodeLimit=NODE_CAPS.has(value)?value:DEFAULT_NODE_LIMIT;
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
    this.level=level;this.trail=[...trail];this.nodeLimit=DEFAULT_NODE_LIMIT;
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
    return {level:this.level,trail:[...this.trail],nodeLimit:this.nodeLimit,neighborhood:this.neighborhood,
      localIncidentNeighborhood:this.localIncidentNeighborhood,selectedId:this.selected?.id||this.external?.id,
      transform:{...this.transform},width:this.width,height:this.height,positions:this.nodes.map(n=>({id:n.id,x:n.x,y:n.y}))};
  }

  restoreLocation(saved) {
    this.navigationRevision+=1;this.inspectionRevision+=1;
    Object.assign(this,{level:saved.level,trail:saved.trail,nodeLimit:saved.nodeLimit,neighborhood:saved.neighborhood,
      localIncidentNeighborhood:saved.localIncidentNeighborhood,showNeighborEdges:false,inducedNeighborEdges:[],external:null});
    this.pinnedFocusIds=new Set(saved.selectedId?[saved.selectedId]:[]);this.searchMatchIds.clear();
    this.refreshGraph(saved.selectedId);
    for(const position of saved.positions){const node=this.nodeMap.get(position.id);if(node)Object.assign(node,{x:position.x,y:position.y});}
    if(saved.width===this.width&&saved.height===this.height)this.transform=saved.transform;else this.fit();
    this.draw();this.updateChrome();
  }

  async focusNeighborhood(record,{scroll=true,remember=true}={}) {
    const revision=++this.navigationRevision;
    const detail=this.investigativeContext?.node?.id===record.id?this.investigativeContext:await ensureNodeNeighborhood(this.view,record.id);
    const route=await this.hierarchyRoute(detail.node);
    if(revision!==this.navigationRevision)return;
    if(remember)this.nodeHistory.push(this.rememberLocation());
    this.trail=route.route;
    this.level="evidence";this.neighborhood=detail;this.localIncidentNeighborhood=null;this.expandedIncidentScopes.clear();
    this.showNeighborEdges=false;this.inducedNeighborEdges=[];this.inducedLoadRevision+=1;this.inducedLoading=false;this.inducedError="";
    this.pinnedSearchRecords.set(record.id,{...record,...detail.node});
    this.pinnedFocusIds=new Set([record.id]);
    this.nodeLimit=DEFAULT_NODE_LIMIT;
    this.refreshGraph(record.id);this.pulseIds([record.id]);
    if(scroll)this.canvas.focus({preventScroll:true});
  }

  focusHierarchyNeighborhood(record,{scroll=true}={}) {
    this.neighborhood=this.hierarchyNeighborhood(record);this.localIncidentNeighborhood=null;this.expandedIncidentScopes.clear();
    this.showNeighborEdges=false;this.inducedNeighborEdges=[];this.inducedLoadRevision+=1;this.inducedLoading=false;this.inducedError="";
    this.pinnedFocusIds=new Set([record.id]);this.nodeLimit=DEFAULT_NODE_LIMIT;
    this.refreshGraph(record.id);this.pulseIds([record.id]);
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
    this.pinnedFocusIds=new Set([record.id]);this.searchMatchIds.clear();this.nodeLimit=DEFAULT_NODE_LIMIT;
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
    if(this.studyContext){
      const c=this.studyContext;
      $(`#${this.name}-breadcrumb`).textContent="Study / "+(c.community?.label||"Ungrouped state")+" / "+(c.view_kind==="community"?"Community members":"Connections centered on "+guideNodeLabel(c.nodes.find(n=>n.id===c.focus_id)));
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

  screen(node) { const scale=displayScale(this.transform.scale);return {x:node.x*scale+this.transform.x,y:node.y*scale+this.transform.y}; }
  world(point) { const scale=displayScale(this.transform.scale);return {x:(point.x-this.transform.x)/scale,y:(point.y-this.transform.y)/scale}; }
  nodeRadius(node,padding=0,minimum=0) { return displayRadius(displayRadius(node.r,5.5,14)*displayScale(this.transform.scale)+padding,minimum,14*3.2+padding); }
  pointer(event) { const rect=this.canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top}; }
  hitNode(point) { const world=this.world(point);return [...this.nodes].reverse().find((node)=>Math.hypot(node.x-world.x,node.y-world.y)<=displayRadius(node.r,5.5,14)+6/displayScale(this.transform.scale))||null; }
  hitEdge(point) { let best=null,bestDistance=10;this.edges.forEach((edge)=>{ const distance=distanceToSegment(point,this.screen(this.nodeMap.get(edge.source)),this.screen(this.nodeMap.get(edge.target)));if(distance<bestDistance){best=edge;bestDistance=distance;} });return best; }
  clearHold() { if (this.holdTimer!==null) { clearTimeout(this.holdTimer);this.holdTimer=null; } }

  pointerDown(event) {
    if (event.button!==undefined&&event.button!==0) return;
    if(this.studyContext){pauseGuide();if(state.guidePath.busy)return;}
    const point=this.pointer(event),node=this.hitNode(point);try{this.canvas.setPointerCapture(event.pointerId);}catch(_error){}
    this.drag={pointerId:event.pointerId,start:point,last:point,node,moved:false};this.canvas.classList.add("dragging");this.clearHold();
    if (this.canEnter(node)) this.holdTimer=window.setTimeout(()=>{ this.holdTimer=null;if(!this.drag||this.drag.moved)return;this.drag=null;this.canvas.classList.remove("dragging");this.enterNode(node); },650);
  }
  pointerMove(event) {
    const point=this.pointer(event);
    if (this.drag) {
      const dx=point.x-this.drag.last.x,dy=point.y-this.drag.last.y;if(Math.hypot(point.x-this.drag.start.x,point.y-this.drag.start.y)>5){this.drag.moved=true;this.clearHold();}
      if(this.drag.node){this.drag.node.x+=dx/this.transform.scale;this.drag.node.y+=dy/this.transform.scale;}else{this.transform.x+=dx;this.transform.y+=dy;}this.drag.last=point;this.draw();return;
    }
    const hit=this.hitNode(point)||this.hitEdge(point);this.hover=hit;
    if(hit){const detail=hit.source?(hit.description||hit.weight_semantics||hit.edge_type||""):(hit.summary||hit.type||"");this.tooltip.innerHTML=`<b>${esc(compact(hit.label||hit.edge_type||"Connection",120))}</b><small>${esc(compact(detail,200))}</small>`;this.tooltip.style.left=`${Math.max(5,Math.min(this.width-275,point.x+13))}px`;this.tooltip.style.top=`${Math.max(5,Math.min(this.height-82,point.y+13))}px`;this.tooltip.hidden=false;}else this.tooltip.hidden=true;this.draw();
  }
  pointerUp(event) {
    if(!this.drag)return;
    this.clearHold();const point=this.pointer(event),moved=this.drag.moved;this.drag=null;this.canvas.classList.remove("dragging");
    if(!moved){
      const hit=this.hitNode(point)||this.hitEdge(point);this.external=null;this.selected=hit;
      if(this.studyContext){if(hit?.source)inspectStudyEdge(hit);else if(hit)inspectStudyNode(hit.id);this.draw();return;}
      if(this.level==="evidence"&&hit&&!hit.source&&!hit.aggregate_kind)this.inspectEvidenceNode(hit);
      else if(hit&&!hit.source&&!hit.aggregate_kind&&nodeLevel[hit.type])this.inspectHierarchyNode(hit);
      else if(hit?.source)this.inspectRenderedEdge(hit);
      else this.renderInspector();
    }
    this.draw();
  }
  pointerCancel() { this.clearHold();this.drag=null;this.canvas.classList.remove("dragging"); }
  wheel(event) { event.preventDefault();if(this.studyContext)pauseGuide();const point=this.pointer(event),before=this.world(point),scale=Math.max(.12,Math.min(3.2,this.transform.scale*Math.exp(-event.deltaY*.0012)));this.transform.scale=scale;this.transform.x=point.x-before.x*scale;this.transform.y=point.y-before.y*scale;this.draw(); }

  setMatchIds(ids) { this.searchMatchIds=new Set(ids);this.matches=new Set([...this.pinnedFocusIds,...this.searchMatchIds].filter((id)=>this.nodeMap.has(id)));if(this.matches.size){const first=this.nodeMap.get(this.matches.values().next().value);this.transform.x=this.width/2-first.x*this.transform.scale;this.transform.y=this.height/2-first.y*this.transform.scale;}this.draw(); }
  setPreviewSearch(query) { const terms=normalize(query).split(/\s+/).filter(Boolean);this.setMatchIds(this.nodes.filter((node)=>terms.length&&terms.every((term)=>normalize(`${node.label} ${node.summary} ${node.id}`).includes(term))).map((node)=>node.id)); }
  showExternalNode(item) { this.selected=null;this.external=item;this.renderInspector();this.draw(); }
  focusNode(id) { const node=this.nodeMap.get(id);if(!node)return;this.external=null;this.selected=node;this.transform.x=this.width/2-node.x*this.transform.scale;this.transform.y=this.height/2-node.y*this.transform.scale;this.renderInspector();this.draw(); }
  inspectEvidenceNode(node) {
    const revision=++this.inspectionRevision;
    if(this.pulseTimer!==null){window.clearTimeout(this.pulseTimer);this.pulseTimer=null;}
    this.external=null;this.selected=node;
    this.localIncidentNeighborhood=this.neighborhood?.node?.id===node.id?null:this.localIncidentNeighborhood?.node?.id===node.id?this.localIncidentNeighborhood:null;
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
      ctx.fillStyle=band.fill;ctx.fill();
      ctx.strokeStyle=band.stroke;ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.stroke();ctx.setLineDash([]);
    });
    ctx.textBaseline="middle";ctx.textAlign="left";ctx.font='700 8px "Avenir Next", sans-serif';
    const legendX=12,legendY=14,legendWidth=142,legendHeight=10+this.focusBands.length*17;
    ctx.fillStyle="rgba(255,253,248,.91)";ctx.fillRect(legendX,legendY,legendWidth,legendHeight);
    ctx.strokeStyle="rgba(69,91,98,.22)";ctx.lineWidth=1;ctx.strokeRect(legendX+.5,legendY+.5,legendWidth-1,legendHeight-1);
    this.focusBands.forEach((band,index)=>{
      const y=legendY+11+index*17;
      ctx.fillStyle=band.fill;ctx.fillRect(legendX+7,y-5,9,9);ctx.strokeStyle=band.stroke;ctx.strokeRect(legendX+7.5,y-4.5,8,8);
      ctx.fillStyle="#34484d";ctx.fillText(`${band.label.toUpperCase()}  ${fmt(band.count)}`,legendX+22,y);
    });
    ctx.textAlign="start";
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
      if(v64Style){ctx.strokeStyle=v64Style.color;ctx.lineWidth=v64Style.width;
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
      ctx.setLineDash(this.studyContext?(edge.kind==="NAVIGATION"?[8,6]:edge.kind==="SOURCE_AGGREGATE"?[2,6]:[]):edge.investigative_only?[3,5]:["later_only","redacted_placeholder"].includes(edge.visibility)||edge.contains_redaction_placeholder?[5,4]:[]);ctx.stroke();ctx.setLineDash([]);
    });
    const selectedEdge=this.selected?.source?this.selected:null,hoverEdge=this.hover?.source?this.hover:null;
    this.nodes.forEach((node)=>{
      const point=this.screen(node),match=this.matches.has(node.id),selectedNode=this.selected===node,endpoint=[selectedEdge?.source,selectedEdge?.target,hoverEdge?.source,hoverEdge?.target].includes(node.id),active=selectedNode||this.hover===node||endpoint;
      if(match){ctx.beginPath();ctx.arc(point.x,point.y,this.nodeRadius(node,9,9),0,Math.PI*2);ctx.strokeStyle="#d29b2e";ctx.lineWidth=4;ctx.stroke();}
      if(selectedNode){ctx.beginPath();ctx.arc(point.x,point.y,this.nodeRadius(node,4,4),0,Math.PI*2);ctx.strokeStyle=node.visibility_dimmed?"rgba(159,63,47,.58)":"#9f3f2f";ctx.lineWidth=2.8;ctx.stroke();}
      ctx.beginPath();ctx.arc(point.x,point.y,this.nodeRadius(node,0,3.5),0,Math.PI*2);
      ctx.fillStyle=node.visibility_dimmed?"rgba(112,128,134,.32)":colors[node.dominant_node_type]||colors[node.type]||colors.Unknown;ctx.fill();
      ctx.strokeStyle=node.visibility_dimmed?"rgba(112,128,134,.58)":active?"#13242a":"rgba(255,255,255,.78)";ctx.lineWidth=active?3:1.4;ctx.stroke();
    });
    const labelLimit=this.level==="domain"?12:this.level==="theme"?18:this.level==="community"?14:10,labeled=[...this.nodes].filter((node)=>this.matches.has(node.id)||this.selected===node||Number(node.mass||0)>0).sort((left,right)=>{const lp=(this.selected===left?2:0)+(this.matches.has(left.id)?1:0),rp=(this.selected===right?2:0)+(this.matches.has(right.id)?1:0);return rp-lp||Number(right.mass||0)-Number(left.mass||0)||left.id.localeCompare(right.id);});ctx.font=this.studyContext?'600 16px "Avenir Next", sans-serif':'700 9px "Avenir Next", sans-serif';ctx.textBaseline="middle";const placed=[];let labelCount=0;labeled.forEach((node)=>{if(labelCount>=labelLimit)return;const p=this.screen(node),label=compact(node.label,this.level==="domain"?62:this.level==="theme"?46:34),width=ctx.measureText(label).width,nodeRadius=this.nodeRadius(node,5,5);let x=p.x+nodeRadius;if(x+width>this.width-8)x=p.x-nodeRadius-width;x=Math.max(8,Math.min(this.width-width-8,x));const box={left:x-2,right:x+width+2,top:p.y-7,bottom:p.y+7},priority=this.selected===node||this.matches.has(node.id),overlaps=placed.some((other)=>!(box.right<other.left||box.left>other.right||box.bottom<other.top||box.top>other.bottom));if(overlaps&&!priority)return;ctx.lineWidth=3;ctx.strokeStyle=node.visibility_dimmed?"rgba(255,250,240,.68)":"rgba(255,250,240,.96)";ctx.strokeText(label,x,p.y);ctx.fillStyle=node.visibility_dimmed?"#67777a":"#13242a";ctx.fillText(label,x,p.y);placed.push(box);labelCount+=1;});
  }

  incidentConnections(item) {
    const detail=this.localIncidentNeighborhood?.node?.id===item.id?this.localIncidentNeighborhood:this.neighborhood?.node?.id===item.id?this.neighborhood:null;
    if(!detail)return "";
    const nodeById=new Map([detail.node,...(detail.neighbors||[])].map((row)=>[row.id,row]));
    const scopeLabels={same_community:"Same Community",same_theme:"Same Theme, another Community",same_domain:"Same Domain, another Theme",cross_domain:"Another Domain",outside_hierarchy:"Outside the overview hierarchy"};
    const groups=new Map();
    (detail.edges||[]).forEach((edge)=>{
      const otherId=edge.source===item.id?edge.target:edge.source,other=nodeById.get(otherId);
      const ineligible=eligibilityReasons(edge,{includeRelease:releaseFilterApplies(this.view)}).length>0||eligibilityReasons(other,{includeRelease:releaseFilterApplies(this.view)}).length>0;
      if(!state.showIneligible&&ineligible)return;
      const knownScopes=["same_community","same_theme","same_domain","cross_domain","outside_hierarchy"];
      const inferred=focusScope(this.level,item,other);
      const scope=knownScopes.includes(edge.hierarchy_scope)?edge.hierarchy_scope:knownScopes.includes(inferred)?inferred:"outside_hierarchy";
      if(!groups.has(scope))groups.set(scope,[]);
      groups.get(scope).push(edge);
    });
    const order=["same_community","same_theme","same_domain","cross_domain","outside_hierarchy"];
    const sections=order.filter((scope)=>groups.has(scope)).map((scope)=>{
      const edges=groups.get(scope),key=`${item.id}:${scope}`,pageSize=24,pages=Math.max(1,Math.ceil(edges.length/pageSize));
      const page=Math.max(0,Math.min(pages-1,this.incidentPages.get(key)||0)),start=page*pageSize,visible=edges.slice(start,start+pageSize);
      this.incidentPages.set(key,page);
      const rows=visible.map((edge)=>{
        const otherId=edge.source===item.id?edge.target:edge.source,other=nodeById.get(otherId)||{label:otherId,type:"Unknown"};
        const channels=Object.keys(edge.channel_counts||{}).join(", ")||edge.edge_type||"connection";
        const ineligible=eligibilityReasons(edge,{includeRelease:releaseFilterApplies(this.view)}).length>0||eligibilityReasons(other,{includeRelease:releaseFilterApplies(this.view)}).length>0;
        const dimmed=this.visibilityPolicy()==="dim"&&ineligible;
        return `<article class="incident-row${dimmed?" visibility-dimmed-row":""}" data-incident-row="${esc(edge.id)}"><b>${esc(other.label)}</b><p>${esc(other.type)} / ${esc(channels)} / published weight ${graphWeight(edge.layout_weight??edge.weight??0)}${dimmed?" / outside the current display policy":""}</p><div class="incident-row-actions"><button type="button" data-incident-edge="${esc(edge.id)}">Inspect relationship</button><button type="button" data-connected-node="${esc(otherId)}">Inspect node</button><button type="button" data-traverse-node="${esc(otherId)}">Traverse direct connections</button><button type="button" data-open-mother="${esc(otherId)}">Open node's mother Community</button></div></article>`;
      }).join("");
      const pageButton=(label,target,disabled)=>`<button type="button" data-incident-page="${target}" data-incident-scope="${esc(scope)}" data-incident-owner="${esc(item.id)}" ${disabled?"disabled":""}>${label}</button>`;
      const pager=`<div class="incident-pagination" data-scope="${esc(scope)}"><p role="status">Connections ${start+1}-${start+visible.length} of ${fmt(edges.length)} / page ${page+1} of ${pages}. The canvas node ceiling does not limit this list.</p><div>${pageButton("First",0,page===0)}${pageButton("Previous",page-1,page===0)}${pageButton("Next",page+1,page===pages-1)}${pageButton("Last",pages-1,page===pages-1)}</div></div>`;
      return `<details class="incident-group" open><summary>${esc(scopeLabels[scope])} <b>${fmt(edges.length)}</b></summary>${pager}<div class="incident-list">${rows}</div></details>`;
    }).join("");
    const ego=Boolean(this.neighborhood),isCenter=this.neighborhood?.node?.id===item.id;
    const motherCommunity=detail.node?.community_id?`<button type="button" class="inspector-action secondary" data-open-local-community>Open this node's mother Community</button>`:'<p class="incident-status">No mother Community is recorded for this node in this exploration layout. No membership is invented.</p>';
    const returnHierarchy=ego&&this.level!=="evidence"?`<button type="button" class="inspector-action secondary" data-return-focus-view>Return to ${esc(this.level)} view</button>`:"";
    const recenter=ego&&!isCenter?`<button type="button" class="inspector-action" data-recenter-incident>Recenter direct connections here</button>`:"";
    const switchView=ego?`${motherCommunity}${returnHierarchy}${recenter}`:this.localIncidentNeighborhood?`<button type="button" class="inspector-action secondary" data-open-incident-neighborhood>View all direct connections</button>`:"";
    const induced=ego&&isCenter?`<button type="button" class="inspector-action tertiary" data-toggle-neighbor-edges ${this.inducedLoading?"disabled":""}>${this.inducedLoading?"Loading published links...":this.showNeighborEdges?"Hide links among neighbors":"Connect displayed neighbors"}</button>`:"";
    const status=this.inducedError?`<p class="incident-error">Neighbor links unavailable: ${esc(this.inducedError)}</p>`:ego&&this.showNeighborEdges&&!this.inducedLoading?`<p class="incident-status">${fmt(this.graph?.neighborEdgeCount||0)} published links among the displayed direct neighbors are rendered in addition to the selected node's spokes.</p>`:"";
    const legend=ego?`<div class="scope-legend"><span class="same-community">Same Community</span><span class="same-theme">Same Theme</span><span class="same-domain">Same Domain</span><span class="cross-domain">Another Domain</span><span class="outside-hierarchy">Outside hierarchy</span></div>`:"";
    const heading=ego?(isCenter?`${item.type||"Node"}-centered connection view`:"Selected neighbor in the centered view"):this.level==="evidence"?"Hierarchy context: mother Community":`${item.type||"Hierarchy"} connections`;
    const explanation=ego?(isCenter?"The center is the selected node. Shaded rings encode increasing hierarchy distance; they do not create or filter edges.":`The graph remains centered on the prior node. Recenter here to make this ${String(item.type||"node").toLowerCase()} the hub${this.level==="evidence"?", or open its mother Community":""}.`):this.level==="evidence"?"The selected node remains in its assigned Community. Only visible local endpoints are drawn here; the complete direct-edge inventory remains grouped below.":"The node remains in the current hierarchy layout. Open its complete direct connections only when you want an ego view.";
    const listed=[...groups.values()].reduce((sum,edges)=>sum+edges.length,0),total=(detail.edges||[]).length;
    const empty=total?'No relationships match the current ineligible-context display controls. The frozen inventory is not empty.':'No published incident edge is recorded for this node. Source provenance is separate from semantic topology.';
    return `<section class="incident-neighborhood"><div class="incident-heading"><p><b>${heading}</b><br>${explanation}<br>${fmt((detail.neighbors||[]).length)} directly connected nodes and ${fmt(total)} complete published incident relationships. ${fmt(listed)} listed across the pages below; ${fmt(total-listed)} hidden by the current display controls.</p><div class="incident-actions">${switchView}${induced}</div></div>${legend}${status}${sections||`<p>${empty}</p>`}</section>`;
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
    if(this.studyContext){renderStudyInspector();return;}
    const selected=this.external||this.selected;
    // Community/search records are compact. The same-view incident record
    // carries exact source quotations without moving the selected node.
    const detail=selected&&!selected.source?[this.localIncidentNeighborhood?.node,this.neighborhood?.node].find((node)=>node?.id===selected.id):null;
    const item=selected?{...detail,...selected,evidence_examples:detail?.evidence_examples??selected.evidence_examples}:null;
    const inspectorItemKey=item?`${item.source?"edge":"node"}:${item.id||`${item.source||""}:${item.target||""}`}`:"empty";
    if(this.inspectorItemKey!==inspectorItemKey){this.inspector.scrollTop=0;this.inspectorItemKey=inspectorItemKey;}
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
    this.inspector.innerHTML=`${visibilityNotice}${redactionNodeNotice}<div class="inspector-head"><div><p class="eyebrow">${this.external?"Full-catalog object":"Selected node"}</p><h3>${esc(compact(item.label,180))}</h3></div><span class="type-pill">${esc(type)}${item.visibility?` &middot; ${esc(visibilityLabel(item.visibility))}`:""}</span></div><div class="inspector-stats"><div><b>${firstStat}</b><span>${firstLabel}</span></div><div><b>${secondStat}</b><span>${secondLabel}</span></div><div><b>${thirdStat}</b><span>${thirdLabel}</span></div></div>${this.canEnter(item)?`<button class="inspector-action" data-enter-selected>Open ${esc(nextLevel[this.level])} level</button>`:""}${visibilityComposition}${item.identity_scope?`<p><b>Identity scope:</b> ${esc(item.identity_scope)}${item.identity_scope.startsWith("context-sensitive")?"; inspect provenance before treating all occurrences as one real-world referent.":"."}</p>`:""}${item.summary?`<p>${esc(item.summary)}</p>`:""}${item.aliases?.length?`<p><b>Observed surface forms:</b> ${item.aliases.map(esc).join(", ")}</p>`:""}${claimMetadata}${path}${incidentHtml}${childHtml}${associations?`<p><b>Audited related concepts:</b></p><div class="association-list">${associations}</div>`:""}${slotAudit}${evidence?`<div class="evidence-list source-buttons">${evidence}</div>`:""}${technicalId}`;
    $('[data-enter-selected]',this.inspector)?.addEventListener("click",()=>this.enterNode(item));
    $$('[data-association-index]',this.inspector).forEach((button)=>button.addEventListener("click",()=>this.showAssociation(item,(item.associations||[])[Number(button.dataset.associationIndex)])));
    $$('[data-incident-edge]',this.inspector).forEach((button)=>button.addEventListener("click",()=>this.inspectIncidentEdge(button.dataset.incidentEdge)));
    const navigate=action=>Promise.resolve().then(action).catch(error=>this.inspectionError(error));
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
  }
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
        base.overview_nodes=payload.nodes||[];base.overview_edges=payload.edges||[];
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
      base.catalog_nodes=payload.nodes||[];base.catalog_edges=payload.edges||[];
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
  const stop=new Set(['under','the','and','for','of','with','to','in','at','a','an','by','from','as','is','was','were','on','this','that','said']);
  const source=String(value||""),usable=[...new Set((terms||[]).map((term)=>String(term||"").trim()).filter((term)=>term.length>=3&&normalize(term).split(/\s+/).some(word=>!stop.has(word))))].sort((left,right)=>right.length-left.length).slice(0,16);
  if(!usable.length)return esc(source);
  const pattern=new RegExp(`(${usable.map((term)=>term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")})`,"gi");
  return source.split(pattern).map((part,index)=>index%2?`<mark>${esc(part)}</mark>`:esc(part)).join("");
}

function focalSourceText(value, terms, slotId, revealText="", markerSlotId=slotId) {
  const text=String(value||"");let cursor=0,output="",ordinal=0;
  const pattern=/\[\[REDACTION_SLOT:\d+:([^\]]+)\]\]|\[(?:STILL\s+)?(?:REDACTION|REDACTED)(?:\s+\d+)?\]/gi;
  for(const match of text.matchAll(pattern)){
    output+=highlightedSourceText(text.slice(cursor,match.index),revealText?[revealText]:terms);
    ordinal+=1;
    output+=match[1]===markerSlotId?`<mark class="focal-source-slot" data-focal-slot="${esc(slotId)}">[REDACTION ${ordinal}] · selected${markerSlotId!==slotId?" region":""}</mark>`:`<span class="source-opaque-slot">[REDACTION ${ordinal}]</span>`;
    cursor=match.index+match[0].length;
  }
  return output+highlightedSourceText(text.slice(cursor),revealText?[revealText]:terms);
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

function closeCibSource() {
  const drawer=$("#cib-source-drawer"),scrim=$("#cib-drawer-scrim");
  if(!drawer)return;
  drawer.classList.remove("open");drawer.setAttribute("aria-hidden","true");
  if(scrim)scrim.hidden=true;
  const frame=$("#cib-pdf-frame");if(frame){frame.hidden=true;frame.removeAttribute("src");}
  $("#cib-pdf-focus-status")?.remove();
  state.sourceRequestRevision=(state.sourceRequestRevision||0)+1;
}

async function openCibSource(panel,documentId,{canonicalPageId="",highlights=[],slotId="",revealText=""}={}) {
  const drawer=$("#cib-source-drawer"),scrim=$("#cib-drawer-scrim");
  if(!drawer)return;
  const revision=state.sourceRequestRevision=(state.sourceRequestRevision||0)+1;
  const previousPdf=$("#cib-pdf-frame");if(previousPdf){previousPdf.hidden=true;previousPdf.removeAttribute("src");}
  $("#cib-pdf-focus-status")?.remove();
  const view=panel.view;
  const release=view.release_view,terms=[...new Set(highlights.filter(Boolean))];
  const markerSlotId=release==="earlier"?(state.redactionProjection?.cases||[]).find(row=>row.slot_id===slotId)?.source_marker_slot_id||slotId:slotId;
  const paired=!singleCorpusMode;
  drawer.classList.add("open");drawer.setAttribute("aria-hidden","false");if(scrim)scrim.hidden=false;
  $("#cib-source-kicker").textContent=singleCorpusMode?"Canonical cable source":`${release==="earlier"?"Earlier release / redacted":"Later release / less redacted"} source`;
  $("#cib-source-title").textContent=documentId;$("#cib-source-meta").innerHTML=`<span>Loading ${paired?"paired transcript":"source record"}...</span>`;$("#cib-source-body").innerHTML="";
  try{
    const source=await ensureCibSource(view,documentId),pages=source.pages||[];
    state.pdfApiAvailable=corpusId==="cib"&&refreshBinding.pdf_available===true;
    if(revision!==state.sourceRequestRevision)return;
    if(!isDocumentAvailableAsOf(documentId,String(source.document_date_iso||"")))throw new Error(`This source is outside the independent explorer's inclusive ${state.asOfPolicy.cutoff} as-of date. No case origin exclusion is applied.`);
    let active=pages.find((page)=>page.canonical_page_id===canonicalPageId);
    if(!active&&pages.length)active=[...pages].sort((left,right)=>sourceMatchScore(right,terms)-sourceMatchScore(left,terms)||left.sequence_in_document-right.sequence_in_document)[0];
    $("#cib-source-title").textContent=source.title?`${source.title} / ${documentId}`:documentId;
    $("#cib-source-meta").innerHTML=[source.date,`${pages.length} ${paired?"aligned pages":"source segments"}`,singleCorpusMode?"Canonical prepared cable transcript":release==="earlier"?"Earlier-release projection":"Later-release projection"].filter(Boolean).map((value)=>`<span>${esc(value)}</span>`).join("");
    $("#cib-source-release-actions").innerHTML=singleCorpusMode?'<span>Canonical prepared cable source; classification projections are not paired redactions.</span>':`<button type="button" class="${release==="earlier"?"active":""}" data-cib-switch-release="current_earlier">Earlier-release transcript</button><button type="button" class="${release==="later"?"active":""}" data-cib-switch-release="current_later">Later-release transcript</button>`;
    const pdfNote=state.pdfApiAvailable?"The frozen transcript supplies the release and PDF page. No PDF box coordinates are guessed; highlighted terms are text matches, not exact-offset entailment proofs.":"This frozen source transcript is available. Highlighted terms are text matches, not exact-offset entailment proofs; no PDF box coordinates are guessed.";
    const noPages=`<section class="cib-source-page"><p>No canonical aligned transcript page is retained for this pair.</p><button type="button" class="cib-pdf-button" data-cib-pdf-page="1" ${state.pdfApiAvailable?"":"disabled"}>${state.pdfApiAvailable?`Open ${esc(release)} PDF from page 1`:"PDF available in local mode"}</button></section>`;
    $("#cib-source-body").innerHTML=`<p class="cib-pdf-note">${esc(pdfNote)}${markerSlotId!==slotId?" This target shares an earlier masked region with another slot; the region is highlighted without inventing an internal boundary.":""}</p>`+(pages.map((page)=>`<section class="cib-source-page ${page===active?"active":""}" data-cib-page="${esc(page.canonical_page_id)}"><header><b>${paired?"Aligned page":"Source segment"} ${fmt(page.sequence_in_document)}</b>${paired?`<span>PDF page ${fmt(page.source_page)}</span>`:""}</header><div>${highlightedSourceText(page.text,terms)}</div>${paired?`<button type="button" class="cib-pdf-button" data-cib-pdf-page="${Number(page.source_page||1)}" ${state.pdfApiAvailable?"":"disabled"}>${state.pdfApiAvailable?`Open ${esc(release)} PDF at page ${fmt(page.source_page)}`:"PDF available in local mode"}</button>`:""}</section>`).join("")||noPages);
    $$('[data-cib-switch-release]',drawer).forEach((button)=>button.addEventListener("click",()=>openCibSource({...panel,view:state.data.views[button.dataset.cibSwitchRelease]},documentId,{canonicalPageId:active?.canonical_page_id||canonicalPageId,highlights:terms,slotId,revealText})));
    $$('[data-cib-pdf-page]',drawer).forEach((button)=>button.addEventListener("click",async()=>{
      const frame=$("#cib-pdf-frame"),page=Number(button.dataset.cibPdfPage||1);
      let status=$("#cib-pdf-focus-status");
      if(!status){status=document.createElement("p");status.id="cib-pdf-focus-status";status.className="cib-pdf-note";status.setAttribute("role","status");frame.before(status);}
      status.textContent=`Original ${release} PDF · page ${page}`;
      if(revision!==state.sourceRequestRevision)return;
      const canonicalPage=button.closest(".cib-source-page")?.dataset.cibPage;
      const pdfPage=pages.find(item=>item.canonical_page_id===canonicalPage);
      const actualPage=Number(pdfPage?.source_page||0);
      if(!Number.isInteger(actualPage)||actualPage<1){status.textContent="No PDF page was recorded in the frozen transcript.";return;}
      const pdfUrl=new URL("/api/cib-pdf",location.origin);pdfUrl.search=new URLSearchParams({doc_id:documentId,release}).toString();
      status.textContent=`Original ${release} PDF${actualPage>0?` / page ${actualPage}`:" / page not recorded"}`;
      if(!pdfUrl.hash&&actualPage>0)pdfUrl.hash=`page=${actualPage}&zoom=page-width`;
      frame.src=pdfUrl.href;
      frame.hidden=false;
    }));
  }catch(error){if(revision===state.sourceRequestRevision)$("#cib-source-body").innerHTML=`<p>${esc(error.message)}</p>`;}
}

function bindCibSourceButtons(root,panel) {
  $$('[data-cib-document]',root).forEach((button)=>button.addEventListener("click",()=>{
    const selected=panel.external||panel.selected;
    const focal=redactionCaseForRecord(selected||{});
    openCibSource(panel,button.dataset.cibDocument,{canonicalPageId:button.dataset.cibPage||focal?.canonical_page_id||"",highlights:String(button.dataset.cibHighlight||"").split("||").filter(Boolean),slotId:focal?.document_id===button.dataset.cibDocument?focal.slot_id:""});
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
      if (payload.schema_version!=="cib-community-detail/1.1"||!assetViewMatches(payload,view.key)) throw new Error(`Unexpected ${view.key} community detail shard`);
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
}

async function ensureNodeNeighborhood(view,nodeId) {
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
      if(payload.schema_version!=="cib-node-neighborhood/1.0"||!assetViewMatches(payload,view.key))throw new Error(`Unexpected ${view.key} neighborhood shard`);
      state.neighborhoodShards[key]=payload.neighborhoods||{};
    });
  }
  await state.neighborhoodPromises[key];
  const detail=state.neighborhoodShards[key]?.[nodeId];
  if(!detail)throw new Error(`Node ${nodeId} is absent from ${filename}`);
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
  const rows=await Promise.all(ids.map(async(id)=>[id,await ensureCompactAdjacency(view,id)]));
  const edges=new Map();
  rows.forEach(([source,neighbors])=>{
    (neighbors||[]).forEach(([target,weight,visibility,minimumDocumentDate])=>{
      if(!selected.has(target)||source===target)return;
      const [left,right]=source<target?[source,target]:[target,source],pair=`${left}\u241f${right}`;
      if(edges.has(pair))return;
      edges.set(pair,{id:`induced:${pair}`,source:left,target:right,weight:Number(weight||0),layout_weight:Number(weight||0),visibility:visibility||"both",minimum_document_date:minimumDocumentDate||"",edge_type:"published neighbor-to-neighbor link",weight_semantics:"Published graph edge loaded from the compact adjacency index; select it to hydrate complete channels and provenance.",compact_induced:true});
    });
  });
  return [...edges.values()].sort((left,right)=>Number(right.layout_weight)-Number(left.layout_weight)||left.id.localeCompare(right.id));
}

function renderPanelCaption(panel) {
  const graph=panel.graph;
  if (!graph) return;
  const context=panel.trail.length?` within ${panel.trail[panel.trail.length-1].label}`:" in the corpus view";
  const setCaption=(value)=>{
    const policy=state.guideOverlay
      ? ` Case source context: strictly before ${state.guideOverlay.scope.strictly_before} (exclusive); origin ${state.guideOverlay.scope.whole_origin_excluded} excluded. Full KG topology and aggregate weights remain unchanged; gray edges are unassessed.`
      : state.asOfPolicy.enabled
      ? ` Independent inclusive as-of orientation: objects with no admissible support by ${state.asOfPolicy.cutoff}, or only undated support, are ineligible for this date. ${fmt(graph.policyExcludedNodeCount)} loaded nodes and ${fmt(graph.policyExcludedEdgeCount)} loaded edges are marked and are ${state.showIneligible?(state.visibilityMode==="dim"?"dimmed":"shown in full color"):"hidden"}; the hierarchy and level do not change. Published aggregate weights are orientation metadata, not date-recomputed evidence weights or a workbench verdict.`
      : "";
    $(`#${panel.name}-caption`).textContent=`${value}${policy}`;
  };
  if (graph.focusMode) {
    const ceiling=graph.availableNodeCount>MAX_RENDERED_NODES?` The 2,048-node maximum shows ${fmt(MAX_RENDERED_NODES)} of ${fmt(graph.availableNodeCount)} endpoints.`:" The selected ceiling includes every directly connected endpoint.";
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
    $(".reveal-control")?.toggleAttribute("hidden",state.displayMode==="pair");
  }
  state.panels.legacy.setGraph(legacy); state.panels.current.setGraph(current); renderMetrics(legacy,current); applySearch();
}

async function ensureSearchCatalog(keys) {
  if (!state.searchManifest) {
    const response=await fetch(searchAsset,{cache:"no-store"});
    if (!response.ok) throw new Error(`Search manifest HTTP ${response.status}`);
    state.searchManifest=await boundJson(response,refreshBinding.search_sha256);
    if (state.searchManifest.schema_version!=="cib-graph-search/3.4") throw new Error(`Unexpected search schema ${state.searchManifest.schema_version}`);
    if((state.searchManifest.graph_run_id!==state.data.graph_run_id||state.searchManifest.hierarchy_run_id!==state.data.hierarchy_run_id))throw new Error("Search and graph belong to different refresh revisions");
  }
  await Promise.all(keys.map(async(key)=>{
    if (state.searchViews[key]) return;
    if (!state.searchPromises[key]) {
      const filename=state.searchManifest.view_files[key];
      state.searchPromises[key]=fetch(assetURL(filename),{cache:"no-store"}).then((response)=>{ if (!response.ok) throw new Error(`${key} search index HTTP ${response.status}`); return parseJsonAsset(response,filename); }).then((payload)=>{
        if (payload.schema_version!=="cib-graph-search/3.4"||!assetViewMatches(payload,key)) throw new Error(`Unexpected ${key} search payload`);
        payload.records.forEach((row)=>{ row.kind="node";row._surfaces=[row.label,row.canonical_label,...(row.aliases||[])].map(normalize).filter(Boolean); row._search=normalize(`${row.label} ${row.canonical_label||""} ${(row.aliases||[]).join(" ")} ${row.summary||""}`); });
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
        if(payload.schema_version!=="cib-graph-search/3.4"||!assetViewMatches(payload,key)||payload.record_kind!=="evidence_node")throw new Error(`Unexpected ${key} evidence search payload`);
        payload.records.forEach((row)=>{
          row.kind="node";
          row._surfaces=[row.label,row.search_context,...(row.aliases||[])].map(normalize).filter(Boolean);
          row._search=normalize(`${row.label} ${row.search_context||""} ${(row.aliases||[]).join(" ")} ${row.summary||""} ${row.type||""}`);
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
      const matchedAliases=[match.label,...(match.aliases||[])];
      row._surfaces=[row.label,row.source_label,row.target_label,row.edge_type,...Object.keys(row.channel_counts||{}),...matchedAliases].map(normalize).filter(Boolean);
      row._search=normalize(`${row.label} ${row.edge_type||""} ${Object.keys(row.channel_counts||{}).join(" ")} ${matchedAliases.join(" ")}`);
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
  record._surfaces=[normalize(row.label)];
  record._search=normalize(`${row.label} ${row.summary||""} ${row.description||""}`);
  return record;
}

async function searchRecordsForScope(view,scope,query) {
  const key=view.key;
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
    if(scope==="redaction"){
      const enriched=filtered.map((row)=>{
        const redactionCase=redactionCaseForRecord(row);
        if(!redactionCase)return row;
        const slotSearch=normalize(redactionCase.slot_id);
        return {
          ...row,
          slot_id:redactionCase.slot_id,
          _surfaces:[...new Set([...(row._surfaces||[]),slotSearch])],
          _search:`${row._search||""} ${slotSearch} ${normalize(redactionCase.context_preview||"")}`.trim(),
        };
      });
      return {records:enriched,count:enriched.length};
    }
    return {records:filtered,count:filtered.length};
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
    const detail=edge?`${fmt(row.evidence_count)} supporting documents / ${row.edge_type}`:hierarchy?`${row.type} / ${fmt(row.mass)} assigned evidence nodes`:`${row.type||"Entity"} / ${fmt(row.document_count)} documents${row.visibility?` / ${visibilityLabel(row.visibility)}`:""}${row.aliases?.length?` / aliases: ${compact(row.aliases.join(", "),90)}`:""}`;
    const action=edge?"Inspect edge":hierarchy?`Open ${row.hierarchy_level}`:"Inspect node";
    return `<button class="search-hit" type="button" data-search-panel="${name}" data-search-index="${index}"><span><b>${esc(row.label)}</b><small>${esc(detail)}</small></span><span>${esc(action)}</span></button>`;
  }).join(""):`<p class="metric-caveat">No match in the complete selected object index.</p>`}</section>`;
  const {legacy,current}=currentViews(),visible=new Set(visiblePanelNames()); container.innerHTML=(visible.has("legacy")?column("legacy",legacy.label):"")+(visible.has("current")?column("current",current.label):""); container.hidden=false;
  $$('[data-search-panel]',container).forEach((button)=>button.addEventListener("click",async()=>{
    const panel=button.dataset.searchPanel,row=state.searchResults[panel][Number(button.dataset.searchIndex)];
    const actionLabel=button.lastElementChild.textContent;
    button.disabled=true;button.lastElementChild.textContent="Opening...";container.hidden=true;
    try{await state.panels[panel].navigateToSearchResult(row);}catch(error){state.panels[panel].showExternalNode({...row,summary:`Navigation could not complete: ${error.message}. ${row.summary||""}`});}finally{button.disabled=false;button.lastElementChild.textContent=actionLabel;}
  }));
}

let searchTimer=null;
function applySearch() {
  clearTimeout(searchTimer); const raw=$("#graph-search").value.trim(); state.query=normalize(raw);state.searchScope=$("#search-scope").value;
  if (!state.query) { $("#search-status").textContent=""; state.panels.legacy.setPreviewSearch(""); state.panels.current.setPreviewSearch(""); renderSearchResults(); return; }
  state.panels.legacy.setPreviewSearch(raw); state.panels.current.setPreviewSearch(raw); $("#search-status").textContent=`Loading complete ${state.searchScope} indexes...`;
  searchTimer=setTimeout(async()=>{
    try {
      const {legacy,current}=currentViews(),query=state.query,scope=state.searchScope;
      const [legacyCatalog,currentCatalog]=await Promise.all([searchRecordsForScope(legacy,scope,query),searchRecordsForScope(current,scope,query)]);
      if (query!==normalize($("#graph-search").value)||scope!==$("#search-scope").value) return;
      state.searchResults.legacy=topMatches(searchableRecords(legacyCatalog.records,"legacy"),query); state.searchResults.current=topMatches(searchableRecords(currentCatalog.records,"current"),query);
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
      $("#search-status").textContent=`${matchSummary} matches shown.${basis}${filterNote}`; renderSearchResults();
      if(state.autoOpenSearch){
        const openDirect=state.autoOpenDirect;
        state.autoOpenSearch=false;
        state.autoOpenDirect=false;
        const panelName=visiblePanelNames().includes("current")?"current":"legacy";
        const row=state.searchResults[panelName]?.[0];
        if(row){
          $("#search-results").hidden=true;
          await state.panels[panelName].navigateToSearchResult(row);
          if(openDirect&&row.kind!=="edge"&&row.kind!=="hierarchy"){
            await state.panels[panelName].focusNeighborhood(row);
          }
        }
      }
    } catch (error) { $("#search-status").textContent=`Full search unavailable: ${error.message}`; }
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
  if(packet?.case_id!==selection.case_id||packet.corpus!==corpusId||packet.config&&packet.config!==selection.config||packet.candidate?.id!==selection.candidate_id)throw Error("Saved guide belongs to another case, corpus, condition or candidate.");
  const route=packet.route,nodes=route?.nodes,hops=route?.hops;
  if(!Array.isArray(nodes)||!nodes.length||!Array.isArray(hops)||hops.length!==nodes.length-1||nodes.some(n=>typeof n.id!=="string"||!n.id||n.id.length>600))throw Error("Invalid ordered saved route.");
  const lexical=route.route_kind==="LEXICAL_SOURCE_READOUT";
  hops.forEach((h,i)=>{if(h.source!==nodes[i].id||h.target!==nodes[i+1].id||!(lexical?["SEARCH_RECEIPT_READOUT","EXACT_QUOTATION_READOUT","CONSTRUCTION_READOUT"]:["SOURCE","NAVIGATION","SOURCE_AGGREGATE"]).includes(h.kind))throw Error("Saved connection order or kind differs.");});
  if(lexical&&(nodes.some(n=>n.solver_state!==false||n.readout_only!==true)||hops.map(h=>h.kind).join()!=="SEARCH_RECEIPT_READOUT,EXACT_QUOTATION_READOUT,CONSTRUCTION_READOUT"))throw Error("Malformed lexical source readout.");
  const inventories=[route.citations,route.sources,route.source_quotes,packet.citations,...hops.map(h=>h.citations)].filter(v=>v!=null);
  if(inventories.some(v=>!Array.isArray(v)))throw Error("Invalid source inventory.");
  const seen=new Set(),citations=inventories.flat().filter(c=>{if(!c||typeof c!=="object")throw Error("Invalid source proof.");const key=JSON.stringify([c.document_id,c.canonical_page_id,c.start,c.end,c.text]);if(seen.has(key))return false;seen.add(key);return true;});
  const steps=lexical?[{type:"receipt",label:"Search to source"}]:[{type:"context",node_index:0,label:"Starting community"},...hops.map((h,i)=>({type:"connection",hop_index:i,node_index:i+1,label:h.kind==="NAVIGATION"?"Hierarchy navigation":"Source context"}))];
  if(citations.length)steps.push({type:"source",label:"Original sources"});
  if(lexical||packet.candidate.binding==="source_page_readout")steps.push({type:"readout",label:"Proposed wording"});
  return {packet,selection,nodes,hops,citations,steps,lexical,index:0,busy:false,playing:false,timer:null,error:null,limit:256,settledAt:null,sourceIndex:0};
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
  if(!host){host=document.createElement("aside");host.id="retrieval-path-guide";host.className="retrieval-path-guide guide-v63 guide-v64";host.setAttribute("aria-label","Saved source-context navigator");$(".graph-grid").before(host);}
  return host;
}

function pauseGuide() {
  const g=state.guidePath;if(!g)return;
  g.playing=false;clearTimeout(g.timer);g.timer=null;
  $$('[data-guide-play]').forEach(b=>{b.textContent="Play";b.setAttribute("aria-pressed","false");});
}

function guideCloseSource() {guideSourceEpoch++;$("#study-guide-drawer")?.remove();$("#study-guide-scrim")?.remove();}

function enterGuideControls(g) {
  g.savedControls=$$('[data-eligibility-style],#show-ineligible,#temporal-control input,#temporal-control button').map(node=>[node,node.disabled]);
  g.visibilityNoteNode=$('.visibility-note');g.visibilityNote=g.visibilityNoteNode?.innerHTML;
  const temporal=$('#temporal-control');g.savedTemporalControl=temporal?{node:temporal,hidden:temporal.hidden}:null;
  for(const [node] of g.savedControls)node.disabled=true;
  if(temporal)temporal.hidden=true;
  if(g.visibilityNoteNode)g.visibilityNoteNode.textContent='Case eligibility coloring only: strictly before '+g.packet.scope.strictly_before+' (exclusive); origin '+g.packet.scope.whole_origin_excluded+' excluded. The full KG topology and browser hierarchy remain unchanged. Edges stay gray unless their exact eligible source relation and type are proven.';
}

function restoreGuideControls(g) {
  for(const [node,disabled] of g.savedControls||[])node.disabled=disabled;
  if(g.visibilityNoteNode&&g.visibilityNote!=null)g.visibilityNoteNode.innerHTML=g.visibilityNote;
  if(g.savedTemporalControl)g.savedTemporalControl.node.hidden=g.savedTemporalControl.hidden;
}

function closeSavedGuide() {
  const g=state.guidePath;if(!g)return;
  pauseGuide();guideEpoch++;g.abort?.abort();guideCloseSource();
  const panel=state.panels.current;
  guideCancelMotionV64(panel);panel.v64Traversal=null;
  state.guidePath=null;state.guideOverlay=null;document.body.classList.remove("guide-active","guide-v63-active","guide-v64-active");
  restoreGuideControls(g);
  panel.canvas.hidden=false;panel.canvas.removeAttribute("aria-busy");panel.canvas.removeAttribute("data-guide-settled-at");
  $$(".guide-fade-layer").forEach(n=>n.remove());
  if(g.exploration){panel.nodeHistory=[];panel.restoreLocation(g.exploration);}
  $("#retrieval-path-guide")?.remove();
  const url=new URL(location.href);[...url.searchParams.keys()].filter(k=>k.startsWith("guide_")).forEach(k=>url.searchParams.delete(k));history.replaceState(null,"",url);
}

function validateGuideOverlay(value,g) {
  if(value?.version!=="full-kg-source-overlay/6.4"||value.lens!=="full_browser_overlay"||value.corpus!==corpusId||value.case_id!==g.packet.case_id||value.topology_replaced!==false||
    value.browser_binding?.graph_id!==refreshBinding.graph_run_id||value.browser_binding?.hierarchy_id!==refreshBinding.hierarchy_run_id||value.browser_binding?.comparison_sha256!==refreshBinding.comparison_sha256||
    value.study_binding?.graph_id!==g.packet.graph_binding.graph_id||value.study_binding?.hierarchy_id!==g.packet.graph_binding.hierarchy_id||
    value.scope?.strictly_before!==g.packet.scope.strictly_before||value.scope?.whole_origin_excluded!==g.packet.scope.whole_origin_excluded||
    !Array.isArray(value.eligible_ids)||!Array.isArray(value.eligible_group_ids)||!Array.isArray(value.eligible_document_ids)||value.endpoint_mappings?.length!==g.nodes.length||value.connections?.length!==(g.lexical?0:g.hops.length))throw Error("Full KG/source-context binding or eligibility changed. No alternate graph was substituted.");
  value.endpoint_mappings.forEach((m,i)=>{
    if(m.native_id!==g.nodes[i].id||m.browser_id!==null&&(m.browser_id!==m.native_id&&!(m.status==="SAME_PINNED_HIERARCHY"&&value.layout_matches_study&&m.native_id===`hierarchy:${m.level}:${m.browser_id}`))||m.status==="PROVEN_SOURCE_ID"&&(!m.source_identity?.job_id||!m.source_identity?.source_entity_or_node_id||!m.source_identity?.canonical_page_id||!m.source_identity?.document_id))throw Error("Unproven endpoint mapping; label fallback is forbidden.");
  });
  value.connections.forEach((c,i)=>{
    const proofs=c.browser_edge_proofs||[];
    if(c.native_source!==g.hops[i].source||c.native_target!==g.hops[i].target||c.kind!==g.hops[i].kind||c.native_source_verified!==true||typeof c.browser_edge_verified!=='boolean'||c.browser_edge_verified!==(proofs.length>0)||!Array.isArray(c.browser_edge_ids)||JSON.stringify([...new Set(proofs.map(p=>p.id))].sort())!==JSON.stringify(c.browser_edge_ids))throw Error("Native/browser edge correspondence was not proven.");
    proofs.forEach(p=>{
      const s=p.source_identity,q=p.citation;
      if(c.kind!=='SOURCE'||!s?.relation_evidence_id||!s.job_id||s.visibility!=='both'||s.introduced_by_slot_id||!q?.page_sha256||!q.text||!q.document_id||!(q.date<value.scope.strictly_before)||q.document_id===value.scope.whole_origin_excluded||q.canonical_page_id!==s.canonical_page_id||q.document_id!==s.document_id||q.date!==s.document_date_iso||p.relation!==s.relation_type||![p.source,p.target].every(id=>id===c.native_source||id===c.native_target)||![s.source_id,s.target_id].every(id=>id===c.native_source||id===c.native_target))throw Error('Displayed edge lacks exact eligible source-relation/type proof.');
    });
  });
  if(!Array.isArray(value.verified_browser_edges)||JSON.stringify(value.verified_browser_edges)!==JSON.stringify(value.connections.flatMap(c=>c.browser_edge_proofs||[])))throw Error('Unbound browser-edge proof inventory.');
  const edges=new Map();value.verified_browser_edges.forEach(p=>edges.set(p.id,[...(edges.get(p.id)||[]),p]));
  return {...value,eligible:new Set(value.eligible_ids),groups:new Set(value.eligible_group_ids),documents:new Set(value.eligible_document_ids),edges};
}

async function guideFetch(extra={},signal) {
  const g=state.guidePath;
  if(extra.phase!=="source")throw Error("Guide overlays do not request replacement study graphs.");
  const response=await fetch("/api/guide-view-v6?"+new URLSearchParams({...g.selection,...extra}),{cache:"no-store",signal});
  if(!response.ok)throw Error("Saved source is unavailable; no replacement was used.");
  const data=await response.json();
  if(data.lens!=="study_case"||data.binding?.graph_id!==g.packet.graph_binding.graph_id||data.binding?.hierarchy_id!==g.packet.graph_binding.hierarchy_id||data.scope?.strictly_before!==g.packet.scope.strictly_before||data.scope?.whole_origin_excluded!==g.packet.scope.whole_origin_excluded)throw Error("Study source binding changed.");
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
  if(state.guideError){host.innerHTML='<h2>Guide unavailable</h2><p role="alert">'+esc(state.guideError)+'</p><a href="'+esc(guideReturnUrl())+'">Return to result</a>';return;}
  if(!g)return;
  host.innerHTML='<header><div><p class="eyebrow">Saved source context</p><h2>KG Navigator</h2></div><button data-guide-close aria-label="Close guide">Close</button></header>'+
    '<p id="guide-level-v64" class="kg-level-v64" aria-label="Current guide KG level"></p>'+
    '<p id="guide-case-bound" class="guide-case-bound" role="note">Case sources: strictly before <time datetime="'+esc(g.packet.scope.strictly_before)+'">'+esc(g.packet.scope.strictly_before)+'</time> (exclusive). Origin excluded.</p>'+
    '<p class="guide-scope">Same full KG. Red spokes: selected context, not a source assessment. Gold/red trace: an exact source-proven connection.</p>'+
    '<label class="guide-step-line"><span id="guide-count"></span><select id="guide-step" aria-label="Saved guide step">'+g.steps.map((s,i)=>'<option value="'+i+'">'+(i+1)+'. '+esc(s.label)+'</option>').join("")+'</select></label>'+
    '<div id="guide-current" class="guide-current" role="status" aria-live="polite"></div><div class="guide-actions"></div>'+
    '<div class="guide-context-actions"><button data-guide-neighborhood>32 connections</button><button data-guide-community>256 community</button></div>'+
    '<details><summary>Sources and binding</summary>'+(g.citations.length?'<label class="guide-source-picker">Original source <select id="guide-source" aria-label="Original study source">'+g.citations.map((c,i)=>'<option value="'+i+'">'+(i+1)+'. '+esc(c.document_id)+'</option>').join('')+'</select></label><button data-guide-source>Open source</button>':'')+
    '<p>Before '+esc(g.packet.scope.strictly_before)+'; origin '+esc(g.packet.scope.whole_origin_excluded)+' excluded. Browser memberships remain unchanged'+(g.overlay?.layout_matches_study?'.':'; the study hierarchy differs.')+'</p><p id="guide-mapping-status"></p></details>'+
    '<a class="guide-return" href="'+esc(guideReturnUrl())+'">Return to this result</a>';
  $('#guide-step').onchange=e=>activateGuideStep(Number(e.target.value));
  $('[data-guide-close]',host).onclick=closeSavedGuide;
  $('[data-guide-neighborhood]',host).onclick=()=>guideContextView("neighborhood");
  $('[data-guide-community]',host).onclick=()=>guideContextView("community");
  $('#guide-source',host)?.addEventListener('change',e=>{pauseGuide();g.sourceIndex=Number(e.target.value);});
  $('[data-guide-source]',host)?.addEventListener('click',async()=>{
    pauseGuide();g.busy=true;renderGuideStatus();
    try{await openStudySource(g.citations[g.sourceIndex]);}catch(e){g.error=e.message;}
    finally{g.busy=false;renderGuideStatus();}
  });
  renderGuideStatus();
}

function renderGuideStatus() {
  const g=state.guidePath;if(!g||!$('#guide-step'))return;
  $('#guide-step').value=String(g.index);$('#guide-step').disabled=g.busy;
  $('#guide-count').textContent=(g.index+1)+' / '+g.steps.length;
  $('#guide-current').textContent=g.busy?'Loading and settling...':g.error||g.message||g.steps[g.index].label;
  $('#guide-current').classList.toggle('guide-warning',Boolean(g.error));
  const actions=$('.guide-actions',guideHost());actions.innerHTML=guideControls()+'<small>3 seconds after loading and animation settle.</small>';bindGuideControls(actions);
  $$('[data-guide-neighborhood],[data-guide-community]').forEach(b=>b.disabled=g.busy||g.lexical||!g.currentRecord||Boolean(nodeLevel[g.currentRecord.type]));
  $('[data-guide-source]')?.toggleAttribute('disabled',g.busy);
  $('#guide-mapping-status').textContent=g.overlay?.endpoint_mappings.filter(m=>m.browser_id===null).map(m=>m.native_id+': '+m.reason).join('\n')||'Exact canonical/source-ID mapping. '+(g.overlay?.verified_browser_edges.length||0)+' source-proven existing edge correspondences. All other edges remain gray and unassessed.';
  const footer=$('#study-guide-drawer footer');if(footer){footer.innerHTML=guideControls();bindGuideControls(footer);}
  guideHost().setAttribute('aria-busy',String(g.busy));
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
  if(m.status==='SAME_PINNED_HIERARCHY')return panel.hierarchyNode(m.level,m.browser_id);
  const detail=await ensureNodeNeighborhood(panel.view,m.browser_id),record=detail.node;
  if(record.id!==m.browser_id||record.type!==m.source_identity.type||['domain_id','theme_id','community_id'].some(k=>(record[k]||null)!==(m.browser_membership[k]||null)))throw Error('Canonical ID or browser membership differs from the verified crosswalk.');
  return record;
}

async function guideCommunity(record) {
  const panel=state.panels.current;
  return guideRunV64(panel,token=>guideMoveRecordV64(panel,record,token));
}

async function guideContextView(kind) {
  const g=state.guidePath;if(!g||g.busy||!g.currentRecord)return;
  pauseGuide();g.busy=true;renderGuideStatus();
  try{
    const panel=state.panels.current;
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
  const g=state.guidePath,panel=state.panels.current,record=await guideRecord(step.node_index);
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
      if(panel.nodeMap.has(sourceId)&&panel.nodeMap.has(record.id))g.movement='horizontal';
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

async function openStudySource(citation,{manual=true}={}) {
  if(manual)pauseGuide();guideCloseSource();const epoch=++guideSourceEpoch;
  const scrim=document.createElement('div');scrim.id='study-guide-scrim';scrim.onclick=()=>{pauseGuide();guideCloseSource();};document.body.append(scrim);
  const drawer=document.createElement('aside');drawer.id='study-guide-drawer';drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-label','Verified eligible study source');
  drawer.innerHTML='<header><h2>Original study source</h2><button data-study-close>Close source</button></header><div class="study-source-content" role="status">Verifying the exact saved page and quotation...</div><footer>'+guideControls()+'</footer>';
  document.body.append(drawer);$('[data-study-close]',drawer).onclick=()=>{pauseGuide();guideCloseSource();};bindGuideControls($('footer',drawer));$('[data-study-close]',drawer).focus({preventScroll:true});
  const pageId=citation.canonical_page_id||citation.page_id;
  try{
    if(!pageId)throw Error('No exact saved source identity.');
    const {page}=await guideFetch({phase:'source',source_id:pageId});
    const ascii=JSON.stringify(page.text).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ascii));
    const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    const chars=Array.from(page.text),start=citation.start,end=citation.end;
    if(page.id!==pageId||page.document_id!==citation.document_id||page.date!==citation.date||hash!==citation.page_sha256||page.document_id===state.guidePath.packet.scope.whole_origin_excluded||!(page.date<state.guidePath.packet.scope.strictly_before)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>chars.length||chars.slice(start,end).join('')!==citation.text)throw Error('Exact saved source proof did not replay. No alternate quote or transcript was substituted.');
    if(epoch!==guideSourceEpoch)return;
    $('.study-source-content',drawer).innerHTML='<p class="study-proof-status">Verified original study page and exact quotation. Source handoff, not a browser-edge transition.</p><p>'+esc(page.document_id)+' / '+esc(page.date)+'</p><pre>'+esc(chars.slice(0,start).join(''))+'<mark>'+esc(citation.text)+'</mark>'+esc(chars.slice(end).join(''))+'</pre>';
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
      g.message='Original source context. The full KG stays in place.';
      await openStudySource(g.citations[g.sourceIndex]||g.citations[0],{manual:false});
    }else if(step.type==='receipt'){
      g.message='Saved lexical search and document receipts, not KG nodes or edges.';
      const hits=g.nodes[0].executed_searches||[];
      g.message+=' '+hits.length+' executed searches; source '+guideNodeLabel(g.nodes[1])+'.';
    }else g.message='Proposed wording: '+(g.packet.candidate.fill||g.packet.candidate.id)+'. Constructed source readout, not a KG node.';
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
    const response=await fetch('/api/guide-v6?'+new URLSearchParams(selection),{cache:'no-store'});
    if(!response.ok)throw Error('Saved guide unavailable. URL route payloads are not used.');
    const g=normalizeSavedGuide(await response.json(),selection);
    const overlayResponse=await fetch('/api/guide-overlay-v64?'+new URLSearchParams(selection),{cache:'no-store'});
    if(!overlayResponse.ok)throw Error('Full-KG source-ID crosswalk unavailable. No study graph was substituted.');
    g.overlay=validateGuideOverlay(await overlayResponse.json(),g);
    state.guidePath=g;state.guideOverlay=g.overlay;
    g.exploration=state.panels.current.rememberLocation();
    enterGuideControls(g);
    renderPanelCaption(state.panels.current);
    document.body.classList.add('guide-active','guide-v63-active','guide-v64-active');
    renderPathGuide();
    const requested=Number(params.get('guide_step')||0);
    await activateGuideStep(Number.isInteger(requested)&&requested>=0&&requested<g.steps.length?requested:0);
  }catch(e){state.guideError=e.message;pauseGuide();renderPathGuide();}
}

document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseGuide();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){pauseGuide();guideCloseSource();}});
document.addEventListener('pointerdown',e=>{if(state.guidePath&&!e.target.closest('#retrieval-path-guide,#study-guide-drawer'))pauseGuide();},true);
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>pauseGuide());


// View-only motion over the original GraphPanel. No node/edge is synthesized.
const GUIDE_MOTION_V64={pulse:180,zoom:220,reveal:360,shrink:260,land:380};
const guideNativeV64={};
const guidePairV64=(edge,a,b)=>a!==b&&((edge.source===a&&edge.target===b)||(edge.source===b&&edge.target===a));

function guideLevelV64(panel=state.panels.current) {
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
    settled_at:g.settledAt,layout_only:true,native_route_changed:false}));
}
window.guideExportV64=guideExportV64;

function guideEdgeVisualV64(panel,edge,selectedId) {
  if(!state.guideOverlay)return null;
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
      const a=panel.screen(panel.nodeMap.get(edge.source)),b=panel.screen(panel.nodeMap.get(edge.target));
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
  await guideTweenV64(panel,token,duration,p=>{panel.transform={x:from.x+(target.x-from.x)*p,y:from.y+(target.y-from.y)*p,scale:from.scale+(target.scale-from.scale)*p};panel.draw();});
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

async function guideTransitionV64(panel,{direction='crossfade',anchor_id=null},change,token) {
  guideAssertV64(token);
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
  if(manual)pauseGuide();
  if(owns){g.busy=true;clearTimeout(g.timer);renderGuideStatus();}
  const token=guideTokenV64(panel);panel.v64Busy=true;panel.canvas.setAttribute('aria-busy','true');guideUpdateLevelV64(panel);
  try{return await work(token);}catch(e){if(e.name!=='AbortError'){if(g&&state.guidePath===g)g.error=e.message;throw e;}}
  finally{
    if(panel.v64Token===token){panel.v64Busy=false;panel.canvas.setAttribute('aria-busy','false');panel.updateChrome();}
    if(owns&&g===state.guidePath&&!token.cancelled){g.busy=false;g.settledAt=performance.now();renderGuideStatus();scheduleGuide();}
  }
}

function guideResetViewV64(panel,level,trail,focusIds=[]) {
  panel.neighborhood=null;panel.localIncidentNeighborhood=null;panel.investigativeContext=null;panel.expandedIncidentScopes.clear();
  panel.showNeighborEdges=false;panel.inducedNeighborEdges=[];panel.inducedLoadRevision++;panel.inducedLoading=false;panel.inducedError='';
  panel.level=level;panel.trail=[...trail];panel.nodeLimit=256;panel.external=null;panel.pinnedFocusIds=new Set(focusIds.filter(Boolean));panel.searchMatchIds.clear();
  panel.refreshGraph(focusIds.at(-1)||null);
}

async function guideParentV64(panel,token) {
  if(panel.neighborhood){
    const focus=panel.neighborhood.node,community=panel.trail.at(-1);
    if(community?.type==='Community')await ensureCommunityDetail(panel.view,community);
    guideAssertV64(token);
    return guideTransitionV64(panel,{direction:'up',anchor_id:focus.id},()=>{
      panel.nodeLimit=256;guideNativeV64.returnFromNeighborhood.call(panel);panel.refreshGraph(focus.id);
    },token);
  }
  const parent=panel.trail.at(-1);if(!parent)return;
  const level=nodeLevel[parent.type];await ensureHierarchyCatalog(panel.view,level);guideAssertV64(token);
  return guideTransitionV64(panel,{direction:'up',anchor_id:parent.id},()=>guideResetViewV64(panel,level,panel.trail.slice(0,-1),[parent.id]),token);
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
  panel.nodeHistory=[];guideUpdateLevelV64(panel);
}

async function guideOpenNeighborhoodV64(panel,record,token,{limit=256,remember=true,ids=[record.id]}={}) {
  const detail=await ensureNodeNeighborhood(panel.view,record.id),route=await panel.hierarchyRoute(detail.node);guideAssertV64(token);
  const saved=remember?panel.rememberLocation():null;
  await guideTransitionV64(panel,{direction:panel.nodeMap.has(record.id)?'down':'crossfade',anchor_id:record.id},()=>{
    if(saved)panel.nodeHistory.push(saved);
    panel.neighborhood=detail;panel.localIncidentNeighborhood=null;panel.level='evidence';panel.trail=route.route;panel.nodeLimit=limit;
    panel.investigativeContext=null;panel.showNeighborEdges=false;panel.inducedNeighborEdges=[];panel.inducedLoadRevision++;
    panel.pinnedFocusIds=new Set(ids);panel.external=null;panel.refreshGraph(record.id);
  },token);
}

function guideSetTraversalV64(panel,sourceId,targetId,connection) {
  const proofs=connection?.browser_edge_proofs||[];
  const ids=connection?.browser_edge_verified?connection.browser_edge_ids.filter(id=>panel.edges.some(e=>e.id===id&&
    guidePairV64(e,sourceId,targetId)&&proofs.some(p=>p.id===id&&String(e.edge_type||'').split(',').map(s=>s.trim()).includes(p.relation)))):[];
  const contextIds=panel.edges.filter(e=>guidePairV64(e,sourceId,targetId)&&!ids.includes(e.id)).map(e=>e.id);
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
    return guideRunV64(this,async token=>{
      this.v64Traversal=null;
      if(this.nodeHistory.length){const saved=this.nodeHistory.pop();await guideTransitionV64(this,{direction:'up',anchor_id:saved.selectedId},()=>this.restoreLocation(saved),token);}
      else await guideParentV64(this,token);
    },{manual:true}).catch(e=>this.inspectionError(e));
  };
  p.focusNeighborhood=function(record,{scroll=true,remember=true}={}){
    return guideRunV64(this,async token=>{this.v64Traversal=null;await guideOpenNeighborhoodV64(this,record,token,{remember});if(scroll)this.canvas.focus({preventScroll:true});},{manual:true});
  };
  p.openLocalCommunity=function(record,{scroll=true,remember=true}={}){
    return guideRunV64(this,async token=>{this.v64Traversal=null;const saved=remember?this.rememberLocation():null;await guideMoveRecordV64(this,record,token);if(saved)this.nodeHistory.push(saved);if(scroll)this.canvas.focus({preventScroll:true});},{manual:true});
  };
  p.returnFromNeighborhood=function(){return guideRunV64(this,async token=>{this.v64Traversal=null;await guideParentV64(this,token);},{manual:true});};
}
guideInstallV64();


function syncVisibilityControl() {
  $$('[data-eligibility-style]').forEach((button)=>{
    const active=button.dataset.eligibilityStyle===state.visibilityMode;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
  const checkbox=$("#show-ineligible");
  if(checkbox)checkbox.checked=state.showIneligible;
}

function setVisibilityMode(mode) {
  if(!visibilityModes.includes(mode)||mode===state.visibilityMode){syncVisibilityControl();return;}
  state.visibilityMode=mode;syncVisibilityControl();
  const url=new URL(window.location.href);url.searchParams.set("ineligible",state.visibilityMode);history.replaceState(null,"",url);
  Object.values(state.panels).forEach((panel)=>panel?.applyVisibilityMode());applySearch();
}

function setIneligiblePresence(show) {
  state.showIneligible=Boolean(show);syncVisibilityControl();
  const url=new URL(window.location.href);url.searchParams.set("show_ineligible",state.showIneligible?"1":"0");history.replaceState(null,"",url);
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
    if(day===null||day<minDay||day>maxDay){
      dateInput.setAttribute("aria-invalid","true");
      if(error){error.textContent=`Enter a valid date from ${minimum} to ${maximum} (YYYY-MM-DD). The graph's date has not changed.`;error.hidden=false;}
      return;
    }
    selectDay(day);
  };
  dateInput.addEventListener("input",clearError);
  dateInput.addEventListener("change",commitDate);
  dateInput.addEventListener("keydown",(event)=>{if(event.key==="Enter"){event.preventDefault();commitDate();}else if(event.key==="Escape"){event.preventDefault();sync();}});
  slider.addEventListener("input",()=>preview(Number(slider.value)));
  slider.addEventListener("change",()=>selectDay(Number(slider.value)));
  minus?.addEventListener("click",()=>selectDay(utcDay(state.asOfPolicy.cutoff)-1));
  plus?.addEventListener("click",()=>selectDay(utcDay(state.asOfPolicy.cutoff)+1));
  $("#as-of-reset")?.addEventListener("click",()=>selectDay(maxDay));
}

async function init() {
  try {
    const bindingResponse=await fetch("/api/graph-v4-viewer?"+new URLSearchParams({corpus:corpusId}),{cache:"no-store"});
    if(!bindingResponse.ok)throw new Error("The frozen full-corpus viewer binding is unavailable");
    refreshBinding=await bindingResponse.json();
    if(refreshBinding.asset_base!==`/graph-assets-v4/${corpusId}/`||!refreshBinding.graph_run_id||!refreshBinding.hierarchy_run_id)throw new Error("Invalid independent viewer binding");
    assetBase=refreshBinding.asset_base;comparisonAsset=assetURL(refreshBinding.comparison_asset);searchAsset=assetURL(refreshBinding.search_asset);
    const response=await fetch(comparisonAsset,{cache:"no-store"}); if (!response.ok) throw new Error(`HTTP ${response.status}`); state.data=await boundJson(response,refreshBinding.comparison_sha256);
    if(state.data.graph_run_id!==refreshBinding.graph_run_id||state.data.hierarchy_run_id!==refreshBinding.hierarchy_run_id)throw new Error("Graph and viewer binding belong to different refresh revisions");
    if(refreshBinding.prepared_source_root&&state.data.prepared_source_root!==refreshBinding.prepared_source_root)throw new Error("Source provenance differs from the frozen viewer binding");
    const expectedSchema=singleCorpusMode?"matryoshka-single-corpus-browser/1.0":"cib-legacy-current-comparison/4.8";
    if (state.data.schema_version!==expectedSchema) throw new Error(`Unexpected schema ${state.data.schema_version}`);
    for(const [key,view] of Object.entries(state.data.views))view.label=singleCorpusMode?(key==="current_redaction"?"Confidential projection":"Confidential + Secret projection"):(view.release_view==="earlier"?"Earlier release":"Later release");
    state.pdfApiAvailable=corpusId==="cib"&&refreshBinding.pdf_available===true;
    document.title="Matryoshka | "+(state.data.corpus_metadata?.name||"Paired corpus graph");
    $("#document-count").textContent=`${fmt(state.data.corpus_metadata?.document_count)} ${singleCorpusMode?"prepared documents":"paired Central Intelligence Bulletins"}`;
    $("#exploration-scope").textContent=refreshBinding.scope_note||"A frozen independent exploration export. Workbench eligibility is narrower and is not inherited here.";
    const differs=refreshBinding.study_hierarchy_id&&refreshBinding.study_hierarchy_id!==refreshBinding.hierarchy_run_id;
    $("#exploration-layout").textContent=`Exploration graph ${refreshBinding.graph_run_id} / hierarchy ${refreshBinding.hierarchy_run_id}. ${differs?`This layout differs from study graph ${refreshBinding.study_graph_id||""} / hierarchy ${refreshBinding.study_hierarchy_id}; it is not the study-flow hierarchy.`:"The declared graph/hierarchy IDs match this corpus's study lineage; full exploration still has a different evidence scope."} No case origin exclusion or case cutoff is inherited. Explicit as-of dates are inclusive and do not refit the hierarchy.`;
    const params=new URLSearchParams(window.location.search); if (["earlier","later"].includes(params.get("release"))) state.release=params.get("release"); if (["single","pair"].includes(params.get("view"))) state.displayMode=params.get("view"); const legacyVisibility=params.get("visibility"); if (["show","dim"].includes(params.get("ineligible"))) state.visibilityMode=params.get("ineligible"); else if (["show","dim"].includes(legacyVisibility)) state.visibilityMode=legacyVisibility; if(params.get("show_ineligible")==="0"||legacyVisibility==="hide")state.showIneligible=false; if (["domain","theme","community","evidence"].includes(params.get("level"))) state.level=params.get("level"); state.guidePath=null;state.autoOpenSearch=params.get("inspect")==="1"&&!params.has("guide_case");state.autoOpenDirect=params.get("connections")==="1"&&!params.has("guide_case");
    $("#purpose").textContent=singleCorpusMode?state.data.comparison_contract.purpose:"Start from the fixed earlier-release hierarchy. Later-only, post-cutoff and undated evidence can remain dimmed, fully colored or hidden without refitting assignments. Pair compares the two release-visibility projections, not source classification labels.";
    if(singleCorpusMode){
      $(".visibility-note").textContent="Eligibility display: the fixed Confidential taxonomy is retained when the permitted SECRET projection is added. Added, post-date or undated context may be dimmed, fully colored or hidden. These are classification projections, not paired redactions; no workbench case cutoff or document exclusion is inherited.";
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
    state.panels.legacy=new GraphPanel("legacy"); state.panels.current=new GraphPanel("current");bindRedactionNavigator();
    $$('[data-release]').forEach((button)=>button.classList.toggle("active",button.dataset.release===state.release)); $$('[data-level]').forEach((button)=>button.classList.toggle("active",button.dataset.level===state.level)); $("#level-explanation").textContent=levelCopy[state.level]; syncVisibilityControl(); await renderRelease();await loadRedactionNavigatorData();
    $$('[data-release]').forEach((button)=>button.addEventListener("click",async()=>{ state.release=button.dataset.release; $$('[data-release]').forEach((item)=>item.classList.toggle("active",item===button)); const url=new URL(window.location.href); url.searchParams.set("release",state.release); history.replaceState(null,"",url); await renderRelease(); }));
    $$('[data-display-mode]').forEach((button)=>{button.classList.toggle("active",button.dataset.displayMode===state.displayMode);button.addEventListener("click",async()=>{state.displayMode=button.dataset.displayMode;$$('[data-display-mode]').forEach((item)=>item.classList.toggle("active",item===button));const url=new URL(window.location.href);url.searchParams.set("view",state.displayMode);history.replaceState(null,"",url);await renderRelease();});});
    $$('[data-eligibility-style]').forEach((button)=>button.addEventListener("click",()=>setVisibilityMode(button.dataset.eligibilityStyle)));
    $("#show-ineligible")?.addEventListener("change",(event)=>setIneligiblePresence(event.target.checked));
    $$('[data-level]').forEach((button)=>button.addEventListener("click",async()=>{ state.level=button.dataset.level; $$('[data-level]').forEach((item)=>item.classList.toggle("active",item===button)); $("#level-explanation").textContent=levelCopy[state.level]; const url=new URL(window.location.href); url.searchParams.set("level",state.level); history.replaceState(null,"",url); await renderRelease(); }));
    $$('[data-fit]').forEach((button)=>button.addEventListener("click",()=>{pauseGuide();state.panels[button.dataset.fit].fit();}));
    $$('[data-back]').forEach((button)=>button.addEventListener("click",()=>state.panels[button.dataset.back].back()));
    $$('[data-node-cap]').forEach((select)=>select.addEventListener("change",()=>state.panels[select.dataset.nodeCap].setNodeCap(select.value)));
    $("#graph-search").addEventListener("input",applySearch); $("#search-scope").addEventListener("change",applySearch); $("#hide-isolates").addEventListener("change",(event)=>{ state.hideIsolates=event.target.checked; applySearch(); });
    const requestedScope=params.get("scope"),requestedQuery=params.get("q")||"";
    if(requestedScope&&[...$("#search-scope").options].some((option)=>option.value===requestedScope))$("#search-scope").value=requestedScope;
    if(params.has("guide_case")||params.has("guide")||params.has("guide_data")||params.has("guide_ref")){
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
      const view=currentViews().current;
      await ensureEvidenceSearchCatalog([view.key]);
      const record=state.searchEvidenceIndexes[view.key]?.get(focusId);
      if(record)await state.panels.current.navigateToNode(record);
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
$("#full-workbench-link").href=returnWorkbench;
const homeURL=new URL(returnWorkbench,location.origin);homeURL.searchParams.set("view","home");homeURL.hash="";
$("#full-home-link").href=$("#full-home-brand").href=homeURL.pathname+homeURL.search;
$("#full-graph-link").href=location.pathname+location.search;
$("#full-corpus").addEventListener("change",event=>{
  const url=new URL(location.href);url.searchParams.set("corpus",event.target.value);
  for(const key of [...url.searchParams.keys()])if(key.startsWith("guide_")||["node","node_id","q","as_of","path_seed_id","path_neighbor_id"].includes(key))url.searchParams.delete(key);
  sessionStorage.setItem("graph-v6-scroll",JSON.stringify([scrollX,scrollY]));
  location.assign(url);
});
// Presentation-only provenance. Append before the existing graph init call.
function guideRouteBadgeV65(packet) {
  const route=packet?.route||{};
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
  if(!node){node=document.createElement('p');node.id='guide-route-provenance-v65';node.className='guide-case-bound';node.setAttribute('role','note');host.querySelector('header').after(node);}
  node.dataset.routeProvenance=badge.kind;
  node.textContent=badge.label;node.title=badge.note;node.setAttribute('aria-label',badge.label+'. '+badge.note);
  host.querySelector('.eyebrow').textContent='Source path context';
}

const guideOriginalRenderV65=renderPathGuide;
renderPathGuide=function(){guideOriginalRenderV65();guideRenderRouteBadgeV65();};

if (!redirectCibRoute) init();

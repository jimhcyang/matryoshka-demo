import {validateAdditionalCollection} from './narrative-collections-v1.js';
import {scenePhases,scenePhase,renderScene} from './narrative-scene-v2.js';
import {savedSourcePolicy,sourceScopeAllows} from './saved-source-policy.js';

const rows = value => Array.isArray(value) ? value : [];
const hash = value => /^[a-f0-9]{64}$/.test(value || "");
const same = (a,b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
function ordered(value) {
  return Array.isArray(value) ? value.map(ordered) : value && typeof value === "object" ?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])) : value;
}
const human = value => String(value ?? "Not recorded").replaceAll("_"," ");
const conciseLabel = value => String(value).trim().split(/\s+/).slice(0,12).join(' ');
export function formatRecordedScore(value) {
  if(!Number.isFinite(value))return "Not recorded";
  if(value===0)return "0";
  const rounded=value.toFixed(2);
  // Never display a saved nonzero as zero after rounding.
  if(Math.abs(value)<0.001||Number(rounded)===0){
    const [mantissa,exponent]=value.toExponential(2).split('e');
    return `${Number(mantissa)}e${exponent}`;
  }
  return String(Number(rounded));
}
function node(tag,text,attrs={}) {
  const result=document.createElement(tag);
  if(text!=null)result.textContent=String(text);
  for(const [key,value] of Object.entries(attrs))result.setAttribute(key,String(value));
  return result;
}
function action(text,callback,attrs={}) {
  const result=node("button",text,{type:"button",...attrs});
  result.addEventListener("click",callback);return result;
}
function paragraph(text,className="note") {return node("p",text,{class:className});}
function uniqueIds(values,label) {
  const ids=values.map(value=>value?.id);
  if(ids.some(id=>typeof id!=="string"||!id.trim())||new Set(ids).size!==ids.length)throw Error(`Ambiguous ${label} identities.`);
  return new Set(ids);
}

export function narrativeTraceURL(input,binding,selection,base=globalThis.location?.href){
  const url=new URL(input,base),origin=new URL(base).origin;
  if(url.origin!==origin||url.pathname!=="/api/narrative-v1/trace"||url.hash||url.username||url.password||
      typeof binding?.resource_id!=="string"||!binding.resource_id.trim()||!hash(binding.registry_sha256)||!hash(binding.index_sha256))
    throw Error("A narrative trace requires the local trace route and exact verified source resource.");
  const fields={case_id:selection.case_id,config:selection.config,reading:selection.reading};
  if(!fields.case_id||!["llm_readings","llm_atoms","llm_local"].includes(fields.config)||typeof fields.reading!=="string")
    throw Error("A narrative trace requires an explicit active case, method and reading.");
  const allowed=new Set([...Object.keys(fields),"resource_id","registry_sha256","index_sha256"]);
  for(const key of url.searchParams.keys())if(!allowed.has(key))throw Error("Unsupported narrative trace selector.");
  for(const [key,value] of Object.entries({...fields,resource_id:binding.resource_id,registry_sha256:binding.registry_sha256,index_sha256:binding.index_sha256})){
    const values=url.searchParams.getAll(key);
    if(values.length>1||values.length===1&&values[0]!==value)throw Error("Narrative trace URL conflicts with the active case, method, reading or resource pins.");
    url.searchParams.set(key,value);
  }
  return url;
}

export function originTranscriptSegments(transcription){
  const segments=rows(transcription?.segments);if(!segments.length)return [];
  if(typeof transcription.text!=="string")throw Error("An original transcript has no text for segment replay.");
  const mapping=transcription.display_segment_mapping;
  if(mapping!=null){
    const chars=Array.from(transcription.text),a=mapping.source_focal_start,b=mapping.source_focal_end,marker=mapping.marker;
    if(mapping.contract!=='source-mask-coordinate-map/1'||mapping.source_coordinates_unchanged!==true||mapping.display_coordinates_are_not_original_source_offsets!==true||
        !hash(mapping.source_text_utf8_sha256)||!hash(mapping.display_text_utf8_sha256)||!Number.isInteger(mapping.source_length)||mapping.source_length<1||
        !Number.isInteger(a)||!Number.isInteger(b)||a<0||b<=a||b>mapping.source_length||typeof marker!=='string'||!marker||
        mapping.display_length!==chars.length||mapping.display_focal_start!==a||mapping.display_focal_end!==a+Array.from(marker).length||
        chars.slice(mapping.display_focal_start,mapping.display_focal_end).join('')!==marker||
        !Array.isArray(mapping.segments)||mapping.segments.length!==segments.length||!Array.isArray(mapping.separator_spans))
      throw Error('The masked original has an invalid named source/display coordinate mapping.');
    const delta=Array.from(marker).length-(b-a);
    if(mapping.display_length!==mapping.source_length+delta||segments.filter(s=>s.raw_start<=a&&b<=s.raw_end).length!==1)
      throw Error('The focal display mapping crosses source segments or changes an unrelated extent.');
    const projected=mapping.segments.map((item,index)=>{
      const source=segments[index],start=source.raw_start+(source.raw_start>=b?delta:0),end=source.raw_end+(source.raw_end>=b?delta:0);
      if(item.source_segment_index!==index||item.source_raw_start!==source.raw_start||item.source_raw_end!==source.raw_end||
          item.source_text_sha256!==source.text_sha256||item.display_start!==start||item.display_end!==end||!hash(item.display_text_sha256))
        throw Error('A masked display segment is not bound to its unchanged original source segment.');
      const {raw_start,raw_end,start:oldStart,end:oldEnd,text_sha256,...metadata}=source;
      return {...metadata,start,end,text_sha256:item.display_text_sha256,text_hash_encoding:'utf8',coordinate_space:'MASKED_DISPLAY_NOT_RAW_SOURCE',
        original_source_segment:{raw_start,raw_end,text_sha256}};
    });
    return originTranscriptSegments({text:transcription.text,segments:projected,
      segment_separator_contract:transcription.segment_separator_contract,separator_spans:mapping.separator_spans});
  }
  const chars=Array.from(transcription.text),length=chars.length;let previous=0;
  const separatorRows=rows(transcription.separator_spans),separatorContract=transcription.segment_separator_contract;
  if(separatorContract!=null&&separatorContract!=='source-page-join-separators/1'||separatorRows.length&&separatorContract!=='source-page-join-separators/1')
    throw Error("An original transcript has an unsupported separator contract.");
  const separators=new Map(),used=new Set();
  for(const gap of separatorRows){
    const start=gap.raw_start,end=gap.raw_end,key=start+':'+end;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end-start!==2||end>length||gap.text!=='\n\n'||chars.slice(start,end).join('')!==gap.text||separators.has(key))
      throw Error("An original transcript separator does not reproduce an exact declared page join.");
    separators.set(key,gap);
  }
  const result=segments.map(segment=>{
    const display=segment.start!=null||segment.end!=null,raw=segment.raw_start!=null||segment.raw_end!=null;
    if(display&&(!Number.isInteger(segment.start)||!Number.isInteger(segment.end))||
        raw&&(!Number.isInteger(segment.raw_start)||!Number.isInteger(segment.raw_end))||
        display&&raw&&(segment.start!==segment.raw_start||segment.end!==segment.raw_end))
      throw Error("Original transcript segment coordinate declarations conflict.");
    const start=display?segment.start:segment.raw_start,end=display?segment.end:segment.raw_end;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<previous||end<=start||end>length)
      throw Error("Original transcript segments do not reproduce a contiguous raw document.");
    if(start!==previous){const key=previous+':'+start;if(!separators.has(key)||used.has(key))throw Error("Original transcript segments do not reproduce a contiguous raw document.");used.add(key);}
    previous=end;return {...segment,start,end};
  });
  if(previous!==length||used.size!==separators.size)throw Error("Original transcript segment inventory omits text or has unused separators.");
  return result;
}

export function validateManifest(manifest,health,report,reportHash) {
  const ref=manifest?.report_ref;
  const safe=typeof ref?.path==="string"&&!ref.path.startsWith("/")&&!/[\\?#\u0000-\u001f]/.test(ref.path)&&
    ref.path.split("/").every(part=>part&&part!=="."&&part!=="..");
  if(manifest?.version!=="narrative-workbench-publication/1"||report?.version!=="narrative-workbench-publication/1"||health?.service!=="narrative-resource-workbench"||
      health.live_inference!==false||!safe||!hash(ref.sha256)||!same(ref,health.report_ref)||ref.sha256!==reportHash||
      !Array.isArray(report.cases)||health.cases!==report.cases.length)throw Error("The narrative manifest, report and server byte pins do not agree. No old casebook is substituted.");
  uniqueIds(report.cases.map(row=>({id:row.case?.case_id})),"case");
  for(const row of report.cases)if(!["mosaic","hypothesis","redaction"].includes(row.case.task)||
      row.current_resource_execution!==true||!row.resource_binding||row.selected_demo===true&&row.selected_bench===true)
    throw Error("The narrative catalogue has invalid public task, resource or collection metadata.");
  for(const [group,flag] of [["starters","selected_demo"],["bench","selected_bench"]]){
    if(!Array.isArray(manifest[group])||!same([...manifest[group]].sort(),report.cases.filter(row=>row[flag]===true).map(row=>row.case.case_id).sort()))
      throw Error("The narrative manifest and report select different questions.");
  }
  validateAdditionalCollection(manifest,report);
  return manifest;
}

export function decisionTerms(){
  const detail=node('details',null,{class:'narrative-decision-terms','data-testid':'decision-terms'});
  detail.append(node('summary','What the evidence states mean'));
  const definitions=node('dl');
  for(const [term,meaning] of [
    ['SUPPORT','Complete support for the stated requirement within the inspected source pool and recorded scope.'],
    ['OPPOSE','Bound counterevidence for that requirement. Missing support alone is not opposition.'],
    ['PARTIAL','Some required content is grounded; the complete requirement is not established. Partial grounding is not fractional proof.'],
    ['UNRESOLVED','The inspected evidence does not resolve the requirement under the recorded checks. This is not a negative historical finding.'],
    ['CONFLICT','Support and opposition can coexist. Both signs are retained over the same required units.'],
    ['CONTEXT','Relevant source material or a feasible fill without certified focal support. Rank does not turn context into an answer.'],
    ['UNASSESSED','The substantive check was not performed within the declared budget. This is not a rejection.'],
    ['UNMODELED','The required relation or qualification is outside the available representation or rule. This is not opposition.']
  ])definitions.append(node('dt',term),node('dd',meaning));
  detail.append(definitions,paragraph('States describe saved local judgments. Grammatical feasibility, focal support, wider-event support and exact recovery are separate checks. A model summary cannot change them.'));
  return detail;
}

export function validateTrace(envelope,expected) {
  const trace=envelope?.trace||envelope;
  if(!same(savedSourcePolicy(trace.source_view_policy),savedSourcePolicy(expected.source_view_policy)))
    throw Error('The trace uses another native evidence policy.');
  const binding={...envelope,...trace};
  if(!["narrative-selected-evidence-trace/1","narrative-selected-evidence-trace/2","narrative-selected-evidence-trace/3","narrative-selected-evidence-trace/4","narrative-selected-evidence-trace/5","narrative-selected-evidence-trace/6"].includes(trace?.version)||binding.case_id!==expected.case_id||
      binding.config!==expected.config||binding.reading_id!==expected.reading_id||!hash(binding.query_sha256)||
      binding.query_sha256!==expected.query_sha256||!same(binding.native_checkpoint,expected.native_checkpoint)||
      !hash(binding.native_checkpoint?.sha256)||!same(binding.resource_binding,expected.resource_binding))
    throw Error("The saved trace does not match this exact question, method, reading, execution and source resource.");
  if(!Array.isArray(trace.steps)||!Array.isArray(trace.paths)||trace.steps.length>10000||trace.paths.length>1000||
      trace.ppr_used!==false||trace.native_decisions_or_ranks_modified!==false)throw Error("The saved narrative trace has invalid scope or display bounds.");
  const stepIds=uniqueIds(trace.steps,"step");uniqueIds(trace.paths,"path");
  const evidenceIds=uniqueIds(rows(trace.evidence_inventory),"evidence");
  const prefixIds=new Set();
  for(const step of trace.steps){
    if(!Array.isArray(step.nodes)||!Array.isArray(step.edges)||!Array.isArray(step.source_refs)||
        !Array.isArray(step.accepted_evidence_ids)||!Array.isArray(step.candidate_updates))throw Error("A saved trace step is incomplete.");
    const ids=uniqueIds(step.nodes,"step node");
    for(const id of ids)prefixIds.add(id);
    if(step.nodes.length>1000||step.edges.length>5000)throw Error("A trace step exceeds the display bound.");
    for(const edge of step.edges)if(!ids.has(edge.source)||!ids.has(edge.target)||!(edge.kind||edge.relation))
      throw Error("A trace edge lacks saved endpoints or a connection kind.");
    if(step.display_edges!=null&&!Array.isArray(step.display_edges))throw Error("Invalid display-link inventory.");
    for(const edge of rows(step.display_edges))if(!prefixIds.has(edge.source)||!prefixIds.has(edge.target)||
        edge.kind!=="QUERY_SOURCE_LOOKUP"||edge.version!=="narrative-query-source-display-links/1"||
        edge.is_graph_edge!==false||edge.historical_relation_certified!==false)
      throw Error("An unbound display lookup cannot become a graph connection.");
    if(step.accepted_evidence_ids.some(id=>!evidenceIds.has(id)))throw Error("A step names an unknown accepted evidence unit.");
    if(step.candidate_updates.some(update=>update.reading_id!=null&&update.reading_id!==expected.reading_id))
      throw Error("A candidate snapshot belongs to another reading.");
  }
  for(const path of trace.paths)if(typeof path.candidate_or_atom_id!=="string"||!Array.isArray(path.steps)||
      path.steps.some(id=>!stepIds.has(id))||!Array.isArray(path.source_refs)||!path.endpoint_kind)
    throw Error("A selected evidence path is not bound to saved steps and its actual endpoint.");
  if(["narrative-selected-evidence-trace/3","narrative-selected-evidence-trace/4","narrative-selected-evidence-trace/5","narrative-selected-evidence-trace/6"].includes(trace.version)){
    const maximum=trace.selection?.max_hops,byId=new Map(trace.steps.map(step=>[step.id,step]));
    if(!Number.isInteger(maximum)||maximum<0||maximum>6||typeof trace.postrun_graph_enabled!=="boolean"||
        trace.community_membership_is_evidence!==false||trace.new_evidence_fetched!==false)
      throw Error("The selected-source trace has invalid navigation authority.");
    for(const path of trace.paths){
      const mode=path.route_mode,hops=path.graph_hops,original=mode==="RECORDED_SOURCE_ROUTE";
      if(!["DIRECT_SOURCE_HANDOFF","POSTRUN_GRAPH_VIEW","RECORDED_SOURCE_ROUTE","RECORDED_RELATION_NOMINATION"].includes(mode)||
          !Number.isInteger(hops)||hops<0||hops>maximum||path.original_traversal_claimed!==original||
          (hops===0)!==(mode==="DIRECT_SOURCE_HANDOFF")||mode==="POSTRUN_GRAPH_VIEW"&&(!trace.postrun_graph_enabled||hops>3)||
          !path.steps.length||new Set(path.steps).size!==path.steps.length)
        throw Error("A selected-source path changes its saved traversal provenance.");
      let counted=0;
      for(const id of path.steps){
        const step=byId.get(id),navigation=step.kind==="SOURCE_GRAPH_NAVIGATION";
        if(Boolean(step.edges.length)!==navigation||step.route_mode!=null&&step.route_mode!==mode||
            step.original_traversal_claimed!=null&&step.original_traversal_claimed!==original||
            navigation&&(step.route_mode!==mode||step.original_traversal_claimed!==original||step.factual_support_implied!==false))
          throw Error("A saved navigation step changes its source or history scope.");
        counted+=step.edges.length;
      }
      if(counted!==hops)throw Error("The saved route and navigation-edge counts disagree.");
    }
  }
  if(expected.task&&trace.task!==expected.task||expected.allowed_endpoint_ids&&trace.paths.some(path=>!expected.allowed_endpoint_ids.includes(path.candidate_or_atom_id)))
    throw Error("The trace includes a target outside this task or active reading.");
  const lookup=trace.sources||trace.source_refs_by_id||{};
  const refs=[...trace.steps.flatMap(s=>s.source_refs),...trace.steps.flatMap(s=>rows(s.display_edges).flatMap(e=>rows(e.source_refs))),...trace.paths.flatMap(p=>p.source_refs),...trace.paths.flatMap(p=>rows(p.decision_source_refs)),...trace.paths.flatMap(p=>p.source_endpoint?[p.source_endpoint.citation,...["native_quote","source_edge_citation","selected_final_citation"].filter(k=>p.source_endpoint.source_label_proof?.[k]).map(k=>p.source_endpoint.source_label_proof[k])]:[]),...rows(trace.evidence_inventory).flatMap(e=>rows(e.source_refs)),...rows(trace.digest?.citations)];
  for(const value of refs){const proof=typeof value==="string"?lookup[value]:value;
    if(!proof?.canonical_page_id||!proof.document_id||!proof.date||!hash(proof.page_sha256)||!Number.isInteger(proof.start)||!Number.isInteger(proof.end)||
        proof.start<0||proof.end<=proof.start||typeof proof.text!=="string"||Array.from(proof.text).length!==proof.end-proof.start)
      throw Error("A trace source reference has no exact quotation bounds. No whole-page fallback is invented.");
    if((expected.strictly_before||expected.on_or_before)&&!sourceScopeAllows(proof,expected))
      throw Error("A trace quotation is outside the bound date or source-document boundary.");
  }
  return trace;
}

function sourceRefs(trace,values) {
  const lookup=trace.sources||trace.source_refs_by_id||{};
  return rows(values).map(value=>typeof value==="string"?lookup[value]:value).filter(value=>value&&typeof value==="object");
}
function sourceControl(proof,onSource) {
  return action("Inspect source / "+(proof.document_id||proof.canonical_page_id||"saved citation"),()=>onSource?.(proof),{"data-testid":"trace-source"});
}
const edgeKey = edge => edge.id?"id:"+edge.id:JSON.stringify([edge.source,edge.target,edge.kind||edge.relation,edge.source_row_id,edge.citation,edge.citations,edge.source_refs]);
export function prefixGraph(steps,index){
  const nodes=new Map(),edges=new Map();
  for(const step of steps.slice(0,index+1)){
    for(const item of step.nodes)nodes.set(item.id,{...nodes.get(item.id),...item});
    for(const edge of [...step.edges,...rows(step.display_edges)])edges.set(edgeKey(edge),edge);
  }
  return {nodes:[...nodes.values()],edges:[...edges.values()]};
}
function savedGraph(step,onNode,onEdge,currentNodeIds=new Set(),currentEdgeIds=new Set()) {
  const host=node("div",null,{class:"narrative-step-tree","data-testid":"trace-tree"});
  if(!step.nodes.length){host.append(paragraph("No graph hop was saved for this step. Its source readout is shown separately."));return host;}
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
  svg.setAttribute("role","group");svg.setAttribute("aria-label","Current step's saved connections");
  const defs=document.createElementNS(ns,"defs");
  for(const [id,color] of [["trace-source-arrow","#245e60"],["trace-lookup-arrow","#7c8385"]]){
    const marker=document.createElementNS(ns,"marker"),arrow=document.createElementNS(ns,"path");
    for(const [key,value] of Object.entries({id,viewBox:"0 0 10 10",refX:"10",refY:"5",markerWidth:"7",markerHeight:"7",orient:"auto-start-reverse"}))marker.setAttribute(key,value);
    arrow.setAttribute("d","M 0 0 L 10 5 L 0 10 z");arrow.setAttribute("fill",color);marker.append(arrow);defs.append(marker);
  }
  svg.append(defs);
  const levels=new Map(step.nodes.map(n=>[n.id,0]));
  // Bounded relaxation keeps malformed/cyclic display graphs finite; no edges are invented.
  for(let pass=0;pass<Math.min(step.nodes.length,8);pass++)for(const edge of step.edges)
    levels.set(edge.target,Math.min(8,Math.max(levels.get(edge.target),levels.get(edge.source)+1)));
  const columns=new Map();
  for(const n of step.nodes){const level=levels.get(n.id);if(!columns.has(level))columns.set(level,[]);columns.get(level).push(n);}
  const orderedLevels=[...columns.keys()].sort((a,b)=>a-b),positions=new Map();
  for(const [col,level] of orderedLevels.entries())columns.get(level).forEach((n,row)=>positions.set(n.id,{x:25+col*235,y:25+row*95}));
  const width=Math.max(290,orderedLevels.length*235),height=Math.max(115,...[...columns.values()].map(c=>c.length*95+10));
  svg.setAttribute("viewBox",`0 0 ${width} ${height}`);svg.style.minWidth=`${Math.min(width,750)}px`;svg.style.maxWidth=`${width}px`;
  for(const edge of step.edges){
    const a=positions.get(edge.source),b=positions.get(edge.target),line=document.createElementNS(ns,"path");
    line.setAttribute("d",`M ${a.x+160} ${a.y+25} L ${b.x} ${b.y+25}`);line.setAttribute("class","narrative-tree-edge"+(edge.is_graph_edge===false?" is-display-lookup":"")+(currentEdgeIds.has(edgeKey(edge))?" is-current":" is-prior"));
    line.setAttribute("marker-end",edge.is_graph_edge===false?"url(#trace-lookup-arrow)":"url(#trace-source-arrow)");
    const title=document.createElementNS(ns,"title");title.textContent=human(edge.kind||edge.relation);line.append(title);svg.append(line);
    line.addEventListener("click",()=>onEdge?.(edge));
  }
  for(const n of step.nodes){
    const p=positions.get(n.id),foreign=document.createElementNS(ns,"foreignObject");
    foreign.setAttribute("x",p.x);foreign.setAttribute("y",p.y);foreign.setAttribute("width","180");foreign.setAttribute("height","76");
    const label=n.label||n.name||"Saved graph state";
    const item=action(null,()=>onNode?.(n),{class:"narrative-tree-node"+(currentNodeIds.has(n.id)?" is-current":" is-prior"),title:label,'aria-label':'Open full saved text: '+conciseLabel(label)});
    item.append(node('span',conciseLabel(label),{class:'narrative-node-label'}));
    foreign.append(item);svg.append(foreign);
  }
  host.append(svg);
  host.append(paragraph("Solid: saved source-graph connection. Dashed gray: query-to-source lookup display link, not a KG edge. Source readouts and membership are not assertion proof."));
  for(const edge of step.edges)host.append(action(human(edge.kind||edge.relation)+" / inspect connection",()=>onEdge?.(edge),{class:"narrative-edge-inspector"}));
  return host;
}

export function mountTrace(host,{trace,onSource,onNode,onEdge,onDismiss,preserveViewport=fn=>fn(),onStep=()=>{}}) {
  let index=0,timer=null,destroyed=false,selection=null;
  const root=node("section",null,{class:"narrative-player","data-testid":"narrative-player",'data-empty':String(!trace.steps.length)});
  const controls=node("div",null,{class:"narrative-player-controls"}),position=node("output",null,{"aria-live":"polite"});
  const previous=action("Previous",()=>move(index-1),{"data-testid":"trace-previous"});
  const next=action("Next",()=>move(index+1),{"data-testid":"trace-next"});
  const play=action("Play",()=>{if(timer)stop();else{if(index===trace.steps.length-1)move(0);timer=setInterval(()=>{if(index>=trace.steps.length-1)stop();else move(index+1);},1800);play.textContent="Pause";play.setAttribute("aria-pressed","true");}},{"aria-pressed":"false",'data-testid':'trace-play'});
  const slider=node("input",null,{type:"range",min:"0",max:String(Math.max(0,trace.steps.length-1)),step:"1",value:"0","aria-label":"Saved execution step","data-testid":"trace-slider"});
  slider.addEventListener("input",()=>move(Number(slider.value)));
  const exact=node('select',null,{'aria-label':'Exact saved step','data-testid':'trace-step-select'});
  for(const [i,step] of trace.steps.entries())exact.append(node('option',`${i+1}. ${conciseLabel(step.label||human(step.kind))}`,{value:i}));
  exact.addEventListener('change',()=>move(Number(exact.value)));
  controls.append(previous,play,next,position,exact,slider);
  const progress=node("div",null,{class:"narrative-progress","aria-label":"Earlier saved steps"}),current=node("div",null,{"data-testid":"trace-current"}),accumulated=node("section",null,{class:"narrative-accumulated","data-testid":"trace-accumulated"}),snapshot=node("section",null,{"data-testid":"trace-candidate-snapshot"});
  const layout=node("div",null,{class:"narrative-player-layout"}),aside=node("aside",null,{"aria-label":"Accumulated evidence and candidate snapshot"});aside.append(accumulated,snapshot,decisionTerms());layout.append(current,aside);
  const scope=node('details',null,{class:'scene-scope'});scope.append(node('summary','Saved evidence scenes / scope'),paragraph("Saved final-evidence walkthrough, not a PPR replay or a replay of every search branch. Step numbers are presentation steps, not original diffusion iterations. Source links locate evidence; they do not certify an assertion."));
  root.append(scope,progress,controls,layout);
  host.replaceChildren(root);
  function stop(){clearInterval(timer);timer=null;play.textContent="Play";play.setAttribute("aria-pressed","false");}
  function move(value){if(destroyed)return;preserveViewport(()=>{index=Math.max(0,Math.min(trace.steps.length-1,value));selection=null;onDismiss?.();render();});}
  function inspect(kind,value){
    const key=kind+':'+(kind==='node'?value.id:edgeKey(value));
    if(selection===key){selection=null;onDismiss?.();}else{selection=key;(kind==='node'?onNode:onEdge)?.(value);}
    for(const item of root.querySelectorAll('[data-scene-key]'))item.setAttribute('aria-pressed',String(item.dataset.sceneKey===selection));
  }
  function render(){
    previous.disabled=index<=0;next.disabled=index>=trace.steps.length-1;slider.value=String(index);
    exact.value=String(index);exact.disabled=!trace.steps.length;
    position.textContent=trace.steps.length?`Step ${index+1} of ${trace.steps.length}`:"No saved steps";
    play.disabled=slider.disabled=!trace.steps.length;
    current.querySelector('[data-testid=discovery-scene]')?.destroyScene?.();
    progress.replaceChildren();current.replaceChildren();accumulated.replaceChildren();snapshot.replaceChildren();
    if(!trace.steps.length){current.append(paragraph("No selected execution steps were published. The saved verdict remains available."));return;}
    for(const [key,label] of scenePhases){
      const indices=trace.steps.flatMap((s,i)=>scenePhase(s)===key?[i]:[]),target=indices.find(i=>i>=index)??indices.at(-1);
      const item=action(label,()=>move(target),{class:'narrative-progress-step','data-phase':key,'aria-current':scenePhase(trace.steps[index])===key?'step':'false',title:indices.length?`${indices.length} saved steps in this phase`:'No step of this kind was saved'});
      item.disabled=!indices.length;progress.append(item);
    }
    const step=trace.steps[index];
    current.append(node('p',human(step.kind),{class:'eyebrow'}),node("h3",conciseLabel(step.label||human(step.kind))),
      renderScene(prefixGraph(trace.steps,index),step,{onNode:value=>inspect('node',value),onEdge:value=>inspect('edge',value),preserveViewport,selection,getSelection:()=>selection}));
    const proofs=sourceRefs(trace,step.source_refs);
    if(proofs.length){
      const excerpt=node('section',null,{class:'scene-source-preview','data-testid':'scene-source-excerpt'});
      excerpt.append(node('small','Saved source quotation'),node('blockquote',proofs[0].text));
      for(const proof of proofs)excerpt.append(sourceControl(proof,onSource));current.append(excerpt);
    }
    if(step.route_mode){const detail=node('details',null,{class:'scene-scope'});detail.append(node('summary','Route scope'),paragraph(routeExplanation(step.route_mode)));current.append(detail);}
    const accepted=new Set(trace.steps.slice(0,index+1).flatMap(s=>s.accepted_evidence_ids));
    accumulated.append(node("h3",`Accumulated accepted evidence / ${accepted.size} saved units`),paragraph("Repeated path appearances count once here; these are recorded evidence units, not independent corroboration or transported mass."));
    for(const id of accepted){
      const evidence=rows(trace.evidence_inventory).find(e=>e.id===id),row=node("div",null,{class:"narrative-evidence-unit"});
      row.append(paragraph(evidence?human(evidence.direction)+" / saved evidence unit":"Saved accepted evidence unit"));
      for(const proof of sourceRefs(trace,evidence?.source_refs))row.append(sourceControl(proof,onSource));accumulated.append(row);
    }
    snapshot.append(node("h3","Candidate state at this step"),paragraph("The saved update is a full snapshot, not a delta. Missing evidence is not opposition."));
    if(!step.candidate_updates.length)snapshot.append(paragraph("No candidate-state snapshot was published for this step."));
    for(const update of step.candidate_updates){
      const row=node("div",null,{class:"narrative-candidate-update"});
      const card=rows(trace.scorecards?.candidates).find(c=>c.id===update.candidate_id)||rows(trace.scorecards?.components?.rows).find(c=>c.id===update.atom_id);
      row.append(node("strong",update.fill||update.label||card?.fill||card?.text||"Saved target"),paragraph(human(update.status||update.native_status)+(update.direction?" / "+human(update.direction):"")));
      if(update.reason)row.append(paragraph(update.reason));snapshot.append(row);
    }
    onStep(step,index);
  }
  render();return {destroy(){destroyed=true;stop();current.querySelector('[data-testid=discovery-scene]')?.destroyScene?.();},clearSelection(){selection=null;for(const n of root.querySelectorAll('[data-scene-key]'))n.setAttribute('aria-pressed','false');},selectStep(id){const i=trace.steps.findIndex(step=>step.id===id);if(i>=0)move(i);}};
}

function routeExplanation(mode) {
  return ({RECORDED_SOURCE_ROUTE:"Saved source route. Its connections do not by themselves establish the completed claim.",POSTRUN_GRAPH_VIEW:"Post-run graph navigation for inspecting selected evidence; not the original traversal.",DIRECT_SOURCE_HANDOFF:"Direct source readout. No intermediate graph hop is claimed."})[mode]||human(mode)+" / selected evidence navigation, not an entailment certificate.";
}
export function mountEvidencePaths(host,{trace,selectedId,onSelect,onSource,onGuide,onStep,endpointForPath,independentMapURL,corpus,preserveViewport=fn=>fn()}) {
  let selected=selectedId;
  let revision=0,destroyed=false;
  const candidateId=id=>trace.reading_id&&id.startsWith(trace.reading_id+"/")?id.slice(trace.reading_id.length+1):id;
  function render(){
    const active=++revision;
    host.replaceChildren();
    const targets=[...new Set(trace.paths.map(p=>p.candidate_or_atom_id))];
    if(!targets.includes(selected))selected=targets.find(id=>candidateId(id)===selected)||targets[0]||"";
    if(!targets.length){host.append(paragraph("No final-evidence path was saved. Nearby graph states are not substituted."));return;}
    const control=node("label","Selected final-evidence endpoint "),select=node("select",null,{"aria-label":"Selected final-evidence endpoint","data-testid":"trace-path-target"});
    for(const [i,id] of targets.entries()){const score=rows(trace.scorecards?.candidates).find(c=>c.id===candidateId(id)&&c.reading_id===trace.reading_id)||rows(trace.scorecards?.components?.rows).find(c=>c.id===id);select.append(node("option",score?.fill||score?.text||`Saved target ${i+1}`,{value:id}));}
    select.value=selected;select.addEventListener("change",()=>preserveViewport(()=>{selected=select.value;onSelect?.(candidateId(selected));render();}));control.append(select);host.append(control);
    const paths=trace.paths.filter(p=>p.candidate_or_atom_id===selected);
    for(const [i,path] of paths.entries()){
      const card=node("section",null,{class:"path-card path-chart","data-testid":"narrative-evidence-path"});
      card.append(node("h3",`${i+1}. ${human(path.endpoint_kind)}`));
      const scope=node('details',null,{class:'scene-scope'});scope.append(node('summary',human(path.direction||path.endpoint_kind)+' / route scope'),paragraph(routeExplanation(path.route_mode)),paragraph("Identity, membership and context are not upgraded to factual support."));card.append(scope);
      const chain=node("ol",null,{class:"path-chain source-chain",'aria-label':'Selected saved source chain'});
      for(const [j,id] of path.steps.entries()){
        const step=trace.steps.find(s=>s.id===id),label=step.label||human(step.kind),item=node('li',null,{'data-phase':scenePhase(step)});
        const control=action(null,()=>onStep?.(id),{title:label,'data-testid':'source-chain-step'});
        control.append(node('small',`${j+1} / ${human(step.kind)}`),node('span',conciseLabel(label)));item.append(control);chain.append(item);
      }
      const witness=sourceRefs(trace,path.decision_source_refs||path.source_refs)[0],preview=node('div',null,{class:'source-chain-preview'});
      preview.append(chain);
      if(witness){const quote=node('blockquote',witness.text,{class:'selected-source-excerpt','data-testid':'selected-source-excerpt'});preview.append(quote);}
      card.append(preview);
      const walkParams=new URLSearchParams({corpus:corpus||trace.corpus||trace.case?.corpus||new URLSearchParams(location.search).get('corpus')||'',walk_case:trace.case_id,walk_config:trace.config,walk_reading:trace.reading_id||'',walk_path:path.id});
      for(const key of ['resource_id','registry_sha256','index_sha256'])if(trace.resource_binding?.[key])walkParams.set(key,trace.resource_binding[key]);
      card.append(node('a','Show path walkthrough in KG',{href:'graph-full-v6.html?'+walkParams+'#saved-kg-walk','data-testid':'kg-walk-link',class:'button'}));
      for(const proof of sourceRefs(trace,path.decision_source_refs||path.source_refs))card.append(sourceControl(proof,onSource));
      if(path.route_mode!=="DIRECT_SOURCE_HANDOFF"&&path.graph_hops!==0)
        card.append(action("Guide Path in Corpus Map",()=>onGuide?.({path,route_index:path.guide_route_index??path.route_index??i}),{"data-testid":"narrative-guide-path"}));
      else card.append(paragraph("Direct source inspection above; no graph guide or intermediate hop is claimed."));
      if(path.source_endpoint!=null||path.graph_hops===0||path.route_mode==='DIRECT_SOURCE_HANDOFF'){
        const endpoint=node('section',null,{class:'narrative-endpoint','data-testid':'saved-endpoint'});
        endpoint.append(paragraph('Checking for a source-owned saved extracted endpoint...'));card.append(endpoint);
        const fallback=()=>{
          endpoint.replaceChildren(paragraph('No verified saved extracted endpoint is available for this passage. Direct source inspection remains available.'));
          if(independentMapURL)endpoint.append(node('a','Open independent corpus map',{href:independentMapURL,target:'_blank',rel:'noopener'}));
          endpoint.dataset.status='unavailable';
        };
        Promise.resolve().then(()=>endpointForPath?.(path)).then(value=>{
          if(destroyed||active!==revision||!endpoint.isConnected)return;
          if(!value){fallback();return;}
          endpoint.replaceChildren(node('h4','Saved extracted endpoint'),node('strong',value.label),
            paragraph('Query \u2192 selected source \u2192 saved extracted endpoint. Provenance handoff only, not KG edges, resolved world identity, or factual support.'),
            node('blockquote',value.quote.text),sourceControl(value.quote,proof=>onSource?.(proof,{endpoint:value})),
            node('a',value.href_label||'Open saved endpoint in corpus map',{href:value.href,target:'_blank',rel:'noopener','data-testid':'saved-endpoint-map'}));
          if(value.source_endpoint_inspection_only)endpoint.append(paragraph('Zero-hop source-endpoint inspection, not a retrieval route. The exact case-source graph is a separate lens; the standalone overview is unchanged.'));
          if(value.source_label_proof){
            const details=node('details',null,{'data-testid':'source-label-proof'});
            details.append(node('summary','Name-highlight provenance'),
              paragraph('This name highlight is a unique literal case/whitespace match inside the saved extraction quote. Native offsets delimit that quote, not a name span. This is not an identity or support certificate.'),
              node('blockquote',value.source_label_proof.native_quote.text),sourceControl(value.source_label_proof.native_quote,onSource));
            endpoint.append(details);
          }
          if(value.community_id)endpoint.append(paragraph('Recorded community membership is navigation, not evidence.'));
          endpoint.dataset.status='verified';endpoint.dataset.nodeId=value.node_id;endpoint.dataset.communityId=value.community_id||'';
        }).catch(()=>{if(!destroyed&&active===revision&&endpoint.isConnected)fallback();});
      }
      host.append(card);
    }
  }
  render();return {selectCandidate(id){selected=id;render();},destroy(){destroyed=true;revision++;host.replaceChildren();}};
}

export function renderScorecards(host,scorecards,{readingId="",onSource}={}) {
  host.replaceChildren();host.append(node("h3","Saved scores and evidence counts"),paragraph("Retrieval relevance, candidate order and source sufficiency are separate. None is a correctness probability."));
  if(!scorecards){host.append(paragraph("No score rubric was published; missing scores are not zero."));return;}
  const documents=node("details"),documentRows=rows(scorecards.documents);documents.append(node("summary",`Document relevance / ${documentRows.length} saved documents`));
  const candidates=rows(scorecards.candidates).filter(c=>c.reading_id===readingId);
  const coverageRecorded=c=>Number.isInteger(c.required_field_count)&&c.required_field_count>0&&
    Number.isInteger(c.established_fields)&&c.established_fields>=0&&c.established_fields<=c.required_field_count;
  if(documentRows.some(d=>!Number.isFinite(d.bm25_max)||!Number.isFinite(d.native_rrf_max))||
      candidates.some(c=>!Number.isFinite(c.native_score)||!coverageRecorded(c))){
    const missing=paragraph('Some numerical scores or comparable coverage values were not recorded; omitted values are not zero. Ranks and recorded local checks are not correctness probabilities.','notice');
    missing.dataset.testid='missing-numeric-scores';host.append(missing);
  }
  const maxima=Object.fromEntries(["bm25_max","native_rrf_max"].map(key=>[key,Math.max(0,...documentRows.map(doc=>Number.isFinite(doc[key])?doc[key]:0))]));
  documents.append(paragraph("Bar lengths compare recorded values within this saved document set only. Missing scores have no bar; values are not renormalized for accounting."));
  for(const doc of documentRows){
    const row=node("section",null,{class:"document-readout"});row.append(node("strong",doc.document_id||"Unbound saved page"));
    for(const [label,key] of [["BM25 / maximum recorded page value","bm25_max"],["Native retrieval RRF / maximum recorded page value","native_rrf_max"]]){
      const value=doc[key];if(!Number.isFinite(value))continue;
      const readout=paragraph(`${label}: ${formatRecordedScore(value)}`);readout.title=`Exact saved value: ${value}`;row.append(readout);
      if(Number.isFinite(value)&&value>=0&&maxima[key]>0)row.append(node("meter",null,{min:"0",max:maxima[key],value,"aria-label":`${label}: ${value}`}));
    }
    if(doc.aggregation)row.append(paragraph(human(doc.aggregation)));documents.append(row);
  }
  host.append(documents);
  if(candidates.length){const chart=node("section",null,{class:"narrative-score-chart","data-testid":"narrative-scorecards"});chart.append(node("h4",candidates.some(coverageRecorded)?"Candidate requirement coverage / active reading":"Saved candidate order and local checks / active reading"));
    for(const candidate of candidates){const row=node("div",null,{class:"narrative-score-row"});row.append(node("strong",`${candidate.rank}. ${candidate.fill}`));
      const denominator=candidate.required_field_count,numerator=candidate.established_fields;
      if(coverageRecorded(candidate)){const meter=node("meter",null,{min:"0",max:denominator,value:numerator,"aria-label":`${candidate.fill}: ${numerator} of ${denominator} required fields established`});row.append(meter,paragraph(`${numerator} / ${denominator} required fields established${Number.isInteger(candidate.partial_fields)?`; ${candidate.partial_fields} partial`:''}${Number.isInteger(candidate.missing_fields)?`; ${candidate.missing_fields} missing`:''}.`));}
      if(Number.isFinite(candidate.native_score)){
        const readout=paragraph(`Native ranking score: ${formatRecordedScore(candidate.native_score)}. Rank is not correctness.`);
        readout.title=`Exact saved value: ${candidate.native_score}`;row.append(readout);
      }
      const checks=rows(candidate.checklist).filter(c=>typeof c.label==='string'&&typeof c.state==='string');
      if(checks.length){
        const details=node('details',null,{'data-testid':'recorded-score-checklist'}),counts=new Map();
        for(const check of checks)counts.set(check.state,(counts.get(check.state)||0)+1);
        details.append(node('summary','Recorded local checks / '+[...counts].map(([state,count])=>count+' '+human(state)).join(', ')));
        const list=node('ul',null,{class:'narrative-checklist'});
        for(const check of checks){const item=node('li',null,{'data-state':check.state});
          item.append(node('span',human(check.state),{class:'narrative-check-state'}),node('span',check.label));
          if(check.detail)item.title=check.detail;list.append(item);
        }
        details.append(paragraph('These are the saved checklist states, not independent evidence votes or a support probability.'),list);row.append(details);
      }
      chart.append(row);
    }host.append(chart);
  }
  const components=scorecards.components;
  const requiredComponents=rows(components?.rows).filter(c=>c.required!==false);
  if(requiredComponents.length){host.append(node("h4","Required assertion coverage"));for(const component of requiredComponents){
    const row=node("div",null,{class:"verdict-unit"}),counts=[];
    if(Number.isInteger(component.document_count))counts.push(scorecards.version==='narrative-scorecards/2'?
      `${component.document_count} signed source witnesses (distinct documents)`:`${component.document_count} distinct source documents`);
    if(scorecards.version==='narrative-scorecards/2'&&Number.isInteger(component.context_document_count))
      counts.push(`${component.context_document_count} context document${component.context_document_count===1?'':'s'}${component.context_is_signed_evidence===false?' (not signed evidence)':''}`);
    row.append(node("strong",component.text||component.id),paragraph(`${human(component.status)}${counts.length?' / '+counts.join('; '):''}. Multiple citations are not independent samples.`));host.append(row);
  }}
}

export function renderDigest(host,trace,onSource) {
  host.replaceChildren();host.append(node("h3","Source-bound model summary"));
  const digest=trace?.digest;
  if(typeof digest?.text!=="string"||!digest.text.trim()){host.append(paragraph("No saved source-bound model summary is published for this condition. Nothing is generated in the browser."));return;}
  host.append(paragraph("Saved model interpretation of the selected sources, separate from the local verdict and not independent validation.","notice"),paragraph(digest.text,"narrative-digest-text"));
  for(const proof of sourceRefs(trace,digest.citations))host.append(sourceControl(proof,onSource));
}


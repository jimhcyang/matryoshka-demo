import {nestedLayout, percentChange, changeColor, formatNumber, formatTargetText} from "./flow-layout-v4.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const short = (s,n=7) => {const words=String(s||"").split(/\s+/);return words.slice(0,n).join(" ")+(words.length>n?"...":"");};
export const compactNodeLabel = text => short(String(text??"").trim().replace(/\s+/g," "),12);
const fmt = x => formatNumber(x,"not stored");
const kindColor = n => ({domain:"#9c7532",theme:"#bd7b59",community:"#368b80",entity:"#477eae",claim:"#a76b40",event:"#8d708c"}[n.type.toLowerCase()]||"#708a91");

const taskTone = node => {const roles=(node.task_roles||[]).map(r=>String(r.direction||'').toUpperCase());return roles.some(r=>['AGAINST','COUNTER','OPPOSED'].includes(r))?"#b44032":roles.some(r=>['FOR','SUPPORT','SUPPORTED'].includes(r))?"#17745c":"#bd8a15";};
const directionLabel = (raw,options) => {
  if(typeof options.formatDirection==="function")return options.formatDirection(raw);
  return ({SUPPORT:"Support",SUPPORTED:"Support",FOR:"Support",COUNTER:"Counterevidence",CONTRADICTED:"Counterevidence",AGAINST:"Counterevidence",
    PARTIAL:"Partial",SOME:"Partial","PARTIAL EVIDENCE":"Partial","PARTIAL / DIRECTION UNESTABLISHED":"Partial",MIXED:"Support + Counterevidence",CONFLICT:"Support + Counterevidence",
    "FOR + AGAINST":"Support + Counterevidence",INSUFFICIENT:"Unresolved",UNSUPPORTED:"Unresolved",MISSING:"Unresolved",UNRESOLVED:"Unresolved",
    INFERRED:"Unresolved","CONTEXTUAL INFERENCE":"Unresolved",RELATED:"Context only",BACKGROUND:"Context only",CONTEXT:"Context only"})[String(raw??"").trim().toUpperCase()]||"Not recorded";
};
export const localizedProof = proof => typeof proof?.text==="string"&&proof.text.length>0&&Number.isInteger(proof.start)&&Number.isInteger(proof.end)&&proof.start>=0&&proof.end>proof.start&&!!proof.canonical_page_id;

function inspectPresentation(container,options,title,body){
  if(typeof options.onInspect==="function"){options.onInspect({title,body});return;}
  const dialog=document.createElement("dialog");dialog.className="flow-inspection-v70";dialog.dataset.testid="flow-inspection";
  const heading=document.createElement("h2");heading.textContent=title;
  const close=document.createElement("button");close.type="button";close.textContent="Close";close.onclick=()=>dialog.close();
  dialog.append(heading,close,body);container.append(dialog);dialog.addEventListener("close",()=>dialog.remove(),{once:true});dialog.showModal();
}

export function edgeStyle(edge, proofs=[]) {
  if(edge.kind==="NAVIGATION")return {color:"#b88a23",dash:[7,4],label:"Membership navigation / not a source assertion"};
  if(edge.kind==="SOURCE_AGGREGATE")return {color:"#697780",dash:[1,4],label:"Aggregate source support across groups / not a group-level fact"};
  if(edge.kind==="SOURCE")return proofs.some(localizedProof)
    ?{color:"#087b70",dash:[],label:"Source connection with localized quotation / not necessarily a historical assertion"}
    :{color:"#59616b",dash:[],label:"Source connection / no localized quotation attached"};
  return {color:"#697780",dash:[9,3,1,3],label:"Other saved transport / "+edge.kind+" / no source assertion inferred"};
}

export function changeDescription(current, previous, initial=false) {
  if(!Number.isFinite(current)||!Number.isFinite(previous))return "No numerical comparison supplied";
  if(initial)return "Initial saved mass / blue means no previous iteration to compare";
  const change=percentChange(current,previous);
  if(change==="new")return "New positive mass from zero / gold; percentage undefined (no positive denominator)";
  if(change===0)return "0% change from own previous mass / stable blue, not a verdict";
  return `${change>0?"+":""}${fmt(change)}% from own previous mass / ${change>0?"gain, green":"loss, red"}`;
}

const pairKey=edge=>JSON.stringify([edge.source,edge.target]);
const finiteMass=value=>Number.isFinite(value)&&value>=0;
export const scientificMass=fmt;
export function massCategory(node) {
  if(node.layout_only)return null;
  const identity=String(node.id||"").toLowerCase();
  if(identity.startsWith("hierarchy:")){const level=identity.split(":")[1];return ["community","theme","domain"].includes(level)?level:"other";}
  if(/^(document|doc|source|page)(:|_)/.test(identity))return "other";
  const type=String(node.type||"unknown").toLowerCase();
  return ["entity","claim","event"].includes(type)?"semantic":type;
}
export function categoryMassStats(projection, frame) {
  const groups=new Map();
  for(const node of projection.nodes){
    const category=massCategory(node),mass=Number.isInteger(node.mass_index)&&node.mass_index>=0?frame.weights[node.mass_index]:null;
    if(category===null||!finiteMass(mass))continue;
    if(!groups.has(category))groups.set(category,[]);
    groups.get(category).push(mass);
  }
  const stats=new Map();
  for(const [category,values]of groups){
    const maximum=Math.max(...values),fraction=maximum>0?values.reduce((sum,value)=>sum+value/maximum,0)/values.length:0;
    stats.set(category,{count:values.length,mean:maximum*fraction,logMean:maximum>0?Math.log2(maximum)+Math.log2(fraction):null,basis:"saved-projection"});
  }
  return stats;
}
export function categorySizeReference(projection, frame) {
  const reference=frame.category_reference,keys=["semantic","community","theme","domain","other"];
  const valid=reference?.version==="active-eligible-category-moments/1"&&reference.scope==="active eligible diffusion states"&&
    reference.zero_mass_members_included===true&&reference.std_definition==="population (ddof=0)"&&
    Number.isInteger(reference.cohort_count)&&reference.cohort_count>=0&&
    Number.isInteger(reference.excluded_inactive_count)&&reference.excluded_inactive_count>=0&&
    keys.every(key=>{const s=reference.categories?.[key];return s&&Number.isSafeInteger(s.count)&&s.count>=0&&finiteMass(s.mean)&&finiteMass(s.std)&&(s.mean_log2==null||Number.isFinite(s.mean_log2))&&(s.count>0||s.mean===0&&s.std===0&&s.mean_log2==null);})&&
    keys.reduce((sum,key)=>sum+reference.categories[key].count,0)===reference.cohort_count;
  if(valid)return new Map(keys.map(key=>{const group=reference.categories[key];return [key,{...group,
    logMean:group.mean>0?Math.log2(group.mean):group.mean_log2??null,basis:"active eligible diffusion states"}];}));
  const fallback=categoryMassStats(projection,frame);
  for(const value of fallback.values())value.referenceStatus=reference?"invalid":"absent";
  return fallback;
}
export function categoryFitScale(projection,nodes=projection.nodes,references=null){
  const fit=new Map(),groups=references||projection.frames.map(frame=>categorySizeReference(projection,frame));
  for(const [i,frame]of projection.frames.entries())for(const node of nodes){
    const category=massCategory(node),mass=Number.isInteger(node.mass_index)&&node.mass_index>=0?frame.weights[node.mass_index]:null,group=groups[i].get(category);
    if(category===null||!finiteMass(mass)||mass===0||!group?.count||!Number.isFinite(group.logMean))continue;
    const peakLogRatio=Math.log2(mass)-group.logMean;
    if(!fit.has(category)||peakLogRatio>fit.get(category).peakLogRatio){
      const logMultiplier=Math.min(0,2-.5*peakLogRatio);
      fit.set(category,{logMultiplier,multiplier:2**logMultiplier,peakLogRatio,peakIteration:frame.iteration,
        basis:'displayed category peak relative mass across all saved frames'});
    }
  }
  return fit;
}
export function relativeNodeSize(node, frame, stats, fit=null) {
  const category=massCategory(node),mass=Number.isInteger(node.mass_index)&&node.mass_index>=0?frame.weights[node.mass_index]:null,group=stats.get(category);
  const result={category,mass,mean:group?.mean??null,meanLog:group?.logMean??null,count:group?.count??0,basis:group?.basis||"saved-projection",ratio:null,logRatio:null,radius:.35,status:"unavailable"};
  if(category===null)return {...result,status:"layout-only"};
  if(!finiteMass(mass))return result;
  if(!group)return {...result,status:"reference-unavailable"};
  if(group.count===0)return {...result,mean:null,status:"empty-category"};
  if(mass===0)return {...result,ratio:group.logMean===null?null:0,status:group.logMean===null?"all-zero":"zero"};
  if(!Number.isFinite(group.logMean))return {...result,status:"reference-unavailable"};
  const logRatio=Math.log2(mass)-group.logMean;
  const scale=fit?.get(category),logMultiplier=scale?.logMultiplier??0;
  // One category scalar covers the whole playback; never clip individual leaders.
  return {...result,logRatio,ratio:2**logRatio,radius:6*2**(.5*logRatio+logMultiplier),status:"positive",
    scaleMultiplier:scale?.multiplier??1,meanRadius:6*2**logMultiplier,scalePeakIteration:scale?.peakIteration??null};
}
function sizeDescription(size) {
  if(size.status==="layout-only")return "Layout only, no solver mass or category mean";
  if(size.status==="unavailable")return "Saved numerical mass unavailable; excluded from the category mean";
  if(size.status==="reference-unavailable")return `Mass ${fmt(size.mass)}\nNo same-category reference supplied; this marker is not a zero-mass claim.`;
  const category=size.category==="semantic"?"semantic (entity / claim / event)":size.category;
  const basis=size.basis==="saved-projection"?"saved-projection":"active eligible diffusion states";
  const log10=size.meanLog*Math.LOG10E*Math.LN2,exponent=Math.floor(log10);
  const meanText=size.mean===0&&Number.isFinite(size.meanLog)?"~"+(10**(log10-exponent)).toFixed(2)+"\u00d710^"+exponent+" (below scalar range)":scientificMass(size.mean);
  return `Mass ${scientificMass(size.mass)}\nSame-level ${basis} mean (${category}, n=${size.count} including zeros): ${meanText}\n`+
    (size.status==="empty-category"?"No active reference states in this category; mean and ratio unavailable.":
    (size.status==="all-zero"?"All category masses are zero; ratio undefined. Hollow position marker only.":size.status==="zero"?"Zero mass / positive category mean: ratio 0. Hollow position marker only.":`Mass / category mean: ${Number.isFinite(size.ratio)?fmt(size.ratio):"above numeric ratio range"}x. Radius: ${fmt(size.radius)} px (area-proportional, fixed category fit).\nCategory multiplier ${fmt(size.scaleMultiplier)}; mean radius ${fmt(size.meanRadius)} px. Fixed across playback; peak relative mass at saved iteration ${size.scalePeakIteration??'not supplied'}.`)+
    (size.basis==="saved-projection"?"\nProjection-only reference, not entire KG statistics.":"\nActive eligible-state reference, including zeros; not the entire KG."));
}
const representative=candidate=>candidate?.source_identity_representative||candidate?.source_semantic_representative;
const identityProofs=candidate=>{const seen=new Set();return (candidate?.source_identity_representative?.identity_proofs||[]).filter(p=>{const key=JSON.stringify([p.canonical_page_id,p.start,p.end]);if(seen.has(key))return false;seen.add(key);return true;});};
const endpointIds=candidate=>candidate?.endpoint_ids?.length?[...new Set(candidate.endpoint_ids)]
  :!representative(candidate)&&(candidate?.contributor_explanation?.binding??candidate?.binding)!=="source_page_readout"?[...new Set(candidate?.contributor_explanation?.endpoint_ids||[])]:[];

export function candidateGraph(projection, candidate) {
  const schema=candidate?.contributor_explanation,known=new Set(projection.nodes.map(n=>n.id));
  const endpoints=endpointIds(candidate),targets=candidate?.presentation_target_ids??(endpoints.length?endpoints:candidate?.source_contributor_ids||schema?.endpoint_ids||[]);
  const edges=new Map(projection.edges.map((edge,i)=>[pairKey(edge),{edge,index:i}]));
  const routes=[...(candidate?.represented_routes??candidate?.routes??[]),...(candidate?.influence_corridors||[])].filter(r=>r.route_kind!=="LEXICAL_SOURCE_READOUT");
  const pairs=new Set(),primaryPairs=new Set(),related=new Set(targets.filter(id=>known.has(id))),missingPairs=new Set();
  function add(edge){const key=pairKey(edge),saved=edges.get(key);if(saved){pairs.add(key);related.add(saved.edge.source);related.add(saved.edge.target);}else missingPairs.add(key);}
  for(const edge of schema?.graph_edges||[])add(edge);
  for(const route of routes)for(const [i,hop] of (route.hops||[]).entries()){
    if(hop.numerical_transition===false)continue;
    const source=hop.source||route.nodes?.[i]?.id,target=hop.target||route.nodes?.[i+1]?.id;if(source&&target)add({source,target});
  }
  for(const [i,hop] of (routes[0]?.hops||[]).entries()){
    const edge={source:hop.source||routes[0].nodes?.[i]?.id,target:hop.target||routes[0].nodes?.[i+1]?.id};
    if(hop.numerical_transition!==false&&edges.has(pairKey(edge)))primaryPairs.add(pairKey(edge));
  }
  for(const edge of candidate?.contribution_edges||[])add(edge);
  const final=projection.frames.at(-1),finalBalance=schema?.incoming_frames?.find(f=>f.iteration===final.iteration);
  const amounts=new Map((finalBalance?.contributions||[]).map(e=>[pairKey(e),e.mass]));
  const incoming=projection.edges.map((edge,index)=>({edge,index,mass:amounts.get(pairKey(edge))??final.edge_mass?.[index]??0}))
    .filter(row=>targets.includes(row.edge.target)).sort((a,b)=>b.mass-a.mass||pairKey(a.edge).localeCompare(pairKey(b.edge)));
  for(const row of incoming){add(row.edge);primaryPairs.add(pairKey(row.edge));}
  for(const id of schema?.graph_node_ids||[])if(known.has(id))related.add(id);
  const starters=new Set(schema?.starter_ids||[]);
  for(const starter of projection.starters)if((starter.targets||[]).some(t=>t.mass>0&&related.has(t.id)))starters.add(starter.id);
  return {schema,targets,endpoints,routes,incoming,pairs,primaryPairs,related,starters,missingPairs,edges};
}

export function overviewNodes(projection, limit=256, selected=null, suppliedGraph=null, starterId=null) {
  const all=new Map(projection.nodes.map(n=>[n.id,n])),included=new Set(),graphs=projection.candidates.slice(0,5).map(c=>candidateGraph(projection,c));
  function admit(ids){
    const needed=new Set();
    for(let at of ids){const chain=new Set();while(at){if(!all.has(at)||chain.has(at))throw Error("Invalid saved hierarchy parent chain");chain.add(at);needed.add(at);at=all.get(at).parent_id;}}
    if(new Set([...included,...needed]).size>limit)return false;
    needed.forEach(id=>included.add(id));return true;
  }
  const targets=[...new Set(graphs.flatMap(g=>g.targets))];
  targets.filter(id=>all.has(id)).forEach(id=>admit([id]));
  const starters=[...projection.starters].sort((a,b)=>(a.id===starterId?-1:0)-(b.id===starterId?-1:0));
  for(const starter of starters){const top=[...(starter.targets||[])].filter(t=>t.mass>0&&all.has(t.id)).sort((a,b)=>b.mass-a.mass||a.id.localeCompare(b.id))[0];if(top)admit([top.id]);}
  for(const graph of graphs)for(const {edge} of graph.incoming.slice(0,4))admit([edge.target,edge.source]);
  for(const graph of graphs)for(const route of graph.routes){const ids=(route.nodes||[]).map(n=>n.id).filter(id=>all.has(id));admit(ids);}
  const reverse=new Map(),final=projection.frames.at(-1);
  for(const [index,edge] of projection.edges.entries()){if(edge.source===edge.target)continue;if(!reverse.has(edge.target))reverse.set(edge.target,[]);reverse.get(edge.target).push({edge,mass:final.edge_mass?.[index]||0});}
  let level=targets,visited=new Set(targets);
  while(level.length&&included.size<limit){
    const rows=level.map(id=>[...(reverse.get(id)||[])].sort((a,b)=>b.mass-a.mass||a.edge.source.localeCompare(b.edge.source))),next=[];
    for(let i=0;i<Math.max(0,...rows.map(r=>r.length));i++)for(const row of rows){const edge=row[i]?.edge;if(!edge||visited.has(edge.source))continue;visited.add(edge.source);if(admit([edge.source,edge.target]))next.push(edge.source);}
    level=next;
  }
  for(const starter of starters)for(const target of [...(starter.targets||[])].filter(t=>t.mass>0).sort((a,b)=>b.mass-a.mass||a.id.localeCompare(b.id)))if(all.has(target.id))admit([target.id]);
  if(limit>=1024)for(const node of projection.nodes)admit([node.id]);
  return projection.nodes.filter(n=>included.has(n.id));
}

export function traceBackbone(projection, nodes) {
  const visible=new Set(nodes.map(n=>n.id)),final=projection.frames.at(-1),graphs=projection.candidates.slice(0,5).map(c=>candidateGraph(projection,c));
  const targets=new Set(graphs.flatMap(g=>g.targets).filter(id=>visible.has(id))),incoming=new Map(),eligible=new Map(),pairs=new Set(),important=new Set();
  for(const [index,edge]of projection.edges.entries()){
    const mass=final.edge_mass?.[index];
    if(edge.source===edge.target||!visible.has(edge.source)||!visible.has(edge.target)||!Number.isFinite(mass)||mass<=0)continue;
    const row={edge,index,mass},key=pairKey(edge);eligible.set(key,row);
    if(!incoming.has(edge.target))incoming.set(edge.target,[]);incoming.get(edge.target).push(row);
  }
  const compare=(a,b)=>b.mass-a.mass||pairKey(a.edge).localeCompare(pairKey(b.edge));
  for(const [target,rows]of incoming){rows.sort(compare);for(const row of targets.has(target)?rows:rows.slice(0,1)){pairs.add(pairKey(row.edge));if(targets.has(target))important.add(pairKey(row.edge));}}
  const restartTargets=new Map(projection.starters.map(s=>[s.id,new Set()]));
  const matches=new Map(projection.starters.map(s=>[s.id,[...(s.targets||[])].filter(t=>visible.has(t.id)&&t.mass>0&&Number.isFinite(t.mass)).sort((a,b)=>b.mass-a.mass||a.id.localeCompare(b.id))]));
  for(const starter of projection.starters){const top=matches.get(starter.id)[0];if(top)restartTargets.get(starter.id).add(top.id);}
  for(const graph of graphs)for(const route of graph.routes){
    for(const [i,hop]of (route.hops||[]).entries()){
      if(hop.numerical_transition===false)continue;
      const key=pairKey({source:hop.source||route.nodes?.[i]?.id,target:hop.target||route.nodes?.[i+1]?.id});
      if(eligible.has(key)){pairs.add(key);important.add(key);}
    }
    const origin=route.nodes?.[0]?.id;
    if(matches.get(route.starter_id)?.some(t=>t.id===origin))restartTargets.get(route.starter_id).add(origin);
  }
  // A deterministic shortest visible positive path connects each available A/Q origin.
  const distance=new Map([...targets].map(id=>[id,0])),nextHop=new Map(),queue=[...targets].sort();
  for(let i=0;i<queue.length;i++)for(const row of incoming.get(queue[i])||[]){
    if(distance.has(row.edge.source)||distance.get(queue[i])+1>projection.iterations)continue;
    distance.set(row.edge.source,distance.get(queue[i])+1);nextHop.set(row.edge.source,row.edge);queue.push(row.edge.source);
  }
  for(const starter of projection.starters){
    const origin=matches.get(starter.id).filter(t=>distance.has(t.id)).sort((a,b)=>distance.get(a.id)-distance.get(b.id)||b.mass-a.mass||a.id.localeCompare(b.id))[0];
    if(!origin)continue;restartTargets.get(starter.id).add(origin.id);
    let at=origin.id;while(nextHop.has(at)){const edge=nextHop.get(at),key=pairKey(edge);pairs.add(key);important.add(key);at=edge.target;}
  }
  return {pairs,important,restartTargets,eligible,targets};
}

export function incomingFrame(candidate, iteration) {
  if(typeof candidate?.contributor_explanation?.version!=="string"||!candidate.contributor_explanation.version)return {status:"unavailable",frame:null};
  const frame=candidate?.contributor_explanation?.incoming_frames?.find(f=>f.iteration===iteration);
  if(!frame)return {status:"unavailable",frame:null};
  const fields=["endpoint_mass","restart_mass","incoming_mass","shown_incoming_mass","remainder_incoming_mass"];
  const close=(a,b)=>Math.abs(a-b)<=1e-14+1e-9*Math.max(Math.abs(a),Math.abs(b));
  const seen=new Set(),parts=frame.contributions||[];
  const valid=fields.every(k=>finiteMass(frame[k]))&&Array.isArray(parts)&&parts.every(p=>{
    const key=pairKey(p);if(seen.has(key)||!finiteMass(p.mass))return false;seen.add(key);return true;
  })&&close(frame.endpoint_mass,frame.restart_mass+frame.incoming_mass)
    &&close(frame.incoming_mass,frame.shown_incoming_mass+frame.remainder_incoming_mass)
    &&close(frame.shown_incoming_mass,parts.reduce((sum,p)=>sum+p.mass,0));
  return {status:valid?"supplied":"invalid",frame};
}

export function candidateSources(projection, candidate) {
  const docs=new Map((projection.documents||[]).map(d=>[d.id,d])),ids=[];
  for(const proof of candidate?.sources||[]){const id=proof.document_id;if(!id)continue;ids.push(id);
    if(!docs.has(id))docs.set(id,{id,title:id,date:proof.date,source:proof,visible_node_ids:[],eligible_node_count:null,membership_unavailable:true});}
  for(const doc of projection.documents||[])if(doc.candidate_ids?.includes(candidate?.id))ids.push(doc.id);
  const chosen=new Set(ids),selected=[...chosen].map(id=>docs.get(id));
  const remaining=[...docs.values()].filter(d=>!chosen.has(d.id));
  return {selected,lexical:remaining.filter(d=>Number.isInteger(d.lexical_rank)),other:remaining.filter(d=>!Number.isInteger(d.lexical_rank))};
}

export function documentMembership(doc, nodes) {
  const projected=[...new Set(doc.visible_node_ids||[])];
  const visible=new Set(nodes.filter(n=>!n.layout_only&&!["domain","theme","community"].includes(n.type.toLowerCase())).map(n=>n.id));
  return {projected:projected.length,shown:projected.filter(id=>visible.has(id)).length,
    eligible:Number.isInteger(doc.eligible_node_count)?doc.eligible_node_count:null};
}

// A presentation shortcut is based only on recorded projection values, never a solver certificate.
export function historyView(projection, minimum=32, relativeTolerance=1e-3) {
  const frames=projection.frames||[],full=frames.map((_,i)=>i),last=frames.length-1;
  const result={indices:full,cutoff:null,omitted:0,relativeTolerance,maxTailL1:null};
  if(last<=minimum+1||projection.iterations!==last||frames.some((f,i)=>f.iteration!==i))return result;
  function distance(a,b){
    if(a.weights.length!==b.weights.length||!Number.isFinite(a.other_mass)||!Number.isFinite(b.other_mass))return Infinity;
    let sum=Math.abs(a.other_mass-b.other_mass);
    for(let j=0;j<a.weights.length;j++){
      const x=a.weights[j],y=b.weights[j];if(x===null&&y===null)continue;
      if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0)return Infinity;
      sum+=Math.abs(x-y);
    }
    return sum;
  }
  for(let i=minimum;i<last-1;i++){
    const anchor=frames[i],threshold=relativeTolerance*anchor.total_mass;
    if(!Number.isFinite(threshold)||threshold<=0)continue;
    let maximum=0;
    for(let j=i+1;j<=last;j++){maximum=Math.max(maximum,distance(anchor,frames[j]));if(maximum>threshold)break;}
    if(maximum<=threshold)return {...result,indices:[...full.slice(0,i+1),last],cutoff:i,omitted:last-i-1,maxTailL1:maximum};
  }
  return result;
}

export function stoppingExplanation(projection, certificate) {
  const c=certificate;
  if(!c||c.iterations!==projection.iterations||c.alpha!==projection.alpha)return "Saved stopping certificate not supplied for this replay. The saved final iteration is retained; no early native convergence is inferred from the drawing.";
  const certified=c.converged===true&&c.norm==="L1"&&Number.isFinite(c.residual)&&c.residual>=0&&Number.isFinite(c.tolerance)&&c.tolerance>0&&Number.isFinite(c.error_bound)&&c.error_bound>=0&&c.error_bound<=c.tolerance&&c.alpha>0&&c.alpha<1&&c.residual/(1-c.alpha)<=c.tolerance;
  return `Saved solver: alpha ${fmt(c.alpha)}, tolerance ${fmt(c.tolerance)} ${c.norm||"(norm not supplied)"}; ${c.iterations} iterations. ${certified?"Final native certificate":"Saved stopping metadata (certificate not established here)"}: residual ${fmt(c.residual)}, error bound ${fmt(c.error_bound)}. Native stopping tests fixed-point residual / (1 - alpha) against tolerance, not a chosen animation length.`;
}

export function edgeProofs(projection,edge) {
  if(edge.kind==="NAVIGATION")return [];
  const proofs=[...(edge.citations||[])];
  for(const candidate of projection.candidates||[])for(const route of [...(candidate.represented_routes??candidate.routes??[]),...(candidate.influence_corridors||[])]){
    for(const [i,hop] of (route.hops||[]).entries()){
      const source=hop.source||route.nodes?.[i]?.id,target=hop.target||route.nodes?.[i+1]?.id;
      if(source===edge.source&&target===edge.target&&hop.kind===edge.kind)proofs.push(...(hop.citations||[]));
    }
  }
  const seen=new Set();return proofs.filter(p=>{const key=JSON.stringify([p.canonical_page_id,p.start,p.end,p.text]);if(seen.has(key))return false;seen.add(key);return true;});
}

export function mountFlow(container, options) {
  const projection=options.projection||options.flow;
  const resultText=item=>formatTargetText(item,projection?.task||options.task);
  container.replaceChildren();
  container.classList.add("flow-v6");
  if(!projection?.frames?.length){container.innerHTML='<p class="flow-empty-v6">This method has no saved diffusion. Its actual source results remain available below; no graph journey is invented.</p>';return{destroy(){container.replaceChildren();},selectCandidate(){},selectDocument(){}};}
  let frame=0,selected=projection.candidates[0]?.id||null,documentId=null,timer=null,disposed=false,focusedNode=null,focusedStarter=null,linksHidden=true,linkMode="union",fullHistory=false,flashNodes=new Set(),flashTimer=null,lastPingId=null;
  const frameSizeStats=projection.frames.map(saved=>categorySizeReference(projection,saved));
  let sizeStats=frameSizeStats[0];
  const labelOverrides=new Map(),overviewLimit=[128,256].includes(options.overviewLimit)?options.overviewLimit:projection.overview_limit===128?128:256;
  let selectedGraph=candidateGraph(projection,projection.candidates[0]);
  const history=historyView(projection),certificate=options.solverStopping||projection.solver_stopping;
  const graphs=[],actions=new Map();let serial=0;
  const action=(label,fn,attrs="")=>{const id="flow-action-"+(++serial);actions.set(id,fn);return `<button type="button" data-flow-action="${id}" ${attrs}>${esc(label)}</button>`;};
  function onClick(event){const button=event.target.closest("[data-flow-action]");if(button)actions.get(button.dataset.flowAction)?.();}
  container.addEventListener("click",onClick);
  container.innerHTML=`<div class="flow-toolbar-v6"><strong>Source relevance</strong>${action("Fit",()=>graphs.forEach(g=>g.fit()))}${action("Open larger hierarchy",openExpanded,'data-testid="expand-flow-v6"')}<label>Links <select data-links aria-label="Displayed flow link kinds"><option value="union">All result routes</option><option value="candidate">Selected result</option><option value="hierarchy">Hierarchy only</option><option value="source">Source connections</option><option value="all">All supplied links</option></select></label><label>Labels <select data-labels><option value="key">Essentials</option><option value="all">All visible nodes</option><option value="none">None</option></select></label>${action("Hide all labels",toggleLabels,'data-global-label-toggle aria-pressed="true" data-label-state="key" title="Global label default; individual node boxes toggle independently"')}</div>
    <div class="flow-starters-v6" data-testid="flow-starters-v6">${projection.starters.map((s,i)=>action(starterCode(s,i)+" / "+short(s.label),()=>focusStarter(s),`title="${esc(s.label)}"`)).join("")}</div>
    <div class="flow-map-grid-v6"><div class="flow-map-column-v6"><div class="flow-scroll-v6"><canvas class="flow-canvas-v6" data-testid="hierarchy-flow-v6" tabindex="0" aria-label="Saved hierarchical diffusion. Click a node to toggle its own real-name box; drag to pan and scroll to zoom."></canvas><div class="flow-tooltip-v6" hidden></div></div>
      <div class="flow-focus-v6"><span data-focus-note>This result's saved contributor cone and query matches.</span>${action("Inspect selected node",()=>{if(focusedNode)options.onNode?.(projection.nodes.find(n=>n.id===focusedNode));},'data-inspect-focused disabled')}${action("Show all results",()=>chooseLinks("union"))}${action("Show result links",toggleEdges,'data-toggle-result aria-pressed="false"')}</div></div>
      <aside class="flow-documents-v6"><h4>Sources behind this result</h4><p data-document-result></p><p>Source provenance, not numerical document states or independent corroboration.</p><details><summary>How these sources and counts are chosen</summary><p>The selected result's saved citations and linked documents are first. Other direct lexical sources and global projection readouts are separate, not additional support for this result.</p><p>Lexical rank is a document's order in direct text retrieval: BM25 page searches fused by reciprocal rank (RRF, k=60), within and then across search families. It is not a diffusion rank or evidence score.</p><p>Source-owned nodes are distinct semantic IDs on eligible pages, not snippets or hierarchy containers. Counts distinguish this compact drawing, the saved larger projection, and the scoped source index. Membership can overlap across documents and must not be summed as conserved relevance or independent evidence.</p></details><p data-document-selection role="status"></p><section data-node-reader aria-label="Full node text"></section><div data-documents></div></aside></div>
    <div class="flow-legend-v6"><span><i class="change gain"></i>Green: +% gain</span><span><i class="change loss"></i>Red: -% loss</span><span><i style="--tone:#c6d9e8"></i>Blue: stable / initial</span><span><i style="--tone:#ddb33e"></i>Gold: new from zero</span><span><i class="line" style="--tone:#087b70"></i>Solid teal: SOURCE with quote</span><span><i class="line" style="--tone:#59616b"></i>Solid gray: SOURCE, no quote attached</span><span><i class="line navigation" style="--tone:#b88a23"></i>Dashed gold: NAVIGATION</span><span><i class="line aggregate" style="--tone:#697780"></i>Dotted gray: SOURCE_AGGREGATE</span><span><i class="line restart" style="--tone:#7797b5"></i>Dashed blue: query restart</span><span><i style="--tone:#fff0b1"></i>Outline: endpoint / source contributor</span></div>
    <div class="flow-timeline-v6"><div class="flow-timeline-row-v6"><input data-frame-slider type="range" min="0" max="${projection.frames.length-1}" value="0" step="1" aria-label="Diffusion iteration"></div><div class="flow-history-v63">${action("Play",togglePlay,'data-testid="play-flow-v6"')}<label>Iteration <input data-frame-number type="number" min="0" max="${projection.frames.length-1}" value="0" step="1" aria-label="Exact diffusion iteration"></label><label>Playback <select data-history aria-label="Saved iteration playback"><option value="compact">Compact</option><option value="full">Every saved step</option></select></label>${action("Saved final",()=>{pause();setFrame(projection.frames.length-1);},'data-final-frame')}</div><p class="flow-live-v6 flow-note-v6" data-live aria-live="polite"></p><p class="flow-note-v6" data-history-note></p><details class="flow-stopping-v63"><summary>What determines the saved iteration count?</summary><p data-stopping></p></details></div>
    <div class="flow-explanation-v6"><p><b>Saved query inputs seed matched states directly.</b> Communities, themes and domains are navigation memberships, not a mandatory domain-first walk. Ball size compares each mass with its own category mean at this iteration, not a global maximum. Document highlighting shows provenance, not a collective activation.</p><aside><p>${Number.isFinite(projection.alpha)?`Each iteration restarts ${(100*(1-projection.alpha)).toFixed(0)}% at the saved matches and transports ${(100*projection.alpha).toFixed(0)}% through the eligible graph.`:"A restart/transport fraction was not supplied."} This is relevance, not confidence. Task-colored outlines identify saved evidence endpoints; missing evidence has no invented endpoint.</p></aside></div>`;
  container.querySelector(".flow-toolbar-v6 strong").insertAdjacentHTML("afterend",action("Show edges",toggleEdges,'data-toggle-edges aria-pressed="false"'));
  const sizing=document.createElement("details");sizing.className="flow-size-basis-v6";sizing.dataset.sizeBasis="saved-projection-category-mean";
  const sizeTitle=document.createElement("summary");sizeTitle.textContent="Node area and category reference";
  const sizeScope=document.createElement("p");sizeScope.dataset.sizeScope="";
  const sizeHelp=document.createElement("p");sizeHelp.textContent="Node area is proportional to mass / same-category mean. Radius = 6 x category multiplier x sqrt(ratio). One multiplier per category is chosen from the maximum relative mass across every saved frame in this drawing, keeping the playback-wide maximum at most 24 layout px. It stays fixed during playback; no per-node hard cap or positive-radius floor flattens mass ratios. Category means still follow the actual saved frame; the fit does not track each frame's leader. Compact and larger drawings can use different fixed multipliers. Zero mass has only a hollow 0.35 px position marker, not a mass-filled circle. The legend illustrates within-category area ratios, not absolute pixel sizes. Hover shows actual mass, category mean, fixed multiplier and resulting mean radius. Candidate/source outlines are separate and never boost the mass radius. Prefer the supplied active eligible diffusion cohort, including zero masses. Older packets use category means from the supplied projection, not the entire KG. Entity/claim/event share one semantic category; community, theme and domain remain separate. Inputs and layout-only nodes do not contribute to these means. Container area is layout only. Zoom scales markers equally. This scale changes no saved mass, rank or evidence decision.";sizing.append(sizeTitle,sizeScope,sizeHelp);
  container.querySelector(".flow-toolbar-v6").after(sizing);
  const reading=projection.reading_id||"shared search";
  const policy=document.createElement("p");policy.className="flow-drawing-policy-v65";policy.dataset.drawingPolicy="";container.querySelector(".flow-toolbar-v6").after(policy);
  function pingLabel(c){return `${c.rank}. ${resultText(c)}`;}
  function pingDescription(c){return `Locate result rank ${c.rank}: ${resultText(c)}. ${endpointIds(c).length?"Highlight its exact saved graph endpoint(s) and contributor connections.":c.source_identity_representative?"Highlight full-name identity context from another eligible page, not a native answer endpoint, original-page owned mention or proof of the queried action. The quote-to-identity handoff is not a numerical edge.":"Highlight actual source-semantic representatives if supplied; they are not answer identities. No unrelated entity is substituted."} Click again to toggle result lines.`;}
  const pings=document.createElement("div");pings.className="flow-pings-v6";pings.innerHTML=`<span>Locate results${projection.reading_id?" / reading "+esc(reading):""}:</span>${projection.candidates.slice(0,5).map((c,i)=>action(short(pingLabel(c),6),()=>pingCandidate(c.id),`title="${esc(pingDescription(c))}" aria-label="${esc(pingDescription(c))}" aria-pressed="false" data-ping="${i+1}" data-candidate-id="${esc(c.id)}"`)).join("")}<span data-ping-note role="status"></span>`;
  container.querySelector(".flow-starters-v6").after(pings);
  const resultPanel=document.createElement("section");resultPanel.className="flow-result-v64";resultPanel.setAttribute("aria-label","Selected result and exact incoming relevance");resultPanel.innerHTML=`<div class="flow-result-heading-v64"><strong data-result-title></strong><span data-result-mass></span></div><p class="flow-result-scope-v64">Default: bounded reverse contributor cones for all five results and all A/Q inputs. Real source-semantic representatives are not answer identities. Restored links are bound-native replay, not new inference.</p><p data-representative-note></p><details data-contributor-details><summary data-contributor-summary>Contributor scope and drawing limits</summary><p data-contributor-counts></p><p data-recovery-note></p></details><details data-incoming-details><summary>Incoming relevance at this saved iteration</summary><div data-incoming-balance></div></details>`;pings.after(resultPanel);
  const qualifiedResult=document.createElement('p');qualifiedResult.dataset.resultQualification='';qualifiedResult.hidden=true;resultPanel.querySelector('.flow-result-heading-v64').after(qualifiedResult);
  const mainGraph=makeGraph(container.querySelector("canvas"),overviewLimit);graphs.push(mainGraph);
  const caption=document.createElement("p");caption.className="flow-caption-v6";
  caption.textContent=`Overview: up to ${overviewLimit} supplied graph items including true ancestor containers, plus saved query inputs. Reverse search starts from supplied results' real endpoints or source-semantic representatives, protecting query matches and supplied paths. Larger view admits up to 2,048 real supplied items; a smaller packet is never padded. This is not necessarily the entire graph. Node-name boxes are front-layer labels: click any node to toggle its own box; one global button toggles Hide all labels / Show essentials. No answer node or graph edge is invented. At iteration 0 links are topology only. Container backgrounds and areas are layout, not aggregate mass. Counts overlap; drawing limits never change native relevance, rank or stopping.`;
  caption.textContent+=" The static trace backbone uses final saved positive amounts: all visible incoming links of real result targets, supplied numerical route hops, one strongest incoming transition per other node, and a deterministic shortest visible A/Q-to-target connectivity skeleton. It is a drawing aid, not a new solve or an independent explanation. Only selected actual restart matches are shown by default; selecting an input or All links (dense) exposes its full visible fanout. No links are bundled and no edge amounts are summed or renormalized. All links also exposes supplied numerical self-loops, not source assertions. Name boxes use at most 12 words and three lines; full extracted labels remain in the sidebar and original fills/quotations are unchanged.";
  container.querySelector(".flow-legend-v6").after(caption);
  const definitions=document.createElement("p");definitions.className="flow-definitions-v6";
  definitions.textContent="SOURCE is an extracted source connection, not necessarily a claimed historical relationship: solid teal only with a localized quotation; solid dark gray without an attached quote, not proof of no source. NAVIGATION is membership transport, dashed gold: navigation, not evidence. SOURCE_AGGREGATE is summed source support crossing same-level groups, dotted gray, not a group-level fact. These aggregate links and unquoted links account for the old dotted default, not an inferred path. Dashed blue connects query inputs to matches and denotes restart, not source evidence. Only saved kinds present in this projection can be drawn; at iteration 0 transport mass is zero.";
  caption.before(definitions);
  const colors=document.createElement("p");colors.className="flow-definitions-v6";colors.textContent="Node fill: green means positive change, red negative change, not good/bad or support/opposition. Intensity follows |100 x (current - previous) / previous| for that node's own immediately previous native iteration: pale for small changes, deeper for larger changes (smooth, saturating scale). Blue means exactly unchanged, including 0 to 0, or the initial frame with no previous comparison. Gold means 0 to positive: the percentage is undefined, not infinite or 100%. Layout-only containers are white and have no solver mass. Hover a node for its signed percentage. Outlines mark result roles or source provenance, independently of fill.";definitions.after(colors);
  const readingHelp=document.createElement("details");readingHelp.className="flow-reading-v63";readingHelp.innerHTML="<summary>How to read links, colors and the all-result overview</summary>";definitions.before(readingHelp);readingHelp.append(definitions,colors,caption);
  const mechanics=document.createElement("div");mechanics.hidden=true;mechanics.dataset.flowMechanics="";
  const historyDetail=document.createElement("p");historyDetail.dataset.historyExplanation="";
  mechanics.append(sizing,readingHelp,container.querySelector(".flow-explanation-v6"),container.querySelector(".flow-stopping-v63"),historyDetail);container.append(mechanics);
  container.querySelector(".flow-result-scope-v64").textContent="Source-linked states are not claim-level support decisions.";
  const finalMetrics=document.createElement("p");finalMetrics.dataset.finalMetrics="";container.querySelector("[data-incoming-details]").append(finalMetrics);
  const inspect=()=>{const body=mechanics.cloneNode(true);body.hidden=false;body.querySelectorAll("details").forEach(node=>{node.open=true;});inspectPresentation(container,options,"Graph display and relevance",body);};
  container.querySelector(".flow-toolbar-v6").insertAdjacentHTML("beforeend",action("How to read this graph",inspect,'data-inspect-flow'));
  const concise=document.createElement("p");concise.className="flow-caption-v6";concise.dataset.flowCaption="";concise.textContent="Area tracks relevance / category mean; category fit stays fixed during playback. Hover for actual mass and mean. Paths locate sources, not proof.";container.querySelector(".flow-toolbar-v6").after(concise);
  const areaLegend=document.createElement("span");areaLegend.className="flow-area-legend-v70";areaLegend.title='Illustrated within-category area ratios, not absolute pixel sizes.';areaLegend.innerHTML='Within one category: <i style="width:4px;height:4px"></i>1x mass <i style="width:8px;height:8px"></i>4x mass <i style="width:16px;height:16px"></i>16x mass';container.querySelector(".flow-legend-v6").prepend(areaLegend);
  container.querySelector("[data-stopping]").textContent=stoppingExplanation(projection,certificate);
  function chooseLinks(value){linkMode=value;focusedNode=null;focusedStarter=null;linksHidden=false;container.querySelectorAll("[data-links]").forEach(s=>{s.value=value;});graphs.forEach(g=>g.rebuild());focusNote();renderDocuments();setFrame(frame);}
  function toggleEdges(){linksHidden=!linksHidden;graphs.forEach(g=>g.draw());focusNote();}
  container.querySelector("[data-links]").onchange=event=>chooseLinks(event.target.value);
  container.querySelector("[data-history]").onchange=event=>chooseHistory(event.target.value);
  function syncLabelControls(){const mode=container.querySelector("[data-labels]").value;for(const button of container.querySelectorAll("[data-global-label-toggle]")){button.textContent=mode==="none"?"Show essentials":"Hide all labels";button.setAttribute("aria-pressed",String(mode!=="none"));button.dataset.labelState=mode;}}
  function toggleLabels(){labelMode(container.querySelector("[data-labels]").value==="none"?"key":"none");}
  function labelMode(mode){container.querySelector("[data-labels]").value=mode;labelOverrides.clear();syncLabelControls();graphs.forEach(g=>g.draw());}
  container.querySelector("[data-labels]").onchange=event=>labelMode(event.target.value);
  container.querySelector("[data-frame-slider]").oninput=event=>{pause();setFrame(+event.target.value);};
  container.querySelector("[data-frame-number]").oninput=container.querySelector("[data-frame-number]").onchange=event=>{pause();setFrame(event.target.valueAsNumber);};
  function starterCode(s,i){return (s.kind==="atom"?"A":"Q")+(projection.starters.slice(0,i+1).filter(t=>t.kind===s.kind).length);}
  function focusNote(){const node=projection.nodes.find(n=>n.id===focusedNode);container.querySelector("[data-focus-note]").textContent=linksHidden?"Edges off. Click a node to inspect its label.":node?short(node.label,12):focusedStarter?"Input matches highlighted":linkMode==="union"?"All supplied results":linkMode==="candidate"?"Selected result links":"Showing "+linkMode+" links";container.querySelector("[data-inspect-focused]").disabled=!node;container.querySelectorAll("[data-toggle-result],[data-toggle-edges]").forEach(b=>{b.setAttribute("aria-pressed",String(!linksHidden));b.textContent=b.hasAttribute("data-toggle-edges")?(linksHidden?"Show edges":"Hide edges"):(linksHidden?"Show result links":"Hide result links");});container.querySelectorAll(".flow-starters-v6 button").forEach((b,i)=>b.setAttribute("aria-pressed",String(projection.starters[i]?.id===focusedStarter)));}
  function focusStarter(s){focusedStarter=focusedStarter===s.id?null:s.id;linksHidden=false;focusedNode=null;graphs.forEach(g=>g.draw());focusNote();renderDocuments();setFrame(frame);}
  function focusNode(id){if(!projection.nodes.some(n=>n.id===id))return false;const mode=container.querySelector("[data-labels]").value,essential=projection.candidates.slice(0,5).some(c=>candidateGraph(projection,c).targets.includes(id)),shown=labelOverrides.has(id)?labelOverrides.get(id):mode==="all"||mode==="key"&&essential;labelOverrides.set(id,!shown);focusedNode=id;focusedStarter=null;graphs.forEach(g=>g.draw());renderNodeReader();focusNote();syncExpandedInfo();return true;}
  function playLabel(){container.querySelectorAll('[data-testid="play-flow-v6"],[data-expanded-play]').forEach(button=>{button.textContent=timer?"Pause":"Play";});}
  function pause(){clearInterval(timer);timer=null;playLabel();}
  function nextFrame(direction){const indices=fullHistory?projection.frames.map((_,i)=>i):history.indices;return direction>0?indices.find(i=>i>frame)??frame:[...indices].reverse().find(i=>i<frame)??frame;}
  function stepFrame(direction){pause();setFrame(nextFrame(direction));}
  function chooseHistory(value){pause();fullHistory=value==="full";container.querySelectorAll("[data-history]").forEach(s=>{s.value=fullHistory?"full":"compact";});historyNote();}
  function historyNote(){
    const note=fullHistory?`Full saved history: all ${projection.frames.length} frames, including the unchanged native final. `:history.omitted?`Compact playback: iterations 0-${history.cutoff}, then saved final ${projection.frames.at(-1).iteration}; ${history.omitted} intermediate frames skipped in playback only. `:"Compact shortcut unavailable: no negligible saved tail established. All saved frames remain in playback. ";
    const basis=history.omitted?`At iteration ${history.cutoff}, every remaining saved frame differs by at most ${fmt(history.maxTailL1)} L1 over all saved projected node weights plus the Other bucket (threshold ${100*history.relativeTolerance}% of total mass). This is projected visual stability, NOT early native convergence. `:"";
    historyDetail.textContent=note+basis+"The slider and exact iteration field always access every saved frame. Final ranking, masses and native stopping are unchanged.";
    container.querySelectorAll("[data-history-note]").forEach(n=>{n.textContent=history.omitted&&!fullHistory?"Compact playback skips a visually stable tail; every saved step remains selectable. Saved final unchanged.":"Every saved step is selectable. Playback does not change the saved result.";});
  }
  function togglePlay(){if(timer){pause();return;}if(frame===projection.frames.length-1)setFrame(0);timer=setInterval(()=>{if(frame>=projection.frames.length-1){pause();return;}setFrame(nextFrame(1));},300);playLabel();}
  function setFrame(value){
    if(disposed||!Number.isFinite(value))return;
    frame=Math.max(0,Math.min(projection.frames.length-1,Math.round(value)));
    const current=projection.frames[frame];sizeStats=frameSizeStats[frame];
    const nativeReference=[...sizeStats.values()].some(s=>s.basis==="active eligible diffusion states");
    for(const note of container.querySelectorAll("[data-size-scope]"))note.textContent=nativeReference?
      "Reference: active eligible diffusion states in the bound native kernel, including zero current masses; not the entire KG.":
      (current.category_reference?"Supplied category reference invalid; ":"Older packet; ")+"using saved-projection category means, including nodes outside this drawing. No full-kernel or entire-KG statistics are claimed.";
    for(const note of container.querySelectorAll(".flow-size-basis-v6"))note.dataset.sizeBasis=nativeReference?"active-eligible-diffusion-states":"saved-projection-category-mean";
    container.querySelectorAll("[data-frame-slider],[data-frame-number],[data-expanded-slider],[data-expanded-number]").forEach(input=>{input.value=frame;});
    graphs.forEach(g=>g.draw());
    const shown=mainGraph.visible().reduce((s,n)=>s+(current.weights[n.mass_index]||0),0);
    container.querySelector("[data-live]").innerHTML=`Iteration <b>${current.iteration}</b> / ${projection.iterations} &nbsp; Shown mass ${fmt(shown)} &nbsp; <span data-testid="other-mass">Other ${fmt(Math.max(0,current.total_mass-shown))}</span> &nbsp; Total ${fmt(current.total_mass)}. Saved larger projection: ${projection.drawing_count} items including query inputs and containers.`;
    container.querySelectorAll("[data-expanded-live]").forEach(live=>{live.textContent=`Iteration ${current.iteration} / ${projection.iterations}. Outside this saved projection: ${fmt(current.other_mass)} mass. Total ${fmt(current.total_mass)}.`;});
    historyNote();renderCandidate();syncExpandedInfo();
  }
  function selectCandidate(id,intent=false){const candidate=projection.candidates.find(c=>c.id===id);if(!candidate)return;const changed=id!==selected;selected=id;documentId=null;if(changed)lastPingId=null;selectedGraph=candidateGraph(projection,candidate);focusedNode=null;focusedStarter=null;if(intent?.focus===true){linkMode="candidate";linksHidden=false;}container.querySelectorAll("[data-links]").forEach(s=>{s.value=linkMode;});graphs.forEach(g=>g.rebuild());renderDocuments();focusNote();setFrame(frame);container.querySelectorAll("[data-candidate-id]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.candidateId===id)));if(intent===true)options.onSelectCandidate?.(candidate);}
  function pingCandidate(id){
    const repeat=lastPingId===id,wasHidden=linksHidden;
    selectCandidate(id,true);const c=projection.candidates.find(c=>c.id===id);if(!c)return;
    lastPingId=id;linksHidden=repeat?!wasHidden:false;focusNote();graphs.forEach(g=>g.draw());
    const endpoints=endpointIds(c),bound=endpoints.length,ids=(c.presentation_target_ids??(bound?endpoints:c.source_contributor_ids||[])).filter(id=>projection.nodes.some(n=>n.id===id&&!n.layout_only));
    flashNodes=new Set(ids);let shown=false;for(const graph of graphs)shown=graph.ping(ids)||shown;
    const shownCount=ids.filter(id=>mainGraph.visible().some(n=>n.id===id)).length;
    container.querySelectorAll("[data-ping-note]").forEach(node=>{node.textContent=`Result rank ${c.rank} / reading ${reading}: ${resultText(c)}. `+(shown?(bound?`Exact saved endpoint(s) highlighted: ${shownCount} of ${ids.length} in compact view.`:c.source_identity_representative?`Identity-context states highlighted: ${shownCount} of ${ids.length}; not native answer endpoints or proof of the queried action. The quote-to-identity handoff is non-numerical.`:`Source-semantic representatives highlighted: ${shownCount} of ${ids.length}; these are not answer identities.`):bound?"The saved endpoint is outside this supplied drawing; no missing-identity claim is inferred.":"No graph target is supplied in this drawing; inspect the result's saved source citations.")+(linksHidden?" Result lines hidden; click again to restore.":" Saved result links visible.");});
    clearTimeout(flashTimer);flashTimer=setTimeout(()=>{flashNodes.clear();graphs.forEach(g=>g.draw());},1800);
  }
  function renderCandidate(){
    const candidate=projection.candidates.find(c=>c.id===selected),graph=selectedGraph,current=projection.frames[frame];
    const visible=new Set(mainGraph.visible().map(n=>n.id)),schema=graph.schema;
    const known=projection.nodes.filter(n=>graph.targets.includes(n.id));
    const targetMass=weights=>graph.targets.length&&known.length===graph.targets.length&&known.every(n=>finiteMass(weights[n.mass_index]))?known.reduce((sum,n)=>sum+weights[n.mass_index],0):null;
    const finalMass=targetMass(projection.frames.at(-1).weights);
    container.querySelector("[data-result-title]").textContent=candidate?`${candidate.rank}. ${resultText(candidate)}`:"No selected saved result";
    const qualified=options.qualifiedAccountSummaryFor?.(candidate),qualification=container.querySelector('[data-result-qualification]');
    qualification.hidden=!qualified;qualification.replaceChildren();
    if(qualified){const label=document.createElement('strong');label.textContent=qualified.label+': ';qualification.append(label,document.createTextNode(qualified.text));}
    container.querySelector("[data-result-mass]").textContent=`${graph.endpoints.length?"Endpoint":candidate?.source_identity_representative?"Identity context, not answer":"Source contributor"} relevance: ${fmt(targetMass(current.weights))}. Not confidence.`;
    container.querySelector("[data-final-metrics]").textContent=`Observed final: ${fmt(finalMass)}. Saved native readout final: ${fmt(candidate?.native_readout?.endpoint_mass)}. These are relevance values, not correctness probabilities.`;
    container.querySelector("[data-representative-note]").textContent=representative(candidate)?.note||"A graph endpoint is not claim-level factual support. All supplied results remain available.";
    const ids=new Set(schema?.graph_node_ids||graph.related),shown=[...ids].filter(id=>visible.has(id)).length;
    const declared=Number.isInteger(schema?.projected_contributor_count)?schema.projected_contributor_count:ids.size;
    const counts=`${mainGraph.visible().length} compact items including true parent containers; ${shown} of ${declared} supplied cone states are explicit here. ${Math.max(0,declared-shown)} are outside the compact drawing, not removed from diffusion. `;
    container.querySelector("[data-contributor-summary]").textContent=`Contributor scope / ${shown} of ${declared} supplied cone states explicit here`;
    const routeIds=new Set((graph.routes[0]?.nodes||[]).map(n=>n.id)),routeShown=[...routeIds].filter(id=>visible.has(id)).length;
    container.querySelector("[data-contributor-counts]").textContent=counts+(schema?.scope||"Fallback: saved routes and drawing edges only; no complete native-cone or incoming-balance claim.")+(routeShown<routeIds.size?` The representative corridor is partial here: ${routeShown} of ${routeIds.size} saved states fit; no complete displayed walk is claimed.`:"")+(graph.missingPairs.size?` ${graph.missingPairs.size} saved link references have no supplied drawing edge and are not invented.`:"")+(Number.isInteger(schema?.drawn_contributor_count)?` Backend drawing count: ${schema.drawn_contributor_count}; backend omitted count: ${schema.omitted_contributor_count??"not supplied"}.`:"");
    const recovery=projection.recovered_drawing;
    container.querySelector("[data-recovery-note]").textContent=recovery?`Drawing omissions restored from the bound native kernel: ${recovery.node_ids?.length??0} nodes and ${recovery.edges?.length??0} edges across the supplied results. This is presentation-only replay, not new inference, new solver mass or reranking. Overlapping complete paths are never added to explain incoming mass.`:"Only supplied saved drawing edges are rendered. Missing drawing links are not synthesized. Complete overlapping paths are not summed as incoming mass.";
    container.querySelectorAll("[data-expanded-result]").forEach(n=>{n.textContent=container.querySelector("[data-result-title]").textContent+". "+container.querySelector("[data-result-mass]").textContent+" "+(candidate?.source_identity_representative?.note||"")+" "+counts;});
    const host=container.querySelector("[data-incoming-balance]");for(const b of host.querySelectorAll("[data-flow-action]"))actions.delete(b.dataset.flowAction);
    const balance=incomingFrame(candidate,current.iteration);host.dataset.status=balance.status;
    if(balance.status!=="supplied"){host.textContent=balance.status==="invalid"?"The supplied incoming balance is inconsistent; no incoming totals or shares are asserted. Inspect the saved record.":"No exact per-iteration incoming balance was supplied. Saved route overlap or cumulative influence is not substituted for incoming mass.";return;}
    const f=balance.frame,number=x=>`<span title="${esc(fmt(x))}">${esc(fmt(x))}</span>`;
    host.innerHTML=`<p>${candidate?.source_identity_representative?"Existing identity-context state balance, not native answer or source-readout mass:":current.iteration===0?"Initial endpoint relevance (prior), with no transported flow into iteration 0:":"Supplied endpoint balance for this iteration:"} ${number(f.endpoint_mass)} = restart ${number(f.restart_mass)} + incoming ${number(f.incoming_mass)}.</p><p>Listed incoming ${number(f.shown_incoming_mass)}; other native incoming ${number(f.remainder_incoming_mass)}. These are one-step amounts, not cumulative or independent path shares.</p><ul class="flow-incoming-list-v64">${[...f.contributions].sort((a,b)=>b.mass-a.mass||a.source.localeCompare(b.source)).map(part=>{
      const node=projection.nodes.find(n=>n.id===part.source),shownHere=visible.has(part.source)&&visible.has(part.target);
      const text=node?.label||part.source,share=f.incoming_mass>0?(100*part.mass/f.incoming_mass).toFixed(1)+"% of incoming":"share undefined (zero incoming)";
      return `<li data-incoming-source="${esc(part.source)}">${node?action(short(text,8),()=>{focusNode(node.id);options.onNode?.(node);},`title="${esc(text)} / ${esc(part.source)}"`):esc(text)}<span>${esc(part.kind)} / ${number(part.mass)} / ${esc(share)}${shownHere?" / explicit in compact drawing":" / outside compact drawing"}</span></li>`;
    }).join("")}</ul>`;
  }
  function documentRecord(id){const grouped=candidateSources(projection,projection.candidates.find(c=>c.id===selected));return [...grouped.selected,...grouped.lexical,...grouped.other].find(d=>d.id===id);}
  function selectDocument(id){if(!documentRecord(id))return;documentId=id;graphs.forEach(g=>g.draw());renderDocuments();}
  function renderNodeReader(){
    const node=projection.nodes.find(n=>n.id===(focusedNode||selectedGraph.targets[0])),host=container.querySelector("[data-node-reader]");
    if(!host)return;
    for(const button of host.querySelectorAll("[data-flow-action]"))actions.delete(button.dataset.flowAction);
    const targets=[...new Set(projection.candidates.slice(0,5).flatMap(c=>candidateGraph(projection,c).targets))].map(id=>projection.nodes.find(n=>n.id===id)).filter(Boolean);
    host.innerHTML=`<h5>Full node text</h5><p data-node-full-text>${node?esc(node.label):"No numerical representative is supplied. Inspect the saved source readout."}</p>${node?`<small>${esc(node.type)} / extracted label, not a verified quotation or a support verdict</small>`:""}<details><summary>Read another result's node label</summary>${targets.map(n=>action(compactNodeLabel(n.label),()=>focusNode(n.id),`title="${esc(n.label)}" aria-label="Read full node text: ${esc(n.label)}"`)).join("")}</details>`;
  }
  function renderDocuments(){
    renderNodeReader();
    const host=container.querySelector("[data-documents]"),opened=new Set([...host.querySelectorAll("details[open]")].map(n=>n.dataset.sourceSection));
    const candidate=projection.candidates.find(c=>c.id===selected),grouped=candidateSources(projection,candidate);
    for(const button of host.querySelectorAll("[data-flow-action]"))actions.delete(button.dataset.flowAction);
    const card=doc=>{const counts=documentMembership(doc,mainGraph.visible());return `<article data-document-id="${esc(doc.id)}"><b>${esc(doc.summary||doc.title||doc.id)}</b><small>${esc(doc.id)} / ${esc(doc.date)}</small><p>${doc.membership_unavailable?"No saved document-member mapping supplied":`${counts.shown} source-owned nodes shown now / ${counts.projected} in saved projection / ${counts.eligible??"unknown"} eligible in source`}</p><p>${doc.lexical_rank?`Direct text retrieval (BM25/RRF) / lexical rank ${esc(doc.lexical_rank)}`:doc.lexical_only?"Quote-only source readout / no lexical rank supplied":"Source provenance / no lexical rank supplied"}</p><div>${action("Highlight source nodes",()=>selectDocument(doc.id),`aria-pressed="${documentId===doc.id}" title="Provenance only, not a document activation or support judgment"`)}${action("Inspect source",()=>options.onSource?.(doc.source))}</div></article>`;};
    const section=(key,title,docs)=>docs.length?`<details class="flow-source-section-v64" data-source-section="${key}" ${opened.has(key)?"open":""}><summary>${esc(title)} (${docs.length})</summary><p>Additional saved readouts, not evidence added to the selected result.</p>${docs.map(card).join("")}</details>`:"";
    host.innerHTML=`<section data-selected-sources><h5>Selected result citations (${grouped.selected.length})</h5>${grouped.selected.length?grouped.selected.map(card).join(""):"<p>No source citation was supplied for this result.</p>"}</section>`+section("lexical","Other lexical sources",grouped.lexical)+section("global","Other global projection readouts",grouped.other);
    const identity=identityProofs(candidate);
    if(identity.length){const context=document.createElement("section");context.dataset.identitySources="";context.innerHTML=`<h5>Identity-only context sources (${identity.length})</h5><p>Other-page full-name provenance, not native inspected construction evidence, an original-page owned mention or support for the queried action.</p>${identity.map(p=>`<article>${action(p.document_id+" / "+p.date,()=>options.onSource?.(p))}<p>${esc(p.text)}</p></article>`).join("")}`;host.querySelector("[data-selected-sources]").after(context);}
    container.querySelector("[data-document-result]").textContent=candidate?`Saved rank ${candidate.rank}${projection.reading_id?" / reading "+reading:""}: ${resultText(candidate)}`:"No selected result";
    const doc=documentRecord(documentId),counts=doc&&documentMembership(doc,mainGraph.visible());
    container.querySelector("[data-document-selection]").textContent=doc?doc.membership_unavailable?`${doc.title||doc.id}: source citation only; no saved node-membership count is supplied.`:`${doc.title||doc.id}: ${counts.shown} of ${counts.projected} source-owned projected nodes highlighted here. ${counts.shown?"Provenance, not support or document mass.":"No mapped source nodes are in the current compact view; inspect the source or larger hierarchy."}`:"";
    syncExpandedInfo();
  }
  function makeGraph(canvas,limit){
    let width=0,height=0,layout=null,backbone=null,nodes=[],idMap=new Map(),scale=1,offset={x:0,y:0},drag=null,keyboard=0,starterPositions=new Map(),drawnEdges=[],labelSpacing=new Map(),nestedCounts=new Map(),nodeSizes=new Map(),sizeFit=null;
    const isLeaf=n=>!["domain","theme","community"].includes(n.type.toLowerCase());
    const context=canvas.getContext("2d"),host=canvas.parentElement,tooltip=host.querySelector(".flow-tooltip-v6");
    const callouts=document.createElement("div");callouts.className="flow-node-labels-v65";host.append(callouts);
    const point=id=>layout.positions.get(id);
    const screen=p=>({x:p.x*scale+offset.x,y:p.y*scale+offset.y});
    function label(text,x,y,{maxWidth=148,bold=false,background=true}={}){
      context.save();context.font=(bold?"bold ":"")+"11px Georgia";context.translate(x,y);context.scale(1/scale,1/scale);
      let clipped=String(text);while(clipped.length&&context.measureText(clipped).width>maxWidth-10)clipped=clipped.slice(0,-1);
      if(clipped!==String(text))clipped=clipped.slice(0,-3)+"...";
      const measured=Math.min(maxWidth,context.measureText(clipped).width+8);
      context.beginPath();context.rect(-measured/2,-12,measured,17);context.clip();
      if(background){context.fillStyle="#fffef1ed";context.fillRect(-measured/2,-12,measured,17);}
      context.fillStyle="#214552";context.fillText(clipped,-context.measureText(clipped).width/2,0);context.restore();
    }
    function rebuild(){const next=overviewNodes(projection,limit,selected,selectedGraph);if(sizeFit===null||next.length!==nodes.length||next.some((node,i)=>node.id!==nodes[i].id))sizeFit=categoryFitScale(projection,next,frameSizeStats);nodes=next;idMap=new Map(nodes.map(n=>[n.id,n]));backbone=traceBackbone(projection,nodes);resize();}
    function resize(){
      const rect=canvas.getBoundingClientRect();width=Math.max(260,rect.width);height=Math.max(280,rect.height);
      const ratio=window.devicePixelRatio||1;canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);context.setTransform(ratio,0,0,ratio,0,0);
      const columns=Math.max(1,projection.starters.length),top=projection.starters.length?58:14;
      starterPositions=new Map(projection.starters.map((s,i)=>[s.id,{x:(i+.5)*width/columns,y:12,w:Math.max(32,Math.min(146,width/columns-8)),h:30}]));
      layout=nestedLayout(nodes,width,height-top);for(const p of layout.positions.values())p.y+=top;for(const region of layout.regions)region.y+=top;
      nestedCounts=new Map();const all=new Map(projection.nodes.map(n=>[n.id,n]));
      for(const id of selectedGraph.schema?.graph_node_ids||[]){if(idMap.has(id))continue;const seen=new Set();let at=all.get(id)?.parent_id;while(at&&!seen.has(at)){seen.add(at);if(idMap.has(at))nestedCounts.set(at,(nestedCounts.get(at)||0)+1);at=all.get(at)?.parent_id;}}
      labelSpacing=new Map();const leaves=nodes.filter(isLeaf);
      for(const node of leaves){const p=point(node.id);let gap=Infinity;for(const other of leaves){if(other.id===node.id)continue;const q=point(other.id);if(p&&q&&Math.abs(q.y-p.y)<28&&Math.abs(q.x-p.x)>1)gap=Math.min(gap,Math.abs(q.x-p.x));}labelSpacing.set(node.id,gap);}
      draw();
    }
    function draw(){
      if(disposed||!layout)return;
      context.clearRect(0,0,width,height);context.save();context.beginPath();context.rect(0,0,width,height);context.clip();
      context.translate(offset.x,offset.y);context.scale(scale,scale);
      const current=projection.frames[frame],prior=projection.frames[Math.max(0,frame-1)],masses=current.weights;
      nodeSizes=new Map(nodes.map(node=>[node.id,relativeNodeSize(node,current,sizeStats,sizeFit)]));
      const candidate=projection.candidates.find(c=>c.id===selected),highlighted=selectedGraph.pairs,resultGraphs=projection.candidates.slice(0,5).map(c=>candidateGraph(projection,c)),endpoints=new Set(resultGraphs.flatMap(g=>g.endpoints)),coMentioned=new Set(resultGraphs.flatMap(g=>g.targets.filter(id=>!g.endpoints.includes(id))));
      const docNodes=new Set(documentRecord(documentId)?.visible_node_ids||[]),mode=container.querySelector("[data-labels]").value;
      let labels=new Set([...endpoints,...coMentioned]);
      if(mode==="all")labels=new Set(nodes.map(n=>n.id));else if(mode==="none")labels.clear();
      for(const [id,shown]of labelOverrides){if(shown)labels.add(id);else labels.delete(id);}
      for(const region of layout.regions){
        context.fillStyle=["#edf3edb8","#f8eee4a8","#eef5f9b8"][region.depth%3];context.strokeStyle=region.depth===0?"#91aab1":"#b7c9c9";context.lineWidth=1/scale;
        context.fillRect(region.x,region.y,region.w,region.h);context.strokeRect(region.x,region.y,region.w,region.h);
        if(mode==="all"&&region.w*scale>82&&region.h*scale>40)label(region.label,region.x+region.w/2,region.y+Math.min(region.header-3,19),{maxWidth:Math.min(148,region.w*scale-12),bold:region.depth===0,background:false});
      }
      const candidateMode=linkMode==="candidate",unionMode=linkMode==="union";
      const showTransport=!linksHidden&&linkMode!=="hierarchy";
      const selectedPairs=selectedGraph.pairs;
      const eligibleRows=projection.edges.map((edge,i)=>({edge,mass:current.edge_mass?.[i]||0})).filter(row=>(row.mass>0||frame===0)&&idMap.has(row.edge.source)&&idMap.has(row.edge.target)).sort((a,b)=>b.mass-a.mass);
      const edgeRows=!showTransport?[]:eligibleRows.filter(row=>(row.edge.source!==row.edge.target||linkMode==="all")&&(!unionMode||backbone.pairs.has(pairKey(row.edge)))&&(!candidateMode||selectedPairs.has(pairKey(row.edge)))&&(linkMode!=="source"||row.edge.kind==="SOURCE"));
      const shownEdges=edgeRows,edgeMax=eligibleRows[0]?.mass||1;drawnEdges=[];
      for(const {edge,mass} of shownEdges){
        const a=point(edge.source),b=point(edge.target);if(!a||!b)continue;
        const marked=backbone.important.has(pairKey(edge)),citations=edgeProofs(projection,edge),style=edgeStyle(edge,citations);
        context.globalAlpha=mass>0?(marked?.8:.16+.24*Math.sqrt(mass/edgeMax)):(marked?.55:.24);
        context.strokeStyle=style.color;
        context.lineWidth=(1+2.5*Math.sqrt(mass/edgeMax))/scale;context.setLineDash(style.dash.map(value=>value/scale));
        if(edge.source===edge.target){const loop={x:a.x+14/scale,y:a.y-14/scale,r:14/scale};context.beginPath();context.arc(loop.x,loop.y,loop.r,0,Math.PI*2);context.stroke();drawnEdges.push({edge:{...edge,citations},a,b,mid:loop,loop,mass});continue;}
        const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,bend=Math.min(55,d*.14)*(edge.source<edge.target?1:-1);
        const mid={x:(a.x+b.x)/2-dy/d*bend,y:(a.y+b.y)/2+dx/d*bend};
        context.beginPath();context.moveTo(a.x,a.y);context.quadraticCurveTo(mid.x,mid.y,b.x,b.y);context.stroke();
        if((candidateMode||unionMode)&&marked){const t=.8,x=(1-t)**2*a.x+2*(1-t)*t*mid.x+t*t*b.x,y=(1-t)**2*a.y+2*(1-t)*t*mid.y+t*t*b.y,angle=Math.atan2((1-t)*(mid.y-a.y)+t*(b.y-mid.y),(1-t)*(mid.x-a.x)+t*(b.x-mid.x));context.save();context.setLineDash([]);context.fillStyle=style.color;context.beginPath();context.moveTo(x,y);context.lineTo(x-6/scale*Math.cos(angle-.5),y-6/scale*Math.sin(angle-.5));context.lineTo(x-6/scale*Math.cos(angle+.5),y-6/scale*Math.sin(angle+.5));context.closePath();context.fill();context.restore();}
        drawnEdges.push({edge:{...edge,citations},a,mid,b,mass});
      }
      context.globalAlpha=1;context.setLineDash([]);
      let restartEdgeCount=0,restartAvailable=0;const restartPairs=[],restartMasses=[];
      for(const starter of projection.starters){
        const p=starterPositions.get(starter.id);if(!p)continue;
        const allTargets=[...(starter.targets||[])].filter(t=>Number.isFinite(t.mass)&&t.mass>0&&idMap.has(t.id));restartAvailable+=allTargets.length;
        const targets=linksHidden||linkMode==="hierarchy"?[]:allTargets.filter(t=>(!candidateMode||selectedGraph.starters.has(starter.id)&&selectedGraph.related.has(t.id))&&(focusedStarter?focusedStarter===starter.id:linkMode==="all"||backbone.restartTargets.get(starter.id).has(t.id))).sort((a,b)=>b.mass-a.mass||a.id.localeCompare(b.id));
        for(const target of targets){const b=point(target.id);if(!b)continue;restartEdgeCount++;restartPairs.push([starter.id,target.id]);restartMasses.push(target.mass);context.globalAlpha=focusedStarter===starter.id ? .65 : .16;context.strokeStyle="#7797b5";context.lineWidth=(focusedStarter===starter.id?1.2:.7)/scale;context.setLineDash([3/scale,5/scale]);context.beginPath();context.moveTo(p.x,p.y+p.h/scale);context.bezierCurveTo(p.x,p.y+55/scale,b.x,b.y-35/scale,b.x,b.y);context.stroke();}
        context.globalAlpha=1;
        context.setLineDash([]);context.fillStyle=starter.kind==="context"?"#ede6d5":"#e0edf8";context.strokeStyle=focusedStarter===starter.id?"#235d76":"#80a1b7";
        context.fillRect(p.x-p.w/2/scale,p.y,p.w/scale,p.h/scale);context.strokeRect(p.x-p.w/2/scale,p.y,p.w/scale,p.h/scale);
        label(starterCode(starter,projection.starters.indexOf(starter)),p.x,p.y+20/scale,{maxWidth:p.w-6,background:false});
      }
      for(const node of nodes){
        const p=point(node.id);if(!p)continue;const mass=masses[node.mass_index],previous=prior.weights[node.mass_index],r=nodeSizes.get(node.id).radius,change=frame?percentChange(mass,previous):null;
        const labelWidth=Math.max(22,Math.min(148,(labelSpacing.get(node.id)??Infinity)*scale-8));
        context.beginPath();context.arc(p.x,p.y,r,0,Math.PI*2);context.fillStyle=node.layout_only||mass===0?"#ffffff":changeColor(change);context.fill();context.strokeStyle=kindColor(node);context.lineWidth=(mass===0?.5:1.3)/scale;context.stroke();
        if(endpoints.has(node.id)||coMentioned.has(node.id)||docNodes.has(node.id)||flashNodes.has(node.id)){
          context.beginPath();context.arc(p.x,p.y,r+5/scale,0,Math.PI*2);context.setLineDash(coMentioned.has(node.id)&&!endpoints.has(node.id)?[3/scale,3/scale]:[]);context.strokeStyle=flashNodes.has(node.id)?"#dd702e":docNodes.has(node.id)?"#1c6dae":taskTone(node);context.lineWidth=(flashNodes.has(node.id)?4:2.3)/scale;context.stroke();context.setLineDash([]);
        }
      }
      if(mode!=="none")for(const region of layout.regions)if(region.w*scale>110&&region.h*scale>55)label(short(region.label,6),region.x+region.w/2,region.y+Math.min(region.header-3,18),{maxWidth:Math.min(180,region.w*scale-12),bold:region.depth===0});
      context.restore();
      callouts.replaceChildren();
      const labelRects=[];
      for(const node of nodes.filter(n=>labels.has(n.id))){const p=screen(point(node.id));if(p.x<0||p.y<0||p.x>width||p.y>height)continue;
        const bubble=document.createElement("div");bubble.className="flow-node-box-v65";bubble.dataset.labelNode=node.id; bubble.title=node.label;
        const name=document.createElement("span");name.textContent=compactNodeLabel(node.label);bubble.setAttribute("aria-label",node.label);bubble.append(name);callouts.append(bubble);
        const w=Math.min(184,width-20);bubble.style.width=w+"px";const h=bubble.getBoundingClientRect().height;
        const clamp=(x,y)=>({x:Math.max(8,Math.min(width-w-8,x)),y:Math.max(8,Math.min(height-h-8,y))});
        const gap=nodeSizes.get(node.id).radius*scale+6;
        const positions=[clamp(p.x-w/2,p.y+gap),clamp(p.x-w/2,p.y-h-gap),clamp(p.x+gap,p.y-h/2),clamp(p.x-w-gap,p.y-h/2),clamp(p.x-w/2,p.y-h-gap-48),clamp(p.x-w/2,p.y+gap+48)];
        const overlap=pos=>labelRects.reduce((sum,r)=>sum+Math.max(0,Math.min(pos.x+w+4,r.x+r.w)-Math.max(pos.x-4,r.x))*Math.max(0,Math.min(pos.y+h+4,r.y+r.h)-Math.max(pos.y-4,r.y)),0);
        const pos=positions.sort((a,b)=>overlap(a)-overlap(b))[0];labelRects.push({...pos,w,h});bubble.style.left=pos.x+"px";bubble.style.top=pos.y+"px";
      }
      Object.assign(canvas.dataset,{visibleEdgeCount:String(drawnEdges.length),edgePairs:JSON.stringify(drawnEdges.map(r=>[r.edge.source,r.edge.target])),edgeMasses:JSON.stringify(drawnEdges.map(r=>r.mass)),denseEdgeCount:String(eligibleRows.length),recoveredEdgeCount:String(drawnEdges.filter(r=>r.edge.recovered_from_native_kernel).length),restartEdgeCount:String(restartEdgeCount),restartAvailableCount:String(restartAvailable),restartPairs:JSON.stringify(restartPairs),restartMasses:JSON.stringify(restartMasses),edgeKinds:drawnEdges.map(r=>r.edge.kind).join(","),visibleNodeIds:nodes.map(n=>n.id).join(","),nodePositions:JSON.stringify(Object.fromEntries(nodes.map(n=>[n.id,screen(point(n.id))]))),labelNodeIds:[...labels].filter(id=>idMap.has(id)).join(","),endpointLabels:JSON.stringify(nodes.filter(n=>endpoints.has(n.id)).map(n=>[n.id,n.label])),coMentionedNodes:nodes.filter(n=>coMentioned.has(n.id)&&!endpoints.has(n.id)).map(n=>n.id).join(","),highlightedNodes:[...docNodes].filter(id=>idMap.has(id)).join(","),starterRows:projection.starters.length?"1":"0",focusNode:focusedNode||"",focusStarter:focusedStarter||"",selectedCandidate:selected||"",linkMode,linksHidden:String(linksHidden),iteration:String(current.iteration),nodeCount:String(nodes.length),nested:"true",zoom:String(scale),offsetX:String(offset.x),offsetY:String(offset.y),maxLabelWidth:"148",labelFontPx:"11",pingTargets:[...flashNodes].filter(id=>idMap.has(id)).join(",")});
      Object.assign(canvas.dataset,{sizeBasis:[...sizeStats.values()].some(s=>s.basis==="active eligible diffusion states")?"active-eligible-diffusion-states":"saved-projection-category-mean",categoryStats:JSON.stringify(Object.fromEntries(sizeStats)),nodeRadii:JSON.stringify(Object.fromEntries([...nodeSizes].map(([id,size])=>[id,size.radius])))});
      Object.assign(canvas.dataset,{sizeScale:'fixed-category-fit/all-saved-frames',categoryFit:JSON.stringify(Object.fromEntries(sizeFit))});
      canvas.dataset.nativeSnapshotSha256=projection.native_snapshot_sha256||"";
      canvas.dataset.sourceCaseSha256=projection.source_case_sha256||"";
      const summary=limit===overviewLimit?container.querySelector("[data-drawing-policy]"):canvas.closest("dialog")?.querySelector("[data-expanded-policy]");
      if(summary)summary.textContent=`${fmt(nodes.length)} supplied nodes. ${linksHidden?"Edges off":fmt(drawnEdges.length)+" visible links"}.${frame===0?" Initial topology; no transported mass yet.":""}`;
    }
    function hit(event){
      const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left-offset.x)/scale,y=(event.clientY-rect.top-offset.y)/scale;
      for(const starter of projection.starters){const p=starterPositions.get(starter.id);if(p&&Math.abs(x-p.x)<p.w/2/scale&&y>=p.y&&y<=p.y+p.h/scale)return{...starter,type:"query",restart_input:true};}
      let nearest=null,best=Infinity;for(const node of nodes){const p=point(node.id);if(!p)continue;const d=Math.hypot(x-p.x,y-p.y);if(d<Math.max(12/scale,nodeSizes.get(node.id).radius)&&d<best){nearest=node;best=d;}}
      if(nearest)return nearest;
      for(const row of drawnEdges){if(row.loop){if(Math.abs(Math.hypot(x-row.loop.x,y-row.loop.y)-row.loop.r)<7/scale)return{type:"edge",...row};continue;}for(let i=2;i<19;i++){const t=i/20,px=(1-t)**2*row.a.x+2*(1-t)*t*row.mid.x+t*t*row.b.x,py=(1-t)**2*row.a.y+2*(1-t)*t*row.mid.y+t*t*row.b.y;if(Math.hypot(x-px,y-py)<7/scale)return{type:"edge",...row};}}
      return null;
    }
    function showTip(item,event){
      if(!tooltip)return;if(!item){tooltip.hidden=true;return;}
      const value=projection.frames[frame].weights[item.mass_index];
      const role=selectedGraph.endpoints.includes(item.id)?"\nExact saved endpoint / result rank "+projection.candidates.find(c=>c.id===selected)?.rank+" in this reading":projection.candidates.find(c=>c.id===selected)?.source_contributor_ids?.includes(item.id)?"\nSource readout contributor, not an answer identity":"";
      tooltip.textContent=item.type==="edge"?edgeStyle(item.edge,item.edge.citations).label+"\nSaved transported mass at this iteration: "+scientificMass(item.mass)+(item.mass===0?" / topology only; no transported flow":"")+(item.edge.recovered_from_native_kernel?"\nRestored from the bound native kernel, not new inference":"")+"\nClick for saved provenance":item.restart_input?item.label+"\nQuery restart input, not a historical state. No solver mass; excluded from numerical category means.":item.label+"\n"+item.type+role+"\n"+sizeDescription(nodeSizes.get(item.id))+(item.layout_only?"":"\n"+changeDescription(value,projection.frames[Math.max(0,frame-1)].weights[item.mass_index],frame===0));
      tooltip.hidden=false;tooltip.style.left=Math.max(8,Math.min(width-tooltip.offsetWidth-8,event.clientX-canvas.getBoundingClientRect().left+12))+"px";tooltip.style.top=Math.max(8,Math.min(height-tooltip.offsetHeight-8,event.clientY-canvas.getBoundingClientRect().top+10))+"px";
    }
    canvas.onpointerdown=event=>{pause();drag={x:event.clientX,y:event.clientY,startX:offset.x,startY:offset.y,moved:false};canvas.setPointerCapture(event.pointerId);};
    canvas.onpointermove=event=>{if(drag){const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>4)drag.moved=true;offset={x:drag.startX+dx,y:drag.startY+dy};draw();}else showTip(hit(event),event);};
    canvas.onpointerup=event=>{const clicked=drag&&!drag.moved;drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(!clicked)return;const item=hit(event);if(item?.restart_input)focusStarter(item);else if(item?.type==="edge")options.onEdge?.(item.edge);else if(item)focusNode(item.id);};
    canvas.onpointercancel=()=>{drag=null;};canvas.onpointerleave=()=>{if(tooltip)tooltip.hidden=true;};
    function zoom(next,x=width/2,y=height/2){next=Math.max(.5,Math.min(7,next));offset={x:x-(x-offset.x)*next/scale,y:y-(y-offset.y)*next/scale};scale=next;draw();}
    canvas.onwheel=event=>{event.preventDefault();const rect=canvas.getBoundingClientRect();zoom(scale*Math.exp(-event.deltaY*.001),event.clientX-rect.left,event.clientY-rect.top);};
    canvas.onkeydown=event=>{
      if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)&&nodes.length){event.preventDefault();keyboard=(keyboard+nodes.length+(event.key==="ArrowLeft"||event.key==="ArrowUp"?-1:1))%nodes.length;const node=nodes[keyboard];canvas.setAttribute("aria-label",node.label+". "+sizeDescription(nodeSizes.get(node.id))+". "+(node.layout_only?"":changeDescription(projection.frames[frame].weights[node.mass_index],projection.frames[Math.max(0,frame-1)].weights[node.mass_index],frame===0))+". Space toggles its name box; Enter inspects.");}
      else if(event.key===" "&&nodes[keyboard]){event.preventDefault();focusNode(nodes[keyboard].id);}
      else if(event.key==="Enter"&&nodes[keyboard]){event.preventDefault();options.onNode?.(nodes[keyboard]);}
      else if(["+","=","-","_"].includes(event.key)){event.preventDefault();zoom(scale*(["+","="].includes(event.key)?1.2:1/1.2));}
      else if(event.key==="Home"){event.preventDefault();scale=1;offset={x:0,y:0};draw();}
    };
    const observer=new ResizeObserver(()=>{if(!disposed)resize();});observer.observe(canvas);rebuild();
    return {rebuild,draw,visible:()=>nodes,fit(){scale=1;offset={x:0,y:0};draw();},
      ping(ids){const id=ids.find(id=>point(id)),p=id&&point(id);if(!p)return false;const s=screen(p);
        if(s.x<50||s.x>width-50||s.y<60||s.y>height-50)offset={x:width/2-p.x*scale,y:height/2-p.y*scale};draw();return true;},
      destroy(){observer.disconnect();callouts.remove();canvas.onwheel=null;canvas.onpointerdown=null;canvas.onpointermove=null;canvas.onpointerup=null;canvas.onpointercancel=null;canvas.onpointerleave=null;canvas.onkeydown=null;}};
  }
  function openExpanded(){
    if(options.onExpand){pause();options.onExpand();return;}
    pause();const dialog=document.createElement("dialog");dialog.className="flow-expanded-v6 flow-v6";
    const expandedLimit=Math.min(2048,projection.nodes.length);
    dialog.innerHTML=`<header><strong>Larger source graph / up to ${fmt(expandedLimit)} supplied items</strong>${action("Fit",()=>graphs.forEach(g=>g.fit()))}${action("How to read this graph",inspect)}<button type="button" data-close>Close</button></header><div class="flow-expanded-grid-v70"><section class="flow-expanded-main-v70"><p class="flow-drawing-policy-v65" data-expanded-policy></p><div class="flow-scroll-v6"><canvas class="flow-canvas-v6" tabindex="0" aria-label="Expanded hierarchical diffusion" data-testid="expanded-hierarchy-flow-v6"></canvas><div class="flow-tooltip-v6" hidden></div></div><div class="flow-timeline-v6"><div class="flow-timeline-row-v6"><input data-expanded-slider type="range" min="0" max="${projection.frames.length-1}" value="${frame}" step="1" aria-label="Expanded diffusion iteration"></div><div class="flow-history-v63">${action("Play",togglePlay,'data-expanded-play')}<label>Iteration <input data-expanded-number type="number" min="0" max="${projection.frames.length-1}" value="${frame}" step="1" aria-label="Exact expanded diffusion iteration"></label><label>Playback <select data-history aria-label="Expanded saved iteration playback"><option value="compact">Compact</option><option value="full">Every saved step</option></select></label>${action("Saved final",()=>{pause();setFrame(projection.frames.length-1);})}</div><p class="flow-note-v6" data-expanded-live aria-live="polite"></p><p class="flow-note-v6" data-history-note></p></div></section><aside class="flow-expanded-info-v70" data-expanded-info aria-label="Selected result and sources"></aside></div>`;
    const linkControl=container.querySelector("[data-links]").parentElement.cloneNode(true);linkControl.querySelector("select").setAttribute("aria-label","Expanded displayed flow link kinds");linkControl.querySelector("select").value=linkMode;linkControl.querySelector("select").onchange=event=>chooseLinks(event.target.value);dialog.querySelector("header [data-close]").before(linkControl);
    dialog.querySelector("header [data-close]").before(container.querySelector("[data-global-label-toggle]").cloneNode(true));
    dialog.querySelector("header [data-close]").before(container.querySelector("[data-toggle-edges]").cloneNode(true));
    const legend=document.createElement("div");legend.className="flow-legend-v6";legend.append(areaLegend.cloneNode(true));const legendNote=document.createElement("span");legendNote.textContent="Category fit is fixed across saved frames. Hover for actual mass and mean.";legend.append(legendNote);dialog.querySelector("[data-expanded-policy]").after(legend);
    container.append(dialog);dialog.showModal();syncLabelControls();const graph=makeGraph(dialog.querySelector("canvas"),2048);graphs.push(graph);
    dialog.querySelector("[data-history]").value=fullHistory?"full":"compact";dialog.querySelector("[data-history]").onchange=event=>chooseHistory(event.target.value);
    for(const input of dialog.querySelectorAll("[data-expanded-slider],[data-expanded-number]"))input.addEventListener("input",event=>{pause();setFrame(event.target.valueAsNumber);});
    dialog.querySelector("[data-close]").onclick=()=>dialog.close();dialog.addEventListener("close",()=>{pause();graph.destroy();const i=graphs.indexOf(graph);if(i>=0)graphs.splice(i,1);dialog.remove();},{once:true});setFrame(frame);
  }
  function syncExpandedInfo(){
    for(const host of container.querySelectorAll("[data-expanded-info]")){
      const scroll=host.scrollTop;
      host.replaceChildren(pings.cloneNode(true),resultPanel.cloneNode(true),container.querySelector(".flow-documents-v6").cloneNode(true),container.querySelector(".flow-legend-v6").cloneNode(true));
      host.scrollTop=scroll;
    }
  }
  renderDocuments();focusNote();setFrame(0);
  return{selectCandidate,selectDocument,focusNode,pingCandidate,openExpanded,destroy(){disposed=true;pause();clearTimeout(flashTimer);graphs.forEach(g=>g.destroy());for(const dialog of container.querySelectorAll("dialog")){dialog.close();dialog.remove();}container.removeEventListener("click",onClick);container.replaceChildren();}};
}

export function routesFor(candidate) {
  const seen=new Set(),rows=[];
  const add=route=>{
    const key=JSON.stringify([route.route_kind??null,(route.nodes||[]).map(n=>n.id)]);
    if(seen.has(key))return false;
    seen.add(key);rows.push(route);return true;
  };
  for(const route of candidate?.represented_routes??candidate?.routes??[]){if(add(route)&&rows.length===3)break;}
  return rows;
}

export function walkLabel(metrics) {
  if(!metrics||!["EXACT_FINITE_WALK_COMPONENT","EXACT_SELECTED_DISJOINT_COMPONENT_SUM"].includes(metrics.status))return "Exact walk share unavailable / "+(metrics?.reason||"not supplied");
  const mass=Number.isFinite(metrics.component_mass)?fmt(metrics.component_mass):"not supplied";
  return `Complete finite-walk component mass ${mass}; share of actual endpoint mass: ${Number.isFinite(metrics.endpoint_percent)?fmt(metrics.endpoint_percent)+"%":"unavailable (no positive denominator)"}. Not correctness probability.`;
}

export function routeInputs(projection,route) {
  const first=route.nodes?.[0]?.id;
  if(!first)return [];
  return (projection.starters||[]).filter(starter=>
    (route.route_kind!=="DISPLAYED_INFLUENCE_CORRIDOR"||starter.id===route.starter_id)&&
    (starter.targets||[]).some(target=>target.id===first&&Number.isFinite(target.mass)&&target.mass>0));
}

export function mountPaths(container, options) {
  const projection=options.projection;let selected=projection?.candidates?.[0]?.id||null;
  const resultText=item=>formatTargetText(item,projection?.task||options.task);
  container.replaceChildren();container.classList.add("flow-paths-v6");
  const select=document.createElement("select");select.setAttribute("aria-label","Trace a saved proposal or evidence target");
  for(const candidate of projection?.candidates||[]){const option=document.createElement("option");option.value=candidate.id;option.textContent=candidate.rank+". "+resultText(candidate);select.append(option);}
  const bar=document.createElement("div");bar.className="flow-path-toolbar-v6";
  const label=document.createElement("label");label.textContent="Trace a result ";label.append(select);bar.append(label);
  const host=document.createElement("div");host.className="flow-path-list-v6";container.append(bar,host);
  function button(text,callback,className="") {const b=document.createElement("button");b.type="button";b.textContent=text;b.className=className;b.onclick=callback;return b;}
  function paragraph(text,kind="") {const p=document.createElement("p");p.textContent=text;p.className=kind;return p;}
  function column(title){const col=document.createElement("section");col.className="flow-path-column-v6";const h=document.createElement("h4");h.textContent=title;col.append(h);return col;}
  function render(){
    host.replaceChildren();const candidate=projection?.candidates?.find(c=>c.id===selected);
    if(!candidate){host.append(paragraph("No source-bound result target was recorded. No path is invented."));return;}
    const routes=routesFor(candidate);
    host.append(paragraph(resultText(candidate),"flow-path-heading-v6"));
    if(candidate.source_identity_representative){host.append(paragraph(candidate.source_identity_representative.note));const context=column("Identity-only context / not native construction evidence");for(const proof of identityProofs(candidate))context.append(button(proof.document_id+" / "+proof.date,()=>options.onSource?.(proof)),paragraph(proof.text));host.append(context);}
    host.append(paragraph(candidate.binding==="source_page_readout"?"The final step is a source readout, not an invented answer node or transported edge.":"Routes end at the actual saved graph state for the proposal or evidence."));
    const pathAudit=document.createElement("div");pathAudit.append(paragraph(walkLabel(candidate.selected_walk_metrics),"flow-route-metrics-v6"));
    const diversity=candidate.diversity;
    if(diversity){
      pathAudit.append(paragraph(`Saved route selection: ${diversity.selected_count??routes.length} representatives. Bounded search, not exhaustive; shared edges or communities do not imply independent explanations.`));
      for(const overlap of diversity.pairwise_overlap||[])pathAudit.append(paragraph(`Routes ${overlap.left+1} and ${overlap.right+1}: ${overlap.shared_edge_count??overlap.shared_edges?.length??"unreported"} shared edges. No independent-explanation credit is assigned.`));
    }
    host.append(button("How these paths are shown",()=>inspectPresentation(container,options,"Path scope and independence",pathAudit.cloneNode(true))));
    if(!routes.length){host.append(paragraph("No representative route was saved for this result. Its quotations may still be inspected below. Missing evidence is not opposition."));}
    for(const[routeIndex,route]of routes.entries()){
      const card=document.createElement("article");card.className="flow-path-card-v6";
      const row=document.createElement("div");row.className="flow-path-pipeline-v6";
      const lexical=route.route_kind==="LEXICAL_SOURCE_READOUT",inputs=lexical?(route.query_inputs||[]):routeInputs(projection,route);
      const input=column(lexical?"Executed search receipts":"Query inputs");
      if(inputs.length)for(const s of inputs.slice(0,3))input.append(button(short(s.label||s.text,12),()=>options.onNode?.({...s,label:s.label||s.text,type:"query",...(lexical?{explanation:"Saved executed lexical search, not a graph restart or historical assertion."}:{})})));
      else input.append(paragraph("No individual starter-to-first-state link was retained; no atom attribution is guessed."));
      const path=column(lexical?"Saved source readout":route.route_kind==="DISPLAYED_INFLUENCE_CORRIDOR"?"High-influence corridor":"Recorded graph route");
      for(const[n,node]of(route.nodes||[]).entries()){
        if(n){const hop=route.hops?.[n-1];path.append(paragraph((hop?.kind||"connection").replaceAll("_"," "),"flow-hop-v6"));}
        path.append(button(short(node.label,11),()=>options.onNode?.(node),"flow-path-node-v6"));
      }
      const sources=column("Original source");const seen=new Set();
      const citations=[...(candidate.source_semantic_representative?.proof?[candidate.source_semantic_representative.proof]:[]),...(route.hops||[]).flatMap(h=>h.citations||[]),...(route.source_quotes||[]),...(candidate.sources||[])].filter(p=>{const k=JSON.stringify([p.canonical_page_id,p.start,p.end]);if(seen.has(k))return false;seen.add(k);return true;});
      for(const source of citations.slice(0,2)){
        sources.append(button(source.document_id+" / "+(source.date||""),()=>options.onSource?.(source)));
        if(source.text)sources.append(paragraph(source.text.length>240?source.text.slice(0,240)+"... [open full quotation]":source.text,"flow-path-quote-v6"));
      }
      if(!citations.length)sources.append(paragraph("No factual quotation attaches to this navigation-only route."));
      const output=column(candidate.atom_id?"Task evidence target":"Constructed proposal");output.append(paragraph(resultText(candidate),"flow-path-output-v6"));
      output.append(paragraph(directionLabel(candidate.direction||candidate.support,options),"flow-path-direction-v64"));
      row.append(input,path,sources,output);card.append(row);
      const foot=document.createElement("footer"),audit=document.createElement("div");
      foot.append(paragraph(lexical?"Source readout, not a graph edge.":"Source route, not a factual proof chain."));
      audit.append(paragraph(route.meaning||"A numerical discovery witness, not a factual entailment chain."));
      if(!lexical&&route.route_selection?.version?.endsWith("/6.6")){
        const count=route.hops?.length||0,sourceCount=(route.hops||[]).filter(h=>h.kind==="SOURCE").length;
        const summary=paragraph(`${count} links: ${sourceCount} source / ${count-sourceCount} navigation`,"flow-route-metrics-v6");
        summary.dataset.routeEdgeCount=String(count);summary.dataset.routeSourceEdges=String(sourceCount);foot.append(summary);
        if(count<3)audit.append(paragraph(route.route_selection.short_reason==="RECORDED_PRIOR_ALREADY_AT_READOUT_ENDPOINT"?"This source state was already a query starting point; no extra graph hop is invented.":"The bounded display search did not select a comparable longer, forward route in a distinct family. This is not proof that no longer route exists."));
        audit.append(paragraph("The Corpus Map guide inspects the route through existing communities and direct connections. Those inspection views do not add graph edges."));
      }
      audit.append(paragraph(walkLabel(route.walk_metrics),"flow-route-metrics-v6"));
      foot.append(button("Inspect route details",()=>{
        const body=audit.cloneNode(true);
        for(const proof of citations){body.append(button(proof.document_id||proof.canonical_page_id,()=>options.onSource?.(proof)),paragraph(proof.text||"No localized quotation supplied."));}
        inspectPresentation(container,options,"Route meaning and source anchors",body);
      }));
      foot.append(button("Guide path in corpus map",()=>{
        if(options.onGuidePath){options.onGuidePath({candidate,route,route_index:routeIndex});return;}
        const query=new URLSearchParams({corpus:projection.scope?.corpus||"cib",guide_case:projection.case_id,guide_arm:projection.config,guide_candidate:candidate.id,guide_route:String(routeIndex),return_to:location.pathname+location.search});
        if(projection.reading_id)query.set("guide_reading",projection.reading_id);
        location.assign("graph-full-v6.html?"+query);
      },"flow-guide-v6"));card.append(foot);host.append(card);
    }
    if(candidate.sources?.length){
      const fallback=document.createElement("section");fallback.className="flow-source-fallback-v6";fallback.append(paragraph("Source passage fallback / available independently of graph routes"));
      const seen=new Set();for(const proof of candidate.sources){const key=JSON.stringify([proof.canonical_page_id,proof.start,proof.end]);if(seen.has(key))continue;seen.add(key);
        fallback.append(button(proof.document_id||proof.canonical_page_id||"Inspect saved source",()=>options.onSource?.(proof)),paragraph(proof.text||"No localized quotation was supplied.","flow-path-quote-v6"));}
      host.append(fallback);
    }
  }
  function choose(id,notify=false){if(!projection?.candidates?.some(c=>c.id===id))return;selected=id;select.value=id;render();if(notify===true)options.onSelectCandidate?.(projection.candidates.find(c=>c.id===id));}
  select.onchange=()=>choose(select.value,true);render();
  return{selectCandidate:choose,destroy(){select.onchange=null;container.replaceChildren();}};
}

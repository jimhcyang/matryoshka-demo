// Display-only layout. It never adds an edge, changes a verdict or edits a trace.
const rows=value=>Array.isArray(value)?value:[];
export function sceneKind(value){
  const type=String(value.type||value.kind||'').toLowerCase();
  if(/query|reading|atom/.test(type))return 'query';
  if(/community|theme|domain|hierarchy|navigation/.test(type))return 'hierarchy';
  if(/document|passage|readout|source|segment/.test(type))return 'document';
  if(/event/.test(type))return 'event';
  if(/claim|assertion|relation/.test(type))return 'assertion';
  return value.is_graph_node===true?'entity':'display';
}
export const scenePhases=[['question','Question'],['plan','Atoms / readings'],['match','Saved matches'],['connection','Connections'],['passage','Passages'],['evidence','Evidence / candidates']];
export function scenePhase(step){
  const kind=String(step.kind||'').toUpperCase();
  if(/READING|ATOM|PLAN/.test(kind))return 'plan';
  if(/MATCH|SEED/.test(kind))return 'match';
  if(/CONNECT|EDGE|HOP|NAVIGATION/.test(kind))return 'connection';
  if(/READOUT|PASSAGE|SOURCE/.test(kind))return 'passage';
  if(/EVIDENCE|CANDIDATE|ACCUMULAT|DECISION/.test(kind))return 'evidence';
  return 'question';
}
export function boundedScene(graph,step,{contextLimit=12,activeLimit=24}={}){
  const active=new Set(step.nodes.map(n=>n.id));
  for(const e of [...step.edges,...rows(step.display_edges)]){active.add(e.source);active.add(e.target);}
  const current=graph.nodes.filter(n=>active.has(n.id));
  const prior=graph.nodes.filter(n=>!active.has(n.id));
  const selected=[...current.slice(0,activeLimit),...prior.slice(-contextLimit)];
  const ids=new Set(selected.map(n=>n.id));
  return {nodes:selected,edges:graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),active,
    omittedActive:Math.max(0,current.length-activeLimit),omittedPrior:Math.max(0,prior.length-contextLimit),
    allNodes:graph.nodes.length,allEdges:graph.edges.length};
}
export function layoutScene(nodes,edges,{width=760}={}){
  const narrow=width<520,columns=narrow?1:width<720?2:3;
  // Preserve source direction. Topological layers are presentation positions;
  // cycles keep stable input order rather than inventing an acyclic history.
  const incoming=new Map(nodes.map(n=>[n.id,0])),outgoing=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of edges)if(e.source!==e.target&&incoming.has(e.source)&&incoming.has(e.target)){
    incoming.set(e.target,incoming.get(e.target)+1);outgoing.get(e.source).push(e.target);
  }
  const queue=nodes.filter(n=>incoming.get(n.id)===0).map(n=>n.id),ordered=[],seen=new Set();
  for(let at=0;at<queue.length;at++){
    const id=queue[at];if(seen.has(id))continue;seen.add(id);ordered.push(id);
    for(const target of outgoing.get(id)){incoming.set(target,incoming.get(target)-1);if(!incoming.get(target))queue.push(target);}
  }
  for(const n of nodes)if(!seen.has(n.id))ordered.push(n.id);
  const cellWidth=(width-40)/columns,positions=new Map();
  ordered.forEach((id,i)=>positions.set(id,{x:20+(i%columns)*cellWidth,y:24+Math.floor(i/columns)*132,width:cellWidth-24,height:96}));
  return {positions,width,height:Math.max(160,Math.ceil(nodes.length/columns)*132+24)};
}

const human=value=>String(value||'Saved connection').replaceAll('_',' ');
const edgeKey=e=>e.id?'id:'+e.id:JSON.stringify([e.source,e.target,e.kind||e.relation,e.source_row_id,e.citation,e.citations,e.source_refs]);
const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
const button=(text,run,attrs={})=>{const n=el('button',text,{type:'button',...attrs});n.onclick=run;return n;};
export function renderScene(graph,step,{onNode,onEdge,preserveViewport=fn=>fn(),selection,getSelection=()=>selection}={}){
  const bounded=boundedScene(graph,step),host=el('section',null,{class:'narrative-scene','data-testid':'discovery-scene'});
  let overview=false,labels=true,connections=true;
  const toolbar=el('div',null,{class:'scene-toolbar'}),drawing=el('div',null,{class:'narrative-step-tree scene-canvas','data-testid':'trace-tree'});
  const context=button('Earlier context',()=>preserveViewport(()=>{overview=!overview;context.setAttribute('aria-pressed',overview);draw();}),{'aria-pressed':'false','data-testid':'scene-context'});
  const names=button('Labels',()=>preserveViewport(()=>{labels=!labels;names.setAttribute('aria-pressed',labels);drawing.dataset.labels=String(labels);}),{'aria-pressed':'true','data-testid':'scene-labels'});
  const links=button('Connections',()=>preserveViewport(()=>{connections=!connections;links.setAttribute('aria-pressed',connections);drawing.dataset.connections=String(connections);}),{'aria-pressed':'true','data-testid':'scene-edges'});
  toolbar.append(context,names,links,el('span',`${step.nodes.length} current states`,{class:'scene-count'}));
  const caption=el('p','Solid: source connection. Dotted: lookup. Dashed: navigation. Direction follows the saved connection.',{class:'note scene-legend'});
  host.append(toolbar,drawing,caption);
  function draw(){
    drawing.replaceChildren();drawing.dataset.labels=String(labels);drawing.dataset.connections=String(connections);
    if(!bounded.nodes.length){drawing.append(el('p','No graph states were saved for this step.',{class:'empty'}));return;}
    const visible=bounded.nodes.filter(n=>overview||bounded.active.has(n.id));
    const visibleIds=new Set(visible.map(n=>n.id));
    const visibleEdges=bounded.edges.filter(e=>visibleIds.has(e.source)&&visibleIds.has(e.target));
    const width=Math.max(280,drawing.clientWidth-26||700),layout=layoutScene(visible,visibleEdges,{width});
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox',`0 0 ${width} ${layout.height}`);svg.setAttribute('role','group');svg.setAttribute('aria-label','Current saved evidence scene');svg.style.height=layout.height+'px';
    const defs=document.createElementNS(ns,'defs'),marker=document.createElementNS(ns,'marker'),arrow=document.createElementNS(ns,'path');
    const markerId='scene-arrow-'+String(step.id).replace(/[^\w-]/g,'_');
    for(const [k,v] of Object.entries({id:markerId,viewBox:'0 0 10 10',refX:10,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'}))marker.setAttribute(k,v);
    arrow.setAttribute('d','M 0 0 L 10 5 L 0 10 z');arrow.setAttribute('fill','#467e89');marker.append(arrow);defs.append(marker);svg.append(defs);
    for(const edge of bounded.edges){
      const prior=!visibleIds.has(edge.source)||!visibleIds.has(edge.target),a=layout.positions.get(edge.source),b=layout.positions.get(edge.target);
      const path=document.createElementNS(ns,'path');
      const navigation=/NAVIGATION|MEMBER|HIERARCHY/i.test(edge.kind||edge.relation||'');
      path.setAttribute('class','narrative-tree-edge'+(edge.is_graph_edge===false?' is-display-lookup':navigation?' is-navigation':'')+(prior?' is-prior':' is-current'));
      if(prior)path.style.display='none';
      else {
        const sameRow=a.y===b.y;
        const sx=sameRow?a.x+a.width:a.x+a.width/2,sy=sameRow?a.y+a.height/2:a.y+a.height;
        const tx=sameRow?b.x:b.x+b.width/2,ty=sameRow?b.y+b.height/2:b.y;
        path.setAttribute('d',`M ${sx} ${sy} C ${sx+16} ${sy+(sameRow?-16:18)}, ${tx+(sameRow?-16:16)} ${ty-(sameRow?16:18)}, ${tx} ${ty}`);
      }
      path.setAttribute('marker-end',`url(#${markerId})`);path.setAttribute('role','button');path.setAttribute('tabindex',prior?'-1':'0');path.setAttribute('aria-label','Inspect '+human(edge.kind||edge.relation));path.setAttribute('data-scene-key','edge:'+edgeKey(edge));path.setAttribute('aria-pressed',String(getSelection()==='edge:'+edgeKey(edge)));
      const inspect=()=>onEdge?.(edge);path.onclick=inspect;path.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect();}};
      const title=document.createElementNS(ns,'title');title.textContent=human(edge.kind||edge.relation);path.append(title);svg.append(path);
    }
    for(const item of bounded.nodes){
      const p=layout.positions.get(item.id),active=bounded.active.has(item.id),foreign=document.createElementNS(ns,'foreignObject');
      const label=item.label||item.name||'Saved graph state';
      for(const [k,v] of Object.entries({x:p?.x||0,y:p?.y||0,width:p?.width||200,height:p?.height||96}))foreign.setAttribute(k,v);
      if(!p)foreign.style.display='none';
      const n=button(null,()=>onNode?.(item),{class:'narrative-tree-node scene-node '+(active?'is-current':'is-prior'),title:label,'aria-label':'Open full saved text: '+label,'data-kind':sceneKind(item),'data-scene-key':'node:'+item.id,'aria-pressed':getSelection()==='node:'+item.id,tabindex:p?'0':'-1'});
      n.append(el('span',null,{class:'scene-node-type','data-kind':sceneKind(item),'aria-hidden':'true'}),el('span',label.trim().split(/\s+/).slice(0,12).join(' ')+(label.trim().split(/\s+/).length>12?'...':''),{class:'narrative-node-label'}));
      foreign.append(n);svg.append(foreign);
    }
    drawing.append(svg);
    if(visibleEdges.some(e=>e.is_graph_edge===false))drawing.append(el('small','Dotted lookup: not a KG edge.',{class:'scene-lookup-note'}));
    const list=el('details',null,{class:'scene-connection-list'});list.append(el('summary',`${visibleEdges.length} saved connections / inspect`));
    for(const edge of visibleEdges)list.append(button(human(edge.kind||edge.relation),()=>onEdge?.(edge),{class:'narrative-edge-inspector','data-scene-key':'edge:'+edgeKey(edge)}));
    drawing.append(list);
    if(bounded.omittedActive||bounded.omittedPrior)drawing.append(el('p',`${bounded.omittedActive} current and ${bounded.omittedPrior} earlier states outside this bounded scene. Display bounds do not reject evidence. Earlier states remain available at their exact saved steps.`,{class:'note','data-testid':'scene-display-bound'}));
    if(bounded.omittedActive){
      const all=el('details',null,{class:'scene-connection-list','data-testid':'scene-all-current'});all.append(el('summary',`Inspect all ${step.nodes.length} current saved states`));
      for(const item of step.nodes)all.append(button(item.label||item.name||'Saved graph state',()=>onNode?.(item)));
      drawing.append(all);
    }
  }
  // The host is mounted before its first measured drawing, then corrected once
  // at the actual width. No graph or source data changes during resize.
  let frame=0,lastWidth=0;
  const resize=new ResizeObserver(entries=>{
    const width=entries[0].contentRect.width;
    if(!host.isConnected||Math.abs(width-lastWidth)<2)return;
    lastWidth=width;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>preserveViewport(draw));
  });
  host.destroyScene=()=>{resize.disconnect();cancelAnimationFrame(frame);};
  draw();resize.observe(host);
  return host;
}

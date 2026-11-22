// Source-bound presentation graph. Lookup/readout links never become KG edges.
const rows=value=>Array.isArray(value)?value:[];
const proofKey=p=>[p?.canonical_page_id,p?.page_sha256,p?.start,p?.end,p?.text].join('\u241f');
const brief=(value,limit=15)=>String(value||'').trim().split(/\s+/).slice(0,limit).join(' ');
const direction=value=>/^(FOR|SUPPORT|SUPPORTED)$/.test(value)?'support':/^(AGAINST|OPPOSE|OPPOSED|COUNTER|COUNTEREVIDENCE)$/.test(value)?'oppose':'context';

export function buildEvidenceMap({trace,plan,items=null}){
  const nodes=new Map(),edges=new Map(),steps=new Map(rows(trace?.steps).map(s=>[s.id,s]));
  const allowed=items==null?null:new Set(items.flatMap(item=>[item.id,trace?.reading_id+'/'+item.id]));
  const lookup=trace?.sources||trace?.source_refs_by_id||{};
  const proof=ref=>typeof ref==='string'?lookup[ref]:ref;
  const addNode=value=>{if(!nodes.has(value.id))nodes.set(value.id,{...value,pathIds:[]});return nodes.get(value.id);};
  const connect=(source,target,kind,path,extra={})=>{
    if(source===target)return;
    const id=[source,target,kind].join('\u241f');
    if(!edges.has(id))edges.set(id,{id,source,target,kind,pathIds:[],records:[],...extra});
    if(extra.record&&!edges.get(id).records.includes(extra.record))edges.get(id).records.push(extra.record);
    if(path&&!edges.get(id).pathIds.includes(path.id))edges.get(id).pathIds.push(path.id);
  };
  for(const [index,atom]of rows(plan?.atoms).entries())addNode({id:'fact:'+atom.id,type:'fact',
    label:atom.text||atom.proposition||atom.query||'Fact '+(index+1),shortId:'F'+(index+1),layer:0,atom});
  const selected=rows(trace?.paths).filter(path=>allowed==null||allowed.has(path.candidate_or_atom_id));
  const maxHops=Math.max(1,...selected.map(p=>p.graph_hops||0));
  const documentLayer=maxHops+4;
  for(const path of selected){
    const pathSteps=rows(path.steps).map(id=>steps.get(id)).filter(Boolean);
    const final=rows(path.decision_source_refs?.length?path.decision_source_refs:path.source_refs).map(proof).filter(p=>p?.canonical_page_id&&p.text);
    if(!final.length)continue;
    const atom=nodes.get('fact:'+path.query_atom_id);
    let start;
    if(atom)start=atom;
    else{
      start=addNode({id:'query:combined',type:'lookup',label:'Combined facts',layer:1});
      for(const fact of nodes.values())if(fact.type==='fact')connect(fact.id,start.id,'QUERY_COMPOSITION',null);
    }
    const chain=[];
    const match=pathSteps.find(step=>step.kind==='RECORDED_MATCH');
    let lookupNode=start;
    if(match){
      const record=rows(match.nodes)[0],citation=rows(match.source_refs).map(proof).find(Boolean);
      lookupNode=addNode({id:'match:'+(record?.id||match.id),type:'source match',layer:2,
        label:record?.label||match.label||'Matched source',record,citation,step:match,path});
      if(!lookupNode.pathIds.includes(path.id))lookupNode.pathIds.push(path.id);
      connect(start.id,lookupNode.id,'QUERY_SOURCE_LOOKUP',path,{inspectionOnly:false});
    }
    let position=3;
    for(const step of pathSteps){
      for(const edge of rows(step.edges)){
        const from=edge.traversal_from||edge.source,to=edge.traversal_to||edge.target;
        if(![from,to].every(id=>rows(step.nodes).some(n=>n.id===id)))continue;
        for(const [id,offset]of [[from,0],[to,1]]){
          const record=rows(step.nodes).find(n=>n.id===id);
          if(!record)continue;
          const layer=Math.min(documentLayer-1,position+offset),key='graph:'+record.id+'@'+layer;
          const node=addNode({id:key,type:record.type||'graph',label:record.label||step.label,
            layer,record,step,path,graphId:record.id,isGraphNode:record.is_graph_node===true});
          if(!node.pathIds.includes(path.id))node.pathIds.push(path.id);
          if(chain.at(-1)?.id!==node.id)chain.push(node);
        }
        if(chain.length>=2)connect(chain.at(-2).id,chain.at(-1).id,edge.kind||edge.relation||'SOURCE_CONNECTION',path,
          {record:edge,step,inspectionOnly:path.original_traversal_claimed!==true});
        position++;
      }
    }
    if(chain.length)connect(lookupNode.id,chain[0].id,'SOURCE_INSPECTION_BINDING',path,{inspectionOnly:path.original_traversal_claimed!==true});
    const last=chain.at(-1)||lookupNode;
    for(const citation of final){
      const document=addNode({id:'document:'+citation.document_id,type:'document',layer:documentLayer,
        label:citation.title||'Report / '+citation.date,citation,path});
      const endpoint=addNode({id:'excerpt:'+proofKey(citation),type:'excerpt',layer:documentLayer+1,
        label:citation.text,citation,path,tones:[]});
      const tone=direction(path.direction);
      if(!endpoint.tones.includes(tone))endpoint.tones.push(tone);
      for(const node of [document,endpoint])if(!node.pathIds.includes(path.id))node.pathIds.push(path.id);
      connect(last.id,document.id,'SOURCE_PROVENANCE',path);
      connect(document.id,endpoint.id,'SELECTED_QUOTATION',path,{citation});
    }
  }
  return {nodes:[...nodes.values()],edges:[...edges.values()],paths:selected,
    layers:documentLayer+2,sourceGraphEdgesAltered:false,originalTraversalClaimed:selected.some(p=>p.original_traversal_claimed===true)};
}

function element(tag,text,attrs={}){
  const node=document.createElement(tag);if(text!=null)node.textContent=text;
  for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node;
}

export function mountEvidenceMap(host,{trace,plan,items,onNode,onSource,onEdge,onGuide}){
  const graph=buildEvidenceMap({trace,plan,items});
  host.replaceChildren();host.classList.add('evidence-map');
  host.dataset.testid='evidence-map';
  const legend=element('div',null,{class:'evidence-map-legend'});
  for(const [tone,text]of [['support','Support'],['oppose','Opposition'],['context','Context / partial']])
    legend.append(element('span',text,{'data-tone':tone}));
  host.append(legend);
  const viewport=element('div',null,{class:'evidence-map-viewport',tabindex:'0','aria-label':'Facts to selected source evidence'});
  const canvas=element('div',null,{class:'evidence-map-canvas'}),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','evidence-map-lines');canvas.append(svg);viewport.append(canvas);host.append(viewport);
  const defs=document.createElementNS('http://www.w3.org/2000/svg','defs'),marker=document.createElementNS('http://www.w3.org/2000/svg','marker');
  const markerId='evidence-arrow-'+(host.id||'main');
  for(const [key,value]of Object.entries({id:markerId,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'}))marker.setAttribute(key,value);
  const arrow=document.createElementNS('http://www.w3.org/2000/svg','path');arrow.setAttribute('d','M 0 0 L 10 5 L 0 10 z');arrow.setAttribute('fill','#7b9d97');marker.append(arrow);defs.append(marker);svg.append(defs);
  const byLayer=new Map();
  for(const node of graph.nodes){if(!byLayer.has(node.layer))byLayer.set(node.layer,[]);byLayer.get(node.layer).push(node);}
  const activeLayers=[...byLayer.keys()].sort((a,b)=>a-b),layerIndex=new Map(activeLayers.map((x,i)=>[x,i]));
  const maximum=Math.max(1,...[...byLayer.values()].map(v=>v.length)),height=Math.max(340,maximum*112+65),width=Math.max(880,activeLayers.length*214);
  Object.assign(canvas.style,{width:width+'px',height:height+'px'});svg.setAttribute('width',width);svg.setAttribute('height',height);
  const points=new Map(),buttons=new Map(),lines=[];
  function focus(pathIds=[]){
    const wanted=new Set(pathIds);
    for(const node of graph.nodes)buttons.get(node.id)?.classList.toggle('is-muted',wanted.size&&!node.pathIds.some(id=>wanted.has(id))&&node.type!=='fact');
    for(const [edge,line]of lines)line.classList.toggle('is-muted',wanted.size&&!edge.pathIds.some(id=>wanted.has(id)));
  }
  for(const layer of activeLayers){
    const group=byLayer.get(layer),x=layerIndex.get(layer)*214+12;
    const title=layer===0?'Facts':group.every(n=>n.type==='document')?'Documents':group.every(n=>n.type==='excerpt')?'Selected evidence':'Source graph';
    const heading=element('h3',title,{class:'evidence-map-column'});heading.style.left=x+'px';canvas.append(heading);
    group.forEach((node,index)=>{
      const y=52+(index+.5)*(height-65)/group.length-42;
      points.set(node.id,{x,y,width:190,height:84});
      const button=element('button',null,{type:'button',class:'evidence-map-node','data-node-kind':node.type,
        'data-map-node':node.id,'aria-label':node.label,title:node.label});
      if(node.tones?.length)button.dataset.tone=node.tones.length>1?'mixed':node.tones[0];
      button.append(element('small',node.shortId||node.type.replaceAll('_',' ')),element('span',brief(node.label)));
      Object.assign(button.style,{left:x+'px',top:y+'px'});
      button.onclick=()=>{focus(node.pathIds);if(node.citation)onSource?.(node.citation);else onNode?.(node.record||node.atom||node);};
      button.onpointerenter=()=>focus(node.pathIds);button.onpointerleave=()=>focus();
      buttons.set(node.id,button);canvas.append(button);
    });
  }
  for(const edge of graph.edges){
    const a=points.get(edge.source),b=points.get(edge.target);if(!a||!b)continue;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    const x=a.x+a.width,y=a.y+a.height/2,x2=b.x,y2=b.y+b.height/2;
    path.setAttribute('d',`M ${x} ${y} C ${x+(x2-x)/2} ${y}, ${x+(x2-x)/2} ${y2}, ${x2} ${y2}`);
    path.setAttribute('class','evidence-map-edge');path.dataset.kind=edge.kind;
    path.setAttribute('marker-end','url(#'+markerId+')');
    path.setAttribute('tabindex','0');path.setAttribute('role','button');path.setAttribute('aria-label',edge.kind.replaceAll('_',' '));
    path.onclick=()=>onEdge?.(edge);path.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onEdge?.(edge);}};
    const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=edge.kind.replaceAll('_',' ');path.append(title);
    svg.append(path);lines.push([edge,path]);
  }
  const controls=element('div',null,{class:'evidence-map-controls'});
  for(const [text,operation]of [['All paths',()=>focus()],['Start',()=>{viewport.scrollTo({left:0,top:0,behavior:'smooth'});focus();}]]){
    const button=element('button',text,{type:'button'});button.onclick=operation;controls.append(button);
  }
  if(onGuide){
    const firstId=items?.[0]?.id,preferred=graph.paths.filter(path=>path.candidate_or_atom_id===firstId||path.candidate_or_atom_id===trace.reading_id+'/'+firstId);
    const first=preferred.find(path=>path.graph_hops>0)||preferred[0]||graph.paths.find(path=>path.graph_hops>0)||graph.paths[0];
    if(first){const button=element('button','View on KG',{type:'button','data-testid':'map-view-on-kg'});button.onclick=()=>onGuide(first);controls.append(button);}
  }
  host.append(controls);
  if(!graph.paths.length)host.append(element('p','No source-bound route was recorded for this selection.'));
  return {graph,selectCandidate(id){focus(graph.paths.filter(p=>p.candidate_or_atom_id===id||p.candidate_or_atom_id.endsWith('/'+id)).map(p=>p.id));},destroy(){host.replaceChildren();}};
}

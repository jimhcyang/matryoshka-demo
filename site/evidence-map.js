// Source-bound presentation graph. Lookup/readout links never become KG edges.
import {sourcePageLookupLinks} from './source-lookups-v1.js';
const rows=value=>Array.isArray(value)?value:[];
const proofKey=p=>JSON.stringify([p?.canonical_page_id,p?.document_id,p?.date,p?.page_sha256,p?.start,p?.end,p?.text]);
const brief=(value,limit=15)=>String(value||'').trim().split(/\s+/).slice(0,limit).join(' ');
const direction=value=>/^(FOR|SUPPORT|SUPPORTED)$/.test(value)?'support':/^(AGAINST|OPPOSE|OPPOSED|COUNTER|COUNTEREVIDENCE)$/.test(value)?'oppose':'context';

function assignedAtoms(path,pathSteps,inventory,final,proof,nodes){
  const claims=[path.query_atom_id,...pathSteps.filter(s=>['QUERY_ATOM','RECORDED_MATCH'].includes(s.kind)).map(s=>s.query_atom_id)];
  for(const row of rows(inventory)){
    if(row?.item_id===path.candidate_or_atom_id&&rows(path.accepted_evidence_ids).includes(row.id)&&
      rows(row.source_refs).map(proof).some(ref=>final.some(c=>proofKey(c)===proofKey(ref))))claims.push(row.query_atom_id);
  }
  const ids=[...new Set(claims.filter(id=>id!=null&&id!==''))];
  // Conflicting native assignments do not authorize a guessed per-fact binding.
  return ids.length===1?[nodes.get('fact:'+ids[0])].filter(Boolean):[];
}

function rawPhrase(candidate,citation){
  const wording=candidate?.source_wording,span=candidate?.source_span;
  if(typeof wording!=='string'||!wording||typeof citation.text!=='string'||!Array.isArray(span)||span.length!==2||
    !span.every(Number.isSafeInteger)||!Number.isSafeInteger(citation.start)||!Number.isSafeInteger(citation.end)||
    !citation.document_id||!citation.date||!/^[a-f0-9]{64}$/.test(citation.page_sha256||'')||
    citation.start<0||citation.end<=citation.start||span[0]<citation.start||span[1]>citation.end||span[0]>=span[1])return null;
  // Native offsets are Python code points, not JavaScript UTF-16 code units.
  const text=Array.from(citation.text);
  if(text.length!==citation.end-citation.start||text.slice(span[0]-citation.start,span[1]-citation.start).join('')!==wording)return null;
  const same=ref=>proofKey(ref)===proofKey(citation);
  if(!rows(candidate.sources).some(same)||!rows(candidate.source_occurrences).some(o=>
    o?.source_wording===wording&&rows(o.source_span).length===2&&o.source_span[0]===span[0]&&o.source_span[1]===span[1]&&same(o.citation)))return null;
  return {wording,span};
}

export function buildEvidenceMap({trace,plan,items=null,task=null,nativeCandidates=[],pageLookups=null}){
  const pageMatches=sourcePageLookupLinks(pageLookups,{trace,plan});
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
  const candidates=new Map();
  if(task==='redaction'&&(!trace?.task||trace.task==='redaction')){
    for(const candidate of rows(nativeCandidates)){
      if(!candidate?.reading_id||!candidate.id||trace?.reading_id&&candidate.reading_id!==trace.reading_id)continue;
      const id=candidate.reading_id+'/'+candidate.id;
      candidates.set(id,candidates.has(id)?null:candidate);
    }
  }
  let assignedPaths=0,unassignedPaths=0,rawPhrases=0,pageLookupPaths=0;
  for(const path of selected){
    const pathSteps=rows(path.steps).map(id=>steps.get(id)).filter(Boolean);
    const final=rows(path.decision_source_refs?.length?path.decision_source_refs:path.source_refs).map(proof).filter(p=>p?.canonical_page_id&&p.text);
    if(!final.length)continue;
    const starts=assignedAtoms(path,pathSteps,trace?.evidence_inventory,final,proof,nodes);
    if(starts.length){assignedPaths++;for(const start of starts)if(!start.pathIds.includes(path.id))start.pathIds.push(path.id);}
    else unassignedPaths++;
    const chain=[];
    const match=pathSteps.find(step=>step.kind==='RECORDED_MATCH');
    let lookupNodes=[...starts];
    if(match){
      const record=rows(match.nodes)[0],citation=rows(match.source_refs).map(proof).find(Boolean);
      const qualified=pageMatches.filter(link=>link.path_id===path.id&&link.candidate_or_atom_id===path.candidate_or_atom_id&&
        final.some(q=>q.canonical_page_id===link.source.canonical_page_id&&q.document_id===link.source.document_id&&
          q.date===link.source.date&&q.page_sha256===link.source.page_sha256)&&citation?.canonical_page_id===link.source.canonical_page_id&&
          citation.document_id===link.source.document_id&&citation.date===link.source.date&&citation.page_sha256===link.source.page_sha256);
      const facts=[...new Map([...starts,...qualified.map(link=>nodes.get('fact:'+link.atom_id)).filter(Boolean)].map(fact=>[fact.id,fact])).values()];
      lookupNodes=[];
      // Keep each fact's source lookup independent, even when the page is shared.
      for(const fact of facts.length?facts:[null]){
        const lookupNode=addNode({id:'match:'+(record?.id||match.id)+'@'+(fact?.id||path.id),type:'source match',layer:1,
          label:record?.label||match.label||'Selected source',record,citation,step:match,path,
          attributions:fact?[fact.shortId]:[],pageLookupAtoms:[]});
        if(!lookupNode.pathIds.includes(path.id))lookupNode.pathIds.push(path.id);
        lookupNodes.push(lookupNode);
        if(fact&&starts.includes(fact))connect(fact.id,lookupNode.id,'QUERY_SOURCE_LOOKUP',path,
          {inspectionOnly:true,entailment_claimed:false,is_graph_edge:false,original_traversal_claimed:false});
        for(const link of qualified.filter(link=>'fact:'+link.atom_id===fact?.id)){
          if(!fact.pathIds.includes(path.id))fact.pathIds.push(path.id);
          if(!lookupNode.pageLookupAtoms.includes(fact.shortId))lookupNode.pageLookupAtoms.push(fact.shortId);
          connect(fact.id,lookupNode.id,'SOURCE_PAGE_LOOKUP',path,{record:link,citation,inspectionOnly:true,
            lookup_scope:'PAGE',entailment_claimed:false,is_graph_edge:false,original_traversal_claimed:false,
            decision_atom_assignment_changed:false});
        }
      }
      if(qualified.length)pageLookupPaths++;
    }
    let position=3;
    for(const step of pathSteps){
      if(path.route_mode==='DIRECT_SOURCE_HANDOFF')continue;
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
    if(chain.length)for(const lookupNode of lookupNodes)connect(lookupNode.id,chain[0].id,'SOURCE_INSPECTION_BINDING',path,{inspectionOnly:path.original_traversal_claimed!==true});
    const lasts=chain.length?[chain.at(-1)]:lookupNodes;
    for(const citation of final){
      const document=addNode({id:'document:'+citation.document_id,type:'document',layer:documentLayer,
        label:citation.title||'Report / '+citation.date,citation,path});
      const endpoint=addNode({id:'excerpt:'+proofKey(citation),type:'excerpt',layer:documentLayer+1,
        label:citation.text,citation,path,tones:[]});
      const tone=direction(path.direction);
      if(!endpoint.tones.includes(tone))endpoint.tones.push(tone);
      for(const node of [document,endpoint])if(!node.pathIds.includes(path.id))node.pathIds.push(path.id);
      for(const last of lasts)connect(last.id,document.id,'SOURCE_PROVENANCE',path);
      connect(document.id,endpoint.id,'SELECTED_QUOTATION',path,{citation});
      const candidate=candidates.get(path.candidate_or_atom_id),raw=rawPhrase(candidate,citation);
      if(raw){
        const phrase=addNode({id:'raw:'+JSON.stringify([path.candidate_or_atom_id,proofKey(citation),raw.span]),
          type:'raw phrase',layer:documentLayer+2,label:raw.wording,citation,path,candidateId:candidate.id,
          readingId:candidate.reading_id,sourceSpan:[...raw.span],constructionOnly:true,supportCertified:false});
        if(!phrase.pathIds.includes(path.id))phrase.pathIds.push(path.id);
        connect(endpoint.id,phrase.id,'NATIVE_SOURCE_PHRASE',path,{citation,inspectionOnly:true});
        rawPhrases++;
      }
    }
  }
  return {nodes:[...nodes.values()],edges:[...edges.values()],paths:selected,
    layers:documentLayer+2+(rawPhrases?1:0),attribution:{assignedPaths,unassignedPaths},pageLookupPaths,
    sourceGraphEdgesAltered:false,originalTraversalClaimed:selected.some(p=>p.original_traversal_claimed===true)};
}

function element(tag,text,attrs={}){
  const node=document.createElement(tag);if(text!=null)node.textContent=text;
  for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node;
}

export function usefulFactIds(graph){
  const outgoing=new Map(),byId=new Map(graph.nodes.map(node=>[node.id,node]));
  for(const edge of graph.edges){if(!outgoing.has(edge.source))outgoing.set(edge.source,[]);outgoing.get(edge.source).push(edge);}
  const useful=new Set();
  for(const fact of graph.nodes.filter(node=>node.type==='fact'))for(const pathId of fact.pathIds){
    const pending=[fact.id],seen=new Set();
    while(pending.length){
      const id=pending.pop();if(seen.has(id))continue;seen.add(id);
      if(byId.get(id)?.type==='excerpt'){useful.add(fact.id);break;}
      for(const edge of outgoing.get(id)||[])if(edge.pathIds.includes(pathId))pending.push(edge.target);
    }
    if(useful.has(fact.id))break;
  }
  return useful;
}

export function mountEvidenceMap(host,{trace,plan,items,task,nativeCandidates,pageLookups,formatText=value=>value,onNode,onSource,onEdge}){
  const graph=buildEvidenceMap({trace,plan,items,task,nativeCandidates,pageLookups}),useful=usefulFactIds(graph);
  const display=value=>String(formatText(String(value??'')));
  host.replaceChildren();host.classList.add('evidence-map');host.dataset.testid='evidence-map';
  const toolbar=element('div',null,{class:'evidence-map-toolbar'}),legend=element('div',null,{class:'evidence-map-legend'});
  for(const [tone,text]of [['support','Support'],['oppose','Opposition'],['context','Context / partial']])legend.append(element('span',text,{'data-tone':tone}));
  toolbar.append(legend);
  const controls=element('div',null,{class:'evidence-map-controls','aria-label':'Map controls'});
  const compact=element('input',null,{type:'checkbox','data-testid':'evidence-map-compact'}),compactLabel=element('label');
  compactLabel.append(compact,document.createTextNode('Compact'));compactLabel.title='Hide facts without a retained selected-evidence endpoint.';controls.append(compactLabel);
  const command=(label,title,fn)=>{const button=element('button',label,{type:'button',title,'aria-label':title});button.onclick=fn;controls.append(button);return button;};
  let zoom=1,width=880,height=360,selectedPaths=[];
  const viewport=element('div',null,{class:'evidence-map-viewport',tabindex:'0','aria-label':'Facts to selected source evidence. Drag empty space or use the pan controls.'});
  const spacer=element('div',null,{class:'evidence-map-spacer'}),canvas=element('div',null,{class:'evidence-map-canvas'});
  spacer.append(canvas);viewport.append(spacer);
  function applyZoom(next,center={x:viewport.clientWidth/2,y:viewport.clientHeight/2}){
    const x=(viewport.scrollLeft+center.x)/zoom,y=(viewport.scrollTop+center.y)/zoom;
    zoom=Math.max(.45,Math.min(1.75,next));host.dataset.zoom=String(zoom);
    canvas.style.transform='scale('+zoom+')';spacer.style.width=width*zoom+'px';spacer.style.height=height*zoom+'px';
    viewport.scrollLeft=x*zoom-center.x;viewport.scrollTop=y*zoom-center.y;
    reset.textContent=Math.round(zoom*100)+'%';
  }
  command('-','Zoom out',()=>applyZoom(zoom/1.2));
  const reset=command('100%','Reset zoom and pan',()=>{applyZoom(1);viewport.scrollTo(0,0);});
  command('+','Zoom in',()=>applyZoom(zoom*1.2));
  command('<','Pan left',()=>viewport.scrollBy({left:-Math.max(160,viewport.clientWidth*.6)}));
  command('>','Pan right',()=>viewport.scrollBy({left:Math.max(160,viewport.clientWidth*.6)}));
  toolbar.append(controls);host.append(toolbar,element('p','Dashed links show source lookup, not entailment.',{class:'evidence-map-note'}),viewport);
  const buttons=new Map(),lines=[];
  function focus(pathIds=[]){
    const wanted=new Set(pathIds);
    for(const node of graph.nodes)buttons.get(node.id)?.classList.toggle('is-muted',wanted.size&&!node.pathIds.some(id=>wanted.has(id)));
    for(const [edge,line]of lines)line.classList.toggle('is-muted',wanted.size&&!edge.pathIds.some(id=>wanted.has(id)));
  }
  function draw(){
    canvas.replaceChildren();buttons.clear();lines.length=0;
    const visible=graph.nodes.filter(node=>!compact.checked||node.type!=='fact'||useful.has(node.id)),byLayer=new Map();
    host.dataset.compact=String(compact.checked);
    for(const node of visible){if(!byLayer.has(node.layer))byLayer.set(node.layer,[]);byLayer.get(node.layer).push(node);}
    const layers=[...byLayer.keys()].sort((a,b)=>a-b),points=new Map(),gap=352,cardWidth=220,cardHeight=104;
    height=Math.max(360,...[...byLayer.values()].map(group=>group.length*144+72));
    width=Math.max(880,(layers.length-1)*gap+cardWidth+32);
    Object.assign(canvas.style,{width:width+'px',height:height+'px'});
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','evidence-map-lines');svg.setAttribute('width',width);svg.setAttribute('height',height);canvas.append(svg);
    const markerId='evidence-arrow-'+(host.id||'main'),defs=document.createElementNS(svg.namespaceURI,'defs'),marker=document.createElementNS(svg.namespaceURI,'marker');
    for(const [key,value]of Object.entries({id:markerId,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:8,markerHeight:8,orient:'auto-start-reverse'}))marker.setAttribute(key,value);
    const arrow=document.createElementNS(svg.namespaceURI,'path');arrow.setAttribute('d','M 0 0 L 10 5 L 0 10 z');arrow.setAttribute('fill','#7b9d97');marker.append(arrow);defs.append(marker);svg.append(defs);
    for(const [column,layer]of layers.entries()){
      const group=byLayer.get(layer),x=column*gap+16;
      const title=layer===0?'Facts':group.every(n=>n.type==='document')?'Documents':group.every(n=>n.type==='excerpt')?'Selected evidence':group.every(n=>n.type==='raw phrase')?'Source phrase':group.every(n=>n.type==='source match')?'Source matches':'Source graph';
      const heading=element('h3',title,{class:'evidence-map-column'});heading.style.left=x+'px';canvas.append(heading);
      group.forEach((node,index)=>{
        const y=56+(index+.5)*(height-72)/group.length-cardHeight/2;
        points.set(node.id,{x,y,width:cardWidth,height:cardHeight});
        const attribution=node.attributions||[],matchLabel=attribution.length?attribution[0]+' match':node.type==='source match'?'Selected source':null;
        const detail=node.attributions?(attribution.length?attribution[0]+'. ':'')+(node.pageLookupAtoms?.length?'Recorded fact search matched this page, not excerpt entailment or support.':'Selected evidence attribution; not an additional support verdict.'):
          node.type==='fact'&&!useful.has(node.id)?'No retained selected-evidence endpoint':node.type==='raw phrase'?'Exact source wording before realization; not additional support.':'';
        const label=display(node.label),button=element('button',null,{type:'button',class:'evidence-map-node','data-node-kind':node.type,'data-map-node':node.id,
          'aria-label':[node.shortId||node.type,label,detail].filter(Boolean).join('. '),title:[label,detail].filter(Boolean).join('\n')});
        if(node.tones?.length)button.dataset.tone=node.tones.length>1?'mixed':node.tones[0];
        button.append(element('small',matchLabel||node.shortId||node.type.replaceAll('_',' ')),element('span',node.type==='raw phrase'?label:brief(label)));
        Object.assign(button.style,{left:x+'px',top:y+'px',width:cardWidth+'px',height:cardHeight+'px'});
        button.onclick=()=>{focus(node.pathIds);if(node.citation)onSource?.(node.citation);else onNode?.(node.record||node.atom||node);};
        button.onpointerenter=()=>focus(node.pathIds);button.onpointerleave=()=>focus(selectedPaths);button.onfocus=()=>focus(node.pathIds);button.onblur=()=>focus(selectedPaths);
        buttons.set(node.id,button);canvas.append(button);
      });
    }
    for(const edge of graph.edges){
      const a=points.get(edge.source),b=points.get(edge.target);if(!a||!b)continue;
      const line=document.createElementNS(svg.namespaceURI,'path'),x=a.x+a.width+3,y=a.y+a.height/2,x2=b.x-8,y2=b.y+b.height/2;
      line.setAttribute('d',`M ${x} ${y} C ${x+(x2-x)/2} ${y}, ${x+(x2-x)/2} ${y2}, ${x2} ${y2}`);
      line.setAttribute('class','evidence-map-edge');line.dataset.kind=edge.kind;
      if(edge.kind==='SOURCE_PAGE_LOOKUP'){line.dataset.lookupScope='PAGE';line.dataset.entailmentClaimed='false';line.dataset.isGraphEdge='false';}
      line.setAttribute('marker-end','url(#'+markerId+')');
      const label=edge.kind==='SOURCE_PAGE_LOOKUP'?'Recorded fact search matched this page, not excerpt support or a KG edge':edge.kind.replaceAll('_',' ');
      line.setAttribute('tabindex','0');line.setAttribute('role','button');line.setAttribute('aria-label',label);
      const inspect=()=>{focus(edge.pathIds);onEdge?.(edge);};line.onclick=inspect;
      line.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspect();}};line.onfocus=()=>focus(edge.pathIds);line.onblur=()=>focus(selectedPaths);
      const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=label;line.append(title);svg.append(line);lines.push([edge,line]);
    }
    applyZoom(zoom);focus(selectedPaths);
  }
  compact.onchange=draw;
  let drag=null;
  viewport.onpointerdown=event=>{
    if(event.button!==0||event.pointerType==='touch'||event.target.closest('button,[role=button]'))return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(event.pointerId);viewport.classList.add('is-panning');
  };
  viewport.onpointermove=event=>{if(drag&&drag.id===event.pointerId){viewport.scrollLeft=drag.left+drag.x-event.clientX;viewport.scrollTop=drag.top+drag.y-event.clientY;}};
  const stop=()=>{drag=null;viewport.classList.remove('is-panning');};viewport.onpointerup=stop;viewport.onpointercancel=stop;viewport.onlostpointercapture=stop;
  viewport.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();const box=viewport.getBoundingClientRect();applyZoom(zoom*(event.deltaY>0?1/1.1:1.1),{x:event.clientX-box.left,y:event.clientY-box.top});}},{passive:false});
  draw();
  if(!graph.paths.length)host.append(element('p','No source-bound route was recorded for this selection.'));
  return {graph,selectCandidate(id){selectedPaths=graph.paths.filter(p=>p.candidate_or_atom_id===id||p.candidate_or_atom_id.endsWith('/'+id)).map(p=>p.id);focus(selectedPaths);},destroy(){stop();host.replaceChildren();}};
}

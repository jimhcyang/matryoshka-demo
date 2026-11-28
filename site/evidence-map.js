// Source-bound presentation graph. Lookup/readout links never become KG edges.
import {sourcePageLookupLinks} from './source-lookups-v1.js';
import {evidenceRoles} from './workbench-evidence-details.js?v=20261128-polish1';
const rows=value=>Array.isArray(value)?value:[];
const proofKey=p=>JSON.stringify([p?.canonical_page_id,p?.document_id,p?.date,p?.page_sha256,p?.start,p?.end,p?.text]);
const brief=(value,limit=15)=>String(value||'').trim().split(/\s+/).slice(0,limit).join(' ');
const direction=value=>evidenceRoles([value]).tones[0];

function assignedAtoms(path,pathSteps,inventory,final,proof,nodes){
  const claims=[path.query_atom_id,...pathSteps.filter(s=>['QUERY_ATOM','RECORDED_MATCH'].includes(s.kind)).map(s=>s.query_atom_id)];
  for(const row of rows(inventory)){
    if(row?.item_id===path.candidate_or_atom_id&&rows(path.accepted_evidence_ids).includes(row.id)&&
      rows(row.source_refs).map(proof).some(ref=>final.some(c=>proofKey(c)===proofKey(ref))))claims.push(row.query_atom_id);
  }
  const ids=[...new Set(claims.filter(id=>id!=null&&id!==''))];
  // These are recorded lookup associations, not mutually exclusive support verdicts.
  return ids.map(id=>nodes.get('fact:'+id)).filter(Boolean);
}

function sourceMatchKey(match,proof,path){
  const refs=rows(match.source_refs).map(proof).filter(Boolean);
  const identity=/^[a-f0-9]{64}$/.test(match.recorded_match_sha256||'')?match.recorded_match_sha256:match.id;
  const complete=typeof identity==='string'&&identity&&refs.length&&refs.every(q=>q.canonical_page_id&&q.document_id&&q.date&&
    /^[a-f0-9]{64}$/.test(q.page_sha256||'')&&Number.isSafeInteger(q.start)&&Number.isSafeInteger(q.end)&&
    q.start>=0&&q.end>q.start&&typeof q.text==='string');
  // Missing identities fail closed: a label or shared page alone cannot merge matches.
  return JSON.stringify([match.kind,identity,
    rows(match.nodes).map(n=>n.id).sort(),refs.map(proofKey).sort(),complete?null:path.id]);
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
      const lookupNode=addNode({id:'match:'+sourceMatchKey(match,proof,path),type:'source match',layer:1,
        label:record?.label||match.label||'Selected source',record,citation,step:match,path,
        attributions:[],pageLookupAtoms:[],origins:[]});
      if(!lookupNode.pathIds.includes(path.id))lookupNode.pathIds.push(path.id);
      lookupNode.origins.push({pathId:path.id,candidateId:path.candidate_or_atom_id,
        candidateLabel:candidates.get(path.candidate_or_atom_id)?.fill,endpointKind:path.endpoint_kind,
        routeMode:path.route_mode,matchId:match.id,matchSHA256:match.recorded_match_sha256,
        recordedLocations:[...rows(match.recorded_locations)],factIds:facts.map(fact=>fact.id)});
      lookupNodes=[lookupNode];
      for(const fact of facts){
        if(!lookupNode.attributions.includes(fact.shortId))lookupNode.attributions.push(fact.shortId);
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
        label:citation.text,citation,path,tones:[],recordedDirections:[]});
      const tone=direction(path.direction);
      if(tone&&!endpoint.tones.includes(tone))endpoint.tones.push(tone);
      if(tone&&!endpoint.recordedDirections.includes(path.direction))endpoint.recordedDirections.push(path.direction);
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

export function evidenceMapSelection(graph,selection){
  const nodeIds=new Set(),edgeIds=new Set();
  if(!selection)return {nodeIds,edgeIds};
  if(selection.pathIds){
    const paths=new Set(selection.pathIds);
    for(const node of graph.nodes)if(node.pathIds.some(id=>paths.has(id)))nodeIds.add(node.id);
    for(const edge of graph.edges)if(edge.pathIds.some(id=>paths.has(id)))edgeIds.add(edge.id);
    return {nodeIds,edgeIds};
  }
  const edge=graph.edges.find(e=>e.id===selection.edgeId),node=graph.nodes.find(n=>n.id===selection.nodeId);
  const paths=edge?.pathIds||node?.pathIds||[];
  if(edge){edgeIds.add(edge.id);nodeIds.add(edge.source);nodeIds.add(edge.target);}
  if(node)nodeIds.add(node.id);
  // Walk ancestors and descendants separately, keeping each saved route's identity.
  // An undirected walk (or path-ID union alone) would light unrelated co-parent branches.
  for(const upstream of [true,false]){
    const adjacent=new Map();
    for(const e of graph.edges){
      const from=upstream?e.target:e.source;
      if(!adjacent.has(from))adjacent.set(from,[]);adjacent.get(from).push(e);
    }
    const start=node?.id||(edge&&(upstream?edge.source:edge.target));
    const pending=paths.map(path=>[start,path]),seen=new Set();
    while(pending.length){
      const [id,path]=pending.pop(),key=JSON.stringify([id,path]);
      if(seen.has(key))continue;seen.add(key);
      for(const e of adjacent.get(id)||[])if(e.pathIds.includes(path)){
        const next=upstream?e.source:e.target;
        nodeIds.add(next);edgeIds.add(e.id);pending.push([next,path]);
      }
    }
  }
  return {nodeIds,edgeIds};
}

function edgeDescription(edge){
  if(edge.kind==='SOURCE_PAGE_LOOKUP')return 'Recorded fact search matched this page, not excerpt support or a KG edge';
  if(edge.kind==='QUERY_SOURCE_LOOKUP')return 'Recorded fact-to-source lookup association, not an entailment or additional support verdict';
  if(edge.kind==='NAVIGATION')return 'Hierarchy navigation, not factual support or entailment';
  if(edge.kind==='SOURCE_INSPECTION_BINDING')return 'Source inspection binding, not a factual KG edge or entailment';
  if(edge.kind==='SOURCE_PROVENANCE')return 'Source provenance: recorded document for this route, not entailment';
  if(edge.kind==='SELECTED_QUOTATION')return 'Selected quotation from this document';
  if(edge.kind==='NATIVE_SOURCE_PHRASE')return 'Exact source phrase';
  return edge.kind.replaceAll('_',' ')+(edge.inspectionOnly?'. Recorded source-graph inspection, not original inference traversal':'');
}

export function evidenceMapProvenance(node){
  if(node.type!=='source match')return null;
  if(rows(node.attributions).length)return {kind:'fact-source-match',label:'Source match',
    explanation:'A recorded fact-to-source link. A page-search match is lookup context, not proof that the excerpt supports the fact.'};
  if(rows(node.origins).some(origin=>origin.endpointKind==='DECISION_EVIDENCE'))return {kind:'decision-evidence',label:'Decision evidence',
    explanation:'Evidence recorded for a saved decision, with no recorded fact link. No fact arrow is added.'};
  if(rows(node.origins).length&&node.origins.every(origin=>origin.endpointKind==='CANDIDATE_SOURCE_CONTEXT'))return {kind:'candidate-context',label:'Candidate context',
    explanation:'A source recorded for a candidate, with no recorded fact link. This is context, not extra support; no fact arrow is added.'};
  return {kind:'source-context',label:'Source context',
    explanation:'A recorded source route with no recorded fact link. Its candidate or decision origin is not specified; no fact arrow is added.'};
}

export function evidenceMapEdgeRoutes(edges,points){
  const routes=new Map(),bundles=new Map();
  for(const edge of edges){
    const a=points.get(edge.source),b=points.get(edge.target);if(!a||!b)continue;
    const x=a.x+a.width+3,y=a.y+a.height/2,x2=b.x-8,y2=b.y+b.height/2,dx=x2-x;
    const long=b.column-a.column>1&&dx>0;
    const route={long,bend:0,d:`M ${x} ${y} C ${x+dx/2} ${y}, ${x+dx/2} ${y2}, ${x2} ${y2}`};
    routes.set(edge.id,route);
    if(long){
      const key=b.column;if(!bundles.has(key))bundles.set(key,[]);
      bundles.get(key).push({edge,route,x,y,x2,y2,dx});
    }
  }
  for(const bundle of bundles.values()){
    // Stable lanes per destination column separate parallel routes without changing associations.
    bundle.sort((a,b)=>a.edge.id<b.edge.id?-1:a.edge.id>b.edge.id?1:0);
    bundle.forEach(({route,x,y,x2,y2,dx},index)=>{
      const tier=Math.floor(index/2)+1,tiers=Math.ceil(bundle.length/2)+1;
      const bend=(index%2?1:-1)*(18+44*tier/tiers),mx=x+dx/2,my=(y+y2)/2+bend;
      route.bend=bend;
      // Horizontal departure/arrival preserve the solid directional arrowhead at its box.
      route.d=`M ${x} ${y} C ${x+dx*.2} ${y}, ${x+dx*.3} ${my}, ${mx} ${my} C ${x+dx*.7} ${my}, ${x+dx*.8} ${y2}, ${x2} ${y2}`;
    });
  }
  return routes;
}

export function mountEvidenceMap(host,{trace,plan,items,task,nativeCandidates,pageLookups,formatText=value=>value,onNode,onSource,onEdge}){
  const graph=buildEvidenceMap({trace,plan,items,task,nativeCandidates,pageLookups}),useful=usefulFactIds(graph);
  const display=value=>String(formatText(String(value??'')));
  host.replaceChildren();host.classList.add('evidence-map');host.dataset.testid='evidence-map';
  const toolbar=element('div',null,{class:'evidence-map-toolbar'}),legend=element('div',null,{class:'evidence-map-legend'});
  const presentTones=new Set(graph.nodes.flatMap(node=>node.tones||[]));
  for(const [tone,text]of [['support','Support'],['oppose','Opposition'],['context','Context / partial']])if(presentTones.has(tone))legend.append(element('span',text,{'data-tone':tone}));
  toolbar.append(legend);
  const controls=element('div',null,{class:'evidence-map-controls','aria-label':'Map controls'});
  const compact=element('input',null,{type:'checkbox','data-testid':'evidence-map-compact'}),compactLabel=element('label');
  compactLabel.append(compact,document.createTextNode('Compact'));compactLabel.title='Hide facts without a retained selected-evidence endpoint.';controls.append(compactLabel);
  const command=(label,title,fn)=>{const button=element('button',label,{type:'button',title,'aria-label':title});button.onclick=fn;controls.append(button);return button;};
  let zoom=1,width=880,height=360,pinned=null;
  const viewport=element('div',null,{class:'evidence-map-viewport',tabindex:'0','aria-label':'Facts to selected source evidence. Click a box to pin its paths; empty space or Escape clears. Drag empty space or use the pan controls.'});
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
  const help=element('details',null,{class:'evidence-map-note','data-testid':'evidence-map-provenance-help'});
  help.append(element('summary','Source match or Candidate context?'),
    element('p','Source match: a recorded fact-to-source link. A page-search match does not establish excerpt support.'),
    element('p','Candidate context: a source recorded for a candidate, with no recorded fact link. No fact arrow or extra support is implied.'));
  const inspection=element('p',null,{class:'evidence-map-note','data-testid':'evidence-map-provenance-inspection'});inspection.hidden=true;
  toolbar.append(controls);host.append(toolbar,element('p','Arrows show recorded lookup, provenance, navigation or source connections, not necessarily entailment. Click to pin paths; empty space or Escape clears.',{class:'evidence-map-note'}),help,viewport,inspection);
  const status=element('span','No path pinned.',{role:'status','aria-live':'polite'});
  Object.assign(status.style,{position:'absolute',width:'1px',height:'1px',overflow:'hidden',clipPath:'inset(50%)'});host.append(status);
  const buttons=new Map(),lines=[];
  function focus(selection=pinned){
    const {nodeIds,edgeIds}=evidenceMapSelection(graph,selection);
    for(const [id,button]of buttons){
      button.classList.toggle('is-muted',!!selection&&!nodeIds.has(id));
      const pressed=pinned?.nodeId===id;button.setAttribute('aria-pressed',String(pressed));
      // Inline styling keeps the pinned box visible without changing shared UI stylesheets.
      button.style.outline=pressed?'3px solid #246d6d':'';button.style.outlineOffset=pressed?'3px':'';
    }
    for(const [edge,line]of lines){line.classList.toggle('is-muted',!!selection&&!edgeIds.has(edge.id));line.setAttribute('aria-pressed',String(pinned?.edgeId===edge.id));}
  }
  function pin(selection=null){pinned=selection;host.dataset.selection=selection?.nodeId||selection?.edgeId||(selection?'candidate':'');
    const node=graph.nodes.find(n=>n.id===selection?.nodeId),provenance=node&&evidenceMapProvenance(node);
    inspection.hidden=!provenance;
    if(provenance){
      const q=node.citation,origins=rows(node.origins).map(origin=>origin.candidateLabel||origin.candidateId);
      inspection.textContent=provenance.explanation+' Recorded candidate: '+[...new Set(origins)].join('; ')+
        (q?'. Source: '+q.document_id+' / '+q.canonical_page_id+' / span '+q.start+'-'+q.end+'. Page SHA256: '+q.page_sha256:'');
      inspection.dataset.provenanceKind=provenance.kind;
    }else{inspection.textContent='';delete inspection.dataset.provenanceKind;}
    status.textContent=selection?'Paths pinned. Empty space or Escape clears.':'No path pinned.';focus();}
  const preview=selection=>{if(!pinned)focus(selection);};
  const resetSelection=event=>{if(event.key==='Escape')pin();};
  // Source inspection can move focus into a drawer outside this host.
  document.addEventListener('keydown',resetSelection);
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
        points.set(node.id,{x,y,width:cardWidth,height:cardHeight,column});
        const attribution=node.attributions||[],provenance=evidenceMapProvenance(node),matchLabel=provenance?.label;
        const origins=rows(node.origins).map(origin=>'Saved '+(origin.endpointKind==='DECISION_EVIDENCE'?'decision evidence':'candidate context')+
          ': '+(origin.candidateLabel||origin.candidateId)+'. Route '+origin.pathId+' ('+origin.routeMode+'). Match '+origin.matchId+
          (origin.recordedLocations.length?'. Recorded origin '+origin.recordedLocations.join(', '):'')).join('\n');
        const detail=node.attributions?provenance.explanation+'\n'+(attribution.length?'Recorded fact associations: '+attribution.join(', ')+'. ':'No recorded fact association; no fact arrow is inferred. ')+
          (node.pageLookupAtoms?.length?'Recorded fact search matched this page, not excerpt entailment or support.':'Selected source context; not an additional support verdict.')+'\n'+origins:
          node.type==='fact'&&!useful.has(node.id)?'No retained selected-evidence endpoint':node.type==='raw phrase'?'Exact source wording before realization; not additional support.':'';
        const roles=evidenceRoles(node.recordedDirections||(node.tones||[]).map(tone=>tone.toUpperCase()));
        const roleDescription=node.type==='excerpt'?'Recorded quotation roles: '+roles.description:'';
        const label=display(node.label),button=element('button',null,{type:'button',class:'evidence-map-node','data-node-kind':node.type,'data-map-node':node.id,
          'aria-label':[node.shortId||node.type,label,detail,roleDescription].filter(Boolean).join('. '),title:[label,detail,roleDescription].filter(Boolean).join('\n')});
        if(node.tones?.length){button.dataset.tone=node.tones.length>1?'mixed':node.tones[0];button.dataset.palette=roles.palette;}
        if(provenance)button.dataset.provenanceKind=provenance.kind;
        button.append(element('small',matchLabel||node.shortId||node.type.replaceAll('_',' ')),element('span',node.type==='raw phrase'?label:brief(label)));
        Object.assign(button.style,{left:x+'px',top:y+'px',width:cardWidth+'px',height:cardHeight+'px'});
        button.onclick=()=>{pin({nodeId:node.id});if(node.citation)onSource?.(node.citation);else onNode?.(node.record||node.atom||node);};
        button.onpointerenter=()=>preview({nodeId:node.id});button.onpointerleave=()=>focus();button.onfocus=()=>preview({nodeId:node.id});button.onblur=()=>focus();
        buttons.set(node.id,button);canvas.append(button);
      });
    }
    const routes=evidenceMapEdgeRoutes(graph.edges,points);
    for(const edge of graph.edges){
      const a=points.get(edge.source),b=points.get(edge.target);if(!a||!b)continue;
      const line=document.createElementNS(svg.namespaceURI,'path'),route=routes.get(edge.id);
      line.setAttribute('d',route.d);line.dataset.curveOffset=String(route.bend);line.dataset.longRoute=String(route.long);
      line.setAttribute('class','evidence-map-edge');line.dataset.kind=edge.kind;
      line.dataset.mapEdge=edge.id;line.dataset.mapSource=edge.source;line.dataset.mapTarget=edge.target;
      line.style.strokeDasharray='none';
      if(edge.kind==='SOURCE_PAGE_LOOKUP'){line.dataset.lookupScope='PAGE';line.dataset.entailmentClaimed='false';line.dataset.isGraphEdge='false';}
      line.setAttribute('marker-end','url(#'+markerId+')');
      const label=edgeDescription(edge);
      line.setAttribute('tabindex','0');line.setAttribute('role','button');line.setAttribute('aria-label',label);
      const inspect=()=>{pin({edgeId:edge.id});onEdge?.(edge);};line.onclick=inspect;
      line.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspect();}};
      line.onfocus=()=>preview({edgeId:edge.id});line.onblur=()=>focus();
      line.onpointerenter=()=>preview({edgeId:edge.id});line.onpointerleave=()=>focus();
      const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=label;line.append(title);svg.append(line);lines.push([edge,line]);
    }
    applyZoom(zoom);focus();
  }
  compact.onchange=draw;
  let drag=null,suppressClick=false;
  viewport.onpointerdown=event=>{
    if(event.button!==0||event.pointerType==='touch'||event.target.closest('button,[role=button]'))return;
    suppressClick=false;drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(event.pointerId);viewport.classList.add('is-panning');
  };
  viewport.onpointermove=event=>{if(drag&&drag.id===event.pointerId){if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>4)suppressClick=true;viewport.scrollLeft=drag.left+drag.x-event.clientX;viewport.scrollTop=drag.top+drag.y-event.clientY;}};
  const stop=()=>{drag=null;viewport.classList.remove('is-panning');};viewport.onpointerup=stop;viewport.onpointercancel=stop;viewport.onlostpointercapture=stop;
  viewport.onclick=event=>{if(event.target.closest('button,[role=button]'))return;if(!suppressClick)pin();suppressClick=false;};
  viewport.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();const box=viewport.getBoundingClientRect();applyZoom(zoom*(event.deltaY>0?1/1.1:1.1),{x:event.clientX-box.left,y:event.clientY-box.top});}},{passive:false});
  draw();
  if(!graph.paths.length)host.append(element('p','No source-bound route was recorded for this selection.'));
  return {graph,selectCandidate(id){const pathIds=graph.paths.filter(p=>p.candidate_or_atom_id===id||p.candidate_or_atom_id.endsWith('/'+id)).map(p=>p.id);pin(pathIds.length?{pathIds}:null);},
    destroy(){stop();document.removeEventListener('keydown',resetSelection);delete host.dataset.selection;host.replaceChildren();}};
}

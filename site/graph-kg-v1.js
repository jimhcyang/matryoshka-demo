/* Display-only KG algorithms. No source records or hierarchy assignments are mutated. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GraphKG=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const compare=(a,b)=>String(a)<String(b)?-1:String(a)>String(b)?1:0;
  const weight=edge=>Math.max(0,Number(edge.layout_weight??edge.weight??0)||0);
  const contextNode=node=>Boolean(node.overlay_slot||node.semantic===false||node.eligible_evidence===false||node.type==='RedactionSlot'||node.node_type==='RedactionSlot');
  const semanticEdge=edge=>!edge.slot_navigation&&!edge.investigative_only&&edge.semantic!==false&&edge.eligible_evidence!==false&&!edge.eligibility_ineligible&&edge.kind!=='NAVIGATION'&&weight(edge)>0;
  const round=value=>Number(value.toFixed(9));

  function selectCoverage(nodes,edges,{limit=32,pinned=[]}={}){
    const catalog=new Map(nodes.map(node=>[node.id||node.node_id,node]));
    const ids=[...catalog.keys()].sort(compare),adj=new Map(ids.map(id=>[id,new Map()]));
    const semantic=edges.filter(edge=>edge.source!==edge.target&&semanticEdge(edge)&&catalog.has(edge.source)&&catalog.has(edge.target)&&!contextNode(catalog.get(edge.source))&&!contextNode(catalog.get(edge.target))&&!catalog.get(edge.source).eligibility_ineligible&&!catalog.get(edge.target).eligibility_ineligible)
      .sort((a,b)=>compare(a.source,b.source)||compare(a.target,b.target)||compare(a.id,b.id));
    for(const edge of semantic){
      const w=weight(edge)/(1+weight(edge));
      adj.get(edge.source).set(edge.target,Math.max(adj.get(edge.source).get(edge.target)||0,w));
      adj.get(edge.target).set(edge.source,Math.max(adj.get(edge.target).get(edge.source)||0,w));
    }
    const facets=id=>{
      const node=catalog.get(id);
      if(contextNode(node)||node.eligibility_ineligible)return [];
      return [['community',node.community_id,2.5],['theme',node.theme_id,1.5],['domain',node.domain_id,1],['type',node.type||node.node_type,.75]]
        .filter(([,value])=>value).map(([kind,value,w])=>[kind+':'+value,w]);
    };
    const selected=[],chosen=new Set(),reached=new Set(),facetCounts=new Map(),pages=new Set(),trace=[];
    const anchors=new Set();
    for(const id of pinned){
      if(!catalog.has(id)||!contextNode(catalog.get(id)))continue;
      for(const edge of edges)if(edge.slot_navigation&&(edge.source===id||edge.target===id))anchors.add(edge.source===id?edge.target:edge.source);
    }
    const cap=Math.max(0,Math.min(ids.length,Math.floor(limit))),contextQuota=Math.max(1,Math.floor(cap/8));
    let contextCount=0;
    const evaluate=id=>{
      const node=catalog.get(id),context=contextNode(node),eligible=!node.eligibility_ineligible;
      const reach=context||!eligible?[]:[id,...adj.get(id).keys()];
      const newlyReached=reach.filter(other=>!reached.has(other));
      const diversity=facets(id).reduce((sum,[key,w])=>sum+w/(1+(facetCounts.get(key)||0)),0);
      const expansion=context?0:[...adj.get(id)].reduce((sum,[other,w])=>sum+(chosen.has(other)?w:0),0)*2;
      const page=node.canonical_page_id||node.document_id||id;
      const navigation=context?(.05+(pages.has(page)?0:.25)):anchors.has(id)&&!chosen.has(id)?1:0;
      return {id,context,page,newlyReached,reach: newlyReached.length,diversity,expansion,navigation,
        gain:round(newlyReached.length+diversity+expansion+navigation),degree:adj.get(id).size};
    };
    const commit=(candidate,reason,ties=[])=>{
      const {id}=candidate;selected.push(catalog.get(id));chosen.add(id);
      candidate.newlyReached.forEach(other=>reached.add(other));
      facets(id).forEach(([key])=>facetCounts.set(key,1+(facetCounts.get(key)||0)));
      if(candidate.context){contextCount++;pages.add(candidate.page);}
      trace.push({step:trace.length+1,id,reason,gain:candidate.gain,components:{semanticReach:candidate.reach,facetDiversity:round(candidate.diversity),semanticExpansion:round(candidate.expansion),navigationOnly:round(candidate.navigation)},
        newSemanticIds:candidate.newlyReached.sort(compare),semanticDegree:candidate.degree,tieCount:ties.length,tiedIds:ties.slice(0,16),tiesTruncated:ties.length>16,tieRule:'equal rounded gain -> semantic degree descending -> exact ID ascending'});
    };
    for(const id of [...new Set(pinned)])if(selected.length<cap&&catalog.has(id))commit(evaluate(id),'pinned focus');
    while(selected.length<cap){
      let best=null,ties=[];
      for(const id of ids){
        if(chosen.has(id)||contextNode(catalog.get(id))&&contextCount>=contextQuota)continue;
        const candidate=evaluate(id);
        if(!best||candidate.gain>best.gain){best=candidate;ties=[id];}
        else if(candidate.gain===best.gain){ties.push(id);if(candidate.degree>best.degree||candidate.degree===best.degree&&compare(id,best.id)<0)best=candidate;}
      }
      if(!best)break;
      commit(best,'greedy marginal gain',ties);
    }
    return {nodes:selected,audit:{version:'kg-marginal-coverage/1',cap,selectedIds:selected.map(node=>node.id||node.node_id),
      candidateCount:ids.length,semanticEdgeCount:semantic.length,excludedContextEdges:edges.filter(edge=>edge.slot_navigation||edge.semantic===false).length,
      semanticReachCount:reached.size,contextQuota,contextSelected:contextCount,missingPins:[...new Set(pinned)].filter(id=>!catalog.has(id)),pinsOutsideCap:[...new Set(pinned)].filter(id=>catalog.has(id)&&!chosen.has(id)),
      formula:'gain = new eligible semantic closed-neighborhood IDs + sum(facet weight/(1+selected facet count)) + 2*sum(w/(1+w) to selected semantic neighbors) + navigation-only credit. Facets: community 2.5, theme 1.5, domain 1, type .75. Context credit .05 + .25 for a new source page; pinned-slot literal anchor credit 1. Context edges never add semantic reach or expansion. Unpinned context nodes <= floor(cap/8), minimum 1; pins precede greedy selection.',trace}};
  }

  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  function literalMarkup(value,terms=[],{focalSlot=''}={}){
    const text=String(value??''),spans=[];
    const markers=focalSlot?[...text.matchAll(/\[\[REDACTION_SLOT:\d+:([^\]]+)\]\]/g)].filter(match=>match[1]===focalSlot).map(match=>match[0]):[];
    for(const term of [...new Set([...terms,...markers].map(String).filter(Boolean))]){
      let start=0,index;
      while((index=text.indexOf(term,start))!==-1){
        const end=index+term.length,word=char=>Boolean(char&&/[\p{L}\p{N}_]/u.test(char));
        if(!(word(term[0])&&word(text[index-1])||word(term.at(-1))&&word(text[end])))spans.push({start:index,end});
        start=end;
      }
    }
    const merged=[];
    for(const span of spans.sort((a,b)=>a.start-b.start||b.end-a.end)){
      const last=merged.at(-1);
      if(last&&span.start<last.end)last.end=Math.max(last.end,span.end);else merged.push({...span});
    }
    let cursor=0,html='';
    for(const span of merged){const part=text.slice(span.start,span.end),focal=markers.some(marker=>part.includes(marker));html+=escape(text.slice(cursor,span.start))+(focal?'<mark class="focal-source-slot" data-focal-slot="'+escape(focalSlot)+'">':'<mark>')+escape(part)+'</mark>';cursor=span.end;}
    return html+escape(text.slice(cursor));
  }

  const MOTION=Object.freeze({orbitRate:.024,frameMs:1000/30,stallMs:250,maxStepPx:24,returnMs:720,maxReturnMs:2400});
  const ease=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};

  function packed(points,{gap=2,aspect=1}={}){
    if(!points.length)return {points:[],width:0,height:0};
    const radius=Math.max(0,...points.map(p=>p.r)),pitch=2*radius+gap;
    const columns=Math.max(1,Math.ceil(Math.sqrt(points.length*Math.max(.1,aspect)*Math.sqrt(3)/2*1.4)));
    const rows=Math.ceil(points.length*1.4/columns),sites=[],result=[];
    for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
      const x=column+(row%2)*.5-(columns-.5)/2,y=(row-(rows-1)/2)*Math.sqrt(3)/2;
      sites.push({x,y,score:(x/Math.max(1,columns/2))**2+(y/Math.max(1,rows*Math.sqrt(3)/4))**2});
    }
    sites.sort((a,b)=>a.score-b.score||Math.atan2(a.y,a.x)-Math.atan2(b.y,b.x)||a.x-b.x);
    for(let i=0;i<points.length;i++){
      // Individual radius slack adds organic variation while retaining pair clearance.
      const jitter=radius-points[i].r+gap*.18;
      result.push({...points[i],x:sites[i].x*pitch+Math.sin(i*2.3999632297)*jitter,
        y:sites[i].y*pitch+Math.cos(i*2.3999632297)*jitter});
    }
    const minX=Math.min(...result.map(p=>p.x-p.r)),maxX=Math.max(...result.map(p=>p.x+p.r));
    const minY=Math.min(...result.map(p=>p.y-p.r)),maxY=Math.max(...result.map(p=>p.y+p.r));
    for(const p of result){p.x-=(minX+maxX)/2;p.y-=(minY+maxY)/2;}
    return {points:result,width:maxX-minX,height:maxY-minY,columns,rows};
  }

  function overlaps(points,gap=0,tolerance=.05){
    const size=Math.max(1,...points.map(p=>2*p.r+gap)),cells=new Map();let count=0;
    for(const a of points){
      const cx=Math.floor(a.x/size),cy=Math.floor(a.y/size);
      for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(const b of cells.get(x+':'+y)||[])
        if(Math.hypot(a.x-b.x,a.y-b.y)<a.r+b.r+gap-tolerance)count++;
      const key=cx+':'+cy;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(a);
    }
    return count;
  }

  function relax(points,{steps=1,pull=.09,gap=6,anchor=null,maxStep=24,passes=2}={}){
    const project=p=>{
      if(!p.band||p.fixed)return;
      const d=Math.hypot(p.x,p.y),low=p.band.inner+p.r,high=p.band.outer-p.r;
      const r=low<=high?Math.max(low,Math.min(high,d)):(p.band.inner+p.band.outer)/2;
      if(d>.00001){p.x*=r/d;p.y*=r/d;}else{p.x=r;p.y=0;}
    };
    for(let step=0;step<steps;step++){
      for(const p of points)if(p.id!==anchor&&!p.fixed){const dx=p.homeX-p.x,dy=p.homeY-p.y,d=Math.hypot(dx,dy),factor=d?Math.min(pull,maxStep/d):0;p.x+=dx*factor;p.y+=dy*factor;}
      for(const p of points)project(p);
      for(let pass=0;pass<passes;pass++){
        const cellSize=Math.max(24,...points.map(p=>p.r*2+gap)),cells=new Map();
        const origins=points.map(p=>({x:p.x,y:p.y}));
        for(let i=0;i<points.length;i++){
          const a=points[i],cx=Math.floor(a.x/cellSize),cy=Math.floor(a.y/cellSize);
          for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(const b of cells.get(x+':'+y)||[]){
            let dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy),minimum=a.r+b.r+gap;
            if(d>=minimum-.01)continue;
            if(d<.001){dx=1;dy=.618;d=Math.hypot(dx,dy);}
            const push=Math.min(minimum-d+.02,maxStep),af=a.fixed||a.id===anchor,bf=b.fixed||b.id===anchor;
            if(af&&bf)continue;
            const share=af?0:bf?1:.5;
            a.x+=dx/d*push*share;a.y+=dy/d*push*share;b.x-=dx/d*push*(1-share);b.y-=dy/d*push*(1-share);
          }
          const key=Math.floor(a.x/cellSize)+':'+Math.floor(a.y/cellSize);
          if(!cells.has(key))cells.set(key,[]);cells.get(key).push(a);
        }
        for(let i=0;i<points.length;i++){
          const p=points[i],origin=origins[i],dx=p.x-origin.x,dy=p.y-origin.y,d=Math.hypot(dx,dy);
          if(d>maxStep){p.x=origin.x+dx/d*maxStep;p.y=origin.y+dy/d*maxStep;}
          project(p);
        }
      }
    }
    return points;
  }
  return {selectCoverage,semanticEdge,literalMarkup,relax,packed,overlaps,MOTION,ease};
});

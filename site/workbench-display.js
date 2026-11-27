// Presentation projections only. All returned rows/proofs retain native identity.
const rows=value=>Array.isArray(value)?value:[];
const descriptionKey=value=>String(value??'').trim().replace(/\s+/g,' ');

export function displayReadings(values,describe,{preferredId=''}={}){
  const groups=new Map();
  for(const row of rows(values)){
    if(!row?.reading?.id||!rows(row.candidates).length)continue;
    const key=descriptionKey(describe(row.reading));
    if(!key)continue;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups.values()].map(group=>group.find(row=>row.reading.id===preferredId)||group[0]);
}

export function displayReadingId(values,describe,preferredId=''){
  const visible=displayReadings(values,describe,{preferredId});
  const preferred=rows(values).find(row=>row.reading?.id===preferredId);
  return visible.find(row=>row.reading.id===preferredId)?.reading.id||
    (preferred&&visible.find(row=>descriptionKey(describe(row.reading))===descriptionKey(describe(preferred.reading)))?.reading.id)||
    visible[0]?.reading.id||'';
}

const literal=proof=>proof&&typeof proof.canonical_page_id==='string'&&typeof proof.document_id==='string'&&
  /^\d{4}-\d{2}-\d{2}$/.test(proof.date||'')&&/^[a-f0-9]{64}$/.test(proof.page_sha256||'')&&
  Number.isSafeInteger(proof.start)&&Number.isSafeInteger(proof.end)&&proof.start>=0&&proof.end>proof.start&&
  typeof proof.text==='string'&&Array.from(proof.text).length===proof.end-proof.start;
const realNode=node=>node?.is_graph_node===true&&node.navigation_only!==true&&node.outside_kg!==true&&
  !node.aggregate_kind&&!String(node.id).startsWith('hierarchy:')&&
  !['Community','Theme','Domain','SuperCommunity','Source passage','source_passage','source_readout','query'].includes(node.type);

export function sourceGraphHops(trace,path){
  if(!trace||!path||path.route_mode==='DIRECT_SOURCE_HANDOFF'||!rows(trace.paths).includes(path)||
      !['RECORDED_SOURCE_ROUTE','RECORDED_RELATION_NOMINATION','POSTRUN_GRAPH_VIEW'].includes(path.route_mode)||
      !Array.isArray(path.steps)||new Set(path.steps).size!==path.steps.length)return 0;
  const steps=new Map(rows(trace.steps).map(step=>[step.id,step])),seenEdges=new Set(),visited=new Set();
  let last=null,count=0;
  for(const id of path.steps){
    const step=steps.get(id);if(!step)return 0;
    if(!rows(step.edges).length)continue;
    if(step.kind!=='SOURCE_GRAPH_NAVIGATION')return 0;
    const nodes=new Map(rows(step.nodes).map(node=>[node.id,node]));
    for(const edge of step.edges){
      if(edge.kind!=='SOURCE_ASSERTION'||edge.is_graph_edge===false||edge.navigation_only===true||
          edge.native_source_direction_preserved!==true||typeof edge.source_row_id!=='string'||!edge.source_row_id||!literal(edge.citation)||
          !rows(step.source_refs).some(proof=>['canonical_page_id','document_id','date','page_sha256','start','end','text'].every(key=>proof?.[key]===edge.citation[key]))||
          !realNode(nodes.get(edge.source))||!realNode(nodes.get(edge.target))||edge.source===edge.target||
          ![edge.source,edge.target].includes(edge.traversal_from)||![edge.source,edge.target].includes(edge.traversal_to)||
          edge.traversal_from===edge.traversal_to||last!==null&&last!==edge.traversal_from||
          seenEdges.has(edge.source_row_id)||visited.has(edge.traversal_to))return 0;
      if(last===null)visited.add(edge.traversal_from);
      seenEdges.add(edge.source_row_id);visited.add(edge.traversal_to);last=edge.traversal_to;count++;
    }
  }
  return Number.isSafeInteger(path.graph_hops)&&count===path.graph_hops?count:0;
}

export function sourceLocation(proof){
  const page=proof.physical_page??proof.earlier_page;
  const location=Number.isSafeInteger(page)&&page>0?
    (proof.corpus==='cib'?'Page ':'Transcript page ')+page:'Source text';
  return [proof.document_id||'Document not recorded',proof.date||'Date not recorded',location].join(' / ');
}

export function appendDigestText(host,text,sources,onSource,doc=globalThis.document){
  const byId=new Map(rows(sources).map(proof=>[proof.id,proof]));let cursor=0;
  for(const match of text.matchAll(/\bS\d+\b/g)){
    host.append(doc.createTextNode(text.slice(cursor,match.index)));
    const proof=byId.get(match[0]);if(!proof)throw Error('Unbound digest source label');
    const button=doc.createElement('button');button.type='button';button.className='workbench-digest-citation';
    button.textContent=match[0];button.dataset.digestSource=proof.id;
    button.title=sourceLocation(proof);button.setAttribute('aria-label',proof.id+': '+sourceLocation(proof));
    button.onclick=()=>onSource(proof);host.append(button);cursor=match.index+match[0].length;
  }
  host.append(doc.createTextNode(text.slice(cursor)));return host;
}

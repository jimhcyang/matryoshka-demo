/* Presentation actions reference saved objects; they never extend native topology. */
export const NAVIGATION_CONTRACT='saved-walk-navigation/2';

export function buildSavedWalkPlan(trace,path){
  if(!trace.paths.includes(path))throw Error('The selected path is not in this saved trace.');
  const steps=path.steps.map(id=>trace.steps.find(step=>step.id===id));
  if(!steps.length||steps.some(step=>!step))throw Error('The saved step sequence is incomplete.');
  const nodes=new Map();
  for(const step of steps)for(const node of step.nodes)if(node.is_graph_node===true)nodes.set(node.id,node);
  if(nodes.size&&path.route_mode!=='POSTRUN_GRAPH_VIEW')throw Error('Graph presentation is not licensed by this saved path mode.');
  const actions=[];let last=null,links=0;
  const community=(node,step)=>{actions.push({kind:'community',title:'Community',node,step});last=node.id;};
  for(const step of steps){
    const actual=step.nodes.filter(node=>node.is_graph_node===true);
    const used=new Set();
    for(const edge of step.edges){
      // Query/display links are not graph traversal, even if they have endpoint IDs.
      if(!nodes.has(edge.source)||!nodes.has(edge.target)){
        if(step.kind==='SOURCE_GRAPH_NAVIGATION')throw Error('A saved graph edge lacks actual graph-node endpoints.');
        continue;
      }
      const from=edge.traversal_from||edge.source,to=edge.traversal_to||edge.target;
      if(from===to||!((from===edge.source&&to===edge.target)||(from===edge.target&&to===edge.source)))throw Error('Saved traversal differs from its source edge endpoints.');
      const find=id=>actual.find(node=>node.id===id)||nodes.get(id),origin=find(from),target=find(to);
      if(last!==from)community(origin,step);
      actions.push({kind:'connection',title:'Connection '+(++links),node:target,previousNode:origin,connection:edge,step});
      last=to;used.add(from);used.add(to);
    }
    for(const node of actual)if(!used.has(node.id)&&last!==node.id)community(node,step);
    if(step.kind==='SOURCE_READOUT')actions.push({kind:'source',title:'Source',step});
  }
  if(!actions.some(action=>action.kind==='source'))throw Error('This saved path has no exact source readout.');
  return {version:NAVIGATION_CONTRACT,actions,steps,routeMode:path.route_mode,graphNodeCount:nodes.size};
}

export function savedWalkNavigationContext({row,saved,config,reading,query_sha256,trace,path,step}){
  if(!path.steps.includes(step.id)||trace.steps.find(value=>value.id===step.id)!==step)throw Error('Navigation step is not in the selected saved path.');
  return {version:NAVIGATION_CONTRACT,caseInfo:row.case,config,reading_id:reading,query_sha256,
    native_checkpoint:saved.native_checkpoint,trace_ref:saved.trace_refs?.[reading],trace,
    path_id:path.id,step_id:step.id,route_mode:path.route_mode,
    strictly_before:row.case.date,whole_origin_excluded:row.case.document_id};
}

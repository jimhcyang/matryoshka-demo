/* Legacy selectors resolve one exact saved path, then use the original map. */
export function savedGuideWalkURL(selection,row,trace,base) {
  if(selection.case_id!==row.case.case_id||!row.configurations[selection.config]||
      trace.case_id!==selection.case_id||trace.config!==selection.config||trace.reading_id!==selection.reading||
      !/^\d+$/.test(selection.route_index))throw Error('The guide does not name one bound saved execution.');
  const matches=trace.paths.filter(path=>path.id===selection.candidate_id||path.candidate_or_atom_id===selection.candidate_id||
    path.candidate_or_atom_id.split('/').at(-1)===selection.candidate_id);
  const index=Number(selection.route_index),path=matches[index];
  if(!Number.isSafeInteger(index)||!path)throw Error('The requested saved route is unavailable.');
  const url=new URL(base),values={walk_case:row.case.case_id,walk_config:selection.config,walk_reading:selection.reading,
    walk_path:path.id,...Object.fromEntries(['resource_id','registry_sha256','index_sha256'].map(k=>[k,row.resource_binding[k]]))};
  const keys=['guide_source','guide_start','guide_end','guide_hash'];
  if(keys.some(k=>url.searchParams.has(k))){
    if(keys.some(k=>url.searchParams.getAll(k).length!==1))throw Error('Mixed source handoff selectors.');
    const lookup=trace.sources||trace.source_refs_by_id||{},proofs=(path.decision_source_refs||[]).map(p=>typeof p==='string'?lookup[p]:p);
    const found=proofs.filter(p=>p?.canonical_page_id===url.searchParams.get('guide_source')&&
      String(p.start)===url.searchParams.get('guide_start')&&String(p.end)===url.searchParams.get('guide_end')&&p.page_sha256===url.searchParams.get('guide_hash'));
    if(new Set(found.map(p=>JSON.stringify([p.document_id,p.date,p.text]))).size!==1)
      throw Error('The source handoff is not the selected final quotation.');
    for(const key of keys)values[key.replace('guide_','walk_')]=url.searchParams.get(key);
  }
  for(const key of [...url.searchParams.keys()])if(key.startsWith('guide_')||['guide','guide_data','guide_ref'].includes(key))url.searchParams.delete(key);
  for(const [key,value] of Object.entries(values))url.searchParams.set(key,String(value));
  return url.href;
}

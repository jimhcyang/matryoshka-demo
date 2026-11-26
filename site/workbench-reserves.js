// Optional saved reserve, never a reconstruction from audits or a new ranking.
export function savedReserveCandidates(branch){
  if(branch?.reserve_candidates==null)return [];
  const primary=branch.candidates,reserve=branch.reserve_candidates;
  if(!Array.isArray(primary)||primary.length!==5||primary.some((c,i)=>typeof c?.id!=='string'||!c.id||c.rank!==i+1)||
      !Array.isArray(reserve)||reserve.length>5)return [];
  const ids=new Set(primary.map(c=>c.id));
  if(ids.size!==primary.length)return [];
  for(const [index,item] of reserve.entries()){
    if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.fill!=='string'||!item.fill.trim()||item.rank!==index+6)return [];
    ids.add(item.id);
  }
  return reserve;
}

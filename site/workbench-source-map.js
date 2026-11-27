// A presentation of recorded source accounts, never a new retrieval certificate.
import {mountEvidenceMap} from './evidence-map.js';

export function mountSourceAccountMap(host,{data,onSource,onDetails,formatText,assertCurrent}){
  assertCurrent();const map=data.map;
  if(!map||!Array.isArray(map.trace?.paths))throw Error('Verified source-account map required');
  const view=mountEvidenceMap(host,{...map,task:data.task,formatText,onSource:proof=>{assertCurrent();onSource(proof);},
    onNode:record=>{assertCurrent();onDetails?.(record);},
    onEdge:edge=>{
      assertCurrent();onDetails?.({title:'Source account',text:'This connects an input fact with its recorded source quotation. It is not an original KG search edge.',
        kind:edge.kind,source:edge.source,target:edge.target,proof:edge.citation});
    }});
  host.dataset.mapMethod='RECORDED_SOURCE_ACCOUNTS';
  host.dataset.originalTraversalClaimed='false';
  const help=host.querySelector('[data-testid="evidence-map-provenance-help"]');if(help)help.hidden=true;
  const compact=host.querySelector('[data-testid="evidence-map-compact"]');
  if(compact){compact.checked=true;compact.dispatchEvent(new Event('change'));}
  return view;
}

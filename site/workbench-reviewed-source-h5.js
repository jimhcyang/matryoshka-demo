// Closed version dispatch. The original V2 reader remains byte-identical.
import * as prior from './workbench-reviewed-source-v2.js';
import * as h5 from './workbench-h-source-v5.js';
import {mountFinalDigest} from './workbench-final-digest.js';
export const REVIEWED_SOURCE_METHOD=prior.REVIEWED_SOURCE_METHOD;
export const REVIEWED_SOURCE_METHOD_IDS=Object.freeze([...prior.REVIEWED_SOURCE_METHOD_IDS,h5.H5_METHOD_ID]);
const routes=new WeakMap(),attempts=new WeakMap();
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const fail=message=>{throw Error('Reviewed source dispatch: '+message);};
export function reviewedSourceEndpoint(pin,options){return (pin?.method_id===h5.H5_METHOD_ID?h5:prior).reviewedSourceEndpoint(pin,options);}
export async function loadReviewedSourceMethod(options){
  const record=options?.record,token=Object.freeze({});if(record&&typeof record==='object')attempts.set(record,token);
  const api=options?.row?.reviewed_source_assessment?.method_id===h5.H5_METHOD_ID?h5:prior;
  const handle=await api.loadReviewedSourceMethod(options);if(handle==null)return null;
  if(attempts.get(record)!==token||options.signal?.aborted)fail('late or cancelled source-method verification');
  routes.set(handle,{api,record,row:options.row,token,signal:options.signal});return handle;
}
function current(handle){const r=routes.get(handle);if(!r||attempts.get(r.record)!==r.token||r.signal?.aborted)fail('verify the exact current source method before rendering');r.api.reviewedSourceSummary(handle);return r;}
export function reviewedSourceSummary(handle){const r=current(handle);return r.api.reviewedSourceSummary(handle);}
export function renderReviewedSourceWorkspace(handle,options={}){
  const r=current(handle),view=handle.view,record=r.record,assertCurrent=()=>{current(handle);};
  const citations=view.atoms.flatMap(a=>[...a.evidence.flatMap(e=>[e.citation,e.qualification_citation]),...(a.held_source_context||[]).flatMap(e=>e.citation?[e.citation]:[])]);
  const onSource=proof=>{assertCurrent();if(!citations.some(p=>same(p,proof)))fail('source callback outside the verified view');return options.onSource(proof);};
  const {renderVerifiedDigest,...rest}=options,wrapped={...rest,onSource};
  for(const key of ['onOrigin','onBaseline','onDetails'])if(typeof rest[key]==='function')wrapped[key]=(...args)=>{assertCurrent();return rest[key](...args);};
  const nodes=r.api.renderReviewedSourceWorkspace(handle,wrapped);assertCurrent();
  if(renderVerifiedDigest!=null){const final=nodes.at(-1);if(!final||typeof final.append!=='function')fail('final workspace section missing');
    const binding={case_id:view.case.case_id,config:record.config,method_id:view.method_id,query_sha256:view.query_sha256,
      original_view_sha256:view.original_view_sha256,public_view_sha256:view.sha256,native_checkpoint_sha256:view.original_native_ref.sha256,
      native_checksum:record.native_checksum,source_view_policy:structuredClone(view.source_view_policy)};
    mountFinalDigest(final,{binding,assertCurrent,onSource},renderVerifiedDigest);
  }
  return nodes;
}

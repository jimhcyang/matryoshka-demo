// Additive dispatch only. All five previous H5 assets are exact delegates.
import * as prior from './workbench-reviewed-source-h5.js';
import * as r from './workbench-source-realized-r.js';
export const REVIEWED_SOURCE_METHOD=prior.REVIEWED_SOURCE_METHOD;
export const REVIEWED_SOURCE_METHOD_IDS=Object.freeze([...prior.REVIEWED_SOURCE_METHOD_IDS,r.R_METHOD_ID]);
const routes=new WeakMap(),attempts=new WeakMap();
const fail=()=>{throw Error('Reviewed source dispatch: exact current method selection required');};
const apiFor=pin=>pin?.method_id===r.R_METHOD_ID?r:prior;
export function reviewedSourceEndpoint(pin,options){return apiFor(pin).reviewedSourceEndpoint(pin,options);}
export async function loadReviewedSourceMethod(options){
  const record=options?.record,token=Object.freeze({});if(record&&typeof record==='object')attempts.set(record,token);
  const api=apiFor(options?.row?.reviewed_source_assessment),handle=await api.loadReviewedSourceMethod(options);
  if(handle==null)return null;if(attempts.get(record)!==token||options.signal?.aborted)fail();
  routes.set(handle,{api,record,token,signal:options.signal});return handle;
}
function current(handle){const r=routes.get(handle);if(!r||attempts.get(r.record)!==r.token||r.signal?.aborted)fail();r.api.reviewedSourceSummary(handle);return r;}
export function reviewedSourceSummary(handle){return current(handle).api.reviewedSourceSummary(handle);}
export function renderReviewedSourceWorkspace(handle,options={}){
  const route=current(handle),wrapped={...options,assertSelectionCurrent:()=>current(handle)};
  for(const key of ['onSource','onOrigin','onBaseline','onDetails'])if(typeof options[key]==='function')wrapped[key]=(...args)=>{current(handle);return options[key](...args);};
  if(typeof options.renderVerifiedDigest==='function')wrapped.renderVerifiedDigest=context=>{current(handle);return options.renderVerifiedDigest(Object.freeze({...context,
    assertCurrent:()=>{current(handle);return context.assertCurrent();},onSource:proof=>{current(handle);return context.onSource(proof);}}));};
  return route.api.renderReviewedSourceWorkspace(handle,wrapped);
}

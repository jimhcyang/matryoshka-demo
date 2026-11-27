// Public route identity comes from the exact current index, never a name alias.
import {check,same} from './workbench-digest-wire.js';
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function realizedDigestResource(row,record){
  const r=row?.resource_binding,index=record?.index_ref,corpus=row?.case?.corpus;
  check(r&&same(Object.keys(r).sort(),['corpus','graph_id','hierarchy_id','index_sha256','registry_sha256','resource_id','source_status'])&&index&&r.corpus===corpus&&index.corpus===corpus&&sha(index.sha256)&&index.sha256===r.index_sha256&&
    sha(index.registry_sha256)&&index.registry_sha256===r.registry_sha256&&r.source_status===index.source_status,
    'R current resource/index/corpus pins differ');
  const nested=index.native_index_ref;
  check(nested&&nested.sha256===index.sha256,'R original and execution index hashes differ');
  let id;
  if(index.resource_id===null){
    const b=nested.binding;
    check(index.source_status==='INCUMBENT_NOT_MIGRATED'&&['iran','vietnam'].includes(corpus)&&b?.corpus===corpus&&
      typeof b.graph_id==='string'&&b.graph_id&&b.graph_id===r.graph_id&&b.hierarchy_id===r.hierarchy_id&&
      typeof b.hierarchy_id==='string'&&b.hierarchy_id&&b.evidence_policy==='confidential_only'&&
      !Object.hasOwn(nested,'resource_id')&&index.path===nested.path,'R exact incumbent nested resource bridge required');
    id=b.graph_id;
  }else{
    check(index.source_status==='CURRENT_NATIVE_RESOURCE_EXPLICIT'&&typeof index.resource_id==='string'&&
      index.resource_id&&nested.resource_id===index.resource_id,'R explicit original resource identity differs');
    id=index.resource_id;
  }
  check(r.resource_id===id,'R public resource ID differs from its exact original index');
  if(record.resource_binding){
    const actual=record.resource_binding;
    for(const k of ['corpus','graph_id','hierarchy_id','source_status','index_sha256','registry_sha256'])
      check(actual[k]===r[k],'R condition resource binding differs');
    check(actual.resource_id===id||(index.resource_id===null&&actual.resource_id===null),'R condition resource identity differs');
  }
  return Object.freeze({...r,resource_id:id});
}

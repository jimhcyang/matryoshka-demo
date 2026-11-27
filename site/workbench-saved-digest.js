// Exact typed dispatcher; source R never falls through to MH/native summaries.
import {renderSourceDigest} from './workbench-reviewed-digest.js';
import {renderRealizedRedactionDigest} from './workbench-realized-digest.js';
const MH=new Set(['reviewed_source_model_accounts_v3_coverage1','reviewed_source_model_accounts_v3_v4_explicit_composite1','reviewed_source_model_accounts_v3_temporal_qualified1','reviewed_h_source_views_issue_direction_document_voice5']);
let epoch=0,previous=null;
export async function renderSavedSourceDigest(context,options){
  const token=++epoch;previous?.replaceChildren();previous?.remove();previous=null;
  const current=()=>{if(token!==epoch)throw Error('Saved source digest: selection was superseded');return context.assertCurrent();};
  const wrapped={binding:context?.binding,assertCurrent:current,onSource:p=>{current();const value=context.onSource(p);current();return value;}};
  try{
    current();const id=context.binding?.method_id,row=options?.row;let node;
    if(id==='source_realized_redaction_v1'){
      if(row?.case?.task!=='redaction'||!row.source_realized_digest)throw Error('Saved source digest: exact R report pin required');
      node=await renderRealizedRedactionDigest(wrapped,options);
    }else if(MH.has(id)){
      if(!['mosaic','hypothesis'].includes(row?.case?.task)||!row.reviewed_source_digest)throw Error('Saved source digest: exact MH report pin required');
      node=await renderSourceDigest(wrapped,options);
    }else throw Error('Saved source digest: unsupported typed method');
    current();previous=node;return node;
  }catch(error){if(token===epoch){previous?.replaceChildren();previous?.remove();previous=null;}throw error;}
}

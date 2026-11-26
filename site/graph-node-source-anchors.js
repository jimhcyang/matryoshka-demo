/* Exact retained native quotation anchors, never generated-label grounding. */
const SHA=/^[a-f0-9]{64}$/;
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(sorted):sorted(value):value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
function sorted(value){return Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;}
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
let pending;
export async function nativeNodeSourceProofs(nodeId,binding){
  if(document.querySelector('meta[name="graph-node-source-proof-index"]')){
    const {chunkedNodeSourceProofs}=await import('./graph-source-proof-store.js');
    return chunkedNodeSourceProofs(nodeId,binding);
  }
  const meta=document.querySelector('meta[name="graph-node-source-proofs"]');if(!meta)return [];
  if(!SHA.test(meta.dataset.contentSha256||''))throw Error('Native node source proof pin is missing.');
  if(!pending)pending=(async()=>{
    const url=new URL(meta.content,document.baseURI),expected=new URL('./graph-node-source-proofs.js',import.meta.url);
    if(url.href!==expected.href||url.origin!==location.origin)throw Error('Native node source proof module is not local.');
    const {default:data}=await import(url.href);
    if(await digest(data)!==meta.dataset.contentSha256||data.version!=='graph-native-node-source-proofs/1'||
        data.graph_or_source_modified!==false||data.inference_calls!==0||!Array.isArray(data.rows)||data.rows.length>512)
      throw Error('Native node source proof content changed.');
    return data;
  })();
  const data=await pending;
  if(data.binding.graph_id!==binding.graph_run_id||data.binding.hierarchy_id!==binding.hierarchy_run_id||
      data.binding.resource_id!==binding.source_resource?.id)return [];
  return data.rows.filter(row=>row.node_id===nodeId);
}

export async function exactNodeSourceAnchor(proof,page,{nodeId,documentId,date,release}){
  if(proof.node_id!==nodeId||proof.document_id!==documentId||proof.document_id!==page.document_id&&page.document_id!=null||
      proof.date!==date||proof.canonical_page_id!==(page.canonical_page_id||page.id)||proof.source_ascription_only!==true||
      !['earlier_canonical_page_text','later_canonical_page_text','canonical_source_segment_text'].includes(proof.coordinate_system)||!SHA.test(proof.page_sha256||'')||
      !Number.isSafeInteger(proof.start)||!Number.isSafeInteger(proof.end)||proof.start<0||proof.end<=proof.start||
      typeof proof.text!=='string'||Array.from(proof.text).length!==proof.end-proof.start)
    throw Error('The node quotation changes its source identity or coordinates.');
  if(proof.coordinate_system==='later_canonical_page_text'&&release!=='later')
    throw Error('A later-side quotation cannot be presented as an earlier source.');
  const contextOnly=proof.proof_kind==='native_source_edge_unit_context';
  if(contextOnly&&proof.node_assertion_certified!==false)throw Error('Connection context is not an own-node assertion.');
  const chars=Array.from(page.text),hash=await digest(page.text);
  if(hash===proof.page_sha256){
    if(chars.slice(proof.start,proof.end).join('')!==proof.text)throw Error('The native node quotation does not replay.');
    return {start:proof.start,end:proof.end,text:proof.text,basis:contextOnly?'native_source_connection_context':'native_source_span'};
  }
  // A BOTH observation may be displayed in its exact paired later transcript.
  // This is literal quote relocation only, never entailment or a new source vote.
  const index=page.text.indexOf(proof.text);
  if(contextOnly||proof.coordinate_system!=='earlier_canonical_page_text'||release!=='later'||proof.visibility!=='both'||index<0||page.text.indexOf(proof.text,index+1)!==-1)
    throw Error('The node quotation does not uniquely replay in this source release.');
  const start=Array.from(page.text.slice(0,index)).length;
  return {start,end:start+Array.from(proof.text).length,text:proof.text,basis:'exact_quote_in_bound_paired_later_page'};
}

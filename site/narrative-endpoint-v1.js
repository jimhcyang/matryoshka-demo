// Source-owned saved endpoints only. Never infer an endpoint from a fill or label.
const rows=value=>Array.isArray(value)?value:[];
const hash=value=>/^[a-f0-9]{64}$/.test(value||'');
const samePage=(a,b)=>a?.canonical_page_id===b?.canonical_page_id&&a?.page_sha256===b?.page_sha256;
const escapeLiteral=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function labelPattern(label){
  return new RegExp('(?<![\\p{L}\\p{N}_])'+label.trim().split(/\s+/u).map(escapeLiteral).join('\\s+')+'(?![\\p{L}\\p{N}_])','giu');
}
function uniqueLiteralAt(proof,label,quote){
  const matches=[...proof.text.matchAll(labelPattern(label))];
  if(matches.length!==1)return false;
  const start=proof.start+Array.from(proof.text.slice(0,matches[0].index)).length;
  return start===quote.start&&start+Array.from(matches[0][0]).length===quote.end&&matches[0][0]===quote.text;
}
function quoteWithin(proof,start,end,text){
  if(!proof?.canonical_page_id||!hash(proof.page_sha256)||!Number.isInteger(proof.start)||!Number.isInteger(proof.end)||
      !Number.isInteger(start)||!Number.isInteger(end)||start<proof.start||end>proof.end||end<=start||typeof proof.text!=='string'||
      Array.from(proof.text).length!==proof.end-proof.start)return null;
  const literal=Array.from(proof.text).slice(start-proof.start,end-proof.start).join('');
  if(typeof text==='string'&&text!==literal)return null;
  return {...proof,start,end,text:literal};
}
function sourceContributorEndpoint(value,item,caseInfo,selected){
  const proof=value.source_label_proof,quote=value.citation,final=proof?.selected_final_citation,edge=proof?.source_edge_citation;
  const kind=value.type,sourceType={Claim:'claims',Event:'events'}[kind];
  if(!sourceType||value.endpoint_selection!=='SELECTED_CITATION_OWNED_TYPED_SOURCE_CONTRIBUTOR'||
      value.label_kind!=='VERBATIM_SOURCE_CONTRIBUTOR_QUOTE_PREVIEW'||value.is_graph_node!==true||
      typeof value.id!=='string'||!value.id||value.node_id!=null&&value.node_id!==value.id||
      value.postrun_provenance_inspection!==true||value.original_traversal_claimed!==false||
      value.answer_entity_certified!==false||value.identity_or_event_certified!==false||
      value.factual_support_implied!==false||value.hierarchy_membership_is_evidence!==false||
      proof?.analysis!=='EXACT_OWNED_OCCURRENCE_AND_INCIDENT_SOURCE_EDGE_WITHIN_SELECTED_CITATION'||
      proof.native_name_span_claimed!==false||proof.bound_node_kind!==kind||proof.source_type!==sourceType||
      !hash(proof.occurrence_sha256)||!['source_row_id','source_edge_id','source_edge_row_id'].every(k=>typeof proof[k]==='string'&&proof[k])||
      !quoteWithin(quote,quote?.start,quote?.end,quote?.text)||!quote.document_id||!quote.date||
      !(quote.date<caseInfo.date)||quote.document_id===caseInfo.document_id||value.originating_document_id!==quote.document_id)
    return null;
  const contains=(parent,child)=>Boolean(parent&&child&&samePage(parent,child)&&parent.document_id===child.document_id&&parent.date===child.date&&
    quoteWithin(parent,child.start,child.end,child.text));
  if(!contains(proof.native_quote,quote)||proof.native_quote.start!==quote.start||proof.native_quote.end!==quote.end||
      !contains(final,edge)||!contains(edge,quote)||!selected.some(p=>contains(p,final)&&p.start===final.start&&p.end===final.end)||
      value.label!==Array.from(quote.text.trim().replace(/\s+/gu,' ')).slice(0,120).join(''))return null;
  const native=[...rows(item.sources)];
  for(const name of ['evidence','positive_evidence','partial_evidence','counterevidence'])for(const row of rows(item[name])){
    if(row.citation)native.push(row.citation);native.push(...rows(row.citations));
  }
  if(!native.some(p=>contains(p,final)))return null;
  const mother=value.mother_community;
  if(mother!=null&&(typeof mother.community_id!=='string'||!mother.community_id||mother.id!=='hierarchy:community:'+mother.community_id||
      mother.navigation_only!==true||mother.is_evidence!==false||value.parent_id!==mother.id))return null;
  return {node_id:value.id,quote,item_id:item.id,label:value.label,explicit_source_endpoint:true,
    source_contributor_inspection:true,source_kind:kind,source_label_proof:proof,expected_community_id:mother?.community_id||null};
}
function explicitEndpoint(value,item,caseInfo,selected){
  if(value?.endpoint_role==='SOURCE_CONTRIBUTOR')return sourceContributorEndpoint(value,item,caseInfo,selected);
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.id!=='string'||!value.id.trim()||
      value.node_id!=null&&value.node_id!==value.id||value.is_graph_node!==true||
      typeof value.type!=='string'||!value.type.trim()||typeof value.label!=='string'||!value.label.trim()||
      value.endpoint_selection!=='SAVED_CANDIDATE_OR_LITERAL_QUERY_LABEL_IN_SELECTED_QUOTE'||
      value.postrun_provenance_inspection!==true||value.original_traversal_claimed!==false||
      value.factual_support_implied===true||value.identity_or_event_certified===true)return null;
  const proof=value.citation,quote=quoteWithin(proof,proof?.start,proof?.end,value.label);
  if(!quote||!quote.document_id||!quote.date||!(quote.date<caseInfo.date)||quote.document_id===caseInfo.document_id||
      value.originating_document_id!=null&&value.originating_document_id!==quote.document_id)return null;
  const selectedQuote=selected.find(p=>samePage(p,quote)&&p.document_id===quote.document_id&&p.date===quote.date&&
    quoteWithin(p,quote.start,quote.end,quote.text));
  if(!selectedQuote)return null;
  let labelProof=null;
  if(value.label_kind==='DERIVED_LITERAL_LABEL_WITHIN_NATIVE_EXTRACTION_QUOTE'||value.source_label_proof!=null){
    const proof=value.source_label_proof,native=proof?.native_quote,span=proof?.derived_literal_span;
    if(value.label_kind!=='DERIVED_LITERAL_LABEL_WITHIN_NATIVE_EXTRACTION_QUOTE'||
        proof?.native_name_span_claimed!==false||proof.analysis!=='CASE_AND_WHITESPACE_ONLY_UNIQUE_LITERAL_MATCH'||
        typeof proof.stored_label!=='string'||!proof.stored_label.trim()||!Array.isArray(span)||span.length!==2||
        span[0]!==quote.start||span[1]!==quote.end||!samePage(native,quote)||native.document_id!==quote.document_id||native.date!==quote.date||
        !quoteWithin(native,quote.start,quote.end,quote.text)||!uniqueLiteralAt(native,proof.stored_label,quote)||
        !uniqueLiteralAt(selectedQuote,proof.stored_label,quote))return null;
    labelProof=proof;
  }
  if(caseInfo.task==='redaction'){
    if(item.node_id!==value.id)return null;
  }else{
    const types=['person','organization','organisation','org','gpe','loc','location','place'];
    const text=typeof item.text==='string'?item.text:'';
    const literal=labelProof?labelPattern(labelProof.stored_label):new RegExp('(?<![\\p{L}\\p{N}_])'+escapeLiteral(value.label)+'(?![\\p{L}\\p{N}_])','iu');
    if(!types.includes(value.type.toLowerCase())||!literal.test(text))return null;
  }
  const mother=value.mother_community;
  if(mother!=null&&(typeof mother!=='object'||typeof mother.community_id!=='string'||!mother.community_id||
      mother.id!=='hierarchy:community:'+mother.community_id||mother.navigation_only!==true||mother.is_evidence!==false))return null;
  return {node_id:value.id,quote,item_id:item.id,label:value.label,explicit_source_endpoint:true,
    expected_community_id:mother?.community_id||null,...(labelProof?{source_label_proof:labelProof}:{})};
}
export function savedEndpointForPath(record,caseInfo,reading,path){
  const result=record.result||{},key=path.candidate_or_atom_id;
  const items=caseInfo.task==='redaction'?rows((result.redaction||result).readings).find(r=>r.reading?.id===reading)?.candidates:
    rows(result.atoms);
  const matches=rows(items).filter(item=>item.id===key||caseInfo.task==='redaction'&&reading+'/'+item.id===key);
  if(matches.length!==1)return null;
  const item=matches[0],selected=rows(path.decision_source_refs||path.source_refs);
  // An invalid explicit handoff must not silently pick a different legacy endpoint.
  if(path.source_endpoint!=null)return explicitEndpoint(path.source_endpoint,item,caseInfo,selected);
  const owners=[item,...rows(item.evidence),...rows(item.positive_evidence),...rows(item.partial_evidence),...rows(item.counterevidence)];
  for(const owner of owners){
    if(typeof owner.node_id!=='string'||!owner.node_id.trim())continue;
    const proofs=[...rows(owner.sources),...rows(owner.citations),...(owner.citation?[owner.citation]:[])];
    const witnesses=rows(owner.ranking?.features?.source_type_witnesses).filter(w=>w.node_id===owner.node_id);
    const spans=[...witnesses.map(w=>({start:w.start,end:w.end,text:w.label,page:w})),
      ...(!witnesses.length&&Array.isArray(owner.source_span)?[{start:owner.source_span[0],end:owner.source_span[1],text:owner.source_wording}]:[])];
    if(!spans.length&&owner!==item)for(const proof of proofs)spans.push({start:proof.start,end:proof.end,text:proof.text,page:proof});
    for(const span of spans)for(const proof of proofs){
      if(span.page&&!samePage(span.page,proof))continue;
      const quote=quoteWithin(proof,span.start,span.end,span.text);
      if(quote&&selected.some(p=>samePage(p,quote)&&p.start<=quote.start&&p.end>=quote.end))
        return {node_id:owner.node_id,quote,item_id:item.id,label:owner.source_wording||quote.text};
    }
    if(!spans.length)for(const proof of proofs){
      const selectedProof=selected.find(p=>samePage(p,proof)&&p.start<=proof.start&&p.end>=proof.end);
      if(selectedProof)return {node_id:owner.node_id,quote:proof,item_id:item.id,requires_api_owned_quote:true};
    }
  }
  return null;
}
export function verifyEndpointPacket(packet,saved,caseInfo,binding){
  const fail=()=>{throw Error('The saved extracted endpoint is unavailable or does not match its exact source resource.');};
  if(packet?.version!=='current-context-inspection/1'||packet.node_id!==saved.node_id||packet.node?.id!==saved.node_id||
      packet.cutoff!==caseInfo.date||packet.whole_origin_excluded!==caseInfo.document_id||packet.task_support_assessed!==false)fail();
  for(const key of ['resource_id','registry_sha256','index_sha256','graph_id','hierarchy_id'])
    if(!binding?.[key]||packet.resource_binding?.[key]!==binding[key])fail();
  if(packet.node.node_id!=null&&packet.node.node_id!==saved.node_id)fail();
  const quote=saved.requires_api_owned_quote?rows(packet.node.citations).find(p=>samePage(p,saved.quote)&&p.start>=saved.quote.start&&p.end<=saved.quote.end):saved.quote;
  if(!quote)fail();
  if(saved.source_contributor_inspection&&((packet.node.kind||packet.node.type)!==saved.source_kind||
      !rows(packet.node.citations).some(p=>samePage(p,quote)&&p.document_id===quote.document_id&&p.date===quote.date&&
        quoteWithin(p,quote.start,quote.end,quote.text))))fail();
  const community=packet.node.community_id||packet.hierarchy?.community_id||null;
  if(packet.node.community_id&&packet.hierarchy?.community_id&&packet.node.community_id!==packet.hierarchy.community_id)fail();
  if(saved.expected_community_id&&saved.expected_community_id!==community)fail();
  return {node_id:saved.node_id,label:saved.explicit_source_endpoint?saved.label:packet.node.label||saved.label||quote.text,quote,community_id:community,
    graph_id:binding.graph_id,hierarchy_id:binding.hierarchy_id,authority:packet.node.authority||null,
    ...(saved.source_label_proof?{source_label_proof:saved.source_label_proof}:{}),
    ...(saved.source_contributor_inspection?{source_contributor_inspection:true,answer_entity_certified:false}:{})};
}
export function verifyEndpointSource(page,quote,caseInfo,actualHash){
  if(!Number.isInteger(quote.start)||!Number.isInteger(quote.end)||quote.start<0||quote.end<=quote.start||
      typeof quote.text!=='string'||Array.from(quote.text).length!==quote.end-quote.start||!hash(quote.page_sha256)||
      (page?.canonical_page_id||page?.id)!==quote.canonical_page_id||page.document_id!==quote.document_id||page.date!==quote.date||
      !(page.date<caseInfo.date)||page.document_id===caseInfo.document_id||actualHash!==quote.page_sha256||
      typeof page.text!=='string'||Array.from(page.text).slice(quote.start,quote.end).join('')!==quote.text)
    throw Error('The endpoint occurrence does not replay in the selected original source.');
  return quote;
}
export function endpointInspectionURL({caseInfo,config,reading,path,endpoint,routeIndex,binding},base=globalThis.location?.href){
  if(!['iran','vietnam'].includes(caseInfo?.corpus)||path?.source_endpoint?.id!==endpoint?.node_id||
      !caseInfo.case_id||!['llm_readings','llm_atoms','llm_local'].includes(config)||typeof reading!=='string'||
      typeof path.candidate_or_atom_id!=='string'||!path.candidate_or_atom_id||!Number.isInteger(routeIndex)||routeIndex<0||
      typeof binding?.resource_id!=='string'||!binding.resource_id||!hash(binding.registry_sha256)||!hash(binding.index_sha256))
    throw Error('A source-endpoint inspection requires the exact verified cable endpoint and saved selectors.');
  const current=new URL(base),url=new URL('graph-full-v6.html',current);
  for(const [key,value] of Object.entries({corpus:caseInfo.corpus,guide_case:caseInfo.case_id,guide_arm:config,
      guide_reading:reading,guide_candidate:path.candidate_or_atom_id,guide_route:routeIndex,
      resource_id:binding.resource_id,registry_sha256:binding.registry_sha256,index_sha256:binding.index_sha256,
      return_to:current.pathname+current.search}))url.searchParams.set(key,String(value));
  return url.href;
}

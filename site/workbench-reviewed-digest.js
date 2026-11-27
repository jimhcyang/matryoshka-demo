// Separate postrun source-method summary. No native verdict or source gate changes.
import {canonical,check,hash,parseWire,same} from './workbench-digest-wire.js';
const PROTOCOLS=Object.freeze({
  'selected-reviewed-source-digest/3.3/public':Object.freeze({pinVersion:'selected-reviewed-source-digest-public-pin/1',typedPin:false}),
  'selected-reviewed-source-digest/3.4/public':Object.freeze({pinVersion:'selected-reviewed-source-digest-public-pin/2',typedPin:true})
});
export const SOURCE_DIGEST_VERSIONS=Object.freeze(Object.keys(PROTOCOLS));
const METHODS=Object.freeze(['reviewed_source_model_accounts_v3_coverage1','reviewed_source_model_accounts_v3_v4_explicit_composite1','reviewed_source_model_accounts_v3_temporal_qualified1','reviewed_h_source_views_issue_direction_document_voice5']);
const HASH=/^[a-f0-9]{64}$/;
const PROVENANCE=['input_sha256','generation_sha256','body_sha256','raw_response_wire_sha256','response_value_sha256','api_receipt_wire_sha256'];
const BINDING=['case_id','config','method_id','case_sha256','query_sha256','native_checkpoint_sha256','native_checksum','condition_record_sha256','resource_binding_sha256','method_file_sha256','method_packet_sha256','original_view_file_sha256','original_view_sha256','source_policy_sha256','citation_map_sha256','reader_guard_code_sha256','report_sha256','public_view_sha256','public_view_file_sha256'];
const ROOT_FIELDS=['version','kind','available','status','text','binding',...PROVENANCE,'method','source_policy','current_result','assessment_scope','sources','source_scope_notes','method_caveat','placement','native_method','world_truth_certified','postrun','used_for_inference','source_support_reassessed','prose_semantics_reviewed','sha256'];
const PUBLIC=['case_id','task','corpus','query','date','document_id','focal_marker'];
const SCOPE=['original_pages','required_facts','original_slots','processed_slots','reviewed_slots','provider_reviewed_slots','model_accepted_slots','accepted_slots','eligible_accepted_slots','held_slots','review_hold_slots','eligibility_hold_slots','rejected_slots','review_pending_slots','unprocessed_slots','directional_source_view_slots','inspected_pool_completely_processed','inspected_pool_completely_assessed','partial_search','partial_assessment','whole_corpus_search_claimed','partial_source_search','counts_are_not_independent_votes'];
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&same(Object.keys(x).sort(),keys.slice().sort());
const facts=r=>(r.plan?.atoms||[]).filter(a=>a.kind==='proposition'&&a.required!==false);
let active=null;
function retire(){if(active){active.valid=false;active.cleanup?.();active.node?.replaceChildren();active.node?.remove();active=null;}}
function snapshot(row,record,reportRef){return canonical([row.case,row.configurations,row.resource_binding,row.reviewed_source_assessment,row.reviewed_source_digest,
  record.case,record.config,record.native_checkpoint,record.native_checksum,record.native_record_sha256,record.plan?.query_sha256,facts(record),
  record.configuration?.source_view_policy,record.result?.source_view_policy,record.result?.inspected_page_ids,record.registry_ref,record.index_ref,reportRef]);}
function endpointURL(value,path,{row,record,base}){
  check(typeof value==='string','explicit saved endpoint required');const url=new URL(value,base),origin=new URL(base),resource=row.resource_binding;
  check(url.origin===origin.origin&&/^https?:$/.test(url.protocol)&&!url.username&&!url.password&&!url.hash&&url.pathname===path,'only the same-origin exact saved endpoint is permitted');
  const expected={case_id:row.case.case_id,config:record.config,resource_id:resource?.resource_id,registry_sha256:resource?.registry_sha256,index_sha256:resource?.index_sha256};
  check(typeof expected.resource_id==='string'&&expected.resource_id&&HASH.test(expected.registry_sha256)&&HASH.test(expected.index_sha256),'current resource pins required');
  for(const [key,v]of url.searchParams)check(Object.hasOwn(expected,key)&&v===expected[key]&&url.searchParams.getAll(key).length===1,'endpoint scope or duplicate query parameter differs');
  for(const [key,v]of Object.entries(expected))url.searchParams.set(key,v);return url;
}
function node(tag,text,attrs={}){const n=document.createElement(tag);if(text!=null)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;}
function locationLabel(source){const page=source.physical_page??source.earlier_page;return source.document_id+' / '+source.date+(page==null?'':' / '+(source.corpus==='cib'?'page ':'section ')+page);}
function validateSources(data,view){
  check(data.method.label===view.method_label&&data.method_caveat===view.caveat&&same(data.assessment_scope,Object.fromEntries(SCOPE.filter(k=>Object.hasOwn(view.assessment_scope,k)).map(k=>[k,view.assessment_scope[k]]))),'method scope/qualifications differ');
  check(Array.isArray(data.sources)&&data.sources.length>0&&data.sources.length<=256,'nonempty bounded source map required');
  const allowed=view.atoms.flatMap(a=>[...a.evidence.flatMap(e=>[e.citation,e.qualification_citation]),...(a.held_source_context||[]).flatMap(e=>e.citation?[e.citation]:[])]),identities=new Set(),labels=new Map();
  for(const [i,s]of data.sources.entries()){
    check(s.id==='S'+(i+1)&&s.corpus===view.case.corpus&&typeof s.document_id==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s.date)&&HASH.test(s.page_sha256)&&typeof s.canonical_page_id==='string','source map identity differs');
    const identity=canonical([s.corpus,s.document_id,s.date,s.canonical_page_id,s.page_sha256]);check(!identities.has(identity),'duplicate source label/vote');identities.add(identity);
    check(Array.isArray(s.citations)&&s.citations.length>0&&s.citations.length<=256,'source citations required');
    const seenCitations=new Set();
    for(const [j,c]of s.citations.entries()){
      const p=c.citation;check(c.id==='C'+(j+1)&&object(p)&&Number.isSafeInteger(p.start)&&Number.isSafeInteger(p.end)&&p.start>=0&&p.start<p.end&&typeof p.text==='string'&&p.text.length>0&&p.text.length<=100000,'literal source span required');
      check(['corpus','document_id','date','canonical_page_id','page_sha256'].every(k=>p[k]===s[k])&&allowed.some(q=>same(q,p)),'citation is outside the current verified source method');
      const key=canonical(p);check(!seenCitations.has(key),'duplicate source citation');seenCitations.add(key);
    }
    for(const k of ['physical_page','earlier_page'])if(s[k]!=null)check(Number.isSafeInteger(s[k])&&s[k]>0&&s.citations.every(c=>c.citation[k]==null||c.citation[k]===s[k]),'unbound page/section locator');
    labels.set(s.id,s);
  }
  check(data.current_result?.required===view.atoms.length&&Array.isArray(data.current_result.components)&&data.current_result.components.length===view.atoms.length,'current fact denominator differs');
  for(const[a,v]of data.current_result.components.map((a,i)=>[a,view.atoms[i]])){
    check(a.id===v.id&&a.text===v.text&&same(a.query_spans,v.query_spans)&&a.decision===v.status&&a.counts_are_independent_votes===false,'current fact text/order/state differs');
    check(same(a.source_counts,v.source_counts??null)&&a.source_component_complete===(view.case.task==='hypothesis'?null:v.complete_by_model_source_review),'source counts/component completeness differ');
    check(Array.isArray(a.accounts)&&a.accounts.length===v.evidence.length,'source account inventory differs');
    const byID=new Map(v.evidence.map(e=>[e.appraisal_id??e.judgment_id,e])),seen=new Set();
    for(const account of a.accounts){const e=byID.get(account.judgment_id);check(e&&!seen.has(account.judgment_id),'unknown/repeated source account');seen.add(account.judgment_id);
      const held=Boolean(e.temporal_eligibility_hold);check(account.direction===(held?'INSPECTION_CONTEXT_HOLD':e.direction)&&(!held||account.eligible_directional_account===false),'source direction or temporal hold differs');
      for(const [key,proof]of [['quote',e.citation],['qualification',e.qualification_citation]]){const source=labels.get(account[key]?.source_id),c=source?.citations.find(c=>c.id===account[key]?.citation_id);check(c&&same(c.citation,proof),'quote/full qualification source mapping differs');}
      check(/^\d+\.\d{4}$/.test(account.source_alignment_index)&&/^\d+\.\d{4}$/.test(account.facet_coverage),'source indices require four decimals');
      if(view.method_id===METHODS[3])check(same(account.attribution,e.source_attribution)&&account.mode===e.mode&&same(account.qualifier_quotes,e.qualifier_quotes)&&account.argument_quote===e.argument_quote,'H5 attribution/operator/argument qualifications differ');
    }
  }
  const complete=view.case.task==='hypothesis'?null:view.atoms.filter(a=>a.complete_by_model_source_review).length;
  check(data.current_result.source_components_complete===complete&&
    (complete===null?data.current_result.source_account_coverage===null:data.current_result.source_account_coverage===(complete/view.atoms.length).toFixed(4)), 'source coverage is not native/world coverage');
  return labels;
}

export async function renderSourceDigest(context,{verified,endpoint,row,record,reportRef,signal,base=globalThis.location?.href}={}){
  retire();const token={valid:true,node:null};active=token;
  try{
    if(signal){const abort=()=>{if(active===token)retire();};signal.addEventListener('abort',abort,{once:true});token.cleanup=()=>signal.removeEventListener('abort',abort);}
    check(object(row)&&object(record)&&object(reportRef)&&HASH.test(reportRef.sha256)&&typeof verified==='function'&&typeof context?.assertCurrent==='function'&&typeof context?.onSource==='function'&&object(context.binding),'current verified source handle and byte transport required');
    const before=snapshot(row,record,reportRef),expected=structuredClone(context.binding);
    const current=()=>{check(active===token&&token.valid&&!signal?.aborted&&same(context.assertCurrent(),expected)&&same(context.binding,expected)&&snapshot(row,record,reportRef)===before,'stale or revoked digest/source selection');};
    current();const pin=row.reviewed_source_digest,method=row.reviewed_source_assessment;
    check(object(method)&&METHODS.includes(method.method_id)&&PUBLIC.every(k=>record.case?.[k]===row.case[k]),'selected source method/public case required');
    const target=endpointURL(endpoint,'/api/current/analyst-digest',{row,record,base});
    const response=await verified(target.href,signal);current();const parsed=parseWire(response?.decoded),data=parsed.value;
    const protocol=Object.hasOwn(PROTOCOLS,data.version)?PROTOCOLS[data.version]:null;
    check(protocol&&data.kind==='REVIEWED_SOURCE_METHOD'&&HASH.test(data.sha256)&&await hash(parsed.canonicalWithoutSHA)===data.sha256,'closed source digest version/selfhash differs');current();
    if(data.available===false){check(data.case_id===row.case.case_id&&data.config===record.config&&data.method_id===method.method_id&&data.report_sha256===reportRef.sha256&&data.original_view_sha256===method.original_view_sha256&&data.public_view_sha256===method.public_view_sha256&&data.postrun===true&&data.used_for_inference===false,'unavailable digest selection differs');return null;}
    check(exact(data,ROOT_FIELDS)&&data.available===true&&data.status==='SAVED_SOURCE_METHOD_DIGEST'&&data.placement==='AFTER_RESULTS'&&data.native_method===false&&data.world_truth_certified===false&&data.postrun===true&&data.used_for_inference===false&&data.source_support_reassessed===false&&data.prose_semantics_reviewed===false,'not a saved separate postrun digest');
    check(exact(pin,['version',...(protocol.typedPin?['digest_version']:[]),'condition_ref_sha256','text_sha256','binding',...PROVENANCE])&&pin.version===protocol.pinVersion&&(!protocol.typedPin||pin.digest_version===data.version)&&exact(data.binding,BINDING),'exact report-bound digest commitment required');
    const b=data.binding,item=row.configurations?.[record.config];
    check(HASH.test(pin.condition_ref_sha256)&&pin.condition_ref_sha256===item?.condition_ref?.sha256&&same(pin.binding,Object.fromEntries(Object.entries(b).filter(([k])=>k!=='report_sha256'))),'private condition/presentation commitment differs');
    check(PROVENANCE.every(k=>HASH.test(data[k])&&data[k]===pin[k])&&BINDING.filter(k=>!['case_id','config','method_id'].includes(k)).every(k=>HASH.test(b[k])),'generation/request/response/receipt hashes differ');
    check(HASH.test(pin.text_sha256)&&await hash(canonical(data.text))===pin.text_sha256,'saved generated prose commitment differs');current();
    check(b.report_sha256===reportRef.sha256&&b.case_id===row.case.case_id&&b.config===record.config&&b.method_id===method.method_id&&data.method.id===method.method_id&&data.method.native_method===false&&data.method.world_truth_certified===false,'report/case/config/method differs');
    check(b.case_sha256===await hash(canonical(row.case))&&b.query_sha256===await hash(canonical(row.case.query))&&b.query_sha256===record.plan?.query_sha256&&b.query_sha256===expected.query_sha256,'query/native plan differs');current();
    check(b.native_checkpoint_sha256===item.native_checkpoint.sha256&&b.native_checkpoint_sha256===record.native_checkpoint?.sha256&&b.native_checkpoint_sha256===method.original_native_sha256&&b.native_checkpoint_sha256===expected.native_checkpoint_sha256&&b.native_checksum===record.native_checksum&&b.native_checksum===expected.native_checksum,'original native identity differs');
    check(b.method_file_sha256===method.method_ref?.sha256&&b.original_view_file_sha256===method.view_ref?.sha256&&b.original_view_sha256===method.original_view_sha256&&b.original_view_sha256===expected.original_view_sha256&&b.public_view_sha256===method.public_view_sha256&&b.public_view_sha256===expected.public_view_sha256,'selected original/public method view differs');
    check(b.resource_binding_sha256===await hash(canonical(row.resource_binding))&&same(record.resource_binding,row.resource_binding)&&b.source_policy_sha256===await hash(canonical(data.source_policy))&&same(data.source_policy,method.source_view_policy)&&same(data.source_policy,expected.source_view_policy)&&same(data.source_policy,record.configuration?.source_view_policy)&&same(data.source_policy,record.result?.source_view_policy)&&b.citation_map_sha256===await hash(canonical(data.sources)),'resource/source policy/S-label map differs');current();
    const sourceURL=endpointURL(method.endpoint,'/api/current/reviewed-source-accounts',{row,record,base});
    const source=await verified(sourceURL.href,signal);current();const rawView=parseWire(source?.decoded,{integersOnly:false,limit:16*1024**2}),view=rawView.value;
    check(['reviewed-source-workbench-view/1','reviewed-H-source-workbench-view/5'].includes(view.version)&&view.publication_projection_version==='reviewed-source-location-redaction/1'&&view.sha256===b.public_view_sha256&&await hash(rawView.canonicalWithoutSHA)===b.public_view_sha256&&view.original_view_sha256===b.original_view_sha256&&view.method_packet_sha256===b.method_packet_sha256,'byte-verified public source view lineage differs');current();
    check(view.method_id===method.method_id&&same(view.case,row.case)&&view.query_sha256===b.query_sha256&&same(view.source_view_policy,data.source_policy)&&same(facts(record).map(a=>[a.id,a.text,a.query_spans]),view.atoms.map(a=>[a.id,a.text,a.query_spans])),'source view/native required facts differ');
    const labels=validateSources(data,view),words=data.text.trim().split(/\s+/);
    check(words.length>=50&&words.length<=100&&data.text.length<=2500&&!/\/(?:Users|home)\/|file:\/\/|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/i.test(data.text),'bounded public 50-100 word digest required');
    const mentions=[...data.text.matchAll(/\[(S[^\]]*)\]/g)];check(mentions.length>0&&mentions.every(m=>labels.has(m[1]))&&[...data.text.matchAll(/\bS(\d+)\b/g)].every(m=>labels.has('S'+m[1])),'unknown/missing source labels');
    current();const host=node('section',null,{class:'source-method-digest','data-testid':'source-method-digest','data-digest-version':data.version,'data-digest-sha256':data.sha256});
    host.append(node('h3','Analyst summary'));const paragraph=node('p'),links=node('nav',null,{'aria-label':'Summary source documents',class:'workbench-digest-source-key'});
    const makeLink=(id,long=false)=>{const s=labels.get(id),proof=structuredClone(s.citations[0].citation),button=node('button',long?id+' / '+locationLabel(s):'['+id+']',{type:'button',class:'workbench-digest-source','data-testid':'source-digest-citation','data-source-label':id,title:locationLabel(s)});
      button.addEventListener('click',()=>{current();context.onSource(proof);current();});return button;};
    let cursor=0;for(const m of mentions){paragraph.append(document.createTextNode(data.text.slice(cursor,m.index)),makeLink(m[1]));cursor=m.index+m[0].length;}paragraph.append(document.createTextNode(data.text.slice(cursor)));
    for(const id of labels.keys())if(mentions.some(m=>m[1]===id))links.append(makeLink(id,true));
    if(!document.querySelector('link[data-source-digest-style]'))document.head.append(node('link',null,{rel:'stylesheet',href:new URL('./workbench-reviewed-digest.css',import.meta.url).href,'data-source-digest-style':'3.3-3.4'}));
    host.append(paragraph,links);token.node=host;current();return host;
  }catch(error){if(active===token)retire();throw error;}
}


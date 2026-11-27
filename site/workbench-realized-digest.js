// Typed R source summary only. Source/score/native authority remains in its reader.
import {canonical,check,hash,parseWire,same} from './workbench-digest-wire.js';
import {parseRaw,validateEnvelope} from './r-contract.js';
import {realizedDigestResource} from './workbench-realized-digest-resource.js';
export const REALIZED_DIGEST_VERSION='source-realized-redaction-analyst-digest/1/public';
const METHOD='source_realized_redaction_v1',KIND='SOURCE_REALIZED_REDACTION',SHA=/^[a-f0-9]{64}$/;
const PROVENANCE=['input_sha256','generation_sha256','body_sha256','raw_response_wire_sha256','response_value_sha256','api_receipt_wire_sha256'];
const PIN=['version','kind','method_id','native_checkpoint_sha256','native_checksum','original_view_sha256','public_view_sha256','input_sha256','generation_sha256','body_sha256','endpoint','postrun','used_for_inference','placement','condition_ref_sha256','condition_record_sha256','text_sha256','raw_response_wire_sha256','response_value_sha256','api_receipt_wire_sha256'];
const BINDING=['case_id','config','method_id','case_sha256','query_sha256','native_checkpoint_sha256','native_checksum','condition_record_sha256','resource_binding_sha256','original_method_sha256','method_file_sha256','original_view_sha256','original_view_file_sha256','source_policy_sha256','citation_map_sha256','selected_reading_sha256','ready_sha256','report_sha256','public_method_sha256','public_view_sha256','public_view_file_sha256','source_view_policy'];
const FIELDS=['version','kind','available','status','text','binding',...PROVENANCE,'sources','method','source_policy','selection','source_support_reassessed','prose_semantics_reviewed','placement','native_method','world_truth_certified','postrun','used_for_inference','sha256'];
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&same(Object.keys(x).sort(),keys.slice().sort());
let active;
function retire(){if(active){active.valid=false;active.cleanup?.();active.node?.replaceChildren();active.node?.remove();active=null;}}
const snapshot=o=>canonical([o.row,o.record,o.reportRef]);
function route(value,path,o,resource){
  check(typeof value==='string','explicit R saved route required');const u=new URL(value,o.base??location.href),base=new URL(o.base??location.href);
  check(u.origin===base.origin&&/^https?:$/.test(u.protocol)&&!u.username&&!u.password&&!u.hash&&u.pathname===path,'R saved route must be exact same-origin endpoint');
  const pins={case_id:o.row.case.case_id,config:o.record.config,resource_id:resource.resource_id,registry_sha256:resource.registry_sha256,index_sha256:resource.index_sha256};
  for(const[k,v]of u.searchParams)check(Object.hasOwn(pins,k)&&pins[k]===v&&u.searchParams.getAll(k).length===1,'R route scope changed/repeated');
  for(const[k,v]of Object.entries(pins))u.searchParams.set(k,v);return u;
}
function citation(page,span){const p={corpus:page.corpus,canonical_page_id:page.page_id,document_id:page.document_id,date:page.date,page_sha256:page.page_sha256,start:span.start,end:span.end,text:span.text};
  for(const key of ['earlier_page','later_page'])if(page.original_page_metadata[key]!=null)p[key]=page.original_page_metadata[key];return p;}
function sourceMap(view){
  const pages=new Map(view.source_pages.map(p=>[p.page_id,p])),map=[];
  const add=(page,span)=>{
    let s=map.find(s=>s.canonical_page_id===page.page_id&&s.document_id===page.document_id&&s.date===page.date&&s.page_sha256===page.page_sha256&&s.corpus===page.corpus);
    if(!s){s={id:'S'+(map.length+1),corpus:page.corpus,document_id:page.document_id,date:page.date,canonical_page_id:page.page_id,page_sha256:page.page_sha256,citations:[]};
      for(const k of ['earlier_page','later_page','physical_page'])if(page.original_page_metadata[k]!=null)s[k]=page.original_page_metadata[k];map.push(s);}
    const proof=citation(page,span);if(!s.citations.some(c=>same(c.citation,proof)))s.citations.push({id:'C'+(s.citations.length+1),citation:proof});
  };
  for(const branch of view.readings)for(const group of branch.candidates)for(const variant of group.variants){
    const reader=variant.source_reader,page=pages.get(reader.canonical_page_id),priority=variant.priority;
    const contexts=reader.focal_source_contexts||[];
    check(!priority.quarantine||contexts.length===0,'quarantined R focal context is not callback authority');
    check(contexts.length===0||priority.focal_row&&!priority.quarantine&&priority.evidence_state!=='HOLD_SEMANTIC_REVIEW','held R focal context is not callback authority');
    // Exact producer order binds prose S labels, not just membership in a page.
    for(const c of contexts){add(page,{start:c.anchor.start,end:c.anchor.end,text:c.anchor.quote});add(page,c.qualification_span);}
    for(const key of ['quote_span','phrase_span','qualification_span'])add(page,reader[key]);
  }
  return map;
}
function sources(data,view){
  const expected=sourceMap(view),allowed=expected.flatMap(s=>s.citations.map(c=>c.citation)),pages=new Map(view.source_pages.map(p=>[p.page_id,p])),ids=new Set(),labels=new Map();
  check(same(data.sources,expected),'R exact source-label order/completeness differs from verified producer projection');
  check(Array.isArray(data.sources)&&data.sources.length>0&&data.sources.length<=256,'bounded nonempty typed R sources required');
  for(const[i,s]of data.sources.entries()){
    const page=pages.get(s.canonical_page_id),identity=canonical([s.corpus,s.document_id,s.date,s.canonical_page_id,s.page_sha256]);
    check(s.id==='S'+(i+1)&&!ids.has(identity)&&page&&s.corpus===page.corpus&&s.document_id===page.document_id&&s.date===page.date&&s.page_sha256===page.page_sha256,'R source identity/map changed');ids.add(identity);
    check(Array.isArray(s.citations)&&s.citations.length>0&&s.citations.length<=256,'R exact quote/qualification map required');const seen=new Set();
    for(const[j,c]of s.citations.entries()){
      check(c.id==='C'+(j+1)&&allowed.some(p=>same(p,c.citation))&&['corpus','canonical_page_id','document_id','date','page_sha256'].every(k=>c.citation[k]===s[k]),'R quote/source/qualification outside verified own-source proof');
      const key=canonical(c.citation);check(!seen.has(key),'duplicate R citation');seen.add(key);
    }
    for(const key of ['earlier_page','later_page','physical_page'])if(s[key]!=null)check(Number.isSafeInteger(s[key])&&s[key]>0&&s[key]===page.original_page_metadata[key],'R PDF/page locator differs');labels.set(s.id,s);
  }
  return labels;
}
const node=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
function locationLabel(s){const page=s.physical_page??s.earlier_page;return s.document_id+' / '+s.date+(page==null?'':' / '+(s.corpus==='cib'?'page ':'section ')+page);}

export async function renderRealizedRedactionDigest(context,options={}){
  retire();const token={valid:true,node:null};active=token;
  try{
    const {row,record,reportRef,verified,signal}=options,pin=row?.source_realized_digest,method=row?.reviewed_source_assessment;
    if(signal){const abort=()=>{if(active===token)retire();};signal.addEventListener('abort',abort,{once:true});token.cleanup=()=>signal.removeEventListener('abort',abort);}
    check(row?.case?.task==='redaction'&&record?.case?.case_id===row.case.case_id&&record.config==='llm_readings'&&SHA.test(reportRef?.sha256)&&typeof verified==='function'&&typeof context?.assertCurrent==='function'&&typeof context.onSource==='function','exact typed R selection/transport/context required');
    const before=snapshot(options),binding=structuredClone(context.binding),current=()=>{check(active===token&&token.valid&&!signal?.aborted&&same(context.assertCurrent(),binding)&&same(context.binding,binding)&&snapshot(options)===before,'stale/revoked R digest selection');};
    current();check(binding.method_id===METHOD&&method?.method_id===METHOD&&exact(pin,PIN)&&pin.version==='source-realized-redaction-digest-pin/1'&&pin.kind===KIND&&pin.method_id===METHOD&&pin.postrun===true&&pin.used_for_inference===false&&pin.placement==='AFTER_RESULTS','separate complete typed source_realized_digest pin required');
    const resource=realizedDigestResource(row,record);route(pin.endpoint,'/api/current/analyst-digest',options,resource);
    const endpoint=route(options.endpoint??pin.endpoint,'/api/current/analyst-digest',options,resource);
    const packet=await verified(endpoint.href,signal);current();const parsed=parseWire(packet?.decoded),data=parsed.value;
    check(exact(data,FIELDS)&&data.version===REALIZED_DIGEST_VERSION&&data.kind===KIND&&data.available===true&&data.status==='SAVED_R_SOURCE_DIGEST'&&SHA.test(data.sha256)&&await hash(parsed.canonicalWithoutSHA)===data.sha256,'exact raw typed R digest version/kind/selfhash required');current();
    check(data.postrun===true&&data.used_for_inference===false&&data.placement==='AFTER_RESULTS'&&data.native_method===false&&data.world_truth_certified===false&&data.source_support_reassessed===false&&data.prose_semantics_reviewed===false&&data.method?.id===METHOD&&data.method.native_method===false,'R digest is not a native/world certificate');
    const b=data.binding,item=row.configurations?.llm_readings;
    check(exact(b,BINDING)&&BINDING.filter(k=>!['case_id','config','method_id','source_view_policy'].includes(k)).every(k=>SHA.test(b[k])),'full R digest commitment required');
    check(b.case_id===row.case.case_id&&b.config===record.config&&b.method_id===METHOD&&b.report_sha256===reportRef.sha256&&b.case_sha256===await hash(canonical(row.case))&&b.query_sha256===await hash(canonical(row.case.query))&&b.query_sha256===record.plan?.query_sha256&&b.query_sha256===binding.query_sha256,'R case/report/query/native plan differs');current();
    check(['native_checkpoint_sha256','native_checksum','original_view_sha256','public_view_sha256'].every(k=>b[k]===pin[k]&&b[k]===binding[k])&&b.native_checkpoint_sha256===item?.native_checkpoint?.sha256&&b.native_checkpoint_sha256===record.native_checkpoint?.sha256&&b.native_checksum===record.native_checksum,'R original native or view changed');
    check(PROVENANCE.every(k=>SHA.test(data[k]))&&['input_sha256','generation_sha256','body_sha256'].every(k=>data[k]===pin[k]),'R input/generation/body commitment differs');
    // These are private commitments, not hashes of redacted browser records.
    check(SHA.test(pin.condition_ref_sha256)&&pin.condition_ref_sha256===item.condition_ref?.sha256&&pin.condition_record_sha256===b.condition_record_sha256&&SHA.test(pin.text_sha256)&&pin.text_sha256===await hash(canonical(data.text))&&['raw_response_wire_sha256','response_value_sha256','api_receipt_wire_sha256'].every(k=>pin[k]===data[k]),'typed R pin lacks exact condition/response/receipt/prose commitments');current();
    check(b.resource_binding_sha256===await hash(canonical(row.resource_binding))&&b.original_method_sha256===method.original_method_sha256&&b.method_file_sha256===method.method_ref?.sha256&&b.original_view_file_sha256===method.view_ref?.sha256&&b.public_method_sha256===method.public_method_sha256&&b.ready_sha256===method.producer_ready_ref?.sha256&&b.public_view_file_sha256===method.public_view_ref?.sha256,'R resource/METHOD/VIEW/READY commitment differs');
    check(same(data.source_policy,b.source_view_policy)&&same(data.source_policy,binding.source_view_policy)&&same(data.source_policy,method.source_view_policy)&&same(data.source_policy,record.configuration?.source_view_policy)&&same(data.source_policy,record.result?.source_view_policy)&&b.source_policy_sha256===await hash(canonical(data.source_policy))&&b.citation_map_sha256===await hash(canonical(data.sources))&&b.selected_reading_sha256===await hash(canonical(data.selection)),'R policy/source map/recorded selection differs');current();
    const sourceURL=route(method.endpoint,'/api/current/source-realized-redaction',options,resource),source=await verified(sourceURL.href,signal);current();
    const envelope=await validateEnvelope(parseRaw(source?.decoded),{row,record,config:record.config,resourceBinding:resource,pin:method});current();
    check(same(envelope.view.selection,data.selection)&&envelope.view.original_view_sha256===b.original_view_sha256&&envelope.view.sha256===b.public_view_sha256&&envelope.method.original_method_sha256===b.original_method_sha256&&envelope.method.sha256===b.public_method_sha256,'R current recorded reading/method differs');
    const labels=sources(data,envelope.view),words=data.text.trim().split(/\s+/),mentions=[...data.text.matchAll(/\[(S[^\]]*)\]/g)];
    check(words.length>=50&&words.length<=100&&data.text.length<=2500&&mentions.length>0&&mentions.every(m=>labels.has(m[1]))&&[...data.text.matchAll(/\bS(\d+)\b/g)].every(m=>labels.has('S'+m[1]))&&!/\/(?:Users|home)\/|file:\/\/|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/i.test(data.text),'bounded public R prose/S labels required');
    current();const host=node('section',null,{class:'source-method-digest','data-testid':'source-method-digest','data-digest-version':REALIZED_DIGEST_VERSION,'data-digest-sha256':data.sha256,'data-summary-reading':data.selection.display_reading_id??''});host.append(node('h3','Analyst summary'));
    const text=node('p'),nav=node('nav',null,{class:'workbench-digest-source-key','aria-label':'Summary source documents'});
    const link=(id,long=false)=>{const s=labels.get(id),proof=structuredClone(s.citations[0].citation),button=node('button',long?id+' / '+locationLabel(s):'['+id+']',{type:'button',class:'workbench-digest-source','data-testid':'source-digest-citation','data-source-label':id,title:locationLabel(s)});button.addEventListener('click',()=>{current();context.onSource(proof);current();});return button;};
    let cursor=0;for(const m of mentions){text.append(document.createTextNode(data.text.slice(cursor,m.index)),link(m[1]));cursor=m.index+m[0].length;}text.append(document.createTextNode(data.text.slice(cursor)));
    for(const id of labels.keys())if(mentions.some(m=>m[1]===id))nav.append(link(id,true));host.append(text,nav);
    if(!document.querySelector('link[data-source-digest-style]'))document.head.append(node('link',null,{rel:'stylesheet',href:new URL('./workbench-reviewed-digest.css',import.meta.url).href,'data-source-digest-style':'typed-R-1'}));
    token.node=host;current();return host;
  }catch(error){if(active===token)retire();throw error;}
}

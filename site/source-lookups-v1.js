// Saved atomic page matches only. This module never fetches source pages or alters evidence.
import {savedSourcePolicy,savedSourceScope,traceSourceScope,sourceScopeAllows} from './saved-source-policy.js';
const branded=new WeakSet(),payloads=new WeakMap(),artifacts=new Map();
const rows=value=>Array.isArray(value)?value:[];
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const fail=message=>{throw Error('Source lookup binding: '+message);};
const check=(condition,message)=>{if(!condition)fail(message);};
const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])])):value;
export const sourceLookupJSON=value=>JSON.stringify(normalize(value)).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
export async function sourceLookupHash(value){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sourceLookupJSON(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const same=(a,b)=>sourceLookupJSON(a)===sourceLookupJSON(b);
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}
const page=ref=>({canonical_page_id:ref.canonical_page_id,document_id:ref.document_id,date:ref.date,page_sha256:ref.page_sha256});
const samePage=(p,q)=>p?.page_id===q.canonical_page_id&&p.document_id===q.document_id;
const sameProof=(p,q)=>p?.canonical_page_id===q.canonical_page_id&&p.document_id===q.document_id&&p.date===q.date&&p.page_sha256===q.page_sha256;
const searchView=search=>({id:search.id,kind:search.kind,query:search.query,atom_ids:search.atom_ids,
  also_serves:rows(search.also_serves).map(s=>({id:s.id,kind:s.kind,query:s.query,atom_ids:s.atom_ids}))});
export const sourceLookupPolicy=receipt=>Object.fromEntries(['method','query_sha256','cutoff','whole_origin_excluded',
  'source_policy_version','source_scope','source_view_policy','query_only','generated_leads','whole_query_search_executed','api_calls'].map(key=>[key,receipt[key]]));

// Public export may omit private plan receipts/audits. Bind only an explicit
// complete lookup whitelist, including every saved score and source identity.
export function sourceLookupRecordSnapshot(record){
  const receipt=record.result?.retrieval||{};
  return {version:'source-lookup-record-binding/1',case:record.case,config:record.config,
    native_checkpoint:record.native_checkpoint,native_record_sha256:record.native_record_sha256,
    native_checksum:record.native_checksum,resource_binding:record.resource_binding,
    plan:{query_sha256:record.plan?.query_sha256,query_only:record.plan?.query_only,
      atoms:rows(record.plan?.atoms).map(a=>({id:a.id,text:a.text}))},
    result_query_sha256:record.result?.query_sha256,policy:sourceLookupPolicy(receipt),
    searches:rows(receipt.search_queries).map(s=>({...searchView(s),
      top_pages:rows(s.top_pages).map(p=>({page_id:p.page_id,document_id:p.document_id,bm25:p.bm25})),
      top_nodes:rows(s.top_nodes).map(p=>({node_id:p.node_id,bm25:p.bm25,source_proof:page(p.source_proof||{})}))})),
    seeded_pages:rows(receipt.seeded_documents).map(s=>({page_id:s.page_id,document_id:s.document_id,date:s.date,
      source_proof:page(s.citation||{}),matched_searches:rows(s.matched_searches).map(h=>({search_id:h.search_id,query:h.query,bm25:h.bm25}))}))};
}

function atomsForSearch(search,index,plan){
  return [search,...rows(search.also_serves)].flatMap((row,alias)=>{
    const at=plan.atoms.findIndex(atom=>atom.id===row.id),atom=plan.atoms[at];
    if(!atom||row.query!==atom.text||row.atom_ids?.length!==1||row.atom_ids[0]!==atom.id)return [];
    return [{atom_id:atom.id,plan_atom_pointer:'/plan/atoms/'+at,
      search_atom_pointer:'/retrieval/search_queries/'+index+(alias?'/also_serves/'+(alias-1):'')}];
  });
}

// Pure re-derivation is shared by the offline generator and verifier. No branding here.
export function collectSourceLookupRows({record,trace}){
  const plan=record.plan,receipt=record.result?.retrieval;
  const scope=savedSourceScope(record.case,receipt?.source_view_policy);
  check(Array.isArray(plan?.atoms)&&plan.atoms.length<=256,'bounded plan atoms required');
  check(new Set(plan.atoms.map(a=>a.id)).size===plan.atoms.length,'duplicate atom');
  check(Array.isArray(receipt?.search_queries)&&receipt.search_queries.length<=512,'bounded executed searches required');
  check(Array.isArray(trace.paths)&&trace.paths.length<=1000,'bounded selected paths required');
  const searches=new Map();
  for(const [index,search]of receipt.search_queries.entries()){
    check(typeof search.id==='string'&&!searches.has(search.id),'duplicate or invalid search ID');
    check(typeof search.query==='string','missing executed query');
    searches.set(search.id,{search,index,atoms:atomsForSearch(search,index,plan)});
  }
  const lookup=trace.sources||trace.source_refs_by_id||{},result=[];
  for(const [pathIndex,path]of trace.paths.entries()){
    check(typeof path.id==='string'&&typeof path.candidate_or_atom_id==='string','invalid selected path');
    for(const [refIndex,value]of rows(path.decision_source_refs).entries()){
      const q=typeof value==='string'?lookup[value]:value;
      check(q&&typeof q.canonical_page_id==='string'&&typeof q.document_id==='string'&&hash(q.page_sha256)&&
        /^\d{4}-\d{2}-\d{2}$/.test(q.date)&&sourceScopeAllows(q,scope),
        'selected page violates hash/date/origin policy');
      const common={path_id:path.id,path_pointer:'/paths/'+pathIndex,candidate_or_atom_id:path.candidate_or_atom_id,
        selected_ref_pointer:'/paths/'+pathIndex+'/decision_source_refs/'+refIndex,source:page(q)};
      const add=(entry,basis,pointer,witness)=>{
        for(const atom of entry.atoms)result.push({...common,...atom,search_pointer:'/retrieval/search_queries/'+entry.index,
          search:searchView(entry.search),basis,receipt_pointer:pointer,witness});
      };
      for(const entry of searches.values()){
        if(!entry.atoms.length)continue;
        const prefix='/retrieval/search_queries/'+entry.index;
        for(const [i,p]of rows(entry.search.top_pages).entries())if(samePage(p,q)&&positive(p.bm25))
          add(entry,'SEARCH_TOP_PAGE',prefix+'/top_pages/'+i,{page_id:p.page_id,document_id:p.document_id,bm25:p.bm25});
        for(const [i,p]of rows(entry.search.top_nodes).entries())if(sameProof(p.source_proof,q)&&positive(p.bm25))
          add(entry,'SEARCH_TOP_NODE_SAME_PAGE',prefix+'/top_nodes/'+i,{node_id:p.node_id,bm25:p.bm25,source_proof:page(p.source_proof)});
      }
      for(const [si,seed]of rows(receipt.seeded_documents).entries()){
        if(!samePage(seed,q)||!sameProof(seed.citation,q))continue;
        for(const [hi,hit]of rows(seed.matched_searches).entries()){
          const entry=searches.get(hit.search_id);
          if(entry?.atoms.length&&hit.query===entry.search.query&&positive(hit.bm25))
            add(entry,'SEEDED_PAGE_POSITIVE_SEARCH','/retrieval/seeded_documents/'+si+'/matched_searches/'+hi,
              {page_id:seed.page_id,document_id:seed.document_id,source_proof:page(seed.citation),
                search_id:hit.search_id,query:hit.query,bm25:hit.bm25});
        }
      }
    }
  }
  check(result.length<=20000,'lookup row limit exceeded');
  return result;
}

function contextBinding({row,record,trace,reportSHA,config,reading}){
  check(hash(reportSHA),'source report hash required');
  check(row?.case?.task==='redaction'&&record?.case?.task==='redaction'&&trace?.task==='redaction','redaction context required');
  for(const key of ['case_id','corpus','task','query','date','document_id','focal_marker'])check(row.case[key]===record.case[key],'case changed: '+key);
  check(config==='llm_readings'&&record.config===config&&trace.config===config,'configuration changed');
  check(typeof reading==='string'&&reading&&trace.reading_id===reading,'reading changed');
  check(trace.case_id===row.case.case_id,'trace case changed');
  const cfg=row.configurations?.[config],traceRef=cfg?.trace_refs?.[reading];
  check(cfg&&traceRef&&hash(traceRef.sha256),'canonical report row with trace ref required');
  for(const ref of [cfg.native_checkpoint,traceRef])check(hash(ref?.sha256)&&typeof ref.path==='string'&&
    !ref.path.startsWith('/')&&!ref.path.includes('..')&&/^[A-Za-z0-9_./-]+$/.test(ref.path),'invalid public artifact ref');
  check(same(cfg.native_checkpoint,record.native_checkpoint)&&same(cfg.native_checkpoint,trace.native_checkpoint),'native checkpoint changed');
  const resource=row.resource_binding;
  check(resource&&hash(resource.registry_sha256)&&hash(resource.index_sha256)&&same(resource,record.resource_binding)&&same(resource,trace.resource_binding),'resource changed');
  const receipt=record.result?.retrieval,querySHA=record.plan?.query_sha256;
  check(hash(querySHA)&&querySHA===record.result?.query_sha256&&querySHA===receipt?.query_sha256&&querySHA===trace.query_sha256,'query binding changed');
  const scope=traceSourceScope(row.case,cfg,trace);
  check(same(scope.source_view_policy,savedSourcePolicy(receipt.source_view_policy)),'receipt/native source policy changed');
  check(receipt.cutoff===row.case.date&&receipt.whole_origin_excluded===scope.whole_origin_excluded&&receipt.query_only===true&&
    receipt.generated_leads===false&&typeof receipt.whole_query_search_executed==='boolean'&&receipt.api_calls===0&&
    typeof receipt.source_policy_version==='string'&&receipt.source_policy_version.length>0,'source policy changed');
  check(trace.native_decisions_or_ranks_modified===false&&trace.new_evidence_fetched===false,'trace authority changed');
  return {case_id:row.case.case_id,corpus:row.case.corpus,config,query_sha256:querySHA,
    native_checkpoint:cfg.native_checkpoint,resource_binding:resource,policy:sourceLookupPolicy(receipt),
    native_record_sha256:record.native_record_sha256,native_checksum:record.native_checksum};
}

// Pure validation for fixture/adversarial tests; plain returned rows are not map capabilities.
export async function validateSourceLookupProjection(data,context){
  const binding=contextBinding(context);
  check(data?.version==='source-page-lookups/1'&&data.api_calls===0&&data.native_decisions_or_ranks_modified===false&&
    data.entailment_claimed===false&&data.is_graph_edge===false,'invalid projection scope');
  check(data.source_report_sha256===context.reportSHA,'different source report');
  check(Array.isArray(data.entries)&&data.entries.length<=128,'bounded projection entries required');
  const keys=data.entries.map(e=>e.case_id+'/'+e.config);check(new Set(keys).size===keys.length,'duplicate case projection');
  const entry=data.entries.find(e=>e.case_id===binding.case_id&&e.config===binding.config);
  if(!entry)return null;
  check(same(entry.binding,binding),'case/native/resource/policy binding changed');
  check(entry.record_lookup_sha256===await sourceLookupHash(sourceLookupRecordSnapshot(context.record)),'published lookup record changed');
  const readings=rows(entry.readings);check(new Set(readings.map(r=>r.reading_id)).size===readings.length,'duplicate reading projection');
  const reading=readings.find(r=>r.reading_id===context.reading);check(reading,'reading projection missing');
  check(same(reading.trace_ref,context.row.configurations[context.config].trace_refs[context.reading]),'trace artifact ref changed');
  check(reading.trace_content_sha256===await sourceLookupHash(context.trace),'selected trace changed');
  const expected=collectSourceLookupRows(context);
  check(same(reading.links,expected),'recorded atom/search/page/score/pointer changed');
  return freeze(structuredClone(expected));
}

export async function loadSourceLookups(context){
  if(context.row?.case?.task!=='redaction')return null;
  const meta=document.querySelector('meta[name="source-lookups"]');if(!meta)return null;
  const expected=meta.dataset.contentSha256;
  check(hash(expected),'missing content pin');
  const url=new URL(meta.content,document.baseURI),allowed=new URL('data/source-lookups.js',import.meta.url);
  check(['http:','https:'].includes(url.protocol)&&url.origin===location.origin&&url.href===allowed.href&&
    !url.search&&!url.hash&&!url.username&&!url.password,'invalid data module location');
  const key=url.href+'#'+expected;
  if(!artifacts.has(key))artifacts.set(key,(async()=>{
    const {default:value}=await import(url.href),copy=structuredClone(value);
    check(await sourceLookupHash(copy)===expected,'data content pin failed');return freeze(copy);
  })());
  const links=await validateSourceLookupProjection(await artifacts.get(key),context);
  if(links===null)return null;
  const token=Object.freeze(Object.create(null));
  payloads.set(token,{trace:context.trace,plan:context.record.plan,record:context.record,row:context.row,
    traceSnapshot:sourceLookupJSON(context.trace),planSnapshot:sourceLookupJSON(context.record.plan),
    recordSnapshot:sourceLookupJSON(context.record),rowSnapshot:sourceLookupJSON(context.row),links});
  branded.add(token);return token;
}

// Synchronous leases prevent copying a token or mutating source inputs after verification.
export function sourcePageLookupLinks(token,{trace,plan}){
  if(token==null)return [];
  check(branded.has(token),'unverified pageLookups input');
  const value=payloads.get(token);
  check(trace===value.trace&&plan===value.plan&&sourceLookupJSON(trace)===value.traceSnapshot&&
    sourceLookupJSON(plan)===value.planSnapshot&&sourceLookupJSON(value.record)===value.recordSnapshot&&
    sourceLookupJSON(value.row)===value.rowSnapshot,'lookup input changed after verification');
  return value.links;
}

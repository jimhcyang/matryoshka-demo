// Exact raw JSON and own-source/method checks for the separate R display method.
export const METHOD_ID='source_realized_redaction_v1';
export const check=(ok,message)=>{if(!ok)throw Error('Source-realized R: '+message);};
export const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const stable=v=>Array.isArray(v)?v.map(stable):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
export const ascii=v=>JSON.stringify(v).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export const close=(a,b)=>typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-12;
export const bounded=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
const keys=(v,allowed)=>object(v)&&Object.keys(v).length===allowed.length&&Object.keys(v).every(k=>allowed.includes(k));
const fold=s=>s.toLowerCase().replace(/[ßſﬀﬁﬂﬃﬄﬅﬆ]/g,c=>({'ß':'ss','ſ':'s','ﬀ':'ff','ﬁ':'fi','ﬂ':'fl','ﬃ':'ffi','ﬄ':'ffl','ﬅ':'st','ﬆ':'st'}[c]));
const normalized=s=>fold(s).trim().replace(/\s+/g,' ');
const terms=s=>new Set(fold(s).match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g)||[]);
const cut=(s,a,b)=>Array.from(s).slice(a,b).join('');
const span=(text,p)=>Number.isSafeInteger(p?.start)&&Number.isSafeInteger(p?.end)&&p.start>=0&&p.end>p.start&&p.end<=Array.from(text).length&&cut(text,p.start,p.end)===p.text;
const unique=(text,q)=>{let n=0,at=0;check(typeof q==='string'&&q.length>0,'empty exact quotation');while((at=text.indexOf(q,at))>=0){n++;at++;}return n===1;};
const noMask=s=>!/(?:\[REDACT(?:ION|ED)|REDACTION_SLOT|\bREDACTED\b)/i.test(s);
const weights={actor:.18,relation_property:.20,role_argument:.15,issue:.15,time:.06,quantity:.08,polarity:.06,modality:.05,attribution:.03,qualification:.04};
const reference=v=>object(v)&&typeof v.path==='string'&&v.path.length>0&&!/^(?:\/|[a-z]+:)/i.test(v.path)&&!v.path.split('/').some(p=>p==='..'||p==='.')&&sha(v.sha256);
export function locationSemantic(v){return Array.isArray(v)?v.map(locationSemantic):object(v)?Object.fromEntries(Object.entries(v).filter(([k])=>!['path','publication_availability'].includes(k)).map(([k,x])=>[k,locationSemantic(x)])):v;}
export function sameReference(a,b){
  let identities=0;
  function equal(x,y){
    if(Array.isArray(x)||Array.isArray(y))return Array.isArray(x)&&Array.isArray(y)&&x.length===y.length&&x.every((v,i)=>equal(v,y[i]));
    if(!object(x)||!object(y))return x===y;
    const reference=Object.hasOwn(x,'sha256')||Object.hasOwn(y,'sha256');
    if(reference){
      if(!sha(x.sha256)||!sha(y.sha256)||x.sha256!==y.sha256)return false;identities++;
      for(const value of [x,y])if(Object.hasOwn(value,'bytes')&&(!Number.isSafeInteger(value.bytes)||value.bytes<=0))return false;
      if(Object.hasOwn(x,'bytes')&&Object.hasOwn(y,'bytes')&&x.bytes!==y.bytes)return false;
    }
    const fields=v=>Object.keys(v).filter(k=>!['path','publication_availability'].includes(k)&&!(reference&&k==='bytes')).sort();
    const left=fields(x),right=fields(y);return same(left,right)&&left.every(k=>equal(x[k],y[k]));
  }
  return equal(a,b)&&identities>0;
}
export function consistentReferences(values){
  if(!Array.isArray(values)||values.length<2||!values.every(v=>sameReference(values[0],v)))return false;
  const sizes=new Map();
  function visit(value,at=[]){
    if(Array.isArray(value))return value.every((v,i)=>visit(v,[...at,i]));
    if(!object(value))return true;
    if(Object.hasOwn(value,'sha256')&&Object.hasOwn(value,'bytes')){
      const key=JSON.stringify([at,value.sha256]);if(sizes.has(key)&&sizes.get(key)!==value.bytes)return false;sizes.set(key,value.bytes);
    }
    return Object.entries(value).every(([k,v])=>['path','publication_availability'].includes(k)||visit(v,[...at,k]));
  }
  return values.every(v=>visit(v));
}

export function parseRaw(bytes){
  check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=8*1024**2,'bounded raw verified bytes required');
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes),numbers=new WeakSet(),raws=new WeakMap();let at=0,count=0;
  const ws=()=>{while(/[\x20\t\r\n]/.test(source[at]||'!'))at++;};
  function string(){const start=at++;while(at<source.length){const c=source[at++];if(c==='"')return JSON.parse(source.slice(start,at));if(c==='\\')at++;}throw Error('Unclosed JSON string');}
  function value(depth=0){check(depth<=96&&++count<=1000000,'JSON structural bound');ws();const c=source[at];
    if(c==='"')return string();
    if(c==='{'||c==='['){const map=c==='{',out=map?Object.create(null):[];at++;ws();if(source[at]===(map?'}':']')){at++;return out;}
      while(true){if(map){check(source[at]==='"','JSON object key');const k=string();check(!Object.hasOwn(out,k),'duplicate JSON key');ws();check(source[at++]===':','JSON colon');out[k]=value(depth+1);}else out.push(value(depth+1));ws();const end=source[at++];if(end===(map?'}':']'))return out;check(end===',','JSON separator');ws();}}
    for(const [token,out]of [['true',true],['false',false],['null',null]])if(source.slice(at,at+token.length)===token){at+=token.length;return out;}
    const match=source.slice(at).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);check(match,'invalid JSON value');at+=match[0].length;const out={value:Number(match[0]),raw:match[0]};check(Number.isFinite(out.value),'nonfinite JSON number');numbers.add(out);return out;
  }
  const tree=value();ws();check(at===source.length,'trailing JSON bytes');
  const encode=v=>numbers.has(v)?v.raw:Array.isArray(v)?'['+v.map(encode).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>ascii(k)+':'+encode(v[k])).join(',')+'}':ascii(v);
  function plain(v){if(numbers.has(v))return v.value;if(!object(v)&&!Array.isArray(v))return v;const out=Array.isArray(v)?v.map(plain):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)]));raws.set(out,v);return out;}
  const data=plain(tree);return {data,canonical:v=>encode(raws.get(v)||v),withoutSHA:v=>encode(Object.fromEntries(Object.entries(raws.get(v)).filter(([k])=>k!=='sha256')))};
}

export function citation(page,p){
  check(span(page.windows[0].text,p),'exact source span');const meta=page.original_page_metadata||{};
  return {corpus:page.corpus,canonical_page_id:page.page_id,document_id:page.document_id,date:page.date,page_sha256:page.page_sha256,
    start:p.start,end:p.end,text:p.text,...(meta.earlier_page!=null?{earlier_page:meta.earlier_page}:{}),...(meta.later_page!=null?{later_page:meta.later_page}:{})};
}
function receipt(p){check(p?.kind==='ACTUAL_PHASE_EXACT_API_V2'&&/^[a-f0-9]{32}$/.test(p.call_id||'')&&typeof p.provider_response_id==='string'&&p.provider_response_id&&
  ['actual_http_body_sha256','raw_stored_bytes_sha256','raw_value_sha256'].every(k=>sha(p[k]))&&['receipt_ref','request_ref','response_ref'].every(k=>sha(p[k]?.sha256)),'actual provider provenance required');}
function distinct(a,b){receipt(a);receipt(b);check(a.call_id!==b.call_id&&a.provider_response_id!==b.provider_response_id,'separate actual review required');}
function lineage(x,kind){
  const l=x.publication_lineage;check(l?.version==='source-realized-location-redaction/1'&&l.artifact_kind===kind&&l.original_canonical_sha256===x['original_'+kind+'_sha256']&&sha(l.original_file_sha256)&&
    l.transformation==='HASH_BOUND_ARTIFACT_LOCATIONS_TO_NULL_ONLY'&&l.original_nested_commitments_not_reissued===true&&l.source_text_or_scores_changed===false&&l.native_baseline_rewritten===false&&Array.isArray(l.redacted_locations),'explicit hash-bound location-only lineage required');
  const seen=new Set();for(const r of l.redacted_locations){check(typeof r.pointer==='string'&&/^\//.test(r.pointer)&&!seen.has(r.pointer)&&sha(r.reference_sha256),'unique redaction pointer/hash required');seen.add(r.pointer);
    const parts=r.pointer.slice(1).split('/').map(p=>p.replace(/~1/g,'/').replace(/~0/g,'~')),key=parts.pop();let owner=x;for(const p of parts){check(owner&&Object.hasOwn(owner,p),'lineage pointer does not resolve');owner=owner[p];}
    check(['path','receipt'].includes(key)&&owner[key]===null&&owner.sha256===r.reference_sha256&&typeof owner.publication_availability==='string','only committed artifact locations may be removed');}
  function visit(n,p=''){if(Array.isArray(n)){n.forEach((v,i)=>visit(v,p+'/'+i));return;}if(!object(n))return;
    for(const[k,v]of Object.entries(n)){if(k==='publication_lineage')continue;const at=p+'/'+k.replaceAll('~','~0').replaceAll('/','~1');
      if(['path','receipt'].includes(k)&&v===null&&sha(n.sha256)&&n.publication_availability!=null)check(seen.has(at),'redacted location omitted from explicit lineage');visit(v,at);}}
  visit(x);
}
function qualification(text,p){const chars=Array.from(text),prefix=chars.slice(0,p.start).join(''),suffix=chars.slice(p.end).join(''),left=prefix.lastIndexOf('\n\n'),right=suffix.indexOf('\n\n');
  const start=left<0?0:Array.from(prefix.slice(0,left+2)).length,end=right<0?chars.length:p.end+Array.from(suffix.slice(0,right)).length;return {start,end,text:cut(text,start,end)};}
function lexical(fill,quote){const q=terms(fill),s=terms(quote),n=[...q].filter(t=>s.has(t)).length,u=new Set([...q,...s]).size;return (q.size ? .5*n/q.size : 0)+(u ? .5*n/u : 0);}

function validatePriority(v,view,page){
  const p=v.priority,nom=v.context_priority,g=v.grammar;
  check(Array.isArray(v.source_reader.focal_source_contexts)&&(!(view.nomination_only||!p.focal_row)||v.source_reader.focal_source_contexts.length===0),'non-focal variants cannot register focal source contexts');
  check(['factual_support_certified','legacy_source_license_claimed','native_DTO_or_certificate_created','native_tier_assigned','source_positive_B_added'].every(k=>v[k]===false)&&
    g?.eligible===true&&g.factual_support_certified===false&&Array.isArray(g.holds)&&g.holds.length===0&&Array.isArray(g.applicable_checks)&&g.applicable_checks.length>0&&g.applicable_checks.every(c=>c.state==='pass'),'new method cannot mint native license/support');
  const f=nom.raw_features;check(bounded(f?.own_page_focal_coverage)&&bounded(f?.local_grammatical_fit)&&bounded(f?.nonrepeated_content_fraction)&&
    close(f.local_grammatical_fit,g.local_grammatical_fit)&&close(g.local_grammatical_fit,g.applicable_checks.filter(c=>c.state==='pass').length/g.applicable_checks.length)&&
    close(nom.score,.55*f.own_page_focal_coverage+.25*f.local_grammatical_fit+.20*f.nonrepeated_content_fraction)&&
    nom.probability===false&&nom.source_positive_B_added===false&&nom.native_tier_assigned===false&&nom.source_page_union_used===false&&
    nom.own_page.canonical_page_id===page.page_id&&nom.own_page.document_id===page.document_id&&nom.own_page.page_sha256===page.page_sha256,'nomination context score/source differs');
  check(p.probability===false&&bounded(p.value),'bounded nonprobabilistic displayed priority');
  if(view.nomination_only){check(p.mode==='NOMINATION_ONLY'&&p.evidence_state==='NOMINATION_ONLY'&&p.evidence_class===null&&p.source_supported_fill_approved===false&&p.raw_source_alignment===null&&
      p.units==='NOMINATION_CONTEXT_PRIORITY_INDEX'&&p.formula===nom.formula&&close(p.value,nom.score),'nomination cannot become focal support');return;}
  check(p.mode==='ACTUAL_FOCAL_REPLAY'&&p.units==='EVIDENCE_CLASS_PRIORITY_INDEX'&&p.formula==='(evidence_class + .99*raw_source_alignment)/3','focal score recipe differs');
  const row=p.focal_row;let band=0,state='UNRESOLVED',approved=false,alignment=0;
  if(row){const r=row.raw_focal_assessment,a=r.assessment,anchors=r.bound_source_anchors,ids=new Set();
    check(row.candidate_id===v.id&&a.candidate_id===v.id&&a.source_ascription_only===true&&a.visible_query_event_certified===false&&a.cross_document_event_join_used===false&&
      row.legacy_native_tier_changed===false&&row.native_verdict_created===false&&row.whole_visible_query_event_certified===false&&r.source_page_union_used===false,'focal/native/event authority differs');
    for(const q of anchors){check(q.page_id===page.page_id&&span(page.windows[0].text,{...q,text:q.quote})&&unique(page.windows[0].text,q.quote)&&noMask(q.quote)&&!ids.has(q.id),'focal anchor outside own page or nonunique');ids.add(q.id);}
    check(keys(a.facets,Object.keys(weights)),'exact focal facets required');let requested=0,matched=0;
    for(const [field,w]of Object.entries(weights)){const x=a.facets[field];check(['MATCHED','INFERRED','MISSING','CONFLICTING','NOT_REQUESTED'].includes(x.status)&&Array.isArray(x.fill_quotes)&&Array.isArray(x.public_scope_quotes)&&Array.isArray(x.source_anchor_ids),'focal facet schema');
      if(x.status==='NOT_REQUESTED'){check(x.fill_quotes.length+x.public_scope_quotes.length+x.source_anchor_ids.length===0,'unrequested facet gained proof');continue;}
      requested+=w;check(x.fill_quotes.length+x.public_scope_quotes.length>0&&x.fill_quotes.every(q=>unique(v.fill,q))&&x.public_scope_quotes.every(q=>unique(view.case.query,q))&&x.source_anchor_ids.every(id=>ids.has(id)),'focal constraint/source references differ');
      if(['MATCHED','CONFLICTING'].includes(x.status)){check(x.source_anchor_ids.length>0,'signed facet without own-source proof');matched+=w;}}
    check(requested>0&&close(requested,r.requested_weight)&&close(matched,r.aligned_requested_weight)&&close(matched/requested,r.alignment),'focal facet arithmetic differs');
    const values=anchors.map(q=>lexical(v.fill,q.quote)),local=values.length?Math.max(...values):0,raw=p.raw_source_alignment;
    alignment=.75*r.alignment+.25*local;
    check(raw?.source_quote_union_used===false&&raw.formula==='.75*facet_alignment + .25*own_quote_lexical_fit'&&close(raw.facet_alignment,r.alignment)&&close(raw.own_quote_lexical_fit,local)&&close(raw.value,alignment)&&
      same(raw.per_quote_scores,anchors.map((q,i)=>({anchor_id:q.id,value:values[i]})))&&same(raw.winning_quote,values.length?anchors[values.indexOf(local)]:null)&&
      close(row.context_priority.alignment,r.alignment)&&close(row.context_priority.local_lexical_fit,local),'per-own-quote source alignment differs');
    approved=row.source_supported_fill_approved===true;
    if(row.source_focal_class==='DIRECT_TARGET_SOURCE'&&approved){band=2;state='DIRECT_SOURCE_APPROVED';check(a.material_fill_constraints_complete===true&&a.facets.actor.status==='MATCHED'&&a.facets.issue.status==='MATCHED'&&
        Object.values(a.facets).every(x=>['MATCHED','NOT_REQUESTED'].includes(x.status)),'direct fill constraints incomplete');distinct(view.focal_summary.assessment_receipt,view.focal_summary.semantic_review_receipt);}
    else if(row.source_focal_class==='INFERENTIAL_CONTEXT'){band=1;state='INFERENTIAL_CONTEXT';}
    else if(row.source_focal_class==='EXPLICIT_CONFLICT')state='EXPLICIT_CONFLICT';
    else if(row.source_focal_class==='HOLD_SEMANTIC_REVIEW')state='HOLD_SEMANTIC_REVIEW';
    else check(['NOINFO','DIRECT_TARGET_SOURCE'].includes(row.source_focal_class),'unknown focal state');
    check(!approved||band===2,'context/conflict cannot claim direct approval');
    const contexts=v.source_reader.focal_source_contexts;check(contexts.length===anchors.length&&anchors.every((q,i)=>same(contexts[i].anchor,q)&&same(contexts[i].qualification_span,qualification(page.windows[0].text,{start:q.start,end:q.end}))), 'full focal qualifications differ');
  }else check(p.raw_source_alignment===null&&p.quarantine&&view.focal_summary.quarantined_rows.some(q=>q.candidate_id===v.id&&same(q,p.quarantine)),'unassessed focal variant lost quarantine');
  check(p.evidence_state===state&&p.evidence_class===band&&p.source_supported_fill_approved===approved&&close(p.value,(band+.99*alignment)/3),'displayed priority/class differs from ranking formula');
}

export async function validateEnvelope(parsed,{row,record,config,resourceBinding,pin}){
  const e=parsed.data;check(keys(e,['version','case_id','config','resource_binding','method','view','public_method_ref','public_view_ref'])&&e.version==='source-realized-redaction-envelope/1'&&
    e.case_id===row.case.case_id&&e.config===config&&['resource_id','registry_sha256','index_sha256'].every(k=>e.resource_binding?.[k]===resourceBinding[k])&&
    Object.entries(e.resource_binding).every(([k,v])=>resourceBinding[k]===v),'raw envelope/current resource binding differs');
  check(pin.receiver_version==='source-realized-publication-receiver/2'&&pin.publication_projection_version==='source-realized-location-redaction/1'&&same(pin.resource_binding,e.resource_binding)&&pin.native_checksum===record.native_checksum&&record.config===config&&
    pin.execution_context?.version==='pinned-execution-context/1'&&sameReference(pin.execution_context.registry_ref,record.registry_ref)&&sameReference(pin.execution_context.index_ref,record.index_ref),'typed R receiver/current metadata required');
  check(reference(pin.public_method_ref)&&reference(pin.public_view_ref)&&same(e.public_method_ref,pin.public_method_ref)&&same(e.public_view_ref,pin.public_view_ref),'exact current public resource refs required');
  const m=e.method,v=e.view;
  check(keys(m,['API_calls','alias_identity_merge_enabled','authority_bindings','case_sha256','input_refs','label','maximum_variants_per_reading','method_id','native_B_licenses_or_tiers_created','native_runs','original_native','producer','publication_authorized','query_sha256','reading_ids','score_rules','sha256','source_ascription_not_world_truth','source_index_ref','source_view_policy','state','task','top5_visible_reserve6_to8_retained','version','whole_visible_query_event_certified','publication_projection_version','original_method_sha256','publication_lineage'])&&
    keys(v,['case','focal_summary','graph_paths_fabricated','method_id','method_packet_sha256','native_status_or_gates_rewritten','nomination_only','original_native','publication_authorized','query_sha256','readings','selection','sha256','source_ascription_not_world_truth','source_index_ref','source_pages','source_view_policy','version','publication_projection_version','original_view_sha256','publication_lineage']),'closed METHOD/VIEW schema required');
  for(const [x,kind,version]of [[m,'method','source-realized-redaction-method/1'],[v,'view','source-realized-redaction-view/1']]){check(x?.version===version&&x.method_id===METHOD_ID&&
    x.publication_projection_version==='source-realized-location-redaction/1'&&sha(x['original_'+kind+'_sha256'])&&x['original_'+kind+'_sha256']===pin['original_'+kind+'_sha256']&&
    sha(x.sha256)&&x.sha256===pin['public_'+kind+'_sha256']&&await hash(parsed.withoutSHA(x))===x.sha256,'public method/view selfhash or explicit lineage differs');lineage(x,kind);
    check(x.publication_lineage.original_file_sha256===pin[kind+'_ref']?.sha256,'original artifact file commitment differs from receiver metadata');
    const ref=e['public_'+kind+'_ref'],body=parsed.canonical(x),compact=await hash(body),terminated=await hash(body+'\n');
    check([compact,terminated].includes(ref.sha256)&&ref.path==='data/source-realized/'+row.case.case_id+'/'+ref.sha256+'.json','current public resource must be canonical, exact and content-addressed');}
  check(v.method_packet_sha256===m.original_method_sha256&&sha(m.case_sha256)&&await hash(ascii(stable(v.case)))===m.case_sha256&&pin.case_sha256===m.case_sha256,'original METHOD or case commitment differs');
  const fields=['case_id','task','corpus','query','date','document_id','focal_marker'];check(keys(v.case,fields)&&fields.every(k=>v.case[k]===row.case?.[k]&&v.case[k]===record.case?.[k])&&v.case.task==='redaction'&&
    typeof v.case.focal_marker==='string'&&v.case.query.split(v.case.focal_marker).length===2&&await hash(ascii(v.case.query))===pin.query_sha256&&v.query_sha256===pin.query_sha256&&m.query_sha256===pin.query_sha256&&record.plan?.query_sha256===pin.query_sha256,'exact public case/query/native plan required');
  const native=v.original_native,nativeReference=row.configurations?.[config]?.native_checkpoint;
  check(consistentReferences([nativeReference,record.native_checkpoint,native.native_ref,m.original_native.native_ref,m.authority_bindings?.native_ref]),'native reference group has conflicting metadata');
  check(sha(nativeReference?.sha256)&&nativeReference.sha256===pin.original_native_sha256&&sameReference(nativeReference,record.native_checkpoint)&&sameReference(nativeReference,native.native_ref)&&sameReference(m.original_native,native)&&
    native.native_checksum===record.native_checksum&&native.preserved_whole_by_reference===true&&native.candidates_or_tiers_modified===false&&native.merged_with_new_method===false&&
    v.native_status_or_gates_rewritten===false&&v.graph_paths_fabricated===false&&v.source_ascription_not_world_truth===true&&m.native_B_licenses_or_tiers_created===false&&m.alias_identity_merge_enabled===false&&m.whole_visible_query_event_certified===false&&m.API_calls===0&&m.native_runs===0&&m.publication_authorized===false&&v.publication_authorized===false,'native must remain exact, separate and non-certified');
  const index=v.source_index_ref,id=index?.resource_id??(index?.source_status==='INCUMBENT_NOT_MIGRATED'?index?.native_index_ref?.binding?.graph_id:null);
  const indexReferences=[index,record.index_ref,pin.execution_context.index_ref,m.source_index_ref,m.authority_bindings?.source_index_ref];
  check(consistentReferences(indexReferences),'source index reference group has conflicting metadata');
  check(sameReference(index,record.index_ref)&&sameReference(index,m.source_index_ref)&&id===resourceBinding.resource_id&&index.sha256===resourceBinding.index_sha256&&index.registry_sha256===resourceBinding.registry_sha256&&
    same(v.source_view_policy,m.source_view_policy)&&same(v.source_view_policy,pin.source_view_policy)&&same(v.source_view_policy,record.configuration?.source_view_policy)&&same(v.source_view_policy,record.result?.source_view_policy),'source policy/index/current public resource differs');
  check(m.authority_bindings?.actual_receipts_replayed===true&&sameReference(m.authority_bindings.source_index_ref,index)&&same(m.authority_bindings.inspected_page_ids,record.result.inspected_page_ids)&&
    sameReference(m.authority_bindings.native_ref,native.native_ref)&&m.authority_bindings.native_checksum===native.native_checksum,'canonical original inspection authority differs');
  const readings=record.plan?.readings_packet?.readings;check(Array.isArray(readings)&&readings.length>0&&readings.length<=128&&Array.isArray(v.readings)&&v.readings.length===readings.length&&
    same(m.reading_ids,readings.map(r=>r.id))&&v.readings.every((b,i)=>same(b.reading,readings[i]))&&new Set(m.reading_ids).size===m.reading_ids.length,'complete unchanged actual readings required');
  check(m.maximum_variants_per_reading===8&&m.top5_visible_reserve6_to8_retained===true&&m.score_rules.same_score_used_for_ranking_and_display===true&&m.score_rules.probability===false,'reader cap/math scope differs');
  if(!v.nomination_only){receipt(v.focal_summary?.assessment_receipt);if(v.focal_summary.semantic_review_receipt!==null)distinct(v.focal_summary.assessment_receipt,v.focal_summary.semantic_review_receipt);}
  const pages=new Map();check(Array.isArray(v.source_pages)&&v.source_pages.length<=record.result.inspected_page_ids.length,'bounded actual own pages required');
  for(const p of v.source_pages){check(!pages.has(p.page_id)&&record.result.inspected_page_ids[p.inspected_position]===p.page_id&&p.corpus===v.case.corpus&&
      (v.case.corpus==='cib'&&v.source_view_policy.id!=='strict_prior'||p.document_id!==v.case.document_id)&&
      /^\d{4}-\d{2}-\d{2}$/.test(p.date)&&(v.source_view_policy.date_relation==='<='?p.date<=v.case.date:v.source_view_policy.date_relation==='<'&&p.date<v.case.date)&&['earlier','both'].includes(p.visibility)&&p.clipped===false&&Array.isArray(p.windows)&&p.windows.length===1&&
      p.windows[0].start===0&&p.windows[0].end===Array.from(p.windows[0].text).length&&await hash(ascii(p.windows[0].text))===p.page_sha256&&await hash(p.windows[0].text)===p.page_utf8_sha256,'exact eligible raw source page/date/hash required');
    if(v.case.corpus!=='cib')check(p.classification==='CONFIDENTIAL'&&Array.isArray(p.handling)&&p.handling.length===0,'ordinary cable classification/handling differs');pages.set(p.page_id,p);}
  const citations=[],ids=new Set();let validFocal=0,direct=0,quarantined=0;
  for(const b of v.readings){check(Array.isArray(b.candidates)&&b.candidates.length<=8&&b.raw_candidate_count<=8&&b.raw_candidate_count>=0,'bounded nonempty/empty R slate');let raw=0,prior=null;
    for(const [i,c]of b.candidates.entries()){check(typeof c.id==='string'&&c.rank===i+1&&Array.isArray(c.variants)&&c.variants.length>0&&c.variants.length<=8&&c.source_votes_added===0&&c.aliases_merged===false&&c.proof_requirements_unioned===false,'same-surface display only, no alias/vote/proof union');
      if(prior)check(prior.priority.value>c.priority.value||prior.priority.value===c.priority.value&&prior.id<c.id,'rank must follow exact displayed priority/tie rule');prior=c;
      const byDoc=new Map();let last=null;
      for(const x of c.variants){raw++;check(!ids.has(x.id)&&x.reading_id===b.reading.id&&same(x.declared_reading,b.reading)&&typeof x.fill==='string'&&normalized(x.fill)===normalized(c.fill)&&
          x.completed_input===v.case.query.replace(v.case.focal_marker,x.fill)&&await hash(ascii(x.completed_input))===x.completed_input_sha256&&await hash(x.completed_input)===x.completed_input_utf8_sha256,'variant/reading/full insertion differs');ids.add(x.id);
        if(last)check(last.priority.value>x.priority.value||last.priority.value===x.priority.value&&last.id<x.id,'representative must be maximum variant');last=x;
        const p=pages.get(x.source?.page_id),s=x.source_reader;check(p&&x.source.document_id===p.document_id&&x.source.date===p.date&&x.source.page_sha256===p.page_sha256&&
          s.canonical_page_id===p.page_id&&s.document_id===p.document_id&&s.date===p.date&&s.corpus===p.corpus&&s.source_sha256===p.page_sha256&&sameReference(s.source_index_ref,index),'variant must own the source/context');
        indexReferences.push(s.source_index_ref);
        for(const key of ['exact_quote','original_phrase','qualification_paragraph'])check(span(p.windows[0].text,x.source[key]),'source quote/phrase/full qualification span differs');
        check(same(s.quote_span,x.source.exact_quote)&&same(s.phrase_span,x.source.original_phrase)&&same(s.qualification_span,x.source.qualification_paragraph)&&
          same(s.qualification_span,qualification(p.windows[0].text,s.quote_span))&&unique(p.windows[0].text,s.quote_span.text)&&unique(s.quote_span.text,s.phrase_span.text)&&noMask(s.quote_span.text)&&noMask(s.phrase_span.text)&&
          ['UNCHANGED','INFLECTION','PARAPHRASE'].includes(x.transformation?.kind)&&typeof x.transformation.description==='string'&&(x.transformation.kind!=='UNCHANGED'||x.fill===s.phrase_span.text),'actual original source phrase/transformation required');
        const review=x.source_review;check(review?.decision==='ACCEPT_CONTEXTUAL'&&review.source_fidelity==='FAITHFUL'&&review.category==='FITS'&&review.grammar==='FITS'&&review.context==='RELEVANT'&&review.unknown_mask_inferred===false&&review.qualifications_preserved===true,'source nomination review required');
        check(await hash(parsed.canonical(x.grammar))===x.context_priority.bindings.grammar_sha256&&await hash(parsed.canonical(x.declared_reading))===x.context_priority.bindings.reading_sha256&&
          x.context_priority.bindings.completed_input_sha256===x.completed_input_sha256&&x.context_priority.bindings.query_sha256===v.query_sha256&&x.grammar.completed_input_sha256===x.completed_input_sha256,'original local grammar/reading/insertion commitments differ');
        distinct(x.provenance?.attestations?.proposal,x.provenance?.attestations?.review);validatePriority(x,v,p);
        citations.push(citation(p,s.quote_span),citation(p,s.phrase_span),citation(p,s.qualification_span));for(const context of s.focal_source_contexts||[])citations.push(citation(p,{...context.anchor,text:context.anchor.quote}),citation(p,context.qualification_span));
        if(x.priority.focal_row){validFocal++;direct+=Number(x.priority.source_supported_fill_approved);}else if(!v.nomination_only)quarantined++;
        if(!byDoc.has(p.document_id))byDoc.set(p.document_id,[]);byDoc.get(p.document_id).push(x);
      }
      check(c.representative_id===c.variants[0].id&&c.fill===c.variants[0].fill&&same(c.priority,c.variants[0].priority)&&c.id==='source_surface_'+(await hash(ascii([METHOD_ID,b.reading.id,normalized(c.fill)]))).slice(0,24)&&
        same(c.document_maxima,[...byDoc].sort(([a],[z])=>a<z?-1:a>z?1:0).map(([document_id,rows])=>({document_id,value:Math.max(...rows.map(x=>x.priority.value)),variant_ids:rows.map(x=>x.id)}))),'representative/per-document MAX changed');
    }
    check(raw===b.raw_candidate_count&&same(b.top5_ids,b.candidates.slice(0,5).map(c=>c.id))&&same(b.reserve_ids,b.candidates.slice(5,8).map(c=>c.id)),'top5/reserve/full variant inventory differs');
  }
  check(consistentReferences(indexReferences),'variant/source index reference group has conflicting metadata');
  check(v.nomination_only?m.state==='NOMINATION_ONLY'&&v.focal_summary===null:m.state==='ACTUAL_FOCAL_REVIEWED'&&v.focal_summary?.valid_rows===validFocal&&v.focal_summary.source_approved===direct&&v.focal_summary.quarantined===quarantined,'focal/nomination counts differ');
  const primary=v.readings.find(b=>b.candidates.length)?.reading.id??null,selection=v.selection;check(selection?.primary_reading_id===primary&&selection.rule==='FIRST_NONEMPTY_NEW_METHOD_SLATE_OR_NULL'&&selection.native_or_QA_reading_selection_changed===false&&
    selection.presentation_only===(selection.presentation_reading_id!==null)&&selection.display_reading_id===(selection.presentation_reading_id||primary)&&
    (selection.presentation_reading_id===null||v.readings.some(b=>b.reading.id===selection.presentation_reading_id&&b.candidates.length)),'transparent original reading selection required');
  return {method:m,view:v,citations};
}

/* A source view is bound to the selected native execution, never the URL. */
const same = (a,b) => a && b && Object.keys(a).length===Object.keys(b).length && Object.keys(b).every(k=>a[k]===b[k]);
export function savedSourcePolicy(value) {
  const id = value?.id || 'strict_prior';
  if (!['strict_prior','source_day_inclusive','live_before_with_earlier_origin','live_through_with_earlier_origin','supplied_documents_inclusive','later_release_inclusive'].includes(id)) throw Error('Unknown saved evidence policy.');
  const supplied=id==='supplied_documents_inclusive',later=id==='later_release_inclusive';
  const expected = {version:'trusted-corpus-source-view/1',id,date_relation:['source_day_inclusive','live_through_with_earlier_origin','supplied_documents_inclusive','later_release_inclusive'].includes(id)?'<=':'<',
    cutoff_role:id==='live_before_with_earlier_origin'?'exclusive_live_as_of':id==='live_through_with_earlier_origin'?'inclusive_live_as_of':'source_document_date',
    cib_source_document:later?'LATER_ONLY_INCLUDING_ORIGIN':supplied?'EARLIER_OR_BOTH_OR_REGISTERED_PUBLIC_SUPPLIED_EDITION':id==='strict_prior'?'EXCLUDED':'EARLIER_OR_BOTH_ONLY',
    cable_origin:'WHOLE_DOCUMENT_EXCLUDED',cable_classification:'CONFIDENTIAL',cable_document_wide_handling_veto:true,
    later_or_secret_version_admitted:supplied||later,source_dates_or_document_ids_rewritten:false};
  if(supplied)Object.assign(expected,{supplied_document_registration_required:true,
    supplied_document_scope:'HASH_BOUND_REGISTERED_PUBLIC_CIB_EDITIONS_ONLY',ordinary_source_views_unchanged:true});
  if(later)Object.assign(expected,{source_edition:'later',native_later_source_index_required:true,ordinary_source_views_unchanged:true});
  if (value!=null && !same(value,expected)) throw Error('The saved evidence-policy descriptor changed.');
  return expected;
}
export function savedSourceScope(caseInfo, declaration) {
  const policy=savedSourcePolicy(declaration),inclusive=policy.date_relation==='<=';
  return {source_view_policy:policy,strictly_before:inclusive?null:caseInfo.date,on_or_before:inclusive?caseInfo.date:null,
    whole_origin_excluded:caseInfo.corpus!=='cib'||policy.id==='strict_prior'?caseInfo.document_id:null};
}
export function traceSourceScope(caseInfo,saved,trace) {
  const bound=savedSourcePolicy(saved?.source_view_policy),actual=savedSourcePolicy(trace?.source_view_policy);
  if(!same(bound,actual))throw Error('Trace and native evidence policies disagree.');
  return savedSourceScope(caseInfo,bound);
}
export function sourceScopeAllows(proof,scope) {
  if(!proof?.document_id||!/^\d{4}-\d{2}-\d{2}$/.test(proof.date||''))return false;
  if(isSuppliedSourcePage(proof)&&savedSourcePolicy(scope.source_view_policy).id!=='supplied_documents_inclusive')return false;
  const inclusiveDate=scope.on_or_before|| (scope.date_relation==='<='?scope.cutoff:null);
  if(scope.source_view_policy){
    const policy=savedSourcePolicy(scope.source_view_policy);
    if(scope.date_relation!=null&&scope.date_relation!==policy.date_relation)return false;
    if(policy.date_relation==='<=' ? !inclusiveDate||scope.strictly_before!=null : !scope.strictly_before||inclusiveDate!=null)return false;
  }
  return (!scope.strictly_before||proof.date<scope.strictly_before)&&
    (!inclusiveDate||proof.date<=inclusiveDate)&&
    (!scope.whole_origin_excluded||proof.document_id!==scope.whole_origin_excluded);
}

const suppliedPages=new WeakMap();
const laterPages=new WeakMap();
const canonical=value=>{
  const encode=v=>Array.isArray(v)?'['+v.map(encode).join(',')+']':v&&typeof v==='object'?'{'+
    Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}':JSON.stringify(v);
  return encode(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
};
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const digest=value=>sha(new TextEncoder().encode(canonical(value)));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const ref=value=>value&&typeof value.path==='string'&&!/[\\?#:\u0000-\u001f]/.test(value.path)&&
  !value.path.startsWith('/')&&value.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&hash(value.sha256);
const check=(ok,message)=>{if(!ok)throw Error('Registered source binding: '+message);};
const pageKeys=['id','canonical_page_id','corpus','document_id','date','text','source_sha256','source_hash_contract',
  'raw_text_sha256','permitted','visibility','view','earlier_page','source_page','pdf_page','original_canonical_page_ids',
  'original_canonical_page_id','classification','structured_classification','handling','native_page','supplied_source'];
const payload=page=>Object.fromEntries(pageKeys.map(key=>[key,page[key]]));
export function isSuppliedSourcePage(page){
  return Boolean(page&&(page.visibility==='supplied_registered'||Object.hasOwn(page,'supplied_source')||
    String(page.canonical_page_id||page.id||'').startsWith('supplied_page_')));
}
export function registeredSuppliedPageInfo(page){
  const bound=page&&suppliedPages.get(page);
  if(!bound)return null;
  check(canonical(payload(page))===bound.snapshot,'verified page changed');
  return bound;
}
export function registeredLaterPageInfo(page){
  const bound=page&&laterPages.get(page);
  if(!bound)return null;
  check(canonical(page)===bound.snapshot,'verified later page changed');
  return bound;
}

// Called only for the already resource-verified source endpoint. Registration
// authority is the frozen native index/envelope, never serialized page flags.
export async function bindRegisteredSourceResponse(value,{record,caseInfo,binding}={}){
  if(record?.result?.source_view_policy?.id==='later_release_inclusive'||record?.source_view_policy?.id==='later_release_inclusive')
    return bindLaterSourceResponse(value,{record,caseInfo,binding});
  const pages=[value?.page||value,...(Array.isArray(value?.document_pages)?value.document_pages:[])];
  if(!pages.some(isSuppliedSourcePage))return value;
  const policy=savedSourcePolicy(record?.result?.source_view_policy||record?.source_view_policy);
  check(policy.id==='supplied_documents_inclusive'&&caseInfo?.corpus==='cib','policy does not admit supplied editions');
  check(same(savedSourcePolicy(value?.source_view_policy),policy),'source/native policy differs');
  const index=record?.index_ref,scope=savedSourceScope(caseInfo,policy),context=value?.binding;
  check(index&&hash(index.source_binding_sha256)&&binding&&
    ['resource_id','registry_sha256','index_sha256','graph_id','hierarchy_id'].every(k=>
      typeof binding[k]==='string'&&binding[k]&&value.resource_binding?.[k]===binding[k]&&record.resource_binding?.[k]===binding[k])&&
    index.sha256===binding.index_sha256&&index.registry_sha256===binding.registry_sha256&&
    await digest(context)===index.source_binding_sha256,'source endpoint is not bound to the native index');
  check(context?.corpus==='cib'&&context.resource_id===binding.resource_id&&context.graph_id===binding.graph_id&&
    context.hierarchy_id===binding.hierarchy_id&&context.native_registry_digest===context.native_registry?.registry_digest,
    'canonical source/graph context differs');
  const registration=context.native_registry?.registered_supplied_documents,edition=context.source_edition_id;
  check(registration?.version==='registered-full-source-documents/1'&&ref(registration.manifest_ref)&&
    typeof edition==='string'&&/^source_edition_[a-f0-9]{24}$/.test(edition)&&context.native_registry.source_edition_id===edition,
    'registered edition/manifest missing');
  check(value.cutoff===caseInfo.date&&value.whole_origin_excluded===scope.whole_origin_excluded,'source cutoff/origin differs');
  const pending=[];
  for(const page of pages.filter(isSuppliedSourcePage)){
    const s=page.supplied_source,n=page.native_page,release=s?.source_release,physical=s?.physical_page,original=page.original_canonical_page_ids;
    check(pageKeys.every(k=>Object.hasOwn(page,k))&&page.id===page.canonical_page_id&&page.corpus==='cib'&&page.permitted===true&&
      page.visibility==='supplied_registered'&&sourceScopeAllows(page,scope),'invalid registered page');
    check(s?.version===registration.version&&s.source_edition_id===edition&&canonical(s.source_manifest_ref)===canonical(registration.manifest_ref)&&
      release?.public_release===true&&['earlier','later'].includes(release.edition)&&/^\d{4}-\d{2}-\d{2}$/.test(release.release_date||'')&&
      page.view===release.edition&&Number.isSafeInteger(physical)&&physical>0&&page.source_page===physical&&page.pdf_page===physical&&
      page.earlier_page===null&&ref(s.pdf_ref)&&s.semantic_observations_added===false&&s.identity_or_task_support_certified===false,
      'edition, physical PDF page or non-semantic scope differs');
    check(n?.document_id===page.document_id&&n.document_date===page.date&&n.edition===page.view&&
      (n.view==null||n.view===page.view)&&n.physical_page===physical&&n.source_page_id===s.original_source_page_id&&
      n.source_edition_id===s.original_source_edition_id&&n.text===page.text&&n.remaining_unknowns_filled===false&&
      canonical(n.pdf_ref)===canonical(s.pdf_ref)&&n.text_sha256_utf8===page.raw_text_sha256&&
      ref(n.clean_text_ref)&&n.clean_text_ref.sha256===page.raw_text_sha256&&
      page.structured_classification===n.classification_level&&
      (page.classification===page.structured_classification||ref(s.classification_evidence_ref)),
      'original document/text/classification metadata differs');
    check(Array.isArray(original)&&original.every(id=>typeof id==='string'&&id)&&
      canonical(original)===canonical(s.original_canonical_page_ids)&&canonical(original)===canonical(n.existing_canonical_page_ids)&&
      page.original_canonical_page_id===(original.length===1?original[0]:null),'original canonical mapping differs');
    check(typeof page.text==='string'&&page.source_hash_contract==='shared-json-string-ensure-ascii-true/sha256'&&
      await digest(page.text)===page.source_sha256&&await sha(new TextEncoder().encode(page.text))===page.raw_text_sha256&&
      page.id==='supplied_page_'+(await digest([edition,s.source_manifest_ref,page.document_id,physical,page.raw_text_sha256])).slice(0,24),
      'page identity or exact text hash differs');
    pending.push([page,Object.freeze({snapshot:canonical(payload(page)),edition,physical_page:physical,release:release.edition,
      pdf_ref:Object.freeze({...s.pdf_ref}),source_manifest_ref:Object.freeze({...s.source_manifest_ref}),original_canonical_page_id:page.original_canonical_page_id})]);
  }
  for(const [page,info]of pending)suppliedPages.set(page,info);
  return value;
}

export async function bindLaterSourceResponse(value,{record,caseInfo,binding}={}){
  const originalValue=value,originalRecord=record,originalCase=caseInfo,originalBinding=binding;
  const initialSnapshot=canonical([value,record,caseInfo,binding]);
  const originalPages=[value?.page||value,...(Array.isArray(value?.document_pages)?value.document_pages:[])];
  value=structuredClone(value);record=structuredClone(record);caseInfo=structuredClone(caseInfo);binding=structuredClone(binding);
  const policy=savedSourcePolicy(record?.result?.source_view_policy||record?.source_view_policy);
  check(policy.id==='later_release_inclusive'&&caseInfo?.corpus==='cib','later source policy required');
  check(same(savedSourcePolicy(value?.source_view_policy),policy),'later source/native policy differs');
  const index=record?.index_ref,context=value?.binding,scope=savedSourceScope(caseInfo,policy);
  check(index&&binding&&['resource_id','registry_sha256','index_sha256','graph_id','hierarchy_id'].every(k=>
    typeof binding[k]==='string'&&binding[k]&&value.resource_binding?.[k]===binding[k]&&record.resource_binding?.[k]===binding[k])&&
    index.sha256===binding.index_sha256&&index.registry_sha256===binding.registry_sha256&&
    hash(index.source_binding_sha256)&&await digest(context)===index.source_binding_sha256,
    'later response is not bound to its native source index');
  const registry=context?.native_registry;
  check(context?.corpus==='cib'&&context.resource_id===binding.resource_id&&context.graph_id===binding.graph_id&&
    context.hierarchy_id===binding.hierarchy_id&&context.native_registry_digest===registry?.registry_digest&&
    registry?.native_source_view==='later'&&registry.source_view_contract==='public-native-later-source-projection/1'&&
    ref(registry.projection_parent_registry_ref)&&registry.files?.pages?.path?.includes('/views/later/')&&
    hash(registry.files.pages.sha256)&&!registry.registered_supplied_documents,
    'later producer edition is not the recorded canonical projection');
  check(value.cutoff===caseInfo.date&&value.whole_origin_excluded===scope.whole_origin_excluded,'later cutoff/origin differs');
  const pages=[value?.page||value,...(Array.isArray(value?.document_pages)?value.document_pages:[])],pending=[];
  for(const [index,page]of pages.entries()){
    const native=page?.native_page,physical=page?.source_page;
    check(page?.corpus==='cib'&&page.permitted===true&&page.visibility==='later'&&page.view==='later'&&
      !isSuppliedSourcePage(page)&&sourceScopeAllows(page,scope)&&Number.isSafeInteger(physical)&&physical>0&&
      page.earlier_page===null&&native?.view==='later'&&native.canonical_page_id===(page.id||page.canonical_page_id)&&
      native.document_id===page.document_id&&native.source_page===physical&&native.text===page.text,
      'later page edition, locator or original text differs');
    check(page.source_hash_contract==='shared-json-string-ensure-ascii-true/sha256'&&
      await digest(page.text)===page.source_sha256&&await sha(new TextEncoder().encode(page.text))===page.raw_text_sha256,
      'later page raw text hash differs');
    pending.push([originalPages[index],Object.freeze({snapshot:canonical(page),physical_page:physical,edition:'later',release:'later'})]);
  }
  check(canonical([originalValue,originalRecord,originalCase,originalBinding])===initialSnapshot,
    'later source inputs changed while verifying');
  check(pending.every(([page,info])=>canonical(page)===info.snapshot),'later source batch changed while verifying');
  for(const [page,info]of pending)laterPages.set(page,info);
  return originalValue;
}

export function sourcePagePolicyAllows(page,caseInfo,scope){
  if(!sourceScopeAllows(page,scope)||page.permitted===false)return false;
  if(isSuppliedSourcePage(page))return caseInfo.corpus==='cib'&&savedSourcePolicy(scope.source_view_policy).id==='supplied_documents_inclusive'&&
    registeredSuppliedPageInfo(page)!==null;
  if(savedSourcePolicy(scope.source_view_policy).id==='later_release_inclusive'){
    const registered=laterPages.get(page);
    return caseInfo.corpus==='cib'&&Boolean(registered)&&registered.snapshot===canonical(page);
  }
  if(['later','later_only','secret'].includes(page.visibility)||['later','later_only','secret'].includes(page.view)||
    ['later','later_only','secret'].includes(page.native_page?.view))return false;
  return !(caseInfo.corpus!=='cib'&&page.classification&&page.classification!=='CONFIDENTIAL')&&
    !(Array.isArray(page.handling)&&page.handling.includes('NOFORN'));
}
export function sourcePolicyCaption(scope){
  const policy=savedSourcePolicy(scope.source_view_policy);
  if(policy.id==='later_release_inclusive')return 'Later-release documents through the input date, including the origin.';
  return policy.id==='supplied_documents_inclusive'?
    'Earlier-visible corpus plus registered full-document editions. Original later-release provenance is retained; this is not earlier-only recovery.':
    scope.whole_origin_excluded?'The whole origin document is excluded.':'Only earlier/both CIB release text is eligible, including the origin when admitted by this saved view.';
}
export function sourceScopesEqual(a,b) {
  const through=s=>s?.on_or_before||(s?.date_relation==='<='?s.cutoff:null);
  return (a?.strictly_before??null)===(b?.strictly_before??null)&&through(a)===through(b)&&
    (a?.whole_origin_excluded??null)===(b?.whole_origin_excluded??null)&&same(savedSourcePolicy(a?.source_view_policy),savedSourcePolicy(b?.source_view_policy));
}

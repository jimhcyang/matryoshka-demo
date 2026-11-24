/* A source view is bound to the selected native execution, never the URL. */
const same = (a,b) => a && b && Object.keys(a).length===Object.keys(b).length && Object.keys(b).every(k=>a[k]===b[k]);
export function savedSourcePolicy(value) {
  const id = value?.id || 'strict_prior';
  if (!['strict_prior','source_day_inclusive','live_before_with_earlier_origin','live_through_with_earlier_origin'].includes(id)) throw Error('Unknown saved evidence policy.');
  const expected = {version:'trusted-corpus-source-view/1',id,date_relation:['source_day_inclusive','live_through_with_earlier_origin'].includes(id)?'<=':'<',
    cutoff_role:id==='live_before_with_earlier_origin'?'exclusive_live_as_of':id==='live_through_with_earlier_origin'?'inclusive_live_as_of':'source_document_date',
    cib_source_document:id==='strict_prior'?'EXCLUDED':'EARLIER_OR_BOTH_ONLY',
    cable_origin:'WHOLE_DOCUMENT_EXCLUDED',cable_classification:'CONFIDENTIAL',cable_document_wide_handling_veto:true,
    later_or_secret_version_admitted:false,source_dates_or_document_ids_rewritten:false};
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
export function sourceScopesEqual(a,b) {
  const through=s=>s?.on_or_before||(s?.date_relation==='<='?s.cutoff:null);
  return (a?.strictly_before??null)===(b?.strictly_before??null)&&through(a)===through(b)&&
    (a?.whole_origin_excluded??null)===(b?.whole_origin_excluded??null)&&same(savedSourcePolicy(a?.source_view_policy),savedSourcePolicy(b?.source_view_policy));
}

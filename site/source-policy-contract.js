/* Only the server's declared native policy can admit an earlier CIB origin. */
export const LIVE_SOURCE_POLICY = Object.freeze({
  version: 'trusted-corpus-source-view/1', id: 'live_before_with_earlier_origin',
  date_relation: '<', cutoff_role: 'exclusive_live_as_of',
  cib_source_document: 'EARLIER_OR_BOTH_ONLY', cable_origin: 'WHOLE_DOCUMENT_EXCLUDED',
  cable_classification: 'CONFIDENTIAL', cable_document_wide_handling_veto: true,
  later_or_secret_version_admitted: false, source_dates_or_document_ids_rewritten: false
});
export const LIVE_THROUGH_SOURCE_POLICY = Object.freeze({...LIVE_SOURCE_POLICY,
  id: 'live_through_with_earlier_origin', date_relation: '<=', cutoff_role: 'inclusive_live_as_of'});
const same = (a, b) => {
  const keys = Object.keys(b);
  return a && Object.keys(a).length === keys.length && keys.every(k => a[k] === b[k]);
};
export function usesLiveSourcePolicy(scope = {}) {
  if (scope.source_view_policy === undefined) return false;
  if (![LIVE_SOURCE_POLICY, LIVE_THROUGH_SOURCE_POLICY].some(p => same(scope.source_view_policy, p))) throw Error('Unknown Live evidence policy.');
  return true;
}
export function verifyLiveSourcePolicy(scope, native, request, fixture = false) {
  const current = usesLiveSourcePolicy(scope);
  const analyst = /^live-analyst-origin:[a-f0-9]{32}$/.test(request.excluded_origin || '');
  const excluded = current && (request.corpus === 'cib' || analyst) ? null : request.excluded_origin;
  if (scope.excluded_whole_origin !== excluded) throw Error('The declared document exclusion changed.');
  if (current) {
    if (scope.origin_document !== (analyst ? null : request.excluded_origin)) throw Error('The source-document binding changed.');
    if (!fixture && (!same(native.configuration?.source_view_policy, scope.source_view_policy) ||
        !same(native.result?.source_view_policy, scope.source_view_policy))) throw Error('Native execution uses another evidence policy.');
  }
  return {current, excludeOrigin: !current || request.corpus !== 'cib',
    inclusive: current && scope.source_view_policy.id === LIVE_THROUGH_SOURCE_POLICY.id};
}

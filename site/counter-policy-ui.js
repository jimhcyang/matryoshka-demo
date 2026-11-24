/* Present the executor's bounded recommendation scope, not a new decision. */
export function counterPolicyNotice(candidates = []) {
  const policies = candidates.map(candidate => candidate?.local_decision?.counter_policy)
    .filter(policy => policy?.policy_mode === 'positive_support' && policy.positive_support_preserved === true);
  if (!policies.length) return null;
  const bound = policies.every(policy => policy.counter_policy_version === 'narrative-redaction-counter-policy/2' &&
    policy.bounded_recommendation === true && policy.probability_estimate === false &&
    policy.corpus_counter_cleared === false && policy.world_truth_certified === false);
  if (!bound) return {warning: true, text: 'Recommendation scope could not be verified. Inspect the saved decision.'};
  const warning = policies.some(policy => policy.coverage_warning === true);
  return {warning, text: warning
    ? 'Source-backed recommendation. Opaque or unmodeled content may still contain conflicting evidence.'
    : 'Source-backed recommendation within the inspected evidence, not a complete-corpus or probability claim.'};
}

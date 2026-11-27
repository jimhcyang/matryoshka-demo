// Arithmetic only. The caller must separately bind the native/candidate/source/plan hashes.
export function replayContextPriorityV10(card, { validateLegacyCard } = {}) {
  const fail = message => { throw new Error(message); };
  const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : fail('V10 finite number');
  const close = (a, b) => Math.abs(number(a) - b) <= 1e-12;
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])])) : value;
  const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const root = ['version','producer','id','reading_id','fill','native_status','evidence_tier','mode','raw_features',
    'components','score','score_units','calibrated_probability','bindings','source_features','native_v7_auxiliary',
    'facts_classes_gates_unchanged','source_support_or_B_credit_added'];
  if (!keys(card, root) || card.version !== 'terminal-context-priority/10'
      || card.producer !== 'source-human-recency-context-rank/10'
      || card.score_units !== 'TIERED_CONTEXT_PRIORITY_ORDINAL_NOT_PROBABILITY'
      || card.calibrated_probability !== false || card.facts_classes_gates_unchanged !== true
      || card.source_support_or_B_credit_added !== false) fail('V10 contract');
  const bindingKeys = ['case_sha256','origin_date','query_sha256','provided_plan_sha256','readings_sha256',
    'reading_sha256','raw_candidate_sha256','source_binding','source_view_policy','public_context'];
  if (!keys(card.bindings, bindingKeys)) fail('V10 bindings');
  const legacy = card.native_v7_auxiliary;
  if (typeof validateLegacyCard !== 'function' || validateLegacyCard(legacy) !== true) fail('Existing legacy verifier required');
  const tier = card.evidence_tier;
  if (!Number.isInteger(tier) || ![0,1,2].includes(tier) || legacy.evidence_tier !== tier
      || !['terminal-evidence-fit/7','native-own-complement-context-fit/1','native-source-relative-context-fit/1'].includes(legacy.version)
      || legacy.id !== card.id || legacy.fill !== card.fill || legacy.native_status !== card.native_status) fail('V10 legacy binding');
  const raw = card.raw_features;
  if (!keys(raw, ['human_context_category','literal_focal_coverage','source_age_days','half_life_days','decay','context_merit','legacy_score'])
      || raw.half_life_days !== 90 || number(raw.legacy_score) !== number(legacy.score)
      || raw.legacy_score < 0 || raw.legacy_score >= 300) fail('V10 features');
  const expected = {evidence_tier:tier/3, context_human:0, context_merit:0, legacy_residual:0};
  if (card.mode === 'source_human_recency') {
    const human = raw.human_context_category, age = raw.source_age_days, coverage = number(raw.literal_focal_coverage);
    if (tier !== 0 || card.native_status !== 'exploratory_contextual' || card.bindings.public_context.active !== true
        || !Number.isInteger(human) || ![0,1].includes(human) || !Number.isInteger(age) || age < 0 || coverage < 0 || coverage > 1) fail('V10 context range');
    const decay = 2 ** (-age/90), merit = (1+coverage)*decay;
    if (!close(raw.decay, decay) || !close(raw.context_merit, merit)) fail('V10 decay');
    const source = card.source_features, own = source?.winner;
    const day = text => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail('V10 date');
      const parsed = new Date(`${text}T00:00:00.000Z`);
      if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== text) fail('V10 date');
      return parsed.valueOf()/86400000;
    };
    if (!own || day(card.bindings.origin_date)-day(own.citation.date) !== age
        || source.human_and_date_and_fit_from_same_quote !== true
        || !source.observations.some(row => same(row,own))
        || own.human_context_category !== human || own.literal_focal_coverage !== coverage || own.source_age_days !== age
        || own.half_life_days !== 90 || own.decay !== raw.decay || own.context_merit !== raw.context_merit) fail('V10 same-quote binding');
    expected.context_human = .99*human/6;
    expected.context_merit = .99*merit/18;
  } else {
    if (card.mode !== 'legacy_v7_passthrough' || card.source_features !== null
        || ['human_context_category','literal_focal_coverage','source_age_days','decay','context_merit'].some(k => raw[k] !== null)) fail('V10 inactive');
    expected.legacy_residual = raw.legacy_score/300-tier/3;
  }
  if (!keys(card.components, Object.keys(expected)) || Object.keys(expected).some(k => !close(card.components[k], expected[k]))) fail('V10 components');
  const score = Object.values(expected).reduce((a,b) => a+b, 0);
  if (!close(card.score, score) || score < 0 || score >= 1) fail('V10 ordinal');
  return score;
}

/* The final arithmetic is saved by the native executor, never invented from rank. */
export const SCORE_VERSION = 'terminal-evidence-fit/3';
export const EVIDENCE_SCORE_VERSION = 'terminal-evidence-fit/4';
export const POINTS_SCORE_VERSION = 'terminal-evidence-fit/5';
export const SOURCE_POINTS_VERSION = 'terminal-evidence-fit/6';

function number(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

const close = (left, right) => number(left) && number(right) &&
  Math.abs(left - right) <= 32 * Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
const componentKeys = ['evidence_tier_points', 'source_function_points', 'evidence_fit_points',
  'source_function_max', 'evidence_fit_max', 'utility', 'saturated_utility', 'rank_or_pool_position_used'];

function validSourceContext(context, matched) {
  return context && Object.keys(context).length === 3 && context.matched === matched &&
    Array.isArray(context.excluded_bits) && context.excluded_bits.length === 2 &&
    context.excluded_bits[0] === 16 && context.excluded_bits[1] === 2 &&
    context.meaning === 'POSITIVE_FUNCTIONAL_NOMINATION_CUE_NOT_FACTUAL_SUPPORT';
}

function validatePoints(candidate, native, version) {
  const parts = candidate.ranking_components, band = candidate.source_function_band;
  const tier = candidate.native_status === 'evidence_backed_suggestion' ? 2 :
    candidate.native_status === 'partial_grounding' ? (Array.isArray(native.local_decision?.requirements) &&
      native.local_decision.requirements.some(r => r.coverage === 'Established') ? 1 : 0) :
      candidate.native_status === 'exploratory_contextual' ? 0 : -1;
  if (candidate.version !== version || tier < 0 || candidate.evidence_tier !== tier ||
      candidate.gates_modified !== false || candidate.document_deduplication !== 'MAX_PER_DOCUMENT_AND_DIRECTION' ||
      candidate.fit < 0 || candidate.fit > 1 || ['support', 'oppose', 'context'].some(key => candidate[key] < 0) ||
      !band || !Number.isInteger(band.value) || band.value < 0 || band.value > 1023 ||
      band.source_key_available !== true || band.rank_or_pool_position_used !== false ||
      !parts || Object.keys(parts).length !== componentKeys.length || !componentKeys.every(key => Object.hasOwn(parts, key)) ||
      !componentKeys.slice(0, -1).every(key => number(parts[key])) ||
      parts.rank_or_pool_position_used !== false || parts.source_function_max !== 65 || parts.evidence_fit_max !== 35) {
    throw Error('The point components do not match their native scoring contract.');
  }
  const sourcePoints = version === SOURCE_POINTS_VERSION, matched = Boolean(band.value & ~18);
  if (sourcePoints && !validSourceContext(candidate.source_function_context, matched)) {
    throw Error('The v6 source nomination cue differs from its native band or non-support meaning.');
  }
  const priority = sourcePoints ? 40 * Number(matched) + 25 * band.value / 1023 : 65 * band.value / 1023;
  const utility = (candidate.support + candidate.fit + .5 * candidate.context) / (1 + candidate.oppose);
  const saturated = utility / (1 + utility);
  if (!close(parts.utility, utility) || !close(parts.saturated_utility, saturated) ||
      !close(parts.evidence_tier_points, 100 * tier) ||
      !close(parts.source_function_points, priority) ||
      !close(parts.evidence_fit_points, 35 * saturated) ||
      !close(candidate.score, parts.evidence_tier_points + parts.source_function_points + parts.evidence_fit_points)) {
    throw Error('The evidence/fit arithmetic differs from its versioned saved components.');
  }
  const card = native.terminal_scorecard;
  if (card && (['version', 'id', 'native_status', 'score', 'support', 'oppose', 'context', 'fit',
    'criteria_coverage', 'evidence_tier', 'score_units', 'calibrated_probability', 'gates_modified',
    'document_deduplication'].some(key => card[key] !== candidate[key]) ||
    card.source_function_band?.value !== band.value ||
    !card.ranking_components || componentKeys.some(key => card.ranking_components[key] !== parts[key]) ||
    sourcePoints && Object.keys(card.ranking_components).length !== componentKeys.length ||
    sourcePoints && !validSourceContext(card.source_function_context, matched))) {
    throw Error('The point components or source cue differ from the native candidate scorecard.');
  }
}

export function computeDecisionScores(record = {}) {
  const score = record.result?.terminal_scores ?? record.terminal_scores;
  if (!score) return null;
  if (![SCORE_VERSION, EVIDENCE_SCORE_VERSION, POINTS_SCORE_VERSION, SOURCE_POINTS_VERSION, 'terminal-evidence-fit/2'].includes(score.version) || score.probability !== false ||
      !Array.isArray(score.readings) || !Array.isArray(score.atoms) || !score.overall) {
    throw Error('The final scorecard is not bound to the supported scoring contract.');
  }
  if (typeof score.ranking_applied !== 'boolean' || score.judgments_unchanged !== true) {
    throw Error('The scorecard must declare its ranking and unchanged evidence judgments.');
  }
  const sameIds = (left, right) => Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && new Set(left.map(x => x.id)).size === left.length &&
    left.every((value, i) => typeof value.id === 'string' && value.id && value.id === right[i].id);
  const nativeReadings = record.result?.readings || [];
  if (!sameIds(score.readings, nativeReadings.map(r => ({id:r.reading?.id})))) {
    throw Error('The scorecard reading inventory differs from the native result.');
  }
  const nativeCandidates = new Map((record.result?.readings || []).flatMap(r =>
    (r.candidates || []).map(c => [c.id, c])));
  for (const reading of score.readings) {
    if (!Array.isArray(reading.candidates)) throw Error('Invalid candidate score list.');
    const nativeReading = nativeReadings.find(r => r.reading?.id === reading.id);
    if (!sameIds(reading.candidates, nativeReading?.candidates)) {
      throw Error('The scorecard candidate inventory or order differs from its native reading.');
    }
    for (const candidate of reading.candidates) {
      if (!nativeCandidates.has(candidate.id) ||
          !['score', 'support', 'oppose', 'context', 'fit', 'criteria_coverage'].every(k => number(candidate[k])) ||
          candidate.native_status !== nativeCandidates.get(candidate.id).local_decision?.status ||
          candidate.criteria_coverage < 0 || candidate.criteria_coverage > 1) {
        throw Error('The final scorecard differs from its candidate evidence.');
      }
      if ([EVIDENCE_SCORE_VERSION, POINTS_SCORE_VERSION, SOURCE_POINTS_VERSION].includes(score.version) &&
          (candidate.score_units !== 'EVIDENCE_FIT_POINTS_NOT_CORRECTNESS_CONFIDENCE' ||
           candidate.calibrated_probability !== false || candidate.score < 0 || candidate.score > 300 ||
           candidate.version != null && candidate.version !== score.version)) {
        throw Error('The evidence/fit points must retain their native units and non-probability contract.');
      }
      if ([POINTS_SCORE_VERSION, SOURCE_POINTS_VERSION].includes(score.version)) validatePoints(candidate, nativeCandidates.get(candidate.id), score.version);
    }
    if (score.ranking_applied && reading.candidates.some((c, i, a) => i > 0 && c.score > a[i - 1].score + 1e-12)) {
      throw Error('Candidate order differs from the final ranking score.');
    }
  }
  const nativeAtoms = new Map((record.result?.atoms || []).map(a => [a.id, a]));
  if (!sameIds(score.atoms, record.result?.atoms || [])) {
    throw Error('The scorecard fact inventory differs from the native result.');
  }
  for (const atom of score.atoms) {
    if (!nativeAtoms.has(atom.id) || atom.native_status !== nativeAtoms.get(atom.id).status ||
        !['score', 'support', 'oppose', 'context', 'criteria_coverage'].every(k => number(atom[k])) ||
        atom.criteria_coverage < 0 || atom.criteria_coverage > 1) throw Error('Invalid fact evidence score.');
    if ([POINTS_SCORE_VERSION, SOURCE_POINTS_VERSION].includes(score.version) && (atom.version !== score.version ||
        atom.calibrated_probability !== false || atom.gates_modified !== false ||
        ['support', 'oppose', 'context'].some(key => atom[key] < 0) || !close(atom.score, atom.support - atom.oppose))) {
      throw Error('The fact totals must remain signed evidence indices, not candidate points.');
    }
  }
  return score;
}

export function formatDecisionScore(value) {
  if (!number(value)) return 'Not recorded';
  const fixed = value.toFixed(4);
  return value !== 0 && (Math.abs(value) < .001 || Number(fixed) === 0) ? value.toExponential(4) : fixed;
}

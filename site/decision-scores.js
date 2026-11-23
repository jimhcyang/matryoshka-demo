/* The final arithmetic is saved by the native executor, never invented from rank. */
export const SCORE_VERSION = 'terminal-evidence-fit/3';

function number(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function computeDecisionScores(record = {}) {
  const score = record.result?.terminal_scores ?? record.terminal_scores;
  if (!score) return null;
  if (![SCORE_VERSION, 'terminal-evidence-fit/2'].includes(score.version) || score.probability !== false ||
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
  }
  return score;
}

export function formatDecisionScore(value) {
  if (!number(value)) return '—';
  return value !== 0 && Math.abs(value) < .005 ? value.toExponential(2) : value.toFixed(2);
}

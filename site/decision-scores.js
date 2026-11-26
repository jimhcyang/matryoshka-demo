/* The final arithmetic is saved by the native executor, never invented from rank. */
import {ADJUNCT_SCORE_VERSION,ADJUNCT_SCORE_VERSIONS,validateAdjunctScore,verifyAdjunctScoreBindings} from './adjunct-score-bindings.js';
export const SCORE_VERSION = 'terminal-evidence-fit/3';
export const EVIDENCE_SCORE_VERSION = 'terminal-evidence-fit/4';
export const POINTS_SCORE_VERSION = 'terminal-evidence-fit/5';
export const SOURCE_POINTS_VERSION = 'terminal-evidence-fit/6';
export const CONTEXTUAL_POINTS_VERSION = 'terminal-evidence-fit/7';

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

function sameSavedValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' ||
      Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(key => Object.hasOwn(right, key) && sameSavedValue(left[key], right[key]));
}

function validateContextualFit(candidate, native, record) {
  const fit = candidate.fit_components;
  const limits = {owned_relation: .32, owned_role: .16, source_type: .16,
    focal_terms: .16, visible_scope: .2, licensed_realized_form_fit: .16};
  if (!fit || Object.keys(fit).length !== Object.keys(limits).length ||
      candidate.mode !== 'balanced' || candidate.fill !== native.fill || !number(candidate.v6_score) || candidate.v6_score < 0 || candidate.v6_score > 300 ||
      Object.entries(limits).some(([key, max]) => !number(fit[key]) || fit[key] < 0 || fit[key] > max ||
        key !== 'focal_terms' && !close(fit[key], 0) && !close(fit[key], max)) ||
      !close(candidate.fit, Object.values(fit).reduce((sum, value) => sum + value, 0)) ||
      fit.source_type + fit.licensed_realized_form_fit > .16 ||
      !native.terminal_scorecard || !sameSavedValue(candidate, native.terminal_scorecard) ||
      !['raw_type_and_band_unchanged', 'factual_decisions_unchanged', 'citations_unchanged',
        'input_candidate_unchanged', 'support_directions_unchanged'].every(key => candidate[key] === true) ||
      candidate.contextual_arithmetic !== 'BALANCED_FOCAL_AND_SINGLE_CITATION_BACKGROUND; SEPARATE_REALIZED_FORM; RECORDED_ATOM_POSITION') {
    throw Error('The v7 soft fit differs from its native components or candidate scorecard.');
  }
  const license = candidate.realized_form_license, overlap = candidate.atom_overlap, scope = candidate.visible_scope;
  if (!license || typeof license.eligible !== 'boolean' ||
      fit.licensed_realized_form_fit !== (license.eligible && fit.source_type === 0 ? .16 : 0) ||
      !scope || scope.meaning !== 'VISIBLE_QUERY_ANCHOR_COOCCURRENCE_ONLY' ||
      !Array.isArray(scope.matches) || scope.value !== Number(scope.matches.length > 0) ||
      !close(fit.visible_scope, .2 * scope.value) || scope.matches.some(match => match.source_owned_action_certified !== false) ||
      !overlap || overlap.citation_atom_pairs_never_joined !== true || !Array.isArray(overlap.atoms)) {
    throw Error('The v7 fit audit does not retain its contextual, single-citation scope.');
  }
  const feature = native.ranking?.features || {}, focal = feature.focal_term_count > 0 ?
    Math.min(1, (feature.focal_context_coverage || 0) / feature.focal_term_count) : 0;
  const background = overlap.atoms.filter(atom => atom.contains_focal === false);
  const bestBackground = background.length ? Math.max(...background.map(atom => atom.coverage)) : focal;
  const bestAtom = overlap.atoms.length ? Math.max(...overlap.atoms.map(atom => atom.coverage)) : focal;
  const winner = background.find(atom => atom.coverage === bestBackground) || null;
  const atoms = record.plan?.atoms;
  const query = Array.from(record.case?.query || ''), marker = (record.case?.query || '').indexOf(record.case?.focal_marker);
  const markerOffset = marker < 0 ? -1 : Array.from(record.case.query.slice(0, marker)).length;
  if (!Array.isArray(atoms) || !close(overlap.focal, focal) || !close(overlap.best_background, bestBackground) ||
      !close(overlap.best_atom, bestAtom) || !close(overlap.value, .5 * focal + .5 * bestBackground) ||
      !close(fit.focal_terms, .16 * overlap.value) || !sameSavedValue(overlap.winning_atom_citation, winner) ||
      new Set(overlap.atoms.map(atom => atom.id)).size !== overlap.atoms.length ||
      overlap.atoms.some(atom => !atoms.some(saved => saved.id === atom.id &&
        Array.isArray(saved.query_spans) && saved.query_spans.every(span => Number.isInteger(span.start) && Number.isInteger(span.end) &&
          span.start >= 0 && span.start < span.end && span.end <= query.length && query.slice(span.start, span.end).join('') === span.text) &&
        atom.contains_focal === saved.query_spans.some(span => span.start <= markerOffset && markerOffset < span.end)) ||
        typeof atom.contains_focal !== 'boolean' || !Number.isInteger(atom.term_count) || atom.term_count < 1 ||
        !number(atom.coverage) || atom.coverage < 0 || atom.coverage > 1 || !Array.isArray(atom.matched_terms) ||
        !atom.matched_terms.every(term => typeof term === 'string' && term) ||
        new Set(atom.matched_terms).size !== atom.matched_terms.length ||
        !close(atom.coverage, atom.matched_terms.length / atom.term_count) ||
        (atom.citation == null ? atom.coverage !== 0 : !native.sources?.some(ref => sameSavedValue(ref, atom.citation) &&
          native.source_occurrences?.some(occurrence => sameSavedValue(occurrence.citation, ref) &&
            sameSavedValue(occurrence.source_span, native.source_span) && occurrence.source_wording === native.source_wording))))) {
    throw Error('The v7 focal/background fit differs from its recorded atom/citation arithmetic.');
  }
  if (license.eligible || license.audit_sha256 != null) {
    const audit = native.lexical_realization, quote = audit?.original_quote, span = native.source_span;
    if (audit?.state !== 'licensed' || audit.context_only !== true || audit.factual_support_certified !== false ||
        audit.same_owner_or_event_certified !== false || audit.source_wording_modified !== false ||
        audit.used_as_retrieval_seed !== false || audit.source_nominated_before_realization !== true ||
        audit.verbatim_source_fill !== false || audit.lexical_resource_does_not_certify_ner !== true ||
        audit.source_identity !== native.source_wording || audit.proposed_insertion !== native.fill ||
        !sameSavedValue(audit.source_span, span) || !sameSavedValue(audit.transformations, native.insertion_edits) ||
        !Array.isArray(span) || span.length !== 2 || !span.every(Number.isInteger) ||
        !quote || !Number.isInteger(quote.start) || !Number.isInteger(quote.end) ||
        quote.start < 0 || quote.start > span[0] || span[0] >= span[1] || span[1] > quote.end ||
        typeof quote.text !== 'string' || Array.from(quote.text).length !== quote.end - quote.start ||
        Array.from(quote.text).slice(span[0] - quote.start, span[1] - quote.start).join('') !== native.source_wording ||
        !/^[a-f0-9]{64}$/.test(quote.page_sha256 || '') || !quote.document_id || !quote.canonical_page_id ||
        !Array.isArray(native.sources) || !native.sources.some(ref => sameSavedValue(ref, quote)) ||
        !Array.isArray(audit.lexical_lookup?.forms) || !audit.lexical_lookup.forms.some(form => sameSavedValue(form, audit.selected_form)) ||
        !Array.isArray(audit.selected_form?.derivations) || !audit.selected_form.derivations.length ||
        !/^[a-f0-9]{64}$/.test(license.audit_sha256 || '') || license.source_identity !== native.source_wording ||
        !sameSavedValue(license.source_quote, quote) || license.actual_wordnet_replayed !== true ||
        !sameSavedValue(license.resource, audit.resource) || license.resource?.availability !== 'AVAILABLE' ||
        !native.source_occurrences?.some(occurrence => sameSavedValue(occurrence.citation, quote) &&
          sameSavedValue(occurrence.lexical_realization, audit) && sameSavedValue(occurrence.source_span, span) &&
          occurrence.source_wording === native.source_wording) ||
        license.eligible !== (['final_form_fit', 'completed_head_kind_fit', 'joint_slot_fit'].every(key => native[key]?.state === 'pass') &&
          native.final_form_fit?.head?.pos === 'ADJ' && native.final_form_fit.head.text === native.fill && native.final_form_fit.outer_family === 'adjectival' &&
          native.ranking?.features?.effective_target_kind === 'property')) {
      throw Error('The v7 realized-form fit lacks its unchanged licensed source and actual gate receipts.');
    }
  } else if (license.reason !== 'NO_LICENSED_SOURCE_AUDIT' || native.lexical_realization?.state === 'licensed') {
    throw Error('The v7 realized-form audit is missing its native license.');
  }
  if (!Array.isArray(candidate.citation_local_fits) || candidate.citation_local_fits.some(row => {
    const local = row.components, ownLicense = license.eligible && sameSavedValue(row.citation, license.source_quote);
    if (!native.sources?.some(ref => sameSavedValue(ref, row.citation)) || !local) return true;
    if (row.reason === 'NO_OWN_SOURCE_OCCURRENCE_CITATION') return row.fit !== 0 || Object.keys(local).length !== 0 || row.licensed_quote !== false;
    const overlap = row.atom_overlap, background = overlap?.atoms?.filter(atom => atom.contains_focal === false);
    const best = background?.length ? Math.max(...background.map(atom => atom.coverage)) : overlap?.focal;
    return row.reason !== 'OWN_SOURCE_OCCURRENCE' || row.licensed_quote !== ownLicense ||
      !native.source_occurrences?.some(occurrence => sameSavedValue(occurrence.citation, row.citation)) ||
      Object.keys(local).length !== Object.keys(limits).length ||
      Object.entries(limits).some(([key, max]) => !number(local[key]) || local[key] < 0 || local[key] > max) ||
      local.source_type + local.licensed_realized_form_fit > .16 ||
      local.licensed_realized_form_fit !== (ownLicense && local.source_type === 0 ? .16 : 0) ||
      !overlap || overlap.citation_atom_pairs_never_joined !== true || !Array.isArray(overlap.atoms) ||
      !close(overlap.value, .5 * overlap.focal + .5 * best) || !close(local.focal_terms, .16 * overlap.value) ||
      overlap.atoms.some(atom => atom.citation != null && !sameSavedValue(atom.citation, row.citation)) ||
      !row.visible_scope || !Array.isArray(row.visible_scope.matches) ||
      row.visible_scope.value !== Number(row.visible_scope.matches.length > 0) ||
      !close(local.visible_scope, .2 * row.visible_scope.value) ||
      !close(row.fit, Object.values(local).reduce((sum, value) => sum + value, 0));
  })) throw Error('The v7 per-citation fit borrows another source quote\'s realized-form credit.');
  const key = native.context_rank_key, band = candidate.source_function_band;
  if (!Array.isArray(key) || key.length !== 20 || key.slice(0, 9).some(flag => typeof flag !== 'boolean') ||
      band.value !== key.slice(0, 9).reduce((sum, flag, i) => sum + (flag ? 0 : 2 ** (8 - i)),
        band.declared_visible_attachment === true ? 512 : 0)) {
    throw Error('The v7 source band differs from the unchanged native source key.');
  }
  if (!Array.isArray(candidate.recorded_rank_proof) || candidate.recorded_rank_proof.some(proof =>
    !Number.isInteger(proof.recorded_position) || proof.recorded_position < 1 ||
    !Array.isArray(proof.atom_ids) || !proof.atom_ids.length || !proof.atom_ids.every(id => atoms.some(atom => atom.id === id)) ||
    !candidate.contributions?.some(row => row.citation?.canonical_page_id === proof.page_id && Number.isInteger(row.page_rank) && row.page_rank <= proof.recorded_position))) {
    throw Error('The v7 source weight lacks its recorded atom-search position.');
  }
  validateDocumentContributions(candidate);
}

function validateDocumentContributions(item) {
  const seen = new Set(), sums = {support: 0, oppose: 0, context: 0};
  if (!Array.isArray(item.contributions)) throw Error('The v7 document contributions are missing.');
  for (const row of item.contributions) {
    const key = JSON.stringify([row.direction, row.document_id]), rank = row.page_rank;
    const weight = rank == null ? .5 : .5 + .5 / (1 + Math.log2(rank));
    if (!Object.hasOwn(sums, row.direction) || !row.document_id || seen.has(key) ||
        row.citation?.document_id !== row.document_id || !number(row.fit) || row.fit < 0 || row.fit > 1 ||
        rank !== null && (!Number.isInteger(rank) || rank < 1 || rank >= 1e10) ||
        !close(row.retrieval_weight, weight) || !close(row.contribution, weight * row.fit)) {
      throw Error('The v7 evidence totals differ from their document-deduplicated source weights.');
    }
    seen.add(key); sums[row.direction] += row.contribution;
  }
  if (Object.keys(sums).some(key => !close(sums[key], item[key]))) throw Error('The v7 document contribution sums differ from their evidence totals.');
}

function validatePoints(candidate, native, version, record) {
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
  const sourcePoints = [SOURCE_POINTS_VERSION, CONTEXTUAL_POINTS_VERSION].includes(version), matched = Boolean(band.value & ~18);
  if (sourcePoints && !validSourceContext(candidate.source_function_context, matched)) {
    throw Error('The source nomination cue differs from its native band or non-support meaning.');
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
  if (version === CONTEXTUAL_POINTS_VERSION) validateContextualFit(candidate, native, record);
}

export function computeDecisionScores(record = {}) {
  const score = record.result?.terminal_scores ?? record.terminal_scores;
  if (!score) return null;
  if (![SCORE_VERSION, EVIDENCE_SCORE_VERSION, POINTS_SCORE_VERSION, SOURCE_POINTS_VERSION, CONTEXTUAL_POINTS_VERSION, 'terminal-evidence-fit/2'].includes(score.version) || score.probability !== false ||
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
      if(ADJUNCT_SCORE_VERSIONS.includes(candidate.version)){
        if(reading.candidates.some(c=>c.version!==candidate.version))throw Error('Different candidate score scales share one reading.');
        validateAdjunctScore(candidate,nativeCandidates.get(candidate.id));
        continue;
      }
      if ([EVIDENCE_SCORE_VERSION, POINTS_SCORE_VERSION, SOURCE_POINTS_VERSION, CONTEXTUAL_POINTS_VERSION].includes(score.version) &&
          (candidate.score_units !== 'EVIDENCE_FIT_POINTS_NOT_CORRECTNESS_CONFIDENCE' ||
           candidate.calibrated_probability !== false || candidate.score < 0 || candidate.score > 300 ||
           candidate.version != null && candidate.version !== score.version)) {
        throw Error('The evidence/fit points must retain their native units and non-probability contract.');
      }
      if ([POINTS_SCORE_VERSION, SOURCE_POINTS_VERSION, CONTEXTUAL_POINTS_VERSION].includes(score.version)) validatePoints(candidate, nativeCandidates.get(candidate.id), score.version, record);
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
    if ([POINTS_SCORE_VERSION, SOURCE_POINTS_VERSION, CONTEXTUAL_POINTS_VERSION].includes(score.version) && (atom.version !== score.version ||
        atom.calibrated_probability !== false || atom.gates_modified !== false ||
        ['support', 'oppose', 'context'].some(key => atom[key] < 0) || !close(atom.score, atom.support - atom.oppose))) {
      throw Error('The fact totals must remain signed evidence indices, not candidate points.');
    }
  }
  return score;
}

export async function verifyContextualScoreBindings(record, caseInfo, digest) {
  const score = record?.result?.terminal_scores ?? record?.terminal_scores;
  if (score?.version !== CONTEXTUAL_POINTS_VERSION) return;
  computeDecisionScores(record);
  if (typeof digest !== 'function' || typeof caseInfo?.query !== 'string' ||
      record.case?.query !== caseInfo.query || record.case?.focal_marker !== caseInfo.focal_marker ||
      await digest(caseInfo.query) !== record.plan?.query_sha256) {
    throw Error('The v7 scorecard belongs to another public input or plan.');
  }
  const query = Array.from(caseInfo.query);
  for (const reading of record.result.readings || []) for (const native of reading.candidates) {
    if(ADJUNCT_SCORE_VERSIONS.includes(native.terminal_scorecard?.version)){
      await verifyAdjunctScoreBindings(native,record,caseInfo,digest);
      continue;
    }
    const card = native.terminal_scorecard, license = card.realized_form_license;
    if (license.audit_sha256 != null && await digest(native.lexical_realization) !== license.audit_sha256) {
      throw Error('The v7 licensed-form audit hash differs from its native source receipt.');
    }
    const scopes = [card.visible_scope, ...card.citation_local_fits.map(row => row.visible_scope).filter(Boolean)];
    for (const match of scopes.flatMap(scope => scope.matches).filter(match => match.exact_source_norp_identity === true)) {
      const audit = native.lexical_realization, entity = record.plan.extractions?.entities?.find(entity => entity.local_id === match.query_entity);
      if (!license.eligible || match.original_type_not_rewritten !== true || !['Other', 'group'].includes(match.original_model_type) ||
          match.type_contract !== 'literal-visible-source-class-anchor/2' || match.relevance_only !== true ||
          match.identity_or_event_certified !== false || match.factual_support_certified !== false ||
          entity?.type !== match.original_model_type || entity.contains_unknown_slot !== false || entity.label !== license.source_identity ||
          match.label !== license.source_identity || match.text !== license.source_identity ||
          match.canonical_page_id !== license.source_quote.canonical_page_id ||
          !sameSavedValue([match.start, match.end], audit.source_span) ||
          !audit.source_class_observation?.norp_observations?.some(item => item.label === 'NORP' &&
            item.text === license.source_identity && sameSavedValue([item.start, item.end], audit.source_span)) ||
          !Array.isArray(match.query_spans) || !match.query_spans.length || match.query_spans.some(span =>
            !entity.query_spans?.some(saved => sameSavedValue(saved, span)) || !Number.isInteger(span.start) ||
            !Number.isInteger(span.end) || span.start < 0 || span.start >= span.end || span.end > query.length ||
            query.slice(span.start, span.end).join('') !== span.text ||
            !new RegExp('(?<![\\p{L}\\p{N}_])'+license.source_identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')+'(?![\\p{L}\\p{N}_])', 'u').test(span.text))) {
        throw Error('The v7 visible Other entity lacks its exact literal input and source NORP identity.');
      }
    }
  }
}

export function formatDecisionScore(value) {
  if (!number(value)) return 'Not recorded';
  const fixed = value.toFixed(4);
  return value !== 0 && (Math.abs(value) < .001 || Number(fixed) === 0) ? value.toExponential(4) : fixed;
}

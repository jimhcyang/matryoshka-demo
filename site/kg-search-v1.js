// Navigation over the selected graph's own records, never an identity or fact gate.
export const KG_SEARCH_VERSION = 'bound-graph-local-search/1';
export const RELATED_METHOD = 'Observed-form anchor when present, shared content words, conservative stems and character-prefix similarity; local and deterministic, not fact verification.';

export function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function observedForms(record) {
  const forms = new Set();
  const add = value => {
    if (typeof value === 'string' && value.trim()) forms.add(value.trim());
    else if (Array.isArray(value)) value.forEach(add);
    else if (value && typeof value === 'object') {
      if (/dictionary|historical|external/i.test(String(value.origin || value.source_kind || ''))) return;
      for (const key of ['text', 'form', 'surface', 'surface_form']) if (typeof value[key] === 'string') add(value[key]);
    }
  };
  for (const source of [record, record.payload, record.alias_payload]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    if (source !== record && source.node_id && source.node_id !== record.id) continue;
    if (/dictionary|historical|external/i.test(String(source.origin || source.source_kind || ''))) continue;
    for (const key of ['aliases', 'surface_forms', 'surface_form']) add(source[key]);
  }
  return [...forms];
}

export function searchFields(record) {
  const forms = observedForms(record);
  const surfaces = [record.id, record.label, record.canonical_label, record.search_context, ...forms]
    .map(normalizeSearchText).filter(Boolean);
  return {
    _surfaces: [...new Set(surfaces)],
    _search: normalizeSearchText([record.label, record.canonical_label, record.search_context,
      ...forms, record.summary, record.type].filter(Boolean).join(' ')),
    _observedForms: forms,
  };
}

export function exactMatchNotice(record, query) {
  const normalized = normalizeSearchText(query);
  const form = (record._observedForms || observedForms(record)).find(value => normalizeSearchText(value) === normalized);
  return form && normalizeSearchText(record.label) !== normalized ? `Observed form: ${form}` : '';
}

export function additionalObservedFields(record, boundNode) {
  if (record.id !== boundNode.id) throw Error('Observed forms require the exact bound node ID.');
  const known = record._observedForms || observedForms(record), added = observedForms(boundNode);
  const forms = [...new Set([...known, ...added])];
  return forms.length === known.length ? null : searchFields({...record, aliases: forms});
}

// Closed-class words only. Negation and uncertainty words are deliberately retained.
const STOP = new Set('a an the is are was were be been being am of to in on at for with and or as by from this that these those it its'.split(' '));
function stem(word) {
  if (word.length < 6) return word;
  return word.replace(/(?:ness|ing|ies|ed|es|s)$/, ending => ending === 'ies' ? 'y' : '');
}
function words(text) {
  return [...new Set(normalizeSearchText(text).split(' ').filter(word => word && !STOP.has(word)))];
}
function documentWords(record) {
  return words([record.label, record.canonical_label, record.search_context,
    ...(record._observedForms || observedForms(record)), record.summary].filter(Boolean).join(' '));
}
function hash(value) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}
function signature(word) {
  return [stem(word), word.length >= 4 ? word.slice(0, 4) : word];
}
function characterSimilarity(left, right) {
  if (left.length < 4 || right.length < 4 || left.slice(0, 4) !== right.slice(0, 4)) return 0;
  const grams = value => new Set(Array.from({length: value.length - 2}, (_, i) => value.slice(i, i + 3)));
  const a = grams(left), b = grams(right);
  const shared = [...a].filter(value => b.has(value)).length;
  return 2 * shared / (a.size + b.size);
}

export async function createRelatedIndex(records, {yieldControl = () => new Promise(resolve => setTimeout(resolve, 0))} = {}) {
  // 32 bytes per record, no vocabulary/dictionary, embeddings, or extra graph fetches.
  const bits = new Uint32Array(records.length * 8);
  for (let i = 0; i < records.length; i++) {
    for (const word of documentWords(records[i])) for (const token of signature(word)) {
      const value = hash(token) & 255;
      bits[i * 8 + (value >>> 5)] |= 1 << (value & 31);
    }
    if (i && i % 4096 === 0) await yieldControl();
  }
  return {
    version: KG_SEARCH_VERSION, indexBytes: bits.byteLength, recordCount: records.length,
    search(query, {limit = 8, accept = () => true, anchorAccept = accept} = {}) {
      const terms = words(query);
      if (!terms.length || limit <= 0) return [];
      if (terms.length > 64) throw Error('Related search accepts at most 64 content words; use exact search for longer text.');
      // Keep a rare predicate from replacing an observed query subject with another actor.
      const phrase = ` ${normalizeSearchText(query)} `;
      let anchor = '', anchorPosition = Infinity;
      for (const record of records) {
        if (record.type !== 'Entity' || !anchorAccept(record)) continue;
        for (const form of record._surfaces || searchFields(record)._surfaces) {
          if (!words(form).length) continue;
          const position = phrase.indexOf(` ${form} `);
          if (position >= 0 && (position < anchorPosition || position === anchorPosition && form.length > anchor.length)) {
            anchor = form; anchorPosition = position;
          }
        }
      }
      const anchorTerms = words(anchor).map(stem);
      const probes = terms.flatMap(signature).map(token => hash(token) & 255);
      const candidates = [], frequencies = new Uint32Array(terms.length);
      for (let i = 0; i < records.length; i++) {
        if (!probes.some(value => bits[i * 8 + (value >>> 5)] & (1 << (value & 31)))) continue;
        const record = records[i];
        if (!accept(record)) continue;
        const tokens = documentWords(record), roots = new Set(tokens.map(stem));
        if (!anchorTerms.every(term => roots.has(term))) continue;
        const matches = terms.map(term => roots.has(stem(term)) ? 1 :
          Math.max(0, ...tokens.map(token => characterSimilarity(term, token))) * .5);
        if (!matches.some(Boolean)) continue;
        matches.forEach((value, index) => { if (value) frequencies[index]++; });
        candidates.push({record, matches, length: tokens.length});
      }
      const top = [];
      for (const {record, matches, length} of candidates) {
        const matched = terms.filter((_, i) => matches[i]), unmatched = terms.filter((_, i) => !matches[i]);
        const coverage = matched.length / terms.length;
        const score = matches.reduce((sum, value, i) => sum + value * Math.log(1 + records.length / (1 + frequencies[i])), 0)
          * coverage / Math.sqrt(1 + length / 12);
        const hit = {record, score, matched, unmatched, anchor, kind: 'related', method: RELATED_METHOD};
        const position = top.findIndex(old => score > old.score || score === old.score && record.id < old.record.id);
        top.splice(position < 0 ? top.length : position, 0, hit);
        if (top.length > limit) top.pop();
      }
      return top;
    },
  };
}

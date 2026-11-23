/* Inclusive display dates become the engine's unchanged exclusive boundary. */
export function dayAfter(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw Error('Choose a valid evidence date.');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw Error('Choose a valid evidence date.');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function validateCorpusScopes(value) {
  if (value?.version !== 'matryoshka-live-corpus-scopes/1' ||
      !/^[a-f0-9]{64}$/.test(value.execution_refs_sha256 || '') ||
      Object.keys(value.corpora || {}).sort().join(',') !== 'cib,iran,vietnam') {
    throw Error('Corpus date ranges are unavailable.');
  }
  for (const bounds of Object.values(value.corpora)) {
    if (dayAfter(bounds.last_date) !== bounds.default_before ||
        !bounds.first_date || bounds.first_date > bounds.last_date ||
        !/^[a-f0-9]{64}$/.test(bounds.index_sha256 || '') ||
        !/^[a-f0-9]{64}$/.test(bounds.source_binding_sha256 || '')) throw Error('Corpus date range failed validation.');
    dayAfter(bounds.first_date);
  }
  return value;
}

export async function loadCorpusScopes() {
  const meta = document.querySelector('meta[name="live-corpus-scopes"]');
  if (!meta || !/^[a-f0-9]{64}$/.test(meta.dataset.contentSha256 || '')) throw Error('No verified corpus date ranges.');
  const url = new URL(meta.content, document.baseURI);
  if (url.origin !== location.origin || url.search || url.hash || !url.pathname.endsWith('/data/live-corpus-scopes.json')) {
    throw Error('Invalid corpus date metadata URL.');
  }
  const response = await fetch(url, {credentials: 'omit', redirect: 'error'});
  if (!response.ok) throw Error('Corpus date ranges are unavailable.');
  const raw = await response.arrayBuffer();
  if (raw.byteLength > 16384) throw Error('Invalid corpus date metadata size.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (hash !== meta.dataset.contentSha256) throw Error('Corpus date metadata changed.');
  return validateCorpusScopes(JSON.parse(new TextDecoder().decode(raw)));
}

export function requestScope(through, excludedDocument) {
  return {as_of: through ? dayAfter(through) : '', excluded_origin: excludedDocument.trim()};
}

export function displayedScope(request, metadata = {}) {
  // The verified canonical request is authoritative, not auxiliary captions.
  dayAfter(request.as_of);
  const date = new Date(request.as_of + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - 1);
  const through = date.toISOString().slice(0, 10);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(request.excluded_origin || '')) throw Error('Invalid canonical document scope.');
  const prefix = 'live-analyst-origin:';
  const analyst = request.excluded_origin.startsWith(prefix);
  if (analyst && !/^live-analyst-origin:[a-f0-9]{32}$/.test(request.excluded_origin)) throw Error('Invalid internal analyst identity.');
  const excludedDocument = analyst ? null : request.excluded_origin;
  const kind = analyst ? 'analyst_authored' : 'document_exclusion';
  if (metadata.evidence_through !== undefined && metadata.evidence_through !== through ||
      metadata.document_exclusion !== undefined && metadata.document_exclusion !== excludedDocument ||
      metadata.origin_kind !== undefined && metadata.origin_kind !== kind) {
    throw Error('The source-scope caption disagrees with the verified request.');
  }
  return {through, excludedDocument};
}

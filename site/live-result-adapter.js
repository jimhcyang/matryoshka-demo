/* Live never installs an /api/ replay hook and never persists a capability. */
const RUN = /^live_[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ?
  Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
const same = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const fail = message => { throw new Error(message); };

function backendURL(input) {
  const url = new URL(input, location.href);
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/live-api/') ||
      !['https:', 'http:'].includes(url.protocol) ||
      url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    fail('Use an explicit HTTPS backend or loopback companion ending in /live-api/.');
  }
  return url;
}

export class LiveClient {
  #backend;
  #capability;
  constructor({backend, capability}) {
    this.#backend = backendURL(backend);
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(capability || '') || capability.startsWith('sk-')) fail('A session capability is required, not a model API key.');
    this.#capability = capability;
  }
  disconnect() { this.#capability = ''; }
  request(path, {method = 'GET', body, signal} = {}) {
    if (!this.#capability) return Promise.reject(new Error('The Live session is disconnected.'));
    if (!/^(health|jobs(?:\/[a-f0-9]{32}(?:\/(result|cancel|retry))?)?)$/.test(path)) {
      return Promise.reject(new Error('Invalid Live endpoint.'));
    }
    const url = new URL(path, this.#backend);
    // public-runtime.js replaces ALL fetch calls, including /live-api/. XHR
    // is deliberately scoped here, not a global transport/replay replacement.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url.href);
      xhr.timeout = 15000;
      xhr.withCredentials = false;
      xhr.setRequestHeader('Authorization', `Bearer ${this.#capability}`);
      xhr.setRequestHeader('X-Live-Request', '1');
      if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
      const abort = () => xhr.abort();
      const cleanup = () => signal?.removeEventListener('abort', abort);
      xhr.onload = () => {
        cleanup();
        try {
          if (xhr.responseText.length > 24 * 1024 * 1024) fail('Live result exceeded its size limit.');
          const value = JSON.parse(xhr.responseText);
          if (xhr.status < 200 || xhr.status >= 300) {
            const code = /^[A-Z0-9_]{1,80}$/.test(value.error || '') ? value.error : 'REQUEST_REJECTED';
            fail(`Live request unavailable (${code}). No saved replay was substituted.`);
          }
          resolve(value);
        } catch (error) { reject(error instanceof SyntaxError ? new Error('The backend did not return Live JSON.') : error); }
      };
      xhr.onerror = xhr.ontimeout = () => { cleanup(); reject(new Error('Live backend unreachable. Check its exact CORS origin, CSP and browser private-network policy.')); };
      xhr.onabort = () => { cleanup(); reject(new DOMException('Live request cancelled', 'AbortError')); };
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) { cleanup(); reject(new DOMException('Live request cancelled', 'AbortError')); return; }
      xhr.send(body === undefined ? null : JSON.stringify(body));
    });
  }
  health() { return this.request('health'); }
  submit(request) { return this.request('jobs', {method: 'POST', body: request}); }
  status(id) { return this.request(`jobs/${id}`); }
  cancel(id) { return this.request(`jobs/${id}/cancel`, {method: 'POST', body: {}}); }
  retry(id) { return this.request(`jobs/${id}/retry`, {method: 'POST', body: {}}); }
  async result(id) {
    const envelope = await this.request(`jobs/${id}/result`);
    await verifyEnvelope(envelope, `live_${id}`);
    return envelope;
  }
}

async function textDigest(text) {
  // Source hashes use Python's canonical JSON string, not bare UTF-8 text.
  const canonical = JSON.stringify(text).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function verifyEnvelope(value, expectedRun) {
  if (!value || value.version !== 'matryoshka-live-result/1' || !RUN.test(value.run_id) ||
      expectedRun && value.run_id !== expectedRun || !['live', 'fixture'].includes(value.execution_kind)) {
    fail('The Live result identity or version does not match this run.');
  }
  const {request: q, native, condition, trace, sources, document_pages: documentPages = {}, receipt, source_scope: scope} = value;
  if (!q || !['mosaic', 'hypothesis', 'redaction'].includes(q.task) || !['cib', 'iran', 'vietnam'].includes(q.corpus) ||
      typeof q.query !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(q.as_of || '') || !q.excluded_origin ||
      !native?.result || !condition?.result || !trace || !Array.isArray(trace.paths) || !Array.isArray(trace.steps) ||
      !Array.isArray(value.selected_evidence) || !sources || !receipt ||
      scope?.corpus !== q.corpus || scope.strict_before !== q.as_of || scope.excluded_whole_origin !== q.excluded_origin) {
    fail('The Live result is missing its exact task, source scope or decision artifacts.');
  }
  const c = native.public_case;
  if (!c || c.query !== q.query || c.corpus !== q.corpus || c.task !== q.task || c.date !== q.as_of ||
      c.document_id !== q.excluded_origin || c.focal_marker !== q.focal_marker || !same(c, condition.case)) {
    fail('The native output and display case disagree.');
  }
  if (value.execution_kind === 'fixture') {
    if (native.fixture_only !== true || receipt.fixture_only !== true || native.result.status !== 'FIXTURE_ONLY' ||
        trace.paths.length || value.selected_evidence.length || Object.keys(sources).length || Object.keys(documentPages).length) fail('Invalid fixture result.');
    return value;
  }
  if (native.query_only_inference !== true || native.grades_read !== false || native.answers_read !== false ||
      !HASH.test(native.native_checksum || '') || native.native_checksum !== condition.native_checksum ||
      trace.native_decisions_or_ranks_modified !== false || !same(value.selected_evidence, trace.evidence_inventory) ||
      receipt.no_answer_or_grade_inputs !== true || receipt.no_chain_of_thought !== true ||
      !same(native.binding, condition.index_ref) || !condition.resource_binding ||
      condition.resource_binding.index_sha256 !== native.binding.sha256 ||
      condition.resource_binding.corpus !== q.corpus ||
      scope.supplied_pages_scope !== 'INSPECTED_REFERENCED_PAGES_ONLY' || scope.full_documents_supplied !== false) {
    fail('The Live output lacks its native decision and resource bindings.');
  }
  const expectedResult = structuredClone(native.result);
  expectedResult.task = q.task;
  expectedResult.retrieval = native.retrieval;
  delete expectedResult._candidate_audit;
  const displayResult = structuredClone(condition.result);
  delete displayResult.flow_targets;
  if (!same(expectedResult, displayResult)) fail('The display result changes native decisions or candidate order.');
  if (q.task === 'redaction') {
    for (const reading of native.result.readings || []) for (const candidate of reading.candidates || []) {
      if (!same(condition.local_decisions_v65?.candidates?.[candidate.id], candidate.local_decision)) {
        fail('A display candidate decision differs from its native decision.');
      }
    }
  }
  const inspected = new Set(native.result.inspected_page_ids || []);
  const handlingVeto = page => q.corpus !== 'cib' && /\bNOFORN\b|\bNO\s+FOREIGN\s+DISSEM(?:INATION)?\b/i.test(
    [page.text, ...(page.handling || [])].join(' '));
  for (const [id, page] of Object.entries(sources)) {
    if (page.id !== id || page.corpus !== q.corpus || page.permitted !== true ||
        !['earlier', 'both'].includes(page.visibility) || !(page.date < q.as_of) ||
        page.document_id === q.excluded_origin || !inspected.has(id) || typeof page.text !== 'string' ||
        q.corpus !== 'cib' && page.classification !== 'CONFIDENTIAL' || handlingVeto(page) ||
        await textDigest(page.text) !== page.source_sha256) fail('A selected source failed scope or hash verification.');
  }
  const referencedDocuments = new Set(Object.values(sources).map(page => page.document_id));
  let documentPageCount = 0;
  for (const [documentId, pages] of Object.entries(documentPages)) {
    if (!referencedDocuments.has(documentId) || !Array.isArray(pages) || !pages.length ||
        new Set(pages.map(page => page.id)).size !== pages.length) fail('Invalid document provenance inventory.');
    for (const page of pages) {
      if (++documentPageCount > 1024 || page.document_id !== documentId || page.corpus !== q.corpus ||
          page.permitted !== true || !['earlier', 'both'].includes(page.visibility) || !(page.date < q.as_of) ||
          documentId === q.excluded_origin || page.provenance_only !== true || page.inspection_not_implied !== true ||
          typeof page.text !== 'string' || q.corpus !== 'cib' && page.classification !== 'CONFIDENTIAL' || handlingVeto(page) ||
          await textDigest(page.text) !== page.source_sha256) fail('A document provenance page failed admission or hash verification.');
      const selected = sources[page.id];
      if (selected && ['document_id', 'corpus', 'date', 'text', 'source_sha256', 'permitted', 'visibility', 'classification'].some(key => page[key] !== selected[key])) {
        fail('Document provenance conflicts with a selected source page.');
      }
    }
  }
  // Provenance-only pages are intentionally NOT added to sources, inspected,
  // citation replay, the trace, candidate decisions or accepted evidence.
  const replay = ref => {
    const page = sources[ref?.canonical_page_id];
    if (!page || ref.document_id !== page.document_id || ref.date !== page.date ||
        ref.page_sha256 !== page.source_sha256 || !Number.isInteger(ref.start) || !Number.isInteger(ref.end) ||
        ref.start < 0 || ref.end <= ref.start || ref.end > Array.from(page.text).length ||
        Array.from(page.text).slice(ref.start, ref.end).join('') !== ref.text ||
        /\[\[REDACTION_SLOT:|\[(?:REDACTION(?:[ _]\d+)?|REDACTED|STILL REDACTED|MASKED|MASK)\]/i.test(ref.text)) {
      fail('A Live citation does not replay against its selected source.');
    }
  };
  const refFields = ['canonical_page_id', 'document_id', 'date', 'start', 'end', 'text', 'page_sha256'];
  const refSame = (a, b) => refFields.every(key => a?.[key] === b?.[key]);
  const rowRefs = row => [...(row?.citation ? [row.citation] : []), ...(row?.citations || []), ...(row?.canonical_page_id ? [row] : [])];
  const directions = {SUPPORT: 'SUPPORT', COUNTER: 'COUNTER', COUNTEREVIDENCE: 'COUNTER', OPPOSED: 'COUNTER', PARTIAL: 'PARTIAL', CONFLICTED: 'CONFLICTED'};
  const uniqueRefs = refs => [...new Map(refs.map(ref => [JSON.stringify(refFields.map(key => ref[key])), ref])).values()];
  const refsEqual = (a, b) => a.length === b.length && uniqueRefs(a).length === a.length &&
    uniqueRefs(b).length === b.length && a.every(ref => b.some(other => refSame(ref, other)));
  // Mirror native decision_items, not arbitrary recursive JSON pointers. An
  // evidence row belongs to exactly one atom or reading/candidate and purpose.
  const units = new Map();
  const addUnit = unit => {
    if (!unit.id || units.has(unit.id)) fail('Duplicate native evidence-unit identity.');
    unit.finalRefs = uniqueRefs([...unit.finalRows.values()].filter(row => directions[String(row.direction).toUpperCase()]).flatMap(rowRefs));
    units.set(unit.id, unit);
  };
  if (q.task === 'redaction') {
    const readingIds = new Set();
    for (const [i, branch] of (native.result.readings || []).entries()) {
      const readingId = branch.reading_id || branch.reading?.id;
      const candidates = branch.candidates || [];
      if (!readingId || readingIds.has(readingId) || candidates.length > 5 ||
          candidates.some((candidate, j) => !Number.isInteger(candidate.rank) || candidate.rank < 1 || candidate.rank > 5 ||
            j > 0 && candidate.rank <= candidates[j - 1].rank)) fail('Native reading or candidate order changed.');
      readingIds.add(readingId);
      for (const [j, candidate] of candidates.entries()) {
        const base = `/result/readings/${i}/candidates/${j}`;
        const finalRows = new Map(), contextRows = new Map();
        for (const [k, requirement] of (candidate.local_decision?.requirements || []).entries()) {
          for (const [n, row] of (requirement.evidence || []).entries()) finalRows.set(`${base}/local_decision/requirements/${k}/evidence/${n}`, row);
        }
        for (const [k, row] of (candidate.evidence || []).entries()) {
          if (directions[String(row.direction).toUpperCase()]) finalRows.set(`${base}/evidence/${k}`, row);
        }
        for (const name of ['sources', 'evidence', 'exploratory_passages']) {
          for (const [k, row] of (candidate[name] || []).entries()) contextRows.set(`${base}/${name}/${k}`, row);
        }
        addUnit({id: `${readingId}/${candidate.id}`, queryAtomId: null, candidateId: candidate.id, readingId,
          status: candidate.local_decision?.status || 'UNRECORDED', finalRows, contextRows});
      }
    }
  } else {
    for (const [i, atom] of (native.result.atoms || []).entries()) {
      const finalRows = new Map();
      for (const name of Object.hasOwn(atom, 'evidence') ? ['evidence'] : ['positive_evidence', 'counterevidence', 'partial_evidence']) {
        for (const [j, row] of (atom[name] || []).entries()) finalRows.set(`/result/atoms/${i}/${name}/${j}`, row);
      }
      addUnit({id: atom.id, queryAtomId: atom.id, candidateId: null, readingId: null, status: atom.status,
        finalRows, contextRows: new Map()});
    }
  }
  for (const item of value.selected_evidence) {
    const unit = units.get(item.item_id);
    const final = item.purpose === 'FINAL_DECISION_EVIDENCE';
    const contextual = item.purpose === 'CANDIDATE_ORIGINAL_CONTEXT_NOT_ASSERTED_SUPPORT';
    if (!unit || item.query_atom_id !== unit.queryAtomId || (!final && !contextual) ||
        contextual && (item.direction !== 'CONTEXT' || item.source_refs?.length !== 1)) {
      fail('A Live evidence item changes its native unit or evidence purpose.');
    }
    for (const ref of item.source_refs || []) replay(ref);
    if (!Array.isArray(item.recorded_locations) || !item.recorded_locations.length || !item.source_refs?.length) {
      fail('A Live evidence item lacks its native recorded location.');
    }
    for (const pointer of item.recorded_locations) {
      const raw = (final ? unit.finalRows : unit.contextRows).get(pointer);
      const refs = uniqueRefs(rowRefs(raw));
      if (!raw || !item.source_refs.every(ref => refs.some(original => refSame(ref, original))) ||
          final && (directions[String(raw.direction).toUpperCase()] !== item.direction || !refsEqual(item.source_refs, refs)) ||
          contextual && item.source_refs.some(ref => unit.finalRefs.some(original => refSame(ref, original)))) {
        fail('A Live evidence item differs from its native recorded match.');
      }
    }
  }
  const evidenceById = new Map(value.selected_evidence.map(item => [item.id, item]));
  if (evidenceById.size !== value.selected_evidence.length || new Set(trace.steps.map(step => step.id)).size !== trace.steps.length ||
      new Set(trace.paths.map(path => path.id)).size !== trace.paths.length) fail('Duplicate Live evidence or path identities.');
  const stepsById = new Map(trace.steps.map(step => [step.id, step]));
  const recordedEdges = native.retrieval?.source_edges || [];
  const graphStepIds = new Set();
  if (!Array.isArray(recordedEdges) || (trace.graph_edges?.length || 0)) fail('Unbound Live graph edges are not supported.');
  for (const step of trace.steps) {
    if (!['QUERY_ATOM', 'READING_CANDIDATE', 'RECORDED_MATCH', 'SOURCE_READOUT', 'SOURCE_GRAPH_NAVIGATION'].includes(step.kind) ||
        step.edges != null && !Array.isArray(step.edges) || step.nodes != null && !Array.isArray(step.nodes) ||
        (step.graph_edges?.length || 0)) fail('A Live step has unbound graph structure.');
    for (const ref of step.source_refs || []) replay(ref);
    for (const id of step.accepted_evidence_ids || []) {
      if (evidenceById.get(id)?.purpose !== 'FINAL_DECISION_EVIDENCE') fail('Context was promoted to accepted evidence.');
    }
  }
  for (const path of trace.paths) {
    if (!path.steps?.every(id => trace.steps.some(step => step.id === id)) ||
        !units.has(path.candidate_or_atom_id) ||
        !['DIRECT_SOURCE_HANDOFF', 'RECORDED_SOURCE_ROUTE', 'RECORDED_RELATION_NOMINATION'].includes(path.route_mode)) {
      fail('A Live path is missing its actual recorded steps.');
    }
    for (const ref of path.source_refs || []) replay(ref);
    for (const ref of path.decision_source_refs || []) replay(ref);
    const unit = units.get(path.candidate_or_atom_id), accepted = path.accepted_evidence_ids;
    const endpointRefs = path.decision_source_refs;
    if (!Array.isArray(accepted) || accepted.length > 1 || !Array.isArray(endpointRefs) || endpointRefs.length !== 1 ||
        path.query_atom_id !== unit.queryAtomId) fail('A Live path changes its native endpoint unit.');
    let endpoint;
    if (accepted.length) {
      endpoint = evidenceById.get(accepted[0]);
      if (endpoint?.purpose !== 'FINAL_DECISION_EVIDENCE' || path.endpoint_kind !== 'DECISION_EVIDENCE') {
        fail('A Live path promotes context to accepted native evidence.');
      }
    } else {
      if (path.direction !== 'CONTEXT' || path.endpoint_kind !== 'CANDIDATE_SOURCE_CONTEXT') {
        fail('A contextual Live readout cannot be displayed as support or opposition.');
      }
      endpoint = value.selected_evidence.find(item => item.item_id === unit.id &&
        item.purpose === 'CANDIDATE_ORIGINAL_CONTEXT_NOT_ASSERTED_SUPPORT' &&
        item.source_refs.some(ref => refSame(ref, endpointRefs[0])));
    }
    if (!endpoint || endpoint.item_id !== unit.id || endpoint.direction !== path.direction ||
        !endpointRefs.every(ref => endpoint.source_refs.some(original => refSame(ref, original)))) {
      fail('A Live path borrows another native unit, direction or decision source.');
    }
    const pathSteps = path.steps.map(id => stepsById.get(id));
    for (const step of pathSteps) {
      if (step.query_atom_id !== unit.queryAtomId || step.native_status != null && step.native_status !== unit.status) {
        fail('A Live path step changes its native unit or decision status.');
      }
      const readout = step.kind === 'SOURCE_READOUT', match = step.kind === 'RECORDED_MATCH';
      if (readout || match) {
        if (!refsEqual(step.source_refs || [], endpointRefs) || !same(step.accepted_evidence_ids || [], accepted)) {
          fail('A Live readout changes its bound native evidence.');
        }
        for (const node of step.nodes || []) if (node.citation && !refSame(node.citation, endpointRefs[0])) {
          fail('A Live readout node cites another source.');
        }
      }
      if (match && !same(step.recorded_locations, endpoint.recorded_locations)) fail('A Live match changes its native evidence locations.');
      if (readout) {
        const updates = unit.candidateId ? [{candidate_id: unit.candidateId, reading_id: unit.readingId,
          native_status: unit.status, direction: endpoint.direction, source_purpose: endpoint.purpose}] : [];
        if (step.direction !== path.direction || step.purpose !== endpoint.purpose || !same(step.candidate_updates || [], updates)) {
          fail('A Live readout changes native direction, purpose or candidate status.');
        }
      }
    }
    const graphSteps = pathSteps.filter(step => (step.edges?.length || 0) || (step.nodes || []).some(node => node.is_graph_node === true));
    if ((path.graph_edges?.length || 0) || path.route_mode === 'DIRECT_SOURCE_HANDOFF' &&
        (path.graph_hops !== 0 || path.original_traversal_claimed === true || graphSteps.length) ||
        (path.accepted_evidence_ids || []).some(id => evidenceById.get(id)?.purpose !== 'FINAL_DECISION_EVIDENCE')) {
      fail('A Live path invents traversal or promotes context to support.');
    }
    if (path.route_mode === 'DIRECT_SOURCE_HANDOFF' && !refsEqual(path.source_refs || [], endpointRefs)) {
      fail('A direct Live handoff adds a source outside its native endpoint.');
    }
    if (path.route_mode !== 'DIRECT_SOURCE_HANDOFF') {
      // The configured hierarchy kernel saves source handoffs, NOT KG walks.
      // A display-only mode change cannot promote those into recorded routes.
      if (native.configuration?.method === 'current_hierarchy' || !recordedEdges.length ||
          !Number.isInteger(path.graph_hops) || path.graph_hops < 1 || path.graph_hops > 3 ||
          path.original_traversal_claimed !== (path.route_mode === 'RECORDED_SOURCE_ROUTE')) {
        fail('A Live graph route lacks an actual native retrieval binding.');
      }
      const edges = [];
      for (const step of graphSteps) {
        if (step.kind !== 'SOURCE_GRAPH_NAVIGATION' || step.route_mode !== path.route_mode ||
            step.original_traversal_claimed !== path.original_traversal_claimed || step.factual_support_implied !== false ||
            !step.edges?.length) fail('A graph step changes native route semantics.');
        graphStepIds.add(step.id);
        for (const edge of step.edges) {
          const original = recordedEdges.find(raw => raw.source_row_id === edge.source_row_id &&
            raw.source === edge.source && raw.target === edge.target && raw.relation === edge.relation && refSame(raw.citation, edge.citation));
          if (!original || edge.kind !== 'SOURCE_ASSERTION' || edge.factual_support_implied !== false ||
              edge.native_source_direction_preserved !== true) fail('A Live graph edge is absent from native retrieval.');
          replay(edge.citation);
          for (const id of [edge.source, edge.target]) {
            const node = (step.nodes || []).find(item => item.id === id && item.is_graph_node === true);
            if (!node?.citation || !edge.citation.text.includes(node.label)) fail('A Live graph node lacks literal source provenance.');
            replay(node.citation);
          }
          edges.push(edge);
        }
      }
      if (edges.length !== path.graph_hops || new Set(edges.map(edge => edge.source_row_id)).size !== edges.length) {
        fail('Native route edge count or identity changed.');
      }
      const rowIds = edges.map(edge => edge.source_row_id);
      const recorded = recordedEdges.find(raw => same(raw.path_source_row_ids || [raw.source_row_id], rowIds));
      if (!recorded) fail('The Live route ordering was not recorded by native retrieval.');
      const first = recordedEdges.find(raw => raw.source_row_id === rowIds[0]);
      let at = first.lookup_direction === 'INCOMING_LOOKUP' ? edges[0].target : edges[0].source;
      const visited = new Set();
      for (const edge of edges) {
        if (![edge.source, edge.target].includes(at) || visited.has(at)) fail('The native route is disconnected or repeats a graph state.');
        const destination = at === edge.source ? edge.target : edge.source;
        if (edge.traversal_from !== at || edge.traversal_to !== destination || edge.reverse_lookup !== (at !== edge.source)) {
          fail('A Live route changes the recorded source direction.');
        }
        visited.add(at);at = destination;
      }
      if (visited.has(at)) fail('The native route repeats its final graph state.');
    }
  }
  for (const step of trace.steps) {
    if (((step.edges?.length || 0) || (step.nodes || []).some(node => node.is_graph_node === true)) && !graphStepIds.has(step.id)) {
      fail('An unbound or orphan graph step was added to the Live trace.');
    }
  }
  return value;
}

export async function toWorkbenchPacket(envelope, expectedRun) {
  await verifyEnvelope(envelope, expectedRun);
  const condition = envelope.condition;
  const row = {case: condition.case, configurations: {llm_readings: condition},
    resource_binding: condition.resource_binding || null,
    current_resource_execution: condition.current_resource_execution === true,
    execution_kind: envelope.execution_kind, live_run_id: envelope.run_id};
  const report = {version: 'matryoshka-live-report/1', run_id: envelope.run_id, status: 'COMPLETE',
    cases: [row], execution_kind: envelope.execution_kind, live_execution: envelope.execution_kind === 'live',
    saved_replay: false, benchmark_accuracy_claimed: false};
  return {report, row, condition, trace: envelope.trace, sources: envelope.sources,
    document_pages: envelope.document_pages || {}, origins: null,
    receipt: envelope.receipt, source_scope: envelope.source_scope, selected_evidence: envelope.selected_evidence,
    run_id: envelope.run_id, execution_kind: envelope.execution_kind};
}

export function sendToWorkbench(target, envelope, {timeout = 90000} = {}) {
  const targetOrigin = location.origin;
  let timer;
  const cleanup = () => { clearTimeout(timer); removeEventListener('message', listen); };
  const listen = event => {
    if (event.origin !== targetOrigin || event.source !== target || event.data?.type !== 'matryoshka:live-ready' ||
        event.data.run_id !== envelope.run_id) return;
    target.postMessage({type: 'matryoshka:live-result', result: envelope}, targetOrigin);
    cleanup();
  };
  addEventListener('message', listen);
  timer = setTimeout(cleanup, timeout);
  return cleanup;
}

export function receiveFromLive(callback, {runId = new URLSearchParams(location.search).get('live_run'), timeout = 15000, onError = () => {}} = {}) {
  if (!RUN.test(runId || '') || !window.opener) {
    onError(new Error('Open this run from the authenticated Live page, or connect explicitly to its backend.'));
    return () => {};
  }
  const source = window.opener, expectedOrigin = location.origin;
  let interval, timer;
  const cleanup = () => { clearInterval(interval); clearTimeout(timer); removeEventListener('message', listen); };
  const listen = async event => {
    if (event.origin !== expectedOrigin || event.source !== source || event.data?.type !== 'matryoshka:live-result') return;
    cleanup();
    try { callback(await toWorkbenchPacket(event.data.result, runId)); } catch (error) { onError(error); }
  };
  const ready = () => source.postMessage({type: 'matryoshka:live-ready', run_id: runId}, expectedOrigin);
  addEventListener('message', listen);
  interval = setInterval(ready, 350);
  timer = setTimeout(() => { cleanup(); onError(new Error('The authenticated Live result is unavailable. No replay was substituted.')); }, timeout);
  ready();
  return cleanup;
}

export async function loadWorkbenchRun(runId, options = {}) {
  if (!RUN.test(runId || '')) fail('A valid opaque Live run ID is required.');
  if (options.backend && options.capability) {
    const client = new LiveClient(options);
    try { return await toWorkbenchPacket(await client.result(runId.slice(5)), runId); }
    finally { client.disconnect(); }
  }
  return new Promise((resolve, reject) => receiveFromLive(resolve, {...options, runId, onError: reject}));
}

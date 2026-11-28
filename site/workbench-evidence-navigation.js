/* Postselection source inspection. This never manufactures a retrieval trace. */
import {savedSourcePolicy, savedSourceScope, sourcePagePolicyAllows} from './saved-source-policy.js';

export const INSPECTION_VERSION = 'workbench-evidence-navigation/1';
const SHA = /^[a-f0-9]{64}$/;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const check = (ok, message) => { if (!ok) throw Error('Source KG inspection: ' + message); };
// Encode keys directly: JSON.stringify reorders integer-like shard keys.
const encode = v => Array.isArray(v) ? '[' + v.map(encode).join(',') + ']' : v && typeof v === 'object' ?
  '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + encode(v[k])).join(',') + '}' : JSON.stringify(v);
const canonical = v => encode(v).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const equal = (a, b) => canonical(a) === canonical(b);
const digest = async v => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(canonical(v))))].map(n => n.toString(16).padStart(2, '0')).join('');
const frozen = v => { if (v && typeof v === 'object') { Object.values(v).forEach(frozen); Object.freeze(v); } return v; };
const guides = new WeakMap();
const aborted = signal => { if (signal?.aborted) throw new DOMException('Inspection cancelled', 'AbortError'); };
const array = v => Array.isArray(v) ? v : [];
const textId = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 512;
const leaf = name => { check(typeof name === 'string' && /^[A-Za-z0-9_.-]+$/.test(name) && !name.includes('..'), 'unbound graph asset'); return name; };
const localAsset = path => typeof path === 'string' && /^(?:\.\/|\/)?[A-Za-z0-9_./-]+$/.test(path) &&
  !path.includes('//') && !path.replace(/^\.\//, '').split('/').includes('..');

function selectedBinding(binding, caseInfo) {
  check(binding && binding.corpus === caseInfo.corpus && ['graph_id', 'hierarchy_id'].every(k => textId(binding[k])) &&
    SHA.test(binding.index_sha256 || '') && SHA.test(binding.registry_sha256 || '') &&
    own(binding, 'resource_id') && (binding.resource_id === null || textId(binding.resource_id)), 'incomplete native resource binding');
}

function exactProof(proof, page, scope, caseInfo) {
  check(page && page.corpus === caseInfo.corpus && page.permitted === true &&
    sourcePagePolicyAllows(page, caseInfo, scope), 'page is outside the bound source policy');
  check(proof && proof.canonical_page_id === (page.canonical_page_id || page.id) &&
    proof.document_id === page.document_id && proof.date === page.date &&
    proof.page_sha256 === page.source_sha256 && SHA.test(proof.page_sha256 || ''), 'citation page/document/hash differs');
  const chars = Array.from(page.text);
  check(Number.isSafeInteger(proof.start) && Number.isSafeInteger(proof.end) && proof.start >= 0 &&
    proof.start < proof.end && proof.end <= chars.length && typeof proof.text === 'string' &&
    chars.slice(proof.start, proof.end).join('') === proof.text, 'exact Unicode quotation does not replay');
}

function sourceAnchor(row, proof, page) {
  // Bidirectional containment permits inspecting a wider extraction, not asserting it.
  // Mere overlap or another episode on the same page never owns this quotation.
  return row?.proof_kind === 'native_observation_span' && row.inspection_only === true &&
    row.source_ascription_only === true && textId(row.observation_id) && textId(row.node_id) &&
    row.canonical_page_id === proof.canonical_page_id && row.document_id === proof.document_id &&
    row.date === proof.date && row.page_sha256 === proof.page_sha256 &&
    Number.isSafeInteger(row.start) && Number.isSafeInteger(row.end) && row.start >= 0 &&
    row.end <= Array.from(page.text).length && row.end > row.start && typeof row.text === 'string' &&
    ((row.start >= proof.start && row.end <= proof.end) || (row.start <= proof.start && row.end >= proof.end)) &&
    Array.from(page.text).slice(row.start, row.end).join('') === row.text;
}

function pinURL(route, binding, caseInfo, config, fields = {}) {
  return '/api/current/' + route + '?' + new URLSearchParams({case_id: caseInfo.case_id, config,
    ...Object.fromEntries(['resource_id', 'registry_sha256', 'index_sha256'].filter(k => binding[k] !== null).map(k => [k, binding[k]])), ...fields});
}

function fnv(value) { let h = 2166136261; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function boundGraph(value, viewer) {
  check(value?.graph_run_id === viewer.graph_run_id && value?.hierarchy_run_id === viewer.hierarchy_run_id, 'graph revision differs');
}

/** fetchJSON must perform the application's pinned transport verification, including supplied byte pins.
 * sourceIndex is a page lookup hint; original source-proof shards remain the endpoint authority. */
export async function buildInspectionGuide(options) {
  const {caseInfo, config, binding, facts = [], proofs = [], fetchJSON, signal, sourceIndex,
    atomNodeMatches = [], sourcePolicy, getSourcePage, getNode} = options;
  check(caseInfo && textId(caseInfo.case_id) && ['cib', 'iran', 'vietnam'].includes(caseInfo.corpus) &&
    /^\d{4}-\d{2}-\d{2}$/.test(caseInfo.date || '') && typeof caseInfo.document_id === 'string' && caseInfo.document_id.length <= 512 &&
    typeof caseInfo.query === 'string' && textId(config) && typeof fetchJSON === 'function', 'case/config/transport required');
  selectedBinding(binding, caseInfo);
  check(Array.isArray(facts) && Array.isArray(proofs) && proofs.length > 0 && proofs.length <= 20 &&
    facts.every(f => textId(f.id) && typeof f.text === 'string' && f.text.length > 0) &&
    new Set(facts.map(f => f.id)).size === facts.length, 'public fact or source inventory invalid');
  check(sourcePolicy != null, 'explicit native source policy required');
  const scope = savedSourceScope(caseInfo, savedSourcePolicy(sourcePolicy));
  if (caseInfo.document_id === '') scope.whole_origin_excluded = null;
  const sameOriginScope = value => caseInfo.document_id === '' ? [null, false, ''].includes(value) : value === scope.whole_origin_excluded;
  const inputs = [caseInfo, config, binding, facts, proofs, sourcePolicy, atomNodeMatches, sourceIndex ?? null];
  const snapshot = canonical(inputs);
  const ensure = () => { aborted(signal); check(canonical(inputs) === snapshot, 'inputs changed during inspection'); };
  const get = async (path, pins = {}) => { ensure(); const v = await fetchJSON(path, {...pins, signal}); ensure(); return v; };
  const pageCache = new Map();
  const pageFor = async proof => {
    if (!pageCache.has(proof.canonical_page_id)) {
      const response = getSourcePage ? await getSourcePage(proof, {signal}) :
        await get(pinURL('source-v6', binding, caseInfo, config, {source_id: proof.canonical_page_id}));
      ensure();
      check(response.source_view_policy != null && equal(response.resource_binding, binding) && equal(savedSourcePolicy(response.source_view_policy), scope.source_view_policy) &&
        response.cutoff === caseInfo.date && sameOriginScope(response.whole_origin_excluded), 'source response binding/scope differs');
      const page = response.page || response;
      check(typeof page.text === 'string' && Array.from(page.text).length <= 2_000_000 &&
        await digest(page.text) === page.source_sha256, 'source page text hash differs');
      pageCache.set(proof.canonical_page_id, page);
    }
    const page = pageCache.get(proof.canonical_page_id); exactProof(proof, page, scope, caseInfo); return page;
  };
  for (const proof of proofs) await pageFor(proof);

  const viewer = await get('/api/graph-v4-viewer?' + new URLSearchParams({corpus: caseInfo.corpus}));
  check(viewer?.asset_base === `/graph-assets-v4/${caseInfo.corpus}/`, 'viewer corpus differs');
  // Legacy cables expose an explicit browser/native bridge, never a spelling join.
  const current = binding.source_status === 'CURRENT_NATIVE_RESOURCE_EXPLICIT';
  check(current || binding.source_status === 'INCUMBENT_NOT_MIGRATED' &&
    (binding.resource_id === null || binding.resource_id === binding.graph_id), 'unknown graph identity authority');
  check(current ? viewer.source_resource?.id === binding.resource_id && viewer.graph_run_id === binding.graph_id &&
    viewer.hierarchy_run_id === binding.hierarchy_id : viewer.study_graph_id === binding.graph_id &&
    viewer.study_hierarchy_id === binding.hierarchy_id, 'native graph has no exact viewer bridge');
  const asset = name => viewer.asset_base + leaf(name);
  const comparison = await get(asset(viewer.comparison_asset), {sha256: viewer.comparison_sha256});
  boundGraph(comparison, viewer);
  const later = scope.source_view_policy.id === 'later_release_inclusive';
  const viewKey = caseInfo.corpus === 'cib' ? (later ? 'current_later' : 'current_earlier') : 'current_redaction';
  const view = comparison.views?.[viewKey];
  check(view?.key === viewKey, 'source-edition graph projection is unavailable');
  const nodes = new Map();

  let lookup = null, proofManifest = null, proofEntry = null;
  if (sourceIndex) {
    check(localAsset(sourceIndex.url) && SHA.test(sourceIndex.content_sha256 || ''), 'source lookup pin required');
    lookup = await get(sourceIndex.url, {maxBytes: 1_000_000});
    check(await digest(lookup) === sourceIndex.content_sha256 &&
      ['source-page-node-lookup/1', 'source-page-node-lookup-manifest/1'].includes(lookup.version) &&
      lookup.corpus === caseInfo.corpus && localAsset(lookup.proof_manifest_url) && SHA.test(lookup.proof_manifest_content_sha256 || ''), 'page lookup commitment differs');
    proofManifest = await get(lookup.proof_manifest_url, {maxBytes: 1_000_000});
    check(await digest(proofManifest) === lookup.proof_manifest_content_sha256 &&
      proofManifest.version === 'graph-native-node-source-proof-shards/3' && proofManifest.bucket_count === 128 &&
      proofManifest.inspection_only === true && proofManifest.graph_or_source_modified === false && proofManifest.inference_calls === 0,
    'original graph source-proof manifest differs');
    proofEntry = proofManifest.corpora?.[caseInfo.corpus];
    const b = proofEntry?.binding;
    check(b?.corpus === caseInfo.corpus && b.browser_graph_id === viewer.graph_run_id &&
      b.browser_hierarchy_id === viewer.hierarchy_run_id && b.native_graph_id === binding.graph_id &&
      (current ? b.resource_id === binding.resource_id : b.resource_id === null) && b.index_sha256 === binding.index_sha256,
    'source proofs belong to a different native graph/index');
  }
  const shardCache = new Map();
  const pageHints = new Map();
  const hints = async proof => {
    if (!lookup) return [];
    if (lookup.version === 'source-page-node-lookup/1') return array(lookup.pages?.[proof.canonical_page_id]);
    const token = (new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(proof.canonical_page_id)))[0] % 128).toString(16).padStart(2, '0');
    if (!pageHints.has(token)) {
      const ref = lookup.shards?.[token];
      check([token + '.json', token + '.json.gz'].includes(ref?.path) && SHA.test(ref.content_sha256 || ''), 'page lookup shard pin differs');
      const base = sourceIndex.url.slice(0, sourceIndex.url.lastIndexOf('/') + 1);
      const packet = await get(base + ref.path, {sha256: ref.sha256, maxBytes: ref.bytes,
        wire_sha256: ref.wire_sha256, maxWireBytes: ref.wire_bytes, encoding: ref.encoding});
      check(await digest(packet) === ref.content_sha256 && packet.version === 'source-page-node-lookup/1' &&
        packet.corpus === caseInfo.corpus && packet.proof_manifest_content_sha256 === lookup.proof_manifest_content_sha256,
      'page lookup shard content differs');
      pageHints.set(token, packet.pages);
    }
    return array(pageHints.get(token)?.[proof.canonical_page_id]);
  };
  const originalAnchors = async nodeId => {
    if (!proofEntry) return [];
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nodeId)));
    const bucket = (bytes[0] % 128).toString(16).padStart(2, '0'), ref = proofEntry.buckets?.[bucket];
    check(ref?.path === `${caseInfo.corpus}/${bucket}.json.gz` && SHA.test(ref.sha256 || '') && SHA.test(ref.wire_sha256 || '') &&
      Number.isSafeInteger(ref.decoded_bytes) && ref.decoded_bytes > 0 && ref.decoded_bytes < 8_000_000 &&
      Number.isSafeInteger(ref.wire_bytes) && ref.wire_bytes > 0 && ref.wire_bytes < 8_000_000, 'original proof shard pin/bounds differ');
    if (!shardCache.has(bucket)) {
      check(shardCache.size < 32, 'source proof lookup exceeds 32-shard inspection bound');
      const base = lookup.proof_manifest_url.slice(0, lookup.proof_manifest_url.lastIndexOf('/') + 1);
      const packet = await get(base + ref.path, {sha256: ref.sha256, wire_sha256: ref.wire_sha256,
        maxBytes: ref.decoded_bytes, maxWireBytes: ref.wire_bytes});
      check(packet.version === 'graph-index-source-proofs/3' && equal(packet.binding, proofEntry.binding) &&
        Array.isArray(packet.rows) && packet.rows.length === ref.records && await digest(packet) === ref.sha256,
      'original source-proof packet differs');
      shardCache.set(bucket, packet.rows);
    }
    return shardCache.get(bucket).filter(row => row.node_id === nodeId);
  };
  const matches = array(atomNodeMatches);
  for (const m of matches) check(facts.some(f => f.id === m.atom_id) && textId(m.node_id), 'atom node match is outside public plan');
  const publicSeeds = new Set(matches.map(m => m.node_id));
  // Seeds select among already quote-owned connections, never among arbitrary label neighbors.
  const publicText = [caseInfo.query, ...facts.map(f => f.text)].join('\n');

  const neighborhoods = new Map();
  const neighborhood = async id => {
    if (neighborhoods.has(id)) return neighborhoods.get(id);
    const c = view.levels?.evidence?.neighborhood_catalog;
    check(c && Number.isSafeInteger(c.shard_count) && c.shard_count > 0 && c.shard_count <= 1024, 'neighborhood catalog absent');
    const bucket = String(fnv(id) % c.shard_count).padStart(2, '0');
    const file = c.files_by_shard?.[bucket] || String(c.filename_pattern || '').replace('{shard}', bucket);
    const packet = await get(asset(file));
    check(packet.view_key === viewKey && packet.neighborhoods && typeof packet.neighborhoods === 'object', 'node neighborhood projection differs');
    const detail = packet.neighborhoods[id] || null;
    if (detail) {
      check(detail.node?.id === id, 'exact node neighborhood identity differs');
      for (const node of [detail.node, ...array(detail.neighbors)]) {
        check(textId(node.id) && textId(node.type), 'native node identity/type missing');
        nodes.set(node.id, node);
        if (typeof node.label === 'string' && Array.from(node.label).length >= 3 && publicText.includes(node.label)) publicSeeds.add(node.id);
      }
    }
    neighborhoods.set(id, detail); return detail;
  };
  const finalSources = [], actions = [], admittedEdges = new Map();
  for (const proof of proofs) {
    const rows = await hints(proof);
    check(rows.length <= 4096, 'page lookup candidate bound');
    const candidates = [...new Set(rows.filter(row => Array.isArray(row) && row.length === 4 &&
      ((row[1] >= proof.start && row[2] <= proof.end) || (row[1] <= proof.start && row[2] >= proof.end)) &&
      row[3] === proof.page_sha256).map(row => row[0]))];
    const endpoints = [];
    for (const id of candidates) {
      for (const anchor of await originalAnchors(id)) if (sourceAnchor(anchor, proof, pageCache.get(proof.canonical_page_id)) && anchor.browser_node_present !== false) {
        // Shorter labels do not win. Favor a quote-owned claim/event, then largest exact extraction.
        endpoints.push({id, anchor, node: {id, type: anchor.node_type},
          wider_extraction: anchor.start < proof.start || anchor.end > proof.end});
      }
    }
    endpoints.sort((a, b) => Number(a.wider_extraction) - Number(b.wider_extraction) ||
      Number(!['Claim', 'Event'].includes(a.node.type)) - Number(!['Claim', 'Event'].includes(b.node.type)) ||
      (b.anchor.end - b.anchor.start) - (a.anchor.end - a.anchor.start) || a.id.localeCompare(b.id));
    let endpoint = null;
    for (const candidate of endpoints) {
      const detail = await neighborhood(candidate.id);
      if (detail) {
        check(detail.node.type === candidate.anchor.node_type, 'source proof and actual graph node types differ');
        endpoint = {...candidate, node: detail.node}; break;
      }
    }
    const source = {proof: structuredClone(proof), endpoint: endpoint ? structuredClone(endpoint) : null,
      status: endpoint ? endpoint.wider_extraction ? 'SELECTED_EXCERPT_WITHIN_WIDER_SOURCE_EXTRACTION' :
        'EXACT_QUOTE_OWNED_GRAPH_NODE' : 'NO_EXACT_GRAPH_ANCHOR', source_account_support_implied: false,
      node_assertion_certified: false};
    finalSources.push(source);
    if (endpoint) {
      const detail = await neighborhood(endpoint.id);
      const member = detail.node;
      check(member.id === endpoint.id && member.type === endpoint.node.type &&
        (member.community_id || null) === (endpoint.node.community_id || null), 'source node hierarchy or type differs');
      // No random neighbor path: only native, quote-owned incident connections survive.
      const sourceNode = getNode ? await getNode(endpoint.id, {signal}) :
        await get(pinURL('node-v6', binding, caseInfo, config, {node_id: endpoint.id}));
      ensure();
      const unavailable = typeof getNode === 'function' && sourceNode === null;
      source.connection_inventory_status = unavailable ? 'NATIVE_CONNECTIONS_NOT_EXPORTED' : 'BOUND_NATIVE_CONNECTIONS';
      check(unavailable || sourceNode && sourceNode.source_view_policy != null && equal(sourceNode.resource_binding, binding) && sourceNode.node_id === endpoint.id &&
        sourceNode.node?.id === endpoint.id && equal(savedSourcePolicy(sourceNode.source_view_policy), scope.source_view_policy) &&
        sourceNode.cutoff === caseInfo.date && sameOriginScope(sourceNode.whole_origin_excluded),
      'native source connections have a different resource/owner/scope');
      const incident = array(sourceNode?.edges).filter(e => (e.source === endpoint.id || e.target === endpoint.id) &&
        e.kind === 'SOURCE' && e.route_class === 'SOURCE_ASSERTION' && textId(e.id) && textId(e.relation_evidence_id) &&
        !e.slot_navigation && !e.investigative_only && array(e.citations).some(c =>
          c.canonical_page_id === proof.canonical_page_id && c.page_sha256 === proof.page_sha256 &&
          c.document_id === proof.document_id && c.date === proof.date && Number.isSafeInteger(c.start) && Number.isSafeInteger(c.end) &&
          c.start >= proof.start && c.end <= proof.end && c.end > c.start &&
          Array.from(proof.text).slice(c.start - proof.start, c.end - proof.start).join('') === c.text));
      const owned = new Map([endpoint, ...endpoints].filter(e => nodes.get(e.id)?.type === e.anchor.node_type).map(e => [e.id, e]));
      const direct = incident.filter(e => owned.has(e.source) && owned.has(e.target) &&
        array(detail.edges).some(b => textId(b.id) && ((b.source === e.source && b.target === e.target) ||
          (b.target === e.source && b.source === e.target)) && b.channel_counts?.explicit_relation > 0 &&
          !b.slot_navigation && !b.investigative_only)).sort((a, b) =>
        Number(!publicSeeds.has(a.source === endpoint.id ? a.target : a.source)) -
        Number(!publicSeeds.has(b.source === endpoint.id ? b.target : b.source)) || a.id.localeCompare(b.id)).slice(0, 1);
      const firstId = direct.length ? (direct[0].source === endpoint.id ? direct[0].target : direct[0].source) : endpoint.id;
      const first = firstId === endpoint.id ? member : array(detail.neighbors).find(n => n.id === firstId);
      check(first?.id === firstId, 'source connection endpoint is absent from the real neighborhood');
      if (first.community_id) actions.push({kind: 'HIERARCHY_NAVIGATION', title: 'Source community',
        node_id: first.id, community_id: first.community_id, node: structuredClone(first), graph_hops: 0});
      actions.push({kind: 'GRAPH_NODE', title: owned.get(first.id).wider_extraction ? 'Wider source extraction' :
        'Source ' + first.type.toLowerCase(), node_id: first.id,
        node: structuredClone(first), anchor: structuredClone(owned.get(first.id).anchor), graph_hops: 0});
      for (const edge of direct) {
        const from = edge.source === endpoint.id ? edge.target : edge.source;
        const browserEdge = detail.edges.find(b => ((b.source === edge.source && b.target === edge.target) ||
          (b.target === edge.source && b.source === edge.target)) && b.channel_counts?.explicit_relation > 0);
        const crossCommunity = !first.community_id || first.community_id !== member.community_id;
        if (crossCommunity) actions.push({kind: 'DIRECT_CONNECTIONS', title: 'Source connections',
          edge: structuredClone(edge), browser_edge: structuredClone(browserEdge), node_id: first.id,
          node: structuredClone(first), from_node_id: first.id, previous_node: structuredClone(first),
          target_node_id: member.id, target_node: structuredClone(member), graph_hops: 0});
        actions.push({kind: 'SOURCE_CONNECTION', title: edge.relation || edge.edge_type || 'Source connection',
          edge: structuredClone(edge), browser_edge: structuredClone(browserEdge), from_node_id: from, node_id: endpoint.id,
          node: structuredClone(member), previous_node: structuredClone(first),
          perspective: crossCommunity ? 'DIRECT_CONNECTIONS' : 'COMMUNITY',
          reverse_lookup: edge.source !== from, graph_hops: 1});
        admittedEdges.set(edge.id, edge);
      }
      if (direct.length && member.community_id && first.community_id !== member.community_id)
        actions.push({kind: 'HIERARCHY_NAVIGATION', title: 'Destination community', node_id: member.id,
          community_id: member.community_id, node: structuredClone(member), graph_hops: 0});
    }
    actions.push({kind: 'SOURCE_READOUT', title: 'Exact selected quotation', proof: structuredClone(proof),
      node_id: endpoint?.id || null, graph_hops: 0});
  }
  ensure();
  const guide = frozen({version: INSPECTION_VERSION, case_id: caseInfo.case_id, config, corpus: caseInfo.corpus,
    query_sha256: await digest(caseInfo.query), resource_binding: structuredClone(binding), scope,
    route_mode: 'POSTSELECTION_SOURCE_INSPECTION', original_traversal_claimed: false,
    historical_identity_or_query_support_certified: false, graph_hop_count: admittedEdges.size,
    source_connection_step_count: actions.filter(a => a.kind === 'SOURCE_CONNECTION').length,
    lookup_coverage: lookup ? 'PINNED_PAGE_LOOKUP' : 'NO_PAGE_LOOKUP_AVAILABLE',
    sources: finalSources, actions, viewer: {corpus: caseInfo.corpus, graph_id: viewer.graph_run_id,
      hierarchy_id: viewer.hierarchy_run_id, view: viewKey, resource_binding: structuredClone(binding)}});
  ensure(); guides.set(guide, {ensure}); return guide;
}

export function assertInspectionGuide(guide) {
  const authority = guides.get(guide); check(authority, 'guide was not built by this verified producer');
  authority.ensure(); return guide;
}

/** Mounts reversible controls; parent supplies its existing KG receiver and source drawer. */
export async function openInspectionGuide({guide, host, onOpen, inspect, signal, playInterval = 1200}) {
  assertInspectionGuide(guide);
  check(host?.replaceChildren && typeof inspect === 'function' &&
    (!guide.actions.some(a => a.kind !== 'SOURCE_READOUT') || typeof onOpen === 'function'), 'mount/inspection callbacks required');
  check(Number.isFinite(playInterval) && playInterval >= 100 && playInterval <= 10000, 'play interval outside bound');
  const doc = host.ownerDocument;
  const section = doc.createElement('section'), status = doc.createElement('p'), controls = doc.createElement('nav');
  section.dataset.testid = 'source-inspection-guide';
  section.className = 'kg-guide'; controls.className = 'kg-guide-controls';
  section.setAttribute('aria-label', 'Source-inspection KG navigator'); status.setAttribute('role', 'status');
  const label = doc.createElement('p'); label.textContent = 'Source inspection after selection';
  label.className = 'kg-guide-label'; status.className = 'kg-guide-status';
  const stages = doc.createElement('nav'); stages.className = 'kg-guide-stages';
  stages.setAttribute('aria-label', 'Source-inspection stages');
  const stageButtons = guide.actions.map((action, index) => {
    const button = doc.createElement('button'); button.type = 'button'; button.disabled = true;
    button.textContent = `${index + 1}. ${action.kind === 'HIERARCHY_NAVIGATION' ? 'Source map' : action.title}`;
    button.dataset.inspectionStep = String(index); button.title = action.title;
    button.onclick = () => show(index).catch(report); stages.append(button); return button;
  });
  const previous = doc.createElement('button'), next = doc.createElement('button'), play = doc.createElement('button');
  for (const [button, text] of [[previous, 'Previous'], [next, 'Next'], [play, 'Play']]) { button.type = 'button'; button.textContent = text; button.disabled = true; controls.append(button); }
  section.setAttribute('aria-busy', 'true'); section.dataset.navigationState = 'initializing';
  section.append(label, controls, stages, status); host.replaceChildren(section);
  const controller = new AbortController(); let at = -1, serial = 0, timer = null, closed = false, actionController = null, busy = false;
  const pause = () => { clearTimeout(timer); timer = null; play.textContent = 'Play'; };
  const valid = () => { aborted(signal); aborted(controller.signal); assertInspectionGuide(guide); check(!closed, 'guide is closed'); };
  const updateControls = () => {
    previous.disabled = busy || at <= 0;
    next.disabled = busy || at < 0 || at === guide.actions.length - 1;
    play.disabled = busy || at < 0 || at === guide.actions.length - 1;
    stageButtons.forEach((button, index) => {
      button.disabled = busy || at < 0;
      button.setAttribute('aria-current', index === at ? 'step' : 'false');
    });
    section.setAttribute('aria-busy', String(busy));
    section.dataset.navigationState = busy ? 'loading' : 'ready';
  };
  async function show(index) {
    valid();
    // DOM existence is not readiness. Never supersede the initial or in-flight step.
    if (busy) return false;
    busy = true; updateControls(); pause(); const revision = ++serial;
    try {
      actionController?.abort(); actionController = new AbortController(); const actionSignal = actionController.signal;
      const selected = Math.max(0, Math.min(guide.actions.length - 1, index)), action = guide.actions[selected];
      status.textContent = 'Opening ' + action.title;
      if (action.kind === 'SOURCE_READOUT') await inspect(action.proof, {guide, signal: actionSignal});
      else { check(typeof onOpen === 'function', 'no graph receiver is attached'); await onOpen(action, {guide, signal: actionSignal}); }
      valid(); if (revision !== serial) return false;
      at = selected; status.textContent = `${at + 1} / ${guide.actions.length}: ${action.title}`;
      section.dataset.step = String(at); section.dataset.kind = action.kind; return true;
    } finally {
      busy = false; if (!closed) updateControls();
    }
  }
  const report = error => { pause(); if (!closed && error?.name !== 'AbortError') status.textContent = error.message; };
  const nextStep = () => show(at + 1), previousStep = () => show(at - 1);
  async function tick() { try { if (await nextStep() && at < guide.actions.length - 1) { play.textContent = 'Pause'; timer = setTimeout(tick, playInterval); } } catch (e) { report(e); } }
  const start = () => { valid(); if (busy || at < 0 || at === guide.actions.length - 1) return false; if (timer) return pause(); play.textContent = 'Pause'; timer = setTimeout(tick, playInterval); };
  const close = () => { pause(); closed = true; serial++; actionController?.abort(); controller.abort(); section.remove(); signal?.removeEventListener('abort', close); };
  previous.onclick = () => previousStep().catch(report); next.onclick = () => nextStep().catch(report); play.onclick = start;
  signal?.addEventListener('abort', close, {once: true});
  try { await show(0); } catch (error) { close(); throw error; }
  const goTo = index => {
    check(Number.isSafeInteger(index) && index >= 0 && index < guide.actions.length, 'stage index outside guide');
    return show(index);
  };
  return Object.freeze({previous: previousStep, next: nextStep, play: start, pause, close, goTo, element: section,
    get position() { return at; }});
}

export const mountInspectionGuide = openInspectionGuide;

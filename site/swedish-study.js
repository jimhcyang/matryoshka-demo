// Pinned execution results only. Presentation does not run inference.
const $ = s => document.querySelector(s);
const state = {data: null, slot: 0, reading: 0};
const el = (tag, text, attrs = {}) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const btn = (text, fn, attrs = {}) => {
  const n = el('button', text, {type: 'button', ...attrs});
  n.onclick = fn;
  return n;
};
const current = () => state.data.cases[state.slot];
const selected = () => current().readings[state.reading];
const familyLabel = reading => reading.outer_family === 'adjectival' ? 'Adjectival phrase' : 'Noun phrase';
const statusLabel = decision => ({partial_grounding: 'Partial source match', exploratory_contextual: 'Context only'})[decision.status] || decision.label || decision.status;

async function pinned(ref) {
  if (!/^[a-zA-Z0-9_-]+\.json$/.test(ref.path) || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error('Invalid public study pin.');
  const r = await fetch(new URL(ref.path, import.meta.url), {cache: 'no-store', credentials: 'omit', redirect: 'error', mode: 'same-origin'});
  if (!r.ok) throw Error('Pinned study asset unavailable.');
  const b = await r.arrayBuffer();
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (h !== ref.sha256) throw Error('Public study byte pin failed.');
  return JSON.parse(new TextDecoder().decode(b));
}

function masked(text) {
  const n = el('div');
  let at = 0;
  for (const m of text.matchAll(/\[\[REDACTION_SLOT:[^\]]+\]\]|\[REDACTED\]|\[MASK\]/g)) {
    n.append(document.createTextNode(text.slice(at, m.index)), m[0] === '[MASK]' ? el('mark', '[REDACTION]') : document.createTextNode('[MASKED]'));
    at = m.index + m[0].length;
    if (m[0] !== '[MASK]' && text[at] && !/\s/.test(text[at])) n.append(document.createTextNode(' '));
  }
  n.append(document.createTextNode(text.slice(at)));
  return n;
}

function quote(ref) {
  const n = el('section', null, {class: 'citation-block'});
  n.append(el('p', `${ref.document_id} / ${ref.date} / physical page ${ref.source_page ?? 'not supplied'}`, {class: 'citation-meta'}), el('div', ref.text, {class: 'exact-quote'}), el('p', `${ref.canonical_page_id} / [${ref.start}, ${ref.end}) / ${ref.page_sha256}`, {class: 'source-hash'}));
  return n;
}

function showSources(c) {
  $('#dialog-title').textContent = c.fill + ' / sources';
  const body = $('#dialog-body');
  body.replaceChildren(el('p', 'These are separate source observations. They do not jointly establish one merged identity or decision.'));
  for (const v of c.source_variants) {
    body.append(el('h3', statusLabel(v.local_decision)), el('p', 'Source wording: ' + v.source_wording));
    for (const ref of v.sources) body.append(quote(ref));
  }
  $('#source-dialog').showModal();
}

function results() {
  const row = selected();
  $('#reading-select').value = String(state.reading);
  const attachment = row.reading.attachment_spans?.[0]?.text;
  $('#reading-note').textContent = attachment ? `${row.reading.outer_family === 'adjectival' ? 'An adjective' : 'A noun phrase'} describing "${attachment}".` : familyLabel(row.reading) + ' for the marked gap.';
  $('#reading-metadata').textContent = JSON.stringify({reading: row.reading, decisions: row.candidates.map(c => ({fill: c.fill, status: c.local_decision.status, label: c.local_decision.label}))}, null, 2);
  const list = $('#result-list'), sources = $('#source-list');
  list.replaceChildren();
  sources.replaceChildren();
  $('#source-count').textContent = `${current().inspected_page_count} pages checked in this run`;
  const seen = new Set();
  for (const c of row.candidates) {
    const card = el('li', null, {class: 'policy-card', 'data-testid': 'scoped-candidate', 'data-rank': c.rank});
    const head = el('div', null, {class: 'candidate-head'});
    head.append(el('span', String(c.rank).padStart(2, '0'), {class: 'rank'}), el('strong', c.fill, {class: 'fill'}), el('span', statusLabel(c.local_decision), {class: 'context-tag'}));
    card.append(head, el('p', `${c.source_variants.length} separate source observation${c.source_variants.length === 1 ? '' : 's'}.`, {class: 'scope-copy'}), btn('View sources', () => showSources(c), {'data-testid': 'inspect-variants'}));
    list.append(card);
    for (const ref of c.citation_union) {
      const key = JSON.stringify(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size <= 3) {
        const b = btn('', () => showSources(c), {class: 'quote-button'});
        b.append(el('span', ref.text), el('small', `${ref.document_id} / ${ref.date}`));
        sources.append(b);
      }
    }
  }
  if (!row.candidates.length) {
    list.append(el('li', 'No source match was nominated for this reading.', {class: 'empty-result'}));
    sources.append(el('p', 'Select another reading to view its recorded quotations.', {class: 'scope-copy'}));
  }
}

function render(focus = false) {
  const c = current(), tabs = $('#slot-controls');
  tabs.replaceChildren();
  state.data.cases.forEach((item, i) => {
    const b = btn(i ? 'Second query' : 'First query', () => choose(i, true), {role: 'tab', id: 'tab-' + item.position, 'aria-selected': String(i === state.slot), 'aria-controls': 'query-workspace', tabindex: i === state.slot ? '0' : '-1', 'data-slot': item.position});
    b.onkeydown = e => {
      if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        choose(e.key === 'Home' ? 0 : e.key === 'End' ? 1 : 1 - state.slot, true);
      }
    };
    tabs.append(b);
  });
  $('#query-workspace').setAttribute('aria-labelledby', 'tab-' + c.position);
  $('#query-text').replaceChildren(masked(c.case.query));
  $('#slot-position').textContent = state.slot ? 'Second gap' : 'First gap';
  $('#fact-list').replaceChildren(...c.facts.map(a => {const li = el('li'); li.append(masked(a.text)); return li;}));
  $('#reading-select').replaceChildren(...c.readings.map((r, i) => el('option', familyLabel(r.reading), {value: i})));
  $('#scope-rule').textContent = state.data.scope_rule;
  $('#method-delta').textContent = state.data.method_delta;
  $('#run-pin').textContent = `${c.execution_version} / execution SHA-256 ${c.execution_ref.sha256} / source view ${c.source_view_sha256}`;
  $('#archive-results').replaceChildren(...c.archived_lexical.candidates.map(v => el('p', `${v.rank}. ${v.fill} / archived lexical nomination only`)));
  results();
  const u = new URL(location.href);
  u.search = new URLSearchParams({slot: c.position, policy: 'S2'}).toString();
  history.replaceState(null, '', u);
  if (focus) $(`#tab-${c.position}`).focus();
}

function choose(i, focus) {
  state.slot = i;
  state.reading = Math.max(0, current().readings.findIndex(r => r.reading.outer_family === 'adjectival'));
  render(focus);
}

$('#reading-select').onchange = e => {state.reading = Number(e.target.value); results();};
$('#dialog-close').onclick = () => $('#source-dialog').close();
try {
  const expected = document.querySelector('meta[name=study-data-sha256]').content;
  state.data = await pinned({path: 'swedish-scoped-study-v04.json', sha256: expected});
  if (state.data.version !== 'swedish-scoped-shared-kernel-ui/3' || state.data.coordinate_policy_version !== 'declared-producer-job-local-coordinates/3' || state.data.gold !== null || state.data.canonical_native_run !== false || state.data.cases.length !== 2 || state.data.execution_performed !== true) throw Error('Wrong scoped execution contract.');
  const refs = state.data.cases;
  const cases = await Promise.all(refs.map(pinned));
  const completions = await Promise.all(state.data.public_completions.map(pinned));
  for (let i = 0; i < 2; i++) {
    const c = cases[i], seal = completions[i];
    if (c.version !== 'scoped-shared-kernel-study-display/3' || seal.version !== 'scoped-study-public-completion/3' || c.coordinate_policy_version !== state.data.coordinate_policy_version || seal.coordinate_policy_version !== c.coordinate_policy_version || c.position !== ['first', 'second'][i] || seal.case_id !== c.case.case_id || seal.public_display_ref.sha256 !== refs[i].sha256 || seal.public_display_ref.path !== refs[i].path || seal.source_view_sha256 !== c.source_view_sha256 || seal.query_sha256 !== c.query_sha256 || seal.executed_snapshot_identity !== state.data.executed_snapshot_identity || seal.raw_result_audit_digest !== c.raw_result_audit_digest || c.canonical_native_run !== false || c.gold !== null) throw Error('Scoped display/completion binding failed.');
  }
  state.data.cases = cases;
  choose(['second', 'last'].includes(new URLSearchParams(location.search).get('slot')) ? 1 : 0, false);
  document.body.dataset.studyReady = 'true';
  $('#study-status').textContent = 'Both queries use the same study method. Nominations are not recovered hidden words.';
} catch (error) {
  $('#study-status').textContent = error.message;
  $('#query-workspace').replaceChildren(el('p', 'The exact executed study is unavailable. No archive or alternate run is substituted.', {role: 'alert'}));
}

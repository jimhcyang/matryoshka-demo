import {LiveClient, credentialLike, sendToWorkbench, verifyEnvelope} from './live-result-adapter.js';
import {displayedScope, loadCorpusScopes, requestScope, validateCorpusScopes} from './live-scope-controls.js';

const $ = selector => document.querySelector(selector);
const terminal = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'resource_limited']);
const stageLabels = {queued: 'Queued', validating: 'Validating request', planning: 'Query-only planning and atomization',
  model_readings: 'Query-only Redaction model readings', opening_resources: 'Verifying fixed source resources',
  retrieval: 'Deterministic eligible-source retrieval', construction: 'Deterministic Redaction construction',
  task_decisions: 'Deterministic task decisions', projection: 'Verifying display and source evidence', saving: 'Saving output and receipt',
  completed: 'Completed', failed: 'Failed closed', cancelled: 'Cancelled', timed_out: 'Runtime limit reached', resource_limited: 'Resource limit reached'};
let client = null, job = null, result = null, pollEpoch = 0, handoffCleanup = null, expiryTimer = null, retryTimer = null;
const configuredBackend = $('meta[name="live-backend"]')?.content || '';
$('#backend').value = configuredBackend || (['127.0.0.1', 'localhost'].includes(location.hostname) ? `${location.origin}/live-api/` : '');
let scopeMetadata = null;
function updateCorpusDate(reset = false) {
  if (!scopeMetadata) return;
  const bounds = scopeMetadata.corpora[$('#corpus').value];
  $('#as-of').min = bounds.first_date;
  $('#as-of').max = bounds.last_date;
  if (reset) $('#as-of').value = bounds.last_date;
  $('#scope-date-hint').textContent = `Available ${bounds.first_date} to ${bounds.last_date}. The selected day is included; a blank date uses the full eligible corpus.`;
}
function applyCorpusScopes(value) {
  const first = !scopeMetadata;
  const checked = validateCorpusScopes(value);
  if (scopeMetadata && checked.execution_refs_sha256 !== scopeMetadata.execution_refs_sha256) {
    throw Error('The backend uses different corpus resources. Reload its current local interface.');
  }
  scopeMetadata = checked;
  updateCorpusDate(first);
}
loadCorpusScopes().then(applyCorpusScopes).catch(() => {
  if (!scopeMetadata) $('#scope-date-hint').textContent = 'Leave the date blank to use the backend\'s full eligible corpus, or choose an evidence date.';
});
$('#corpus').addEventListener('change', () => updateCorpusDate(true));

function availability(message, error = false) {
  $('#availability').textContent = message;
  $('#availability').classList.toggle('error', error);
}
function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (className) n.className = className;
  return n;
}
function disconnect(message = 'Logged out. Log in again to obtain a new short-lived session.') {
  pollEpoch++;
  clearTimeout(expiryTimer);
  handoffCleanup?.(); handoffCleanup = null;
  client?.disconnect(); client = null;
  $('#capability').value = ''; $('#login-password').value = '';
  $('#question-fields').disabled = true;
  $('#logout').disabled = true;
  $('#connect').disabled = false;
  $('#backend').disabled = false;
  $('#login-submit').disabled = false;
  $('#login-submit').textContent = 'Log in';
  $('#cancel').hidden = true; $('#retry').hidden = true;
  $('#result').hidden = true;
  $('#decisions').replaceChildren(); $('#evidence').replaceChildren();
  $('#paths').textContent = ''; $('#receipt').textContent = ''; $('#source-scope').replaceChildren();
  result = null; job = null;
  $('#session-status').textContent = message;
  availability(message + ' GitHub Pages still requires a separately operated backend; it cannot run the engine.');
}
$('#logout').addEventListener('click', async () => {
  const active = client;
  pollEpoch++;
  try {
    await active?.logout();
    disconnect('Logged out; the server session was revoked and unfinished jobs were cancelled. Incurred charges remain in the shared ledger.');
  } catch {
    disconnect('Disconnected locally, but server revocation could not be confirmed. The short expiry and job limits still apply.');
  }
});
async function connected() {
  const health = await client.health();
  if (health.version !== 'matryoshka-live-api/1') throw new Error('This backend does not implement the Live contract.');
  if (health.corpus_scopes) applyCorpusScopes(health.corpus_scopes);
  $('#logout').disabled = false;
  $('#connect').disabled = true;
  $('#backend').disabled = true;
  $('#question-fields').disabled = !health.ready;
  $('#limits').textContent = `Model: ${health.model}. One worker; ${health.limits.max_seconds}s/job; ${health.limits.max_rss_mib} MiB; $${health.limits.job_spend_usd.toFixed(2)}/job; up to $${health.limits.max_session_spend_usd.toFixed(2)} retained Live envelope against the shared $50 ledger.`;
  const seconds = health.session_expires_in_seconds;
  $('#session-status').textContent = `Logged in. Session expires in ${seconds}s; no credentials are stored.`;
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => disconnect('Session expired. Log in again; no password or bearer was retained.'), Math.max(0, seconds) * 1000);
  availability(health.mode === 'fixture' ? 'Connected to a synthetic API0 fixture. This is NOT inference and does not use the historical corpus.' : health.ready ?
    'Authenticated Live ready. The server holds the model key; the browser holds only a short-lived session.' :
    'Logged in, but execution is disabled. The operator must configure a server-side model key and explicitly enable paid execution.', !health.ready);
  $('#connection').open = false;
}
function loginError(error) {
  client?.disconnect(); client = null;
  $('#question-fields').disabled = true;
  $('#logout').disabled = true;
  $('#connect').disabled = false;
  availability(error.message, true);
  $('#session-status').textContent = 'Not logged in. Password entry has been cleared.';
  clearInterval(retryTimer);
  let left = error.retryAfter || 0;
  $('#login-submit').disabled = left > 0;
  $('#login-submit').textContent = left > 0 ? `Try again in ${left}s` : 'Log in';
  if (left > 0) retryTimer = setInterval(() => {
    left--;
    $('#login-submit').textContent = left > 0 ? `Try again in ${left}s` : 'Log in';
    if (left <= 0) { clearInterval(retryTimer); $('#login-submit').disabled = false; }
  }, 1000);
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('#login-password').value;
  $('#login-password').value = '';
  if ($('#login-submit').disabled) return;
  $('#login-submit').disabled = true;
  try {
    if (credentialLike(password)) throw new Error('Enter an access password, not a model API key or bearer token. Nothing was sent.');
    if (!$('#backend').value) throw new Error('Live backend is not configured. GitHub Pages cannot execute the engine; open Connection settings or use the local companion. Nothing was sent.');
    if (client) throw new Error('Log out of the current session before logging in again.');
    client = new LiveClient({backend: $('#backend').value});
    await client.login(password);
    await connected();
  } catch (error) { loginError(error); }
  finally { if (client) { $('#login-submit').disabled = true; $('#login-submit').textContent = 'Logged in'; } }
});
$('#connect').addEventListener('click', async () => {
  const candidate = $('#capability').value;
  $('#capability').value = '';
  $('#connect').disabled = true;
  try {
    if (credentialLike(candidate)) throw new Error('Enter an advanced capability, not a model API key or bearer header. Nothing was sent.');
    if (!candidate) throw new Error('An operator-enabled legacy capability is required.');
    client?.disconnect();
    client = new LiveClient({backend: $('#backend').value, capability: candidate});
    await connected();
    $('#login-submit').disabled = true; $('#login-submit').textContent = 'Logged in';
  } catch (error) {
    loginError(error);
  }
});
$('#task').addEventListener('change', () => { $('#focal-field').hidden = $('#task').value !== 'redaction'; });

function renderJob(value) {
  job = value;
  $('#run-title').textContent = `${value.execution_kind === 'fixture' ? 'Fixture' : 'Live'} / ${value.job_id.slice(0, 8)}`;
  $('#progress').replaceChildren(...value.events.map(event => {
    const li = node('li', stageLabels[event.stage] || 'Pipeline stage');
    li.append(node('small', new Date(event.at * 1000).toLocaleTimeString()));
    return li;
  }));
  $('#job-status').textContent = `${stageLabels[value.stage] || value.status}${value.error_code ? ` (${value.error_code})` : ''}. ${value.status === 'cancelled' ? 'Incurred or uncertain provider charges remain in the shared ledger.' : ''}`;
  $('#cancel').hidden = terminal.has(value.status);
  $('#retry').hidden = !terminal.has(value.status) || value.status === 'completed' || value.attempt >= 3;
  $('#run').disabled = !terminal.has(value.status);
}
async function follow(value) {
  const epoch = ++pollEpoch;
  result = null; $('#result').hidden = true;
  while (client && epoch === pollEpoch) {
    renderJob(value);
    if (terminal.has(value.status)) {
      if (value.status === 'completed') {
        const output = await client.result(value.job_id);
        if (epoch !== pollEpoch) return;
        await renderResult(output);
      }
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 800));
    if (!client || epoch !== pollEpoch) return;
    value = await client.status(value.job_id);
  }
}
$('#question-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!client) return;
  const query = $('#query').value.trim();
  if (new TextEncoder().encode(query).length > 2000) { availability('The analyst clause must be at most 2000 UTF-8 bytes.', true); return; }
  $('#run').disabled = true;
  try {
    const request = {task: $('#task').value, corpus: $('#corpus').value, query,
      ...requestScope($('#as-of').value, $('#excluded-origin').value),
      focal_marker: $('#task').value === 'redaction' ? $('#focal-marker').value : ''};
    await follow(await client.submit(request));
  }
  catch (error) { availability(error.message, true); $('#run').disabled = false; }
});
$('#cancel').addEventListener('click', async () => {
  if (!client || !job) return;
  try { renderJob(await client.cancel(job.job_id)); }
  catch (error) { availability(error.message, true); }
});
$('#retry').addEventListener('click', async () => {
  if (!client || !job) return;
  $('#retry').hidden = true;
  try { await follow(await client.retry(job.job_id)); }
  catch (error) { availability(error.message, true); }
});

async function renderResult(value) {
  await verifyEnvelope(value);
  const scope = displayedScope(value.request, value.source_scope);
  result = value;
  $('#result').hidden = false;
  $('#result-status').textContent = value.native.result.status || 'Completed';
  $('#result-kind').textContent = value.execution_kind === 'fixture' ? 'FIXTURE ONLY. No historical inference, source support or paid calls.' : value.receipt.execution_cache_hit ? 'Exact current-input execution cache reused. No new deterministic inference was claimed. Query, code and resource bindings were verified.' : 'New live execution completed. Model calls were limited to query-only planning and, for Redaction only, grammatical readings.';
  const decisions = [];
  for (const atom of value.native.result.atoms || []) {
    const item = node('div', null, 'decision');
    item.append(node('strong', `${atom.criterion_state || atom.status || 'UNRESOLVED'}: `), node('span', atom.text));
    decisions.push(item);
  }
  for (const reading of value.native.result.readings || []) {
    decisions.push(node('h3', reading.reading?.label || reading.reading?.id || 'Recorded reading'));
    for (const candidate of reading.candidates || []) {
      const item = node('div', null, 'decision');
      item.append(node('strong', `${candidate.rank}. ${candidate.local_decision?.status || 'UNRESOLVED'}: `), node('span', candidate.fill));
      decisions.push(item);
    }
  }
  $('#decisions').replaceChildren(...decisions);
  const visibleScope = {Corpus: {cib: 'Central Intelligence Bulletins', iran: 'Iran cables', vietnam: 'Vietnam cables'}[value.request.corpus],
    'Evidence through': scope.through,
    'Excluded document': scope.excludedDocument === null ? 'None (analyst-written question)' : scope.excludedDocument,
    'Source view': value.request.corpus === 'cib' ? 'Permitted earlier-release evidence' : 'Permitted CONFIDENTIAL evidence'};
  $('#source-scope').replaceChildren(...Object.entries(visibleScope).flatMap(([key, val]) => [node('dt', key), node('dd', val)]));
  const evidence = [];
  for (const item of value.selected_evidence) for (const ref of item.source_refs || []) {
    const card = node('article', null, 'evidence-card');
    card.append(node('p', `${item.direction} / ${item.purpose} / ${ref.document_id} / ${ref.date}`),
      node('blockquote', ref.text), node('p', `${ref.canonical_page_id} [${ref.start}, ${ref.end}) | ${ref.page_sha256}`));
    evidence.push(card);
  }
  $('#evidence').replaceChildren(...(evidence.length ? evidence : [node('p', 'No selected source evidence. Missing evidence is not opposition.')]));
  $('#paths').textContent = JSON.stringify(value.trace.paths, null, 2);
  $('#receipt').textContent = JSON.stringify({receipt: value.receipt, artifacts: value.artifacts, source_scope: value.source_scope}, null, 2);
}
$('#open-workbench').addEventListener('click', () => {
  if (!result) return;
  const target = new URL('workbench-v6.html', location.href);
  target.searchParams.set('live_run', result.run_id);
  const opened = window.open(target.href, '_blank');
  if (!opened) { availability('The workbench popup was blocked. Allow this page to open its verified Live run.', true); return; }
  handoffCleanup?.();
  handoffCleanup = sendToWorkbench(opened, result);
});
$('#download').addEventListener('click', () => {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = `${result.run_id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
addEventListener('pagehide', () => { pollEpoch++; client?.disconnect(); handoffCleanup?.(); clearTimeout(expiryTimer); clearInterval(retryTimer); });

import {LiveClient, sendToWorkbench, verifyEnvelope} from './live-result-adapter.js';

const $ = selector => document.querySelector(selector);
const terminal = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'resource_limited']);
const stageLabels = {queued: 'Queued', validating: 'Validating request', planning: 'Query-only planning and atomization',
  model_readings: 'Query-only Redaction model readings', opening_resources: 'Verifying fixed source resources',
  retrieval: 'Deterministic eligible-source retrieval', construction: 'Deterministic Redaction construction',
  task_decisions: 'Deterministic task decisions', projection: 'Verifying display and source evidence', saving: 'Saving output and receipt',
  completed: 'Completed', failed: 'Failed closed', cancelled: 'Cancelled', timed_out: 'Runtime limit reached', resource_limited: 'Resource limit reached'};
let client = null, job = null, result = null, pollEpoch = 0, handoffCleanup = null;
$('#backend').value = ['127.0.0.1', 'localhost'].includes(location.hostname) ? `${location.origin}/live-api/` : 'http://127.0.0.1:8977/live-api/';
$('#as-of').max = new Date().toLocaleDateString('en-CA');

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
function disconnect() {
  pollEpoch++;
  client?.disconnect(); client = null;
  $('#capability').value = '';
  $('#question-fields').disabled = true;
  $('#disconnect').disabled = true;
  $('#connect').disabled = false;
  $('#cancel').hidden = true; $('#retry').hidden = true;
  availability('Live disconnected. An already-running server job is not cancelled by disconnecting; its budget and runtime limits still apply.');
}
$('#disconnect').addEventListener('click', disconnect);
$('#connect').addEventListener('click', async () => {
  const candidate = $('#capability').value;
  $('#capability').value = '';
  $('#connect').disabled = true;
  try {
    client?.disconnect();
    client = new LiveClient({backend: $('#backend').value, capability: candidate});
    const health = await client.health();
    if (health.version !== 'matryoshka-live-api/1') throw new Error('This backend does not implement the Live contract.');
    $('#disconnect').disabled = false;
    $('#question-fields').disabled = !health.ready;
    $('#limits').textContent = `Model: ${health.model}. One worker; ${health.limits.max_seconds}s/job; ${health.limits.max_rss_mib} MiB; $${health.limits.job_spend_usd.toFixed(2)}/job; up to $${health.limits.max_session_spend_usd.toFixed(2)} new spend against the shared $50 ledger. Session expires in ${health.session_expires_in_seconds}s.`;
    availability(health.mode === 'fixture' ? 'Connected to a synthetic API0 fixture. This is NOT inference and does not use the historical corpus.' : health.ready ? 'Authenticated Live ready. New queries use the actual server-side pipeline; no saved replay is substituted.' : 'Backend connected but Live execution is unavailable. The operator must configure a server API key and explicitly launch with --execute-paid.', !health.ready);
    if (health.ready) $('#connection').open = false;
  } catch (error) {
    client?.disconnect(); client = null;
    $('#question-fields').disabled = true;
    $('#connect').disabled = false;
    availability(error.message, true);
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
  const request = {task: $('#task').value, corpus: $('#corpus').value, query,
    as_of: $('#as-of').value, excluded_origin: $('#excluded-origin').value.trim(),
    focal_marker: $('#task').value === 'redaction' ? $('#focal-marker').value : ''};
  $('#run').disabled = true;
  try { await follow(await client.submit(request)); }
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
  $('#source-scope').replaceChildren(...Object.entries(value.source_scope).flatMap(([key, val]) => [node('dt', key.replaceAll('_', ' ')), node('dd', Array.isArray(val) ? val.join(', ') : val)]));
  const evidence = [];
  for (const item of value.selected_evidence) for (const ref of item.source_refs || []) {
    const card = node('article', null, 'evidence-card');
    card.append(node('p', `${item.direction} / ${item.purpose} / ${ref.document_id} / ${ref.date}`),
      node('blockquote', ref.text), node('p', `${ref.canonical_page_id} [${ref.start}, ${ref.end}) | ${ref.page_sha256}`));
    evidence.push(card);
  }
  $('#evidence').replaceChildren(...(evidence.length ? evidence : [node('p', 'No selected source evidence. Missing evidence is not opposition.')]));
  $('#paths').textContent = JSON.stringify(value.trace.paths, null, 2);
  $('#receipt').textContent = JSON.stringify({receipt: value.receipt, artifacts: value.artifacts}, null, 2);
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
addEventListener('pagehide', () => { pollEpoch++; client?.disconnect(); handoffCleanup?.(); });

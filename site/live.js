import {LiveClient, credentialLike, liveRetrievalSummary, sendToWorkbench, verifyEnvelope} from './live-result-adapter.js?v=20261127-unified1';
import {LiveResultHistory} from './live-history.js?v=20261127-unified1';
import {displayedScope, loadCorpusScopes, requestScope, validateCorpusScopes} from './live-scope-controls.js';
import {computeDecisionScores, formatDecisionScore, EVIDENCE_SCORE_VERSION, POINTS_SCORE_VERSION, SOURCE_POINTS_VERSION} from './decision-scores.js';
import {renderTerminalScoreCards, terminalDocumentCounts} from './workbench-visuals.js';
import {liveSourceSummary,normalizeLiveSourceMethod} from './workbench-live-source.js';

const $ = selector => document.querySelector(selector);
const terminal = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'resource_limited']);
const stageLabels = {queued: 'Queued', validating: 'Checking input', planning: 'Planning search',
  model_readings: 'Reading mask syntax', opening_resources: 'Opening sources',
  retrieval: 'Finding source passages', construction: 'Constructing candidates',
  task_decisions: 'Assessing evidence', projection: 'Checking result', digest: 'Writing analyst digest', saving: 'Saving result',
  completed: 'Result ready', failed: 'Analysis failed', cancelled: 'Cancelled', timed_out: 'Time limit reached', resource_limited: 'Resource limit reached'};
const progressGroups = [['Prepare', ['queued', 'validating', 'planning', 'model_readings', 'opening_resources']],
  ['Find sources', ['retrieval', 'construction']], ['Decide', ['task_decisions', 'projection', 'digest', 'saving', 'completed']]];
let client = null, job = null, result = null, pollEpoch = 0, handoffCleanup = null, expiryTimer = null, retryTimer = null;
let inlineCleanup = null, inlineEpoch = 0, busy = false;
const localHistory = new LiveResultHistory();
const configuredBackend = $('meta[name="live-backend"]')?.content || '';
$('#backend').value = configuredBackend || (['127.0.0.1', 'localhost'].includes(location.hostname) ? `${location.origin}/live-api/` : '');
$('#local-companion').hidden=['127.0.0.1','localhost'].includes(location.hostname);
let scopeMetadata = null;
function updateCorpusDate(reset = false) {
  const cib = $('#corpus').value === 'cib';
  $('#origin-label').textContent = cib ? 'Source document (optional)' : 'Exclude document (optional)';
  $('#origin-hint').textContent = cib ? 'Leave blank for your own input. Enter an ID when quoting a source document.' :
    'Leave blank for your own input. For a source quotation, exclude its document.';
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
function setBusy(value) {
  busy = value;
  $('#run').disabled = value;
  for (const link of $('#history-list').querySelectorAll('a')) link.setAttribute('aria-disabled', String(value));
}
function historyURL(id) {
  const url = new URL('live.html', location.href);
  url.searchParams.set('live_run', id);
  return url;
}
function renderHistory() {
  const entries = localHistory.entries();
  $('#clear-history').disabled = !entries.length;
  $('#history-list').replaceChildren(...entries.map(entry => {
    const item = node('li'), link = node('a');
    link.href = historyURL(entry.runId).href;
    link.dataset.runId = entry.runId;
    link.setAttribute('aria-current', String(result?.run_id === entry.runId));
    link.setAttribute('aria-disabled', String(busy));
    link.append(node('strong', entry.summary.query), node('small',
      `${entry.summary.execution_kind === 'fixture' ? 'Fixture / ' : ''}${entry.summary.corpus.toUpperCase()} / ${entry.summary.task} / Saved ${new Date(entry.savedAt).toLocaleString()}${entry.kind === 'reference' ? ' / backend reference' : ' / stored legacy result'}`));
    link.addEventListener('click', async event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (busy) { $('#history-status').textContent = 'Wait for this run, or cancel it before opening history.'; return; }
      await openHistory(entry.runId);
    });
    item.append(link); return item;
  }));
}
async function openHistory(id) {
  const entry = localHistory.entry(id);
  if (!entry) { $('#history-status').textContent = 'This run is not saved in this tab, or its history has expired. No backend request was made.'; return; }
  const epoch = ++pollEpoch;
  try {
    $('#history-status').textContent = localHistory.get(id) ? 'Opening the retained result...' : 'Opening the saved backend run; no new analysis will be submitted.';
    const saved = await localHistory.recover(id, {backend: $('#backend').value,
      fetchResult: client ? identity => client.result(identity) : null});
    await verifyEnvelope(saved, id);
    if (epoch !== pollEpoch) return;
    const scope = displayedScope(saved.request, saved.source_scope);
    $('#task').value = saved.request.task; $('#corpus').value = saved.request.corpus; updateCorpusDate();
    $('#query').value = saved.request.query; $('#as-of').value = scope.through;
    $('#excluded-origin').value = /^live-analyst-origin:/.test(saved.request.excluded_origin) ? '' : saved.request.excluded_origin;
    $('#focal-marker').value = saved.request.focal_marker || '[REDACTION]';
    $('#focal-field').hidden = saved.request.task !== 'redaction';
    $('#run-title').textContent = 'Stored result'; $('#job-status').textContent = 'No new analysis';
    $('#run-heading').hidden = true;
    $('#progress').hidden = true; $('#cancel').hidden = true; $('#retry').hidden = true;
    await renderResult(saved, {stored: true, expectedEpoch: epoch});
    $('#history-status').textContent = entry.kind === 'reference' ? 'Saved backend result reopened. No new analysis or model call.' : 'Legacy local result reopened and verified. No backend request or new analysis.';
  } catch (error) {
    if (epoch !== pollEpoch) return;
    $('#history-status').textContent = error.code === 'HISTORY_RECONNECT' || error.code === 'HISTORY_BACKEND' ? error.message :
      error.code === 'JOB_NOT_FOUND' ? 'Saved run unavailable to this session. The backend may require its original session owner. No new analysis was started. The current result, if any, is unchanged.' :
      'The saved result could not be retrieved or verified. Reconnect and select it again; it may be unavailable to a new session. No new analysis or substitute result was opened. The current result, if any, is unchanged.';
    if (!client) { $('#connection').open = true; $('#login-password').focus({preventScroll: true}); }
  }
}
$('#clear-history').addEventListener('click', () => {
  if (!busy) pollEpoch++;
  localHistory.clear(); renderHistory();
  const url = new URL(location.href); url.searchParams.delete('live_run'); history.replaceState(null, '', url);
  $('#history-status').textContent = 'Local history cleared. The open result, if any, remains in memory until you leave.';
});
function openInlineWorkbench(value) {
  inlineCleanup?.();
  const epoch = ++inlineEpoch, frame = document.createElement('iframe');
  frame.title = `Complete Live workbench / ${value.request.task} / ${value.request.corpus}`;
  frame.width = '100%'; frame.height = String(Math.max(780, Math.round(innerHeight * .9)));
  frame.referrerPolicy = 'no-referrer'; frame.dataset.liveRun = value.run_id;
  $('#workbench-frame-host').replaceChildren(frame);
  $('#inline-status').textContent = 'Opening the complete verified workbench...';
  $('#inline-status').classList.remove('error'); $('#retry-view').hidden = true;
  const target = new URL('workbench-v6.html', location.href);
  target.searchParams.set('live_run', value.run_id); target.searchParams.set('live_embed', '1');
  const stopTransfer = sendToWorkbench(frame.contentWindow, value);
  let interval, timeout, drawerObserver;
  const stop = () => { clearInterval(interval); clearTimeout(timeout); stopTransfer(); };
  const failed = () => {
    if (epoch !== inlineEpoch) return;
    stop(); $('#inline-status').textContent = 'The full reader could not open. Reload this result view; no model call is needed.';
    $('#inline-status').classList.add('error'); $('#retry-view').hidden = false;
    $('#compact-result').open = true;
  };
  const inspect = () => {
    if (epoch !== inlineEpoch) return;
    try {
      const doc = frame.contentDocument;
      if (!doc || frame.contentWindow.location.origin !== location.origin) return;
      if (doc.querySelector('#page-error:not([hidden])')) { failed(); return; }
      if (doc.querySelector('#case-view[aria-busy="false"] [data-testid="compact-verdict"],#case-view[aria-busy="false"] [data-testid="standard-summary"]') && doc.querySelectorAll('.workflow > .stage').length === 6) {
        stop();
        for (const id of ['app-navigation', 'examples-toggle']) {
          const element = doc.getElementById(id); if (element) { element.hidden = true; element.style.display = 'none'; }
        }
        doc.body.style.paddingTop = '0';
        const stageBar = doc.querySelector('.workflow-nav');
        if (stageBar) stageBar.style.position = 'static';
        doc.querySelector('.workbench-shell')?.classList.remove('examples-open');
        doc.querySelector('#examples-rail')?.classList.remove('is-open');
        doc.documentElement.dataset.liveEmbedded = 'true';
        doc.querySelector('[data-testid="compact-verdict"],[data-testid="standard-summary"]')?.scrollIntoView({block: 'start'});
        const drawer = doc.getElementById('detail-drawer');
        if (drawer) {
          // An embedded modal must remain below the outer page's fixed navigation.
          drawerObserver = new MutationObserver(() => {
            if (drawer.open && epoch === inlineEpoch) frame.scrollIntoView({block: 'start', behavior: 'instant'});
          });
          drawerObserver.observe(drawer, {attributes: true, attributeFilter: ['open']});
        }
        $('#inline-status').textContent = 'Scroll inside the result to inspect facts, sources and scores.';
        frame.dataset.ready = 'true';
      }
    } catch { failed(); }
  };
  frame.addEventListener('load', inspect);
  frame.src = target.href;
  interval = setInterval(inspect, 200); timeout = setTimeout(failed, 45000);
  inlineCleanup = () => { stop(); drawerObserver?.disconnect(); frame.removeEventListener('load', inspect); frame.remove(); };
}
$('#retry-view').addEventListener('click', () => { if (result) openInlineWorkbench(result); });
localHistory.load().then(async ({removed}) => {
  renderHistory();
  if (removed) $('#history-status').textContent = 'Unverified or expired local results were removed.';
  const id = new URLSearchParams(location.search).get('live_run');
  if (id && !busy && !result) await openHistory(id);
});
async function digestBytes(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
// The parent verifies the envelope; replay the exact page again on inspection.
export async function mountLiveSourcePage(host, page, proof) {
  if ((page.id || page.canonical_page_id) !== proof.canonical_page_id || page.document_id !== proof.document_id || page.date !== proof.date) throw Error('Source identity changed.');
  const text = JSON.stringify(page.text).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  if (await digestBytes(new TextEncoder().encode(text)) !== proof.page_sha256) throw Error('Source page hash changed.');
  const {exactSourceAnchor, appendCIBPDFPair, cibPDFPair} = await import('./source-inspection.js');
  const anchor = exactSourceAnchor(page.text, proof), chars = Array.from(page.text), pre = node('pre', null, 'full-source-text');
  const mark = node('mark', anchor.text);
  pre.append(document.createTextNode(chars.slice(0, anchor.start).join('')), mark, document.createTextNode(chars.slice(anchor.end).join('')));
  if (!host.isConnected) return;
  const context = node('section', null, 'source-quote-context');
  context.dataset.testid = 'live-source-context';
  const quotation = node('blockquote'); quotation.dataset.testid = 'live-source-highlight';
  quotation.append(node('mark', anchor.text)); context.append(quotation);
  host.replaceChildren(context, pre);
  if (page.corpus === 'cib') {
    try {
      const options = {page: {...page, page_sha256: proof.page_sha256}, proof, base: new URL('.', location.href).href};
      const section = await appendCIBPDFPair(context, options);
      if (section) for (const item of await cibPDFPair(options)) {
        if (!item.page) continue;
        const url = new URL(item.asset_url); url.hash = 'page=' + item.page;
        const link = node('a', `${item.release === 'earlier' ? 'Earlier' : 'Later'} PDF / page ${item.page}`, 'button');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.dataset.testid = 'live-source-pdf'; link.dataset.release = item.release;
        link.dataset.pdfPage = String(item.page); link.dataset.pdfSha256 = item.sha256;
        section.insertBefore(link, section.querySelector('[data-testid=source-pdf-open]'));
      }
    } catch { context.append(node('p', 'Original PDFs are unavailable in this export.', 'hint')); }
  }
}
function disconnect(message = 'Logged out. Log in again to obtain a new short-lived session.') {
  pollEpoch++;
  clearTimeout(expiryTimer);
  handoffCleanup?.(); handoffCleanup = null;
  inlineEpoch++; inlineCleanup?.(); inlineCleanup = null;
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
  $('#run-panel').hidden = true; $('#local-verdict').hidden = true; $('#score-section').hidden = true;
  $('#run').disabled = false;
  $('#decisions').replaceChildren(); $('#evidence').replaceChildren();
  $('#decision-scores').replaceChildren(); $('#progress').replaceChildren(); $('#progress-receipt').textContent = '';
  $('#verdict-title').textContent = ''; $('#verdict-detail').textContent = '';
  $('#local-verdict').querySelectorAll('.score-overview').forEach(item => item.remove());
  $('#paths').textContent = ''; $('#receipt').textContent = ''; $('#source-scope').replaceChildren();
  $('#postrun-digest').hidden = true; $('#digest-text').textContent = '';
  result = null; job = null;
  setBusy(false); renderHistory();
  $('#session-status').textContent = message;
  availability(message);
}
$('#logout').addEventListener('click', async () => {
  const active = client;
  pollEpoch++;
  try {
    await active?.logout();
    disconnect('Logged out. The session was revoked and unfinished jobs were cancelled.');
  } catch {
    disconnect('Disconnected. Server revocation could not be confirmed; the session will expire.');
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
  $('#session-status').textContent = 'Logged in. Your session is held in memory only.';
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => disconnect('Session expired. Log in again; no password or bearer was retained.'), Math.max(0, seconds) * 1000);
  availability(health.mode === 'fixture' ? 'API0 fixture connected. This is NOT inference.' : health.ready ?
    'Ready for a new input.' : 'Logged in. Execution is disabled by the backend operator.', !health.ready);
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
  $('#run-panel').hidden = false;
  $('#run-heading').hidden = value.status === 'completed';
  $('#run-title').textContent = terminal.has(value.status) ? stageLabels[value.status] || 'Analysis' : 'Analyzing your input';
  const events = Array.isArray(value.events) ? value.events : [];
  const latest = [...events].reverse().find(event => progressGroups.some(([, stages]) => stages.includes(event.stage)))?.stage || value.stage;
  const current = Math.max(0, progressGroups.findIndex(([, stages]) => stages.includes(latest)));
  $('#progress').hidden = terminal.has(value.status);
  $('#progress').replaceChildren(...progressGroups.map(([label], index) => {
    const li = node('li', label);
    if (index === current) li.setAttribute('aria-current', 'step');
    return li;
  }));
  const code = /^[A-Z0-9_]{1,80}$/.test(value.error_code || '') ? ` (${value.error_code})` : '';
  $('#job-status').textContent = `${stageLabels[value.stage] || 'Analysis status'}${code}`;
  $('#progress-receipt').textContent = JSON.stringify({job_id: value.job_id, status: value.status, attempt: value.attempt, events}, null, 2);
  $('#cancel').hidden = terminal.has(value.status);
  $('#retry').hidden = !terminal.has(value.status) || value.status === 'completed' || value.attempt >= 3;
  $('#run').disabled = busy || !terminal.has(value.status);
}
async function follow(value) {
  const epoch = ++pollEpoch;
  result = null; $('#result').hidden = true; $('#local-verdict').hidden = true; $('#score-section').hidden = true;
  while (client && epoch === pollEpoch) {
    renderJob(value);
    if (terminal.has(value.status)) {
      if (value.status === 'completed') {
        const output = await client.result(value.job_id);
        if (epoch !== pollEpoch) return;
        await renderResult(output, {expectedEpoch: epoch});
      }
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 800));
    if (!client || epoch !== pollEpoch) return;
    value = await client.status(value.job_id);
  }
}
function showRunError(error, title = 'Analysis unavailable') {
  availability(error.message, true);
  $('#run-panel').hidden = false; $('#run-heading').hidden = false;
  $('#run-title').textContent = title; $('#job-status').textContent = error.message;
  $('#progress').hidden = true; $('#cancel').hidden = true;
}
$('#question-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#input-status').hidden = true;
  if (!client) return;
  const query = $('#query').value.trim();
  if (new TextEncoder().encode(query).length > 2000) { availability('The input must be at most 2000 UTF-8 bytes.', true); return; }
  if (busy) return;
  setBusy(true);
  inlineEpoch++; inlineCleanup?.(); inlineCleanup = null;
  result = null; job = null;
  $('#run-panel').hidden = false; $('#result').hidden = true; $('#local-verdict').hidden = true;
  $('#run-heading').hidden = false;
  $('#run-title').textContent = 'Starting analysis'; $('#job-status').textContent = 'Submitting input';
  $('#progress').hidden = true; $('#cancel').hidden = true; $('#retry').hidden = true;
  $('#run-panel').scrollIntoView({block: 'start'});
  try {
    const request = {task: $('#task').value, corpus: $('#corpus').value, query,
      ...requestScope($('#as-of').value, $('#excluded-origin').value),
      focal_marker: $('#task').value === 'redaction' ? $('#focal-marker').value : ''};
    await follow(await client.submit(request));
  }
  catch (error) { showRunError(error); }
  finally { setBusy(false); }
});
$('#question-form').addEventListener('invalid', event => {
  const label = event.target.labels?.[0]?.textContent || 'Input';
  $('#input-status').textContent = `${label}: ${event.target.validationMessage}`;
  $('#input-status').hidden = false;
}, true);
$('#question-form').addEventListener('input', () => { $('#input-status').hidden = true; });
$('#cancel').addEventListener('click', async () => {
  if (!client || !job) return;
  try { renderJob(await client.cancel(job.job_id)); if (terminal.has(job.status)) setBusy(false); }
  catch (error) { availability(error.message, true); }
});
$('#retry').addEventListener('click', async () => {
  if (!client || !job) return;
  $('#retry').hidden = true;
  setBusy(true);
  try { await follow(await client.retry(job.job_id)); }
  catch (error) { showRunError(error, 'Retry unavailable'); }
  finally { setBusy(false); }
});

const statusText = value => String(value || 'UNRESOLVED').replaceAll('_', ' ').toLowerCase().replace(/^./, char => char.toUpperCase());
export function compactScoreOverview(record, scores = computeDecisionScores(record)) {
  if (!scores) return null;
  if ((record.case?.task || record.result?.task) !== 'redaction') return {scope: 'overall', values: scores.overall};
  const index = scores.readings.findIndex(reading => reading.candidates.length);
  if (index < 0) return {scope: 'top-candidate', values: null};
  const reading = scores.readings[index], saved = reading.candidates[0];
  const candidate = record.result.readings.find(row => row.reading?.id === reading.id)?.candidates[0];
  const card = candidate?.terminal_scorecard;
  if (card && ['id', 'native_status', 'score', 'support', 'oppose', 'context', 'fit', 'criteria_coverage'].some(key => card[key] !== saved[key])) {
    throw Error('The top candidate scorecard differs from its recorded terminal scores.');
  }
  return {scope: 'top-candidate', readingId: reading.id, readingNumber: index + 1,
    candidateId: candidate?.id, fill: candidate?.fill, values: card || null};
}
export function renderScores(value) {
  if(value.native?.version==='private-live-source-intake/1'){
    const summary=liveSourceSummary(value);$('#local-verdict').hidden=false;$('#verdict-title').textContent=summary.title;
    $('#local-verdict').dataset.tone=summary.tone;$('#verdict-detail').textContent='Facts, selected sources, candidate scores and the analyst summary are shown below.';
    $('#score-section').hidden=true;$('#decision-scores').replaceChildren();return;
  }
  const record = value.condition, fixture = value.execution_kind === 'fixture';
  const nativeStatus = record.local_decisions_v65?.overall?.status || record.result?.status || 'UNRESOLVED';
  const retrieval = liveRetrievalSummary(value);
  let scores = null, summary = null, invalidScores = false;
  try { scores = computeDecisionScores(record); summary = compactScoreOverview(record, scores); }
  catch { scores = null; invalidScores = true; }
  $('#local-verdict').hidden = false;
  $('#verdict-title').textContent = fixture ? 'Fixture only' : retrieval.noCandidate ? 'No candidate passed' : statusText(scores?.overall?.native_status || nativeStatus);
  const status = String(scores?.overall?.native_status || nativeStatus).toLowerCase();
  $('#local-verdict').dataset.tone = /^(backed|supported|support|for)$/.test(status) ? 'support' : /^(opposed|against|counter)$/.test(status) ? 'oppose' : 'context';
  $('#verdict-detail').textContent = fixture ? 'Synthetic UI check. No historical inference or source support.' : retrieval.noCandidate ?
    `${retrieval.text} Retrieval and inspection do not establish factual support.` : scores ?
    scores.overall.required_atoms > 0 ? `${scores.overall.complete_atoms} of ${scores.overall.required_atoms} required facts complete.` :
      'Candidate scores retain the recorded evidence and order.' : invalidScores ?
        'The saved terminal scorecard could not be verified.' : 'Terminal scores were not recorded for this execution.';
  $('#score-section').hidden = false;
  const target = $('#decision-scores'); target.replaceChildren();
  if (!scores) { target.append(node('p', invalidScores ? 'Saved scorecard unavailable: verification failed.' : 'Terminal scores not recorded.', 'hint')); return; }
  const points = [EVIDENCE_SCORE_VERSION, POINTS_SCORE_VERSION, SOURCE_POINTS_VERSION].includes(scores.version);
  const overview = () => {
    const row = node('div', null, 'score-overview');
    const metric = (label, value) => {
      const item = node('span', `${label}: ${formatDecisionScore(value)}`);
      item.title = String(value); item.dataset.scoreValue = String(value);
      return item;
    };
    row.dataset.scoreScope = summary.scope;
    if (summary.scope === 'top-candidate') {
      row.dataset.readingId = summary.readingId || '';
      row.dataset.candidateId = summary.candidateId || '';
      const label = node('div', summary.candidateId ?
        `Top candidate / reading ${summary.readingNumber}: ${summary.fill}. Scores are not summed across candidates; rank is not acceptance.` :
        'No candidate scorecard to summarize.', 'hint');
      label.style.flexBasis = '100%'; label.style.overflowWrap = 'anywhere';
      row.append(label);
      if (!summary.values) {
        if (summary.candidateId) row.append(node('span', 'Top candidate scorecard not recorded.'));
        return row;
      }
      if (points) row.append(metric('Ranking points (not confidence)', summary.values.score));
      row.append(metric('Source fit', summary.values.fit), metric('Criteria coverage / 1', summary.values.criteria_coverage));
      const counts = terminalDocumentCounts(summary.values);
      if (counts) row.append(node('span', `${counts.total} distinct contributing documents`));
    }
    for (const [label, key] of [['Support', 'support'], ['Opposition', 'oppose'], ['Context', 'context']])
      row.append(metric(label, summary.values[key]));
    return row;
  };
  $('#local-verdict').append(overview());
  target.append(renderTerminalScoreCards(record, scores, {formatScore: formatDecisionScore, nativeBars: true, showTitle: false,
    readingTitle: reading => reading.label || reading.id}));
  const raw = node('details'); raw.append(node('summary', 'Raw saved score table / original units'));
  target.append(raw);
  const tableFor = (caption, entries, labels, withFit = false) => {
    if (!entries.length) return;
    const scroll = node('div', null, 'score-scroll'), table = node('table', null, 'score-table');
    table.append(node('caption', caption));
    const head = node('tr');
    for (const text of ['Item', withFit && points ? 'Ranking points' : withFit ? 'Priority index' : 'Signed evidence index', 'Support', 'Opposition', 'Context', 'Criteria / 1', ...(withFit ? ['Fit'] : [])]) {
      const cell = node('th', text); cell.scope = 'col'; head.append(cell);
    }
    const thead = node('thead'); thead.append(head); table.append(thead);
    const body = node('tbody');
    for (const entry of entries) {
      const row = node('tr'); row.append(node('th', labels.get(entry.id) || entry.id)); row.firstChild.scope = 'row';
      for (const key of ['score', 'support', 'oppose', 'context', 'criteria_coverage', ...(withFit ? ['fit'] : [])]) {
        const cell = node('td', formatDecisionScore(entry[key]));
        cell.title = String(entry[key]); cell.dataset.scoreValue = String(entry[key]); cell.dataset.scoreField = key;
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body); scroll.append(table); raw.append(scroll);
  };
  tableFor('Required facts', scores.atoms, new Map((record.result.atoms || []).map(atom => [atom.id, atom.text])));
  for (const reading of scores.readings) {
    const native = (record.result.readings || []).find(row => (row.reading_id || row.reading?.id) === reading.id);
    tableFor(native?.reading?.label || 'Recorded candidates', reading.candidates, new Map((native?.candidates || []).map(candidate => [candidate.id, candidate.fill])), true);
  }
  raw.append(node('p', points ? 'Candidate ranking points and fact-wise evidence indices retain their native units. Neither is a correctness probability.' :
    'Historical priority and evidence indices, not points or probabilities.', 'hint'));
}

async function renderResult(value, {stored = false, expectedEpoch = null} = {}) {
  await verifyEnvelope(value);
  if (expectedEpoch !== null && expectedEpoch !== pollEpoch) return;
  const scope = displayedScope(value.request, value.source_scope);
  result = value;
  $('#local-verdict').querySelectorAll('.score-overview').forEach(item => item.remove());
  renderScores(value);
  $('#run-panel').hidden = false;
  $('#result').hidden = false;
  const retrieval = liveRetrievalSummary(value);
  const sourceMethod=value.native.version==='private-live-source-intake/1'?value.condition.source_method:null;
  $('#result-status').textContent = sourceMethod?liveSourceSummary(value).title:retrieval.noCandidate ? 'No candidate passed' : value.native.result.status || 'Completed';
  $('#result-kind').textContent = value.execution_kind === 'fixture' ? 'FIXTURE ONLY. No historical inference, source support or paid calls.' : stored ? 'Reopened verified result. No new analysis or model call.' : value.receipt.execution_cache_hit ? 'Verified result reused for the same input and resources.' : 'New Live analysis complete.';
  if (value.execution_kind !== 'fixture') $('#result-kind').textContent += ` ${retrieval.text}`;
  const decisions = [];
  const decisionName = value => ({SUPPORT:'Supported',SUPPORTED:'Supported',OPPOSED:'Opposed',
    COUNTER:'Opposed',PARTIAL:'Partial evidence',UNRESOLVED:'Unresolved',
    evidence_backed_suggestion:'Evidence-backed suggestion',partial_grounding:'Partial evidence',
    exploratory_contextual:'Contextual suggestion',incompatible_not_viable:'Not compatible',
    CONFLICTED:'Mixed evidence'}[value] || String(value || 'Unresolved').replaceAll('_',' ').toLowerCase());
  for (const atom of (sourceMethod||value.native.result).atoms || []) {
    const item = node('div', null, 'decision');
    item.append(node('strong', `${decisionName(atom.status || atom.criterion_state)}: `), node('span', atom.text));
    decisions.push(item);
  }
  for (const reading of (sourceMethod||value.native.result).readings || []) {
    decisions.push(node('h3', reading.reading?.label || reading.reading?.id || 'Recorded reading'));
    for (const candidate of reading.candidates || []) {
      const item = node('div', null, 'decision');
      item.append(node('strong', `${candidate.rank}. ${sourceMethod?(candidate.source_supported_fill_approved?'Evidence-backed':'Contextual'):decisionName(candidate.local_decision?.status)}: `), node('span', candidate.fill));
      decisions.push(item);
    }
  }
  $('#decisions').replaceChildren(...decisions);
  const visibleScope = {Corpus: {cib: 'Central Intelligence Bulletins', iran: 'Iran cables', vietnam: 'Vietnam cables'}[value.request.corpus],
    'Evidence through': scope.through,
    'Source document': scope.originDocument || 'None (analyst-written input)',
    'Excluded document': scope.excludedDocument === null ? 'None' : scope.excludedDocument,
    ...(scope.originDocument ? {'Source document text': scope.earlierOriginAllowed ? 'Earlier/both-release text permitted; later-only text excluded' : 'Entire document excluded'} : {}),
    'Source view': value.request.corpus === 'cib' ? 'Permitted earlier-release evidence' : 'Permitted CONFIDENTIAL evidence'};
  $('#source-scope').replaceChildren(...Object.entries(visibleScope).flatMap(([key, val]) => [node('dt', key), node('dd', val)]));
  const evidence = [];
  const selectedEvidence=sourceMethod?normalizeLiveSourceMethod(value).proofs.map(proof=>({direction:'CONTEXT',source_refs:[proof]})):value.selected_evidence;
  for (const item of selectedEvidence) for (const ref of item.source_refs || []) {
    const card = node('article', null, 'evidence-card');
    const role = /^(SUPPORT|FOR|SUPPORTED)$/.test(item.direction) ? 'Support' : /^(COUNTER|COUNTEREVIDENCE|AGAINST|OPPOSE|OPPOSED)$/.test(item.direction) ? 'Opposition' : 'Context / partial';
    card.append(node('p', `${role} / ${ref.document_id} / ${ref.date}`), node('blockquote', ref.text));
    const proof = node('details'); proof.append(node('summary', 'Citation details'), node('p', `${item.direction} / ${item.purpose}`),
      node('p', `${ref.canonical_page_id} [${ref.start}, ${ref.end}) | ${ref.page_sha256}`)); card.append(proof);
    const page = value.sources[ref.canonical_page_id];
    if (page) {
      const full = node('details', null, 'full-source'); full.append(node('summary', 'Read full supplied source page'));
      let opened = false;
      full.addEventListener('toggle', async () => {
        if (!full.open || opened) return; opened = true;
        const host = node('div', null, 'source-reader'); full.append(host);
        try { await mountLiveSourcePage(host, page, ref); }
        catch { host.replaceChildren(node('p', 'This source page could not be verified. No alternate text was substituted.')); }
      });
      card.append(full);
    }
    evidence.push(card);
  }
  $('#evidence').replaceChildren(...(evidence.length ? evidence : [node('p', 'No selected source evidence. Missing evidence is not opposition.')]));
  $('#paths').textContent = JSON.stringify(value.trace.paths, null, 2);
  $('#receipt').textContent = JSON.stringify({receipt: value.receipt, artifacts: value.artifacts, source_scope: value.source_scope}, null, 2);
  const digest = sourceMethod?.digest||value.analyst_digest;
  $('#postrun-digest').hidden = value.execution_kind === 'fixture' || digest?.available !== true;
  $('#digest-text').textContent = value.execution_kind !== 'fixture' && digest?.available === true ? digest.text : '';
  $('#compact-result').open = false;
  openInlineWorkbench(value);
  history.replaceState(null, '', historyURL(value.run_id));
  renderHistory();
  $('#inline-result').scrollIntoView({block: 'start'});
  if (!stored) {
    try {
      const saved = await localHistory.remember(value, {backend: $('#backend').value});
      $('#history-status').textContent = saved.stored ? saved.reference ? 'A compact run reference is saved in this tab for up to 24 hours. The full open result remains in memory; revisiting requires the original backend and an authorized session. No login details are stored.' : 'The verified legacy local result remains saved with its original history lifetime. No login details are stored.' :
        saved.memory ? 'History is available in memory only; browser storage is unavailable.' : saved.reason || 'This result was not retained in tab history. Download it to keep a copy.';
    } catch { $('#history-status').textContent = 'This result was not saved locally. The open result and download remain available.'; }
    renderHistory();
  }
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
addEventListener('pagehide', () => { pollEpoch++; client?.disconnect(); handoffCleanup?.(); inlineCleanup?.(); clearTimeout(expiryTimer); clearInterval(retryTimer); });

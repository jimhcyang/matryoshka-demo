// Private Live source-method receiver. No requests, provider calls or saved fallback.
import * as transport from './live-result-adapter.js?v=20261127-unified1';
import {verifyLiveSourcePolicy} from './source-policy-contract.js';
import {renderStandardWorkbench} from './workbench-standard-view.js';

export const LIVE_SOURCE_METHOD = 'private-live-reviewed-source-pipeline/1';
const INTAKE = 'private-live-source-intake/1', VIEW = 'private-live-source-workbench-view/1';
const HASH = /^[a-f0-9]{64}$/, RUN = /^live_[a-f0-9]{32}$/;
const handles = new WeakMap(), envelopes = new WeakMap();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const array = value => Array.isArray(value) ? value : [];
const check = (ok, message) => { if (!ok) throw Error('Live source: ' + message); };
const ascii = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const stable = value => Array.isArray(value) ? value.map(stable) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))].map(n => n.toString(16).padStart(2, '0')).join('');
const textSHA = text => sha(ascii(text));
const count = value => Number.isSafeInteger(value) && value >= 0;
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const near = (a, b) => typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= 1e-12;
const unique = values => new Set(values).size === values.length;
const opaque = /\[\[REDACTION_SLOT:|\[(?:REDACTION(?:[ _]\d+)?|REDACTED|STILL REDACTED|MASKED|MASK)\]/i;
const INTEGER_FIELDS=new Set(['start','end','rank','earlier_page','later_page','physical_page','page_budget','full_text_utf8_budget','selected_pages','original_pages','selected_utf8_bytes','maximum_readings','maximum_source_calls','max_fills_per_reading','maximum_required_atoms','assessment_pages_per_batch','source_call_attempts','displayed_fills','source_page_budget','source_full_text_utf8_budget','required_facts','original_slots','processed_slots','provider_reviewed_slots','accepted_slots','held_slots','rejected_slots','unprocessed_slots','documents','api_calls','wire_bytes','decoded_bytes']);
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const exact = (value, keys) => object(value) && same(Object.keys(value).sort(), [...keys].sort());
// Python's fixed-four-decimal formatter rounds exact binary ties to even.
function fixed4(value) {
  check(typeof value==='number'&&Number.isFinite(value),'finite fixed-decimal value required');
  const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,Math.abs(value));
  const bits=view.getBigUint64(0),exponent=Number(bits>>52n&2047n),fraction=bits&((1n<<52n)-1n);
  let numerator=(exponent?fraction+(1n<<52n):fraction)*10000n,power=(exponent||1)-1075,rounded;
  if(power>=0)rounded=numerator<<BigInt(power);else{const denominator=1n<<BigInt(-power),whole=numerator/denominator,remainder=numerator%denominator;rounded=whole+(remainder*2n>denominator||remainder*2n===denominator&&whole%2n===1n?1n:0n);}
  return (value<0||Object.is(value,-0)?'-':'')+(rounded/10000n)+'.'+String(rounded%10000n).padStart(4,'0');
}
const safeRef = value => object(value) && typeof value.path === 'string' && !value.path.startsWith('/') && !/[\\:?\x00-\x20]/.test(value.path) && value.path.split('/').every(p => p && p !== '.' && p !== '..') && HASH.test(value.sha256);
const day = value => typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

// Raw token authority preserves Python float/int spelling, Unicode key order and
// self-seals. Parsed JavaScript numbers alone cannot prove these commitments.
function rawTree(text) {
  let position = 0, nodes = 0;
  const compare = (a, b) => {
    const x = Array.from(a), y = Array.from(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].codePointAt(0) - y[i].codePointAt(0);
    return x.length - y.length;
  };
  const float = value => {
    if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
    const sign = value < 0 ? '-' : '', parts = Math.abs(value).toString().split('e'), dot = parts[0].indexOf('.');
    let point = (dot < 0 ? parts[0].length : dot) + Number(parts[1] || 0), digits = parts[0].replace('.', '');
    while (digits[0] === '0') { digits = digits.slice(1); point--; }
    digits = digits.replace(/0+$/, '');
    const exponent = point - 1;
    if (exponent < -4 || exponent >= 16) return sign + digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (exponent < 0 ? '-' : '+') + String(Math.abs(exponent)).padStart(2, '0');
    if (point <= 0) return sign + '0.' + '0'.repeat(-point) + digits;
    if (point >= digits.length) return sign + digits + '0'.repeat(point - digits.length) + '.0';
    return sign + digits.slice(0, point) + '.' + digits.slice(point);
  };
  const string = () => {
    const start = position++;
    while (position < text.length) {
      const c = text[position++];
      if (c === '\\') { position++; continue; }
      if (c === '"') {
        const raw = text.slice(start, position), value = JSON.parse(raw);
        check(ascii(value) === raw, 'noncanonical JSON string'); return value;
      }
    }
    check(false, 'unterminated JSON string');
  };
  const parse = depth => {
    check(depth <= 100 && ++nodes <= 2000000, 'JSON structural bound');
    const start = position, char = text[position];
    if (char === '{' || char === '[') {
      const map = new Map(), entries = [], close = char === '{' ? '}' : ']'; position++;
      let previous;
      if (text[position] !== close) for (let i = 0;; i++) {
        const keyStart = position; let key = i;
        if (char === '{') {
          check(text[position] === '"', 'JSON key required'); key = string();
          check(!map.has(key) && (previous === undefined || compare(previous, key) < 0), 'duplicate or unordered JSON keys'); previous = key;
          check(text[position++] === ':', 'JSON colon required');
        }
        const child = parse(depth + 1);
        if(INTEGER_FIELDS.has(key)&&/[-0-9]/.test(text[child.start]))check(/^-?(?:0|[1-9]\d*)$/.test(text.slice(child.start,child.end)),'integer metadata cannot be a float token');
        map.set(key, child); entries.push({key, keyStart, child});
        if (text[position] === close) break;
        check(text[position++] === ',', 'JSON separator required');
      }
      check(text[position++] === close, 'JSON closing delimiter required');
      return {start, end: position, map, entries};
    }
    if (char === '"') string();
    else {
      while (position < text.length && !/[\],}]/.test(text[position])) position++;
      const token = text.slice(start, position);
      check(/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?)$/.test(token), 'invalid JSON token');
      if (!['null', 'true', 'false'].includes(token)) {
        const value = Number(token), integer = !/[.e]/.test(token);
        check(Number.isFinite(value) && (integer ? Number.isSafeInteger(value) && token !== '-0' : float(value) === token), 'noncanonical or unsafe JSON number');
      }
    }
    return {start, end: position};
  };
  const root = parse(0); check(root.map && position === text.length, 'one canonical JSON object required');
  return {value: JSON.parse(text), at: path => path.reduce((item, key) => { check(item?.map?.has(key), 'missing sealed field'); return item.map.get(key); }, root),
    raw: path => { const item = path.reduce((n, key) => n?.map?.get(key), root); check(item, 'missing raw field'); return text.slice(item.start, item.end); },
    without: (path, key) => '{' + path.reduce((n, k) => n?.map?.get(k), root).entries.filter(item => item.key !== key).map(item => text.slice(item.keyStart, item.child.end)).join(',') + '}'};
}

async function canonicalBytes(wire) {
  if (wire instanceof Uint8Array) { check(wire.length > 0 && wire.length <= 64 * 1024 ** 2, 'decoded byte bound'); return wire; }
  check(wire?.version === 'matryoshka-live-packed/1', 'original canonical bytes or packed wire required');
  await transport.unpackLiveResult(wire); // Existing codec owns compression and component guards.
  const binary = atob(wire.payload), compressed = Uint8Array.from(binary, c => c.charCodeAt(0));
  const raw = new Uint8Array(wire.decoded_bytes), reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  let length = 0;
  try { for (;;) { const {done, value} = await reader.read(); if (done) break; check(length + value.length <= raw.length, 'decoded bound exceeded'); raw.set(value, length); length += value.length; } }
  finally { reader.releaseLock(); }
  check(length === raw.length && await sha(raw) === wire.decoded_sha256, 'decoded wire hash differs'); return raw;
}

function bound(value) {
  const handle = handles.has(value) ? value : envelopes.get(value), state = handle && handles.get(handle);
  check(state && !state.signal?.aborted && state.snapshot === JSON.stringify(state.envelope) && state.assertCurrent?.() !== false, 'verify the exact current Live envelope first');
  return {handle, ...state};
}

export async function verifyLiveSourceMethod(envelope, {wire, signal, assertCurrent} = {}) {
  check(!signal?.aborted && assertCurrent?.() !== false, 'cancelled selection');
  wire ??= transport.liveResultWire?.(envelope);
  check(wire, 'original transport wire is required for Python numeric seals');
  const before = JSON.stringify(envelope), bytes = await canonicalBytes(wire);
  check(!signal?.aborted && before === JSON.stringify(envelope), 'envelope changed during decoding');
  check(!bytes.some(byte => byte > 127), 'canonical ASCII wire required');
  const tree = rawTree(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  check(same(tree.value, envelope), 'wire and envelope differ');
  const value = tree.value, {native, condition, receipt, request, source_scope: scope} = value, method = condition?.source_method, view = method?.view;
  check(value.version === 'matryoshka-live-result/1' && RUN.test(value.run_id) && value.execution_kind === 'live', 'Live identity required');
  check(native?.version === INTAKE && condition?.version === 'private-live-source-intake-condition/1' && method?.version === LIVE_SOURCE_METHOD && view?.version === VIEW, 'exact source method versions required');
  const c = native.public_case, mp = ['condition', 'source_method'];
  check(exact(c, ['case_id', 'task', 'corpus', 'query', 'date', 'document_id', 'focal_marker']) && ['mosaic', 'hypothesis', 'redaction'].includes(c.task) && ['cib', 'iran', 'vietnam'].includes(c.corpus) && typeof c.case_id === 'string' && c.case_id && typeof c.query === 'string' && day(c.date), 'exact public case required');
  check(Object.values(c).every(value=>typeof value==='string')&&c.query===c.query.trim()&&c.query&&new TextEncoder().encode(c.query).length<=2000&&!transport.credentialLike(c.query),'bounded credential-free public query required');
  check(c.task==='redaction'?/^\[\[REDACTION_SLOT:[A-Za-z0-9_-]{1,64}\]\]$|^\[(?:REDACTION(?:[ _]\d+)?|REDACTED|STILL REDACTED|MASKED|MASK)\]$/i.test(c.focal_marker)&&c.query.split(c.focal_marker).length===2:!c.focal_marker&&!opaque.test(c.query),'unique R focal marker or complete M/H clause required');
  check(exact(request, ['task', 'corpus', 'query', 'as_of', 'excluded_origin', 'focal_marker']) && ['task', 'corpus', 'query', 'focal_marker'].every(key => request[key] === c[key]) && request.as_of === c.date && request.excluded_origin === c.document_id, 'request/case mismatch');
  const querySHA = await textSHA(c.query), nativeSHA = await sha(tree.raw(['native']));
  check(same(c, condition.case) && same(c, method.public_case) && same(c, view.case) && same(native.case, {...c, task: c.task === 'mosaic' ? 'reconstruction' : c.task}), 'case projection changed');
  check(await sha(tree.raw(['native', 'result'])) === native.native_checksum && [condition.native_checksum, method.native_checksum, view.native_checksum].every(x => x === native.native_checksum) && method.native_record_sha256 === nativeSHA && condition.native_record_sha256 === nativeSHA, 'native checksum/record changed');
  check(method.sha256 === await sha(tree.without(mp, 'sha256')) && method.pipeline_sha256 === await sha(tree.raw([...mp, 'pipeline'])) && view.pipeline_sha256 === method.pipeline_sha256, 'source method/pipeline seal differs');
  check([native.query_sha256, native.result.query_sha256, native.plan.query_sha256, method.query_sha256, view.query_sha256].every(hash => hash === querySHA), 'query hash differs');
  check(native.result.provided_plan_sha256 === await sha(tree.raw(['native', 'plan'])) && same(native.plan, condition.plan) && same(native.result, condition.result), 'intake plan/result projection changed');
  check(native.query_only_inference === true && native.answers_read === false && native.grades_read === false && native.source_pipeline_required === true && native.native_decisions_executed === false && condition.native_decisions_executed === false && receipt.native_decisions_executed === false && native.plan.query_only === true && native.plan.corpus_read === false && native.plan.hidden_answers_read === false, 'query-only intake flags changed');
  check(native.result.status === 'SOURCE_INTAKE_ONLY_NOT_A_NATIVE_VERDICT' && same(native.result.atoms, []) && same(native.result.readings, []) && native.result.api_calls === 0 && value.analyst_digest?.available === false && value.analyst_digest?.used_for_inference === false, 'intake is not a task verdict or digest');
  const emptyPool=method.source_pages?.length===0&&['NO_ELIGIBLE_INSPECTED_SOURCES','SOURCE_BUDGET_HOLD_UNPROCESSED'].includes(method.status);
  check(method.no_answer_or_grade_inputs === true && method.no_native_verdict_upgrade === true && (method.world_truth_certified === false||emptyPool&&method.world_truth_certified===undefined) && (method.native_history_modified === false || emptyPool && method.native_history_modified === undefined) && view.native_method === false && view.world_truth_certified === false && receipt.no_answer_or_grade_inputs === true && receipt.no_chain_of_thought === true && receipt.cumulative_cap_usd === 50, 'source authority/funding flags changed');
  const admission = verifyLiveSourcePolicy(scope, native, request);
  check(admission.current && scope.corpus === c.corpus && scope.full_documents_supplied === false && scope.supplied_pages_scope === 'INSPECTED_REFERENCED_PAGES_ONLY' && (admission.inclusive ? scope.on_or_before === c.date && scope.strict_before === undefined : scope.strict_before === c.date && scope.on_or_before === undefined), 'closed ordinary source scope required');
  check(same(method.source_view_policy, scope.source_view_policy) && same(view.source_view_policy, scope.source_view_policy) && same(native.retrieval?.source_view_policy, scope.source_view_policy), 'source policy changed');
  const index=native.binding,resource=condition.resource_binding;
  check(safeRef(index)&&safeRef(condition.registry_ref)&&same(index,condition.index_ref)&&same(method.resource_binding,index)&&same(native.execution_context?.index_ref,index)&&same(native.execution_context?.registry_ref,condition.registry_ref)&&resource?.corpus===c.corpus&&index.corpus===c.corpus&&HASH.test(index.registry_sha256)&&HASH.test(index.source_binding_sha256)&&index.source_binding_sha256===await sha(tree.raw(['condition','resource_binding']))&&index.source_status===resource.status&&safeRef(index.native_index_ref)&&index.native_index_ref.sha256===index.sha256,'resource bindings changed');
  if(resource.status==='INCUMBENT_NOT_MIGRATED'){
    check(['iran','vietnam'].includes(c.corpus)&&index.resource_id===null&&index.path===index.native_index_ref.path&&same(index.native_index_ref,resource.incumbent_index_ref)&&same(resource.incumbent_binding,index.native_index_ref.binding)&&['corpus','graph_id','hierarchy_id','identity_policy'].every(key=>resource[key]===resource.incumbent_binding[key]),'incumbent registry/index descriptor differs');
  }else{
    const registry=resource.native_registry;
    check(resource.status==='CURRENT_NATIVE_RESOURCE_EXPLICIT'&&c.corpus==='cib'&&typeof resource.resource_id==='string'&&resource.resource_id&&index.resource_id===resource.resource_id&&index.native_index_ref.resource_id===resource.resource_id&&index.native_index_ref.path==='src-demo-day/'+index.path&&safeRef(index.native_index_ref.manifest)&&HASH.test(resource.native_registry_digest)&&index.native_index_ref.registry_digest===resource.native_registry_digest&&registry?.registry_digest===resource.native_registry_digest&&registry.resource_id===resource.resource_id&&['graph_id','hierarchy_id'].every(key=>resource[key]===registry[key]),'current native registry/index descriptor differs');
  }
  const inspectionBinding=freeze({resource_id:resource.resource_id||resource.graph_id,registry_sha256:index.registry_sha256,index_sha256:index.sha256,corpus:c.corpus,graph_id:resource.graph_id,hierarchy_id:resource.hierarchy_id,source_status:resource.status});
  check(same(condition.configuration, native.configuration) && same(receipt.configuration, native.configuration) && native.configuration.source_pipeline_version === LIVE_SOURCE_METHOD && receipt.source_pipeline_sha256 === method.pipeline_sha256 && receipt.source_pipeline_version === LIVE_SOURCE_METHOD && receipt.selected_method === method.method_family, 'selected method/configuration differs');
  check(native.configuration.source_pipeline_sha256===method.pipeline_sha256,'intake source pipeline hash differs from executed pipeline');
  check(condition.config==='llm_readings'&&condition.current_resource_execution===true&&native.configuration.legacy_constructor_executed===false&&native.configuration.legacy_matcher_executed===false&&native.configuration.terminal_ranking===null&&method.fixed_model_outputs_deterministic===true&&method.uncached_model_outputs_bit_reproducible===false&&method.partial_source_search===true,'source method cannot be an old matcher or bit-reproducibility claim');
  const settings = method.pipeline?.settings;
  check(method.pipeline?.version === LIVE_SOURCE_METHOD && method.pipeline.engines?.version === 'private-live-source-runtime/1' && Array.isArray(method.pipeline.engines.files) && method.pipeline.engines.files.length > 0 && method.pipeline.engines.files.every(safeRef) && unique(method.pipeline.engines.files.map(ref => ref.path)), 'actual engine code pins required');
  check(same(settings, receipt.source_check_budgets) && same(settings, native.configuration.source_check_budgets) && settings.model === 'gpt-6.1-sol' && settings.BM25_in_final_source_score === false && settings.truncation === false && settings.automatic_retries === 0 && count(settings.maximum_source_calls) && settings.maximum_source_calls > 0 && settings.maximum_source_calls <= 5 && count(method.source_call_attempts) && method.source_call_attempts <= settings.maximum_source_calls && count(settings.max_fills_per_reading) && settings.max_fills_per_reading > 0 && settings.max_fills_per_reading <= 5 && settings.maximum_readings === 1 && count(settings.maximum_required_atoms) && settings.maximum_required_atoms > 0 && settings.maximum_required_atoms <= 8 && settings.displayed_fills === 5 && settings.rank_formula==='(source_class+.99*(.75*alignment+.25*lexical))/3', 'declared source budgets/method changed');
  check(same(receipt.retrieval, {method: native.configuration.method, passage_budget: native.configuration.retrieval_passage_budget, document_budget: native.configuration.retrieval_document_budget}), 'retrieval budgets changed');
  const fields = {'native.json':'native', 'condition.json':'condition', 'trace.json':'trace', 'sources.json':'sources', 'document-pages.json':'document_pages', 'selected-evidence.json':'selected_evidence', 'receipt.json':'receipt', 'analyst-digest.json':'analyst_digest'};
  check(exact(value.artifacts, Object.keys(fields)), 'artifact inventory differs');
  for (const [filename, field] of Object.entries(fields)) {
    const ref = value.artifacts[filename], raw = tree.raw([field]);
    check(ref.path === 'jobs/' + value.run_id.slice(5) + '/' + filename && HASH.test(ref.sha256) && ref.encoding === 'gzip+base64' && ref.decoded_sha256 === await sha(raw) && ref.decoded_bytes === raw.length && count(ref.wire_bytes) && ref.wire_bytes > 0 && ref.wire_bytes <= 24 * 1024 ** 2, 'artifact logical hash/size/path differs');
  }
  check(same(condition.native_checkpoint, {...value.artifacts['native.json'], path:'native.json'}), 'intake checkpoint differs');
  check(value.trace?.version === 'private-live-source-intake-trace/1' && same(value.trace.paths, []) && same(value.trace.steps, []) && same(value.trace.evidence_inventory, []) && same(value.selected_evidence, []), 'legacy trace cannot acquire source decisions');
  const ids = native.result.inspected_page_ids, pages = new Map();
  check(Array.isArray(ids) && ids.length <= 256 && unique(ids) && exact(value.sources, ids) && Array.isArray(method.source_pages) && method.source_pages.length === ids.length && same(method.source_pages.map(p => p.id), ids), 'all inspected full pages must be retained');
  check(method.method_family===(c.task==='redaction'?'SOURCE_REALIZED_REDACTION_V1':ids.length?(c.task==='hypothesis'?'REVIEWED_H_SOURCE_VIEWS_V5':'REVIEWED_M_SOURCE_ACCOUNTS_V3_V4'):'REVIEWED_SOURCE_ACCOUNTS'),'unknown selected source engine family');
  const allowedDay = date => day(date) && (admission.inclusive ? date <= c.date : date < c.date);
  const validatePage = async (page, provenance=false) => {
    check(object(page) && typeof page.id === 'string' && page.id && typeof page.document_id === 'string' && page.document_id && page.corpus === c.corpus && page.permitted === true && ['earlier','both'].includes(page.visibility) && allowedDay(page.date) && typeof page.text === 'string' && page.text.trim() && (provenance||Array.from(page.text).length <= 24000) && await textSHA(page.text) === page.source_sha256, 'source page/date/hash/visibility changed');
    check(page.earlier_page==null||Number.isSafeInteger(page.earlier_page)&&page.earlier_page>0,'positive integer source page locator required');
    if(page.raw_text_sha256!==undefined)check(page.raw_text_sha256===await sha(new TextEncoder().encode(page.text)),'raw UTF8 source hash differs');
    check(c.corpus === 'cib' || page.classification === 'CONFIDENTIAL' && page.document_id !== c.document_id && !/\bNOFORN\b|\bNO\s+FOREIGN\s+DISSEM(?:INATION)?\b/i.test([page.text, ...array(page.handling)].join(' ')), 'cable whole-origin/classification/handling veto');
  };
  for (const page of method.source_pages) {
    await validatePage(page); const supplied = value.sources[page.id];
    check(Object.keys(supplied).every(key => same(supplied[key], page[key] ?? null)), 'envelope/source-method page differs'); pages.set(page.id, page);
  }
  if(settings.source_pool==='BOUNDED_RETRIEVAL_ORDER_COMPLETE_ELIGIBLE_PAGES'){
    const schedule=native.retrieval?.live_source_schedule,budget=method.processing_budget;
    check(count(settings.source_page_budget)&&settings.source_page_budget>0&&settings.source_page_budget<=2&&count(settings.source_full_text_utf8_budget)&&settings.source_full_text_utf8_budget>0&&settings.source_full_text_utf8_budget<=8000,'declared whole-page pool budgets required');
    check(schedule?.version==='private-live-source-schedule/1'&&Array.isArray(schedule.original_page_ids)&&unique(schedule.original_page_ids)&&schedule.original_pages===schedule.original_page_ids.length&&same(schedule.selected_page_ids,ids)&&schedule.selected_pages===ids.length&&ids.length<=settings.source_page_budget&&schedule.page_budget===settings.source_page_budget&&schedule.full_text_utf8_budget===settings.source_full_text_utf8_budget&&schedule.raw_pages_clipped===false&&schedule.no_evidence_claim_for_unprocessed===true&&schedule.gold_or_saved_ranks_used===false,'bound source-pool schedule changed');
    const unprocessed=array(schedule.unprocessed_pages);check(unprocessed.every(p=>p.status==='UNPROCESSED'&&HASH.test(p.source_sha256))&&unique([...ids,...unprocessed.map(p=>p.page_id)])&&same([...ids,...unprocessed.map(p=>p.page_id)].sort(),[...schedule.original_page_ids].sort()),'every scheduled page needs exact-once accounting');
    const bytes=[...pages.values()].reduce((sum,page)=>sum+new TextEncoder().encode(page.text).length,0);check(schedule.selected_utf8_bytes===bytes&&bytes<=settings.source_full_text_utf8_budget,'whole-page UTF8 budget changed');
    const unprocessedReadings=method.readings.filter(b=>['UNPROCESSED_READING_BUDGET','UNPROCESSED_SOURCE_BUDGET'].includes(b.status)).map(b=>b.reading.id);
    check(same(method.source_pool_scope,{...schedule,unprocessed_reading_ids:unprocessedReadings})&&same(view.source_pool_scope,method.source_pool_scope)&&same(view.processing_budget,budget),'view/source processing scope changed');
    check(budget?.version==='private-live-source-processing-budget/1'&&budget.task===c.task&&typeof budget.available_after_planning_usd==='number'&&Number.isFinite(budget.available_after_planning_usd)&&budget.available_after_planning_usd>=0&&budget.digest_earmark_usd===.07&&budget.digest_time_earmark_seconds===25&&budget.maximum_model_stages===(c.task==='redaction'?5:3)&&budget.digest_body_bytes_limit===24576&&budget.existing_job_and_shared_caps_unchanged===true&&budget.earmark_is_not_a_paid_ledger_reservation===true&&budget.full_completion_guaranteed===false,'declared source/digest processing budget differs');
  }else check(false,'explicit bounded source pool policy required');
  check(Array.isArray(view.source_pages) && view.source_pages.length === ids.length, 'view page inventory changed');
  for (const [index, page] of view.source_pages.entries()) {
    const source = pages.get(ids[index]);
    check(page.page_id === source.id && page.canonical_page_id === source.id && page.document_id === source.document_id && page.corpus === source.corpus && page.date === source.date && page.page_sha256 === source.source_sha256 && page.clipped === false && same(page.windows, [{start:0,end:Array.from(source.text).length,text:source.text}]), 'view page is not the retained full page');
    const metadata = Object.fromEntries(['earlier_page','later_page','physical_page','source_page','native_page','view'].filter(key => Object.hasOwn(source,key)).map(key => [key,source[key]]));
    check(same(page.original_page_metadata, metadata), 'view page metadata changed');
  }
  let provenanceCount = 0,provenanceBytes=0;
  const documents = new Set([...pages.values()].map(page => page.document_id));
  check(object(value.document_pages), 'document provenance inventory required');
  for (const [documentId, inventory] of Object.entries(value.document_pages)) {
    check(documents.has(documentId) && Array.isArray(inventory) && inventory.length > 0 && unique(inventory.map(p => p.id)), 'unbound provenance document');
    for (const [index,page] of inventory.entries()) {
      provenanceBytes+=tree.raw(['document_pages',documentId,index]).length;
      check(++provenanceCount <= 1024 && provenanceBytes<=8*1024**2 && page.document_id === documentId && page.provenance_only === true && page.inspection_not_implied === true, 'document provenance is not inspection'); await validatePage(page,true);
      if (pages.has(page.id)) check(Object.keys(value.sources[page.id]).every(key => same(page[key], value.sources[page.id][key])), 'provenance and inspected page conflict');
    }
  }
  const citations = new Set(), citationKey = ref => JSON.stringify([ref.canonical_page_id,ref.start,ref.end,ref.text]);
  const span = (page, ref, permitOpaque = false) => {
    check(object(ref) && Number.isSafeInteger(ref.start) && Number.isSafeInteger(ref.end) && ref.start >= 0 && ref.end > ref.start && ref.end <= Array.from(page.text).length && Array.from(page.text).slice(ref.start,ref.end).join('') === ref.text && (permitOpaque || !opaque.test(ref.text)), 'source span/qualification does not replay'); return ref;
  };
  const replay = ref => {
    const page = pages.get(ref?.canonical_page_id);
    check(page && ref.document_id === page.document_id && ref.corpus === page.corpus && ref.date === page.date && ref.page_sha256 === page.source_sha256 && ref.earlier_page === (page.earlier_page ?? null) && ref.source_edition === undefined && ref.physical_page === undefined, 'citation borrows another page/version'); span(page,ref); citations.add(ref); return ref;
  };
  const citeSpan = (pageId, ref) => {
    const page = pages.get(pageId); check(page, 'own page required'); span(page,ref);
    const result = {canonical_page_id:page.id,document_id:page.document_id,date:page.date,start:ref.start,end:ref.end,text:ref.text,page_sha256:page.source_sha256,earlier_page:page.earlier_page??null,corpus:page.corpus}; citations.add(result); return result;
  };
  const publicAtoms = array(native.plan.atoms).map(atom => Object.fromEntries(['id','text','kind','required','polarity','modality','query_spans'].filter(key => Object.hasOwn(atom,key)).map(key => [key,atom[key]])));
  check(publicAtoms.length > 0 && publicAtoms.length <= settings.maximum_required_atoms && unique(publicAtoms.map(atom => atom.id)) && same(publicAtoms, method.atoms_full) && same(publicAtoms, view.atoms_full), 'full public fact inventory changed');
  for (const atom of publicAtoms) {
    check(typeof atom.id === 'string' && typeof atom.text === 'string' && Array.isArray(atom.query_spans) && atom.query_spans.length > 0, 'public fact/span required');
    atom.query_spans.forEach(ref => span({text:c.query}, ref, true));
  }
  if(c.task==='redaction'){const packet=native.plan.readings_packet;check(packet?.version==='next-slot-readings/3'&&packet.status==='ready'&&packet.query_only===true&&packet.source_access===false&&packet.answer_text_supplied===false&&packet.query_sha256===querySHA&&packet.case_sha256===await sha(tree.raw(['native','public_case']))&&Array.isArray(packet.readings)&&packet.readings.length>0&&packet.readings.length<=16&&unique(packet.readings.map(r=>r.id)),'public declared-reading binding changed');}
  for (const key of ['atoms','readings','trace','digest']) check(same(view[key], method[key]), 'method/view ' + key + ' differs');
  check(same(view.assessment_scope, method.assessment_scope ?? null) && same(view.selected_reading_id, method.selected_reading_id ?? null), 'method/view scope/selection differs');
  await validateDecisions(method, native, settings, pages, publicAtoms, replay, citeSpan, querySHA);
  check(array(method.provider_receipts).every(proof=>array(receipt.provider_receipts).some(row=>row.ref==='receipts/'+proof.call_id+'.json'&&row.status==='PASS'&&row.model===proof.model&&HASH.test(row.request_sha256)&&typeof row.charged_or_reserved_usd==='number'&&Number.isFinite(row.charged_or_reserved_usd)&&row.charged_or_reserved_usd>=0)),'source provider receipt missing from sealed job receipt');
  await validateDigest(method, tree, mp, replay);
  validateTrace(method, replay);
  check(!signal?.aborted && before === JSON.stringify(envelope) && assertCurrent?.() !== false, 'selection changed during verification');
  freeze(method); const handle = Object.freeze({method_id:LIVE_SOURCE_METHOD,run_id:value.run_id,view:method.view,method,inspectionBinding});
  freeze(native);handles.set(handle,{envelope,snapshot:before,signal,assertCurrent,method,native,pages,citations,citeSpan,citationKey,inspectionBinding}); envelopes.set(envelope,handle); return handle;
}

async function validateDecisions(method, native, settings, pages, facts, replay, citeSpan, querySHA) {
  const c = method.public_case;
  if(!pages.size){
    const original=native.retrieval?.live_source_schedule?.original_pages??0;
    check(method.status===(original?'SOURCE_BUDGET_HOLD_UNPROCESSED':'NO_ELIGIBLE_INSPECTED_SOURCES')&&same(method.source_judgments??[],[])&&method.source_call_attempts===0&&same(method.provider_receipts,[])&&method.digest?.available===false&&method.source_search_complete===false,'empty or budget-held source pool cannot create findings');
    if(c.task==='redaction'){const declared=array(native.plan.readings_packet?.readings);check(same(method.atoms,facts)&&method.selected_reading_id===null&&method.selection_rule==='FIRST_NONEMPTY_DECLARED_READING_NOT_QA_ORACLE'&&method.readings.length===declared.length&&method.readings.every((b,i)=>b.reading.id===declared[i].id&&Object.keys(b.reading).every(key=>same(b.reading[key],declared[i][key]))&&same(b.candidates,[])&&same(b.top5_ids,[])&&b.status==='UNPROCESSED_SOURCE_BUDGET'),'empty R must retain unprocessed declared readings');}
    else{const required=facts.filter(f=>f.required&&f.kind==='proposition');check(same(method.readings,[])&&method.atoms.length===required.length&&method.atoms.every((a,i)=>a.id===required[i].id&&a.text===required[i].text&&same(a.query_spans,required[i].query_spans)&&a.status==='UNRESOLVED'&&same(a.evidence,[])&&a.complete_by_source_review===(c.task==='hypothesis'?null:false))&&method.assessment_scope?.original_slots===original*required.length&&method.assessment_scope.processed_slots===0&&method.assessment_scope.unprocessed_slots===original*required.length&&method.coverage===(c.task==='hypothesis'?null:0),'empty M/H must retain unresolved components and unprocessed denominator');}
    return;
  }
  if (c.task === 'redaction') {
    check(same(method.atoms,facts) && method.selection_rule === 'FIRST_NONEMPTY_DECLARED_READING_NOT_QA_ORACLE', 'R facts/selection rule changed');
    const declared = array(native.plan.readings_packet?.readings);
    check(Array.isArray(method.readings) && method.readings.length === declared.length && method.readings.every((b,i) => b.reading.id===declared[i].id&&Object.keys(b.reading).every(key=>same(b.reading[key],declared[i][key]))), 'all projected declared readings must survive');
    let processed = 0; const allIds = [];
    for (const branch of method.readings) {
      const candidates = branch.candidates;
      check(Array.isArray(candidates) && candidates.length <= settings.max_fills_per_reading && same(branch.top5_ids,candidates.slice(0,5).map(row=>row.id)), 'R retained/top-five inventory changed');
      if (branch.status === 'UNPROCESSED_READING_BUDGET') { check(!candidates.length, 'unprocessed reading has candidates'); continue; }
      check(++processed <= settings.maximum_readings, 'reading budget exceeded');
      for (const [index,row] of candidates.entries()) {
        allIds.push(row.id); const source = row.source, page = pages.get(source?.page_id);
        check(typeof row.id === 'string' && row.rank === index+1 && typeof row.fill === 'string' && row.fill && row.reading_id === branch.reading.id && same(row.reading,branch.reading) && row.provenance === 'CORPUS' && row.native_candidate_created === false && row.whole_visible_event_certified === false && row.calibrated_probability === false, 'R identity/rank/provenance changed');
        check(page && source.document_id === page.document_id && source.page_sha256 === page.source_sha256, 'R own source changed');
        replay(source.citation); for (const ref of [source.quote,source.phrase,source.qualification]) citeSpan(source.page_id,ref);
        check(same([source.citation.start,source.citation.end,source.citation.text],[source.quote.start,source.quote.end,source.quote.text]) && source.qualification.start <= source.quote.start && source.qualification.end >= source.quote.end && source.phrase.start >= source.quote.start && source.phrase.end <= source.quote.end, 'R phrase/quote/full qualification relation changed');
        check(exact(row.transformation,['kind','description']) && ['UNCHANGED','INFLECTION','PARAPHRASE'].includes(row.transformation.kind) && typeof row.transformation.description === 'string', 'unknown source transformation');
        check(c.focal_marker && c.query.split(c.focal_marker).length === 2 && row.completed_input === c.query.replace(c.focal_marker,row.fill) && row.grammar?.eligible === true && row.grammar.factual_support_certified === false && row.grammar.native_DTO_or_POS_license_created === false && row.grammar.holds?.length === 0 && row.grammar.completed_input_sha256 === await textSHA(row.completed_input) && row.grammar.reading_sha256 === await sha(asciiStable(branch.reading)), 'completed insertion/local grammar binding changed');
        const proposalReview=row.contextual_proposal_review;
        check(proposalReview?.decision==='ACCEPT_CONTEXTUAL'&&proposalReview.source_fidelity==='FAITHFUL'&&proposalReview.category==='FITS'&&proposalReview.grammar==='FITS'&&proposalReview.context==='RELEVANT'&&proposalReview.unknown_mask_inferred===false&&proposalReview.qualifications_preserved===true&&(row.score_formula===undefined||row.score_formula===settings.rank_formula),'source realization/grammar review differs');
        const cls = row.evidence_class, focal = row.raw_focal_assessment, label = row.source_focal_class;
        check([0,1,2].includes(cls) && row.source_supported_fill_approved === (cls===2) && unit(row.priority_index) && unit(row.source_alignment_index), 'R source class/priority changed');
        if (focal) {
          check(focal.candidate_id === row.id && focal.source_page_union_used === false && focal.assessment?.source_ascription_only === true && focal.assessment.visible_query_event_certified === false && focal.assessment.cross_document_event_join_used === false, 'R focal scope changed');
          let requested=0,matched=0; const weights={actor:.18,relation_property:.20,role_argument:.15,issue:.15,time:.06,quantity:.08,polarity:.06,modality:.05,qualification:.04,attribution:.03};
          check(exact(focal.assessment.facets,Object.keys(weights)), 'R full focal facets required');
          const anchors = new Map(array(focal.bound_source_anchors).map(anchor=>[anchor.id,anchor]));
          check(anchors.size===array(focal.bound_source_anchors).length, 'duplicate focal anchor');
          for(const anchor of anchors.values()){check(anchor.page_id===source.page_id,'cross-page focal borrowing');citeSpan(source.page_id,{...anchor,text:anchor.quote});}
          for(const [key,facet]of Object.entries(focal.assessment.facets)){
            check(['MATCHED','CONFLICTING','INFERRED','MISSING','NOT_REQUESTED'].includes(facet.status),'unknown focal facet');
            if(facet.status==='NOT_REQUESTED')continue; requested+=weights[key];
            if(['MATCHED','CONFLICTING'].includes(facet.status)){matched+=weights[key];check(array(facet.source_anchor_ids).length>0&&facet.source_anchor_ids.every(id=>anchors.has(id)),'unbound focal facet');}
          }
          check(requested>0&&near(focal.requested_weight,requested)&&near(focal.aligned_requested_weight,matched)&&near(focal.alignment,matched/requested)&&near(row.alignment,focal.alignment),'R focal alignment differs');
          check(cls!==(2)||label==='DIRECT_TARGET_SOURCE'&&focal.assessment.decision===label&&focal.assessment.material_fill_constraints_complete===true&&Object.values(focal.assessment.facets).every(f=>['MATCHED','NOT_REQUESTED'].includes(f.status)),'direct class lacks complete matched contribution');
          check(cls!==1||label==='INFERENTIAL_CONTEXT','context class changed');
          check(unit(row.local_lexical_fit)&&near(row.source_alignment_index,['HOLD','NOINFO'].includes(label)?0:.75*row.alignment+.25*row.local_lexical_fit),'R alignment/lexical formula differs');
        } else check(cls===0&&row.source_alignment_index===0&&row.priority_index===0&&!row.source_supported_fill_approved,'unreviewed R candidate promoted');
        check(near(row.priority_index,(cls+.99*row.source_alignment_index)/3),'R priority formula differs');
        if(index)check(candidates[index-1].priority_index>=row.priority_index,'R priority order changed');
      }
    }
    check(unique(allIds),'duplicate candidate identity');
    check(method.status===(method.readings.some(branch=>branch.candidates.length)?'SOURCE_SUGGESTIONS_RECORDED':'UNRESOLVED')&&method.source_page_union_used_for_candidate_support===false,'R method status/source scope changed');
    const selected=method.readings.find(branch=>branch.candidates.length)?.reading.id??method.readings[0]?.reading.id??null;
    check(method.selected_reading_id===selected||method.selected_reading_id===null&&method.readings.every(branch=>!branch.candidates.length),'R selected reading changed'); return;
  }
  facts=facts.filter(fact=>fact.required!==false);
  check(facts.length>0&&same(method.readings,[]) && Array.isArray(method.atoms) && method.atoms.length===facts.length && method.atoms.every((atom,i)=>atom.id===facts[i].id&&atom.text===facts[i].text&&same(atom.query_spans,facts[i].query_spans)),'required M/H component inventory changed');
  const rows=array(method.source_judgments), matrix=new Set(), hypothesis=c.task==='hypothesis';
  for(const row of rows){
    const fact=facts.find(f=>f.id===row.fact_id),page=pages.get(row.page_id),key=row.fact_id+'\0'+row.page_id;
    check(fact&&page&&!matrix.has(key)&&row.document_id===page.document_id&&row.date===page.date&&row.page_sha256===page.source_sha256,'M/H slot/source identity changed');matrix.add(key);
    check(['SUPPORT','OPPOSE','PARTIAL','CONTEXT','HOLD','NONE','REJECTED_ROW'].includes(row.effective_direction)&&unit(row.context_priority_index)&&row.inner_execution===false&&row.event_join_authority===false&&row.world_truth===false,'M/H direction/authority changed');
    if(row.citation){replay(row.citation);replay(row.qualification_citation);const env=row.qualification_envelope;check(env&&same(env.raw_quote_span,{start:row.citation.start,end:row.citation.end,text:row.citation.text})&&same(env.paragraph,{start:row.qualification_citation.start,end:row.qualification_citation.end,text:row.qualification_citation.text})&&env.paragraph.start<=env.raw_quote_span.start&&env.paragraph.end>=env.raw_quote_span.end,'M/H qualification envelope changed');check(env.full_page?.start===0&&env.full_page.end===Array.from(page.text).length&&env.full_page.text===page.text&&env.full_page.sha256===page.source_sha256,'M/H full page context changed');}
    const accepted=['SUPPORT','OPPOSE','PARTIAL','CONTEXT'].includes(row.effective_direction);
    if(accepted)check(row.unanimous_model_accept===true&&row.review?.decision==='ACCEPT'&&row.citation&&row.qualification_citation&&row.raw_model_row?.qualifications_retained===true&&row.raw_model_row?.operators_retained===true&&row.review.qualifications_retained===true&&row.review.operators_retained===true,'source account lacks retained separate review');
    if(['HOLD','NONE','REJECTED_ROW'].includes(row.effective_direction))check(row.context_priority_index===0,'held row has positive score');
    if(row.requested_facet_weights){
      const fields=row.raw_model_row?.fields,weights=row.requested_facet_weights;let denominator=0,aligned=0,literal=0;
      check(object(fields)&&object(weights)&&Object.keys(weights).length>0,'M/H requested facets required');
      const expectedWeights={actors:.18,action:.20,arguments:.15,event_identity:.15,event_time:.06,quantity:.08,polarity:.06,modality:.05,attribution:.03,conditions:.04};
      check(exact(fields,Object.keys(expectedWeights))&&same(Object.keys(weights).sort(),Object.keys(fields).filter(key=>fields[key].state!=='NOT_REQUESTED').sort()),'all requested M/H facets required');
      for(const [key,weight]of Object.entries(weights)){check(weight===expectedWeights[key]&&fields[key]&&fields[key].state!=='NOT_REQUESTED','requested facet/weight mismatch');denominator+=weight;if(fields[key].state==='MATCHED'){literal+=weight;aligned+=weight;}else if(row.effective_direction==='OPPOSE'&&row.unanimous_model_accept===true&&fields[key].state==='CONFLICTING')aligned+=weight;}
      check(near(row.literal_agreement_coverage,literal/denominator)&&near(row.evidence_alignment_coverage,aligned/denominator)&&unit(row.local_lexical_fit?.value),'M/H directional alignment differs');
      check(near(row.context_priority_index,accepted?.75*row.evidence_alignment_coverage+.25*row.local_lexical_fit.value:0),'M/H index formula differs');
    }
    if(hypothesis&&accepted){const raw=row.raw_model_row;check(raw?.attribution&&row.review.direction===row.effective_direction&&raw.qualifications_retained===true&&raw.operators_retained===true,'H source voice/review mismatch');if(raw.attribution.kind==='DOCUMENT_REPORTING_VOICE')check(raw.attribution.speaker_quote===null,'document voice is not a named speaker');}
  }
  for(const atom of method.atoms){
    const own=rows.filter(row=>row.fact_id===atom.id);check(same(atom.evidence,own),'atom borrows another source account');
    for(const row of atom.evidence)if(row.citation){replay(row.citation);replay(row.qualification_citation);}
    const documents=direction=>[...new Set(own.filter(row=>row.effective_direction===direction).map(row=>row.document_id))].sort();
    const support=documents('SUPPORT'),oppose=documents('OPPOSE'),partial=documents('PARTIAL'),context=documents('CONTEXT');
    const status=hypothesis?(support.length||oppose.length?'SOURCE_VIEWS_RECORDED':'UNRESOLVED'):support.length&&oppose.length?'CONFLICTED_SOURCE_ACCOUNTS':support.length?'SOURCE_ASCRIBED':oppose.length?'SOURCE_OPPOSED':partial.length?'PARTIAL_SOURCE_ACCOUNT':context.length?'CONTEXT_ONLY':'UNRESOLVED';
    check(atom.status===status&&same(atom.supporting_source_documents,support)&&same(atom.opposing_source_documents,oppose)&&atom.complete_by_source_review===(hypothesis?null:status==='SOURCE_ASCRIBED'),'M/H status or component completion changed');
    for(const sign of ['SUPPORT','OPPOSE','CONTEXT']){const per={};for(const row of own.filter(r=>r.effective_direction===sign))per[row.document_id]=Math.max(per[row.document_id]??0,row.context_priority_index);const bar=atom.directional_indices?.[sign];check(bar&&same(bar.per_document,per)&&bar.documents===Object.keys(per).length&&near(bar.value,Object.values(per).reduce((a,b)=>a+b,0)),'H document-MAX total differs');}
  }
  const scope=method.assessment_scope,original=native.retrieval?.live_source_schedule?.original_pages??pages.size;
  check(scope&&scope.original_pages===original&&scope.required_facts===facts.length&&scope.original_slots===original*facts.length&&scope.processed_slots===rows.length&&scope.unprocessed_slots===scope.original_slots-rows.length&&scope.partial_search===true,'assessment coverage denominator changed');
  check(scope.provider_reviewed_slots===rows.filter(r=>r.review!=null).length&&scope.accepted_slots===rows.filter(r=>r.unanimous_model_accept===true).length&&scope.held_slots===rows.filter(r=>['HOLD','REJECTED_ROW'].includes(r.effective_direction)).length&&scope.rejected_slots===rows.filter(r=>r.effective_direction==='REJECTED_ROW').length,'assessment held/reviewed counts changed');
  check(scope.inspected_pool_completely_processed===(scope.processed_slots===scope.original_slots)&&scope.inspected_pool_completely_assessed===(scope.processed_slots===scope.original_slots&&scope.held_slots===0),'incomplete source coverage was promoted');
  check(method.coverage===(hypothesis?null:method.atoms.filter(a=>a.complete_by_source_review).length/method.atoms.length),'H coverage is null; M coverage is not an averaged score');
  check(method.status===(hypothesis&&method.atoms.some(a=>a.status==='SOURCE_VIEWS_RECORDED')?'SOURCE_VIEWS_RECORDED':!hypothesis&&method.atoms.every(a=>a.complete_by_source_review)?'SOURCE_COMPONENTS_COMPLETE':'PARTIAL_SEARCH_UNRESOLVED')&&method.counts_are_independent_votes===false,'M/H method status/volume changed');
}

const asciiStable = value => ascii(stable(value));
async function validateDigest(method, tree, path, replay) {
  const digest=method.digest;check(object(digest)&&digest.used_for_inference===false&&typeof digest.available==='boolean','typed postrun digest required');
  const receipts=method.provider_receipts;check(Array.isArray(receipts)&&receipts.length<=method.source_call_attempts&&unique(receipts.map(r=>r.call_id))&&receipts.every(r=>r.kind==='MODEL_SEMANTIC_JUDGMENT'&&/^[a-f0-9]{32}$/.test(r.call_id)&&r.model==='gpt-6.1-sol'&&['request_ref','response_ref','provider_receipt_ref'].every(k=>safeRef(r[k]))),'provider receipt identities malformed');
  if(!digest.available)return;
  const input=digest.input,binding=input?.binding,dp=[...path,'digest'];
  check(digest.version==='live-selected-reviewed-source-digest/1'&&typeof digest.text==='string'&&digest.text.trim().split(/\s+/u).length>=50&&digest.text.trim().split(/\s+/u).length<=100&&digest.input_sha256===await sha(tree.raw([...dp,'input']))&&same(digest.sources,input.sources),'digest text/input/hash differs');
  check(same(input.public_case,method.public_case)&&input.method?.id===LIVE_SOURCE_METHOD&&input.method.native_method===false&&input.method.label===method.method_family&&same(input.source_policy,method.source_view_policy)&&input.postrun===true&&input.used_for_inference===false&&input.unchanged_native_is_not_primary_method===true,'digest belongs to another method/case');
  check(binding?.case_sha256===await sha(tree.raw([...path,'public_case']))&&binding.native_checksum===method.native_checksum&&binding.resource_binding_sha256===await sha(tree.raw([...path,'resource_binding']))&&binding.pipeline_sha256===method.pipeline_sha256&&binding.source_policy_sha256===await sha(tree.raw([...path,'source_view_policy']))&&binding.citation_map_sha256===await sha(tree.raw([...dp,'sources'])),'digest binding differs');
  check(same(receipts.at(-1),digest.receipt)&&digest.receipt.stage==='assessment','digest requires its own final retained provider receipt');
  const known=new Map();
  for(const [i,source]of digest.sources.entries()){
    check(source.id==='S'+(i+1)&&!known.has(source.id)&&Array.isArray(source.citations)&&source.citations.length>0,'ordered unique S map required');const ids=new Set();
    source.citations.forEach((item,j)=>{check(item.id==='C'+(j+1)&&!ids.has(item.id),'ordered unique C map required');ids.add(item.id);replay(item.citation);check(['corpus','document_id','date','canonical_page_id','page_sha256','earlier_page'].every(k=>source[k]===item.citation[k])&&source.source_edition===undefined&&source.physical_page===undefined,'S map changes cited source');});known.set(source.id,source);
  }
  check(unique(digest.sources.map(s=>s.canonical_page_id)),'one S identity per page');
  for(const match of digest.text.matchAll(/\bS(\d+)\b/g))check(known.has('S'+match[1]),'digest cites an unknown source');
  const visit=value=>{if(Array.isArray(value)){value.forEach(visit);return;}if(!object(value))return;if(Object.hasOwn(value,'source_id')){const source=known.get(value.source_id);check(source?.citations.some(c=>c.id===value.citation_id),'digest input cites an unknown S/C pair');}Object.values(value).forEach(visit);};visit(input);
  const citation=reference=>known.get(reference?.source_id)?.citations.find(c=>c.id===reference.citation_id)?.citation;
  const matchesSpan=(ref,pageId,span)=>{const c=citation(ref);return c&&c.canonical_page_id===pageId&&c.start===span.start&&c.end===span.end&&c.text===span.text;};
  check(same(input.assessment_scope,method.assessment_scope??{})&&input.distinct_documents_are_not_independent_votes===true&&input.source_dates_not_automatically_event_dates===true&&input.indices_are_source_context_not_probabilities===true,'digest scope/source interpretation differs');
  if(method.public_case.task==='redaction'){
    check(input.kind==='SOURCE_REALIZED_REDACTION'&&same(input.facts,method.atoms)&&same(input.readings.map(b=>({reading:b.reading,top5_ids:b.top5_ids,ids:b.candidates.map(c=>c.id)})),method.readings.map(b=>({reading:b.reading,top5_ids:b.top5_ids,ids:b.candidates.map(c=>c.id)})))&&input.selection?.reading_id===method.selected_reading_id&&input.selection.rule===method.selection_rule,'digest lost a reading/candidate');
    input.readings.forEach((branch,i)=>branch.candidates.forEach((row,j)=>{const original=method.readings[i].candidates[j],source=original.source;check(['id','fill','completed_input','rank'].every(key=>row[key]===original[key])&&same(row.transformation,original.transformation)&&row.evidence_state===original.source_focal_class&&row.source_ascribed_fill_approved===original.source_supported_fill_approved&&row.priority_index===fixed4(original.priority_index)&&row.whole_visible_event_certified===false,'digest candidate differs from selected source method');check(same(citation(row.quote),source.citation)&&matchesSpan(row.phrase,source.page_id,source.phrase)&&matchesSpan(row.full_qualification,source.page_id,source.qualification),'digest candidate changes its quote/phrase/qualification');const anchors=array(original.raw_focal_assessment?.bound_source_anchors);check(row.focal_sources.length===anchors.length&&row.focal_sources.every((ref,k)=>matchesSpan(ref,source.page_id,{...anchors[k],text:anchors[k].quote})),'digest candidate changes its own focal anchors');}));
  }else{
    check(input.kind==='REVIEWED_SOURCE_METHOD'&&same(input.current_result?.components.map(a=>[a.id,a.text,a.decision,a.query_spans,a.source_component_complete]),method.atoms.map(a=>[a.id,a.text,a.status,a.query_spans,a.complete_by_source_review]))&&input.current_result.required===method.atoms.length&&input.current_result.source_account_coverage===method.coverage&&input.current_result.source_components_complete===(method.coverage===null?null:method.atoms.filter(a=>a.complete_by_source_review).length),'digest result differs from current source method');
    input.current_result.components.forEach((component,i)=>{const rows=method.atoms[i].evidence.filter(r=>!['HOLD','REJECTED_ROW','NONE'].includes(r.effective_direction)&&r.citation);check(component.accounts.length===rows.length,'digest source-account inventory changed');component.accounts.forEach((account,j)=>{const row=rows[j],raw=row.raw_model_row;check(account.judgment_id===(row.appraisal_id??row.observation_row_id)&&account.direction===row.effective_direction&&same(citation(account.quote),row.citation)&&same(citation(account.qualification),row.qualification_citation)&&same(account.attribution,raw.attribution??null)&&same(account.kind,raw.kind??null)&&same(account.mode,raw.mode??null)&&same(account.qualifier_quotes,raw.qualifier_quotes??[])&&same(account.argument_quote,raw.argument_quote??null)&&same(account.facet_states,Object.fromEntries(Object.entries(raw.fields).map(([key,value])=>[key,value.state])))&&account.source_alignment_index===fixed4(row.context_priority_index)&&account.review_reason===row.review.reason,'digest source account changes actual voice/qualification/direction');});});
  }
}

function validateTrace(method,replay){
  const trace=method.trace;check(trace?.version==='private-live-source-account-trace/1'&&trace.source_only_paths===true&&trace.native_graph_trace_unchanged===true&&trace.world_event_or_identity_authority===false&&Array.isArray(trace.paths)&&unique(trace.paths.map(p=>p.id)),'source-only trace required');
  const expected=[];
  for(const branch of method.readings)for(const c of branch.candidates)expected.push({candidate_id:c.id,reading_id:c.reading_id,refs:[c.source.citation],mode:'SOURCE_DOCUMENT_EXCERPT_TRANSFORMATION_FILL',transformation:c.transformation});
  for(const row of array(method.source_judgments))if(row.citation)expected.push({atom_id:row.fact_id,refs:[row.citation,row.qualification_citation],mode:'SOURCE_DOCUMENT_EXCERPT_REVIEWED_ACCOUNT',direction:row.effective_direction});
  check(trace.paths.length===expected.length,'source trace inventory changed');
  trace.paths.forEach((p,i)=>{const e=expected[i];check(p.semantic_graph_edge_inferred===false&&p.route_mode===e.mode&&same(p.source_refs,e.refs)&&p.candidate_id===e.candidate_id&&p.reading_id===e.reading_id&&p.atom_id===e.atom_id&&p.direction===e.direction&&same(p.transformation,e.transformation),'source trace borrows a result or invents an edge');p.source_refs.forEach(replay);});
}

export function liveSourceSummary(value,{selectedReadingId}={}) {
  const {method}=bound(value),task=method.public_case.task;
  if(task==='redaction'){const id=selectedReadingId??method.selected_reading_id??method.readings[0]?.reading.id,branch=method.readings.find(b=>b.reading.id===id),approved=array(branch?.candidates).filter(c=>c.source_supported_fill_approved).length;return {method_id:LIVE_SOURCE_METHOD,title:approved?'Evidence-backed source suggestions':branch?.candidates.length?'Contextual source suggestions':'Source suggestions unresolved',tone:approved?'supported':'unresolved',direct_candidates:approved,native_method:false,world_truth_certified:false};}
  if(task==='hypothesis')return {method_id:LIVE_SOURCE_METHOD,title:method.status==='SOURCE_VIEWS_RECORDED'?'Source views recorded':'Source views unresolved',tone:'mixed',coverage:null,native_method:false,world_truth_certified:false};
  const complete=method.atoms.filter(a=>a.complete_by_source_review===true).length;
  return {method_id:LIVE_SOURCE_METHOD,title:complete+' / '+method.atoms.length+' source components supported',tone:complete===method.atoms.length?'supported':'partial',complete,total:method.atoms.length,native_method:false,world_truth_certified:false};
}

// Exact counterpart of matryoshka_current.reporting.resource_binding; never
// replace the sealed condition's registry-corpus descriptor with this UI bridge.
export function liveSourceInspectionBinding(value){return bound(value).inspectionBinding;}

export function normalizeLiveSourceMethod(value,{selectedReadingId}={}) {
  const state=bound(value),{method,citeSpan}=state,c=method.public_case;
  const sourceLinks=[],proofMetadata=[],allowedProofs=[...state.citations],facts=method.atoms_full;
  const retain=(proof,factIds,direction)=>{sourceLinks.push({factId:factIds[0]??null,itemId:factIds[0]??null,proof,direction,basis:'RECORDED_SOURCE_ASSESSMENT',source_graph_edge:false});proofMetadata.push({proof,atom_ids:factIds,direction});return proof;};
  const makeR=branch=>{
    const proofs=[],links=[];
    const marker=c.focal_marker,start=Array.from(c.query.slice(0,c.query.indexOf(marker))).length,end=start+Array.from(marker).length;
    const focalFacts=facts.filter(fact=>fact.text.includes(marker)||array(fact.query_spans).some(span=>span.start<end&&span.end>start));
    const candidates=branch.candidates.map(row=>{const source=row.source,quote=source.citation,qualification=citeSpan(source.page_id,source.qualification);proofs.push(quote,qualification);for(const fact of focalFacts){links.push({factId:fact.id,itemId:row.id,proof:quote,direction:'CONTEXT',basis:'RECORDED_SOURCE_PROPOSAL_FOR_FOCAL_READING',source_graph_edge:false});proofMetadata.push({proof:quote,atom_ids:[fact.id],direction:'CONTEXT'});}return {id:row.id,rank:row.rank,fill:row.fill,priority:row.priority_index,label:row.source_supported_fill_approved?'Evidence-backed source suggestion':row.evidence_class===1?'Contextual source suggestion':row.source_focal_class==='EXPLICIT_CONFLICT'?'Source conflict':'Source appraisal held',proofs:[quote,qualification],sourceWord:source.phrase.text,sourceSpan:source.phrase,details:{completed_input:row.completed_input,transformation:row.transformation,source_class:row.source_focal_class,grammar:row.grammar,full_qualification:source.qualification.text}};});
    const emptyReason=branch.status==='UNPROCESSED_READING_BUDGET'?'This declared reading was not processed under the recorded source budget.':branch.status==='UNPROCESSED_SOURCE_BUDGET'?'This declared reading has no processed source pages; see the recorded source scope.':branch.status==='NO_ELIGIBLE_INSPECTED_SOURCES'?'No eligible inspected source pages were retained for this reading.':'No admitted source-derived fills were retained for this declared reading.';
    return {id:branch.reading.id,label:[branch.reading.outer_family,branch.reading.role].filter(Boolean).join(' / ').replaceAll('_',' '),explanation:[branch.reading.explanation,candidates.length?'':emptyReason].filter(Boolean).join(' '),candidates,proofs,sourceLinks:links,graphItems:candidates.map(c=>({id:c.id})),nativeCandidates:[]};
  };
  const branches=method.readings.length?method.readings:c.task==='redaction'?array(state.native.plan.readings_packet?.readings).map(reading=>({reading,candidates:[],top5_ids:[],status:'NO_ELIGIBLE_INSPECTED_SOURCES'})):[];
  const readings=c.task==='redaction'?branches.map(makeR):[];
  const readingId=selectedReadingId??method.selected_reading_id??readings[0]?.id??null;
  if(c.task==='redaction')check(readings.some(r=>r.id===readingId)||!readings.length&&readingId==null,'choose a declared Live reading');
  const selected=readings.find(r=>r.id===readingId);
  const relatedProofs=[],units=c.task==='redaction'?[]:method.atoms.map(atom=>{
    const eligible=array(atom.evidence).filter(row=>['SUPPORT','OPPOSE','PARTIAL','CONTEXT'].includes(row.effective_direction)&&row.citation),decisive=eligible.filter(row=>row.effective_direction!=='CONTEXT'),primary=decisive.length?decisive:eligible;
    const proofs=[];
    for(const row of eligible){const refs=[row.citation,row.qualification_citation];if(primary.includes(row)){refs.forEach(proof=>proofs.push(retain(proof,[atom.id],row.effective_direction)));}else relatedProofs.push(...refs);}
    const scores=primary.map(row=>row.context_priority_index);
    return {id:atom.id,text:atom.text,label:({SOURCE_ASCRIBED:'Supported source account',PARTIAL_SOURCE_ACCOUNT:'Partial source account',SOURCE_OPPOSED:'Opposing source account',CONFLICTED_SOURCE_ACCOUNTS:'Conflicting source accounts',CONTEXT_ONLY:'Context only',UNRESOLVED:'Unresolved',SOURCE_VIEWS_RECORDED:'Source views recorded'})[atom.status]||'Unresolved',status:atom.status,score:scores.length?Math.max(...scores):null,proofs,directionalTotals:{SUPPORT:atom.directional_indices?.SUPPORT.value??0,OPPOSE:atom.directional_indices?.OPPOSE.value??0},evidence:primary.map(row=>({proof:row.citation,direction:row.effective_direction,score:row.context_priority_index,voice:row.source_attribution?.speaker_quote||row.raw_model_row?.attribution?.speaker_quote||''})),details:{assessment_scope:method.assessment_scope,full_qualifications:eligible.map(row=>row.qualification_citation),stored_status:atom.status}};
  });
  const proofs=c.task==='redaction'?(selected?.proofs??[]):units.flatMap(unit=>unit.proofs);
  const distinct=values=>[...new Map(values.map(proof=>[state.citationKey(proof),proof])).values()];
  return {task:c.task,caseInfo:c,facts,readings,selectedReadingId:readingId,summary:liveSourceSummary(value,{selectedReadingId:readingId}),candidates:selected?.candidates??[],units,proofs:distinct(proofs),relatedProofs:distinct(relatedProofs),proofMetadata,sourceLinks:c.task==='redaction'?(selected?.sourceLinks??[]):sourceLinks,graphItems:c.task==='redaction'?(selected?.graphItems??[]):units.map(u=>({id:u.id})),nativeCandidates:[],allowedProofs:[...allowedProofs,...state.citations],sourcePolicy:method.source_view_policy,method_id:LIVE_SOURCE_METHOD,inspectionBinding:state.inspectionBinding,resourceBinding:state.inspectionBinding};
}

export function liveSourceAccountMap(value,selectedReadingId) {
  const data=normalizeLiveSourceMethod(value,{selectedReadingId}),paths=data.sourceLinks.map((link,index)=>({id:'live-source-account-'+index,candidate_or_atom_id:data.task==='redaction'?data.selectedReadingId+'/'+link.itemId:link.itemId,query_atom_id:link.factId,direction:link.direction,steps:[],graph_hops:0,route_mode:'DIRECT_SOURCE_HANDOFF',original_traversal_claimed:false,decision_source_refs:[link.proof],source_refs:[link.proof],display_association_basis:link.basis}));
  return {trace:{version:'source-account-presentation-map/1',task:data.task,reading_id:data.selectedReadingId,paths,steps:[],sources:{},original_traversal_claimed:false,source_graph_edges_created:false},plan:{atoms:data.facts},items:data.graphItems,nativeCandidates:[],proofs:data.proofs,sourcePolicy:data.sourcePolicy};
}

export function renderLiveSourceWorkspace(value, options={}) {
  const state=bound(value),data=normalizeLiveSourceMethod(value,{selectedReadingId:options.selectedReadingId});
  const current=()=>{bound(value);check(options.assertCurrent?.()!==false&&options.assertSelectionCurrent?.()!==false,'stale Live display');};
  const source=callback=>proof=>{current();check(state.citations.has(proof),'source callback outside verified own citations');return callback?.(proof);};
  const digest=async(host,context)=>{
    current();const packet=state.method.digest;
    if(options.renderDigest)return options.renderDigest(host,{...context,digest:packet,assertCurrent:current,onSource:source(options.onSource)});
    if(!packet.available){const note=document.createElement('p');note.textContent='Analyst summary unavailable.';host.append(note);return;}
    const paragraph=document.createElement('p');paragraph.style.whiteSpace='pre-wrap';let start=0;
    for(const match of packet.text.matchAll(/\[S(\d+)\]|\bS(\d+)\b/g)){paragraph.append(document.createTextNode(packet.text.slice(start,match.index)));const sourceRow=packet.sources[Number(match[1]||match[2])-1],button=document.createElement('button');button.type='button';button.textContent=match[0];button.addEventListener('click',()=>source(options.onSource)(sourceRow.citations[0].citation));paragraph.append(button);start=match.index+match[0].length;}
    paragraph.append(document.createTextNode(packet.text.slice(start)));host.append(paragraph);
  };
  const onMapMount=typeof options.onMapMount==='function'?(host,selection)=>{current();const selected=normalizeLiveSourceMethod(value,{selectedReadingId:selection.readingId});return options.onMapMount(host,{...selected,map:liveSourceAccountMap(value,selection.readingId),assertCurrent:current});}:undefined;
  return renderStandardWorkbench({...options,...data,assertCurrent:current,onSource:source(options.onSource),onKG:typeof options.onKG==='function'?source(options.onKG):undefined,onMapMount,renderDigest:digest,technicalDetails:{method:LIVE_SOURCE_METHOD,source_pool_scope:state.method.source_pool_scope,processing_budget:state.method.processing_budget,assessment_scope:state.method.assessment_scope,failures:state.method.failures,intake_is_not_a_task_verdict:true}});
}

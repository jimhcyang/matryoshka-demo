/* Live never installs an /api/ replay hook and never persists a capability. */
import {verifyLiveSourcePolicy} from './source-policy-contract.js';
const RUN = /^live_[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ?
  Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
const same = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const fail = message => { throw new Error(message); };
export const credentialLike = value => typeof value === 'string' && /\bsk-[A-Za-z0-9_-]+|\bOPENAI_API_KEY\s*=|\bBearer\s+\S+|\bAuthorization\s*:/i.test(value);
const loginFetch = !globalThis.PublicReplay && typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
function requestError(code, status, retryAfter = 0) {
  const safe = /^[A-Z0-9_]{1,80}$/.test(code || '') ? code : 'REQUEST_REJECTED';
  const error = new Error(safe === 'LOGIN_FAILED' ? 'Password not accepted.' :
    `Live request unavailable (${safe}). No saved replay was substituted.`);
  error.code = safe;
  error.status = status;
  error.retryAfter = Math.max(0, Math.min(60, Number(retryAfter) || 0));
  return error;
}

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
  #expires = 0;
  constructor({backend, capability = ''}) {
    this.#backend = backendURL(backend);
    if (capability && (!/^[A-Za-z0-9_-]{32,256}$/.test(capability) || credentialLike(capability))) fail('A session capability is required, not a model API key.');
    this.#capability = capability;
  }
  disconnect() { this.#capability = ''; this.#expires = 0; }
  async login(password) {
    if (!loginFetch) fail('Open the Live page to log in; saved replay cannot transport a password.');
    if (typeof password !== 'string' || !password || new TextEncoder().encode(password).length > 256) fail('Enter a private access password of at most 256 UTF-8 bytes.');
    if (credentialLike(password)) fail('Enter an access password, not a model API key or bearer token.');
    this.disconnect();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      // Unlike XHR, native fetch can prohibit redirects BEFORE a password body
      // is forwarded. Live does not load the saved replay shim.
      const response = await loginFetch(new URL('session/login', this.#backend), {method: 'POST', mode: 'cors',
        credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: {'Content-Type': 'application/json', 'X-Live-Request': '1'}, body: JSON.stringify({password})});
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      try {
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 4096) { await reader.cancel(); fail('Invalid login response size.'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const raw = new Uint8Array(length);
      let at = 0; for (const chunk of chunks) { raw.set(chunk, at); at += chunk.length; }
      let value;
      try { value = JSON.parse(new TextDecoder().decode(raw)); } catch { fail('The backend did not return login JSON.'); }
      if (!response.ok) throw requestError(value.error, response.status, response.headers.get('Retry-After'));
      if (value.version !== 'matryoshka-live-session/1' || value.token_type !== 'Bearer' ||
          typeof value.access_token !== 'string' || credentialLike(value.access_token) ||
          !/^[A-Za-z0-9_-]{43,256}$/.test(value.access_token) ||
          !Number.isInteger(value.expires_in_seconds) || value.expires_in_seconds < 1 || value.expires_in_seconds > 900) {
        fail('The backend returned an invalid short-lived session.');
      }
      this.#capability = value.access_token;
      this.#expires = Date.now() + value.expires_in_seconds * 1000;
      return {authenticated: true, expires_in_seconds: value.expires_in_seconds};
    } catch (error) {
      if (error instanceof TypeError || error.name === 'AbortError') fail('Login backend unreachable or redirect blocked. Check HTTPS, exact CORS/CSP origins, and local companion settings.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  request(path, {method = 'GET', body, signal} = {}) {
    if (this.#expires && Date.now() >= this.#expires) this.disconnect();
    if (!this.#capability) return Promise.reject(new Error('The Live session is disconnected.'));
    if (!/^(health|session(?:\/logout)?|jobs(?:\/[a-f0-9]{32}(?:\/(result|cancel|retry))?)?)$/.test(path)) {
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
          if (xhr.responseText.length > 24 * 1024 * 1024 ||
              new TextEncoder().encode(xhr.responseText).length > 24 * 1024 * 1024) fail('Live result exceeded its size limit.');
          const value = JSON.parse(xhr.responseText);
          if (xhr.status < 200 || xhr.status >= 300) {
            if (xhr.status === 401) this.disconnect();
            throw requestError(value.error, xhr.status, xhr.getResponseHeader('Retry-After'));
          }
          resolve(value);
        } catch (error) { reject(error instanceof SyntaxError ? new Error('The backend did not return Live JSON.') : error); }
      };
      xhr.onerror = xhr.ontimeout = () => { cleanup(); reject(new Error('Live backend unreachable. Check its exact CORS origin, CSP and browser private-network policy.')); };
      xhr.onprogress = event => { if(event.loaded > 24 * 1024 * 1024) xhr.abort(); };
      xhr.onabort = () => { cleanup(); reject(new DOMException('Live request cancelled', 'AbortError')); };
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) { cleanup(); reject(new DOMException('Live request cancelled', 'AbortError')); return; }
      xhr.send(body === undefined ? null : JSON.stringify(body));
    });
  }
  health() { return this.request('health'); }
  async logout() {
    try { return this.#capability ? await this.request('session/logout', {method: 'POST', body: {}}) : {authenticated: false}; }
    finally { this.disconnect(); }
  }
  submit(request) { return this.request('jobs', {method: 'POST', body: request}); }
  status(id) { return this.request(`jobs/${id}`); }
  cancel(id) { return this.request(`jobs/${id}/cancel`, {method: 'POST', body: {}}); }
  retry(id) { return this.request(`jobs/${id}/retry`, {method: 'POST', body: {}}); }
  async result(id) {
    const envelope = await unpackLiveResult(await this.request(`jobs/${id}/result`));
    await verifyEnvelope(envelope, `live_${id}`);
    return envelope;
  }
}

export const LIVE_TRANSPORT_LIMITS = Object.freeze({wireBytes:24*1024*1024, decodedBytes:64*1024*1024});
const PACKED_VERSION='matryoshka-live-packed/1';
const packedResults=new WeakMap();
export function liveResultWire(value){return packedResults.get(value)?.wire||null;}
const bytesHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(n=>n.toString(16).padStart(2,'0')).join('');
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');

// Preserve Python's numeric spelling (0.0 versus 0): hash raw JSON slices,
// not a JavaScript reserialization of the parsed native packet.
function jsonSlices(text,begin=0,historyScan=false){
  const canonicalString=value=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,
    c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const compareKeys=(a,b)=>{
    let i=0,j=0;
    while(i<a.length&&j<b.length){
      const left=a.codePointAt(i),right=b.codePointAt(j);
      if(left!==right)return left-right;
      i+=left>0xffff?2:1;j+=right>0xffff?2:1;
    }
    return (i<a.length?1:0)-(j<b.length?1:0);
  };
  const canonicalFloat=value=>{
    if(value===0)return Object.is(value,-0)?'-0.0':'0.0';
    const sign=value<0?'-':'',parts=Math.abs(value).toString().split('e');
    const mantissa=parts[0],dot=mantissa.indexOf('.');
    let point=(dot<0?mantissa.length:dot)+Number(parts[1]||0),digits=mantissa.replace('.','');
    while(digits[0]==='0'){digits=digits.slice(1);point--;}
    digits=digits.replace(/0+$/,'');
    const exponent=point-1;
    // Python uses scientific notation below 1e-4 or at/above 1e16.
    if(exponent < -4||exponent >= 16)return sign+digits[0]+(digits.length>1?'.'+digits.slice(1):'')+
      'e'+(exponent<0?'-':'+')+String(Math.abs(exponent)).padStart(2,'0');
    if(point<=0)return sign+'0.'+'0'.repeat(-point)+digits;
    if(point>=digits.length)return sign+digits+'0'.repeat(point-digits.length)+'.0';
    return sign+digits.slice(0,point)+'.'+digits.slice(point);
  };
  const stringEnd=at=>{
    for(let i=at+1;i<text.length;i++){
      if(text[i]==='\\'){i++;continue;}
      if(text[i]==='"')return i+1;
    }
    fail('Invalid packed JSON string.');
  };
  const scan=(at,depth=0,collect=false)=>{
    if(depth>100)fail('Packed JSON nesting exceeds its limit.');
    const c=text[at];
    if(c==='"'){
      const end=stringEnd(at);
      const raw=text.slice(at,end),value=JSON.parse(raw);
      if(canonicalString(value)!==raw)fail('Noncanonical packed JSON string.');
      if(historyScan&&credentialLike(value))fail('Credential-shaped content cannot be saved in local history.');
      return end;
    }
    if(c==='{'||c==='['){
      const object=c==='{',end=object?'}':']',keys=new Set(),members=new Map();let i=at+1,previousKey;
      if(text[i]===end)return collect?{end:i+1,members}:i+1;
      for(;;){
        let key;
        if(object){
          if(text[i]!=='"')fail('Invalid packed JSON key.');
          const next=stringEnd(i);key=JSON.parse(text.slice(i,next));
          if(keys.has(key)||text[next]!==':')fail('Duplicate or invalid packed JSON key.');
          if(canonicalString(key)!==text.slice(i,next)||previousKey!==undefined&&compareKeys(previousKey,key)>=0)
            fail('Noncanonical packed JSON key or key order.');
          if(historyScan&&credentialFields.has(key.replace(/[^a-z]/gi,'').toLowerCase()))fail('Credential fields cannot be saved in local history.');
          keys.add(key);previousKey=key;i=next+1;
        }
        const start=i;i=scan(i,depth+1);
        if(collect)members.set(key,[start,i]);
        if(text[i]===end)return collect?{end:i+1,members}:i+1;
        if(text[i]!==',')fail('Invalid packed JSON separator.');i++;
      }
    }
    let i=at;while(i<text.length&&!/[\],}]/.test(text[i]))i++;
    const token=text.slice(at,i);
    if(!/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(token))
      fail('Invalid packed JSON value.');
    if(!['null','true','false'].includes(token)){
      const value=Number(token),integer=!/[.eE]/.test(token);
      if(!Number.isFinite(value)||integer&&(!Number.isSafeInteger(value)||token==='-0')||
          !integer&&canonicalFloat(value)!==token)fail('Noncanonical or nonrepresentable packed JSON number.');
    }
    return i;
  };
  const result=scan(begin,0,true);
  if(!result?.members)fail('A packed result must be an object.');
  return result;
}

async function inflateResult(compressed,length){
  if(typeof DecompressionStream!=='function')fail('This browser cannot decode packed Live results.');
  if(compressed.length<18||compressed[0]!==31||compressed[1]!==139||compressed[2]!==8||compressed[3]!==0)
    fail('Invalid packed gzip header.');
  const trailer=new DataView(compressed.buffer,compressed.byteOffset+compressed.length-8,8);
  if(trailer.getUint32(4,true)!==length)fail('Invalid packed gzip size.');
  // Stream into one prebounded buffer, rather than accumulating a second copy.
  const raw=new Uint8Array(length),reader=new Blob([compressed]).stream()
    .pipeThrough(new DecompressionStream('gzip')).getReader();let at=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      if(at+value.length>length){await reader.cancel();fail('Packed result exceeded its decoded bound.');}
      raw.set(value,at);at+=value.length;
    }
  }finally{reader.releaseLock();}
  if(at!==length)fail('Packed result length does not match.');
  let crc=0xffffffff;
  for(const byte of raw){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  if(((crc^0xffffffff)>>>0)!==trailer.getUint32(0,true))fail('Packed gzip checksum does not match.');
  return raw;
}

export async function unpackLiveResult(wire,{historyScan=false}={}){
  if(wire?.version!==PACKED_VERSION){
    if(String(wire?.version||'').startsWith('matryoshka-live-packed/')||wire?.payload_sha256||wire?.decoded_sha256)
      fail('Unknown packed Live transport.');
    return wire;
  }
  const fields=['version','encoding','decoded_bytes','decoded_sha256','components','payload','payload_sha256'];
  if(!exactKeys(wire,fields)||wire.encoding!=='gzip+base64'||
      !Number.isSafeInteger(wire.decoded_bytes)||wire.decoded_bytes<1||wire.decoded_bytes>LIVE_TRANSPORT_LIMITS.decodedBytes||
      typeof wire.payload!=='string'||wire.payload.length>LIVE_TRANSPORT_LIMITS.wireBytes||
      wire.payload.length%4!==0||/[^A-Za-z0-9+/=]/.test(wire.payload)||
      !HASH.test(wire.decoded_sha256||'')||!HASH.test(wire.payload_sha256||'')||
      !wire.components||Array.isArray(wire.components)||typeof wire.components!=='object'||
      Object.keys(wire.components).length>4096||Object.values(wire.components).some(hash=>!HASH.test(hash))||
      new TextEncoder().encode(JSON.stringify(wire)).length>LIVE_TRANSPORT_LIMITS.wireBytes)
    fail('Invalid packed Live transport header.');
  const binary=atob(wire.payload);
  if(btoa(binary)!==wire.payload)fail('Noncanonical packed base64.');
  const compressed=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(await bytesHash(compressed)!==wire.payload_sha256)fail('Packed wire payload hash does not match.');
  const raw=await inflateResult(compressed,wire.decoded_bytes);
  if(await bytesHash(raw)!==wire.decoded_sha256)fail('Packed logical hash does not match.');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  if(text.length!==raw.length||raw.some(byte=>byte>127))fail('Packed JSON is not canonical ASCII.');
  const slices=jsonSlices(text,0,historyScan);
  if(slices.end!==text.length||!exactKeys(wire.components,[...slices.members.keys()]))fail('Packed component manifest differs.');
  for(const [key,[a,b]] of slices.members)if(await bytesHash(raw.subarray(a,b))!==wire.components[key])
    fail('A packed component hash does not match.');
  const value=JSON.parse(text);
  if(value.native?.native_checksum){
    const native=jsonSlices(text,slices.members.get('native')[0]);
    const result=native.members.get('result');
    if(!result||await bytesHash(raw.subarray(...result))!==value.native.native_checksum)
      fail('The packed native checksum does not match.');
  }
  const artifactFields={'native.json':'native','condition.json':'condition','trace.json':'trace','sources.json':'sources',
    'document-pages.json':'document_pages','selected-evidence.json':'selected_evidence','receipt.json':'receipt',
    'analyst-digest.json':'analyst_digest'};
  if(!exactKeys(value.artifacts,Object.keys(artifactFields).filter(name=>Object.hasOwn(value,artifactFields[name]))))
    fail('The packed artifact manifest differs.');
  for(const [name,ref] of Object.entries(value.artifacts)){
    const key=artifactFields[name],span=slices.members.get(key),logical=wire.components[key];
    if(!HASH.test(ref?.sha256||'')||!span||
        (ref.encoding!==undefined?(ref.encoding!=='gzip+base64'||ref.decoded_sha256!==logical||
          ref.decoded_bytes!==span[1]-span[0]||!Number.isSafeInteger(ref.wire_bytes)||ref.wire_bytes<1||
          ref.wire_bytes>LIVE_TRANSPORT_LIMITS.wireBytes):ref.sha256!==logical))
      fail('A packed artifact logical binding differs.');
  }
  packedResults.set(value,{wire,decodedBytes:raw.length,historySafe:historyScan});
  return value;
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
      scope?.corpus !== q.corpus || (scope.strict_before ?? scope.on_or_before) !== q.as_of) {
    fail('The Live result is missing its exact task, source scope or decision artifacts.');
  }
  const admission = verifyLiveSourcePolicy(scope, native, q, value.execution_kind === 'fixture');
  if (admission.inclusive ? scope.on_or_before !== q.as_of || scope.strict_before !== undefined
      : scope.strict_before !== q.as_of || scope.on_or_before !== undefined) fail('The cutoff boundary differs from its evidence policy.');
  const dateAllowed = day => admission.inclusive ? day <= q.as_of : day < q.as_of;
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
  if(native.version==='private-live-source-intake/1'){
    const {verifyLiveSourceMethod}=await import('./workbench-live-source.js');
    await verifyLiveSourceMethod(value);return value;
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
        !['earlier', 'both'].includes(page.visibility) || !dateAllowed(page.date) ||
        admission.excludeOrigin && page.document_id === q.excluded_origin || !inspected.has(id) || typeof page.text !== 'string' ||
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
          page.permitted !== true || !['earlier', 'both'].includes(page.visibility) || !dateAllowed(page.date) ||
          admission.excludeOrigin && documentId === q.excluded_origin || page.provenance_only !== true || page.inspection_not_implied !== true ||
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
  const summary = value.analyst_digest;
  if (summary?.available === true) {
    const words = typeof summary.text === 'string' ? summary.text.trim().split(/\s+/).length : 0;
    if (!['source-bound-postrun-digest/1', 'source-bound-postrun-digest/2'].includes(summary.version) || summary.used_for_inference !== false ||
        summary.native_checksum !== native.native_checksum || summary.query_sha256 !== native.query_sha256 ||
        !same(summary.resource_binding, condition.resource_binding) || words < 50 || words > 100 ||
        !Array.isArray(summary.sources) || summary.source_count !== summary.sources.length) fail('The separate digest is not bound to this result.');
    if (summary.version === 'source-bound-postrun-digest/2') {
      const artifact = value.artifacts?.['analyst-digest.json'];
      if (summary.postrun !== true || !HASH.test(summary.input_sha256 || '') ||
          summary.scoring_version !== native.result.terminal_scores?.version ||
          !artifact || artifact.encoding !== 'gzip+base64' || !HASH.test(artifact.decoded_sha256 || '')) {
        fail('The v2 postrun digest metadata differs from its native result.');
      }
      // postMessage does not preserve the unpacker's WeakMap. Check the small
      // digest's logical artifact seal again, including its producer input pin.
      const canonical = JSON.stringify(ordered(summary)).replace(/[\u007f-\uffff]/g,
        c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
      if (await bytesHash(new TextEncoder().encode(canonical)) !== artifact.decoded_sha256) {
        fail('The v2 postrun digest differs from its sealed artifact.');
      }
    }
    summary.sources.forEach((ref, i) => { if (ref.id !== 'S' + (i + 1)) fail('Invalid digest source labels.'); replay(ref); });
    for (const match of summary.text.matchAll(/\bS(\d+)\b/g)) if (+match[1] < 1 || +match[1] > summary.sources.length) fail('Unknown digest citation.');
  }
  return value;
}

const rows = value => Array.isArray(value) ? value : [];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const masked = /\[\[REDACTION_SLOT:[^\]]*\]\]|\[(?:REDACTION(?:[ _]\d+)?|REDACTED|STILL REDACTED|MASKED|MASK)\]/gi;

export function liveRetrievalSummary(envelope) {
  const native = envelope.native || {}, result = native.result || {}, retrieval = native.retrieval || {};
  const sourceMethod=native.version==='private-live-source-intake/1'?envelope.condition?.source_method:null;
  const inspected = Array.isArray(result.inspected_page_ids) ? new Set(result.inspected_page_ids).size : count(result.source_pages_inspected);
  const documents = count(retrieval.documents_admitted);
  const iterations = count(retrieval.diffusion?.iterations);
  const candidates = sourceMethod?rows(sourceMethod.readings).reduce((n,reading)=>n+rows(reading.candidates).length,0):
    rows(result.readings).length ? rows(result.readings).reduce((n, reading) => n + rows(reading.candidates).length, 0) : rows(result.candidates).length;
  const noCandidate = envelope.execution_kind !== 'fixture' && envelope.request?.task === 'redaction' && candidates === 0;
  const text = [documents === null ? 'Document count not recorded' : `${documents} documents retrieved`,
    inspected === null ? 'inspected page count not recorded' : `${inspected} pages inspected`,
    iterations === null ? 'diffusion iteration count not recorded' : `${iterations} diffusion iterations`].join('; ') + '.';
  return {documents, inspected, iterations, candidates, noCandidate, text};
}

// Called only after verifyEnvelope: inspection is not selected evidence, nor a graph edge.
function liveRetrievedSources(envelope) {
  const retrieval = envelope.native.retrieval || {}, inspected = new Set(envelope.native.result.inspected_page_ids || []);
  const atoms = new Map(rows(envelope.condition.plan?.atoms).map(atom => [atom.id, atom]));
  const searches = rows(retrieval.search_queries).filter(search => typeof search.id === 'string' && typeof search.query === 'string').map(search => ({
    id: search.id, query: search.query,
    atom_ids: [...new Set([search, ...rows(search.also_serves)].flatMap(item => rows(item.atom_ids)
      .filter(id => atoms.get(id)?.text === item.query)))],
    raw: search
  }));
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const replay = (ref, page) => ref?.canonical_page_id === page.id && ref.document_id === page.document_id &&
    ref.date === page.date && ref.page_sha256 === page.source_sha256 && Number.isInteger(ref.start) &&
    Number.isInteger(ref.end) && ref.start >= 0 && ref.end > ref.start &&
    ref.end <= Array.from(page.text).length && Array.from(page.text).slice(ref.start, ref.end).join('') === ref.text;
  const preview = (page, refs) => {
    const ref = refs.find(item => replay(item, page) && !new RegExp(masked).test(item.text));
    let start = ref?.start || 0, text = ref?.text;
    if (!ref) {
      // Take a contiguous unmasked interval, never replace a marker with invented text.
      let at = 0;
      for (const match of page.text.matchAll(new RegExp(masked))) {
        const segment = page.text.slice(at, match.index);
        if (segment.trim()) { text = segment; start = Array.from(page.text.slice(0, at)).length; break; }
        at = match.index + match[0].length;
      }
      if (text === undefined) { text = page.text.slice(at); start = Array.from(page.text.slice(0, at)).length; }
    }
    text = Array.from(text).slice(0, 360).join('');
    return text.trim() ? {canonical_page_id: page.id, document_id: page.document_id, date: page.date,
      earlier_page: page.earlier_page, start, end: start + Array.from(text).length, text,
      page_sha256: page.source_sha256, inspection_only: true} : null;
  };
  const pages = [...inspected].map(id => envelope.sources[id]).filter(Boolean).map(page => {
    const matches = [], refs = [];
    for (const search of searches) {
      if (!search.atom_ids.length) continue;
      const pageHit = rows(search.raw.top_pages).find(hit => hit.page_id === page.id && hit.document_id === page.document_id && positive(hit.bm25));
      const nodeHit = rows(search.raw.top_nodes).find(hit => positive(hit.bm25) && replay(hit.source_proof, page));
      const seed = rows(retrieval.seeded_documents).find(item => item.page_id === page.id && item.document_id === page.document_id && replay(item.citation, page));
      const seedHit = rows(seed?.matched_searches).find(hit => hit.search_id === search.id && hit.query === search.query && positive(hit.bm25));
      if (nodeHit) refs.push(nodeHit.source_proof);
      if (seedHit) refs.push(seed.citation);
      const hit = pageHit || nodeHit || seedHit;
      if (hit) matches.push({search_id: search.id, atom_ids: search.atom_ids, query: search.query, bm25: hit.bm25,
        basis: pageHit ? 'Page text match' : nodeHit ? 'Extracted node on this page' : 'Seeded page text match'});
    }
    for (const seed of rows(retrieval.seeded_documents)) if (replay(seed.citation, page)) refs.push(seed.citation);
    return {id: page.id, document_id: page.document_id, date: page.date, earlier_page: page.earlier_page,
      matches, citation: preview(page, refs)};
  });
  return {searches: searches.map(({raw, ...search}) => search), pages};
}

export async function toWorkbenchPacket(envelope, expectedRun) {
  await verifyEnvelope(envelope, expectedRun);
  const condition = envelope.condition;
  const sourceModule=condition.source_method?await import('./workbench-live-source.js'):null;
  const verifiedSource=sourceModule?await sourceModule.verifyLiveSourceMethod(envelope):null;
  const row = {case: condition.case, configurations: {llm_readings: condition},
    resource_binding: verifiedSource?sourceModule.liveSourceInspectionBinding(verifiedSource):condition.resource_binding || null,
    current_resource_execution: condition.current_resource_execution === true,
    execution_kind: envelope.execution_kind, live_run_id: envelope.run_id};
  const report = {version: 'matryoshka-live-report/1', run_id: envelope.run_id, status: 'COMPLETE',
    cases: [row], execution_kind: envelope.execution_kind, live_execution: envelope.execution_kind === 'live',
    saved_replay: false, benchmark_accuracy_claimed: false};
  return {report, row, condition, trace: envelope.trace, sources: envelope.sources,
    source_method:condition.source_method||null,
    source_method_handle:verifiedSource,
    document_pages: envelope.document_pages || {}, origins: null,
    receipt: envelope.receipt, source_scope: envelope.source_scope, selected_evidence: envelope.selected_evidence,
    analyst_digest: envelope.analyst_digest,
    retrieval_summary: liveRetrievalSummary(envelope), retrieved_sources: liveRetrievedSources(envelope),
    run_id: envelope.run_id, execution_kind: envelope.execution_kind};
}

export function sendToWorkbench(target, envelope, {timeout = 90000} = {}) {
  const targetOrigin = location.origin;
  let timer;
  const cleanup = () => { clearTimeout(timer); removeEventListener('message', listen); };
  const listen = event => {
    if (event.origin !== targetOrigin || event.source !== target || event.data?.type !== 'matryoshka:live-ready' ||
        event.data.run_id !== envelope.run_id) return;
    target.postMessage({type: 'matryoshka:live-result', result: envelope,result_wire:liveResultWire(envelope)}, targetOrigin);
    cleanup();
  };
  addEventListener('message', listen);
  timer = setTimeout(cleanup, timeout);
  return cleanup;
}

export function receiveFromLive(callback, {runId = new URLSearchParams(location.search).get('live_run'), timeout = 15000, onError = () => {}} = {}) {
  let source = window.opener;
  if (!source && new URLSearchParams(location.search).get('live_embed') === '1' && window.parent !== window) {
    try { if (window.parent.location.origin === location.origin) source = window.parent; } catch { /* Cross-origin parents cannot provide a run. */ }
  }
  if (!RUN.test(runId || '') || !source) {
    onError(new Error('Open this run from the authenticated Live page, or connect explicitly to its backend.'));
    return () => {};
  }
  const expectedOrigin = location.origin;
  let interval, timer;
  const cleanup = () => { clearInterval(interval); clearTimeout(timer); removeEventListener('message', listen); };
  const listen = async event => {
    if (event.origin !== expectedOrigin || event.source !== source || event.data?.type !== 'matryoshka:live-result') return;
    cleanup();
    try {const value=event.data.result_wire?await unpackLiveResult(event.data.result_wire):event.data.result;
      callback(await toWorkbenchPacket(value, runId)); } catch (error) { onError(error); }
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

export const LIVE_HISTORY_LIMITS = Object.freeze({key: 'matryoshka.live.results.v1', entries: 6,
  storageBytes: 16 * 1024 * 1024, entryBytes: 8 * 1024 * 1024,
  totalRawBytes: 64 * 1024 * 1024, maxAgeMs: 24 * 60 * 60 * 1000});
const publicEnvelopeKeys = ['version', 'run_id', 'execution_kind', 'request', 'native', 'condition', 'trace',
  'selected_evidence', 'sources', 'document_pages', 'source_scope', 'receipt', 'artifacts', 'analyst_digest', 'origins'];
const credentialFields = new Set(['password', 'passphrase', 'capability', 'authorization', 'apikey',
  'openaiapikey', 'providerkey', 'accesstoken', 'refreshtoken', 'sessiontoken', 'sessioncapability',
  'bearertoken', 'auth', 'authentication', 'passwordhash', 'passwordverifier', 'credentials']);
function publicHistoryEnvelope(value) {
  if(Object.keys(value).some(key=>!publicEnvelopeKeys.includes(key)))fail('Unknown result fields cannot enter local history.');
  // Packed history was credential-scanned directly from <=64 MiB of decoded
  // bytes, including every key/string; legacy objects keep their node budget.
  if(packedResults.get(value)?.historySafe)return value;
  const copy = value;
  let visited = 0;
  const visit = (item, depth = 0) => {
    if (++visited > 500000 || depth > 100) fail('This result exceeds local history limits.');
    if (typeof item === 'string' && credentialLike(item)) fail('Credential-shaped content cannot be saved in local history.');
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (credentialFields.has(key.replace(/[^a-z]/gi, '').toLowerCase())) fail('Credential fields cannot be saved in local history.');
      visit(child, depth + 1);
    }
  };
  visit(copy);
  return copy;
}
function base64(bytes) {
  let text = '';
  for (let at = 0; at < bytes.length; at += 32768) text += String.fromCharCode(...bytes.subarray(at, at + 32768));
  return btoa(text);
}
async function limitedBytes(stream, limit) {
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); fail('This result exceeds local history limits.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Only public, revalidated result envelopes enter this store. Authentication is never an input.
export class LiveResultHistory {
  #storage;
  #rows = [];
  #loaded = false;
  #loading;
  #revision = 0;
  constructor(storage) {
    try { this.#storage = storage === undefined ? globalThis.sessionStorage : storage; } catch { this.#storage = null; }
  }
  entries() { return this.#rows.map(row => ({runId: row.id, savedAt: row.saved_at, envelope: row.envelope})); }
  get(id) { return this.#rows.find(row => row.id === id)?.envelope || null; }
  load() { return this.#loading ||= this.#read(); }
  async #read() {
    if (this.#loaded) return {entries: this.entries(), removed: 0};
    this.#loaded = true;
    const revision = this.#revision;
    let data, removed = 0;
    try {
      const raw = this.#storage?.getItem(LIVE_HISTORY_LIMITS.key);
      if (!raw) return {entries: [], removed};
      if (raw.length * 2 > LIVE_HISTORY_LIMITS.storageBytes) throw Error('History size');
      data = JSON.parse(raw);
      if (data?.version !== 'matryoshka-live-history/1' || Object.keys(data).some(key => !['version', 'entries'].includes(key)) ||
          !Array.isArray(data.entries) || data.entries.length > LIVE_HISTORY_LIMITS.entries) throw Error('History format');
    } catch {
      try { this.#storage?.removeItem(LIVE_HISTORY_LIMITS.key); } catch { /* Storage may be disabled. */ }
      return {entries: [], removed: 1};
    }
    let total = 0;
    for (const row of data.entries) {
      try {
        if (Object.keys(row).some(key => !['id', 'saved_at', 'codec', 'payload', 'raw_bytes', 'decoded_bytes'].includes(key)) ||
            !RUN.test(row.id) || this.#rows.some(item => item.id === row.id) || !Number.isSafeInteger(row.saved_at) ||
            row.saved_at > Date.now() + 60000 || Date.now() - row.saved_at > LIVE_HISTORY_LIMITS.maxAgeMs ||
            !Number.isSafeInteger(row.raw_bytes) || row.raw_bytes <= 0 || row.raw_bytes > LIVE_HISTORY_LIMITS.entryBytes ||
            !['gzip', 'json'].includes(row.codec) || typeof row.payload !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(row.payload)) throw Error('History entry');
        const wire = Uint8Array.from(atob(row.payload), char => char.charCodeAt(0));
        const bytes = row.codec === 'gzip' ? await limitedBytes(new Blob([wire]).stream().pipeThrough(new DecompressionStream('gzip')), LIVE_HISTORY_LIMITS.entryBytes) : wire;
        if (bytes.length !== row.raw_bytes || bytes.length > LIVE_HISTORY_LIMITS.entryBytes) throw Error('History bytes');
        const stored=JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
        if(stored?.version===PACKED_VERSION&&Number.isSafeInteger(stored.decoded_bytes)&&
            stored.decoded_bytes>LIVE_HISTORY_LIMITS.totalRawBytes-total)throw Error('History decoded total');
        const envelope = publicHistoryEnvelope(await unpackLiveResult(stored,{historyScan:true}));
        const decodedBytes=packedResults.get(envelope)?.decodedBytes||bytes.length;
        total+=decodedBytes;
        if(total>LIVE_HISTORY_LIMITS.totalRawBytes||row.decoded_bytes!==undefined&&row.decoded_bytes!==decodedBytes)throw Error('History decoded bytes');
        await verifyEnvelope(envelope, row.id);
        if (revision !== this.#revision) return {entries: this.entries(), removed: 0};
        this.#rows.push({...row, raw_bytes: bytes.length, decoded_bytes:decodedBytes, envelope});
      } catch { removed++; }
    }
    if (removed) this.#persist();
    return {entries: this.entries(), removed};
  }
  #persist() {
    const data = {version: 'matryoshka-live-history/1', entries: this.#rows.map(({envelope, ...row}) => row)};
    const text = JSON.stringify(data);
    try {
      if (!this.#storage) return false;
      this.#storage.setItem(LIVE_HISTORY_LIMITS.key, text);
      return true;
    } catch { return false; }
  }
  async remember(value) {
    const revision = this.#revision;
    await this.load();
    const packed=packedResults.get(value)?.wire;
    const envelope = publicHistoryEnvelope(packed?await unpackLiveResult(packed,{historyScan:true}):value);
    await verifyEnvelope(envelope);
    const bytes = new TextEncoder().encode(JSON.stringify(packed||envelope));
    const decodedBytes=packedResults.get(envelope)?.decodedBytes||bytes.length;
    if (bytes.length > LIVE_HISTORY_LIMITS.entryBytes) return {stored: false, reason: 'Result too large for local history.'};
    const compressed = typeof CompressionStream === 'function';
    const wire = compressed ? await limitedBytes(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')), LIVE_HISTORY_LIMITS.storageBytes) : bytes;
    if (revision !== this.#revision) return {stored: false, reason: 'History was cleared.'};
    const row = {id: envelope.run_id, saved_at: Date.now(), codec: compressed ? 'gzip' : 'json',
      payload: base64(wire), raw_bytes: bytes.length, decoded_bytes:decodedBytes, envelope};
    const rows = [row, ...this.#rows.filter(item => item.id !== row.id)].slice(0, LIVE_HISTORY_LIMITS.entries);
    while (rows.length && (JSON.stringify({version: 'matryoshka-live-history/1', entries: rows.map(({envelope, ...item}) => item)}).length * 2 > LIVE_HISTORY_LIMITS.storageBytes ||
        rows.reduce((sum, item) => sum + (item.decoded_bytes||item.raw_bytes), 0) > LIVE_HISTORY_LIMITS.totalRawBytes)) rows.pop();
    if (!rows.length) return {stored: false, reason: 'Result too large for local history.'};
    this.#rows = rows;
    return {stored: this.#persist(), memory: true};
  }
  clear() {
    this.#revision++;
    this.#rows = []; this.#loaded = true;
    try { this.#storage?.removeItem(LIVE_HISTORY_LIMITS.key); } catch { /* The in-memory history is still cleared. */ }
  }
}

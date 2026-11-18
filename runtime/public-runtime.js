/* Saved-packet transport; pinned repository graph datasets only. No inference or API proxy. */
(function () {
  "use strict";
  const script = document.currentScript;
  if (!script || window.PublicReplay) throw new Error("Load public-runtime.js once as an early classic script");
  const base = new URL(script.dataset.siteBase || "../", script.src);
  if (!/^https?:$/.test(base.protocol) || base.origin !== location.origin || !base.pathname.endsWith("/") || base.search || base.hash) throw new Error("The public site base must be a same-origin HTTP(S) directory");
  const originalFetch = window.fetch.bind(window), originalOpen = window.open.bind(window);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const pages = new Set(["/", "/index.html", "/workbench-v6.html", "/graph-full-v6.html"]);
  const guide = {config: "llm_readings", reading: "", route_index: "0"};
  const routes = {
    "/api/health": {defaults: {}, required: []},
    "/api/condition-v6": {defaults: {config: "llm_readings"}, required: ["case_id"]},
    "/api/flow-v6": {defaults: {config: "llm_readings", reading: "", limit: "1024"}, required: ["case_id"]},
    "/api/node-v6": {defaults: {}, required: ["case_id", "node_id"]},
    "/api/source-v6": {defaults: {}, required: ["case_id", "source_id"]},
    "/api/native-v6": {defaults: {config: "llm_readings"}, required: ["case_id"]},
    "/api/origin-v63": {defaults: {reveal_focal: "0"}, required: ["case_id"]},
    "/api/guide-v6": {defaults: guide, required: ["case_id", "candidate_id"]},
    "/api/guide-overlay-v64": {defaults: guide, required: ["case_id", "candidate_id"]},
    "/api/guide-overlay-v63": {defaults: guide, required: ["case_id", "candidate_id"]},
    "/api/guide-view-v6": {defaults: {...guide, phase: "start_community"}, required: ["case_id", "candidate_id"],
      optional: ["source_id", "node_id", "hop_index", "limit", "offset", "page_size"]},
    "/api/graph-v4-viewer": {defaults: {corpus: "cib"}, required: [], optional: ["revision"]},
    "/api/cib-pdf": {defaults: {release: "earlier"}, required: ["doc_id"], optional: ["document_id"]}
  };
  const currentPins = ["case_id", "resource_id", "registry_sha256", "index_sha256"];
  for (const endpoint of ["condition-v6", "flow-v6", "node-v6", "source-v6", "native-v6", "origin-v63",
    "guide-v6", "guide-overlay-v64", "guide-overlay-v63", "guide-view-v6", "postrun-review", "cib-pdf"]) {
    const old = routes["/api/" + endpoint] || {defaults: {reveal: "0"}, required: []};
    routes["/api/current/" + endpoint] = {defaults: {...old.defaults, config: "llm_readings"},
      required: [...new Set([...currentPins, ...old.required])], optional: old.optional || []};
  }
  const isPDF = path => /^\/api\/(?:current\/)?cib-pdf$/.test(path);
  const deniedSegments = new Set(["private", ".git", ".env", "manuscripts", "manuscript", "raw_logs", "raw-logs", "requests", "responses", "api_keys", "node_modules"]);
  const limits = Object.freeze({manifestBytes: 32 * 1024 ** 2, chunkBytes: 16 * 1024 ** 2,
    rootBytes: 512 * 1024 ** 2, cachedChunks: 8, cachedChunkBytes: 32 * 1024 ** 2,
    manifests: 4, depth: 16384, operations: 50000000});
  const packs = new Map(), chunkCache = new Map();
  let cachedChunkBytes = 0;
  let savedIndex = null;
  function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
  function rawPath(value) {
    let text = String(value).split(/[?#]/)[0];
    for (let i = 0; i < 3; i++) {
      if (/[\\\u0000-\u001f]/.test(text) || text.split("/").some(s => s === "..")) fail("UNSAFE_PATH", "Traversal is not a public replay path");
      let decoded;
      try { decoded = decodeURIComponent(text); } catch (_) { fail("UNSAFE_PATH", "Malformed path encoding"); }
      if (decoded === text) return;
      text = decoded;
    }
    if (/%/.test(text)) fail("UNSAFE_PATH", "Nested path encoding is not supported");
  }
  function logical(input) {
    const value = input instanceof Request ? input.url : String(input);
    rawPath(value);
    const url = new URL(value, document.baseURI);
    if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin || url.username || url.password) fail("NONLOCAL_REQUEST", "Only this saved public site may supply data");
    let path = url.pathname;
    if (path.startsWith(base.pathname)) path = "/" + path.slice(base.pathname.length);
    else if (!path.startsWith("/api/") && !path.startsWith("/graph-assets-v4/") && !path.startsWith("/data/") && !pages.has(path) && !/^\/workbench-v[345]\.html$/.test(path)) fail("OUTSIDE_SITE_BASE", "The request leaves this project site");
    return {path, query: url.searchParams, hash: url.hash};
  }
  function canonicalKey(input) {
    const {path, query} = logical(input), values = Object.create(null);
    for (const [key, value] of query) {
      if (own(values, key)) fail("DUPLICATE_PARAMETER", "Repeated request parameters are not supported");
      if (/[\u0000-\u001f]/.test(key + value) || value.length > 4096) fail("INVALID_PARAMETER", "Invalid request parameter");
      values[key] = value;
    }
    if (path.startsWith("/api/")) {
      if (!own(routes, path)) fail("API_NOT_ALLOWLISTED", "No public replay exists for this API");
      const spec = routes[path], allowed = new Set([...Object.keys(spec.defaults), ...spec.required, ...(spec.optional || [])]);
      if (Object.keys(values).some(k => !allowed.has(k))) fail("UNKNOWN_PARAMETER", "Unknown public replay parameter");
      if (isPDF(path) && own(values, "document_id")) {
        if (own(values, "doc_id")) fail("DUPLICATE_PARAMETER", "Use one PDF document identifier");
        values.doc_id = values.document_id; delete values.document_id;
      }
      for (const [key, value] of Object.entries(spec.defaults)) if (!own(values, key)) values[key] = value;
      if (spec.required.some(k => !values[k])) fail("MISSING_PARAMETER", "A required saved-packet selector is missing");
      if (path.startsWith("/api/current/")) {
        for (const pin of ["registry_sha256", "index_sha256"]) if (!/^[a-f0-9]{64}$/.test(values[pin])) fail("INVALID_PARAMETER", "Current-resource SHA256 pins are required");
        if (!/^[A-Za-z0-9_.:-]{1,240}$/.test(values.resource_id)) fail("INVALID_PARAMETER", "Invalid current-resource identifier");
      }
      if (own(values, "config")) {
        values.config = ({A: "llm_readings", B: "llm_atoms", C: "llm_local"})[values.config] || values.config;
        if (!["llm_readings", "llm_atoms", "llm_local"].includes(values.config)) fail("INVALID_PARAMETER", "Unknown research condition");
      }
      for (const name of ["route_index", "limit", "offset", "page_size", "hop_index"]) if (own(values, name)) {
        if (!/^\d+$/.test(values[name]) || !Number.isSafeInteger(Number(values[name]))) fail("INVALID_PARAMETER", "Expected an unsigned integer");
        values[name] = String(Number(values[name]));
      }
      if (own(values, "route_index") && Number(values.route_index) > 2) fail("INVALID_PARAMETER", "Only the three supplied route indices are supported");
      if (own(values, "corpus") && !["cib", "iran", "vietnam"].includes(values.corpus)) fail("INVALID_PARAMETER", "Unknown corpus");
      if (own(values, "revision") && values.revision !== "study") fail("INVALID_PARAMETER", "Unknown saved graph revision");
      if (own(values, "release") && !["earlier", "later"].includes(values.release)) fail("INVALID_PARAMETER", "Unknown release");
      if (own(values, "reveal_focal") && !["0", "1"].includes(values.reveal_focal)) fail("INVALID_PARAMETER", "Unknown focal reveal state");
      if (own(values, "reveal") && !["0", "1"].includes(values.reveal)) fail("INVALID_PARAMETER", "Unknown assessment reveal state");
      if (path === "/api/guide-view-v6" || path === "/api/current/guide-view-v6") {
        const phase = values.phase;
        if (phase === "source" || phase === "inspect") {
          if (!values[phase === "source" ? "source_id" : "node_id"]) fail("MISSING_PARAMETER", "Missing source or node selector");
          if (["hop_index", "limit", "offset", "page_size"].some(k => own(values, k))) fail("UNKNOWN_PARAMETER", "Context pagination is not a source/inspection selector");
        } else {
          if (!["start_community", "start_connections", "relation", "target_reveal", "target_connections", "target_community"].includes(phase)) fail("INVALID_PARAMETER", "Unknown guide phase");
          for (const [key, value] of Object.entries({hop_index: "0", limit: "256", offset: "0", page_size: "24"})) if (!own(values, key)) values[key] = value;
        }
      }
    }
    const quotePlus = value => encodeURIComponent(value).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, "+");
    const sorted = Object.keys(values).sort().map(key => quotePlus(key) + "=" + quotePlus(values[key])).join("&");
    return path + (sorted ? "?" + sorted : "");
  }
  function assetURL(path) {
    if (typeof path !== "string" || !/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith("/") || path.split("/").some(p => !p || p === "." || p === ".." || deniedSegments.has(p.toLowerCase()))) fail("UNSAFE_MANIFEST_PATH", "The public manifest may name only literal public files");
    const url = new URL(path, base);
    if (!url.href.startsWith(base.href)) fail("UNSAFE_MANIFEST_PATH", "Manifest file leaves this project site");
    return url;
  }
  function entryURL(entry, key) {
    if (!own(entry, "external_url")) return assetURL(entry.path);
    const match = typeof entry.external_url === "string" && /^https:\/\/raw\.githubusercontent\.com\/jimhcyang\/matryoshka-demo\/[a-f0-9]{40}\/datasets\/(cib|iran|vietnam)\/[a-f0-9]{64}\.json\.gz$/.exec(entry.external_url);
    const corpus = /^\/graph-assets-v4\/(cib|iran|vietnam)\//.exec(key);
    if (!match || match[0] !== entry.external_url || !corpus || match[1] !== corpus[1] || entry.encoding !== "gzip" ||
        entry.sha256?.length !== 64 || entry.wire_sha256?.length !== 64 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256 || "") || !/^[a-f0-9]{64}$/.test(entry.wire_sha256 || "") ||
        !/^application\/json(?:; charset=utf-8)?$/i.test(entry.mime || "")) fail("INVALID_EXTERNAL_DATASET", "External data must be a dual-hash-pinned immutable graph gzip in the approved repository and corpus");
    if (own(entry, "path")) assetURL(entry.path);
    return new URL(entry.external_url);
  }
  const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
  const hash = async bytes => hex(await crypto.subtle.digest("SHA-256", bytes));
  async function matches(bytes, expected, name) {
    if (!/^[a-f0-9]{64}$/.test(expected || "") || await hash(bytes) !== expected) fail("INTEGRITY_FAILURE", name + " failed its SHA-256 check");
  }
  function integer(value, low, high) { return Number.isSafeInteger(value) && value >= low && value <= high; }
  function check(condition, message) { if (!condition) fail("INVALID_FRAGMENT_DAG", message); }
  async function boundedBytes(response, maximum) {
    check(response.body, "The saved transport has no readable body");
    const reader = response.body.getReader(), pieces = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > maximum) { await reader.cancel(); fail("PUBLIC_SIZE_LIMIT", "The saved transport exceeds its explicit byte limit"); }
        pieces.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const piece of pieces) { result.set(piece, offset); offset += piece.byteLength; }
    return result;
  }
  async function unzipBounded(wire, maximum) {
    if (typeof DecompressionStream === "undefined") fail("GZIP_UNAVAILABLE", "This browser cannot decode the saved gzip packet");
    return boundedBytes(new Response(new Blob([wire]).stream().pipeThrough(new DecompressionStream("gzip"))), maximum);
  }
  function template(pieces, parent = Infinity) {
    check(Array.isArray(pieces) && pieces.length % 2 === 1, "Malformed fragment template");
    for (let i = 0; i < pieces.length; i++) {
      if (i % 2) check(integer(pieces[i], 1, Number.MAX_SAFE_INTEGER) && pieces[i] < parent, "Fragment references must be positive, safe and strictly backward");
      else check(typeof pieces[i] === "string" && !/[^\x00-\x7f]/.test(pieces[i]), "Fragment literals must be ASCII JSON text");
    }
  }
  async function packFor(entry) {
    const cacheKey = entry.path + "#" + entry.manifest_sha256;
    if (packs.has(cacheKey)) {
      const cached = packs.get(cacheKey); packs.delete(cacheKey); packs.set(cacheKey, cached);
      return cached;
    }
    const pending = (async () => {
      const response = await originalFetch(assetURL(entry.path), {credentials: "omit", redirect: "error", mode: "same-origin"});
      check(response.ok, "The packed graph manifest is unavailable");
      const raw = await boundedBytes(response, limits.manifestBytes);
      await matches(raw, entry.manifest_sha256, "Packed graph manifest");
      const manifest = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(raw));
      check(manifest.version === "graph-fragment-dag/1" && manifest.encoding === "fragment-dag", "Unknown graph pack version");
      check(Array.isArray(manifest.chunks) && manifest.assets && typeof manifest.assets === "object" && !Array.isArray(manifest.assets), "Malformed graph pack catalogs");
      let last = 0;
      for (const [index, chunk] of manifest.chunks.entries()) {
        check(chunk.id === index && chunk.first_id === last + 1 && integer(chunk.last_id, chunk.first_id, Number.MAX_SAFE_INTEGER), "Chunk ID ranges must be contiguous and ordered");
        check(chunk.encoding === "gzip" && /^chunks\/[a-f0-9]{64}\.json\.gz$/.test(chunk.path), "Unsafe fragment chunk path or encoding");
        check(integer(chunk.decoded_bytes, 1, limits.chunkBytes) && integer(chunk.wire_bytes, 1, limits.chunkBytes), "Chunk exceeds its byte limits");
        check(/^[a-f0-9]{64}$/.test(chunk.sha256decoded || "") && /^[a-f0-9]{64}$/.test(chunk.wire_sha256 || ""), "Chunk integrity pins are missing");
        assetURL(entry.path.slice(0, entry.path.lastIndexOf("/") + 1) + chunk.path);
        last = chunk.last_id;
      }
      return {manifest, cacheKey, directory: entry.path.slice(0, entry.path.lastIndexOf("/") + 1)};
    })();
    packs.set(cacheKey, pending);
    while (packs.size > limits.manifests) packs.delete(packs.keys().next().value);
    try { return await pending; } catch (error) { if (packs.get(cacheKey) === pending) packs.delete(cacheKey); throw error; }
  }
  async function chunkRows(pack, index, signal) {
    const key = pack.cacheKey + "#" + index, ref = pack.manifest.chunks[index];
    const response = await originalFetch(assetURL(pack.directory + ref.path), {credentials: "omit", redirect: "error", mode: "same-origin", signal});
    check(response.ok, "A declared graph chunk is unavailable");
    const wire = await boundedBytes(response, ref.wire_bytes);
    check(wire.length === ref.wire_bytes, "Chunk wire length differs");
    await matches(wire, ref.wire_sha256, "Fragment chunk wire");
    const raw = await unzipBounded(wire, ref.decoded_bytes);
    check(raw.length === ref.decoded_bytes, "Chunk decoded length differs");
    await matches(raw, ref.sha256decoded, "Decoded fragment chunk");
    const value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(raw));
    check(value.version === "graph-fragment-dag-chunk/1" && value.first_id === ref.first_id && Array.isArray(value.fragments), "Fragment chunk header differs");
    check(value.fragments.length === ref.last_id - ref.first_id + 1, "Fragment chunk row count differs");
    value.fragments.forEach((pieces, i) => template(pieces, ref.first_id + i));
    if (chunkCache.has(key)) { cachedChunkBytes -= chunkCache.get(key).bytes; chunkCache.delete(key); }
    chunkCache.set(key, {rows: value.fragments, bytes: raw.length}); cachedChunkBytes += raw.length;
    while (chunkCache.size > limits.cachedChunks || cachedChunkBytes > limits.cachedChunkBytes) {
      const oldest = chunkCache.keys().next().value;
      cachedChunkBytes -= chunkCache.get(oldest).bytes; chunkCache.delete(oldest);
    }
    return value.fragments;
  }
  async function fragmentBytes(entry, signal) {
    const pack = await packFor(entry);
    check(own(pack.manifest.assets, entry.asset), "The exact packed asset is absent");
    const root = pack.manifest.assets[entry.asset], chunks = pack.manifest.chunks;
    check(root.encoding === "fragment-dag" && root.sha256decoded === entry.sha256, "Packed root and public index pins differ");
    check(integer(root.decoded_bytes, 0, limits.rootBytes), "Root exceeds its decoded byte limit");
    template(root.pieces);
    check(Array.isArray(root.dependencies), "Root dependency inventory is missing");
    const allowed = new Set(root.dependencies);
    check(allowed.size === root.dependencies.length && [...allowed].every(i => integer(i, 0, chunks.length - 1)), "Root dependency indices are invalid");
    const needed = new Map(), retained = new Map(), encoder = new TextEncoder(), decoder = new TextDecoder();
    let operations = 0;
    function mark(id) {
      let low = 0, high = chunks.length;
      while (low < high) { const mid = Math.floor((low + high) / 2); if (chunks[mid].first_id <= id) low = mid + 1; else high = mid; }
      const index = low - 1;
      check(allowed.has(index) && id <= chunks[index].last_id, "Reference uses an undeclared or absent dependency");
      if (!needed.has(index)) needed.set(index, new Set());
      needed.get(index).add(id);
    }
    for (let i = 1; i < root.pieces.length; i += 2) mark(root.pieces[i]);
    // Backward-only references let one descending pass select templates without LRU re-reads.
    for (const index of [...allowed].sort((a, b) => b - a)) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (!needed.has(index)) continue;
      const cacheKey = pack.cacheKey + "#" + index, cached = chunkCache.get(cacheKey);
      let rows;
      if (cached) { chunkCache.delete(cacheKey); chunkCache.set(cacheKey, cached); rows = cached.rows; }
      else rows = await chunkRows(pack, index, signal);
      const ids = needed.get(index);
      for (let row = rows.length - 1; row >= 0; row--) {
        check(++operations <= limits.operations, "Fragment selection exceeds its work limit");
        const id = chunks[index].first_id + row;
        if (!ids.has(id)) continue;
        const pieces = rows[row];
        // Copy literals so retained templates cannot pin an entire parsed chunk's string storage.
        retained.set(id, pieces.map(piece => typeof piece === "string" ? decoder.decode(encoder.encode(piece)) : piece));
        ids.delete(id);
        for (let i = 1; i < pieces.length; i += 2) mark(pieces[i]);
      }
      check(ids.size === 0, "A required fragment was not selected");
      needed.delete(index);
    }
    check(needed.size === 0, "A required dependency was not visited");
    const result = new Uint8Array(root.decoded_bytes);
    const stack = [{pieces: root.pieces, index: 0}];
    let length = 0;
    while (stack.length) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      check(++operations <= limits.operations && stack.length <= limits.depth, "Fragment expansion exceeds its work/depth limit");
      const frame = stack[stack.length - 1];
      if (frame.index === frame.pieces.length) { stack.pop(); continue; }
      const piece = frame.pieces[frame.index++];
      if (typeof piece === "string") {
        check(piece.length <= result.length - length, "Root expansion exceeds its declared size");
        const written = encoder.encodeInto(piece, result.subarray(length));
        check(written.read === piece.length && written.written === piece.length, "Fragment text is not exact ASCII");
        length += written.written;
      } else {
        check(retained.has(piece), "A required template was not retained");
        stack.push({pieces: retained.get(piece), index: 0});
      }
    }
    check(length === root.decoded_bytes, "Root expansion is shorter than declared");
    await matches(result, entry.sha256, "Reconstructed graph root");
    return result;
  }
  function notice(message) {
    const render = () => {
      let box = document.getElementById("public-replay-notice");
      if (!box) { box = document.createElement("aside"); box.id = "public-replay-notice"; box.setAttribute("role", "status"); document.body.append(box); }
      box.textContent = message || "Saved public research demo only. No model, live query API, inference, or new ranking is available. Export coverage is finite, not all local archives.";
    };
    if (document.body) render(); else document.addEventListener("DOMContentLoaded", render, {once: true});
  }
  function externalCitation(value) {
    let url;
    try { url = new URL(value, document.baseURI); } catch (_) { return null; }
    if (url.origin === base.origin || url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || /\.(localhost|local|internal|lan|home|test|invalid|onion)$/.test(host)) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split(".").map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b)) return null;
    } else if (host.includes(":")) {
      if (!/^[23][0-9a-f]{3}:/.test(host)) return null;
    } else if (!host.includes(".")) return null;
    return url;
  }
  async function loadIndex() {
    const response = await originalFetch(assetURL(script.dataset.index || "data/api-index.json"), {credentials: "omit", redirect: "error", mode: "same-origin"});
    if (!response.ok) fail("INDEX_UNAVAILABLE", "The saved public manifest is unavailable");
    const bytes = await response.arrayBuffer();
    if (script.dataset.indexSha256) await matches(bytes, script.dataset.indexSha256, "Public manifest");
    const value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    if (value.version !== "matryoshka-public-api-index/1" || !value.entries || Array.isArray(value.entries) || typeof value.entries !== "object") fail("INVALID_INDEX", "Unsupported public manifest");
    for (const [key, entry] of Object.entries(value.entries)) {
      if (!key.startsWith("/") || canonicalKey(new URL(key.slice(1), base)) !== key || !entry || typeof entry !== "object") fail("INVALID_INDEX", "Manifest keys must be canonical and unique");
      entryURL(entry, key);
      if (!["identity", "gzip", "fragment-dag"].includes(entry.encoding) || !/^[a-f0-9]{64}$/.test(entry.sha256 || "") || entry.wire_sha256 && !/^[a-f0-9]{64}$/.test(entry.wire_sha256) || typeof entry.mime !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:; charset=utf-8)?$/i.test(entry.mime)) fail("INVALID_INDEX", "Invalid public entry contract");
      if (entry.encoding === "fragment-dag" && (!/^[a-f0-9]{64}$/.test(entry.manifest_sha256 || "") || typeof entry.asset !== "string" || !entry.asset || !entry.mime.startsWith("application/json"))) fail("INVALID_INDEX", "A packed JSON root needs its exact asset selector and manifest byte hash");
    }
    savedIndex = value;
    return value;
  }
  const ready = loadIndex();
  ready.catch(error => notice("Saved public replay unavailable: " + error.message));
  function hasSaved(input) {
    try { return savedIndex !== null && own(savedIndex.entries, canonicalKey(input)); }
    catch (_) { return false; }
  }
  async function verified(input, signal) {
    const key = canonicalKey(input), index = await ready;
    if (!own(index.entries, key)) fail("PUBLIC_PACKET_NOT_EXPORTED", "This saved packet is not in the public export; no other method or archive is substituted");
    const entry = index.entries[key];
    if (entry.encoding === "fragment-dag") {
      const decoded = await fragmentBytes(entry, signal);
      return {key, entry, decoded, wire: decoded, gzip: false, httpDecoded: false, fragmentDag: true};
    }
    const external = own(entry, "external_url");
    const response = await originalFetch(entryURL(entry, key), {method: "GET", credentials: "omit", redirect: "error", mode: external ? "cors" : "same-origin", signal});
    if (!response.ok) fail("PUBLIC_FILE_UNAVAILABLE", "The indexed public file is unavailable");
    const wire = new Uint8Array(await response.arrayBuffer());
    let decoded = wire;
    const gzip = wire[0] === 31 && wire[1] === 139;
    const httpDecoded = /gzip/i.test(response.headers.get("content-encoding") || "") && !gzip;
    if (external && !gzip) fail("INVALID_GZIP", "Immutable graph data must expose its original gzip bytes for both SHA checks");
    if (entry.wire_sha256 && (!httpDecoded || external)) await matches(wire, entry.wire_sha256, "Stored public file");
    if (entry.encoding === "gzip") {
      if (gzip) {
        if (typeof DecompressionStream === "undefined") fail("GZIP_UNAVAILABLE", "This browser cannot decode the saved gzip packet");
        decoded = new Uint8Array(await new Response(new Blob([wire]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
      } else if (!httpDecoded) fail("INVALID_GZIP", "The saved gzip file has no gzip header");
    }
    await matches(decoded, entry.sha256, "Decoded public packet");
    return {key, entry, wire, decoded, gzip, httpDecoded};
  }
  function unavailable(error, status = 404) {
    return new Response(JSON.stringify({status: "UNAVAILABLE", code: error.code || "PUBLIC_REPLAY_UNAVAILABLE", message: error.message, saved_replay_only: true}), {status, headers: {"Content-Type": "application/json", "X-Public-Replay": "unavailable"}});
  }
  async function fetchSaved(input, init = {}) {
    try {
      const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method !== "GET") return unavailable({code: "GET_ONLY", message: "Public replay supports GET only"}, 405);
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if ([...headers.keys()].some(k => /^(authorization|proxy-authorization|cookie|x-api-key)$/i.test(k)) || init.credentials === "include" || input instanceof Request && input.credentials === "include") return unavailable({code: "NO_CREDENTIALS", message: "Credentials are not accepted by this public replay"}, 403);
      const signal = init.signal || (input instanceof Request ? input.signal : undefined);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const value = await verified(input, signal);
      if (value.key.startsWith("/api/node-v6?") && value.entry.mime.startsWith("application/json")) {
        const packet = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(value.decoded));
        if (typeof packet.note === "string" && packet.note.trim()) notice("Saved public research demo only. " + packet.note);
      }
      // The original graph parser performs its own gzip decoding for .gz URLs.
      const keepGzip = !value.key.startsWith("/api/") && value.key.split("?")[0].endsWith(".gz") && value.gzip;
      const responseHeaders = {"Content-Type": keepGzip ? "application/gzip" : value.entry.mime, "X-Public-Replay": "saved"};
      if ((value.httpDecoded || value.fragmentDag) && value.key.split("?")[0].endsWith(".gz")) responseHeaders["Content-Encoding"] = "gzip";
      return new Response(keepGzip ? value.wire : value.decoded, {status: 200, headers: responseHeaders});
    } catch (error) {
      if (error.name === "AbortError") throw error;
      return unavailable(error, error.code === "INTEGRITY_FAILURE" ? 502 : 404);
    }
  }
  function siteURL(path) {
    const value = logical(path);
    return new URL(value.path.slice(1) + (value.query.size ? "?" + value.query : "") + value.hash, base).href;
  }
  function replayURL(input) {
    const value = logical(input), url = new URL("runtime/replay.html", base);
    url.searchParams.set("request", canonicalKey(input));
    url.searchParams.set("return_to", location.pathname + location.search);
    if (value.hash) url.hash = value.hash;
    return url.href;
  }
  function archiveOnlyPDF(node, input) {
    node.dataset.publicPdfRequest = input;
    node.dataset.publicPdfLocalArchive = "true";
    node.textContent = "PDF available in local archive";
    node.title = "Original transcript remains inspectable; this PDF is outside public cited-document subset.";
    node.setAttribute("aria-disabled", "true");
    node.setAttribute("role", "link");
    node.classList.add("public-pdf-local-archive");
    node.style.textDecoration = "none";
    node.style.cursor = "default";
    node.removeAttribute("href");
    delete node.dataset.publicReplayBlocked;
  }
  function rewrite(node) {
    const name = node.tagName === "FORM" ? "action" : "href";
    let raw = node.getAttribute(name);
    if (!raw || raw === node.dataset.publicPdfHref) raw = node.dataset.publicPdfRequest || raw;
    if (!raw || raw.startsWith("#")) return;
    if (/^blob:/i.test(raw) && new URL(raw).origin === base.origin) return;
    if (/^(blob:|data:)/i.test(raw)) { node.dataset.publicReplayBlocked = "true"; return; }
    const citation = node.tagName === "A" && externalCitation(raw);
    if (citation) {
      delete node.dataset.publicReplayBlocked;
      node.setAttribute("rel", [...new Set([...(node.rel || "").split(/\s+/).filter(Boolean), "noopener", "noreferrer"])].join(" "));
      return;
    }
    try {
      let value = logical(raw), target;
      if (node.id === "full-workbench-link" || value.path !== "/index.html" && (node.id === "full-home-link" || node.id === "full-home-brand")) {
        const intended = new URL(location.href).searchParams.get("return_to") || new URL(location.href).searchParams.get("return");
        if (intended) try {
          const back = logical(intended);
          if (back.path === "/workbench-v6.html") {
            if (node.id !== "full-workbench-link") { back.query.set("view", "home"); back.hash = ""; }
            value = back;
          }
        } catch (_) { /* An invalid return target cannot replace a safe local link. */ }
      }
      if (node.tagName === "A" && isPDF(value.path)) {
        node.dataset.publicPdfRequest = raw;
        if (savedIndex && !hasSaved(raw)) { archiveOnlyPDF(node, raw); return; }
        if (node.dataset.publicPdfLocalArchive) {
          delete node.dataset.publicPdfLocalArchive;
          node.removeAttribute("aria-disabled");
          node.classList.remove("public-pdf-local-archive");
        }
      }
      if (value.path.startsWith("/api/")) target = node.tagName === "FORM" ? siteURL(raw) : replayURL(raw);
      else if (pages.has(value.path)) target = new URL(value.path.slice(1) + (value.query.size ? "?" + value.query : "") + value.hash, base).href;
      else if (/^\/workbench-v[345]\.html$/.test(value.path)) {
        const missing = new URL("runtime/replay.html", base); missing.searchParams.set("unavailable", "This historical archive is not included in the finite public export"); target = missing.href;
      } else target = siteURL(raw);
      if (isPDF(value.path) && node.tagName === "A") node.dataset.publicPdfHref = target;
      delete node.dataset.publicReplayBlocked;
      if (node.getAttribute(name) !== target) node.setAttribute(name, target);
    } catch (_) { node.dataset.publicReplayBlocked = "true"; }
  }
  function frameURL(value) {
    if (String(value) === "about:blank" || String(value) === "") return String(value);
    if (String(value).startsWith("blob:") && new URL(value).origin === base.origin) return String(value);
    const target = logical(value);
    if (isPDF(target.path)) return replayURL(value);
    if (target.path === "/runtime/replay.html") return siteURL(value);
    fail("FRAME_NOT_ALLOWLISTED", "Only a verified saved PDF frame is available in this public demo");
  }
  function safeFrame(value) {
    try { return frameURL(value); } catch (error) { notice(error.message); return "about:blank"; }
  }
  const framePrototype = HTMLIFrameElement.prototype;
  const frameSource = Object.getOwnPropertyDescriptor(framePrototype, "src");
  const frameAttribute = framePrototype.setAttribute;
  Object.defineProperty(framePrototype, "src", {...frameSource, set(value) { frameSource.set.call(this, safeFrame(value)); }});
  Object.defineProperty(framePrototype, "setAttribute", {configurable: true, writable: true, value(name, value) {
    return frameAttribute.call(this, name, String(name).toLowerCase() === "src" ? safeFrame(value) : value);
  }});
  function rewriteFrame(node) {
    const value = node.getAttribute("src");
    if (value === null) return;
    const target = safeFrame(value);
    if (target !== value) frameAttribute.call(node, "src", target);
  }
  function scan(root) {
    if (root.matches?.("a[href],a[data-public-pdf-request],form[action]")) rewrite(root);
    if (root.matches?.("iframe[src]")) rewriteFrame(root);
    root.querySelectorAll?.("a[href],a[data-public-pdf-request],form[action]").forEach(rewrite);
    root.querySelectorAll?.("iframe[src]").forEach(rewriteFrame);
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") record.target.tagName === "IFRAME" ? rewriteFrame(record.target) : rewrite(record.target);
      else for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
    }
  });
  observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ["href", "action", "src"]});
  document.addEventListener("click", event => {
    const anchor = event.target.closest?.("a[href],a[data-public-pdf-request]");
    if (!anchor) return;
    rewrite(anchor);
    if (anchor.dataset.publicPdfLocalArchive) { event.preventDefault(); return; }
    if (anchor.dataset.publicPdfRequest && !savedIndex) {
      event.preventDefault();
      ready.then(() => { rewrite(anchor); if (anchor.hasAttribute("href")) anchor.click(); }).catch(() => {});
      return;
    }
    if (anchor.dataset.publicReplayBlocked) { event.preventDefault(); notice("That destination is outside the saved public demo"); }
  }, true);
  document.addEventListener("submit", event => {
    const form = event.target;
    if (form.method.toUpperCase() !== "GET") { event.preventDefault(); notice("The saved public demo accepts no submissions or model queries"); return; }
    try {
      const value = logical(form.action);
      if (value.path.startsWith("/api/")) {
        event.preventDefault();
        for (const [key, v] of new FormData(form)) { if (typeof v !== "string") fail("GET_ONLY", "File submissions are not supported"); value.query.append(key, v); }
        if (isPDF(value.path) && savedIndex && !hasSaved(siteURL(value.path + "?" + value.query))) { notice("PDF available in local archive. Original transcript remains inspectable; this PDF is outside public cited-document subset."); return; }
        const anchor = document.createElement("a"); anchor.href = replayURL(siteURL(value.path + "?" + value.query)); anchor.target = form.target || "_self"; anchor.click();
      } else rewrite(form);
    } catch (error) { event.preventDefault(); notice(error.message); }
  }, true);
  window.open = function (url, target, features) {
    try {
      const value = logical(url);
      if (isPDF(value.path) && savedIndex && !hasSaved(url)) { notice("PDF available in local archive. Original transcript remains inspectable; this PDF is outside public cited-document subset."); return null; }
      return originalOpen(value.path.startsWith("/api/") ? replayURL(url) : siteURL(url), target, features);
    } catch (error) { notice(error.message); return null; }
  };
  window.fetch = fetchSaved;
  window.PublicReplay = Object.freeze({version: "matryoshka-public-runtime/1", baseURL: base.href, ready, canonicalKey, hasSaved, fetch: fetchSaved, verified, siteURL, replayURL,
    fragmentLimits: limits, fragmentStats: () => ({manifests: packs.size, chunks: chunkCache.size, chunkBytes: cachedChunkBytes})});
  scan(document.documentElement);
  ready.then(() => scan(document.documentElement)).catch(() => {});
  notice();
})();

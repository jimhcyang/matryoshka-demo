"""Managed Chromium against a plain static HTTP server under a project prefix.

No Python API routes, inference, app backend, installed Chrome or external
network are used. Fixture files and gzip bytes are generated in pytest temp.
"""
from functools import partial
import gzip
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from threading import Thread
from urllib.parse import urlencode, urlsplit

import pytest
from playwright.sync_api import expect, sync_playwright


RUNTIME = Path(__file__).resolve().parents[1]
PREFIX = "/a-different-project/"


def encoded(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def test_current_requests_keep_resource_pins_and_never_fallback(site, browser):
    binding = dict(resource_id="cib_resource_fixture", registry_sha256="a"*64, index_sha256="b"*64)
    params = dict(case_id="c1", config="llm_readings", **binding)
    value = dict(resource_binding=binding, available=True, grades_revealed=False)
    raw = encoded(value)
    wire = gzip.compress(raw, mtime=0)
    relative = "packets/current.json.gz"
    (site["root"]/relative).write_bytes(wire)
    index_path = site["root"] / "data/api-index.json"
    index = json.loads(index_path.read_bytes())
    current_key = key("/api/current/postrun-review", **params, reveal="0")
    index["entries"][current_key] = dict(path=relative, encoding="gzip", mime="application/json",
        sha256=sha(raw), wire_sha256=sha(wire))
    index_path.write_bytes(encoded(index))
    context = browser.new_context()
    try:
        page = context.new_page()
        page.goto(site["base"])
        page.wait_for_function("window.PublicReplay && window.earlyShimWorked")
        supplied = "/api/current/postrun-review?"+urlencode(dict(params, config="A"))
        result = page.evaluate("async path=>{const r=await fetch(path);return {status:r.status,value:await r.json()}}", supplied)
        assert result == dict(status=200, value=value)
        wrong = supplied.replace("cib_resource_fixture", "cib_resource_other")
        assert page.evaluate("async path=>(await fetch(path)).status", wrong) == 404
        for field in ("registry_sha256", "index_sha256"):
            invalid = "/api/current/postrun-review?"+urlencode({k:v for k,v in params.items() if k != field})
            assert page.evaluate("async path=>(await fetch(path)).status", invalid) == 404
        assert page.evaluate("PublicReplay.hasSaved('/api/postrun-review?case_id=c1')") is False
        assert not any("/api/" in row["path"] for row in site["requests"])
    finally:
        context.close()


def key(path, **params):
    return path + ("?" + urlencode(sorted(params.items())) if params else "")


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as engine:
        managed = engine.chromium.launch(headless=True)
        try:
            yield managed
        finally:
            managed.close()


@pytest.fixture
def site(tmp_path):
    root = tmp_path / PREFIX.strip("/")
    (root / "runtime").mkdir(parents=True)
    (root / "data").mkdir()
    (root / "packets").mkdir()
    for name in ("public-runtime.js", "replay.html", "replay.js"):
        (root / "runtime" / name).write_bytes((RUNTIME / name).read_bytes())
    entries = {}

    def entry(logical, value, *, filename=None, compressed=True, mime="application/json", bad_hash=False):
        raw = value if isinstance(value, bytes) else encoded(value)
        filename = filename or "packets/" + sha(raw)[:16] + (".json.gz" if compressed else ".json")
        wire = gzip.compress(raw, compresslevel=9, mtime=0) if compressed else raw
        (root / filename).parent.mkdir(parents=True, exist_ok=True)
        (root / filename).write_bytes(wire)
        entries[logical] = dict(path=filename, encoding="gzip" if compressed else "identity",
                                mime=mime, sha256="0" * 64 if bad_hash else sha(raw), wire_sha256=sha(wire))
        return raw

    condition = dict(case_id="c1", config="llm_readings", rank=3,
                     endpoint_mass=2.819703871280401e-6, fill="Harmodio Arias")
    condition_key = key("/api/condition-v6", case_id="c1", config="llm_readings")
    entry(condition_key, condition)
    page = dict(id="p1", canonical_page_id="p1", document_id="earlier-doc", date="1958-03-29",
                text="Arias met a guest. \u03a9 and \u4e2d\u6587 remain exact.")
    page["source_sha256"] = sha(encoded(page["text"]))
    source = dict(page=page, document_pages=[page])
    entry(key("/api/source-v6", case_id="c1", source_id="p1"), source)
    entry(key("/api/source-v6", case_id="bad", source_id="p1"), source, filename="packets/bad.json.gz", bad_hash=True)
    entry(key("/api/source-v6", case_id="bad-wire", source_id="p1"), source, filename="packets/bad-wire.json.gz")
    entries[key("/api/source-v6", case_id="bad-wire", source_id="p1")]["wire_sha256"] = "0" * 64
    entry(key("/api/node-v6", case_id="c1", node_id="n1"), dict(node=dict(id="n1"),
          scope="SAVED_DISPLAY_PROJECTION_ONLY", note="Only the saved display projection is exported; this is not a complete case neighborhood."))
    native_key = key("/api/native-v6", case_id="c1", config="llm_readings")
    entry(native_key, dict(public_native_receipt=True, full_walk_exported=False, rank=3))
    descriptor = dict(asset_base="/graph-assets-v4/cib/", graph_run_id="g1", hierarchy_run_id="h1")
    entry(key("/api/graph-v4-viewer", corpus="cib"), descriptor)
    entry(key("/api/graph-v4-viewer", corpus="cib", revision="study"),
          dict(descriptor, graph_run_id="g0", hierarchy_run_id="h0"))
    graph_key = "/graph-assets-v4/cib/part.json.gz"
    graph = dict(schema_version="fixture/1", view_key="current_later", nodes=[dict(id="n1", label="Exact graph label")])
    entry(graph_key, graph, filename="graph-assets-v4/cib/part.json.gz")
    entry("/data/report-v6.json", dict(version="public-subset/1", cases=[dict(case_id="c1")]))
    pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
    entry(key("/api/cib-pdf", doc_id="d1", release="earlier"), pdf,
          filename="pdf/source.pdf", compressed=False, mime="application/pdf")
    index = dict(version="matryoshka-public-api-index/1", entries=entries)
    (root / "data/api-index.json").write_bytes(encoded(index))
    client = """window.clientReady=PublicReplay.ready.then(async()=>{
      const response=await fetch('/api/condition-v6?config=A&case_id=c1');
      window.saved=await response.json();window.earlyShimWorked=true;
    });"""
    (root / "client.js").write_text(client)
    html = """<!doctype html><meta charset="utf-8"><title>Static fixture</title>
    <script src="runtime/public-runtime.js" data-site-base="../"></script>
    <script src="client.js" defer></script>
    <a id="internal" href="/workbench-v6.html?case=c1">Workbench</a>
    <a id="full-workbench-link" href="/workbench-v6.html">Return</a>
    <a id="full-home-link" href="/workbench-v6.html?view=home">Home</a>
    <a id="native" href="/api/native-v6?case_id=c1">Native receipt</a>
    <a id="pdf" target="_blank" href="/api/cib-pdf?doc_id=d1#page=2">PDF</a>
    <a id="local-pdf" target="_blank" href="/api/cib-pdf?doc_id=not-public#page=2">PDF</a>
    <a id="archive" href="/workbench-v5.html">Archive</a>
    <a id="citation" href="https://example.org/source" target="_blank">Public citation</a>
    <form id="internal-form" method="get" action="/workbench-v6.html"><input name="case" value="c1"></form>
    <form id="pdf-form" method="get" action="/api/cib-pdf"><input name="doc_id" value="d1"></form>
    <div id="mount"></div>"""
    for name in ("index.html", "workbench-v6.html", "graph-full-v6.html"):
        (root / name).write_text(html)
    requests = []

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            requests.append(dict(path=self.path, cookie=self.headers.get("Cookie"), authorization=self.headers.get("Authorization")))
            return super().do_GET()

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(tmp_path)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield dict(base=f"http://127.0.0.1:{server.server_port}" + PREFIX,
                   root=root, entries=entries, condition=condition, source=source,
                   descriptor=descriptor, graph=graph, requests=requests)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.fixture
def page(browser, site):
    context = browser.new_context(service_workers="block")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(site["base"] + "workbench-v6.html")
    page.wait_for_function("window.earlyShimWorked===true")
    try:
        yield page
        assert not errors
        assert all(r["path"].startswith(PREFIX) for r in site["requests"])
        assert not any(urlsplit(r["path"]).path.startswith(PREFIX + "api/") for r in site["requests"])
    finally:
        context.close()


def fetch_json(page, value, init=None):
    return page.evaluate("async([url,init])=>{const r=await fetch(url,init);return {status:r.status,body:await r.json()};}", [value, init or {}])


def test_runtime_early_script_project_prefix_default_index_and_exact_values(page, site):
    assert page.evaluate("PublicReplay.baseURL") == site["base"]
    assert page.evaluate("saved") == site["condition"]
    assert page.evaluate("saved.rank") == 3
    assert page.evaluate("saved.endpoint_mass") == 2.819703871280401e-6
    assert any(r["path"] == PREFIX + "data/api-index.json" for r in site["requests"])
    expect(page.locator("#public-replay-notice")).to_have_text("Saved examples. Connect a backend for Live analysis.")
    assert fetch_json(page, "/data/report-v6.json")["body"]["cases"] == [dict(case_id="c1")]


def test_runtime_canonical_sorted_parameters_defaults_and_empty_reading(page, site):
    canonical = lambda value: page.evaluate("url=>PublicReplay.canonicalKey(url)", value)
    assert canonical("/api/flow-v6?case_id=c1") == "/api/flow-v6?case_id=c1&config=llm_readings&limit=1024&reading="
    assert canonical(site["base"] + "api/guide-v6?route_index=00&candidate_id=n1&case_id=c1&config=A") == "/api/guide-v6?candidate_id=n1&case_id=c1&config=llm_readings&reading=&route_index=0"
    assert canonical("/api/cib-pdf?document_id=d1") == "/api/cib-pdf?doc_id=d1&release=earlier"
    assert canonical("/api/guide-view-v6?case_id=c1&candidate_id=n1&phase=source&source_id=p1") == "/api/guide-view-v6?candidate_id=n1&case_id=c1&config=llm_readings&phase=source&reading=&route_index=0&source_id=p1"
    unusual = "page~star* quote' (owner) \u4e2d\u6587"
    assert canonical(key("/api/source-v6", case_id="c1", source_id=unusual)) == key("/api/source-v6", case_id="c1", source_id=unusual)


def test_runtime_source_gzip_integrity_and_original_page_hash(page, site):
    value = fetch_json(page, "/api/source-v6?source_id=p1&case_id=c1")
    assert value["status"] == 200 and value["body"] == site["source"]
    source = value["body"]["page"]
    assert sha(encoded(source["text"])) == source["source_sha256"]
    for case in ("bad", "bad-wire"):
        bad = fetch_json(page, f"/api/source-v6?source_id=p1&case_id={case}")
        assert bad["status"] == 502 and bad["body"]["code"] == "INTEGRITY_FAILURE"


def test_runtime_graph_descriptor_unchanged_and_existing_gzip_parser(page, site):
    assert fetch_json(page, "/api/graph-v4-viewer")["body"] == site["descriptor"]
    value = page.evaluate("""async()=>{
      const r=await fetch('/graph-assets-v4/cib/part.json.gz');
      const encoding=r.headers.get('Content-Encoding');
      const data=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
      return {encoding,data};
    }""")
    assert value == dict(encoding=None, data=site["graph"])


def test_current_and_saved_graph_bindings_remain_distinct(page, site):
    current = fetch_json(page, "/api/graph-v4-viewer")["body"]
    saved = fetch_json(page, "/api/graph-v4-viewer?revision=study&corpus=cib")["body"]
    assert current["graph_run_id"] == "g1" and saved["graph_run_id"] == "g0"
    before = len(site["requests"])
    bad = fetch_json(page, "/api/graph-v4-viewer?corpus=cib&revision=main")
    assert bad["status"] >= 400 and bad["body"]["code"] == "INVALID_PARAMETER"
    assert len(site["requests"]) == before


@pytest.mark.parametrize("url", [
    "/api/no-such-method", "/api/condition-v6?case_id=c1&case_id=c1",
    "/api/condition-v6?case_id=c1&api_key=secret", "/api/../private/x",
    "/api/%2e%2e/private/x", "/api/%252e%252e/private/x",
    "https://example.org/api/condition-v6?case_id=c1", "file:///etc/passwd",
])
def test_runtime_rejects_unsafe_or_unlisted_requests_without_network(page, site, url):
    before = len(site["requests"])
    value = fetch_json(page, url)
    assert value["status"] >= 400 and value["body"]["status"] == "UNAVAILABLE"
    assert len(site["requests"]) == before


def test_runtime_missing_finite_packet_no_fallback_post_or_credentials(page, site):
    before = len(site["requests"])
    missing = fetch_json(page, "/api/condition-v6?case_id=not-exported")
    assert missing["body"]["code"] == "PUBLIC_PACKET_NOT_EXPORTED"
    assert fetch_json(page, "/api/condition-v6?case_id=c1", dict(method="POST"))["status"] == 405
    assert fetch_json(page, "/api/condition-v6?case_id=c1", dict(headers=dict(Authorization="secret")))["status"] == 403
    assert fetch_json(page, "/api/condition-v6?case_id=c1", dict(credentials="include"))["status"] == 403
    assert len(site["requests"]) == before


def test_runtime_node_scope_note_is_visible_and_packet_not_modified(page):
    value = fetch_json(page, "/api/node-v6?case_id=c1&node_id=n1")["body"]
    assert value["scope"] == "SAVED_DISPLAY_PROJECTION_ONLY"
    expect(page.locator("#public-replay-notice")).to_contain_text(value["note"])


def test_runtime_dynamic_internal_links_forms_and_deep_return_intent(page, site):
    expect(page.locator("#internal")).to_have_attribute("href", site["base"] + "workbench-v6.html?case=c1")
    expect(page.locator("#internal-form")).to_have_attribute("action", site["base"] + "workbench-v6.html")
    back = PREFIX + "workbench-v6.html?case=preserved&arm=C&reading=R2"
    page.goto(site["base"] + "graph-full-v6.html?" + urlencode(dict(return_to=back)))
    page.wait_for_function("window.earlyShimWorked===true")
    expect(page.locator("#full-workbench-link")).to_have_attribute("href", site["base"] + "workbench-v6.html?case=preserved&arm=C&reading=R2")
    page.evaluate("document.querySelector('#mount').innerHTML='<a id=dynamic href=/graph-full-v6.html?corpus=iran>Map</a>'")
    expect(page.locator("#dynamic")).to_have_attribute("href", site["base"] + "graph-full-v6.html?corpus=iran")


def test_runtime_native_anchor_is_verified_replay_not_api_navigation(page):
    page.locator("#native").click()
    expect(page.locator("#replay-status")).to_have_attribute("data-state", "verified")
    expect(page.locator("#replay-json")).to_contain_text('"full_walk_exported": false')
    assert "/runtime/replay.html?" in page.url and "/api/" not in urlsplit(page.url).path


@pytest.mark.parametrize("packet_url", ["/api/native-v6?case_id=c1", "/api/cib-pdf?doc_id=d1"])
def test_runtime_direct_replay_without_return_has_usable_project_workbench_link(page, site, packet_url):
    page.goto(site["base"] + "runtime/replay.html?" + urlencode(dict(request=packet_url)))
    expect(page.locator("#replay-status")).to_have_attribute("data-state", "verified")
    back = page.locator("#replay-return")
    expect(back).to_have_attribute("href", site["base"] + "workbench-v6.html")
    assert back.get_attribute("data-public-replay-blocked") is None
    if packet_url.startswith("/api/native-v6"):
        expect(page.locator("#replay-json")).to_contain_text('"public_native_receipt": true')
    else:
        expect(page.locator("#replay-pdf")).to_have_attribute("src", re.compile(r"^blob:"))
    back.click()
    expect(page).to_have_url(site["base"] + "workbench-v6.html")
    page.wait_for_function("window.earlyShimWorked===true")


@pytest.mark.parametrize("packet_url", ["/api/native-v6?case_id=c1", "/api/cib-pdf?doc_id=d1"])
def test_runtime_replay_explicit_return_preserves_case_arm_reading_and_anchor(page, site, packet_url):
    target = PREFIX + "workbench-v6.html?case=c1&arm=C&reading=R2#stage-05"
    page.goto(site["base"] + "runtime/replay.html?" + urlencode(dict(request=packet_url, return_to=target)))
    expect(page.locator("#replay-status")).to_have_attribute("data-state", "verified")
    expected = site["base"] + "workbench-v6.html?case=c1&arm=C&reading=R2#stage-05"
    back = page.locator("#replay-return")
    expect(back).to_have_attribute("href", expected)
    assert back.get_attribute("data-public-replay-blocked") is None
    back.click()
    expect(page).to_have_url(expected)
    page.wait_for_function("window.earlyShimWorked===true")


@pytest.mark.parametrize("target", [
    "https://example.org/workbench-v6.html", "//example.org/workbench-v6.html",
    "javascript:alert(1)", "../private/secret.html", "/%2e%2e/private/secret.html",
])
def test_runtime_replay_unsafe_explicit_return_rejected_with_safe_fallback(page, site, target):
    nonlocal_requests = []
    page.context.route("https://example.org/**", lambda route: (nonlocal_requests.append(route.request.url), route.abort()))
    page.goto(site["base"] + "runtime/replay.html?" + urlencode(dict(
        request="/api/native-v6?case_id=c1", return_to=target)))
    expect(page.locator("#replay-status")).to_have_attribute("data-state", "unavailable")
    back = page.locator("#replay-return")
    expect(back).to_have_attribute("href", site["base"] + "workbench-v6.html")
    assert back.get_attribute("data-public-replay-blocked") is None
    back.click()
    expect(page).to_have_url(site["base"] + "workbench-v6.html")
    page.wait_for_function("window.earlyShimWorked===true")
    assert nonlocal_requests == []
    assert not any("/private/" in row["path"] for row in site["requests"])


def test_runtime_pdf_iframe_property_and_attribute_rewrite_no_api_request(page, site):
    page.evaluate("""()=>{const frame=document.createElement('iframe');frame.id='pdf-frame';
      frame.src='/api/cib-pdf?doc_id=d1#page=2';document.body.append(frame);}""")
    frame = page.locator("#pdf-frame")
    expect(frame).to_have_attribute("src", re.compile("/a-different-project/runtime/replay.html\\?request=.*#page=2"))
    inner = page.frame_locator("#pdf-frame")
    expect(inner.locator("#replay-status")).to_have_attribute("data-state", "verified")
    expect(inner.locator("#replay-pdf")).to_have_attribute("src", re.compile(r"^blob:.*#page=2$"))
    page.evaluate("document.querySelector('#pdf-frame').setAttribute('src','/api/cib-pdf?doc_id=d1#page=3')")
    expect(frame).to_have_attribute("src", re.compile("#page=3$"))
    assert not any("/api/cib-pdf" in r["path"].split("?")[0] for r in site["requests"])


def test_runtime_pdf_anchor_and_window_open_keep_scoped_replay(page):
    with page.expect_popup() as opened:
        page.locator("#pdf").click()
    popup = opened.value
    try:
        expect(popup.locator("#replay-status")).to_have_attribute("data-state", "verified")
        assert popup.url.endswith("#page=2")
    finally:
        popup.close()
    with page.expect_popup() as opened:
        page.evaluate("window.open('/api/cib-pdf?doc_id=d1','_blank')")
    popup = opened.value
    try:
        expect(popup.locator("#replay-status")).to_have_attribute("data-state", "verified")
    finally:
        popup.close()


def test_runtime_unexported_pdf_is_archive_label_without_navigation(page, site):
    label = page.locator("#local-pdf")
    expect(label).to_have_text("PDF available in local archive")
    expect(label).to_have_attribute("aria-disabled", "true")
    expect(label).to_have_attribute("title", "Original transcript remains inspectable; this PDF is outside public cited-document subset.")
    assert label.get_attribute("href") is None
    assert label.get_attribute("data-public-pdf-request") == "/api/cib-pdf?doc_id=not-public#page=2"
    assert page.evaluate("PublicReplay.hasSaved('/api/cib-pdf?document_id=d1')") is True
    assert page.evaluate("PublicReplay.hasSaved('/api/cib-pdf?doc_id=not-public')") is False
    assert page.evaluate("PublicReplay.hasSaved('https://example.org/api/cib-pdf?doc_id=d1')") is False
    before_url, before_requests = page.url, len(site["requests"])
    label.evaluate("node=>node.click()")
    assert page.url == before_url and len(page.context.pages) == 1
    assert page.evaluate("window.open('/api/cib-pdf?doc_id=not-public')===null") is True
    assert len(site["requests"]) == before_requests
    missing = fetch_json(page, "/api/cib-pdf?doc_id=not-public")
    assert missing["status"] == 404 and missing["body"]["code"] == "PUBLIC_PACKET_NOT_EXPORTED"


def test_runtime_pdf_links_created_before_index_are_rescanned_when_ready(browser, site):
    context = browser.new_context(service_workers="block")
    page = context.new_page()
    waiting = []
    page.route("**/data/api-index.json", lambda route: waiting.append(route))
    try:
        page.goto(site["base"] + "workbench-v6.html", wait_until="domcontentloaded")
        assert len(waiting) == 1
        assert page.evaluate("PublicReplay.hasSaved('/api/cib-pdf?doc_id=d1')") is False
        expect(page.locator("#local-pdf")).to_have_attribute("href", re.compile("/runtime/replay.html"))
        waiting.pop().continue_()
        page.wait_for_function("window.earlyShimWorked===true")
        expect(page.locator("#local-pdf")).to_have_attribute("aria-disabled", "true")
        assert page.locator("#local-pdf").get_attribute("href") is None
        expect(page.locator("#pdf")).to_have_attribute("href", re.compile("/runtime/replay.html"))
        assert page.evaluate("PublicReplay.hasSaved('/api/cib-pdf?doc_id=d1')") is True
    finally:
        context.close()


def test_runtime_public_https_citation_is_ordinary_link_but_fetch_is_denied(page, site):
    expect(page.locator("#citation")).to_have_attribute("href", "https://example.org/source")
    expect(page.locator("#citation")).to_have_attribute("rel", "noopener noreferrer")
    assert fetch_json(page, "https://example.org/source")["body"]["code"] == "NONLOCAL_REQUEST"
    page.context.route("https://example.org/source", lambda route: route.fulfill(body="Public citation fixture; no external connection"))
    with page.expect_popup() as opened:
        page.locator("#citation").click()
    popup = opened.value
    try:
        popup.wait_for_load_state()
        assert popup.url == "https://example.org/source" and popup.evaluate("window.opener===null")
    finally:
        popup.close()


@pytest.mark.parametrize("url", ["javascript:alert(1)", "file:///etc/passwd", "http://example.org/source",
                               "https://127.0.0.1/source", "https://192.168.1.1/source", "https://[::1]/source",
                               "data:text/html,bad", "https://2130706433/source"])
def test_runtime_nonpublic_citation_links_are_blocked(page, url):
    page.evaluate("url=>{const a=document.createElement('a');a.id='unsafe';a.href=url;a.textContent='Unsafe';document.body.append(a);}", url)
    page.locator("#unsafe").click()
    expect(page.locator("#public-replay-notice")).to_contain_text("outside the saved public demo")
    assert not page.locator("#unsafe").get_attribute("rel")


def test_runtime_missing_archive_is_explicit_not_current_casebook(page):
    page.locator("#archive").click()
    expect(page.locator("#replay-status")).to_have_attribute("data-state", "unavailable")
    expect(page.locator("#replay-status")).to_contain_text("historical archive is not included")


@pytest.mark.parametrize("defect", ["traversal", "external", "private", "unknown_codec"])
def test_runtime_malformed_manifest_fails_before_packet_fetch(browser, site, defect):
    index = json.loads((site["root"] / "data/api-index.json").read_text())
    entry = index["entries"][key("/api/condition-v6", case_id="c1", config="llm_readings")]
    if defect == "traversal": entry["path"] = "packets/../../private/secret.json"
    elif defect == "external": entry["path"] = "https://example.org/secret.json"
    elif defect == "private": entry["path"] = "packets/private/secret.json"
    else: entry["encoding"] = "not-a-defined-codec"
    (site["root"] / "data/api-index.json").write_bytes(encoded(index))
    (site["root"] / "client.js").write_text("window.clientReady=PublicReplay.ready.catch(()=>{});")
    context = browser.new_context()
    page = context.new_page()
    try:
        page.goto(site["base"] + "workbench-v6.html")
        page.wait_for_function("window.PublicReplay!==undefined")
        result = fetch_json(page, "/api/condition-v6?case_id=c1")
        assert result["status"] >= 400 and result["body"]["status"] == "UNAVAILABLE"
        assert not any("/packets/" in r["path"] or "/api/" in r["path"] for r in site["requests"])
    finally:
        context.close()


def test_runtime_saved_fetch_never_forwards_browser_cookie(page, site):
    page.context.add_cookies([dict(name="local-cookie", value="private", url=site["base"])])
    assert fetch_json(page, "/api/source-v6?case_id=c1&source_id=p1")["status"] == 200
    packets = [r for r in site["requests"] if "/packets/" in r["path"]]
    assert packets and all(r["cookie"] is None and r["authorization"] is None for r in packets)


def test_runtime_pdf_get_form_uses_saved_replay_not_python_api(page):
    page.locator("#pdf-form").evaluate("form=>form.requestSubmit()")
    expect(page.locator("#replay-status")).to_have_attribute("data-state", "verified")
    assert "/runtime/replay.html?" in page.url


def test_runtime_rejects_external_base_before_index_request(browser, site):
    path = site["root"] / "index.html"
    path.write_text(path.read_text().replace('data-site-base="../"', 'data-site-base="https://example.org/"'))
    context = browser.new_context()
    page = context.new_page()
    seen = []
    page.on("request", lambda request: seen.append(request.url))
    try:
        page.goto(site["base"] + "index.html")
        assert not page.evaluate("Boolean(window.PublicReplay)")
        assert all(url.startswith(site["base"]) for url in seen)
        assert not any("api-index.json" in url for url in seen)
    finally:
        context.close()

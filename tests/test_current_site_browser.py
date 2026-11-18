"""Opt-in integration of the installed site and real, pinned graph datasets.

The HTTP server is static. Approved GitHub dataset requests are fulfilled from
their identical local bytes; all other external traffic is blocked. This is
not a claim that GitHub Pages itself has deployed successfully.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest


pytestmark = pytest.mark.skipif(os.environ.get("MATRYOSHKA_TEST_PUBLIC_SITE") != "1",
    reason="Set MATRYOSHKA_TEST_PUBLIC_SITE=1 after installing the actual publication")
PACKAGE = Path(__file__).resolve().parents[1]
PREFIX = "/a-nested-demo/"


@pytest.fixture(scope="module")
def actual_site():
    site = PACKAGE / "site"
    publication = json.loads((site / "publication.json").read_bytes())
    dataset = json.loads((PACKAGE / "datasets/manifest.json").read_bytes())
    index = json.loads((site / "data/api-index.json").read_bytes())
    raw_root = "https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/" + publication["graph_data_manifest"]["commit"] + "/"
    allowed = {raw_root + row["path"]:PACKAGE / row["path"] for row in dataset["files"]}
    backend = []
    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path):
            if path.startswith(PREFIX):
                path = "/" + path[len(PREFIX):]
            return super().translate_path(path)
        def do_GET(self):
            if "/api/" in urlsplit(self.path).path:
                backend.append(self.path)
            super().do_GET()
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(site)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield dict(site=site, publication=publication, dataset=dataset, index=index,
            base="http://127.0.0.1:" + str(server.server_port) + PREFIX,
            allowed=allowed, backend=backend)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture(scope="module")
def managed_browser():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as engine:
        browser = engine.chromium.launch(headless=True)
        try:
            yield browser
        finally:
            browser.close()


@pytest.fixture(params=[(1440, 1000), (390, 844)], ids=["desktop", "mobile"])
def actual_page(request, actual_site, managed_browser):
    width, height = request.param
    context = managed_browser.new_context(viewport=dict(width=width, height=height))
    errors, blocked, fetched = [], [], []
    def route_request(route):
        url = route.request.url
        if url.startswith(actual_site["base"].split(PREFIX)[0] + "/"):
            route.continue_()
        elif url in actual_site["allowed"]:
            fetched.append(url)
            route.fulfill(status=200, content_type="application/octet-stream",
                body=actual_site["allowed"][url].read_bytes(), headers={"Access-Control-Allow-Origin":"*"})
        else:
            blocked.append(url)
            route.abort()
    context.route("**/*", route_request)
    page = context.new_page()
    page.set_default_timeout(120_000)
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        yield page, width, errors, blocked, fetched
        assert errors == []
        assert blocked == []
        assert actual_site["backend"] == []
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 2")
    finally:
        context.close()


def artifact(page, name, width):
    output = PACKAGE / "tests/artifacts/current-release"
    output.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(output / (name + "-" + str(width) + ".png")))


def test_latest_cib_map_keeps_native_authority_and_source_senses(actual_page, actual_site):
    page, width, *_ = actual_page
    current = next(v for v in actual_site["dataset"]["graph_releases"].values()
        if v["corpus"] == "cib" and v["role"] == "current-exploration")
    page.goto(actual_site["base"] + "graph-full-v6.html?corpus=cib&q=Voroshilov&scope=entity", wait_until="networkidle")
    page.wait_for_function("state.data && state.searchResults.current.length > 0")
    assert page.evaluate("refreshBinding.graph_run_id") == current["graph_id"]
    assert page.evaluate("state.data.schema_version") == "cib-legacy-current-comparison/4.9"
    assert page.evaluate("state.data._identity_authority_mode") == "native"
    rows = page.evaluate("state.searchResults.current.map(r=>({id:r.id,label:r.label,authority:r.instance_identity_asserted}))")
    names = {r["label"].lower() for r in rows}
    assert "voroshilov" in names and "the voroshilov" in names
    ship_index = next(i for i,r in enumerate(rows) if r["label"].lower() == "the voroshilov")
    page.locator(f'[data-search-panel="current"][data-search-index="{ship_index}"]').click()
    page.wait_for_function("state.panels.current.selected && state.panels.current.selected.label.toLowerCase() === 'the voroshilov'")
    assert page.evaluate("state.panels.current.selected.instance_identity_asserted") is True
    assert "source-specific identity" in page.locator('[data-panel="current"] .inspector').inner_text()
    artifact(page, "cib-native-ship", width)
    button = page.locator('[data-panel="current"] [data-cib-document]').first
    button.click()
    page.wait_for_function("document.body.innerText.includes('Voroshilov') && document.querySelector('mark')")
    artifact(page, "cib-native-source", width)


@pytest.mark.parametrize("corpus", ["iran", "vietnam"])
def test_legacy_cable_maps_still_load_without_false_identity_authority(actual_page, actual_site, corpus):
    page, width, *_ = actual_page
    page.goto(actual_site["base"] + "graph-full-v6.html?corpus=" + corpus, wait_until="networkidle")
    page.wait_for_function("state.data && state.panels.current && state.panels.current.nodes.length > 0")
    assert page.evaluate("state.data._identity_authority_mode") == "legacy"
    assert "identity authority unavailable" in page.locator("#legacy-identity-authority-notice").inner_text().lower()
    artifact(page, corpus + "-legacy", width)


def test_saved_cib_guide_uses_original_map_then_can_open_current_map(actual_page, actual_site):
    page, width, *_ = actual_page
    report = json.loads((actual_site["site"] / "data/report-v6.json").read_bytes())
    cases = {r["case"]["case_id"] for r in report["cases"] if r["case"]["corpus"] == "cib"}
    key = next(k for k in actual_site["index"]["entries"] if k.startswith("/api/guide-v6?")
        and parse_qs(urlsplit(k).query).get("case_id", [None])[0] in cases)
    params = {k:v[0] for k,v in parse_qs(urlsplit(key).query, keep_blank_values=True).items()}
    selection = {"corpus":"cib", **{name:params.get(field, "") for field,name in (
        ("case_id","guide_case"),("config","guide_arm"),("reading","guide_reading"),
        ("candidate_id","guide_candidate"),("route_index","guide_route"))}}
    page.goto(actual_site["base"] + "graph-full-v6.html?" + urlencode(selection), wait_until="networkidle")
    page.wait_for_function("state.guidePath && state.guidePath.packet")
    saved = next(v for v in actual_site["dataset"]["graph_releases"].values()
        if v["corpus"] == "cib" and v["role"] == "saved-study")
    assert page.evaluate("refreshBinding.graph_run_id") == saved["graph_id"]
    assert page.evaluate("state.guidePath.packet.case_id") == params["case_id"]
    assert "Saved study graph" in page.locator("#exploration-scope").inner_text()
    artifact(page, "saved-cib-guide", width)
    link = page.locator("#current-corpus-map-link")
    assert "guide_case" not in link.get_attribute("href")
    link.click()
    page.wait_for_function("state.data && state.data._identity_authority_mode === 'native'")
    assert page.evaluate("!hasSavedGuide(pageParams)")

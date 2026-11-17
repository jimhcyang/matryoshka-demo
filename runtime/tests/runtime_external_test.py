"""Immutable graph transport, with every external request intercepted locally."""
import gzip
import json
from urllib.parse import urlencode

import pytest
from playwright.sync_api import expect

from runtime_browser_test import browser, encoded, fetch_json, sha, site


COMMIT = "a" * 40
PREFIX = "https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/" + COMMIT + "/datasets/"


def install_external(site, corpus="cib"):
    raw = encoded(site["graph"])
    wire = gzip.compress(raw, compresslevel=9, mtime=0)
    logical = "/graph-assets-v4/" + corpus + "/part.json.gz"
    url = PREFIX + corpus + "/" + sha(wire) + ".json.gz"
    entry = dict(external_url=url, encoding="gzip", mime="application/json", sha256=sha(raw), wire_sha256=sha(wire))
    return dict(raw=raw, wire=wire, logical=logical, url=url, entry=entry)


def open_external(browser, site, data, *, body=None, redirect=None):
    index_path = site["root"] / "data/api-index.json"
    index = json.loads(index_path.read_text())
    index["entries"][data["logical"]] = data["entry"]
    index_path.write_bytes(encoded(index))
    context = browser.new_context(service_workers="block")
    context.add_cookies([dict(name="private-cookie", value="not-for-transport", url=data["url"])])
    seen = []

    def intercept(route):
        request = route.request
        if request.url.startswith(site["base"]):
            route.continue_()
            return
        seen.append(dict(url=request.url, method=request.method, headers=request.all_headers()))
        if request.url != data["url"]:
            route.abort()
        elif redirect:
            route.fulfill(status=302, headers={"Location": redirect, "Access-Control-Allow-Origin": "*"})
        else:
            route.fulfill(status=200, body=data["wire"] if body is None else body,
                          headers={"Content-Type": "application/gzip", "Access-Control-Allow-Origin": "*"})

    context.route("**/*", intercept)
    context.add_init_script("""window.transportCalls=[]; const nativeFetch=window.fetch.bind(window);
      window.fetch=(input,options)=>{window.transportCalls.push({url:String(input),
        method:options?.method,credentials:options?.credentials,mode:options?.mode,redirect:options?.redirect});
        return nativeFetch(input,options);};""")
    page = context.new_page()
    page.goto(site["base"] + "workbench-v6.html")
    page.wait_for_function("window.PublicReplay!==undefined")
    return context, page, seen


@pytest.mark.parametrize("corpus", ["cib", "iran", "vietnam"])
def test_external_immutable_graph_gzip_hashes_cors_and_source_unchanged(browser, site, corpus):
    data = install_external(site, corpus)
    context, page, seen = open_external(browser, site, data)
    try:
        page.wait_for_function("window.earlyShimWorked===true")
        result = page.evaluate("""async url=>{const response=await fetch(url);
          const wire=new Uint8Array(await response.arrayBuffer());
          const text=await new Response(new Blob([wire]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
          return {status:response.status,encoding:response.headers.get('content-encoding'),
            magic:Array.from(wire.slice(0,2)),text};}""", data["logical"])
        assert result == dict(status=200, encoding=None, magic=[31, 139], text=data["raw"].decode())
        assert len(seen) == 1 and seen[0]["url"] == data["url"] and seen[0]["method"] == "GET"
        assert "cookie" not in seen[0]["headers"] and "authorization" not in seen[0]["headers"]
        options = page.evaluate("window.transportCalls.filter(call=>call.url.startsWith('https://raw.githubusercontent.com/'))")
        assert options == [dict(url=data["url"], method="GET", credentials="omit", mode="cors", redirect="error")]
        assert page.evaluate("window.saved") == site["condition"]
        assert fetch_json(page, "/api/source-v6?case_id=c1&source_id=p1")["body"] == site["source"]
        assert fetch_json(page, data["url"])["body"]["code"] == "NONLOCAL_REQUEST"
        assert len(seen) == 1
        assert not any("/api/" in request["path"] for request in site["requests"])
    finally:
        context.close()


@pytest.mark.parametrize("mutate", [
    lambda url: url.replace("raw.githubusercontent.com", "example.org"),
    lambda url: url.replace("raw.githubusercontent.com", "raw.githubusercontent.com.example.org"),
    lambda url: url.replace("https://", "http://"),
    lambda url: url.replace("/jimhcyang/", "/someone-else/"),
    lambda url: url.replace("/matryoshka-demo/", "/another-repo/"),
    lambda url: url.replace(COMMIT, "main"),
    lambda url: url.replace(COMMIT, "a" * 39),
    lambda url: url.replace("/datasets/", "/site/"),
    lambda url: url.replace("/cib/", "/unapproved/"),
    lambda url: url.replace("/cib/", "/iran/"),
    lambda url: url + "?download=1",
    lambda url: url + "#section",
    lambda url: url + "\n",
    lambda url: url.replace("https://", "https://user:secret@"),
    lambda url: url.replace(".com/", ".com:443/"),
    lambda url: url.replace("/datasets/", "/site/../datasets/"),
    lambda url: url.replace("/datasets/", "/%64atasets/"),
    lambda url: url.replace(".json.gz", ".json"),
    lambda url: url.replace(".json.gz", ".json.gz/extra"),
], ids=["host", "host-suffix", "http", "owner", "repo", "branch", "short-commit", "directory",
        "corpus", "cross-corpus", "query", "fragment", "newline", "auth", "port", "traversal", "encoding", "extension", "tail"])
def test_external_rejects_nonliteral_unapproved_url_before_any_request(browser, site, mutate):
    data = install_external(site)
    data["entry"]["external_url"] = mutate(data["url"])
    context, page, seen = open_external(browser, site, data)
    try:
        result = fetch_json(page, data["logical"])
        assert result["status"] == 404 and result["body"]["code"] == "INVALID_EXTERNAL_DATASET"
        assert seen == []
        assert not any("/packets/" in request["path"] for request in site["requests"])
    finally:
        context.close()


@pytest.mark.parametrize("defect", ["missing-wire", "missing-decoded", "not-gzip", "not-graph", "unsafe-local-path"])
def test_external_requires_graph_gzip_and_both_hashes(browser, site, defect):
    data = install_external(site)
    if defect == "missing-wire": del data["entry"]["wire_sha256"]
    elif defect == "missing-decoded": del data["entry"]["sha256"]
    elif defect == "not-gzip": data["entry"]["encoding"] = "identity"
    elif defect == "not-graph": data["logical"] = "/data/report-v6.json"
    else: data["entry"]["path"] = "../private/data.json.gz"
    context, page, seen = open_external(browser, site, data)
    try:
        result = fetch_json(page, data["logical"])
        assert result["status"] == 404 and result["body"]["code"] in {"INVALID_EXTERNAL_DATASET", "UNSAFE_MANIFEST_PATH"}
        assert seen == []
    finally:
        context.close()


@pytest.mark.parametrize("pin", ["wire_sha256", "sha256"])
def test_external_digest_failure_does_not_substitute_local_asset(browser, site, pin):
    data = install_external(site)
    data["entry"][pin] = "0" * 64
    data["entry"]["path"] = "graph-assets-v4/cib/part.json.gz"
    context, page, seen = open_external(browser, site, data)
    try:
        page.wait_for_function("window.earlyShimWorked===true")
        result = fetch_json(page, data["logical"])
        assert result["status"] == 502 and result["body"]["code"] == "INTEGRITY_FAILURE"
        assert len(seen) == 1
        assert not any("graph-assets-v4" in request["path"] for request in site["requests"])
        assert fetch_json(page, "/api/source-v6?case_id=c1&source_id=p1")["body"] == site["source"]
    finally:
        context.close()


def test_external_redirect_is_not_followed(browser, site):
    data = install_external(site)
    context, page, seen = open_external(browser, site, data, redirect="https://example.org/not-approved")
    try:
        page.wait_for_function("window.earlyShimWorked===true")
        result = fetch_json(page, data["logical"])
        assert result["status"] >= 400 and result["body"]["status"] == "UNAVAILABLE"
        assert [request["url"] for request in seen] == [data["url"]]
    finally:
        context.close()


def test_external_graph_saved_viewer_supports_entry_without_local_path(browser, site):
    data = install_external(site)
    context, page, seen = open_external(browser, site, data)
    try:
        page.goto(site["base"] + "runtime/replay.html?" + urlencode(dict(request=data["logical"])))
        expect(page.locator("#replay-status")).to_have_attribute("data-state", "verified")
        expect(page.locator("#replay-json")).to_contain_text("Exact graph label")
        expect(page.locator("#replay-download")).to_have_attribute("download", sha(data["wire"]) + ".json")
        assert len(seen) == 1
    finally:
        context.close()

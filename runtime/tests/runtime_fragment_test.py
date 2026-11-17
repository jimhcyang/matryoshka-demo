"""Fragment transport checks on the same static-only managed-browser fixture."""
from copy import deepcopy
import gzip
import importlib.util
import json
from pathlib import Path
import sys

import pytest

from runtime_browser_test import PREFIX, RUNTIME, browser, encoded, fetch_json, key, sha, site


ASSET = "graph-assets-v4/cib/toy.json.gz"
LOGICAL = "/" + ASSET
LEAF = '{"word":"\\u03a9","n":1.2300e+07,"minus":-0,"huge":900719925474099312345,"tag":["$ref",1]}'
EXPECTED = '{"left":' + LEAF + ',"right":' + LEAF + '}'


def install_pack(site, defect=None, many=0, spanning=False):
    directory = site["root"] / "data/packed"
    (directory / "chunks").mkdir(parents=True, exist_ok=True)
    rows = [[ [LEAF] ], [ ["{\"left\":", 1, ",\"right\":", 1, "}"] ], [ ['"unused"'] ]]
    if defect == "self_cycle": rows[1] = [["", 2, ""]]
    if defect == "forward_ref": rows[0] = [["", 2, ""]]
    if defect == "nonascii": rows[0] = [[LEAF.replace("\\u03a9", "\u03a9")]]
    if defect == "depth":
        rows = [[[""]] + [["", identity - 1, ""] for identity in range(2, 16388)]]
    if many: rows = [[[str(i)]] for i in range(many)]
    chunks = []
    first = 1
    for index, fragments in enumerate(rows):
        raw = encoded(dict(version="graph-fragment-dag-chunk/1", first_id=first, fragments=fragments))
        wire = gzip.compress(raw, compresslevel=9, mtime=0)
        filename = "chunks/" + sha(wire) + ".json.gz"
        (directory / filename).write_bytes(wire)
        chunks.append(dict(id=index, path=filename, encoding="gzip", wire_sha256=sha(wire),
                           sha256decoded=sha(raw), decoded_bytes=len(raw), wire_bytes=len(wire),
                           first_id=first, last_id=first + len(fragments) - 1))
        first += len(fragments)
    root = dict(encoding="fragment-dag", pieces=["", 2, ""], dependencies=[0, 1],
                sha256decoded=sha(EXPECTED.encode()), decoded_bytes=len(EXPECTED))
    if defect == "wire_hash": chunks[0]["wire_sha256"] = "0" * 64
    if defect == "decoded_hash": chunks[0]["sha256decoded"] = "0" * 64
    if defect == "root_hash": root["sha256decoded"] = "0" * 64
    if defect == "undeclared": root["dependencies"] = [1]
    if defect == "negative_ref": root["pieces"] = ["", -1, ""]
    if defect == "bool_ref": root["pieces"] = ["", True, ""]
    if defect == "fraction_ref": root["pieces"] = ["", 1.5, ""]
    if defect == "oversize_root": root["decoded_bytes"] = 512 * 1024 ** 2 + 1
    if defect == "oversize_chunk": chunks[0]["decoded_bytes"] = 16 * 1024 ** 2 + 1
    if defect == "inflate_over_declared": chunks[0]["decoded_bytes"] -= 1
    if defect == "traversal_path": chunks[1]["path"] = "../private/secret.json.gz"
    if defect == "overrun_root": root["decoded_bytes"] -= 1
    if defect == "short_root": root["decoded_bytes"] += 1
    if defect == "ranges_gap": chunks[1]["first_id"] += 1
    if defect == "depth":
        root.update(pieces=["", 16387, ""], dependencies=[0], decoded_bytes=0, sha256decoded=sha(b""))
    assets = {ASSET: root}
    if many:
        assets = {f"asset-{i}": dict(encoding="fragment-dag", pieces=["", i + 1, ""], dependencies=[i],
                  sha256decoded=sha(str(i).encode()), decoded_bytes=len(str(i))) for i in range(many)}
        if spanning:
            identities = list(range(1, many + 1)) * 2
            pieces = ["["]
            for i, identity in enumerate(identities):
                pieces.extend([identity, "]" if i == len(identities) - 1 else ","])
            expected = encoded([identity - 1 for identity in identities])
            assets = {ASSET: dict(encoding="fragment-dag", pieces=pieces, dependencies=list(range(many)),
                                 sha256decoded=sha(expected), decoded_bytes=len(expected))}
    manifest = dict(version="graph-fragment-dag/1", status="COMPLETE", encoding="fragment-dag", chunks=chunks, assets=assets)
    raw = encoded(manifest)
    (directory / "manifest.json").write_bytes(raw)
    index = json.loads((site["root"] / "data/api-index.json").read_text())
    for name, value in assets.items():
        logical = LOGICAL if not many or spanning else f"/graph-assets-v4/cib/{name}.json.gz"
        index["entries"][logical] = dict(encoding="fragment-dag", path="data/packed/manifest.json",
            manifest_sha256="0" * 64 if defect == "manifest_hash" else sha(raw),
            asset="not-the-root" if defect == "missing_asset" else name,
            mime="application/json", sha256=value["sha256decoded"])
    if defect == "pin_disagree": index["entries"][LOGICAL]["sha256"] = "0" * 64
    (site["root"] / "data/api-index.json").write_bytes(encoded(index))
    return manifest


def open_page(browser, site):
    context = browser.new_context(service_workers="block")
    page = context.new_page()
    page.goto(site["base"] + "workbench-v6.html")
    page.wait_for_function("window.earlyShimWorked===true")
    return context, page


def test_fragment_exact_number_lexemes_literals_dependencies_and_gzip_parser(browser, site):
    manifest = install_pack(site)
    context, page = open_page(browser, site)
    try:
        result = page.evaluate("""async url=>{const r=await fetch(url);const header=r.headers.get('content-encoding');
          const text=await r.text();return {status:r.status,header,text,value:JSON.parse(text)};}""", LOGICAL)
        assert result["status"] == 200 and result["text"] == EXPECTED and result["header"] == "gzip"
        assert '900719925474099312345' in result["text"] and '1.2300e+07' in result["text"]
        assert result["value"]["left"]["tag"] == ["$ref", 1]
        assert page.evaluate("async url=>{const r=await fetch(url);return (await r.json()).left.tag;}", LOGICAL) == ["$ref", 1]
        fetched = [r["path"].split("?")[0] for r in site["requests"]]
        assert PREFIX + "data/packed/" + manifest["chunks"][2]["path"] not in fetched
        assert fetched.count(PREFIX + "data/packed/manifest.json") == 1
        assert all(fetched.count(PREFIX + "data/packed/" + c["path"]) == 1 for c in manifest["chunks"][:2])
    finally:
        context.close()


@pytest.mark.parametrize("api", [
    key("/api/flow-v6", case_id="c1", config="llm_readings", limit="1024", reading=""),
    key("/api/guide-overlay-v64", candidate_id="red1", case_id="c1", config="llm_readings", reading="", route_index="0"),
    key("/api/node-v6", case_id="c1", node_id="n2"),
])
def test_fragment_hybrid_gzip_bootstrap_and_dag_api_responses(browser, site, api):
    manifest = install_pack(site)
    index_path = site["root"] / "data/api-index.json"
    index = json.loads(index_path.read_text())
    index["entries"][api] = dict(index["entries"][LOGICAL])
    index_path.write_bytes(encoded(index))
    context, page = open_page(browser, site)
    try:
        assert page.evaluate("window.saved") == site["condition"]
        result = page.evaluate("""async url=>{const r=await fetch(url);return {
          status:r.status,mime:r.headers.get('content-type'),
          encoding:r.headers.get('content-encoding'),text:await r.text()};}""", api)
        assert result == dict(status=200, mime="application/json", encoding=None, text=EXPECTED)
        assert page.evaluate("async url=>(await fetch(url)).text()", LOGICAL) == EXPECTED
        fetched = [r["path"].split("?")[0] for r in site["requests"]]
        assert all(fetched.count(PREFIX + "data/packed/" + chunk["path"]) == 1 for chunk in manifest["chunks"][:2])
        assert PREFIX + "data/packed/" + manifest["chunks"][2]["path"] not in fetched
        assert not any("/api/" in path for path in fetched)
    finally:
        context.close()


@pytest.mark.parametrize("defect", [
    "manifest_hash", "wire_hash", "decoded_hash", "root_hash", "pin_disagree",
    "self_cycle", "forward_ref", "undeclared", "negative_ref", "bool_ref", "fraction_ref",
    "nonascii", "oversize_root", "oversize_chunk", "inflate_over_declared", "traversal_path",
    "overrun_root", "short_root", "ranges_gap", "missing_asset", "depth",
])
def test_fragment_rejects_bad_pins_cycles_bounds_and_paths(browser, site, defect):
    manifest = install_pack(site, defect)
    context, page = open_page(browser, site)
    try:
        result = fetch_json(page, LOGICAL)
        assert result["status"] >= 400 and result["body"]["status"] == "UNAVAILABLE"
        assert result["body"]["code"] in {"INTEGRITY_FAILURE", "INVALID_FRAGMENT_DAG", "PUBLIC_SIZE_LIMIT"}
        fetched = [r["path"].split("?")[0] for r in site["requests"]]
        assert all(path.startswith(PREFIX) and "/private/" not in path for path in fetched)
        if defect == "undeclared":
            assert PREFIX + "data/packed/" + manifest["chunks"][0]["path"] not in fetched
        if defect in {"manifest_hash", "pin_disagree", "oversize_root", "oversize_chunk", "traversal_path", "ranges_gap", "missing_asset"}:
            assert not any("/chunks/" in path for path in fetched)
    finally:
        context.close()


def test_fragment_chunk_cache_has_global_count_and_byte_bounds(browser, site):
    manifest = install_pack(site, many=10)
    context, page = open_page(browser, site)
    try:
        for i in range(10):
            assert page.evaluate("async url=>(await fetch(url)).json()", f"/graph-assets-v4/cib/asset-{i}.json.gz") == i
        stats = page.evaluate("PublicReplay.fragmentStats()")
        assert stats["chunks"] == 8 and stats["chunkBytes"] <= 32 * 1024 ** 2
        first = PREFIX + "data/packed/" + manifest["chunks"][0]["path"]
        before = sum(r["path"] == first for r in site["requests"])
        assert page.evaluate("async()=> (await fetch('/graph-assets-v4/cib/asset-0.json.gz')).json()") == 0
        assert sum(r["path"] == first for r in site["requests"]) == before + 1
        assert sum(r["path"] == PREFIX + "data/packed/manifest.json" for r in site["requests"]) == 1
    finally:
        context.close()


def test_fragment_seventy_dependencies_descending_pass_reads_each_chunk_once(browser, site):
    manifest = install_pack(site, many=70, spanning=True)
    context, page = open_page(browser, site)
    try:
        result = page.evaluate("async url=>{const r=await fetch(url);return {status:r.status,text:await r.text()};}", LOGICAL)
        assert result == dict(status=200, text=encoded(list(range(70)) * 2).decode())
        fetched = [r["path"].split("?")[0] for r in site["requests"]]
        expected = [PREFIX + "data/packed/" + chunk["path"] for chunk in reversed(manifest["chunks"])]
        actual = [path for path in fetched if "/chunks/" in path]
        assert actual == expected
        assert len(actual) == 70 and len(set(actual)) == 70
        assert fetched.count(PREFIX + "data/packed/manifest.json") == 1
        stats = page.evaluate("PublicReplay.fragmentStats()")
        assert stats["chunks"] == 8 and stats["chunkBytes"] <= 32 * 1024 ** 2
    finally:
        context.close()


def test_fragment_cached_chunk_does_not_bypass_root_dependency_inventory(browser, site):
    manifest = install_pack(site)
    bad = deepcopy(manifest["assets"][ASSET]); bad["dependencies"] = [1]
    manifest["assets"]["restricted-root"] = bad
    raw = encoded(manifest)
    (site["root"] / "data/packed/manifest.json").write_bytes(raw)
    index_path = site["root"] / "data/api-index.json"
    index = json.loads(index_path.read_text())
    index["entries"][LOGICAL]["manifest_sha256"] = sha(raw)
    index["entries"]["/graph-assets-v4/cib/restricted.json.gz"] = dict(index["entries"][LOGICAL], asset="restricted-root")
    index_path.write_bytes(encoded(index))
    context, page = open_page(browser, site)
    try:
        assert page.evaluate("async url=>(await fetch(url)).text()", LOGICAL) == EXPECTED
        before = len(site["requests"])
        failed = fetch_json(page, "/graph-assets-v4/cib/restricted.json.gz")
        assert failed["body"]["code"] == "INVALID_FRAGMENT_DAG"
        assert len(site["requests"]) == before
    finally:
        context.close()


def test_fragment_actual_packer_small_fixture_roundtrip_without_backend(browser, site, tmp_path):
    packer_path = RUNTIME.parent / "tools/pack_graphs.py"
    spec = importlib.util.spec_from_file_location("public_runtime_packer_fixture", packer_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
        source = tmp_path / "source"
        source.mkdir()
        raw = ('[' + ','.join([LEAF] * 24) + ']').encode()
        (source / "toy.json").write_bytes(raw)
        output = tmp_path / "packed-build"
        selected = [dict(name="toy.json.gz", corpus="cib", category="fixture",
                         ref=dict(path="toy.json", sha256=sha(raw), bytes=len(raw)))]
        module.pack_assets(source, output, selected, minimum=4, template_limit=128, chunk_bytes=2048)
    finally:
        sys.modules.pop(spec.name, None)
    public = site["root"] / "data/actual-pack"
    (public / "chunks").mkdir(parents=True)
    for path in output.rglob("*.json*"):
        target = public / path.relative_to(output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())
    manifest_raw = (public / "manifest.json").read_bytes()
    manifest = json.loads(manifest_raw)
    index_path = site["root"] / "data/api-index.json"
    index = json.loads(index_path.read_text())
    index["entries"][LOGICAL] = dict(encoding="fragment-dag", path="data/actual-pack/manifest.json",
        manifest_sha256=sha(manifest_raw), asset="toy.json.gz", mime="application/json",
        sha256=manifest["assets"]["toy.json.gz"]["sha256decoded"])
    index_path.write_bytes(encoded(index))
    context, page = open_page(browser, site)
    try:
        result = page.evaluate("async url=>{const r=await fetch(url);return {status:r.status,text:await r.text()};}", LOGICAL)
        assert result == dict(status=200, text=raw.decode())
        assert not (public / "build.sqlite3").exists()
    finally:
        context.close()

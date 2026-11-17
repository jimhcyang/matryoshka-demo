"""Synthetic source binding and failure/resume tests; no paid or remote calls."""
import gzip
import importlib.util
import json
from pathlib import Path
import sys

import pytest


TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
SPEC = importlib.util.spec_from_file_location("cib_resource_upgrade", TOOLS / "refresh_cib_resource.py")
upgrade = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(upgrade)


def put(path, value):
    upgrade.atomic(path, upgrade.encoded(value))
    return path


def packet(site, value):
    return upgrade.fast_packet(site, value)


@pytest.fixture
def source(tmp_path):
    workspace, package = tmp_path / "workspace", tmp_path / "workspace/public"
    site = package / "site"
    index, rows = {}, []
    for corpus in ("cib", "iran", "vietnam"):
        row = upgrade.dataset_row(package, f"/graph-assets-v4/{corpus}/old.json",
            upgrade.encoded(dict(nodes=[dict(id="old", text="Original source")], corpus=corpus)),
            "a" * 64, corpus, "old-graph", "old-hierarchy", "unused")
        row.pop("release_key")
        rows.append(row)
        index[upgrade.canonical("/api/graph-v4-viewer", corpus=corpus)] = packet(site, dict(
            graph_run_id="old-graph", hierarchy_run_id="old-hierarchy", comparison_asset="old.json",
            search_asset="old-search.json", comparison_sha256=row["sha256decoded"], pdf_available=False,
            asset_base=f"/graph-assets-v4/{corpus}/", study_graph_id="old-study", study_hierarchy_id="old-study-hierarchy"))
        index[row["logical_key"]] = dict(external_url="https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/" + "a" * 40 + "/" + row["path"],
            encoding="gzip", wire_sha256=row["wire_sha256"], sha256=row["sha256decoded"], mime="application/json")
    saved = "/api/condition-v6?case_id=case&config=llm_readings"
    index[saved] = packet(site, dict(case_id="case", result="Never rewrite inference"))
    put(site / "data/api-index.json", dict(version="matryoshka-public-api-index/1", entries=index))
    (site / "index.html").write_text('<script data-index-sha256="' + "b" * 64 + '"></script>')
    put(package / "datasets/manifest.json", dict(version="public-graph-datasets/1", files=rows,
        source_binding_sha256="b" * 64, source_bodies_modified=False, original_graph_modified=False,
        rights_notice="Synthetic previously public source fixture"))
    put(site / "publication.json", dict(version="public-presentation/6.6", run_id="old", files=[],
        ref=dict(run_id="frozen", sha256="c" * 64), cases=[dict(case_id="case")], case_ids=["case"],
        ui_asset_lineage=[]))
    native_data = workspace / "src/demo/iran_site_visit/web/data"
    comparison = put(native_data / "new-comparison.json", dict(schema_version="cib-legacy-current-comparison/4.9",
        graph_run_id="new-graph", hierarchy_run_id="new-hierarchy", nodes=[dict(id="new", weight=0.125,
            document_id="historical", evidence_quote="Exact historical quotation.")]))
    search = put(native_data / "new-search.json", dict(schema_version="cib-graph-search/3.5", counts={"current_later": 1}))
    summary_root = workspace / "native"
    aliases = summary_root / "aliases"
    graph, hierarchy = summary_root / "new-graph", summary_root / "new-hierarchy"
    alias_summary = put(aliases / "summary.json", dict(status="PASS"))
    graph_summary = put(graph / "summary.json", dict(alias_run_directory=str(aliases)))
    hierarchy_summary = put(hierarchy / "summary.json", dict(graph_run_directory=str(graph)))
    pub = put(summary_root / "publication.json", dict(shard_sha256={}, binding=dict(
        graph_run_id=graph.name, hierarchy_run_id=hierarchy.name, documents=1,
        comparison_asset=comparison.name, search_asset=search.name,
        comparison_sha256=upgrade.sha(comparison.read_bytes()), search_sha256=upgrade.sha(search.read_bytes()))))
    resource = put(summary_root / "resource-1/manifest.json", dict(version="current-source-only-cib-resource/1.1",
        status="READY_FOR_NEW_CIB_ANALYSIS", source_only_policy="source-sense-reconciliation/1.0",
        benchmark_authorized=False, downstream_import_preflight="PASS", entity_mentions=1,
        resources=dict(aliases=str(aliases), graph=str(graph), hierarchy=str(hierarchy)),
        source_bindings={str(p):upgrade.sha(p.read_bytes()) for p in (alias_summary, graph_summary, hierarchy_summary, pub)}))
    return dict(workspace=workspace, package=package, site=site, resource=resource,
        checksum=upgrade.sha(resource.read_bytes()), saved=saved)


def prepare(source):
    return upgrade.prepare(source["workspace"], source["package"], source["resource"], source["checksum"])


def test_preparation_changes_no_workbench_packet_or_native_source(source):
    before = {str(p):p.read_bytes() for p in source["site"].rglob("*") if p.is_file()}
    native = source["resource"].read_bytes()
    result = prepare(source)
    assert result["new_graph_assets"] == 2
    assert result["total_graph_assets"] == 5
    assert {str(p):p.read_bytes() for p in source["site"].rglob("*") if p.is_file()} == before
    assert source["resource"].read_bytes() == native
    dataset = upgrade.read(source["package"] / "datasets/manifest.json")
    assert dataset["version"] == "public-graph-datasets/2"
    assert len(dataset["graph_releases"]) == 4
    assert {r["role"] for r in dataset["graph_releases"].values()} == {"saved-study", "current-exploration", "current-and-saved-study"}
    assert prepare(source) == result


def test_binding_and_source_tampering_fail_before_publication(source):
    source["resource"].write_text("changed")
    with pytest.raises(ValueError, match="commitment changed"):
        prepare(source)
    assert not (source["package"] / ".graph-refresh").exists()


def test_prepared_inventory_cannot_be_replaced_silently(source):
    prepare(source)
    (source["package"] / "datasets/manifest.json").write_text("changed")
    with pytest.raises(ValueError, match="Prepared graph upgrade changed"):
        prepare(source)


def test_activate_keeps_saved_routes_and_distinguishes_current_from_study(source, monkeypatch):
    prepared = prepare(source)
    before = upgrade.read(source["site"] / "data/api-index.json")
    monkeypatch.setattr(upgrade, "verified_data_commit", lambda *a: None)
    result = upgrade.activate(source["package"], "resource-1", "d" * 40)
    after = upgrade.read(source["site"] / "data/api-index.json")
    assert after["entries"][source["saved"]] == before["entries"][source["saved"]]
    current = upgrade.local_packet(source["site"], after["entries"][upgrade.canonical("/api/graph-v4-viewer", corpus="cib")])
    archived = upgrade.local_packet(source["site"], after["entries"][upgrade.canonical("/api/graph-v4-viewer", corpus="cib", revision="study")])
    assert current["graph_run_id"] == "new-graph"
    assert archived["graph_run_id"] == "old-graph"
    assert current["independent_identity_accuracy"] is False
    assert result["saved_routes_unchanged"] and result["api_calls"] == 0
    assert result == upgrade.activate(source["package"], "resource-1", "d" * 40)
    assert upgrade.read(source["site"] / "publication.json")["ref"]["run_id"] == "frozen"


def test_partial_activation_resumes_exactly_without_recomputing_inference(source, monkeypatch):
    prepare(source)
    monkeypatch.setattr(upgrade, "verified_data_commit", lambda *a: None)
    real = upgrade.atomic
    def fail_once(path, raw):
        real(path, raw)
        if path == source["site"] / "data/api-index.json":
            raise OSError("Simulated interruption after one installed target")
    monkeypatch.setattr(upgrade, "atomic", fail_once)
    with pytest.raises(OSError, match="Simulated interruption"):
        upgrade.activate(source["package"], "resource-1", "d" * 40)
    monkeypatch.setattr(upgrade, "atomic", real)
    assert upgrade.activate(source["package"], "resource-1", "d" * 40)["status"] == "ACTIVATED"


def test_intervening_writer_during_partial_activation_is_not_overwritten(source, monkeypatch):
    prepare(source)
    monkeypatch.setattr(upgrade, "verified_data_commit", lambda *a: None)
    real = upgrade.atomic
    def fail_once(path, raw):
        real(path, raw)
        if path == source["site"] / "data/api-index.json":
            raise OSError("stop")
    monkeypatch.setattr(upgrade, "atomic", fail_once)
    with pytest.raises(OSError):
        upgrade.activate(source["package"], "resource-1", "d" * 40)
    html = source["site"] / "index.html"
    html.write_text("Another agent's new page")
    monkeypatch.setattr(upgrade, "atomic", real)
    with pytest.raises(ValueError, match="Another writer changed"):
        upgrade.activate(source["package"], "resource-1", "d" * 40)
    assert html.read_text() == "Another agent's new page"


@pytest.mark.parametrize("commit", ["main", "d" * 39, "https://example.org", "D" * 40])
def test_mutable_or_malformed_dataset_commit_is_never_used(source, commit):
    with pytest.raises(ValueError, match="literal immutable"):
        upgrade.activate(source["package"], "resource-1", commit)


def test_completed_activation_tampering_is_not_resealed(source, monkeypatch):
    prepare(source)
    monkeypatch.setattr(upgrade, "verified_data_commit", lambda *a: None)
    upgrade.activate(source["package"], "resource-1", "d" * 40)
    (source["site"] / "publication.json").write_text("changed")
    with pytest.raises(ValueError, match="Completed public graph activation changed"):
        upgrade.activate(source["package"], "resource-1", "d" * 40)


def test_completed_activation_checks_actual_index_not_only_manifest(source, monkeypatch):
    prepare(source)
    monkeypatch.setattr(upgrade, "verified_data_commit", lambda *a: None)
    upgrade.activate(source["package"], "resource-1", "d" * 40)
    (source["site"] / "data/api-index.json").write_text("changed")
    with pytest.raises(ValueError, match="commitment changed"):
        upgrade.activate(source["package"], "resource-1", "d" * 40)

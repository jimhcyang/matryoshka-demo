"""Offline adversarial contracts for the public CIB upgrade, synthetic data only.

Failures are intentional red-team reproductions until the corresponding
production guard is fixed. No canonical site or native data is written.
"""
from copy import deepcopy
import gzip
from pathlib import Path
import subprocess
import sys

import pytest

from test_cib_resource_upgrade import prepare, source, upgrade
from test_publication_guard import (
    dataset_pin, datasets, guard, read, reseal, sha, site, versioned_datasets,
    wire, write,
)


@pytest.mark.parametrize("target", ["publication", "graph-summary", "alias-summary", "comparison"])
def test_exact_native_dependency_tampering_is_rejected(source, target):
    resource = read(source["resource"].parent, source["resource"].name)
    publication = next(p for p in resource["source_bindings"] if p.endswith("/publication.json"))
    if target == "publication":
        path = Path(publication)
    elif target == "comparison":
        name = read(Path(publication).parent)["binding"]["comparison_asset"]
        path = source["workspace"] / "src/demo/iran_site_visit/web/data" / name
    else:
        path = Path(resource["resources"]["graph" if target == "graph-summary" else "aliases"]) / "summary.json"
    before = (source["package"] / "datasets/manifest.json").read_bytes()
    upgrade.atomic(path, b"changed source dependency")
    with pytest.raises(ValueError, match="commitment changed"):
        prepare(source)
    assert (source["package"] / "datasets/manifest.json").read_bytes() == before


def interrupt_activation(source, monkeypatch):
    prepare(source)
    monkeypatch.setattr(upgrade, "verified_data_commit", lambda *args: None)
    real_atomic = upgrade.atomic

    def stop_after_index(path, raw):
        real_atomic(path, raw)
        if path == source["site"] / "data/api-index.json":
            raise OSError("red-team interruption")

    monkeypatch.setattr(upgrade, "atomic", stop_after_index)
    with pytest.raises(OSError, match="red-team interruption"):
        upgrade.activate(source["package"], "resource-1", "d" * 40)
    monkeypatch.setattr(upgrade, "atomic", real_atomic)


@pytest.mark.parametrize("target", ["saved-packet", "new-bootstrap", "dataset-manifest"])
def test_pending_resume_rejects_changed_nonwrite_dependencies(source, monkeypatch, target):
    interrupt_activation(source, monkeypatch)
    index = read(source["site"], "data/api-index.json")
    if target == "dataset-manifest":
        path = source["package"] / "datasets/manifest.json"
    elif target == "saved-packet":
        path = source["site"] / index["entries"][source["saved"]]["path"]
    else:
        stage = source["package"] / ".graph-refresh/resource-1"
        binding = read(stage, "prepared.json")["new_binding"]
        logical = "/graph-assets-v4/cib/" + binding["comparison_asset"]
        path = source["site"] / index["entries"][logical]["path"]
    upgrade.atomic(path, b"changed by another writer")
    with pytest.raises(ValueError):
        upgrade.activate(source["package"], "resource-1", "d" * 40)
    assert not (source["package"] / ".graph-refresh/resource-1/activated.json").exists()


def test_writer_between_snapshot_and_plan_is_not_overwritten(source, monkeypatch):
    prepare(source)
    monkeypatch.setattr(upgrade, "verified_data_commit", lambda *args: None)
    real_atomic = upgrade.atomic
    html = source["site"] / "index.html"
    concurrent = b"Another writer's revised page; do not overwrite"
    intervened = False

    def intervene_while_staging(path, raw):
        nonlocal intervened
        real_atomic(path, raw)
        if "activation-payloads" in path.parts and not intervened:
            intervened = True
            real_atomic(html, concurrent)

    monkeypatch.setattr(upgrade, "atomic", intervene_while_staging)
    rejected = False
    try:
        upgrade.activate(source["package"], "resource-1", "d" * 40)
    except ValueError:
        rejected = True
    assert intervened
    assert html.read_bytes() == concurrent, "Activation overwrote the concurrent writer's page"
    assert rejected, "Activation did not reject an intervening writer"


def test_preparation_interruption_has_a_resumable_checkpoint(source, monkeypatch):
    real_atomic = upgrade.atomic

    def stop_before_marker(path, raw):
        if path.name == "prepared.json":
            raise OSError("red-team preparation interruption")
        real_atomic(path, raw)

    monkeypatch.setattr(upgrade, "atomic", stop_before_marker)
    with pytest.raises(OSError, match="red-team preparation interruption"):
        prepare(source)
    monkeypatch.setattr(upgrade, "atomic", real_atomic)
    assert prepare(source)["status"] == "DATASETS_PREPARED_NOT_ACTIVATED"


def successor_resource(source):
    original = read(source["resource"].parent, source["resource"].name)
    root = source["resource"].parents[1] / "successor"
    graph, hierarchy = root / "next-graph", root / "next-hierarchy"
    graph_summary = graph / "summary.json"
    hierarchy_summary = hierarchy / "summary.json"
    upgrade.atomic(graph_summary, upgrade.encoded(dict(alias_run_directory=original["resources"]["aliases"])))
    upgrade.atomic(hierarchy_summary, upgrade.encoded(dict(graph_run_directory=str(graph))))
    data = source["workspace"] / "src/demo/iran_site_visit/web/data"
    assets = {}
    for kind in ("comparison", "search"):
        asset = data / ("next-" + kind + ".json")
        upgrade.atomic(asset, upgrade.encoded(dict(graph_run_id=graph.name, hierarchy_run_id=hierarchy.name, nodes=[])))
        assets[kind + "_asset"] = asset.name
        assets[kind + "_sha256"] = sha(asset.read_bytes())
    publication = root / "publication.json"
    upgrade.atomic(publication, upgrade.encoded(dict(shard_sha256={}, binding=dict(
        graph_run_id=graph.name, hierarchy_run_id=hierarchy.name, documents=1, **assets))))
    original["resources"].update(graph=str(graph), hierarchy=str(hierarchy))
    alias_summary = source["resource"].parents[1] / "aliases/summary.json"
    original["source_bindings"] = {str(p): sha(p.read_bytes()) for p in (
        alias_summary, graph_summary, hierarchy_summary, publication)}
    resource = root / "resource-2/manifest.json"
    upgrade.atomic(resource, upgrade.encoded(original))
    return resource


def test_v2_successor_refresh_retains_original_study_binding(source, monkeypatch):
    prepare(source)
    monkeypatch.setattr(upgrade, "verified_data_commit", lambda *args: None)
    upgrade.activate(source["package"], "resource-1", "d" * 40)
    key = upgrade.canonical("/api/graph-v4-viewer", corpus="cib", revision="study")
    original = read(source["site"], "data/api-index.json")["entries"][key]
    successor = successor_resource(source)
    upgrade.prepare(source["workspace"], source["package"], successor, sha(successor.read_bytes()))
    upgrade.activate(source["package"], "resource-2", "e" * 40)
    latest = read(source["site"], "data/api-index.json")["entries"][key]
    assert latest == original
    assert upgrade.local_packet(source["site"], latest)["graph_run_id"] == "old-graph"


def test_shared_payload_cannot_claim_two_incompatible_v2_lineages(datasets):
    manifest = versioned_datasets(datasets)
    row = deepcopy(manifest["files"][0])
    row.update(logical_key="/graph-assets-v4/cib/relabelled.json", release_key="saved-release",
        graph_id="a-different-graph", hierarchy_id="a-different-hierarchy")
    manifest["files"].append(row)
    manifest["graph_releases"]["saved-release"] = dict(corpus="cib", graph_id=row["graph_id"],
        hierarchy_id=row["hierarchy_id"], role="saved-study", alias_review_status="legacy-not-revalidated")
    original = datasets / manifest["files"][0]["path"].removeprefix("datasets/")
    payload = wire(dict(graph_run_id="browser_graph", hierarchy_run_id="hierarchy-1", nodes=[]))
    compressed = gzip.compress(payload, mtime=0)
    relative = "cib/" + sha(compressed) + ".json.gz"
    upgrade.atomic(datasets / relative, compressed)
    original.unlink()
    for record in manifest["files"]:
        record.update(path="datasets/" + relative, bytes=len(compressed), wire_sha256=sha(compressed),
            sha256decoded=sha(payload))
    write(datasets, manifest, "manifest.json")
    with pytest.raises(guard.PublicationError):
        guard.validate_datasets(datasets, dataset_pin(datasets), source_ids=("cib",))


@pytest.fixture
def versioned_publication(site, datasets):
    manifest = versioned_datasets(datasets)
    saved_key = "saved-release"
    payload = upgrade.encoded(dict(graph_run_id="saved-graph", hierarchy_run_id="saved-hierarchy", nodes=[]))
    row = upgrade.dataset_row(datasets.parent, "/graph-assets-v4/cib/saved.json", payload,
        sha(payload), "cib", "saved-graph", "saved-hierarchy", saved_key)
    manifest["files"].append(row)
    manifest["graph_releases"][saved_key] = dict(corpus="cib", graph_id="saved-graph",
        hierarchy_id="saved-hierarchy", role="saved-study", alias_review_status="legacy-not-revalidated")
    write(datasets, manifest, "manifest.json")
    pub = read(site)
    pub["graph_data_manifest"] = dict(path="datasets/manifest.json", sha256=dataset_pin(datasets), commit="1" * 40)
    write(site, pub)
    index = read(site, "api/index.json")
    for record in manifest["files"]:
        index["entries"][record["logical_key"]] = dict(
            external_url="https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/" + "1" * 40 + "/" + record["path"],
            encoding="gzip", mime="application/json", sha256=record["sha256decoded"], wire_sha256=record["wire_sha256"])
    current = manifest["files"][0]
    for record, revision in ((current, None), (row, "study")):
        value = dict(graph_run_id=record["graph_id"], hierarchy_run_id=record["hierarchy_id"],
            comparison_asset=record["logical_key"].rsplit("/", 1)[1], comparison_sha256=record["sha256decoded"],
            search_asset=record["logical_key"].rsplit("/", 1)[1], search_sha256=record["sha256decoded"],
            asset_base="/graph-assets-v4/cib/", pdf_available=False)
        key = upgrade.canonical("/api/graph-v4-viewer", corpus="cib", revision=revision)
        index["entries"][key] = upgrade.fast_packet(site, value)
    write(site, index, "api/index.json")
    reseal(site)
    assert guard.validate_publication(site)["status"] == "PASS"
    return site


def test_valid_v2_publication_with_original_study_is_accepted(versioned_publication):
    assert guard.validate_publication(versioned_publication)["status"] == "PASS"


def test_v2_source_resource_metadata_has_no_privacy_exemption(datasets):
    manifest = versioned_datasets(datasets)
    manifest["graph_releases"]["current-release"]["source_resource"] = dict(
        id="synthetic-resource", sha256="f" * 64, audit_path="/Users/fake/private/review.json")
    write(datasets, manifest, "manifest.json")
    with pytest.raises(guard.PublicationError, match="filesystem"):
        guard.validate_datasets(datasets, dataset_pin(datasets), source_ids=("cib",))


def test_v2_does_not_allow_unlisted_dataset_files(datasets):
    versioned_datasets(datasets)
    upgrade.atomic(datasets / ("cib/" + "f" * 64 + ".json.gz"), gzip.compress(b"{}", mtime=0))
    with pytest.raises(guard.PublicationError, match="whitelist differs"):
        guard.validate_datasets(datasets, dataset_pin(datasets), source_ids=("cib",))


@pytest.mark.parametrize("field,value", [
    ("comparison_asset", "saved.json"),
    ("comparison_asset", "not-exported.json"),
    ("comparison_sha256", "f" * 64),
])
def test_v2_viewer_must_bind_actual_current_asset(versioned_publication, field, value):
    site = versioned_publication
    index = read(site, "api/index.json")
    key = upgrade.canonical("/api/graph-v4-viewer", corpus="cib")
    payload = upgrade.local_packet(site, index["entries"][key])
    payload[field] = value
    index["entries"][key] = upgrade.fast_packet(site, payload)
    write(site, index, "api/index.json")
    reseal(site)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


def rewrite_viewer(site, transform, revision=None):
    index = read(site, "api/index.json")
    key = upgrade.canonical("/api/graph-v4-viewer", corpus="cib", revision=revision)
    payload = upgrade.local_packet(site, index["entries"][key])
    transform(payload)
    index["entries"][key] = upgrade.fast_packet(site, payload)
    write(site, index, "api/index.json")
    reseal(site)


@pytest.mark.parametrize("field,value", [
    ("asset_base", "/graph-assets-v4/iran/"),
    ("asset_base", "/graph-assets-v4/cib"),
    ("search_asset", "saved.json"),
    ("search_asset", "missing-search.json"),
    ("search_asset", "../comparison.json"),
    ("search_asset", None),
    ("search_sha256", "f" * 64),
    ("comparison_sha256", None),
])
def test_v2_search_and_asset_base_negative_controls(versioned_publication, field, value):
    rewrite_viewer(versioned_publication, lambda payload: payload.update({field: value}))
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(versioned_publication)


@pytest.mark.parametrize("field", ["search_asset", "search_sha256", "comparison_asset"])
def test_source_reviewed_viewer_cannot_omit_required_selectors(versioned_publication, field):
    rewrite_viewer(versioned_publication, lambda payload: payload.pop(field))
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(versioned_publication)


def test_only_legacy_saved_binding_may_omit_search_checksum(versioned_publication):
    rewrite_viewer(versioned_publication, lambda payload: payload.pop("search_sha256"), revision="study")
    assert guard.validate_publication(versioned_publication)["status"] == "PASS"


@pytest.mark.parametrize("substitution", ["saved-local", "absent", "wrong-hash", "mutable-url"])
def test_v2_viewer_actual_transport_negative_controls(versioned_publication, substitution):
    site = versioned_publication
    index = read(site, "api/index.json")
    viewer_key = upgrade.canonical("/api/graph-v4-viewer", corpus="cib")
    viewer = upgrade.local_packet(site, index["entries"][viewer_key])
    logical = viewer["asset_base"] + viewer["comparison_asset"]
    if substitution == "absent":
        del index["entries"][logical]
    elif substitution == "saved-local":
        saved = dict(graph_run_id="saved-graph", hierarchy_run_id="saved-hierarchy", nodes=[])
        index["entries"][logical] = upgrade.fast_packet(site, saved)
    elif substitution == "wrong-hash":
        index["entries"][logical]["sha256"] = "f" * 64
    else:
        index["entries"][logical]["external_url"] = index["entries"][logical]["external_url"].replace("1" * 40, "main")
    write(site, index, "api/index.json")
    reseal(site)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


@pytest.mark.parametrize("target", ["dataset-asset", "extra-site-file", "deleted-site-file"])
def test_pending_resume_inventory_and_bulk_dependency_controls(source, monkeypatch, target):
    interrupt_activation(source, monkeypatch)
    if target == "dataset-asset":
        row = read(source["package"] / "datasets", "manifest.json")["files"][0]
        upgrade.atomic(source["package"] / row["path"], b"changed stored dataset")
    elif target == "extra-site-file":
        upgrade.atomic(source["site"] / "data/unlisted.json", b"{}")
    else:
        index = read(source["site"], "data/api-index.json")
        (source["site"] / index["entries"][source["saved"]]["path"]).unlink()
    with pytest.raises((ValueError, OSError)):
        upgrade.activate(source["package"], "resource-1", "d" * 40)


def test_cooperating_operation_lock_excludes_other_process_and_releases_on_error(source):
    probe = """import fcntl, sys
with open(sys.argv[1], 'a') as handle:
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(23)
"""
    args = [sys.executable, "-B", "-c", probe, str(source["package"] / ".graph-refresh.lock")]
    with pytest.raises(ValueError, match="test release"):
        with upgrade.operation_lock(source["package"]):
            assert subprocess.run(args, capture_output=True, timeout=5).returncode == 23
            raise ValueError("test release")
    assert subprocess.run(args, capture_output=True, timeout=5).returncode == 0


def test_pending_preparation_rejects_an_intervening_api_index(source, monkeypatch):
    real_atomic = upgrade.atomic

    def stop_before_marker(path, raw):
        if path.name == "prepared.json":
            raise OSError("new preparation boundary control")
        real_atomic(path, raw)

    monkeypatch.setattr(upgrade, "atomic", stop_before_marker)
    with pytest.raises(OSError, match="new preparation boundary control"):
        prepare(source)
    monkeypatch.setattr(upgrade, "atomic", real_atomic)
    real_atomic(source["site"] / "data/api-index.json", b"another writer")
    with pytest.raises(ValueError, match="commitment changed"):
        prepare(source)


@pytest.mark.parametrize("target", ["saved-packet", "data-shard", "extra-site-file"])
def test_activation_rechecks_dependencies_after_installation_starts(source, monkeypatch, target):
    prepare(source)
    monkeypatch.setattr(upgrade, "verified_data_commit", lambda *args: None)
    real_atomic = upgrade.atomic
    index = read(source["site"], "data/api-index.json")
    if target == "saved-packet":
        path = source["site"] / index["entries"][source["saved"]]["path"]
    elif target == "data-shard":
        row = read(source["package"] / "datasets", "manifest.json")["files"][0]
        path = source["package"] / row["path"]
    else:
        path = source["site"] / "data/unlisted.json"

    def intervene_during_installation(destination, raw):
        real_atomic(destination, raw)
        if destination == source["site"] / "data/api-index.json":
            real_atomic(path, b"changed after dependency preflight")

    monkeypatch.setattr(upgrade, "atomic", intervene_during_installation)
    with pytest.raises(ValueError):
        upgrade.activate(source["package"], "resource-1", "d" * 40)
    assert not (source["package"] / ".graph-refresh/resource-1/activated.json").exists()


@pytest.mark.parametrize("target", ["unlisted-site-file", "dataset-shard"])
def test_completed_activation_rechecks_inventory_and_bulk_data(source, monkeypatch, target):
    prepare(source)
    monkeypatch.setattr(upgrade, "verified_data_commit", lambda *args: None)
    upgrade.activate(source["package"], "resource-1", "d" * 40)
    if target == "unlisted-site-file":
        upgrade.atomic(source["site"] / "data/unlisted.json", b"{}")
    else:
        row = read(source["package"] / "datasets", "manifest.json")["files"][0]
        upgrade.atomic(source["package"] / row["path"], b"changed bulk data")
    with pytest.raises(ValueError):
        upgrade.activate(source["package"], "resource-1", "d" * 40)


def shared_release_manifest(datasets, carries_identity):
    manifest = versioned_datasets(datasets)
    old = datasets / manifest["files"][0]["path"].removeprefix("datasets/")
    value = dict(nodes=[])
    if carries_identity:
        value.update(graph_run_id="browser_graph", hierarchy_run_id="hierarchy-1")
    payload = upgrade.encoded(value)
    current = upgrade.dataset_row(datasets.parent, "/graph-assets-v4/cib/comparison.json", payload,
        sha(payload), "cib", "browser_graph", "hierarchy-1", "current-release")
    old.unlink()
    saved = dict(current, logical_key="/graph-assets-v4/cib/saved.json", graph_id="saved-graph",
        hierarchy_id="saved-hierarchy", release_key="saved-release")
    manifest["files"] = [current, saved]
    manifest["graph_releases"]["saved-release"] = dict(corpus="cib", graph_id="saved-graph",
        hierarchy_id="saved-hierarchy", role="saved-study", alias_review_status="legacy-not-revalidated")
    write(datasets, manifest, "manifest.json")
    return manifest


def test_graph_agnostic_shards_can_be_shared_with_an_archived_release(datasets):
    manifest = shared_release_manifest(datasets, carries_identity=False)
    archived = dict(manifest["files"][0], logical_key="/graph-assets-v4/cib/intermediate.json",
        graph_id="intermediate-graph", hierarchy_id="intermediate-hierarchy", release_key="intermediate-release")
    manifest["files"].append(archived)
    manifest["graph_releases"]["intermediate-release"] = dict(corpus="cib", graph_id=archived["graph_id"],
        hierarchy_id=archived["hierarchy_id"], role="archived-exploration", alias_review_status="source-reviewed")
    write(datasets, manifest, "manifest.json")
    assert guard.validate_datasets(datasets, dataset_pin(datasets), source_ids=("cib",))["status"] == "PASS"


def test_failed_logical_lineage_scan_cannot_issue_a_reusable_pass(datasets, tmp_path):
    shared_release_manifest(datasets, carries_identity=True)
    checker = guard.GraphDatasets(datasets, dataset_pin(datasets), source_ids=("cib",))
    with pytest.raises(guard.PublicationError, match="shared decoded graph asset lineage"):
        checker.verify()
    try:
        proof = guard.dataset_proof(checker, checker.summary())
    except guard.PublicationError:
        return
    path = tmp_path / "qa/failed-scan.json"
    guard.write_dataset_proof(path, proof)
    reference = dict(path=path, sha256=sha(path.read_bytes()))
    result = guard.validate_datasets(datasets, dataset_pin(datasets), source_ids=("cib",), proof_ref=reference)
    pytest.fail("A failed full scan issued a reusable proof accepted as " + result["status"])


def synthetic_full_scan_proof(datasets, tmp_path):
    checker = guard.GraphDatasets(datasets, dataset_pin(datasets), source_ids=("cib",))
    result = checker.verify()
    proof = guard.dataset_proof(checker, result)
    path = tmp_path / "qa/completed-scan.json"
    guard.write_dataset_proof(path, proof)
    return result, dict(path=path, sha256=sha(path.read_bytes()))


def assert_no_scan_authority(checker, previous_result=None):
    assert checker._full_scan_completed is False
    assert checker._trusted_replay_completed is False
    with pytest.raises(guard.PublicationError, match="completed full dataset scan"):
        checker.summary()
    template = checker._summary() if previous_result is None else previous_result
    with pytest.raises(guard.PublicationError, match="completed full dataset scan"):
        guard.dataset_proof(checker, template)


def test_unverified_summary_and_private_template_cannot_authorize_a_proof(datasets):
    checker = guard.GraphDatasets(datasets, dataset_pin(datasets), source_ids=("cib",))
    assert_no_scan_authority(checker)


def test_late_logical_failure_blocks_summary_and_direct_proof_issuance(datasets):
    shared_release_manifest(datasets, carries_identity=True)
    checker = guard.GraphDatasets(datasets, dataset_pin(datasets), source_ids=("cib",))
    with pytest.raises(guard.PublicationError, match="shared decoded graph asset lineage"):
        checker.verify()
    assert set(checker.verified) == set(checker.paths)
    assert_no_scan_authority(checker)


def test_failed_final_unchanged_check_blocks_summary_and_proof(datasets, monkeypatch):
    checker = guard.GraphDatasets(datasets, dataset_pin(datasets), source_ids=("cib",))

    def changed_at_end():
        raise guard.PublicationError("synthetic final unchanged failure")

    monkeypatch.setattr(checker, "unchanged", changed_at_end)
    with pytest.raises(guard.PublicationError, match="synthetic final unchanged failure"):
        checker.verify()
    assert set(checker.verified) == set(checker.paths)
    assert_no_scan_authority(checker)


@pytest.mark.parametrize("prior_authority", ["full-scan", "trusted-replay"])
def test_failed_rescan_revokes_prior_authority_and_can_recover(datasets, tmp_path, prior_authority):
    original_result, reference = synthetic_full_scan_proof(datasets, tmp_path)
    checker = guard.GraphDatasets(datasets, dataset_pin(datasets), source_ids=("cib",))
    if prior_authority == "full-scan":
        checker.verify()
    else:
        guard.reuse_dataset_proof(checker, reference)
    row = next(iter(checker.paths.values()))
    path = datasets.parent / row["path"]
    original = path.read_bytes()
    upgrade.atomic(path, b"bad")
    with pytest.raises(guard.PublicationError, match="stored byte count mismatch"):
        checker.verify()
    assert checker.verified == {}
    assert_no_scan_authority(checker, original_result)
    upgrade.atomic(path, original)
    result = checker.verify()
    assert result["status"] == "PASS"
    assert guard.dataset_proof(checker, result)["full_privacy_scan"] is True


def test_trusted_replay_cannot_issue_a_fresh_fullscan_proof(datasets, tmp_path):
    _, reference = synthetic_full_scan_proof(datasets, tmp_path)
    checker = guard.GraphDatasets(datasets, dataset_pin(datasets), source_ids=("cib",))
    result = guard.reuse_dataset_proof(checker, reference)
    assert result["status"] == "PASS"
    assert checker._trusted_replay_completed is True
    assert checker._full_scan_completed is False
    with pytest.raises(guard.PublicationError, match="completed full dataset scan"):
        guard.dataset_proof(checker, checker.summary())


def test_changed_policy_invalidates_an_approved_synthetic_proof(datasets, tmp_path, monkeypatch):
    _, reference = synthetic_full_scan_proof(datasets, tmp_path)
    checker = guard.GraphDatasets(datasets, dataset_pin(datasets), source_ids=("cib",))
    monkeypatch.setattr(guard, "checker_policy_sha256", lambda: "0" * 64)
    with pytest.raises(guard.PublicationError, match="checker/current code changed"):
        guard.reuse_dataset_proof(checker, reference)
    assert_no_scan_authority(checker)


def test_replay_cannot_be_used_to_issue_a_new_fullscan_output(datasets, tmp_path):
    _, reference = synthetic_full_scan_proof(datasets, tmp_path)
    output = tmp_path / "qa/not-a-new-full-scan.json"
    with pytest.raises(guard.PublicationError, match="do not issue a new full-scan proof"):
        guard.validate_datasets(datasets, dataset_pin(datasets), source_ids=("cib",),
            proof_ref=reference, proof_output=output)
    assert not output.exists()

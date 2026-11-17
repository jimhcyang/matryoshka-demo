"""Publish a verified CIB map without rebinding saved inference to a new graph.

Preparation installs content-addressed datasets only. After that data commit is
published, activation pins it in the finite static transport. No model calls or
native research artifact writes occur in either phase.
"""
from copy import deepcopy
from contextlib import contextmanager
import argparse
import fcntl
import gzip
import json
from pathlib import Path
import re
import subprocess

from export_replays import atomic, canonical, encoded, public_metadata, read, sha


VERSION = "public-cib-resource-upgrade/1"
MANIFEST_VERSION = "public-graph-datasets/2"


@contextmanager
def operation_lock(package):
    path = package / ".graph-refresh.lock"
    if path.is_symlink():
        raise ValueError("Upgrade lock cannot be a symlink")
    with path.open("a") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def checked_bytes(path, expected):
    path = Path(path).absolute()
    if path.resolve(strict=True) != path or not path.is_file():
        raise ValueError("Source must be a regular, non-symlink file")
    raw = path.read_bytes()
    if sha(raw) != expected:
        raise ValueError("Source byte commitment changed: " + path.name)
    return raw


def local_packet(site, entry):
    relative = Path(entry["path"])
    if relative.is_absolute() or ".." in relative.parts or entry.get("external_url"):
        raise ValueError("A saved binding must have a local immutable packet")
    raw = checked_bytes(site / relative, entry["wire_sha256"])
    payload = gzip.decompress(raw) if entry["encoding"] == "gzip" else raw
    if sha(payload) != entry["sha256"]:
        raise ValueError("Saved binding decoded commitment changed")
    return json.loads(payload)


def release_key(corpus, graph, hierarchy):
    return "release_" + sha(encoded([corpus, graph, hierarchy]))[:24]


def verified_native_resource(path, checksum):
    raw = checked_bytes(path, checksum)
    resource = json.loads(raw)
    if (resource.get("version") != "current-source-only-cib-resource/1.1"
            or resource.get("status") != "READY_FOR_NEW_CIB_ANALYSIS"
            or resource.get("source_only_policy") != "source-sense-reconciliation/1.0"
            or resource.get("benchmark_authorized") is not False
            or resource.get("downstream_import_preflight") != "PASS"):
        raise ValueError("An unverified or unsupported CIB resource cannot be published")
    for name, expected in resource["source_bindings"].items():
        checked_bytes(name, expected)
    receipts = [Path(name) for name in resource["source_bindings"] if Path(name).name == "publication.json"]
    if len(receipts) != 1:
        raise ValueError("Exactly one native publication receipt is required")
    publication = read(receipts[0])
    graph, hierarchy, aliases = (Path(resource["resources"][name]) for name in ("graph", "hierarchy", "aliases"))
    binding = publication["binding"]
    if (binding["graph_run_id"] != graph.name or binding["hierarchy_run_id"] != hierarchy.name
            or Path(read(graph / "summary.json")["alias_run_directory"]) != aliases
            or Path(read(hierarchy / "summary.json")["graph_run_directory"]) != graph):
        raise ValueError("Native alias, graph, hierarchy and publication lineage disagree")
    return resource, publication


def dataset_row(package, logical, raw, original_sha, corpus, graph, hierarchy, key):
    payload = gzip.decompress(raw) if logical.endswith(".gz") else raw
    value = json.loads(payload)
    # Only workstation metadata may change, never quoted historical source text.
    public = encoded(public_metadata(value)) if b"/Users/" in payload or b"/home/" in payload else payload
    if b"/Users/" in public or b"/home/" in public:
        raise ValueError("An unhandled workstation path remains in public metadata")
    wire = raw if logical.endswith(".gz") and public == payload else gzip.compress(public, compresslevel=9, mtime=0)
    if len(wire) >= 95_000_000:
        raise ValueError("A graph shard exceeds the existing repository file guard")
    relative = "datasets/" + corpus + "/" + sha(wire) + ".json.gz"
    target = package / relative
    if target.exists():
        checked_bytes(target, sha(wire))
    else:
        atomic(target, wire)
    return dict(path=relative, bytes=len(wire), wire_sha256=sha(wire), sha256decoded=sha(public),
        corpus=corpus, logical_key=logical, source_wire_sha256=original_sha, graph_id=graph,
        hierarchy_id=hierarchy, release_key=key, all_graph_objects_preserved=True,
        workstation_metadata_removed=public != payload)


def prepare(workspace, package, resource_path, checksum):
    with operation_lock(package):
        return _prepare(workspace, package, resource_path, checksum)


def finish_preparation(package, stage, result):
    """The plan exists before the first mutable dataset pointer changes."""
    marker = package / "datasets/manifest.json"
    current = sha(marker.read_bytes())
    if current not in {result["previous_dataset_manifest_sha256"], result["dataset_manifest_sha256"]}:
        raise ValueError("Another writer changed the dataset preparation target")
    for name, expected in (("previous-api-index.json", result["previous_api_index_sha256"]),
                           ("previous-publication.json", result["previous_publication_sha256"]),
                           ("previous-datasets.json", result["previous_dataset_manifest_sha256"])):
        checked_bytes(stage / name, expected)
    checked_bytes(package / "site/data/api-index.json", result["previous_api_index_sha256"])
    checked_bytes(package / "site/publication.json", result["previous_publication_sha256"])
    payload = checked_bytes(stage / "next-datasets.json", result["dataset_manifest_sha256"])
    if current != result["dataset_manifest_sha256"]:
        atomic(marker, payload)
    atomic(stage / "prepared.json", encoded(result))
    return result


def _prepare(workspace, package, resource_path, checksum):
    resource, publication = verified_native_resource(resource_path, checksum)
    resource_id = resource_path.parent.name
    stage = package / ".graph-refresh" / resource_id
    marker = stage / "prepared.json"
    if marker.exists():
        prior = read(marker)
        if prior["resource_sha256"] != checksum or sha((package / "datasets/manifest.json").read_bytes()) != prior["dataset_manifest_sha256"]:
            raise ValueError("Prepared graph upgrade changed; preserve its original checkpoint")
        return prior
    preparation_plan = stage / "preparation-plan.json"
    if preparation_plan.exists():
        result = read(preparation_plan)
        if result["resource_sha256"] != checksum:
            raise ValueError("Pending preparation has another source commitment")
        return finish_preparation(package, stage, result)
    site = package / "site"
    old_index_raw = (site / "data/api-index.json").read_bytes()
    old_dataset_raw = (package / "datasets/manifest.json").read_bytes()
    old_publication_raw = (site / "publication.json").read_bytes()
    index, dataset = json.loads(old_index_raw), json.loads(old_dataset_raw)
    if dataset["version"] not in {"public-graph-datasets/1", MANIFEST_VERSION}:
        raise ValueError("Unsupported previous graph dataset manifest")
    saved_entries = {corpus: index["entries"].get(canonical("/api/graph-v4-viewer", corpus=corpus, revision="study"),
        index["entries"][canonical("/api/graph-v4-viewer", corpus=corpus)]) for corpus in ("cib", "iran", "vietnam")}
    old_bindings = {corpus: local_packet(site, entry) for corpus, entry in saved_entries.items()}
    releases = deepcopy(dataset.get("graph_releases", {}))
    rows = deepcopy(dataset["files"])
    for row in rows:
        key = row.setdefault("release_key", release_key(row["corpus"], row["graph_id"], row["hierarchy_id"]))
        releases.setdefault(key, dict(corpus=row["corpus"], graph_id=row["graph_id"], hierarchy_id=row["hierarchy_id"],
            role="saved-study" if row["corpus"] == "cib" else "current-and-saved-study", alias_review_status="legacy-not-revalidated"))
    for release in releases.values():
        if release["corpus"] == "cib":
            release["role"] = ("saved-study" if (release["graph_id"], release["hierarchy_id"]) ==
                (old_bindings["cib"]["graph_run_id"], old_bindings["cib"]["hierarchy_run_id"]) else "archived-exploration")
    native = publication["binding"]
    graph, hierarchy = native["graph_run_id"], native["hierarchy_run_id"]
    key = release_key("cib", graph, hierarchy)
    if key in releases:
        raise ValueError("The requested CIB resource is already installed; use its activation checkpoint")
    releases[key] = dict(corpus="cib", graph_id=graph, hierarchy_id=hierarchy,
        role="current-exploration", alias_review_status="source-reviewed-engineering-checks-pass",
        source_resource=dict(id=resource_id, sha256=checksum), alias_run_id=Path(resource["resources"]["aliases"]).name,
        policy=resource["source_only_policy"], independent_accuracy_established=False)
    data = workspace / "src/demo/iran_site_visit/web/data"
    assets = dict(publication["shard_sha256"])
    assets.update({native[name + "_asset"]: native[name + "_sha256"] for name in ("comparison", "search")})
    for name, expected in assets.items():
        if Path(name).name != name:
            raise ValueError("Native graph asset must have a literal filename")
        raw = checked_bytes(data / name, expected)
        rows.append(dataset_row(package, "/graph-assets-v4/cib/" + name, raw, expected, "cib", graph, hierarchy, key))
    if len({r["logical_key"] for r in rows}) != len(rows):
        raise ValueError("Duplicate graph logical key across releases")
    comparison = next(r for r in rows if r["logical_key"] == "/graph-assets-v4/cib/" + native["comparison_asset"])
    search = next(r for r in rows if r["logical_key"] == "/graph-assets-v4/cib/" + native["search_asset"])
    new_binding = dict(old_bindings["cib"], comparison_asset=native["comparison_asset"], search_asset=native["search_asset"],
        graph_run_id=graph, hierarchy_run_id=hierarchy, comparison_sha256=comparison["sha256decoded"],
        search_sha256=search["sha256decoded"], source_comparison_sha256=native["comparison_sha256"],
        documents=native["documents"], graph_release_key=key,
        source_resource=dict(id=resource_id, sha256=checksum), alias_policy=resource["source_only_policy"],
        alias_review_status="source-reviewed-engineering-checks-pass", independent_identity_accuracy=False,
        scope_note="Latest source-reviewed CIB corpus exploration. Retrospective identities and hierarchy; no case-specific cutoff or origin exclusion. Saved workbench routes retain their separate original graph.",
        pdf_available=False)
    dataset.update(version=MANIFEST_VERSION, files=rows, graph_releases=releases,
        source_binding_sha256=sha(encoded(dict(previous_dataset_sha256=sha(old_dataset_raw), resource_sha256=checksum))),
        views="Current corpus exploration plus the original graph needed to replay saved workbench routes; no inference is rebound.")
    for name, raw in (("previous-api-index.json", old_index_raw), ("previous-datasets.json", old_dataset_raw),
                      ("previous-publication.json", old_publication_raw)):
        atomic(stage / name, raw)
    result = dict(version=VERSION, status="DATASETS_PREPARED_NOT_ACTIVATED", resource_id=resource_id,
        resource_sha256=checksum, dataset_manifest_sha256=sha(encoded(dataset)),
        previous_api_index_sha256=sha(old_index_raw), previous_publication_sha256=sha(old_publication_raw),
        previous_dataset_manifest_sha256=sha(old_dataset_raw), new_binding=new_binding, saved_bindings=old_bindings,
        saved_binding_entries=saved_entries,
        new_graph_assets=len(assets), total_graph_assets=len(rows), api_calls=0, native_outputs_modified=False)
    atomic(stage / "next-datasets.json", encoded(dataset))
    atomic(preparation_plan, encoded(result))
    return finish_preparation(package, stage, result)


def fast_packet(site, payload):
    raw = encoded(payload)
    wire = gzip.compress(raw, compresslevel=9, mtime=0)
    relative = "data/bootstrap/" + sha(wire) + ".json.gz"
    atomic(site / relative, wire)
    return dict(path=relative, encoding="gzip", mime="application/json", sha256=sha(raw), wire_sha256=sha(wire))


def inventory(site, previous, overrides=None, expected=None):
    roles = {r["path"]:r for r in previous["files"]}
    overrides = overrides or {}
    result = []
    for path in sorted(site.rglob("*")):
        if not path.is_file() or path.name == "publication.json":
            continue
        if path.is_symlink():
            raise ValueError("A public file cannot be a symlink")
        relative = path.relative_to(site).as_posix()
        original = path.read_bytes()
        if expected is not None and (relative not in expected or sha(original) != expected[relative]):
            raise ValueError("Another writer changed an inventory input: " + relative)
        raw = overrides.get(relative, original)
        row = {k:v for k,v in roles.get(relative, {}).items() if k not in {"bytes", "sha256", "decoded_sha256"}}
        row.update(path=relative, bytes=len(raw), sha256=sha(raw))
        if relative.endswith(".json.gz"):
            row["decoded_sha256"] = sha(gzip.decompress(raw))
        result.append(row)
    if expected is not None and set(expected) != {p.relative_to(site).as_posix()
            for p in site.rglob("*") if p.is_file()}:
        raise ValueError("Another writer changed the site inventory")
    return result


def verified_data_commit(package, commit, expected_manifest_sha256):
    raw = subprocess.check_output(["git", "-C", str(package), "show", commit + ":datasets/manifest.json"])
    if sha(raw) != expected_manifest_sha256:
        raise ValueError("Dataset commit does not contain the prepared inventory")


def finish_activation(site, stage, plan):
    """Resume partial installation only while every target has known bytes."""
    writes = plan["writes"]
    actual_files = {p.relative_to(site).as_posix() for p in site.rglob("*") if p.is_file()}
    if actual_files != set(writes) | set(plan["dependencies"]):
        raise ValueError("Another writer changed the activation inventory")
    for relative, checksum in plan["dependencies"].items():
        checked_bytes(site / relative, checksum)
    for relative, checksum in plan["data_dependencies"].items():
        checked_bytes(site.parent / relative, checksum)
    for relative, pin in writes.items():
        path = site / relative
        actual = sha(path.read_bytes()) if path.exists() else None
        if actual not in {pin["before_sha256"], pin["after_sha256"]}:
            raise ValueError("Another writer changed an activation target: " + relative)
        checked_bytes(stage / pin["payload"], pin["after_sha256"])
    for relative, pin in writes.items():
        path = site / relative
        current = sha(path.read_bytes()) if path.exists() else None
        if current == pin["after_sha256"]:
            continue
        if current != pin["before_sha256"]:
            raise ValueError("Another writer changed an activation target before installation: " + relative)
        atomic(path, checked_bytes(stage / pin["payload"], pin["after_sha256"]))
    for relative, pin in writes.items():
        checked_bytes(site / relative, pin["after_sha256"])
    for relative, checksum in plan["dependencies"].items():
        checked_bytes(site / relative, checksum)
    for relative, checksum in plan["data_dependencies"].items():
        checked_bytes(site.parent / relative, checksum)
    if actual_files != {p.relative_to(site).as_posix() for p in site.rglob("*") if p.is_file()}:
        raise ValueError("Another writer changed the completed activation inventory")
    result = plan["result"]
    if sha((site / "publication.json").read_bytes()) != result["publication_sha256"]:
        raise ValueError("Publication activation was not completed")
    atomic(stage / "activated.json", encoded(result))
    return result


def activate(package, resource_id, commit):
    with operation_lock(package):
        return _activate(package, resource_id, commit)


def _activate(package, resource_id, commit):
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("A literal immutable dataset commit is required")
    site, stage = package / "site", package / ".graph-refresh" / resource_id
    prepared = read(stage / "prepared.json")
    receipt = stage / "activated.json"
    if receipt.exists():
        result = read(receipt)
        if (result["dataset_commit"] != commit or sha((site / "publication.json").read_bytes()) != result["publication_sha256"]):
            raise ValueError("Completed public graph activation changed")
        publication = read(site / "publication.json")
        expected_files = {row["path"] for row in publication["files"]} | {"publication.json"}
        if expected_files != {p.relative_to(site).as_posix() for p in site.rglob("*") if p.is_file()}:
            raise ValueError("Completed publication has an unlisted or missing file")
        for row in publication["files"]:
            relative = Path(row["path"])
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Completed publication has an unsafe file path")
            checked_bytes(site / relative, row["sha256"])
        checked_bytes(package / "datasets/manifest.json", prepared["dataset_manifest_sha256"])
        for row in read(package / "datasets/manifest.json")["files"]:
            relative = Path(row["path"])
            if relative.is_absolute() or ".." in relative.parts or relative.parts[0] != "datasets":
                raise ValueError("Completed dataset inventory has an unsafe file path")
            checked_bytes(package / relative, row["wire_sha256"])
        verified_data_commit(package, commit, prepared["dataset_manifest_sha256"])
        return result
    pending = stage / "activation-plan.json"
    if pending.exists():
        plan = read(pending)
        if plan["result"]["dataset_commit"] != commit or plan["result"]["resource_id"] != resource_id:
            raise ValueError("Pending activation belongs to another source or dataset commit")
        verified_data_commit(package, commit, prepared["dataset_manifest_sha256"])
        return finish_activation(site, stage, plan)
    dataset = read(package / "datasets/manifest.json")
    if sha(encoded(dataset)) != prepared["dataset_manifest_sha256"]:
        raise ValueError("Prepared dataset inventory changed")
    verified_data_commit(package, commit, prepared["dataset_manifest_sha256"])
    checked_bytes(site / "data/api-index.json", prepared["previous_api_index_sha256"])
    checked_bytes(site / "publication.json", prepared["previous_publication_sha256"])
    source_snapshot = {p.relative_to(site).as_posix():sha(p.read_bytes()) for p in site.rglob("*") if p.is_file()}
    expected_files = dict(source_snapshot)
    data_dependencies = {"datasets/manifest.json": prepared["dataset_manifest_sha256"]}
    for row in dataset["files"]:
        data_dependencies[row["path"]] = row["wire_sha256"]
    before = read(stage / "previous-api-index.json")
    entries = deepcopy(before["entries"])
    for row in dataset["files"]:
        entries[row["logical_key"]] = dict(external_url="https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/" + commit + "/" + row["path"],
            encoding="gzip", sha256=row["sha256decoded"], wire_sha256=row["wire_sha256"], mime="application/json")
    # Retain the byte-exact existing bootstraps for archived saved guides.
    for logical, entry in before["entries"].items():
        if logical.startswith("/graph-assets-v4/") and entry.get("path"):
            entries[logical] = entry
    for corpus in prepared["saved_bindings"]:
        original = prepared.get("saved_binding_entries", {}).get(corpus) or before["entries"].get(
            canonical("/api/graph-v4-viewer", corpus=corpus, revision="study"),
            before["entries"][canonical("/api/graph-v4-viewer", corpus=corpus)])
        entries[canonical("/api/graph-v4-viewer", corpus=corpus, revision="study")] = original
    new_binding = prepared["new_binding"]
    entries[canonical("/api/graph-v4-viewer", corpus="cib")] = fast_packet(site, new_binding)
    entry = entries[canonical("/api/graph-v4-viewer", corpus="cib")]
    expected_files[entry["path"]] = entry["wire_sha256"]
    for field in ("comparison_asset", "search_asset"):
        logical = "/graph-assets-v4/cib/" + new_binding[field]
        row = next(r for r in dataset["files"] if r["logical_key"] == logical)
        wire = checked_bytes(package / row["path"], row["wire_sha256"])
        relative = "data/bootstrap/" + row["wire_sha256"] + ".json.gz"
        atomic(site / relative, wire)
        expected_files[relative] = sha(wire)
        entries[logical] = dict(path=relative, encoding="gzip", sha256=row["sha256decoded"], wire_sha256=row["wire_sha256"], mime="application/json")
    index_raw = encoded(dict(before, entries=entries))
    updates = {"data/api-index.json": index_raw}
    # Each derived HTML document pins the exact finite API index it may serve.
    for path in site.rglob("*.html"):
        raw = path.read_bytes()
        if sha(raw) != source_snapshot.get(path.relative_to(site).as_posix()):
            raise ValueError("Another writer changed an HTML snapshot")
        updated = re.sub(rb'data-index-sha256="[a-f0-9]{64}"', b'data-index-sha256="' + sha(index_raw).encode() + b'"', raw)
        if updated != raw:
            updates[path.relative_to(site).as_posix()] = updated
    previous = read(stage / "previous-publication.json")
    result = dict(previous, version="public-presentation/6.7",
        run_id="matryoshka-public-v67-" + sha(encoded([previous["run_id"], prepared["resource_sha256"]]))[:16],
        graph_data_manifest=dict(path="datasets/manifest.json", sha256=prepared["dataset_manifest_sha256"], commit=commit),
        graph_resource_updates=dict(current_cib=new_binding["source_resource"],
            current_graph=new_binding["graph_run_id"], current_hierarchy=new_binding["hierarchy_run_id"],
            saved_workbench_rebound=False, iran_vietnam="Retained legacy graph releases, not revalidated under the new source-only alias workflow."))
    for row in result.get("ui_asset_lineage", []):
        path = site / row["path"]
        actual = sha(updates.get(row["path"], path.read_bytes()))
        if row["public_sha256"] != actual:
            row["previous_public_sha256"] = row["public_sha256"]
            row["public_sha256"] = actual
            row["changes"] += " Version-aware graph transport/authority and explicit current-versus-saved binding; saved inference unchanged."
    result["files"] = inventory(site, previous, updates, expected_files)
    changed = [key for key, row in before["entries"].items() if key.startswith("/api/")
        and not key.startswith("/api/graph-v4-viewer?") and entries.get(key) != row]
    if changed:
        raise ValueError("A saved inference/source/guide route was modified")
    updates["publication.json"] = encoded(result)
    final = dict(version=VERSION, status="ACTIVATED", resource_id=resource_id, dataset_commit=commit,
        publication_sha256=sha(encoded(result)), saved_routes_unchanged=True,
        saved_route_count=sum(k.startswith("/api/") and not k.startswith("/api/graph-v4-viewer?") for k in before["entries"]),
        api_calls=0, native_outputs_modified=False)
    writes = {}
    for relative, raw in updates.items():
        path = site / relative
        payload = "activation-payloads/" + sha(raw) + ".bin"
        atomic(stage / payload, raw)
        writes[relative] = dict(before_sha256=source_snapshot.get(relative),
            after_sha256=sha(raw), payload=payload)
    plan = dict(version=VERSION, writes=writes, result=final,
        dependencies={name:checksum for name,checksum in expected_files.items() if name not in writes},
        data_dependencies=data_dependencies)
    atomic(pending, encoded(plan))
    return finish_activation(site, stage, plan)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--package", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--resource", type=Path)
    parser.add_argument("--resource-sha256")
    parser.add_argument("--activate", metavar="RESOURCE_ID")
    parser.add_argument("--dataset-commit")
    args = parser.parse_args()
    if args.activate:
        report = activate(args.package.resolve(), args.activate, args.dataset_commit or "")
    else:
        if not args.workspace or not args.resource or not args.resource_sha256:
            parser.error("Preparation requires --workspace, --resource and --resource-sha256")
        report = prepare(args.workspace.resolve(), args.package.resolve(), args.resource.resolve(), args.resource_sha256)
    print(json.dumps({k:v for k,v in report.items() if k not in {"new_binding", "saved_bindings"}}, indent=2))

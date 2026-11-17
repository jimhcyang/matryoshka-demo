"""Install verified graph/API packs into a finite static publication."""
import argparse
import gzip
import json
from pathlib import Path
import shutil

from export_replays import atomic, encoded, read, sha


def install(package, api_pack, dataset_commit):
    site = package / "site"
    previous_index = read(site / "data/api-index.json")
    inputs = read(package / ".packing-work/apis/api-inputs.json")
    entries = dict(inputs["binary_entries"])
    manifests = {}
    for label, source in (("apis", api_pack),):
        manifest_path = source / "manifest.json"
        raw = manifest_path.read_bytes()
        manifest = read(manifest_path)
        if manifest["status"] != "COMPLETE" or manifest.get("all_roots_transport_verified") is not True:
            raise ValueError("An incomplete pack cannot be published")
        committed = json.dumps({k:v for k,v in manifest.items() if k != "sha256"}, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode()
        if manifest["sha256"] != sha(committed):
            raise ValueError("Pack manifest seal changed")
        target = site / "data/packed" / label
        for chunk in manifest["chunks"]:
            path = source / chunk["path"]
            if path.resolve(strict=True) != path or not path.is_relative_to(source) or sha(path.read_bytes()) != chunk["wire_sha256"]:
                raise ValueError("Packed public chunk changed")
            destination = target / chunk["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)
        atomic(target / "manifest.json", raw)
        manifests[label] = (manifest, target.relative_to(site).as_posix() + "/manifest.json", sha(raw))
    import re
    if not re.fullmatch(r"[0-9a-f]{40}", dataset_commit):
        raise ValueError("A literal immutable Git dataset commit is required")
    dataset = read(package / "datasets/manifest.json")
    for row in dataset["files"]:
        entries[row["logical_key"]] = dict(external_url="https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/" + dataset_commit + "/" + row["path"],
            encoding="gzip", sha256=row["sha256decoded"], wire_sha256=row["wire_sha256"], mime="application/json")
    # Keep tiny bootstrap/catalog entry points independently fetchable. A first
    # map visit must not hydrate a large shared dictionary just to read its menu.
    graph_inputs = read(package / ".packing-work/graphs/graph-inputs.json")
    graph_rows = {row["name"]:row for row in graph_inputs["selected"]}
    for corpus, binding in graph_inputs["graph_bindings"].items():
        for name in (binding["comparison_asset"], binding["search_asset"]):
            key = "/graph-assets-v4/" + corpus + "/" + name
            reference = graph_rows[key]["ref"]
            source = package.parent / reference["path"]
            wire = source.read_bytes()
            if sha(wire) != reference["sha256"]:
                raise ValueError("Graph bootstrap changed")
            raw = gzip.decompress(wire) if source.name.endswith(".gz") else wire
            packed = gzip.compress(raw, compresslevel=9, mtime=0)
            relative = "data/bootstrap/" + sha(packed) + ".json.gz"
            atomic(site / relative, packed)
            entries[key] = dict(path=relative, encoding="gzip", sha256=sha(raw), wire_sha256=sha(packed), mime="application/json")
    api, path, checksum = manifests["apis"]
    for key, asset in inputs["aliases"].items():
        root = api["assets"][asset]
        entries[key] = dict(path=path, asset=asset, manifest_sha256=checksum, encoding="fragment-dag", sha256=root["sha256decoded"], mime="application/json")
    # Publish the catalog and primary result packets without dictionary fan-out.
    # This latency optimization duplicates transport bytes, never inference.
    for key, original_entry in inputs["fast_entries"].items():
        if key == "/data/report-v6.json":
            raw = (site / "data/report-v6.json").read_bytes()
            wire = gzip.compress(raw, compresslevel=9, mtime=0)
            decoded_hash = sha(raw)
        else:
            original_path = package / original_entry["path"] if original_entry.get("prepared_outside_site") else site / original_entry["path"]
            wire = original_path.read_bytes()
            if sha(wire) != original_entry["wire_sha256"]:
                raise ValueError("Primary saved result changed")
            decoded_hash = original_entry["sha256"]
            if original_entry["encoding"] == "identity":
                wire = gzip.compress(wire, compresslevel=9, mtime=0)
        relative = "data/fast/" + sha(wire)[:2] + "/" + sha(wire) + ".json.gz"
        atomic(site / relative, wire)
        entries[key] = dict(path=relative, encoding="gzip", sha256=decoded_hash, wire_sha256=sha(wire), mime="application/json")
    original = site / "data/api-index.json"
    atomic(package / ".packing-work/pre-packed-api-index.json", original.read_bytes())
    atomic(original, encoded(dict(version="matryoshka-public-api-index/1", entries=entries)))
    # Original native/research outputs are outside this generated transport area.
    for path in (site / "data/replays").glob("*.json.gz"):
        path.unlink()
    for path in site.rglob("*.lock"):
        path.unlink()
    print(dict(status="INSTALLED", api_and_graph_routes=len(entries), original_inference_unchanged=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apis", type=Path, required=True)
    parser.add_argument("--dataset-commit", required=True)
    args = parser.parse_args()
    install(Path(__file__).resolve().parents[1], args.apis.resolve(), args.dataset_commit)

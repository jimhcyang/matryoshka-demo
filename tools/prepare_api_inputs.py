"""Pin finite public responses and rebind only public transport metadata."""
import argparse
from copy import deepcopy
import gzip
import json
from pathlib import Path

from export_replays import atomic, canonical, encoded, read, sha


def prepare(workspace, package):
    site = package / "site"
    output = package / ".packing-work/apis"
    original = read(site / "data/api-index.json")
    catalog = read(site / "data/report-v6.json")
    for row in catalog["cases"]:
        if row.get("selected_demo") is True and row.get("selected_bench") is not True:
            group = "presentation"
        elif row.get("selected_bench") is True and row.get("selected_demo") is not True:
            group = "bench"
        else:
            raise ValueError("Public catalog has ambiguous presentation membership")
        row["presentation_selection"]["group"] = group
    atomic(site / "data/report-v6.json", encoded(catalog))
    graphs = read(package / ".packing-work/graphs/graph-inputs.json")
    bindings = graphs["graph_bindings"]
    rows, aliases, files, fast_entries = [], {}, {}, {}
    entries = deepcopy(original["entries"])
    for corpus, binding in bindings.items():
        key = canonical("/api/graph-v4-viewer", corpus=corpus)
        target = output / "prepared" / (corpus + "-viewer.json")
        raw = encoded(binding)
        atomic(target, raw)
        entries[key] = dict(path=target.relative_to(site.parent).as_posix(), encoding="identity",
            sha256=sha(raw), wire_sha256=sha(raw), mime="application/json", prepared_outside_site=True)
    for key, entry in sorted(entries.items()):
        if entry["mime"] != "application/json":
            continue
        if not key.startswith(("/api/guide-overlay-v64?", "/api/native-v6?")):
            fast_entries[key] = entry
            continue
        path = (package / entry["path"]) if entry.get("prepared_outside_site") else (site / entry["path"])
        wire = path.read_bytes()
        if sha(wire) != entry["wire_sha256"]:
            raise ValueError("A public transport input changed")
        raw = gzip.decompress(wire) if entry["encoding"] == "gzip" else wire
        if sha(raw) != entry["sha256"]:
            raise ValueError("A decoded public transport input changed")
        if key.startswith("/api/guide-overlay-v64?"):
            value = json.loads(raw)
            corpus = value.get("corpus") or value.get("case", {}).get("corpus")
            if not corpus:
                from urllib.parse import parse_qs, urlsplit
                cid = parse_qs(urlsplit(key).query)["case_id"][0]
                report = read(site / "data/report-v6.json")
                corpus = next(row["case"]["corpus"] for row in report["cases"] if row["case"]["case_id"] == cid)
            browser = value["browser_binding"]
            browser["source_comparison_sha256"] = browser["comparison_sha256"]
            browser["comparison_sha256"] = bindings[corpus]["comparison_sha256"]
            raw = encoded(value)
        elif key == "/data/report-v6.json":
            # The catalog is a separately versioned selection, never native data.
            raw = (site / "data/report-v6.json").read_bytes()
        elif key.startswith("/api/native-v6?"):
            value = json.loads(raw)
            value["result"].pop("flow", None)
            value["omitted"] = "Public inference receipt only. Numerical walk arrays are available in the condition and flow views; this is not a complete native checkpoint download."
            raw = encoded(value)
        if sha(raw) != entry["sha256"]:
            prepared = output / "prepared" / (sha(raw) + ".json.gz")
            atomic(prepared, gzip.compress(raw, compresslevel=9, mtime=0))
            path = prepared
        if key.startswith("/api/native-v6?"):
            fast_entries[key] = dict(path=path.relative_to(package).as_posix(), prepared_outside_site=True,
                encoding="gzip", sha256=sha(raw), wire_sha256=sha(path.read_bytes()), mime="application/json")
            continue
        identity = sha(path.read_bytes())
        if identity in files:
            aliases[key] = files[identity]
            continue
        files[identity] = key
        aliases[key] = key
        rows.append(dict(name=key, corpus="public-replay", category="api", ref=dict(
            path=path.relative_to(workspace).as_posix(), sha256=identity, bytes=path.stat().st_size)))
    packet = dict(version="public-api-pack-inputs/1", selected=rows, aliases=aliases,
        fast_entries=fast_entries,
        index_source_sha256=sha((site / "data/api-index.json").read_bytes()),
        binary_entries={key:value for key,value in entries.items() if value["mime"] != "application/json"},
        derivation="Only public comparison transport hashes and the curated catalog are rebound. Source quotations, gates, rankings and grades remain unchanged.")
    atomic(output / "api-inputs.json", encoded(packet))
    print(json.dumps(dict(status="PREPARED", json_routes=len(aliases), distinct_json_inputs=len(rows), binary_routes=len(packet["binary_entries"]))))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.workspace.resolve(), Path(__file__).resolve().parents[1])

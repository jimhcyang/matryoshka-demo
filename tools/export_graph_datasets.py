"""Export standalone gzip graph assets, outside the GitHub Pages artifact.

Independent files avoid dictionary fan-out during interactive exploration.
The Pages index will address these files through a pinned Git commit.
"""
import argparse
import gzip
import json
from pathlib import Path

from export_replays import atomic, encoded, read, sha


def export(package):
    inputs = read(package / ".packing-work/graphs/graph-inputs.json")
    files = []
    for item in inputs["selected"]:
        source = package.parent / item["ref"]["path"]
        wire = source.read_bytes()
        if source.resolve(strict=True) != source or sha(wire) != item["ref"]["sha256"]:
            raise ValueError("Graph input changed")
        if source.name.endswith(".gz"):
            raw = gzip.decompress(wire)
        else:
            raw = wire
            wire = gzip.compress(raw, compresslevel=9, mtime=0)
        if len(wire) >= 95_000_000:
            raise ValueError("An independent graph shard exceeds the repository file guard")
        relative = "datasets/" + item["corpus"] + "/" + sha(wire) + ".json.gz"
        path = package / relative
        if path.exists() and path.read_bytes() != wire:
            raise ValueError("A content-addressed graph dataset changed")
        if not path.exists():
            atomic(path, wire)
        lineage = inputs["lineage"][item["name"]]
        files.append(dict(path=relative, bytes=len(wire), wire_sha256=sha(wire), sha256decoded=sha(raw),
            corpus=item["corpus"], logical_key=item["name"],
            source_wire_sha256=lineage["original"]["sha256"],
            graph_id=lineage["original_graph_id"], hierarchy_id=lineage["original_hierarchy_id"],
            all_graph_objects_preserved=True, workstation_metadata_removed=lineage["original"] != lineage["prepared"]))
    manifest = dict(version="public-graph-datasets/1", files=files,
        source_binding_sha256=inputs["source_binding_sha256"], source_bodies_modified=False,
        original_graph_modified=False, views="All six active full-corpus graph projections, not selected neighborhoods.",
        rights_notice="Historical public source corpus. Original classification markings are preserved; this project makes no declassification decision.")
    atomic(package / "datasets/manifest.json", encoded(manifest))
    print(json.dumps(dict(status="EXPORTED", assets=len(files), stored_bytes=sum(x["bytes"] for x in files),
        max_file_bytes=max(x["bytes"] for x in files), manifest_sha256=sha(encoded(manifest)))))


if __name__ == "__main__":
    export(Path(__file__).resolve().parents[1])

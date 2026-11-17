"""Remove unpublished audit locations from derived direct replay packets only."""
import argparse
import gzip
import json
from pathlib import Path

from export_replays import atomic, encoded, public_metadata, read, sha


def location_only(old, new, field=None):
    if old == new:
        return True
    if isinstance(old, dict) and isinstance(new, dict):
        added = set(new) - set(old)
        if set(old) - set(new) or added - {"publication_availability"}:
            return False
        if added and new["publication_availability"] != "Unpublished audit artifact; content hash retained":
            return False
        return all(location_only(v, new[k], k) for k, v in old.items())
    if isinstance(old, list) and isinstance(new, list):
        return len(old) == len(new) and all(location_only(a, b) for a, b in zip(old, new))
    return field in {"path", "receipt"} and isinstance(old, str) and new is None


def repair(site):
    site = site.resolve()
    index_path = site / "data/api-index.json"
    index = read(index_path)
    paths = sorted({e["path"] for e in index["entries"].values()
                    if e.get("path", "").startswith("data/fast/") and e.get("encoding") == "gzip"})
    changes = []
    for number, relative in enumerate(paths, 1):
        path = site / relative
        raw = gzip.decompress(path.read_bytes())
        old = json.loads(raw)
        new = public_metadata(old)
        if old == new:
            continue
        if not location_only(old, new):
            raise ValueError("Metadata repair would change a non-location field: " + relative)
        payload = encoded(new)
        wire = gzip.compress(payload, compresslevel=9, mtime=0)
        target = "data/fast/" + sha(wire)[:2] + "/" + sha(wire) + ".json.gz"
        atomic(site / target, wire)
        for entry in index["entries"].values():
            if entry.get("path") == relative:
                entry.update(path=target, sha256=sha(payload), wire_sha256=sha(wire))
        # Checkpoint the public transport before pruning its superseded blob.
        atomic(index_path, encoded(index))
        if path.is_symlink():
            raise ValueError("Refusing to prune symlinked metadata packet")
        path.unlink()
        changes.append(dict(before=relative, after=target, before_sha256=sha(raw), after_sha256=sha(payload)))
        print(encoded(dict(status="REPAIRED", checked=number, packets=len(paths), changed=len(changes))).decode(), flush=True)
    # Resume may encounter a superseded generated blob left after a checkpoint.
    referenced = {e.get("path") for e in index["entries"].values()}
    for path in (site / "data/fast").rglob("*.json.gz"):
        if path.relative_to(site).as_posix() not in referenced:
            if path.is_symlink():
                raise ValueError("Refusing to prune a symlinked replay blob")
            path.unlink()
    receipt = dict(status="REPAIRED_PUBLIC_PACKET_METADATA", checked=len(paths), changes=changes,
                   native_outputs_modified=False, inference_or_ranking_changed=False, api_calls=0)
    atomic(site.parent / ".packing-work/packet-metadata-repair.json", encoded(receipt))
    print(encoded({k:v for k,v in receipt.items() if k != "changes"} | {"changed": len(changes)}).decode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, required=True)
    repair(parser.parse_args().site)

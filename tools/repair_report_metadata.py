"""Version public report metadata without editing original research artifacts."""
import argparse
import gzip
from pathlib import Path

from export_replays import atomic, encoded, public_metadata, read, sha


def repair(site):
    site = site.resolve()
    report_path = site / "data/report-v6.json"
    index_path = site / "data/api-index.json"
    before = read(report_path)
    after = public_metadata(before)
    if any(before[key] != after[key] for key in before if key != "cases"):
        raise ValueError("Report repair would change a non-case field")
    # Only the location of a hash-bound, unpublished audit artifact may change.
    for old, new in zip(before["cases"], after["cases"], strict=True):
        for key in old:
            if key != "query_kind_ref" and old[key] != new[key]:
                raise ValueError("Report repair would change non-audit case data")
        if old.get("query_kind_ref", {}).get("sha256") != new.get("query_kind_ref", {}).get("sha256"):
            raise ValueError("Report repair would change an audit commitment")
    raw = encoded(after)
    wire = gzip.compress(raw, compresslevel=9, mtime=0)
    relative = "data/fast/" + sha(wire)[:2] + "/" + sha(wire) + ".json.gz"
    index = read(index_path)
    old_entry = index["entries"]["/data/report-v6.json"]
    old_path = old_entry["path"]
    entry = dict(old_entry, path=relative, sha256=sha(raw), wire_sha256=sha(wire))
    atomic(site / relative, wire)
    atomic(report_path, raw)
    index["entries"]["/data/report-v6.json"] = entry
    atomic(index_path, encoded(index))
    if old_path != relative and not any(e.get("path") == old_path for e in index["entries"].values()):
        old_file = site / old_path
        if old_file.is_symlink() or not old_path.startswith("data/fast/"):
            raise ValueError("Refusing to prune a non-generated report packet")
        old_file.unlink()
    print(encoded(dict(status="REPAIRED_PUBLIC_METADATA", cases=len(after["cases"]),
        source_report_ref_unchanged=before["source_report_ref"] == after["source_report_ref"],
        native_outputs_modified=False, report_sha256=sha(raw), api_calls=0)).decode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, required=True)
    repair(parser.parse_args().site)

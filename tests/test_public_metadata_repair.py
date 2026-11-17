import gzip
import importlib.util
from pathlib import Path
from unittest.mock import patch


TOOLS = Path(__file__).resolve().parents[1] / "tools"


def load(name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


export = load("export_replays")
with patch.dict("sys.modules", {"export_replays": export}):
    repair = load("repair_packet_metadata")


def test_only_audit_locations_can_change():
    old = {"rank": 1, "fill": "Exact", "proof": {"path": "private/a.json", "sha256": "a" * 64}}
    assert repair.location_only(old, export.public_metadata(old))
    assert not repair.location_only(old, dict(old, rank=2))
    assert not repair.location_only(old, dict(old, fill="Edited"))
    assert not repair.location_only([old], [])
    assert not repair.location_only(old, dict(old, arbitrary="new"))


def test_packet_repair_preserves_source_rank_hash_commitments_and_resumes(tmp_path):
    site = tmp_path / "site"
    value = {"rank": 1, "fill": "Source-grounded name", "document_id": "public-doc",
             "text": "Literal /private/source notation remains exact.",
             "plan": {"receipts": [{"receipt": "experiments/private/receipts/call.json",
                                    "raw_sha256": "b" * 64, "request_sha256": "c" * 64}]}}
    raw = export.encoded(value)
    wire = gzip.compress(raw, mtime=0)
    old_path = "data/fast/aa/" + "a" * 64 + ".json.gz"
    export.atomic(site / old_path, wire)
    route = "/api/native-v6?case_id=example&config=llm_readings"
    index = {"version": export.INDEX_VERSION, "entries": {route: {
        "path": old_path, "encoding": "gzip", "sha256": export.sha(raw),
        "wire_sha256": export.sha(wire), "mime": "application/json"}}}
    export.atomic(site / "data/api-index.json", export.encoded(index))
    repair.repair(site)
    entry = export.read(site / "data/api-index.json")["entries"][route]
    result_raw = gzip.decompress((site / entry["path"]).read_bytes())
    import json
    result = json.loads(result_raw)
    assert repair.location_only(value, result)
    assert result["rank"] == value["rank"] and result["text"] == value["text"]
    assert result["plan"]["receipts"][0]["raw_sha256"] == "b" * 64
    assert export.sha(result_raw) == entry["sha256"]
    assert export.sha((site / entry["path"]).read_bytes()) == entry["wire_sha256"]
    assert not (site / old_path).exists()
    orphan = site / "data/fast/ab" / ("b" * 64 + ".json.gz")
    export.atomic(orphan, wire)
    repair.repair(site)
    assert not orphan.exists()
    assert export.read(site / "data/api-index.json")["entries"][route] == entry

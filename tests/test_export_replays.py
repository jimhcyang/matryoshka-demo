import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


PATH = Path(__file__).resolve().parents[1] / "tools/export_replays.py"
SPEC = importlib.util.spec_from_file_location("export_replays", PATH)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class ExportTests(unittest.TestCase):
    def test_canonical_default_reading_matches_runtime(self):
        self.assertEqual(module.canonical("/api/flow-v6", config="llm_atoms", case_id="a", limit=1024),
            "/api/flow-v6?case_id=a&config=llm_atoms&limit=1024&reading=")

    def test_transport_is_content_addressed_and_repeatable(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory).resolve()
            store = module.Store(site)
            store.put("/api/test", {"text": "Literal historical source", "rank": 1})
            store.flush()
            first = store.index["entries"]["/api/test"]
            self.assertEqual(first["sha256"], module.sha(gzip.decompress((site / first["path"]).read_bytes())))
            second = module.Store(site)
            second.put("/api/test", {"rank": 1, "text": "Literal historical source"})
            self.assertEqual(second.index, store.index)
            with self.assertRaisesRegex(ValueError, "overwrite"):
                second.put("/api/test", {"rank": 2})

    def test_metadata_does_not_rewrite_historical_quotes(self):
        value = {"text": "SECRET. The government reported no agreement.",
                 "prepared_source_root": "/Users/example/Desktop/research/IARPA/src-redaction/data/current"}
        public = module.public_metadata(value)
        self.assertEqual(public["text"], value["text"])
        self.assertEqual(public["prepared_source_root"], "research-workspace/src-redaction/data/current")

    def test_source_pins_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "value.json").write_text('{"ok":true}')
            ref = {"path": "value.json", "sha256": module.sha((root / "value.json").read_bytes())}
            self.assertTrue(module.checked(root, ref)["ok"])
            (root / "value.json").write_text('{"ok":false}')
            with self.assertRaisesRegex(ValueError, "Changed source"):
                module.checked(root, ref)
            with self.assertRaisesRegex(ValueError, "Unsafe source"):
                module.checked(root, {"path": "../value.json", "sha256": "0" * 64})

    def test_unpublished_hash_bound_audit_paths_are_not_public_downloads(self):
        for path in ("research-workspace/experiments/private/kinds.json", "/private/tmp/audit.json",
                     "/Users/example/research/audit.json", "local/human_reviews/audit.json"):
            with self.subTest(path=path):
                value = {"path": path, "sha256": "a" * 64, "case_proof_sha256": "b" * 64}
                result = module.public_metadata(value)
                self.assertIsNone(result["path"])
                self.assertEqual(result["sha256"], value["sha256"])
                self.assertEqual(result["case_proof_sha256"], value["case_proof_sha256"])
                self.assertIn("Unpublished", result["publication_availability"])
                self.assertEqual(value["path"], path)
        receipt = {"receipt": "experiments/private/receipts/call.json", "raw_sha256": "c" * 64,
                   "request_sha256": "d" * 64, "model": "example-model"}
        public = module.public_metadata(receipt)
        self.assertIsNone(public["receipt"])
        self.assertEqual(public["raw_sha256"], receipt["raw_sha256"])
        self.assertEqual(public["request_sha256"], receipt["request_sha256"])

    def test_source_wording_and_public_references_remain_exact(self):
        quote = {"document_id": "historical-doc", "text": "The literal /private/archive notation appears here."}
        self.assertEqual(module.public_metadata(quote), quote)
        public = {"path": "data/visible.json", "sha256": "a" * 64}
        self.assertEqual(module.public_metadata(public), public)

    def test_report_metadata_repair_updates_both_public_views_and_is_idempotent(self):
        spec = importlib.util.spec_from_file_location("repair", PATH.with_name("repair_report_metadata.py"))
        repair = importlib.util.module_from_spec(spec)
        with patch.dict("sys.modules", {"export_replays": module}):
            spec.loader.exec_module(repair)
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory).resolve()
            (site / "data").mkdir()
            report = {"source_report_ref": {"path": "source.json", "sha256": "a" * 64},
                      "cases": [{"case": {"case_id": "c1", "query": "Exact query"},
                                 "configurations": {"A": {"rank": 1}},
                                 "query_kind_ref": {"path": "experiments/private/audit.json", "sha256": "b" * 64}}]}
            (site / "data/report-v6.json").write_bytes(module.encoded(report))
            wire = gzip.compress(module.encoded(report), mtime=0)
            old = "data/fast/aa/" + "a" * 64 + ".json.gz"
            (site / old).parent.mkdir(parents=True)
            (site / old).write_bytes(wire)
            index = {"version": module.INDEX_VERSION, "entries": {"/data/report-v6.json": {
                "path": old, "encoding": "gzip", "sha256": module.sha(module.encoded(report)),
                "wire_sha256": module.sha(wire), "mime": "application/json"}}}
            (site / "data/api-index.json").write_bytes(module.encoded(index))
            repair.repair(site)
            new = module.read(site / "data/report-v6.json")
            entry = module.read(site / "data/api-index.json")["entries"]["/data/report-v6.json"]
            raw = gzip.decompress((site / entry["path"]).read_bytes())
            self.assertEqual(raw, module.encoded(new))
            self.assertEqual(module.sha(raw), entry["sha256"])
            self.assertEqual(new["source_report_ref"], report["source_report_ref"])
            self.assertEqual(new["cases"][0]["case"], report["cases"][0]["case"])
            self.assertEqual(new["cases"][0]["configurations"], report["cases"][0]["configurations"])
            self.assertIsNone(new["cases"][0]["query_kind_ref"]["path"])
            self.assertFalse((site / old).exists())
            before_files = {p: p.read_bytes() for p in site.rglob("*") if p.is_file()}
            repair.repair(site)
            self.assertEqual(before_files, {p: p.read_bytes() for p in site.rglob("*") if p.is_file()})

    def test_original_compressed_envelope_is_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            payload = {"value": "unaltered"}
            raw = gzip.compress(module.encoded({"payload": payload, "sha256": module.sha(module.encoded(payload))}), mtime=0)
            (root / "v.json.gz").write_bytes(raw)
            self.assertEqual(module.checked(root, {"path": "v.json.gz", "sha256": module.sha(raw)}), payload)
            bad = gzip.compress(module.encoded({"payload": payload, "sha256": "0" * 64}), mtime=0)
            (root / "v.json.gz").write_bytes(bad)
            with self.assertRaisesRegex(ValueError, "commitment"):
                module.checked(root, {"path": "v.json.gz", "sha256": module.sha(bad)})


if __name__ == "__main__":
    unittest.main()

"""Tampering and fresh-authorization checks; no historical approval fixture."""
import json
import hashlib
import os
from pathlib import Path
import tempfile
import unittest

from validate_manifest import at, authorize, unique, checked_api_route, checked_native_input, sha, encoded


class ManifestTests(unittest.TestCase):
    def test_native_original_input_and_explicit_task_bridge(self):
        public = dict(task='redaction', query='A [REDACTION] delegation.')
        checked_native_input(dict(case=public, public_case=public), dict(case=public))
        with self.assertRaises(AssertionError):
            checked_native_input(dict(case=dict(public, query='Different context'), public_case=public), dict(case=public))
        public = dict(task='mosaic', query='Two source facts.')
        original = dict(public, task='reconstruction')
        binding = dict(task_binding='EXPLICIT_PUBLIC_MOSAIC_LEGACY_ENGINE_BRIDGE', native_case_sha256=sha(encoded(original)),
            native_public_case_sha256=sha(encoded(public)), public_case_sha256=sha(encoded(public)), query_sha256=sha(encoded(public['query'])))
        row = dict(case=public, native_public_case_binding=binding)
        checked_native_input(dict(case=original, public_case=public), row)
        for native in (dict(case=dict(original, query='Changed fact'), public_case=public),
                       dict(case=dict(original, task='hypothesis'), public_case=public)):
            with self.subTest(native=native), self.assertRaises(AssertionError):
                checked_native_input(native, row)

    def test_graph_quotation_routes_have_exact_corpus_bucket_and_asset(self):
        for name in ('manifest.json', 'cib/00.json.gz', 'iran/7f.json.gz', 'vietnam/42.json.gz'):
            key = '/graph-source-proofs/' + name
            checked_api_route(key, {'path': key[1:]})
        for name in ('other/00.json.gz', 'cib/80.json.gz', 'cib/../00.json.gz', 'cib/00.json', 'manifest.json?x=1'):
            key = '/graph-source-proofs/' + name
            with self.subTest(name=name), self.assertRaises(AssertionError):
                checked_api_route(key, {'path': key[1:]})
        for entry in ({'path': 'elsewhere.json'}, {'path': 'graph-source-proofs/manifest.json', 'external_url': 'https://example.com'}):
            with self.subTest(entry=entry), self.assertRaises(AssertionError):
                checked_api_route('/graph-source-proofs/manifest.json', entry)

    def test_current_relative_approval_path_remains_hash_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = dict(source_report_ref=dict(sha256='a'*64), backend_snapshot=dict(tree_sha256='b'*64))
            raw = json.dumps(manifest).encode()
            (root / 'release-manifest.json').write_bytes(raw)
            approval = dict(version='source-bound-release-authorization/1',
                candidate_manifest_sha256=hashlib.sha256(raw).hexdigest(), source_report_sha256='a'*64,
                backend_code_sha256='b'*64, publish_authorized=True, new_data_qa_accepted=True,
                privacy_review_accepted=True, licensing_review_accepted=True,
                scope='diagnostic_demo_with_declared_limitations', qualified_data_qa_ref=dict(sha256='c'*64))
            approval_raw = json.dumps(approval).encode()
            (root / 'approval.json').write_bytes(approval_raw)
            (root / 'ref.json').write_text(json.dumps(dict(path='approval.json', sha256=hashlib.sha256(approval_raw).hexdigest())))
            previous = Path.cwd()
            try:
                os.chdir(root)
                self.assertTrue(authorize(root, Path('ref.json')))
                approval['candidate_manifest_sha256'] = 'd'*64
                changed = json.dumps(approval).encode()
                (root / 'approval.json').write_bytes(changed)
                (root / 'ref.json').write_text(json.dumps(dict(path='approval.json', sha256=hashlib.sha256(changed).hexdigest())))
                with self.assertRaises(AssertionError):
                    authorize(root, Path('ref.json'))
            finally:
                os.chdir(previous)

    def test_symlink_approval_reference_rejects(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'ref.json').write_text('{}')
            (root / 'linked.json').symlink_to(root / 'ref.json')
            with self.assertRaises(AssertionError):
                authorize(root, root / 'linked.json')

    def test_duplicate_metadata_keys_fail(self):
        with self.assertRaises(AssertionError):
            json.loads('{"x":1,"x":2}', object_pairs_hook=unique)

    def test_private_or_traversal_dependency_is_not_a_file(self):
        for name in ('../outside', '/absolute', 'a\\b', 'a//b'):
            with self.assertRaises(AssertionError):
                at(Path.cwd(), name)

    def test_no_approval_is_never_publish_authorization(self):
        with self.assertRaises(AssertionError):
            authorize(Path.cwd(), None)

    def test_prior_epoch_or_wrong_candidate_approval_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'release-manifest.json').write_text('{}')
            (root / 'approval.json').write_text('{"version":"old-dataset-privacy-pass/1"}')
            (root / 'ref.json').write_text('{"path":"approval.json","sha256":"' + '0' * 64 + '"}')
            with self.assertRaises(AssertionError):
                authorize(root, root / 'ref.json')


if __name__ == '__main__':
    unittest.main()

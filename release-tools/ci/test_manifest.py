"""Tampering and fresh-authorization checks; no historical approval fixture."""
import json
import hashlib
import os
from pathlib import Path
import tempfile
import unittest

from validate_manifest import at, authorize, unique


class ManifestTests(unittest.TestCase):
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

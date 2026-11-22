"""An explicit workstation reserve never disables hashes or the disk floor."""
from pathlib import Path
import hashlib
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fragment_reader import Reader


class DiskReserve(unittest.TestCase):
    def test_default_reserve_stays_eight_gib(self):
        with tempfile.TemporaryDirectory() as folder:
            reader = Reader(folder, Path(folder) / 'fragments.sqlite3')
            try:
                self.assertEqual(reader.minimum_free_bytes, 8 * 1024**3)
            finally:
                reader.close()

    def test_explicit_three_gib_and_close(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / 'fragments.sqlite3'
            reader = Reader(folder, database, minimum_free_bytes=3 * 1024**3)
            self.assertEqual(reader.minimum_free_bytes, 3 * 1024**3)
            reader.close()
            self.assertFalse(database.exists())

    def test_reserve_cannot_be_disabled_or_below_three_gib(self):
        for value in (0, -1, 3 * 1024**3 - 1, True, '3', 3.0):
            with self.subTest(value=value), self.assertRaises(ValueError):
                Reader('.', 'must-not-create.sqlite3', minimum_free_bytes=value)

    def test_low_disk_fails_before_unpacking_a_chunk(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            raw = json.dumps(dict(version='graph-fragment-dag/1', chunks=[{}])).encode()
            (root / 'pack.json').write_bytes(raw)
            reader = Reader(root, root / 'fragments.sqlite3', minimum_free_bytes=3 * 1024**3)
            try:
                with patch('fragment_reader.shutil.disk_usage') as usage:
                    usage.return_value.free = 3 * 1024**3 - 1
                    with self.assertRaisesRegex(AssertionError, 'reserve exhausted'):
                        reader.pack(dict(path='pack.json', manifest_sha256=hashlib.sha256(raw).hexdigest()))
            finally:
                reader.close()

    def test_smaller_reserve_does_not_bypass_content_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            (root / 'asset.json').write_bytes(b'{}')
            reader = Reader(root, root / 'fragments.sqlite3', minimum_free_bytes=3 * 1024**3)
            try:
                with self.assertRaises(AssertionError):
                    reader.read(dict(path='asset.json', encoding='identity', wire_sha256='0' * 64))
            finally:
                reader.close()

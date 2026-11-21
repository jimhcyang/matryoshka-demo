"""Bounded shared-dictionary verification of saved static packets, no backend imports."""
import base64
from functools import lru_cache
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import shutil
from bisect import bisect_right


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class Reader:
    def __init__(self, site, database):
        self.site, self.database = Path(site), Path(database)
        self.db = sqlite3.connect(self.database)
        self.db.execute('PRAGMA journal_mode=OFF')
        self.db.execute('PRAGMA cache_size=-8192')
        self.db.execute('CREATE TABLE fragments(pack TEXT,id INTEGER,pieces BLOB,PRIMARY KEY(pack,id))')
        self.packs = {}

    def path(self, name):
        assert name and not name.startswith('/') and '\\' not in name and all(p not in ('', '.', '..') for p in name.split('/'))
        p = self.site / name
        assert p.resolve() == p and p.is_file()
        return p

    def pack(self, entry):
        key = entry['path']
        if key not in self.packs:
            raw = self.path(key).read_bytes()
            assert sha(raw) == entry['manifest_sha256']
            manifest = json.loads(raw)
            assert manifest['version'] == 'graph-fragment-dag/1'
            assert manifest.get('literal_encoding') in (None, 'ascii', 'base64')
            previous = 0
            for chunk in manifest['chunks']:
                assert shutil.disk_usage(self.database.parent).free >= 8 * 1024**3, '8 GiB verification disk guard'
                wire = self.path(str(Path(key).parent / chunk['path'])).read_bytes()
                assert sha(wire) == chunk['wire_sha256'] and len(wire) == chunk['wire_bytes']
                decoded = gzip.decompress(wire)
                assert sha(decoded) == chunk['sha256decoded'] and len(decoded) == chunk['decoded_bytes']
                value = json.loads(decoded)
                assert value['first_id'] == previous + 1 == chunk['first_id']
                for identity, pieces in enumerate(value['fragments'], previous + 1):
                    assert len(pieces) % 2 == 1
                    assert all(isinstance(p, str) and p.isascii() if n % 2 == 0 else type(p) is int and 0 < p < identity for n, p in enumerate(pieces))
                    self.db.execute('INSERT INTO fragments VALUES(?,?,?)', (key, identity, json.dumps(pieces).encode()))
                previous = chunk['last_id']
                self.db.commit()
            self.packs[key] = manifest
        return self.packs[key]

    @lru_cache(maxsize=4096)
    def pieces(self, pack, identity):
        row = self.db.execute('SELECT pieces FROM fragments WHERE pack=? AND id=?', (pack, identity)).fetchone()
        assert row is not None
        mode = self.packs[pack].get('literal_encoding')
        return [(base64.b64decode(p, validate=True) if mode == 'base64' else p.encode('ascii')) if isinstance(p, str) else p
                for p in json.loads(row[0])]

    def stream(self, entry):
        manifest = self.pack(entry)
        root = manifest['assets'][entry['asset']]
        assert root['sha256decoded'] == entry['sha256']
        assert root['decoded_bytes'] <= 512 * 1024**2
        assert len(root['pieces']) % 2 == 1
        assert all(isinstance(p, str) and p.isascii() if i % 2 == 0 else type(p) is int and p > 0 for i,p in enumerate(root['pieces']))
        allowed = set(root['dependencies'])
        assert len(allowed) == len(root['dependencies']) and all(type(i) is int and 0 <= i < len(manifest['chunks']) for i in allowed)
        starts = [c['first_id'] for c in manifest['chunks']]
        stack = [root['pieces']]
        mode = manifest.get('literal_encoding')
        digest, length = hashlib.sha256(), 0
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(reversed(item))
            elif isinstance(item, int):
                chunk = bisect_right(starts, item) - 1
                assert chunk in allowed and item <= manifest['chunks'][chunk]['last_id'], 'Undeclared root dependency'
                stack.append(self.pieces(entry['path'], item))
            else:
                raw = item if isinstance(item, bytes) else base64.b64decode(item, validate=True) if mode == 'base64' else item.encode('ascii')
                digest.update(raw)
                length += len(raw)
                yield raw
        assert length == root['decoded_bytes'] and digest.hexdigest() == entry['sha256']

    def read(self, entry):
        if entry['encoding'] == 'fragment-dag':
            return b''.join(self.stream(entry))
        wire = self.path(entry['path']).read_bytes()
        assert sha(wire) == entry['wire_sha256']
        raw = gzip.decompress(wire) if entry['encoding'] == 'gzip' else wire
        assert sha(raw) == entry['sha256']
        return raw

    def close(self):
        self.pieces.cache_clear()
        self.db.close()
        self.database.unlink()

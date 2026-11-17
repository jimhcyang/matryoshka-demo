#!/usr/bin/env python3
"""Literal, offline-only publication copy adapter and standalone verifier.

No Git, network, model, native graph builder, or inference dependency is used.
The copied publication checker is executed only after the receipt is pinned and
every bundle member has been checked. See docs/OFFLINE_BUNDLE.md.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import ctypes
import fcntl
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import types


VERSION = 'offline-static-demo/1'
RECEIPT = 'offline-publication.json'
VERIFIER = 'verify_offline_bundle.py'
CHECKERS = ('validate_publication.py', 'pack_graphs.py')
HEX = re.compile(r'[a-f0-9]{64}\Z')
LIMIT = 95_000_000
PIN = re.compile(r'\bdata-index-sha256\s*=\s*(["\'])([a-f0-9]{64})\1', re.I)
SCOPE = dict(mode='OFFLINE_SAVED_STATIC_DEMO', full_native_query_engine_included=False,
             saved_workbench_only=True, new_corpus_certification=False,
             source_bodies_modified=False, graph_objects_modified=False,
             candidates_or_ranks_modified=False, runtime_javascript_modified=False,
             network_calls=0, model_calls=0)


class BundleError(ValueError):
    pass


def require(value, message):
    if not value:
        raise BundleError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode('ascii')


def pairs(items):
    obj = {}
    for key, value in items:
        require(key not in obj, 'duplicate JSON key')
        obj[key] = value
    return obj


def parse(raw):
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(BundleError('nonfinite JSON')))


def relative(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_./-]+', value), 'unsafe member path')
    require(not value.startswith('/') and all(p not in {'', '.', '..'} for p in value.split('/')),
            'path traversal or noncanonical member path')
    return value


def absolute(value):
    path = Path(value).absolute()
    require('..' not in path.parts and path.resolve() == path, 'symlink or noncanonical absolute path')
    for parent in (path, *path.parents):
        require(not parent.is_symlink(), 'symlink in path')
    return path


def stamp(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), 'symlink or nonregular member')
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def read(path):
    path = absolute(path)
    before = stamp(path)
    require(stat.S_ISREG(before[2]) and before[3] < LIMIT, 'member type or size limit')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        opened = os.fstat(stream.fileno())
        require((opened.st_dev, opened.st_ino) == before[:2], 'member changed before read')
        raw = stream.read(LIMIT)
        after = os.fstat(stream.fileno())
    require(len(raw) < LIMIT and
            (after.st_dev, after.st_ino, after.st_mode, after.st_size, after.st_mtime_ns, after.st_ctime_ns) == before
            and stamp(path) == before, 'member changed during read')
    return raw


def tree(root):
    root = absolute(root)
    require(root.is_dir(), 'directory missing')
    files, dirs, folded = {}, {}, set()
    for directory, children, names in os.walk(root, followlinks=False):
        for name in children + names:
            path = Path(directory) / name
            key = relative(path.relative_to(root).as_posix())
            require(key.casefold() not in folded, 'case-folded member collision')
            folded.add(key.casefold())
            info = stamp(path)
            (dirs if stat.S_ISDIR(info[2]) else files)[key] = info
    return files, dirs


def write(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def pin(raw):
    return dict(bytes=len(raw), sha256=sha(raw))


def checked(raw, record):
    require(type(record.get('bytes')) is int and pin(raw) ==
            {k: record.get(k) for k in ('bytes', 'sha256')}, 'member size/hash mismatch')


def load_guard(checker_dir):
    path = checker_dir / CHECKERS[0]
    module = types.ModuleType('_offline_publication_guard')
    module.__file__ = str(path)
    exec(compile(read(path), str(path), 'exec'), module.__dict__)
    return module


def members(text, start):
    """JSON object member spans, so untouched index entries keep literal bytes."""
    decoder = json.JSONDecoder()
    require(text[start] == '{', 'index object expected')
    pos = start + 1
    while True:
        while text[pos].isspace():
            pos += 1
        if text[pos] == '}':
            return
        key_start = pos
        key, pos = decoder.raw_decode(text, pos)
        while text[pos].isspace():
            pos += 1
        require(text[pos] == ':', 'invalid index member')
        pos += 1
        while text[pos].isspace():
            pos += 1
        value_start = pos
        _, pos = decoder.raw_decode(text, pos)
        yield key, key_start, value_start, pos
        while text[pos].isspace():
            pos += 1
        if text[pos] == '}':
            return
        require(text[pos] == ',', 'invalid index object separator')
        pos += 1


def derive_index(original, pub, manifest):
    index = parse(original)
    require(index.get('version') == 'matryoshka-public-api-index/1', 'unsupported source index')
    entries = index['entries']
    records = {row['logical_key']: row for row in manifest['files']}
    require(len(records) == len(manifest['files']), 'duplicate dataset logical row')
    inventory = {row['path']: row for row in pub['files']}
    updates = {}
    commit = pub['graph_data_manifest']['commit']
    require(re.fullmatch('[a-f0-9]{40}', commit), 'source dataset commit required')
    for logical, entry in entries.items():
        if logical.lstrip('/').startswith('graph-assets-v4/'):
            require(logical in records, 'unknown graph route')
        if 'external_url' not in entry:
            continue
        require(logical in records, 'unknown external route')
        row = records[logical]
        require('path' not in entry and entry['external_url'] ==
                'https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/' + commit + '/' + row['path'],
                'external URL differs from exact committed dataset row')
        updates[logical] = row['path']
    for logical, row in records.items():
        require(logical in entries, 'dataset row absent from source index')
        entry = entries[logical]
        require(entry.get('encoding') == 'gzip' and isinstance(entry.get('mime'), str)
                and re.fullmatch(r'application/json(?:; charset=utf-8)?', entry['mime'], re.I)
                and entry.get('sha256') == row['sha256decoded']
                and entry.get('wire_sha256') == row['wire_sha256'], 'dataset transport pin mismatch')
        if logical not in updates:
            local = inventory.get(entry.get('path'), {})
            require(local.get('sha256') == row['wire_sha256'] and
                    local.get('decoded_sha256') == row['sha256decoded'], 'local bootstrap differs from dataset row')
    text = original.decode('utf-8')
    root_start = len(text) - len(text.lstrip())
    entry_start = next(v for k, _, v, _ in members(text, root_start) if k == 'entries')
    edits = []
    for logical, _, value_start, _ in members(text, entry_start):
        if logical in updates:
            for key, key_start, _, end in members(text, value_start):
                if key == 'external_url':
                    replacement = '"path":' + json.dumps(updates[logical])
                    edits.append((key_start, end, replacement))
    require(len(edits) == len(updates), 'external index transform count mismatch')
    pieces, cursor = [], 0
    for start, end, replacement in sorted(edits):
        pieces.extend((text[cursor:start], replacement))
        cursor = end
    pieces.append(text[cursor:])
    result = ''.join(pieces).encode('utf-8')
    require(not any('external_url' in row for row in parse(result)['entries'].values()),
            'unhandled external route')
    return result, dict(dataset_records=len(records), external_entries_localized=len(updates),
                        local_dataset_entries_preserved=len(records) - len(updates))


class Pins(HTMLParser):
    def __init__(self, path, index_path, old_hash):
        super().__init__(convert_charrefs=True)
        self.path, self.index_path, self.old_hash = path, index_path, old_hash
        self.count = 0

    def handle_starttag(self, tag, attrs):
        require(len(dict(attrs)) == len(attrs), 'duplicate HTML attribute')
        values = dict(attrs)
        src = values.get('src', '')
        runtime = tag == 'script' and PurePosixPath(src).name == 'public-runtime.js'
        if runtime:
            target = PurePosixPath(self.path).parent / src
            require(target.as_posix() == 'runtime/public-runtime.js', 'unknown runtime script location')
            require(values.get('data-index') == self.index_path and
                    values.get('data-index-sha256') == self.old_hash, 'HTML source index pin mismatch')
            require(len(PIN.findall(self.get_starttag_text())) == 1, 'HTML runtime must have exactly one literal pin')
            self.count += 1
            require(self.count == 1, 'multiple HTML runtime scripts')
        else:
            require('data-index' not in values and 'data-index-sha256' not in values,
                    'index pin outside runtime script')

    handle_startendtag = handle_starttag


def transform_html(raw, path, index_path, old_hash, new_hash):
    checker = Pins(path, index_path, old_hash)
    checker.feed(raw.decode('utf-8'))
    checker.close()
    require(len(re.findall(rb'\bdata-index-sha256\b', raw, re.I)) == checker.count,
            'HTML source pin count mismatch')
    transformed, count = PIN.subn(lambda m: m[0].replace(m[2], new_hash), raw.decode('utf-8'))
    require(count == checker.count, 'HTML pin transform count mismatch')
    return transformed.encode('utf-8'), count


def source_inventory(pub):
    rows = pub['files']
    inventory = {}
    reserved = {'datasets', 'provenance', RECEIPT.casefold(), VERIFIER.casefold(), 'publication.json'}
    for row in rows:
        path = relative(row['path'])
        require(path not in inventory and path.split('/')[0].casefold() not in reserved,
                'source inventory collision with offline namespace')
        inventory[path] = row
    return inventory


def derivation(root, original_site, guard, source_pin):
    pub_raw = read(original_site / 'publication.json')
    require(sha(pub_raw) == source_pin, 'trusted source publication SHA256 mismatch')
    pub = parse(pub_raw)
    inventory = source_inventory(pub)
    index_path = relative(pub['api_index'])
    require(index_path.endswith('.json') and index_path in inventory, 'literal JSON source index required')
    original_index = read(original_site / index_path)
    checked(original_index, inventory[index_path])
    manifest_raw = read(root / 'datasets/manifest.json')
    require(sha(manifest_raw) == pub['graph_data_manifest']['sha256'], 'source dataset manifest hash mismatch')
    manifest = parse(manifest_raw)
    new_index, graph_counts = derive_index(original_index, pub, manifest)
    html = {}
    for path, row in inventory.items():
        if path.endswith('.html'):
            old = read(original_site / path)
            new, count = transform_html(old, path, index_path, sha(original_index), sha(new_index))
            require(not count or row.get('role') != 'source_body', 'source-body HTML cannot be transformed')
            html[path] = dict(source=pin(old), offline=pin(new), pins=count)
    require(sum(v['pins'] for v in html.values()) > 0, 'no HTML runtime index pins found')
    result = guard.validate_publication(original_site, dataset_root=root / 'datasets')
    return dict(source_publication_sha256=source_pin, source_version=pub['version'], source_run_id=pub['run_id'],
                source_index_path=index_path, source_index=pin(original_index), offline_index=pin(new_index),
                dataset_manifest_sha256=sha(manifest_raw), html=html, graph_transport=graph_counts,
                source_validation=result), new_index


def verify(bundle, receipt_sha256):
    require(isinstance(receipt_sha256, str) and HEX.fullmatch(receipt_sha256), 'explicit receipt SHA256 required')
    root = absolute(bundle)
    receipt_raw = read(root / RECEIPT)
    require(sha(receipt_raw) == receipt_sha256, 'completed receipt SHA256 mismatch')
    receipt = parse(receipt_raw)
    require(receipt.get('version') == VERSION and receipt.get('status') == 'COMPLETE'
            and receipt.get('scope') == SCOPE, 'unsupported or incomplete offline receipt')
    files, dirs = tree(root)
    inventory = {}
    for row in receipt['files']:
        path = relative(row['path'])
        require(set(row) == {'path', 'bytes', 'sha256'} and path not in inventory and path != RECEIPT,
                'invalid receipt inventory')
        inventory[path] = row
    require(set(inventory) == set(files) - {RECEIPT} and sorted(dirs) == receipt['directories'],
            'immutable bundle membership mismatch')
    for path, row in inventory.items():
        checked(read(root / path), row)
    # Only receipt-authenticated checker source is executed, never source graph JSON.
    guard = load_guard(root / 'provenance/checker')
    pub_raw = read(root / 'provenance/publication.json')
    pub = parse(pub_raw)
    originals = source_inventory(pub)
    index_path = relative(pub['api_index'])
    expected = set(originals) | {'provenance/publication.json', 'provenance/api-index.json', VERIFIER}
    expected.update('provenance/checker/' + name for name in CHECKERS)
    expected.update(path for path in inventory if path.startswith('datasets/'))
    expected.update('provenance/html/' + path for path in originals if path.endswith('.html'))
    require(set(inventory) == expected, 'bundle differs from protected source inventory')
    with tempfile.TemporaryDirectory(prefix='offline-verify-') as temporary:
        view = Path(temporary).resolve() / 'site'
        view.mkdir()
        write(view / 'publication.json', pub_raw)
        for path, row in originals.items():
            origin = ('provenance/api-index.json' if path == index_path else
                      'provenance/html/' + path if path.endswith('.html') else path)
            checked(read(root / origin), row)
            target = view / path
            target.parent.mkdir(parents=True, exist_ok=True)
            # Do not hardlink: link/unlink would change the bundle's inode ctimes.
            write(target, read(root / origin))
        detail, new_index = derivation(root, view, guard, receipt['derivation']['source_publication_sha256'])
        require(encoded(detail) == encoded(receipt['derivation']), 'source attestation differs from offline receipt')
        require(read(root / index_path) == new_index, 'new index differs from exact source transform')
        for path in detail['html']:
            transformed, _ = transform_html(read(view / path), path, index_path,
                                            detail['source_index']['sha256'], detail['offline_index']['sha256'])
            require(read(root / path) == transformed, 'HTML differs from pin-only source transform')
    require(tree(root) == (files, dirs) and read(root / RECEIPT) == receipt_raw,
            'bundle changed during verification')
    return dict(status='PASS', receipt_sha256=receipt_sha256, version=VERSION,
                files=len(files), graph_transport=detail['graph_transport'], network_calls=0)


def disjoint(left, right):
    require(left != right and left not in right.parents and right not in left.parents,
            'source/output overlap')


@contextmanager
def output_lock(output):
    path = output.with_name('.' + output.name + '.offline.lock')
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), 'nonregular cooperating lock')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BundleError('offline output is locked by another builder') from None
        yield
    finally:
        os.close(fd)


def install(stage, output):
    """Atomic exclusive directory rename; never replace even an empty output."""
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        rename = libc.renamex_np
        rename.argtypes = (ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint)
        result = rename(os.fsencode(stage), os.fsencode(output), 0x00000004)  # RENAME_EXCL
    elif sys.platform.startswith('linux') and hasattr(libc, 'renameat2'):
        rename = libc.renameat2
        rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
        result = rename(-100, os.fsencode(stage), -100, os.fsencode(output), 1)  # RENAME_NOREPLACE
    else:
        raise BundleError('atomic exclusive directory rename is unavailable on this platform')
    if result:
        error = ctypes.get_errno()
        raise OSError(error, 'atomic exclusive bundle install failed')


def build(source, output, source_publication_sha256, *, resume=False, receipt_sha256=None):
    require(isinstance(source_publication_sha256, str) and HEX.fullmatch(source_publication_sha256),
            'explicit trusted source publication SHA256 required')
    source, output = absolute(source), absolute(output)
    disjoint(source, output)
    require(source.is_dir() and output.parent.is_dir(), 'source and output parent directories must exist')
    require(output.parent != source and source not in output.parent.parents,
            'stage parent overlaps source')
    wrapper = absolute(__file__)
    disjoint(wrapper, output)
    with output_lock(output):
        if output.exists():
            require(resume and receipt_sha256 is not None, 'output exists; only pinned completed --resume is allowed')
            result = verify(output, receipt_sha256)
            detail = parse(read(output / RECEIPT))['derivation']
            require(detail['source_publication_sha256'] == source_publication_sha256,
                    'resume source publication pin differs')
            return result
        require(not resume and receipt_sha256 is None, 'resume requires an existing completed bundle; no resealing')
        scopes = {name: tree(source / name) for name in ('site', 'datasets')}
        tool_paths = {name: source / 'tools' / name for name in CHECKERS}
        tool_paths[VERIFIER] = wrapper
        tool_stamps = {name: stamp(path) for name, path in tool_paths.items()}
        policies = {name: wrapper.with_name(name) for name in CHECKERS}
        policy_stamps = {name: stamp(path) for name, path in policies.items()}
        roots = {name: stamp(source / name) for name in scopes}
        require(sha(read(source / 'site/publication.json')) == source_publication_sha256,
                'trusted source publication SHA256 mismatch')
        # The stage and persistent lock are external to all source/native artifacts.
        with tempfile.TemporaryDirectory(prefix='.' + output.name + '.stage-', dir=output.parent) as temporary:
            temporary = Path(temporary)
            original, bundle = temporary / 'source-site', temporary / 'bundle'
            original.mkdir()
            bundle.mkdir()
            copied = {}
            for name, (files, dirs) in scopes.items():
                target_root = original if name == 'site' else bundle / name
                target_root.mkdir(exist_ok=True)
                for directory in dirs:
                    (target_root / directory).mkdir(parents=True, exist_ok=True)
                for path, before in files.items():
                    origin = source / name / path
                    require(stamp(origin) == before, 'source changed before snapshot copy')
                    raw = read(origin)
                    require(stamp(origin) == before, 'source changed during snapshot copy')
                    write(target_root / path, raw)
                    copied[(name, path)] = pin(raw)
            for name, path in tool_paths.items():
                raw = read(path)
                require(stamp(path) == tool_stamps[name], 'checker/wrapper changed during snapshot')
                if name in policies:
                    require(raw == read(policies[name]) and stamp(policies[name]) == policy_stamps[name],
                            'source checker differs from the running builder policy')
                target = bundle / (VERIFIER if name == VERIFIER else 'provenance/checker/' + name)
                write(target, raw)
            guard = load_guard(bundle / 'provenance/checker')
            detail, new_index = derivation(bundle, original, guard, source_publication_sha256)
            pub_raw = read(original / 'publication.json')
            pub = parse(pub_raw)
            write(bundle / 'provenance/publication.json', pub_raw)
            index_path = detail['source_index_path']
            write(bundle / 'provenance/api-index.json', read(original / index_path))
            for path in source_inventory(pub):
                if path == index_path:
                    write(bundle / path, new_index)
                elif path.endswith('.html'):
                    raw = read(original / path)
                    write(bundle / ('provenance/html/' + path), raw)
                    new, _ = transform_html(raw, path, index_path,
                                            detail['source_index']['sha256'], detail['offline_index']['sha256'])
                    write(bundle / path, new)
                else:
                    target = bundle / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.rename(original / path, target)
            files, dirs = tree(bundle)
            receipt = dict(version=VERSION, status='COMPLETE', scope=SCOPE, derivation=detail,
                           directories=sorted(dirs),
                           files=[dict(path=path, **pin(read(bundle / path))) for path in sorted(files)])
            receipt_raw = encoded(receipt)
            write(bundle / RECEIPT, receipt_raw)
            result = verify(bundle, sha(receipt_raw))
            for name, before in scopes.items():
                require(stamp(source / name) == roots[name] and tree(source / name) == before,
                        'source membership or metadata changed during build')
                for path in before[0]:
                    checked(read(source / name / path), copied[(name, path)])
            for name, path in tool_paths.items():
                require(stamp(path) == tool_stamps[name], 'checker/wrapper changed during build')
                target = bundle / (VERIFIER if name == VERIFIER else 'provenance/checker/' + name)
                require(read(path) == read(target), 'checker/wrapper changed during build')
            # Catch changes to an early file while later files were rehashed.
            for name, before in scopes.items():
                require(stamp(source / name) == roots[name] and tree(source / name) == before,
                        'source changed during final snapshot recheck')
            require(all(stamp(path) == tool_stamps[name] for name, path in tool_paths.items()),
                    'checker/wrapper changed during final recheck')
            require(all(stamp(path) == policy_stamps[name] for name, path in policies.items()),
                    'builder policy changed during final recheck')
            install(bundle, output)
            return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    make = sub.add_parser('build', help='copy and attest a new offline bundle, never overwrite')
    make.add_argument('--source', type=Path, required=True, help='public project containing site/, datasets/, tools/')
    make.add_argument('--output', type=Path, required=True, help='new directory outside the source project')
    make.add_argument('--source-publication-sha256', required=True)
    make.add_argument('--resume', action='store_true', help='verify an existing completed bundle only')
    make.add_argument('--receipt-sha256', help='mandatory completed receipt pin for --resume')
    check = sub.add_parser('verify', help='independent read-only verification; no source workspace needed')
    check.add_argument('--bundle', type=Path, required=True)
    check.add_argument('--receipt-sha256', required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'build':
            result = build(args.source, args.output, args.source_publication_sha256,
                           resume=args.resume, receipt_sha256=args.receipt_sha256)
        else:
            result = verify(args.bundle, args.receipt_sha256)
    except (ValueError, OSError, KeyError, TypeError, StopIteration, IndexError) as exc:
        print('OFFLINE BUNDLE FAIL: ' + type(exc).__name__ + ': ' + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())

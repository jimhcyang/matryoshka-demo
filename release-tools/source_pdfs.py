"""Postrun original-PDF delivery checks, never evidence-eligibility authority."""
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import parse_qsl, urlencode, urlsplit


PDF_LIMIT = 32 * 1024**2
PDF_PATH = re.compile(r'datasets/cib/source-pdfs/([a-f0-9]{64})\.pdf')
PDF_URL = re.compile(r'https://raw\.githubusercontent\.com/jimhcyang/matryoshka-demo/'
                     r'([a-f0-9]{40})/(datasets/cib/source-pdfs/([a-f0-9]{64})\.pdf)')


def unique(pairs):
    value = {}
    for key, item in pairs:
        assert key not in value, 'Duplicate PDF delivery metadata key'
        value[key] = item
    return value


def pdf_dataset(key, entry):
    """Reject every external PDF contract except a canonical ordinary route."""
    assert isinstance(key, str) and isinstance(entry, dict), 'Invalid PDF catalog entry'
    parsed = urlsplit(key)
    pairs = parse_qsl(parsed.query, keep_blank_values=True)
    params = dict(pairs)
    assert parsed.path == '/api/cib-pdf' and not parsed.scheme and not parsed.netloc and not parsed.fragment
    assert len(pairs) == 2 and set(params) == {'doc_id', 'release'} and params['doc_id']
    assert not re.search(r'[\x00-\x1f]', params['doc_id']) and len(params['doc_id']) <= 4096
    assert params['release'] in {'earlier', 'later'}
    assert key == '/api/cib-pdf?' + urlencode(sorted(params.items())), 'Noncanonical PDF route'
    match = PDF_URL.fullmatch(entry.get('external_url', ''))
    assert match and 'path' not in entry and entry.get('corpus', 'cib') == 'cib', 'Unapproved external PDF URL'
    assert entry.get('encoding') == 'identity' and entry.get('mime') == 'application/pdf'
    assert entry.get('wire_sha256') == entry.get('sha256') == match[3], 'PDF dual SHA pins differ'
    return dict(path=match[2], wire_sha256=match[3], sha256decoded=match[3], external_url=entry['external_url'])


def pdf_bytes(path, row):
    path = Path(path).absolute()
    assert path.resolve() == path and path.is_file() and not path.is_symlink(), 'Missing or linked PDF'
    size = path.stat().st_size
    assert 0 < size <= PDF_LIMIT, 'PDF byte limit'
    raw = path.read_bytes()
    assert len(raw) == size and b'%PDF-' in raw[:1024], 'Original PDF header missing'
    assert hashlib.sha256(raw).hexdigest() == row['wire_sha256'] == row['sha256decoded'], 'PDF SHA mismatch'
    if 'bytes' in row:
        assert row['bytes'] == row['decoded_bytes'] == size, 'PDF size differs'
    return raw


def bind_local_pdf_catalog(entries, local_pdfs, commit_by_sha256):
    """Return a new route map from an already source-validated LocalPDFs reader.

    packet() rechecks each original's document/release, length and actual bytes.
    The caller publishes data and supplies commit pins; this function never
    fetches, writes, chooses a source, or changes a source-eligibility policy.
    """
    result = dict(entries)
    hashes = set()
    routes = 0
    for document, releases in sorted(local_pdfs.entries.items()):
        assert set(releases) == {'earlier', 'later'}, 'Both source releases required'
        for release in ('earlier', 'later'):
            row = releases[release]
            key = '/api/cib-pdf?' + urlencode(sorted(dict(doc_id=document, release=release).items()))
            raw, mime = local_pdfs.packet(key)
            digest = hashlib.sha256(raw).hexdigest()
            assert mime == 'application/pdf' and raw.startswith(b'%PDF-') and 0 < len(raw) <= PDF_LIMIT
            assert digest == row['sha256'] and len(raw) == row['bytes'], 'Source catalog original differs'
            commit = commit_by_sha256[digest]
            assert isinstance(commit, str) and re.fullmatch('[a-f0-9]{40}', commit), 'Immutable PDF commit missing'
            value = dict(external_url='https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/' + commit
                         + '/datasets/cib/source-pdfs/' + digest + '.pdf',
                         encoding='identity', mime='application/pdf', sha256=digest, wire_sha256=digest)
            pdf_dataset(key, value)
            if key in result:
                old = result[key]
                assert old.get('sha256') == old.get('wire_sha256') == digest
                assert old.get('encoding') == 'identity' and old.get('mime') == mime, 'Existing PDF route changed bytes'
                if 'external_url' in old:
                    pdf_dataset(key, old)
                    assert old == value, 'Existing immutable PDF URL changed'
            result[key] = value
            routes += 1
            hashes.add(digest)
    assert set(commit_by_sha256) == hashes, 'PDF commit map differs from source inventory'
    return result, dict(documents=len(local_pdfs.entries), routes=routes, files=len(hashes),
                        bytes_checked_via_original_catalog=True, inspection_only=True,
                        source_catalog_ref=local_pdfs.ref, resource_id=local_pdfs.resource_id)


def validate_pdf_delivery(site, repository, entries, ref):
    """Validate the PDF subset of the already pinned combined delivery file."""
    assert ref.get('path') == 'data/dataset-delivery.json'
    path = Path(site).absolute() / ref['path']
    assert path.resolve() == path and path.is_file()
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == ref.get('sha256'), 'PDF delivery manifest SHA mismatch'
    value = json.loads(raw, object_pairs_hook=unique)
    assert value['version'] == 'same-repository-dataset-delivery/1'
    assert value['repository'] == 'https://github.com/jimhcyang/matryoshka-demo'
    files = {r['path']: r for r in value['files']}
    assert len(files) == len(value['files']), 'Duplicate delivery path'
    pdf_entries = {key: entry for key, entry in entries.items()
                   if 'external_url' in entry and key.split('?')[0] == '/api/cib-pdf'}
    checked = set()
    for key, entry in pdf_entries.items():
        expected = pdf_dataset(key, entry)
        assert value['routes'].get(key) == expected['path'], 'PDF route not registered'
        row = files[expected['path']]
        assert all(row.get(k) == v for k, v in expected.items()), 'PDF registration differs'
        if row['path'] not in checked:
            pdf_bytes(Path(repository) / row['path'], row)
            checked.add(row['path'])
    assert checked == {p for p in files if PDF_PATH.fullmatch(p)}, 'Unreferenced or missing PDF registration'
    directory = Path(repository).absolute() / 'datasets/cib/source-pdfs'
    if directory.exists():
        assert directory.resolve() == directory and directory.is_dir(), 'Linked source PDF directory'
        actual = {p.relative_to(Path(repository).absolute()).as_posix() for p in directory.iterdir()}
        assert actual == checked, 'Source PDF directory contains undeclared files'
    else:
        assert not checked, 'Missing source PDF directory'
    return dict(files=len(checked), routes=len(pdf_entries), paths=sorted(checked),
                bytes=sum(files[p]['bytes'] for p in checked), inspection_only=True)

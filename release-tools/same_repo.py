"""Original immutable same-repository graph delivery, without graph repacking."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
from source_pdfs import pdf_dataset, pdf_bytes, validate_pdf_delivery

PATTERN = re.compile(r'https://raw\.githubusercontent\.com/jimhcyang/matryoshka-demo/([a-f0-9]{40})/datasets/(cib|iran|vietnam)/([a-f0-9]{64})\.json\.gz')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def dataset(key, entry):
    if key.split('?')[0] == '/api/cib-pdf':
        return pdf_dataset(key, entry)
    match = PATTERN.fullmatch(entry.get('external_url', ''))
    assert match and key.startswith('/graph-assets-v4/' + match[2] + '/')
    assert entry['encoding'] == 'gzip' and entry['mime'] == 'application/json'
    assert match[3] == entry['wire_sha256'] and re.fullmatch('[a-f0-9]{64}', entry['sha256'])
    return dict(path='datasets/' + match[2] + '/' + match[3] + '.json.gz', wire_sha256=entry['wire_sha256'],
        sha256decoded=entry['sha256'], external_url=entry['external_url'])


def manifest(package, entries, map_index_sha256, guard=lambda: None):
    files, routes = {}, {}
    for key, entry in entries.items():
        if not entry.get('external_url'):
            continue
        row = dataset(key, entry)
        routes[key] = row['path']
        if row['path'] in files:
            assert files[row['path']]['sha256decoded'] == row['sha256decoded']
            continue
        guard()
        path = package / row['path']
        assert path.resolve() == path and path.is_file()
        wire = path.read_bytes()
        assert sha(wire) == row['wire_sha256']
        raw = pdf_bytes(path, row) if row['path'].endswith('.pdf') else gzip.decompress(wire)
        assert sha(raw) == row['sha256decoded']
        files[row['path']] = dict(row, bytes=len(wire), decoded_bytes=len(raw))
    return dict(version='same-repository-dataset-delivery/1', original_map_index_sha256=map_index_sha256,
        repository='https://github.com/jimhcyang/matryoshka-demo', files=list(files.values()), routes=routes,
        pages_fully_offline=False, installed_repository_self_contained=True,
        localhost_mirror='/datasets/{corpus}/{wire_sha256}.json.gz', native_or_graph_content_modified=False,
        source_pdf_mirror='/datasets/cib/source-pdfs/{wire_sha256}.pdf', source_pdf_inspection_only=True)


def validate(site, repository):
    value = json.loads((site / 'data/dataset-delivery.json').read_bytes())
    assert value['version'] == 'same-repository-dataset-delivery/1'
    files = {r['path']:r for r in value['files']}
    assert len(files) == len(value['files'])
    index = json.loads((site / 'data/api-index.json').read_bytes())['entries']
    original = gzip.decompress((site / 'data/original-map-index.json.gz').read_bytes())
    assert sha(original) == value['original_map_index_sha256']
    original_entries = json.loads(original)['entries']
    assert {k:v for k,v in index.items() if k.startswith('/graph-assets-v4/')} == {
        k:v for k,v in original_entries.items() if k.startswith('/graph-assets-v4/')}, 'Original graph routes/wire entries changed'
    external = {k:v for k,v in index.items() if v.get('external_url')}
    assert set(external) == set(value['routes'])
    checked = set()
    for key, entry in external.items():
        expected = dataset(key, entry)
        assert value['routes'][key] == expected['path']
        row = files[expected['path']]
        assert all(row[k] == v for k,v in expected.items())
        if row['path'] not in checked:
            path = repository / row['path']
            assert path.resolve() == path and path.is_file()
            wire = path.read_bytes()
            assert len(wire) == row['bytes'] and sha(wire) == row['wire_sha256']
            raw = pdf_bytes(path, row) if row['path'].endswith('.pdf') else gzip.decompress(wire)
            assert len(raw) == row['decoded_bytes'] and sha(raw) == row['sha256decoded']
            checked.add(row['path'])
    assert checked == set(files)
    pdfs = validate_pdf_delivery(site, repository, index, dict(path='data/dataset-delivery.json',
        sha256=sha((site / 'data/dataset-delivery.json').read_bytes())))
    return dict(files=len(files), routes=len(external), bytes=sum(r['bytes'] for r in files.values()),
        all_original_wire_and_decoded_hashes_checked=True, source_pdfs=pdfs)

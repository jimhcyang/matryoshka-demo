"""Fresh release integrity gate, not the historical cohort/privacy validator."""
import argparse
import gc
import gzip
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import urlencode, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fragment_reader import Reader
from same_repo import validate as validate_datasets


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode()


def unique(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, 'Repeated JSON key'
        result[key] = value
    return result


def load(raw):
    return json.loads(raw, object_pairs_hook=unique)


def at(root, relative):
    assert relative and not relative.startswith('/') and '\\' not in relative
    assert all(p not in ('', '.', '..') for p in relative.split('/'))
    path = root / relative
    assert path.resolve() == path and path.is_file() and not path.is_symlink()
    return path


def route(name, params):
    return '/api/current/' + name + '?' + urlencode(sorted(params.items()))


def source_refs(value):
    if isinstance(value, dict):
        if set(value) >= {'path', 'sha256'} and isinstance(value['path'], str) and re.fullmatch('[a-f0-9]{64}', value.get('sha256', '')):
            yield dict(path=value['path'], sha256=value['sha256'])
        for child in value.values():
            yield from source_refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from source_refs(child)


def inventory(site):
    rows = []
    for p in sorted(site.rglob('*')):
        assert not p.is_symlink(), 'Symlinks are not publication assets'
        if p.is_file() and p.name != 'release-manifest.json':
            raw = p.read_bytes()
            row = dict(path=str(p.relative_to(site)), bytes=len(raw), sha256=sha(raw))
            if p.name.endswith('.gz'):
                row['decoded_sha256'] = sha(gzip.decompress(raw))
            rows.append(row)
    return rows


def make(site, receipt):
    report = load((site / 'data/report-v6.json').read_bytes())
    refs = {encoded(r): r for r in source_refs(report)}
    value = dict(version='source-bound-static-release/1', base_path='/matryoshka-demo/',
        source_report_ref=receipt['source_report_ref'], casebook_ref=receipt['casebook_ref'], digest_ref=receipt['digest_ref'],
        field_guide=receipt.get('field_guide'),
        code_bundle=receipt.get('code_bundle'),
        graph_delivery=receipt.get('graph_delivery', 'fragment'), dataset_delivery_ref=receipt.get('dataset_delivery_ref'),
        backend_snapshot=dict(tree_sha256=receipt['backend_code_sha256'], canonical=False),
        original_refs=[refs[k] for k in sorted(refs)], case_ids=[r['case']['case_id'] for r in report['cases']],
        api_index=dict(path='data/api-index.json', sha256=sha((site / 'data/api-index.json').read_bytes())),
        files=inventory(site), publish_authorized=False, privacy_approval_inherited=False,
        native_outputs_modified=False, inference_api_calls=0, research_qualification_claimed=False)
    (site / 'release-manifest.json').write_bytes(encoded(value))
    return value


def validate_field_guide(site, binding, report, report_ref):
    if binding is None:
        return
    assert binding['source_report_ref'] == report_ref
    assets = {r['target']:r for r in binding['assets']}
    assert set(assets) == {'docs/matryoshka-guide.pdf', 'docs/matryoshka-guide.txt', 'docs/guide-public.json'}
    for target, ref in assets.items():
        assert sha(at(site, target).read_bytes()) == ref['public_sha256'] == ref['source_ref']['sha256']
    raw = at(site, 'docs/guide-public.json').read_bytes()
    assert sha(raw) == binding['guide_public_ref']['sha256']
    guide = load(raw)
    assert guide['version'] == 'evidence-field-guide/1' and guide['mode'] == 'saved_report_snapshot'
    assert guide['report_byte_sha256'] == report_ref['sha256']
    assert guide['files'] == {'field-guide.pdf':assets['docs/matryoshka-guide.pdf']['public_sha256'],
        'field-guide.txt':assets['docs/matryoshka-guide.txt']['public_sha256']}
    cases = {r['case']['case_id']:r['case'] for r in report['cases']}
    rows = guide['cases']
    assert len(rows) == len({r['case_id'] for r in rows}) == len(cases)
    assert {r['case_id'] for r in rows} == set(cases)
    for row in rows:
        case = cases[row['case_id']]
        assert row['query_utf8_sha256'] == sha(case['query'].encode('utf-8'))
        assert row['task'] == case['task'] and row['corpus'] == case['corpus']


class Dependencies(HTMLParser):
    def __init__(self, site, path):
        super().__init__()
        self.site, self.path = site, path
    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        key = 'src' if tag in {'script', 'img', 'iframe', 'source'} else 'href' if tag == 'link' else None
        if key and attrs.get(key):
            target = attrs[key]
            if target.startswith(('data:', 'blob:', 'about:', '#')):
                return
            assert not urlsplit(target).scheme and not target.startswith('//'), 'External runtime dependency'
            assert not target.startswith('/'), 'Root-relative HTML dependency is not project-prefix safe'
            at(self.site, str((self.path.parent / urlsplit(target).path).relative_to(self.site)))


def validate(site, scratch, *, full=True, repository=None, minimum_free_bytes=8 * 1024**3):
    manifest = load((site / 'release-manifest.json').read_bytes())
    assert manifest['version'] == 'source-bound-static-release/1' and manifest['base_path'] == '/matryoshka-demo/'
    expected = manifest['files']
    assert expected == inventory(site), 'Whole asset inventory/hash mismatch'
    assert sum(row['bytes'] for row in expected) < 900_000_000, 'Pages stage exceeds lead-approved 900MB guard'
    assert all(row['bytes'] < 100_000_000 for row in expected), 'Published file exceeds 100MB guard'
    for row in expected:
        if row['path'].endswith('.html'):
            path = at(site, row['path'])
            Dependencies(site, path).feed(path.read_text())
    report_raw = (site / 'data/report-v6.json').read_bytes()
    report = load(report_raw)
    assert sha(report_raw) == manifest['source_report_ref']['sha256']
    validate_field_guide(site, manifest.get('field_guide'), report, manifest['source_report_ref'])
    if manifest.get('code_bundle'):
        code = manifest['code_bundle']
        assert sha(at(site, code['path']).read_bytes()) == code['sha256']
        assert sha(at(site, code['manifest_path']).read_bytes()) == code['manifest_sha256']
        assert code['source_backend_tree_sha256'] == manifest['backend_snapshot']['tree_sha256']
    assert manifest['case_ids'] == [r['case']['case_id'] for r in report['cases']]
    refs = {encoded(r): r for r in source_refs(report)}
    assert manifest['original_refs'] == [refs[k] for k in sorted(refs)], 'Original source/native/report references changed'
    index_raw = at(site, manifest['api_index']['path']).read_bytes()
    assert sha(index_raw) == manifest['api_index']['sha256']
    entries = load(index_raw)['entries']
    datasets = None
    if manifest['graph_delivery'] == 'same-repository':
        ref = manifest['dataset_delivery_ref']
        assert sha(at(site, ref['path']).read_bytes()) == ref['sha256']
        datasets = validate_datasets(site, repository or site.parent)
    else:
        assert not any(e.get('external_url') for e in entries.values()), 'External data dependency remains'
    scratch.mkdir(parents=True, exist_ok=True)
    roots, native_rows = set(), []
    with tempfile.TemporaryDirectory(dir=scratch) as temporary:
        reader = Reader(site, Path(temporary) / 'verification.sqlite3', minimum_free_bytes=minimum_free_bytes)
        try:
            for key, entry in entries.items():
                assert key.startswith(('/api/', '/graph-assets-v4/', '/data/', '/swedish-study-'))
                if entry.get('external_url'):
                    continue
                if entry['encoding'] == 'fragment-dag':
                    identity = entry['path'], entry['asset']
                    reader.pack(entry)
                    if full and identity not in roots:
                        for _ in reader.stream(entry):
                            pass
                    roots.add(identity)
                else:
                    reader.read(entry)
            def packet(key):
                return load(reader.read(entries[key]))
            assert packet('/api/current/casebook')['source_report_sha256'] == manifest['source_report_ref']['sha256']
            assert packet('/api/narrative-v1/manifest')['report_ref'] == manifest['source_report_ref']
            for row in report['cases']:
                for config, item in row['configurations'].items():
                    params = dict(case_id=row['case']['case_id'], config=config,
                        **{k: row['resource_binding'][k] for k in ('resource_id', 'registry_sha256', 'index_sha256')})
                    condition = packet(route('condition-v6', params))
                    assert condition['case'] == row['case'] and condition['resource_binding'] == row['resource_binding']
                    saved = condition['configurations'][config]
                    assert saved['native_checkpoint'] == item['native_checkpoint']
                    native = packet(route('native-v6', params))['native']
                    assert native['public_case'] == row['case']
                    assert native['native_checksum'] == sha(encoded(native['result'])) == saved['native_checksum']
                    native_rows.append(dict(case_id=row['case']['case_id'], config=config, native_checkpoint=item['native_checkpoint'], core_checksum=native['native_checksum']))
                    del native, condition, saved
                    gc.collect()
            for corpus in ('cib', 'iran', 'vietnam'):
                binding = packet('/api/graph-v4-viewer?corpus=' + corpus)
                slots = packet('/data/slots/' + corpus + '.json')
                assert slots['status']['graph_run_id'] == binding['graph_run_id']
                assert slots['status']['hierarchy_run_id'] == binding['hierarchy_run_id']
                assert slots['status']['hidden_values_read'] is False and slots['status']['coverage']['complete']
        finally:
            reader.close()
    return dict(status='PASS', kind='TRANSPORT_AND_REFERENCE_INTEGRITY_ONLY', files=len(expected),
        stored_bytes=sum(r['bytes'] for r in expected), largest_file=max(r['bytes'] for r in expected),
        logical_roots=len(roots), all_logical_roots_reconstructed=full, native=native_rows,
        source_report_ref=manifest['source_report_ref'], manifest_sha256=sha((site / 'release-manifest.json').read_bytes()),
        same_repository_datasets=datasets, minimum_free_bytes=minimum_free_bytes,
        publish_authorized=False, privacy_or_research_approval_created=False)


def authorize(site, approval_ref):
    assert approval_ref is not None, 'Fresh lead-authored release authorization is required'
    approval_ref = approval_ref.absolute()
    assert approval_ref.resolve() == approval_ref and not approval_ref.is_symlink(), 'Unsafe authorization reference'
    ref = load(approval_ref.read_bytes())
    path = at(approval_ref.parent, ref['path'])
    raw = path.read_bytes()
    assert sha(raw) == ref['sha256']
    approval = load(raw)
    manifest = load((site / 'release-manifest.json').read_bytes())
    assert approval['version'] == 'source-bound-release-authorization/1'
    assert approval['candidate_manifest_sha256'] == sha((site / 'release-manifest.json').read_bytes())
    assert approval['source_report_sha256'] == manifest['source_report_ref']['sha256']
    assert approval['backend_code_sha256'] == manifest['backend_snapshot']['tree_sha256']
    assert approval['publish_authorized'] is True and approval['new_data_qa_accepted'] is True
    assert approval['privacy_review_accepted'] is True and approval['licensing_review_accepted'] is True
    assert approval['scope'] in ('diagnostic_demo_with_declared_limitations', 'qualified_release')
    assert isinstance(approval['qualified_data_qa_ref'], dict) and re.fullmatch('[a-f0-9]{64}', approval['qualified_data_qa_ref'].get('sha256', ''))
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mode', choices=('staging', 'publish'), default='staging')
    parser.add_argument('--approval-ref', type=Path)
    parser.add_argument('--inventory-only', action='store_true')
    parser.add_argument('--repository-root', type=Path, help='Installed repository root containing datasets/; default site/..')
    parser.add_argument('--minimum-free-gib', type=int, choices=(3, 8), default=8,
                        help='Disk reserve; default 8 GiB, explicit bounded-workstation option 3 GiB')
    args = parser.parse_args()
    result = validate(args.site.resolve(), args.scratch, full=not args.inventory_only, repository=args.repository_root,
                      minimum_free_bytes=args.minimum_free_gib * 1024**3)
    if args.mode == 'publish':
        result['publish_authorized'] = authorize(args.site.resolve(), args.approval_ref)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'native'}))


if __name__ == '__main__':
    main()

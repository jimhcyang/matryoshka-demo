"""Small synthetic publications only: no real datasets, Git, or network calls."""
import fcntl
import gzip
import importlib.util
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import urllib.request

import pytest


TOOLS = Path(__file__).resolve().parents[1] / 'tools'
SPEC = importlib.util.spec_from_file_location('offline_bundle', TOOLS / 'build_offline_bundle.py')
offline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(offline)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('network is forbidden, including raw GitHub')
    monkeypatch.setattr(socket, 'create_connection', forbidden)
    monkeypatch.setattr(socket.socket, 'connect', forbidden)
    monkeypatch.setattr(urllib.request, 'urlopen', forbidden)


def put(root, path, raw):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    return raw


def obj(root, path):
    return json.loads((root / path).read_bytes())


def pack(value):
    return gzip.compress(offline.encoded(value), mtime=0)


def repin(project):
    site = project / 'site'
    publication = obj(site, 'publication.json')
    old_rows = {v['path']: v for v in publication['files']}
    publication['graph_data_manifest']['sha256'] = offline.sha((project / 'datasets/manifest.json').read_bytes())
    index_hash = offline.sha((site / publication['api_index']).read_bytes())
    for path in site.rglob('*.html'):
        raw = path.read_text()
        path.write_text(offline.PIN.sub(lambda m: m[0].replace(m[2], index_hash), raw))
    publication['files'] = []
    for path in sorted(site.rglob('*')):
        if not path.is_file() or path.name == 'publication.json':
            continue
        key = path.relative_to(site).as_posix()
        raw = path.read_bytes()
        row = dict(path=key, **offline.pin(raw))
        row.update({k: v for k, v in old_rows.get(key, {}).items() if k in {'role', 'source_ids'}})
        if key.endswith('.json.gz'):
            row['decoded_sha256'] = offline.sha(gzip.decompress(raw))
        publication['files'].append(row)
    put(site, 'publication.json', offline.encoded(publication))
    return offline.sha((site / 'publication.json').read_bytes())


@pytest.fixture
def project(tmp_path):
    root = tmp_path / 'public-project'
    root.mkdir()
    for name in offline.CHECKERS:
        put(root, 'tools/' + name, (TOOLS / name).read_bytes())
    site = root / 'site'
    put(site, '.nojekyll', b'')
    put(site, 'NOTICES.txt', b'Synthetic public historical material authorization for tests only.\n')
    put(site, 'runtime/public-runtime.js', b'"use strict"; /* immutable fixture runtime */\n')
    put(site, 'data/source.txt', b'Historical SECRET: password=OLD CODE; /home/ is original source wording.\n')
    entries, rows, releases = {}, [], {}
    release_specs = [('cib', 'current', 'current-exploration'), ('cib', 'study', 'saved-study'),
                     ('iran', 'legacy', 'current-and-saved-study'),
                     ('vietnam', 'legacy', 'current-and-saved-study')]
    for corpus, suffix, role in release_specs:
        release_key = corpus + '_' + suffix
        graph, hierarchy = 'graph_' + release_key, 'hierarchy_' + release_key
        review = 'source-reviewed-engineering-checks-pass' if suffix == 'current' else 'legacy-not-revalidated'
        release = dict(corpus=corpus, graph_id=graph, hierarchy_id=hierarchy, role=role,
                       alias_review_status=review, independent_accuracy_established=False)
        if suffix == 'current':
            release['source_resource'] = dict(id='resource_cib_current', sha256='c' * 64)
        releases[release_key] = release
        for kind in ('comparison', 'search', 'nodes'):
            name = release_key + '_' + kind + '.json'
            logical = '/graph-assets-v4/' + corpus + '/' + name
            value = dict(version='native-fixture/1', graph_run_id=graph, hierarchy_run_id=hierarchy,
                         nodes=[dict(id=release_key + '_entity', reference_scope='source-document',
                                     instance_identity_asserted=False, source_id=corpus + '_source',
                                     text='SECRET historical /home/ source: password=OLD CODE')],
                         rank=3, candidates=['unchanged_candidate'], kind=kind)
            raw = pack(value)
            path = 'datasets/' + corpus + '/' + offline.sha(raw) + '.json.gz'
            put(root, path, raw)
            row = dict(path=path, corpus=corpus, logical_key=logical, release_key=release_key,
                       graph_id=graph, hierarchy_id=hierarchy, bytes=len(raw), wire_sha256=offline.sha(raw),
                       sha256decoded=offline.sha(gzip.decompress(raw)), source_wire_sha256=offline.sha(raw),
                       all_graph_objects_preserved=True, workstation_metadata_removed=False)
            rows.append(row)
            entry = dict(encoding='gzip', mime='application/json', sha256=row['sha256decoded'],
                         wire_sha256=row['wire_sha256'])
            if kind == 'nodes':
                entry['external_url'] = ('https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/'
                                         + 'd' * 40 + '/' + path)
            else:
                entry['path'] = 'data/bootstrap/' + row['wire_sha256'] + '.json.gz'
                put(site, entry['path'], raw)
            entries[logical] = entry
        query = '?corpus=' + corpus + ('&revision=study' if suffix == 'study' else '')
        binding = dict(graph_run_id=graph, hierarchy_run_id=hierarchy, pdf_available=False,
                       asset_base='/graph-assets-v4/' + corpus + '/',
                       comparison_asset=release_key + '_comparison.json', search_asset=release_key + '_search.json',
                       comparison_sha256=entries['/graph-assets-v4/' + corpus + '/' + release_key + '_comparison.json']['sha256'],
                       search_sha256=entries['/graph-assets-v4/' + corpus + '/' + release_key + '_search.json']['sha256'])
        if 'source_resource' in release:
            binding['source_resource'] = release['source_resource']
        raw = pack(binding)
        path = 'data/bindings/' + release_key + '.json.gz'
        put(site, path, raw)
        entry = dict(path=path, encoding='gzip', mime='application/json',
                     sha256=offline.sha(gzip.decompress(raw)), wire_sha256=offline.sha(raw))
        entries['/api/graph-v4-viewer' + query] = entry
        if suffix == 'legacy':
            entries['/api/graph-v4-viewer?corpus=' + corpus + '&revision=study'] = dict(entry)
    raw = pack(dict(case_id='saved-1', config='llm_readings', rank=2, candidates=['saved_candidate'],
                    source=dict(source_id='old_source', text='SECRET historical source wording /home/')))
    path = 'data/saved.json.gz'
    put(site, path, raw)
    entries['/api/condition-v6?case_id=saved-1&config=llm_readings'] = dict(
        path=path, encoding='gzip', mime='application/json', wire_sha256=offline.sha(raw),
        sha256=offline.sha(gzip.decompress(raw)))
    # A literal packed saved source keeps number lexemes and apparent "$ref" data.
    fragment = (b'{"source_id":"historical_source","text":"SECRET password=OLD; /home/ is quoted.",'
                b'"number":1e-09,"literal":["$ref",1]}')
    packing = offline.load_guard(root / 'tools').pack_module()
    chunk_decoded = packing.encoded(dict(version=packing.CHUNK_VERSION, first_id=1,
                                         fragments=[[fragment.decode('ascii')]]))
    chunk_wire = gzip.compress(chunk_decoded, mtime=0)
    chunk_path = 'chunks/' + offline.sha(chunk_wire) + '.json.gz'
    put(site, 'data/packed/' + chunk_path, chunk_wire)
    chunk = dict(id=0, path=chunk_path, encoding='gzip', wire_sha256=offline.sha(chunk_wire),
                 sha256decoded=offline.sha(chunk_decoded), decoded_bytes=len(chunk_decoded),
                 wire_bytes=len(chunk_wire), first_id=1, last_id=1)
    packed_manifest = packing.sealed(dict(version=packing.VERSION, status='COMPLETE', encoding='fragment-dag',
        chunks=[chunk], assets={'saved_source': dict(encoding='fragment-dag', pieces=['', 1, ''], dependencies=[0],
        sha256decoded=offline.sha(fragment), decoded_bytes=len(fragment), originalsha256='1' * 64,
        original_decoded_sha256='2' * 64)}, original_assets_modified=False, all_roots_transport_verified=True))
    manifest_raw = packing.encoded(packed_manifest)
    put(site, 'data/packed/manifest.json', manifest_raw)
    entries['/api/source-v6?case_id=saved-1&source_id=historical_source'] = dict(
        path='data/packed/manifest.json', encoding='fragment-dag', mime='application/json', asset='saved_source',
        manifest_sha256=offline.sha(manifest_raw), sha256=offline.sha(fragment))
    # Deliberately noncanonical whitespace: only external_url member spans may change.
    put(site, 'data/api-index.json', json.dumps(dict(version='matryoshka-public-api-index/1', entries=entries),
                                             indent=2, ensure_ascii=False).encode() + b'\n')
    for path in ('index.html', 'workbench-v6.html', 'graph-full-v6.html', 'runtime/replay.html'):
        script = 'public-runtime.js' if path.startswith('runtime/') else 'runtime/public-runtime.js'
        put(site, path, ('<!doctype html><html><head><script src="' + script + '" '
                         'data-index="data/api-index.json" data-index-sha256="' + 'a' * 64 + '"></script>'
                         '</head><body>Saved static fixture only.</body></html>\n').encode())
    manifest = dict(version='public-graph-datasets/2', files=rows, graph_releases=releases,
                    source_binding_sha256='e' * 64, source_bodies_modified=False, original_graph_modified=False,
                    rights_notice='Previously public historical sources; fixture authorization only.')
    put(root, 'datasets/manifest.json', offline.encoded(manifest))
    put(root, 'datasets/README.md', b'Fixture graph scope; not a new certification.\n')
    publication = dict(version='public-presentation/6.7', run_id='synthetic_67',
                       ref=dict(run_id='saved_original', sha256='b' * 64), base_path='/matryoshka-demo/',
                       api_index='data/api-index.json', case_ids=['saved-1'],
                       cases=[dict(case_id='saved-1', group='presentation', canonical_fact_family='fact_1', polarity='positive')],
                       publicness={key: True for key in ('approved', 'historical_public_sources',
                           'heldout_answers_intentionally_public', 'previously_public_historical_sources_only',
                           'no_private_workspace_material', 'not_a_declassification_claim')},
                       licensing=dict(status='approved', code='Fixture authorization', data='Fixture authorization',
                                      notices=['NOTICES.txt']),
                       sources=[dict(id=corpus, publicly_released=True, provenance_url='https://archive.example.org/',
                                     rights_status='approved', rights_basis='Synthetic fixture authorization',
                                     rights_reference='https://archive.example.org/rights')
                                for corpus in ('cib', 'iran', 'vietnam')],
                       graph_data_manifest=dict(path='datasets/manifest.json', commit='d' * 40, sha256='f' * 64),
                       historical_scope=dict(cutoff='1961-08-01', whole_origin_exclusion=True),
                       files=[dict(path='data/source.txt', role='source_body', source_ids=['cib'])])
    put(site, 'publication.json', offline.encoded(publication))
    repin(root)
    return root


def build(project, tmp_path, **kwargs):
    return offline.build(project, tmp_path / 'offline-v1',
                         offline.sha((project / 'site/publication.json').read_bytes()), **kwargs)


def snapshot(root):
    return {p.relative_to(root).as_posix(): (p.read_bytes(), offline.stamp(p))
            for p in root.rglob('*') if p.is_file()}


def assert_clean_failure(project, tmp_path):
    with pytest.raises((ValueError, OSError)):
        build(project, tmp_path)
    assert not (tmp_path / 'offline-v1').exists()
    assert not list(tmp_path.glob('.offline-v1.stage-*'))


def test_build_preserves_every_protected_byte_and_all_release_metadata(project, tmp_path):
    before = snapshot(project)
    result = build(project, tmp_path)
    root = tmp_path / 'offline-v1'
    assert snapshot(project) == before
    assert result['graph_transport'] == dict(dataset_records=12, external_entries_localized=4,
                                            local_dataset_entries_preserved=8)
    assert (root / 'provenance/publication.json').read_bytes() == before['site/publication.json'][0]
    assert not (root / 'publication.json').exists()
    assert (root / 'provenance/api-index.json').read_bytes() == before['site/data/api-index.json'][0]
    source_index = obj(project / 'site', 'data/api-index.json')
    index = obj(root, 'data/api-index.json')
    for key, entry in source_index['entries'].items():
        if 'external_url' not in entry:
            assert index['entries'][key] == entry
        else:
            expected = {k: v for k, v in entry.items() if k != 'external_url'}
            expected['path'] = entry['external_url'].split('/' + 'd' * 40 + '/')[1]
            assert index['entries'][key] == expected
    for path, (raw, _) in before.items():
        if path.startswith('datasets/'):
            assert (root / path).read_bytes() == raw
        if path.startswith('site/') and not path.endswith('.html') and path not in {
                'site/publication.json', 'site/data/api-index.json'}:
            assert (root / path[5:]).read_bytes() == raw
    old_index = (root / 'provenance/api-index.json').read_bytes()
    new_index = (root / 'data/api-index.json').read_bytes()
    # Reversing just the four changed member spans restores the complete index.
    for key, entry in source_index['entries'].items():
        if 'external_url' in entry:
            new_index = new_index.replace(('"path":' + json.dumps(index['entries'][key]['path'])).encode(),
                                          ('"external_url": ' + json.dumps(entry['external_url'])).encode())
    assert new_index == old_index
    receipt = obj(root, offline.RECEIPT)
    assert receipt['derivation']['source_validation']['fragment_dag_packs'] == 1
    assert receipt['derivation']['source_validation']['fragment_dag_roots_verified'] == 1
    assert sum(v['pins'] for v in receipt['derivation']['html'].values()) == 4
    assert all(v['pins'] == 1 for v in receipt['derivation']['html'].values())
    assert obj(root / 'provenance', 'publication.json')['historical_scope']['whole_origin_exclusion'] is True
    assert offline.verify(root, result['receipt_sha256']) == result


def test_standalone_command_without_original_workspace_and_verify_only_resume(project, tmp_path):
    result = build(project, tmp_path)
    root = tmp_path / 'offline-v1'
    before = snapshot(root)
    pin = offline.sha((project / 'site/publication.json').read_bytes())
    assert offline.build(project, root, pin, resume=True, receipt_sha256=result['receipt_sha256']) == result
    shutil.rmtree(project)
    command = [sys.executable, '-B', str(root / offline.VERIFIER), 'verify', '--bundle', str(root),
               '--receipt-sha256', result['receipt_sha256']]
    process = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True, timeout=30)
    assert process.returncode == 0, process.stderr
    assert json.loads(process.stdout) == result
    assert snapshot(root) == before


@pytest.mark.parametrize('path', ['data/saved.json.gz', 'runtime/public-runtime.js', 'index.html',
                                 'data/api-index.json', 'provenance/publication.json',
                                 'provenance/api-index.json', 'provenance/html/index.html',
                                 'provenance/checker/validate_publication.py', 'verify_offline_bundle.py',
                                 'datasets/manifest.json', 'datasets/README.md'])
@pytest.mark.parametrize('missing', [False, True])
def test_bundle_missing_or_tampered_member_never_reseals(project, tmp_path, path, missing):
    result = build(project, tmp_path)
    root = tmp_path / 'offline-v1'
    target = root / path
    target.unlink() if missing else target.write_bytes(target.read_bytes() + b'X')
    receipt_before = (root / offline.RECEIPT).read_bytes()
    with pytest.raises((ValueError, OSError)):
        offline.verify(root, result['receipt_sha256'])
    with pytest.raises((ValueError, OSError)):
        build(project, tmp_path, resume=True, receipt_sha256=result['receipt_sha256'])
    assert (root / offline.RECEIPT).read_bytes() == receipt_before


def test_graph_object_tamper_and_extra_members_fail(project, tmp_path):
    result = build(project, tmp_path)
    root = tmp_path / 'offline-v1'
    row = obj(root, 'datasets/manifest.json')['files'][0]
    put(root, row['path'], pack({'changed_graph_object': True}))
    with pytest.raises(ValueError):
        offline.verify(root, result['receipt_sha256'])
    put(root, row['path'], (project / row['path']).read_bytes())
    for path in ('extra.json', 'unknown/empty'):
        target = root / path
        if path.endswith('empty'):
            target.mkdir(parents=True)
        else:
            target.write_bytes(b'{}')
        with pytest.raises(ValueError, match='membership'):
            offline.verify(root, result['receipt_sha256'])
        target.rmdir() if target.is_dir() else target.unlink()


@pytest.mark.parametrize('mutation', ['missing', 'tamper', 'extra', 'wrong_url', 'wrong_commit',
                                    'wrong_wire', 'wrong_decoded', 'unknown_graph', 'unknown_external',
                                    'wrong_bootstrap', 'unknown_revision', 'wrong_hierarchy',
                                    'bad_projection', 'bad_manifest_pin'])
def test_source_fail_closed(project, tmp_path, mutation):
    site = project / 'site'
    index = obj(site, 'data/api-index.json')
    manifest = obj(project, 'datasets/manifest.json')
    row = next(v for v in manifest['files'] if v['logical_key'].endswith('_nodes.json'))
    entry = index['entries'][row['logical_key']]
    if mutation == 'missing':
        (project / row['path']).unlink()
    elif mutation == 'tamper':
        (project / row['path']).write_bytes(b'bad gzip')
    elif mutation == 'extra':
        put(site, 'unlisted.json', b'{}')
    elif mutation == 'wrong_url':
        entry['external_url'] += '?download=1'
    elif mutation == 'wrong_commit':
        entry['external_url'] = entry['external_url'].replace('d' * 40, 'e' * 40)
    elif mutation == 'wrong_wire':
        entry['wire_sha256'] = '0' * 64
    elif mutation == 'wrong_decoded':
        entry['sha256'] = '0' * 64
    elif mutation == 'unknown_graph':
        index['entries']['/graph-assets-v4/cib/not_declared.json'] = dict(entry)
    elif mutation == 'unknown_external':
        index['entries']['/api/not_declared'] = dict(entry)
    elif mutation == 'wrong_bootstrap':
        next(v for k, v in index['entries'].items() if k.endswith('_search.json'))['sha256'] = '0' * 64
    elif mutation in {'unknown_revision', 'wrong_hierarchy', 'bad_projection'}:
        key = '/api/graph-v4-viewer?corpus=cib'
        binding = index['entries'][key]
        if mutation == 'unknown_revision':
            index['entries'][key + '&revision=future'] = index['entries'].pop(key)
        else:
            path = binding['path']
            value = json.loads(gzip.decompress((site / path).read_bytes()))
            value['hierarchy_run_id' if mutation == 'wrong_hierarchy' else 'comparison_sha256'] = (
                'hierarchy_wrong' if mutation == 'wrong_hierarchy' else '0' * 64)
            raw = pack(value)
            put(site, path, raw)
            binding.update(wire_sha256=offline.sha(raw), sha256=offline.sha(gzip.decompress(raw)))
    elif mutation == 'bad_manifest_pin':
        publication = obj(site, 'publication.json')
        publication['graph_data_manifest']['sha256'] = '0' * 64
        put(site, 'publication.json', offline.encoded(publication))
    if mutation not in {'extra', 'bad_manifest_pin'}:
        put(site, 'data/api-index.json', offline.encoded(index))
        repin(project)
    assert_clean_failure(project, tmp_path)


@pytest.mark.parametrize('mutation', ['missing', 'wrong', 'duplicate', 'outside_script', 'second_runtime'])
def test_html_requires_exact_original_pins_and_count(project, tmp_path, mutation):
    path = project / 'site/index.html'
    raw = path.read_text()
    match = offline.PIN.search(raw)
    if mutation == 'missing':
        raw = raw.replace(match[0], '')
    elif mutation == 'wrong':
        raw = raw.replace(match[2], '0' * 64)
    elif mutation == 'duplicate':
        raw = raw.replace(match[0], match[0] + ' ' + match[0])
    elif mutation == 'outside_script':
        raw += '<p ' + match[0] + '>wrong</p>'
    else:
        raw += raw[raw.index('<script'):raw.index('</script>') + len('</script>')]
    path.write_text(raw)
    # Refresh only the publication file pin, not the intentionally invalid HTML attributes.
    publication = obj(project / 'site', 'publication.json')
    next(v for v in publication['files'] if v['path'] == 'index.html').update(offline.pin(path.read_bytes()))
    put(project / 'site', 'publication.json', offline.encoded(publication))
    assert_clean_failure(project, tmp_path)


def test_mandatory_pins_no_overwrite_and_no_partial_resume(project, tmp_path):
    source_pin = offline.sha((project / 'site/publication.json').read_bytes())
    for value in (None, '', '0' * 64, 'A' * 64):
        with pytest.raises(ValueError):
            offline.build(project, tmp_path / 'offline-v1', value)
    with pytest.raises(ValueError, match='existing completed'):
        build(project, tmp_path, resume=True, receipt_sha256='0' * 64)
    result = build(project, tmp_path)
    root = tmp_path / 'offline-v1'
    before = snapshot(root)
    for kwargs in ({}, {'resume': True}, {'resume': True, 'receipt_sha256': '0' * 64}):
        with pytest.raises(ValueError):
            build(project, tmp_path, **kwargs)
    with pytest.raises(ValueError):
        offline.build(project, root, '0' * 64, resume=True, receipt_sha256=result['receipt_sha256'])
    assert snapshot(root) == before
    with pytest.raises(ValueError):
        offline.verify(root, None)
    other = tmp_path / 'existing-empty'
    other.mkdir()
    with pytest.raises(ValueError, match='output exists'):
        offline.build(project, other, source_pin)
    assert other.is_dir() and list(other.iterdir()) == []


def test_overlap_symlinks_and_path_traversal(project, tmp_path):
    source_pin = offline.sha((project / 'site/publication.json').read_bytes())
    for output in (project, project / 'site/new', project.parent):
        with pytest.raises(ValueError, match='overlap'):
            offline.build(project, output, source_pin)
    alias = tmp_path / 'alias'
    alias.symlink_to(project, target_is_directory=True)
    with pytest.raises(ValueError, match='symlink'):
        offline.build(alias, tmp_path / 'offline-v1', source_pin)
    for target in (project / 'site/link.json', project / 'datasets/link.json', project / 'site/linked-dir'):
        target.symlink_to(project / 'site/data' if target.name == 'linked-dir' else project / 'site/data/source.txt')
        assert_clean_failure(project, tmp_path)
        target.unlink()
    publication = obj(project / 'site', 'publication.json')
    publication['files'][0]['path'] = '../escape.json'
    put(project / 'site', 'publication.json', offline.encoded(publication))
    assert_clean_failure(project, tmp_path)


@pytest.mark.parametrize('change', ['body', 'membership', 'dataset', 'tool'])
def test_source_change_during_build_removes_only_owned_stage(project, tmp_path, monkeypatch, change):
    sentinel = put(tmp_path, 'unrelated-stage-keep/sentinel', b'untouched')
    real_verify = offline.verify
    def racing_verify(*args, **kwargs):
        result = real_verify(*args, **kwargs)
        if change == 'membership':
            put(project, 'site/added.json', b'{}')
        elif change == 'dataset':
            row = obj(project, 'datasets/manifest.json')['files'][0]
            put(project, row['path'], b'changed')
        else:
            path = 'site/data/source.txt' if change == 'body' else 'tools/validate_publication.py'
            put(project, path, (project / path).read_bytes() + b'\n')
        return result
    monkeypatch.setattr(offline, 'verify', racing_verify)
    assert_clean_failure(project, tmp_path)
    assert (tmp_path / 'unrelated-stage-keep/sentinel').read_bytes() == sentinel


def test_scoped_locality_does_not_snapshot_or_change_native_siblings(project, tmp_path, monkeypatch):
    native = tmp_path / 'src-demo-day/native.json'
    native.parent.mkdir()
    native.write_bytes(b'{"untouched_native": true}\n')
    put(project, '.git/HEAD', b'ref: refs/heads/independent-public\n')
    real_verify = offline.verify
    def unrelated_edit(*args, **kwargs):
        value = real_verify(*args, **kwargs)
        put(project, 'unrelated-research-note.txt', b'not an input')
        return value
    monkeypatch.setattr(offline, 'verify', unrelated_edit)
    result = build(project, tmp_path)
    assert native.read_bytes() == b'{"untouched_native": true}\n'
    assert not (tmp_path / 'offline-v1/.git').exists()
    assert not (tmp_path / 'offline-v1/unrelated-research-note.txt').exists()
    assert real_verify(tmp_path / 'offline-v1', result['receipt_sha256'])['status'] == 'PASS'


def test_cooperating_lock_and_exclusive_atomic_install(project, tmp_path):
    lock_path = tmp_path / '.offline-v1.offline.lock'
    with lock_path.open('wb') as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(ValueError, match='locked'):
            build(project, tmp_path)
    stage, output = tmp_path / 'stage', tmp_path / 'existing'
    stage.mkdir()
    output.mkdir()
    put(stage, 'member', b'owned')
    with pytest.raises(OSError):
        offline.install(stage, output)
    assert (stage / 'member').read_bytes() == b'owned'
    assert output.is_dir() and not list(output.iterdir())


def test_pinned_resealed_receipt_still_checks_original_protection(project, tmp_path):
    build(project, tmp_path)
    root = tmp_path / 'offline-v1'
    path = 'runtime/public-runtime.js'
    put(root, path, b'changed runtime')
    receipt = obj(root, offline.RECEIPT)
    next(row for row in receipt['files'] if row['path'] == path).update(offline.pin((root / path).read_bytes()))
    raw = put(root, offline.RECEIPT, offline.encoded(receipt))
    with pytest.raises(ValueError, match='hash mismatch'):
        offline.verify(root, offline.sha(raw))


def test_cli_requires_explicit_source_pin_and_receipt_pin():
    with pytest.raises(SystemExit) as error:
        offline.main(['build', '--source', '.', '--output', '/tmp/not-built'])
    assert error.value.code == 2
    with pytest.raises(SystemExit) as error:
        offline.main(['verify', '--bundle', '.'])
    assert error.value.code == 2


def test_fresh_repeated_build_is_deterministic_and_source_pin_is_not_a_fixed_version(project, tmp_path):
    first = build(project, tmp_path)
    source_pin = offline.sha((project / 'site/publication.json').read_bytes())
    second = offline.build(project, tmp_path / 'offline-v2', source_pin)
    assert first == second
    # A future declared current asset row is handled generically without a name allowlist.
    manifest = obj(project, 'datasets/manifest.json')
    index = obj(project / 'site', 'data/api-index.json')
    row = dict(next(v for v in manifest['files'] if v['logical_key'].endswith('current_nodes.json')))
    row['logical_key'] = '/graph-assets-v4/cib/future_asset_kind_77.json.gz'
    manifest['files'].append(row)
    index['entries'][row['logical_key']] = dict(index['entries']['/graph-assets-v4/cib/cib_current_nodes.json'])
    put(project, 'datasets/manifest.json', offline.encoded(manifest))
    put(project / 'site', 'data/api-index.json', offline.encoded(index))
    publication = obj(project / 'site', 'publication.json')
    publication['version'], publication['run_id'] = 'public-presentation/6.8', 'synthetic_68'
    put(project / 'site', 'publication.json', offline.encoded(publication))
    source_pin = repin(project)
    future = offline.build(project, tmp_path / 'offline-v3', source_pin)
    assert future['graph_transport']['dataset_records'] == 13
    assert future['graph_transport']['external_entries_localized'] == 5


@pytest.mark.parametrize('mutation', ['html', 'index', 'dataset', 'original_index', 'original_html'])
def test_independent_verifier_rederives_even_if_inventory_is_repinned(project, tmp_path, mutation):
    build(project, tmp_path)
    root = tmp_path / 'offline-v1'
    paths = dict(html='index.html', index='data/api-index.json', dataset='datasets/manifest.json',
                 original_index='provenance/api-index.json', original_html='provenance/html/index.html')
    path = paths[mutation]
    raw = (root / path).read_bytes()
    if mutation in {'html', 'original_html'}:
        raw = raw.replace(b'Saved static fixture', b'Unapproved changed body')
    elif mutation in {'index', 'original_index'}:
        index = json.loads(raw)
        saved = '/api/condition-v6?case_id=saved-1&config=llm_readings'
        index['entries'][saved]['sha256'] = '0' * 64
        raw = offline.encoded(index)
    else:
        manifest = json.loads(raw)
        manifest['graph_releases']['iran_legacy']['hierarchy_id'] = 'new_unapproved_hierarchy'
        raw = offline.encoded(manifest)
    put(root, path, raw)
    receipt = obj(root, offline.RECEIPT)
    next(row for row in receipt['files'] if row['path'] == path).update(offline.pin(raw))
    receipt_raw = put(root, offline.RECEIPT, offline.encoded(receipt))
    with pytest.raises(ValueError):
        offline.verify(root, offline.sha(receipt_raw))


def test_failure_during_copy_and_noncooperating_output_creation_are_safe(project, tmp_path, monkeypatch):
    original_read = offline.read
    def change_during_copy(path):
        raw = original_read(path)
        if path == project / 'site/data/source.txt':
            path.write_bytes(raw + b' concurrent edit')
        return raw
    with monkeypatch.context() as patch:
        patch.setattr(offline, 'read', change_during_copy)
        assert_clean_failure(project, tmp_path)
    repin(project)
    original_install = offline.install
    def interloper(stage, output):
        output.mkdir()
        put(output, 'preserved.txt', b'other writer')
        original_install(stage, output)
    monkeypatch.setattr(offline, 'install', interloper)
    with pytest.raises(OSError):
        build(project, tmp_path)
    assert (tmp_path / 'offline-v1/preserved.txt').read_bytes() == b'other writer'
    assert not list(tmp_path.glob('.offline-v1.stage-*'))


def test_output_parent_lock_and_bundle_symlinks_are_rejected(project, tmp_path):
    alias = tmp_path / 'parent-alias'
    alias.symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError, match='symlink'):
        offline.build(project, alias / 'offline-v1', offline.sha((project / 'site/publication.json').read_bytes()))
    lock = tmp_path / '.offline-v1.offline.lock'
    lock.symlink_to(project / 'site/data/source.txt')
    assert_clean_failure(project, tmp_path)
    lock.unlink()
    result = build(project, tmp_path)
    root = tmp_path / 'offline-v1'
    (root / 'data/saved.json.gz').unlink()
    (root / 'data/saved.json.gz').symlink_to(project / 'site/data/saved.json.gz')
    with pytest.raises(ValueError, match='symlink'):
        offline.verify(root, result['receipt_sha256'])


def test_input_checker_cannot_execute_unpinned_code(project, tmp_path):
    marker = tmp_path / 'must-not-be-written'
    code = ('\nfrom pathlib import Path\nPath(' + repr(str(marker)) + ').write_text("executed")\n').encode()
    path = project / 'tools/validate_publication.py'
    path.write_bytes(path.read_bytes() + code)
    assert_clean_failure(project, tmp_path)
    assert not marker.exists()


def test_source_changes_to_early_file_during_final_hash_pass_fail(project, tmp_path, monkeypatch):
    real_verify, real_read = offline.verify, offline.read
    state = {'final_scan': False, 'changed': False}
    def verified(*args, **kwargs):
        result = real_verify(*args, **kwargs)
        state['final_scan'] = True
        return result
    def racing_read(path):
        raw = real_read(path)
        if state['final_scan'] and not state['changed'] and path == project / 'datasets/manifest.json':
            target = project / 'site/data/source.txt'
            target.write_bytes(target.read_bytes() + b'late edit after its hash check')
            state['changed'] = True
        return raw
    monkeypatch.setattr(offline, 'verify', verified)
    monkeypatch.setattr(offline, 'read', racing_read)
    assert_clean_failure(project, tmp_path)
    assert state['changed']


def test_independent_verifier_fails_on_concurrent_bundle_change(project, tmp_path, monkeypatch):
    result = build(project, tmp_path)
    root = tmp_path / 'offline-v1'
    original = offline.derivation
    def changed(*args, **kwargs):
        value = original(*args, **kwargs)
        path = root / 'data/saved.json.gz'
        path.write_bytes(path.read_bytes() + b'concurrent change')
        return value
    monkeypatch.setattr(offline, 'derivation', changed)
    with pytest.raises(ValueError, match='changed during verification'):
        offline.verify(root, result['receipt_sha256'])

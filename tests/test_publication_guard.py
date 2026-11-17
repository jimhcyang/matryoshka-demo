"""Static export adversarial controls. Credential fixtures are fake only."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


SPEC = importlib.util.spec_from_file_location('publication_guard', Path(__file__).parents[1] / 'tools/validate_publication.py')
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def wire(value):
    return (json.dumps(value, sort_keys=True) + '\n').encode()


@pytest.fixture
def site(tmp_path):
    root = tmp_path / 'site'
    root.mkdir()
    files = {
        'index.html': b'<!doctype html><base href="/matryoshka-demo/"><a href="workbench.html?case=case-1">Open</a>',
        'workbench.html': b'<!doctype html><link rel="icon" href="data:,"><p>Historical SECRET is not a current classification.</p>',
        'LICENSE.txt': b'Fake test fixture license approval, not a real rights assertion.\n',
        '.nojekyll': b'',
        'data/case-1.json.gz': gzip.compress(wire(dict(case_id='case-1', config='llm_readings',
            source=dict(document_id='historical-1', text='SECRET historical cable: password=OLD CODE; /home/ is quoted source text.'))), mtime=0),
    }
    payload = files['data/case-1.json.gz']
    route = dict(path='data/case-1.json.gz', wire_sha256=sha(payload),
                 sha256=sha(gzip.decompress(payload)), encoding='gzip', mime='application/json')
    files['api/index.json'] = wire(dict(version=guard.API_INDEX_VERSION,
        entries={'/api/condition-v6?case_id=case-1&config=llm_readings': route}))
    for name, raw in files.items():
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(raw)
    pub = dict(version='publication/1', run_id='public-1', ref=dict(run_id='frozen-1', sha256='a' * 64),
        base_path='/matryoshka-demo/', api_index='api/index.json', case_ids=['case-1'],
        cases=[dict(case_id='case-1', group='presentation', canonical_fact_family='source-fact-1', polarity='positive')],
        publicness=dict(approved=True, historical_public_sources=True, heldout_answers_intentionally_public=True,
                        previously_public_historical_sources_only=True,
                        no_private_workspace_material=True, not_a_declassification_claim=True),
        licensing=dict(status='approved', code='Test code approval', data='Per-source test declarations', notices=['LICENSE.txt']),
        sources=[dict(id='cib', publicly_released=True, provenance_url='https://archive.example.org/document/1',
                      rights_status='approved', rights_basis='Fake fixture authorization',
                      rights_reference='https://archive.example.org/rights')], files=[])
    (root / 'publication.json').write_bytes(wire(pub))
    reseal(root)
    return root


def read(root, name='publication.json'):
    return json.loads((root / name).read_text())


def write(root, value, name='publication.json'):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(wire(value))


def reseal(root, *, routes=True):
    pub = read(root)
    if routes:
        index = read(root, 'api/index.json')
        for row in index['entries'].values():
            if 'external_url' in row:
                continue
            p = root / row['path']
            if p.is_file() and not p.is_symlink():
                if row.get('encoding') == 'fragment-dag':
                    manifest = json.loads(p.read_bytes())
                    row['manifest_sha256'] = sha(p.read_bytes())
                    if row.get('asset') in manifest['assets']:
                        row['sha256'] = manifest['assets'][row['asset']]['sha256decoded']
                    continue
                row['sha256'] = sha(p.read_bytes())
                if p.name.endswith('.gz'):
                    row['wire_sha256'] = sha(p.read_bytes())
                    row['sha256'] = sha(gzip.decompress(p.read_bytes()))
        write(root, index, 'api/index.json')
    pub['files'] = []
    for path in sorted(root.rglob('*')):
        if path.is_file() and not path.is_symlink() and path.name != 'publication.json':
            raw = path.read_bytes()
            row = dict(path=path.relative_to(root).as_posix(), bytes=len(raw), sha256=sha(raw))
            if path.name.endswith('.gz'):
                row['decoded_sha256'] = sha(gzip.decompress(raw))
            pub['files'].append(row)
    write(root, pub)


def edit_payload(root, transform):
    path = root / 'data/case-1.json.gz'
    value = json.loads(gzip.decompress(path.read_bytes()))
    transform(value)
    path.write_bytes(gzip.compress(wire(value), mtime=0))
    reseal(root)


def test_valid_public_snapshot_preserves_historical_source_body(site):
    before = {p.relative_to(site): p.read_bytes() for p in site.rglob('*') if p.is_file()}
    result = guard.validate_publication(site, known_case_ids={'case-1'})
    assert result['status'] == 'PASS' and result['api_routes'] == result['cases'] == 1
    assert before == {p.relative_to(site): p.read_bytes() for p in site.rglob('*') if p.is_file()}


@pytest.mark.parametrize('name', ['.git/config', '.env', 'private/keys.json', 'credentials.json',
    'receipts/model.json', 'manuscripts/draft.pdf', 'human_review.json', 'review_queue.csv',
    'paper.pdf', 'runtime.py', 'source.sqlite3', 'archive.zip'])
def test_forbidden_paths_and_nonstatic_files_fail_before_contents(site, name):
    path = site / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'DO NOT READ: fake forbidden fixture')
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


def test_symlink_file_and_directory_rejected(site, tmp_path):
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'data.json').write_text('{}')
    for directory in (False, True):
        link = site / ('linked' if directory else 'linked.json')
        link.symlink_to(outside if directory else outside / 'data.json', target_is_directory=directory)
        with pytest.raises(guard.PublicationError, match='symlink'):
            guard.validate_publication(site)
        link.unlink()


def test_symlink_site_root_rejected(site, tmp_path):
    link = tmp_path / 'alias'
    link.symlink_to(site, target_is_directory=True)
    with pytest.raises(guard.PublicationError, match='symlink'):
        guard.validate_publication(link)


def test_exact_size_boundaries_are_exclusive(site):
    sizes = [p.stat().st_size for p in site.rglob('*') if p.is_file()]
    with pytest.raises(guard.PublicationError, match='total publication'):
        guard.validate_publication(site, max_total_bytes=sum(sizes))
    with pytest.raises(guard.PublicationError, match='individual stored'):
        guard.validate_publication(site, max_file_bytes=max(sizes))
    assert guard.validate_publication(site, max_total_bytes=sum(sizes)+1, max_file_bytes=max(sizes)+1)['status'] == 'PASS'
    assert guard.MAX_TOTAL_BYTES == 900_000_000 and guard.MAX_FILE_BYTES == 95_000_000


@pytest.mark.parametrize('field', ['version', 'run_id', 'ref', 'sources', 'licensing', 'publicness', 'files'])
def test_required_publication_metadata(site, field):
    pub = read(site)
    pub.pop(field)
    write(site, pub)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


@pytest.mark.parametrize('key,value', [('rights_status', 'pending'), ('rights_basis', 'TODO'), ('publicly_released', False)])
def test_no_licensing_or_publicness_assumptions(site, key, value):
    pub = read(site)
    pub['sources'][0][key] = value
    write(site, pub)
    with pytest.raises(guard.PublicationError, match='source release/rights'):
        guard.validate_publication(site)


def test_unknown_case_in_index_or_payload_fails(site):
    edit_payload(site, lambda p: p.update(case_id='omitted-case'))
    with pytest.raises(guard.PublicationError, match='unknown or omitted case'):
        guard.validate_publication(site)


def test_independently_known_cohort_must_match(site):
    with pytest.raises(guard.PublicationError, match='known selected'):
        guard.validate_publication(site, known_case_ids={'different-case'})


@pytest.mark.parametrize('polarity,reason', [('negative', 'polarity-mirror'), ('positive', 'duplicate canonical')])
def test_dedup_fact_family_across_public_groups(site, polarity, reason):
    pub = read(site)
    pub['case_ids'].append('case-2')
    pub['cases'].append(dict(case_id='case-2', group='bench', canonical_fact_family='source-fact-1', polarity=polarity))
    write(site, pub)
    with pytest.raises(guard.PublicationError, match=reason):
        guard.validate_publication(site)


@pytest.mark.parametrize('path', ['../outside.json', '/outside.json', 'data//x.json',
    'data/./x.json', 'data/%2e%2e/x.json', 'data\\x.json', 'https://archive.example.org/x.json'])
def test_api_target_path_must_be_canonical(site, path):
    index = read(site, 'api/index.json')
    next(iter(index['entries'].values()))['path'] = path
    write(site, index, 'api/index.json')
    reseal(site, routes=False)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


def test_canonical_query_order_detects_identical_and_conflicting_duplicates(site):
    index = read(site, 'api/index.json')
    row = dict(next(iter(index['entries'].values())))
    index['entries']['api/condition-v6?config=llm_readings&case_id=case-1'] = row
    write(site, index, 'api/index.json')
    reseal(site)
    with pytest.raises(guard.PublicationError, match='duplicate/conflicting'):
        guard.validate_publication(site)


def test_query_parameter_pollution_rejected(site):
    index = read(site, 'api/index.json')
    key, value = next(iter(index['entries'].items()))
    index['entries'] = {key + '&case_id=case-1': value}
    write(site, index, 'api/index.json')
    reseal(site)
    with pytest.raises(guard.PublicationError, match='duplicate API query'):
        guard.validate_publication(site)


@pytest.mark.parametrize('where', ['wire', 'decoded', 'index-wire', 'index-decoded'])
def test_wire_and_decoded_gzip_integrity(site, where):
    pub = read(site)
    if where.startswith('index-'):
        index = read(site, 'api/index.json')
        next(iter(index['entries'].values()))['wire_sha256' if where == 'index-wire' else 'sha256'] = '0' * 64
        write(site, index, 'api/index.json')
        reseal(site, routes=False)
    else:
        row = next(x for x in pub['files'] if x['path'].endswith('.gz'))
        row['sha256' if where == 'wire' else 'decoded_sha256'] = '0' * 64
        write(site, pub)
    with pytest.raises(guard.PublicationError, match='SHA256'):
        guard.validate_publication(site)


def test_gzip_expansion_limit_is_bounded(site):
    with pytest.raises(guard.PublicationError, match='decoded'):
        guard.validate_publication(site, max_decoded_bytes=32)


@pytest.mark.parametrize('value', ['http://localhost:8930/x', 'http://127.0.0.1/x',
    'https://user:FAKE-password@archive.example.org/x', 'file:///Users/fake/private/file',
    '/Users/fake/private/file', 'C:\\Users\\fake\\file', 'private/source_proofs.json',
    'OPENAI_API_KEY=FAKE-ASSIGNMENT-NOT-A-REAL-SECRET'])
def test_metadata_private_paths_urls_and_credential_syntax(site, value):
    edit_payload(site, lambda p: p.update(metadata=value))
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


def test_fake_modern_credential_is_rejected_without_echo(site, capsys):
    fake = 'sk-proj-FAKE_ONLY_NOT_A_REAL_CREDENTIAL_12345'
    edit_payload(site, lambda p: p.update(metadata=fake))
    assert guard.main(['--site', str(site)]) == 1
    assert fake not in capsys.readouterr().err


def test_credential_metadata_fields_do_not_hide_in_source_record(site):
    edit_payload(site, lambda p: p['source'].update(api_key='FAKE ONLY'))
    with pytest.raises(guard.PublicationError, match='credential metadata'):
        guard.validate_publication(site)


@pytest.mark.parametrize('html', [
    '<base href="/wrong/">', '<a href="/workbench.html">Wrong project root</a>',
    '<script src="https://archive.example.org/track.js"></script>',
    '<a href="http://localhost:8930/">Local</a>', '<a href="javascript:alert(1)">Bad</a>',
    '<img src="data:text/html,FAKE">', '<button onclick="alert(1)">Inline</button>',
    '<a href="../outside.html">Escape</a>'])
def test_html_base_urls_and_active_assets(site, html):
    (site / 'index.html').write_text(html)
    reseal(site)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


def test_duplicate_json_keys_and_unlisted_files_are_rejected(site):
    path = site / 'api/index.json'
    path.write_bytes(b'{"version":"1","version":"2","routes":[]}')
    reseal(site, routes=False)
    with pytest.raises(guard.PublicationError, match='duplicate JSON'):
        guard.validate_publication(site)


def test_unlisted_static_data_is_not_implicitly_public(site):
    (site / 'unlisted.json').write_text('{}')
    with pytest.raises(guard.PublicationError, match='whitelist differs'):
        guard.validate_publication(site)


def test_cli_success_and_missing_site_are_readonly(site, tmp_path, capsys):
    assert guard.main(['--site', str(site), '--case-id', 'case-1']) == 0
    assert json.loads(capsys.readouterr().out)['network_calls'] == 0
    missing = tmp_path / 'missing'
    assert guard.main(['--site', str(missing)]) == 1
    assert not missing.exists()


@pytest.mark.parametrize('url', ['http://[::1]/x', 'http://[fd00::1]/x', 'http://[fe80::1]/x',
    'http://192.168.0.1/x', 'http://10.0.0.1/x', 'http://127.1/x',
    'https://archive.example.org:invalid/x', 'https://archive.example.org:0/x'])
def test_nonpublic_network_urls_rejected(site, url):
    pub = read(site)
    pub['sources'][0]['provenance_url'] = url
    write(site, pub)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


def test_secret_source_filename_and_labels_are_not_credential_rules(site):
    path = site / 'data/historical_SECRET_cable.json'
    path.write_bytes(wire(dict(document_id='historic', classification='SECRET',
        secret_derived=True, body='SECRET / NOFORN historical labels are preserved.')))
    reseal(site)
    assert guard.validate_publication(site)['status'] == 'PASS'


@pytest.mark.parametrize('value', ['%2FUsers%2Ffake%2Fprivate%2Fdata',
    'http%3A%2F%2Flocalhost%3A8930%2F', 'private%2Fsource_proofs.json'])
def test_encoded_private_metadata_cannot_bypass_scanner(site, value):
    edit_payload(site, lambda p: p.update(metadata=value))
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


def test_condition_route_cannot_serve_another_known_case(site):
    pub = read(site)
    pub['case_ids'].append('case-2')
    pub['cases'].append(dict(case_id='case-2', group='bench', canonical_fact_family='different-fact', polarity='positive'))
    write(site, pub)
    edit_payload(site, lambda p: p.update(case_id='case-2'))
    with pytest.raises(guard.PublicationError, match='another case'):
        guard.validate_publication(site)


def test_condition_route_cannot_serve_another_arm(site):
    edit_payload(site, lambda p: p.update(config='llm_atoms'))
    with pytest.raises(guard.PublicationError, match='another condition'):
        guard.validate_publication(site)


def test_route_aliases_cannot_evade_duplicate_detection(site):
    index = read(site, 'api/index.json')
    index['entries']['/api/condition-v6?case=case-1&arm=A'] = dict(next(iter(index['entries'].values())))
    write(site, index, 'api/index.json')
    reseal(site)
    with pytest.raises(guard.PublicationError, match='duplicate/conflicting'):
        guard.validate_publication(site)


@pytest.mark.parametrize('html', ['<meta http-equiv="refresh" content="0;url=https://archive.example.org/">',
    '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    '<a href="workbench.html" href="https://archive.example.org/">Ambiguous</a>'])
def test_ambiguous_or_active_inline_html_is_rejected(site, html):
    (site / 'index.html').write_text(html)
    reseal(site)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


def test_source_only_unknown_case_ids_are_not_automatically_published(site):
    edit_payload(site, lambda p: p.update(case_ids=['case-1', 'removed-mirror']))
    with pytest.raises(guard.PublicationError, match='unknown or omitted case'):
        guard.validate_publication(site)


def test_sagan_identity_index_uses_decoded_sha_and_optional_wire_sha(site):
    payload = gzip.decompress((site / 'data/case-1.json.gz').read_bytes())
    (site / 'data/case-1.json').write_bytes(payload)
    index = read(site, 'api/index.json')
    entry = next(iter(index['entries'].values()))
    entry.update(path='data/case-1.json', encoding='identity', sha256=sha(payload))
    entry.pop('wire_sha256')
    write(site, index, 'api/index.json')
    reseal(site, routes=False)
    assert guard.validate_publication(site)['api_routes'] == 1


@pytest.mark.parametrize('field,value', [('version', 'static-api/old'), ('encoding', 'identity'),
    ('encoding', 'brotli'), ('mime', 'text/html'), ('mime', None)])
def test_sagan_index_version_encoding_and_mime_are_not_inferred(site, field, value):
    index = read(site, 'api/index.json')
    if field == 'version':
        index[field] = value
    else:
        next(iter(index['entries'].values()))[field] = value
    write(site, index, 'api/index.json')
    reseal(site, routes=False)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


def test_sagan_pdf_route_is_identity_hashed_and_has_pdf_mime(site):
    raw = b'%PDF-1.4\n% fake public-source fixture, not a real document\n'
    (site / 'source.pdf').write_bytes(raw)
    index = read(site, 'api/index.json')
    index['entries']['/api/cib-pdf?doc_id=historical-1&release=earlier'] = dict(
        path='source.pdf', sha256=sha(raw), encoding='identity', mime='application/pdf')
    write(site, index, 'api/index.json')
    reseal(site)
    assert guard.validate_publication(site)['api_routes'] == 2


def test_default_project_base_is_new_clean_repository(site):
    assert guard.EXPECTED_BASE_PATH == '/matryoshka-demo/'
    pub = read(site)
    pub['base_path'] = '/redaction_extract/'
    write(site, pub)
    with pytest.raises(guard.PublicationError, match='approved project path'):
        guard.validate_publication(site)


def test_old_array_index_contract_is_rejected(site):
    write(site, dict(version=guard.API_INDEX_VERSION, routes=[]), 'api/index.json')
    reseal(site, routes=False)
    with pytest.raises(guard.PublicationError, match='entries index'):
        guard.validate_publication(site)


def test_duplicate_entries_raw_json_keys_cannot_disappear_during_parse(site):
    (site / 'api/index.json').write_bytes(b'{"version":"matryoshka-public-api-index/1",'
        b'"entries":{"/api/x":{},"/api/x":{}}}')
    reseal(site, routes=False)
    with pytest.raises(guard.PublicationError, match='duplicate JSON'):
        guard.validate_publication(site)


def test_nojekyll_cannot_be_used_as_an_unscanned_payload(site):
    (site / '.nojekyll').write_bytes(b'FAKE hidden payload')
    with pytest.raises(guard.PublicationError, match='must be empty'):
        guard.validate_publication(site)


def test_rendered_metadata_paths_rejected_but_declared_source_text_preserved(site):
    html = '<p>Historical SECRET code password=OLD; /home/ is a literal historical quotation.</p>'
    (site / 'workbench.html').write_text(html)
    reseal(site)
    with pytest.raises(guard.PublicationError, match='filesystem'):
        guard.validate_publication(site)
    pub = read(site)
    row = next(r for r in pub['files'] if r['path'] == 'workbench.html')
    row.update(role='source_body', source_ids=['cib'])
    write(site, pub)
    before = (site / 'workbench.html').read_bytes()
    assert guard.validate_publication(site)['status'] == 'PASS'
    assert (site / 'workbench.html').read_bytes() == before


def test_project_root_and_nested_html_with_explicit_base_work(site):
    (site / 'nested').mkdir()
    (site / 'nested/page.html').write_text('<base href="/matryoshka-demo/">'
        '<a href="/matryoshka-demo/">Home</a><a href="workbench.html?case=case-1">Question</a>')
    reseal(site)
    assert guard.validate_publication(site)['status'] == 'PASS'


@pytest.mark.parametrize('param', ['case', 'case_id', 'guide_case'])
def test_html_cannot_keep_direct_links_to_removed_mirrors(site, param):
    (site / 'index.html').write_text('<a href="workbench.html?'+param+'=removed-case">Hidden duplicate</a>')
    reseal(site)
    with pytest.raises(guard.PublicationError, match='omitted case'):
        guard.validate_publication(site)


@pytest.fixture
def packed(site):
    pack = guard.pack_module()
    # The apparent reference array is historical JSON data, not a DAG tag.
    first = (b'{"document_id":"historic-1","text":"SECRET password=OLD; /home/ is source text.",'
             b'"number":1e-09,"literal":["$ref",1]}')
    second = b'{"document_id":"historic-2","text":"NOFORN is a historical label."}'
    raw = pack.encoded(dict(version=pack.CHUNK_VERSION, first_id=1,
                            fragments=[[first.decode('ascii')], [second.decode('ascii')]]))
    wire_bytes = gzip.compress(raw, mtime=0)
    folder = site / 'data/packed'
    chunk_path = 'chunks/' + sha(wire_bytes) + '.json.gz'
    (folder / 'chunks').mkdir(parents=True)
    (folder / chunk_path).write_bytes(wire_bytes)
    chunk = dict(id=0, path=chunk_path, encoding='gzip', wire_sha256=sha(wire_bytes),
                 sha256decoded=sha(raw), decoded_bytes=len(raw), wire_bytes=len(wire_bytes), first_id=1, last_id=2)
    roots = {}
    for fid, (name, value) in enumerate((('comparison', first), ('search', second)), 1):
        roots[name] = dict(encoding='fragment-dag', pieces=['', fid, ''], dependencies=[0],
            sha256decoded=sha(value), decoded_bytes=len(value), originalsha256='a'*64,
            original_decoded_sha256='b'*64)
    manifest = pack.sealed(dict(version=pack.VERSION, status='COMPLETE', encoding='fragment-dag',
        chunks=[chunk], assets=roots, original_assets_modified=False, all_roots_transport_verified=True))
    (folder / 'manifest.json').write_bytes(pack.encoded(manifest))
    index = read(site, 'api/index.json')
    entry = dict(path='data/packed/manifest.json', asset='comparison', manifest_sha256=sha(pack.encoded(manifest)),
                 sha256=sha(first), encoding='fragment-dag', mime='application/json')
    index['entries']['/api/source-v6?case_id=case-1&source_id=packed-comparison'] = entry
    index['entries']['/api/source-v6?case_id=case-1&source_id=packed-alias'] = dict(entry, wire_sha256=None)
    write(site, index, 'api/index.json')
    reseal(site)
    return site


def update_pack(site, transform):
    pack = guard.pack_module()
    manifest = read(site, 'data/packed/manifest.json')
    transform(manifest)
    manifest.pop('sha256', None)
    (site / 'data/packed/manifest.json').write_bytes(pack.encoded(pack.sealed(manifest)))
    reseal(site)


def test_fragment_dag_all_roots_once_shared_routes_and_no_source_rewrite(packed, monkeypatch):
    pack = guard.pack_module()
    before = {p.relative_to(packed): p.read_bytes() for p in packed.rglob('*') if p.is_file()}
    seen, decompressions = [], []
    original, original_chunk = pack.Reader.iter_asset, pack.Reader.chunk
    def record(self, name):
        seen.append(name)
        yield from original(self, name)
    def chunks(self, number):
        if number not in self.cache:
            decompressions.append(number)
        return original_chunk(self, number)
    monkeypatch.setattr(pack.Reader, 'iter_asset', record)
    monkeypatch.setattr(pack.Reader, 'chunk', chunks)
    result = guard.validate_publication(packed)
    assert result['fragment_dag_roots_verified'] == 2
    assert result['fragment_dag_packs'] == 1 and result['api_routes'] == 3
    assert seen == ['comparison', 'search'] and decompressions == [0]
    assert before == {p.relative_to(packed): p.read_bytes() for p in packed.rglob('*') if p.is_file()}


@pytest.mark.parametrize('field,value', [('manifest_sha256', '0'*64), ('sha256', '0'*64),
    ('wire_sha256', '0'*64), ('asset', 'absent-root'), ('mime', 'text/html')])
def test_fragment_api_pins_and_selector_are_not_inferred(packed, field, value):
    index = read(packed, 'api/index.json')
    index['entries']['/api/source-v6?case_id=case-1&source_id=packed-comparison'][field] = value
    write(packed, index, 'api/index.json')
    reseal(packed, routes=False)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(packed)


def test_fragment_manifest_seal_is_verified(packed):
    manifest = read(packed, 'data/packed/manifest.json')
    manifest['changed_without_seal'] = True
    write(packed, manifest, 'data/packed/manifest.json')
    reseal(packed)
    with pytest.raises(guard.PublicationError, match='DAG manifest'):
        guard.validate_publication(packed)


@pytest.mark.parametrize('edit', ['missing-dependency', 'wrong-root-hash', 'root-size', 'unsafe-chunk', 'missing-chunk'])
def test_fragment_dependencies_root_hash_and_size_limits(packed, edit):
    def change(manifest):
        root = manifest['assets']['comparison']
        if edit == 'missing-dependency': root['dependencies'] = []
        elif edit == 'wrong-root-hash': root['sha256decoded'] = '0'*64
        elif edit == 'root-size': root['decoded_bytes'] = guard.MAX_DECODED_BYTES
        elif edit == 'unsafe-chunk': manifest['chunks'][0]['path'] = '../outside.json.gz'
        else: manifest['chunks'][0]['path'] = 'chunks/' + '0'*64 + '.json.gz'
    update_pack(packed, change)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(packed)


def test_fragment_wire_tamper_is_rejected(packed):
    chunk = read(packed, 'data/packed/manifest.json')['chunks'][0]
    path = packed / 'data/packed' / chunk['path']
    raw = bytearray(path.read_bytes())
    raw[-1] ^= 1
    path.write_bytes(raw)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(packed)


def test_fragment_non_backward_reference_rejected_with_valid_outer_hashes(packed):
    pack = guard.pack_module()
    def change(manifest):
        old = manifest['chunks'][0]
        data = json.loads(gzip.decompress((packed / 'data/packed' / old['path']).read_bytes()))
        data['fragments'][0] = ['', 1, '']
        raw = pack.encoded(data)
        compressed = gzip.compress(raw, mtime=0)
        new_path = 'chunks/' + sha(compressed) + '.json.gz'
        (packed / 'data/packed' / old['path']).unlink()
        (packed / 'data/packed' / new_path).write_bytes(compressed)
        old.update(path=new_path, wire_sha256=sha(compressed), sha256decoded=sha(raw),
                   wire_bytes=len(compressed), decoded_bytes=len(raw))
    update_pack(packed, change)
    with pytest.raises(guard.PublicationError, match='backward-reference'):
        guard.validate_publication(packed)


def test_unindexed_fragment_root_still_gets_semantic_privacy_scan(packed):
    # Root "search" is absent from the API index but is still public in the pack.
    def change(manifest):
        raw = b'{"metadata":"/Users/fake/private-file","case_id":"case-1"}'
        root = manifest['assets']['search']
        root.update(pieces=[raw.decode()], dependencies=[], decoded_bytes=len(raw), sha256decoded=sha(raw))
    update_pack(packed, change)
    with pytest.raises(guard.PublicationError, match='filesystem'):
        guard.validate_publication(packed)


def test_graph_viewer_cannot_promise_full_bulk_pdfs(site):
    path = site / 'data/viewer.json'
    path.write_bytes(wire(dict(pdf_available=True)))
    index = read(site, 'api/index.json')
    index['entries']['/api/graph-v4-viewer?corpus=cib'] = dict(path='data/viewer.json',
        sha256=sha(path.read_bytes()), encoding='identity', mime='application/json')
    write(site, index, 'api/index.json')
    reseal(site)
    with pytest.raises(guard.PublicationError, match='bulk-PDF'):
        guard.validate_publication(site)
    path.write_bytes(wire(dict(pdf_available=False)))
    reseal(site)
    assert guard.validate_publication(site)['status'] == 'PASS'


def test_saved_static_node_drawer_must_disclose_limited_scope(site):
    path = site / 'data/node.json'
    path.write_bytes(wire(dict(edges=[], scope='FULL_GRAPH_NEIGHBORHOOD', note='Wrong claim')))
    index = read(site, 'api/index.json')
    index['entries']['/api/node-v6?case_id=case-1&node_id=entity-1'] = dict(path='data/node.json',
        sha256=sha(path.read_bytes()), encoding='identity', mime='application/json')
    write(site, index, 'api/index.json')
    reseal(site)
    with pytest.raises(guard.PublicationError, match='scope disclosure'):
        guard.validate_publication(site)
    path.write_bytes(wire(dict(edges=[], scope='SAVED_DISPLAY_PROJECTION_ONLY',
        note='Only saved display connections are exported; not the full neighborhood.')))
    reseal(site)
    assert guard.validate_publication(site)['status'] == 'PASS'


def test_unreachable_fragment_is_not_a_privacy_scanner_escape(packed):
    pack = guard.pack_module()
    def change(manifest):
        old = manifest['chunks'][0]
        data = json.loads(gzip.decompress((packed / 'data/packed' / old['path']).read_bytes()))
        data['fragments'].append(['Unreachable /Users/fake/private data must not be published.'])
        raw = pack.encoded(data)
        compressed = gzip.compress(raw, mtime=0)
        new_path = 'chunks/' + sha(compressed) + '.json.gz'
        (packed / 'data/packed' / old['path']).unlink()
        (packed / 'data/packed' / new_path).write_bytes(compressed)
        old.update(path=new_path, wire_sha256=sha(compressed), sha256decoded=sha(raw),
                   wire_bytes=len(compressed), decoded_bytes=len(raw), last_id=3)
    update_pack(packed, change)
    with pytest.raises(guard.PublicationError, match='unreachable fragment'):
        guard.validate_publication(packed)


def test_actual_packer_roundtrip_has_no_unscanned_fragments(site, tmp_path):
    pack = guard.pack_module()
    source = tmp_path / 'fake-source'
    source.mkdir()
    body = 'SECRET historical quotation; password=OLD; /home/ is literal source. ' * 50
    original = ('{ "document_id": "historic", "text": ' + json.dumps(body)
                + ', "number": 1e-09, "literal": ["$ref",1] }\n').encode()
    (source / 'original.json').write_bytes(original)
    folder = site / 'data/packed'
    manifest, _ = pack.pack_assets(source, folder,
        [dict(name='roundtrip', corpus='cib', category='hierarchy',
              ref=dict(path='original.json', sha256=sha(original), bytes=len(original)))],
        minimum=32, chunk_bytes=4096, template_limit=256)
    # Builder state and measurements are never part of the public pack.
    (folder / 'build.sqlite3').unlink()
    (folder / 'measurement.json').unlink()
    index = read(site, 'api/index.json')
    index['entries']['/api/source-v6?case_id=case-1&source_id=roundtrip'] = dict(
        encoding='fragment-dag', path='data/packed/manifest.json', asset='roundtrip',
        manifest_sha256=sha((folder / 'manifest.json').read_bytes()),
        sha256=manifest['assets']['roundtrip']['sha256decoded'], mime='application/json')
    write(site, index, 'api/index.json')
    reseal(site)
    result = guard.validate_publication(site)
    assembled = pack.Reader(folder, manifest).decode('roundtrip')
    assert result['fragment_dag_roots_verified'] == 1
    assert json.loads(assembled)['text'] == body
    assert b'1e-09' in assembled and json.loads(assembled)['literal'] == ['$ref', 1]
    assert manifest['assets']['roundtrip']['originalsha256'] == sha(original)
    assert (source / 'original.json').read_bytes() == original


@pytest.mark.parametrize('field', ['approved', 'historical_public_sources',
    'heldout_answers_intentionally_public', 'previously_public_historical_sources_only',
    'no_private_workspace_material', 'not_a_declassification_claim'])
@pytest.mark.parametrize('replacement', [None, False, 'true'])
def test_public_source_scope_requires_explicit_boolean_declarations(site, field, replacement):
    pub = read(site)
    if replacement is None:
        pub['publicness'].pop(field)
    else:
        pub['publicness'][field] = replacement
    write(site, pub)
    with pytest.raises(guard.PublicationError, match='public-source scope'):
        guard.validate_publication(site)


@pytest.mark.parametrize('field', ['previously_public_historical_sources_only',
    'no_private_workspace_material', 'not_a_declassification_claim'])
def test_legacy_clearance_assertion_cannot_substitute_for_source_scope(site, field):
    pub = read(site)
    pub['publicness'].pop(field)
    pub['publicness']['no_current_classified_information'] = True
    write(site, pub)
    with pytest.raises(guard.PublicationError, match='public-source scope'):
        guard.validate_publication(site)


def test_guard_does_not_require_or_make_a_current_classification_finding(site):
    pub = read(site)
    assert 'no_current_classified_information' not in pub['publicness']
    result = guard.validate_publication(site)
    assert result['status'] == 'PASS'
    assert 'not legal clearance, declassification' in result['licensing']
    assert 'blanket copyright license' in result['licensing']


def test_guard_uses_bounded_cross_root_cache(packed, monkeypatch):
    pack = guard.pack_module()
    original = pack.Reader.__init__
    sizes = []
    def construct(self, *args, **kwargs):
        sizes.append(kwargs['cache_chunks'])
        original(self, *args, **kwargs)
    monkeypatch.setattr(pack.Reader, '__init__', construct)
    guard.validate_publication(packed)
    assert sizes == [64]


def test_orphan_check_is_topological_not_an_lru_reference_walk():
    class Reader:
        starts = [1, 2, 3]
        chunks = [dict(first_id=i, last_id=i) for i in (1, 2, 3)]
        reads = []
        def chunk(self, number):
            self.reads.append(number)
            return [["literal"]] if number == 0 else [["", number, ""]]
    reader = Reader()
    manifest = dict(assets=dict(a=dict(pieces=['', 3, '']), b=dict(pieces=['', 2, ''])))
    guard.FragmentPacks.check_reachability(reader, manifest)
    assert reader.reads == [2, 1, 0]


@pytest.fixture
def datasets(site):
    root = site.parent / 'datasets'
    (root / 'cib').mkdir(parents=True)
    raw = wire(dict(case_ids=['source-provenance-not-a-benchmark-case'],
        nodes=[dict(id='entity-1', document_id='historic', text='SECRET historical source password=OLD.')]))
    compressed = gzip.compress(raw, mtime=0)
    relative = 'cib/' + sha(compressed) + '.json.gz'
    (root / relative).write_bytes(compressed)
    row = dict(path='datasets/' + relative, bytes=len(compressed), wire_sha256=sha(compressed),
        sha256decoded=sha(raw), corpus='cib', logical_key='/graph-assets-v4/cib/comparison.json',
        source_wire_sha256='a'*64, graph_id='browser_graph', hierarchy_id='hierarchy-1',
        all_graph_objects_preserved=True, workstation_metadata_removed=False)
    write(root, dict(version=guard.DATASET_VERSION, files=[row], source_binding_sha256='b'*64,
        source_bodies_modified=False, original_graph_modified=False,
        rights_notice='Fake fixture: previously public historical sources, not a declassification claim.'), 'manifest.json')
    return root


def dataset_pin(root):
    return sha((root / 'manifest.json').read_bytes())


def test_standalone_datasets_checks_actual_schema_without_a_commit(datasets):
    before = {p.relative_to(datasets):p.read_bytes() for p in datasets.rglob('*') if p.is_file()}
    result = guard.validate_datasets(datasets, dataset_pin(datasets))
    assert result['dataset_files'] == result['logical_graph_assets'] == 1
    assert result['network_calls'] == 0
    assert before == {p.relative_to(datasets):p.read_bytes() for p in datasets.rglob('*') if p.is_file()}


def test_dataset_case_ids_are_not_active_benchmark_membership(datasets):
    assert guard.validate_datasets(datasets, dataset_pin(datasets))['status'] == 'PASS'


def test_dataset_manifest_requires_independent_byte_pin(datasets):
    with pytest.raises(guard.PublicationError, match='manifest byte SHA256'):
        guard.validate_datasets(datasets, '0'*64)


@pytest.mark.parametrize('field,value', [('source_bodies_modified', True), ('original_graph_modified', True),
    ('rights_notice', 'TODO'), ('source_binding_sha256', 'not-a-hash')])
def test_dataset_source_and_preservation_declarations(datasets, field, value):
    manifest = read(datasets, 'manifest.json')
    manifest[field] = value
    write(datasets, manifest, 'manifest.json')
    with pytest.raises(guard.PublicationError):
        guard.validate_datasets(datasets, dataset_pin(datasets))


@pytest.mark.parametrize('field,value', [('path', '../private/source.json.gz'), ('corpus', 'iran'),
    ('source_wire_sha256', 'not-a-hash'), ('all_graph_objects_preserved', False),
    ('workstation_metadata_removed', 'yes'), ('graph_id', ''), ('sha256decoded', '0'*64)])
def test_dataset_paths_hashes_and_explicit_graph_lineage(datasets, field, value):
    manifest = read(datasets, 'manifest.json')
    manifest['files'][0][field] = value
    write(datasets, manifest, 'manifest.json')
    with pytest.raises(guard.PublicationError):
        guard.validate_datasets(datasets, dataset_pin(datasets))


def test_shared_dataset_payload_is_decoded_once_for_multiple_logical_keys(datasets, monkeypatch):
    manifest = read(datasets, 'manifest.json')
    manifest['files'].append(dict(manifest['files'][0], logical_key='/graph-assets-v4/cib/alias.json'))
    write(datasets, manifest, 'manifest.json')
    original, calls = guard.decoded, []
    def tracked(*args):
        calls.append(1)
        return original(*args)
    monkeypatch.setattr(guard, 'decoded', tracked)
    result = guard.validate_datasets(datasets, dataset_pin(datasets))
    assert result['dataset_files'] == 1 and result['logical_graph_assets'] == 2 and calls == [1]


def test_dataset_duplicate_logical_key_is_rejected(datasets):
    manifest = read(datasets, 'manifest.json')
    manifest['files'].append(dict(manifest['files'][0]))
    write(datasets, manifest, 'manifest.json')
    with pytest.raises(guard.PublicationError, match='logical key'):
        guard.validate_datasets(datasets, dataset_pin(datasets))


def test_dataset_wire_tamper_is_not_adopted(datasets):
    row = read(datasets, 'manifest.json')['files'][0]
    path = datasets / row['path'].removeprefix('datasets/')
    content = bytearray(path.read_bytes())
    content[-1] ^= 1
    path.write_bytes(content)
    with pytest.raises(guard.PublicationError, match='wire SHA256'):
        guard.validate_datasets(datasets, dataset_pin(datasets))


def test_dataset_metadata_privacy_not_disabled_with_case_membership(datasets):
    manifest = read(datasets, 'manifest.json')
    row = manifest['files'][0]
    old = datasets / row['path'].removeprefix('datasets/')
    raw = wire(dict(case_ids=['source-provenance-only'], debug='/Users/fake/private/source'))
    compressed = gzip.compress(raw, mtime=0)
    relative = 'cib/' + sha(compressed) + '.json.gz'
    old.unlink()
    (datasets / relative).write_bytes(compressed)
    row.update(path='datasets/'+relative, bytes=len(compressed), wire_sha256=sha(compressed), sha256decoded=sha(raw))
    write(datasets, manifest, 'manifest.json')
    with pytest.raises(guard.PublicationError, match='filesystem'):
        guard.validate_datasets(datasets, dataset_pin(datasets))


def test_dataset_symlinks_and_unlisted_files_rejected(datasets, tmp_path):
    extra = datasets / 'cib' / ('f'*64 + '.json.gz')
    extra.symlink_to(tmp_path / 'not-opened-private-fixture')
    with pytest.raises(guard.PublicationError, match='symlink'):
        guard.validate_datasets(datasets, dataset_pin(datasets))
    extra.unlink()
    extra.write_bytes(b'not an adopted output')
    with pytest.raises(guard.PublicationError, match='whitelist differs'):
        guard.validate_datasets(datasets, dataset_pin(datasets))


def test_dataset_budgets_are_independent_and_exclusive(datasets):
    sizes = [p.stat().st_size for p in datasets.rglob('*') if p.is_file()]
    with pytest.raises(guard.PublicationError, match='total dataset'):
        guard.validate_datasets(datasets, dataset_pin(datasets), max_total_bytes=sum(sizes))
    with pytest.raises(guard.PublicationError, match='individual dataset'):
        guard.validate_datasets(datasets, dataset_pin(datasets), max_file_bytes=max(sizes))
    assert guard.MAX_DATASET_BYTES == 3_000_000_000


def test_dataset_cli_needs_pin_but_not_network_or_commit(datasets, capsys):
    assert guard.main(['--datasets-only', '--dataset-root', str(datasets),
        '--dataset-manifest-sha256', dataset_pin(datasets)]) == 0
    assert json.loads(capsys.readouterr().out)['dataset_files'] == 1
    assert guard.main(['--datasets-only', '--dataset-root', str(datasets)]) == 1


def test_bare_historical_private_label_is_not_a_filesystem_reference():
    guard.scan_json(dict(label='private', summary='A private organization'), None)
    with pytest.raises(guard.PublicationError, match='filesystem'):
        guard.scan_json(dict(path='private/source_proofs.json'), None)


def test_dataset_root_readme_is_separately_hashed_not_a_data_url(datasets):
    notice = b'# Dataset notice\nPreviously public historical material. Not a declassification claim.\n'
    (datasets / 'README.md').write_bytes(notice)
    result = guard.validate_datasets(datasets, dataset_pin(datasets))
    assert result['dataset_files'] == 1
    assert result['ancillary_notices']['README.md'] == dict(bytes=len(notice), sha256=sha(notice))


def test_dataset_root_readme_is_metadata_not_an_unscanned_quote(datasets):
    (datasets / 'README.md').write_text('OPENAI_API_KEY=FAKE-NOT-A-REAL-KEY')
    with pytest.raises(guard.PublicationError, match='credential'):
        guard.validate_datasets(datasets, dataset_pin(datasets))


@pytest.fixture
def external(site, datasets):
    row = read(datasets, 'manifest.json')['files'][0]
    commit = '1'*40
    pub = read(site)
    pub['graph_data_manifest'] = dict(path='datasets/manifest.json', sha256=dataset_pin(datasets), commit=commit)
    write(site, pub)
    index = read(site, 'api/index.json')
    index['entries'][row['logical_key']] = dict(external_url=
        'https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/'+commit+'/'+row['path'],
        wire_sha256=row['wire_sha256'], sha256=row['sha256decoded'], encoding='gzip', mime='application/json')
    write(site, index, 'api/index.json')
    reseal(site, routes=False)
    return site, datasets, row['logical_key']


def test_external_graph_is_fully_verified_offline_with_default_dataset_root(external, monkeypatch):
    import socket
    def no_network(*args, **kwargs):
        raise AssertionError('No network or credentials allowed')
    monkeypatch.setattr(socket, 'create_connection', no_network)
    site, datasets, key = external
    result = guard.validate_publication(site)
    assert result['datasets']['dataset_files'] == 1
    assert result['dataset_commit'] == '1'*40 and result['api_routes'] == 2
    assert result['network_calls'] == result['datasets']['network_calls'] == 0
    assert result['stored_bytes'] < result['stored_bytes'] + result['datasets']['stored_bytes']


@pytest.mark.parametrize('url', [
    'http://raw.githubusercontent.com/jimhcyang/matryoshka-demo/{commit}/{path}',
    'https://raw.githubusercontent.com/other/matryoshka-demo/{commit}/{path}',
    'https://raw.githubusercontent.com/jimhcyang/other/{commit}/{path}',
    'https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/main/{path}',
    'https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/{commit}/{path}?download=1',
    'https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/{commit}/{path}#fragment',
    'https://FAKE:FAKE@raw.githubusercontent.com/jimhcyang/matryoshka-demo/{commit}/{path}',
    'https://raw.githubusercontent.com:443/jimhcyang/matryoshka-demo/{commit}/{path}',
    'https://raw.githubusercontent.com.evil.example/jimhcyang/matryoshka-demo/{commit}/{path}',
    'https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/{commit}/datasets/../{path}',
])
def test_external_dataset_url_is_exact_not_a_general_allowlist(external, url):
    site, datasets, key = external
    index = read(site, 'api/index.json')
    row = read(datasets, 'manifest.json')['files'][0]
    index['entries'][key]['external_url'] = url.format(commit='1'*40, path=row['path'])
    write(site, index, 'api/index.json')
    reseal(site, routes=False)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


@pytest.mark.parametrize('field,value', [('sha256', '0'*64), ('wire_sha256', '0'*64),
    ('encoding', 'identity'), ('mime', 'text/html'), ('path', 'data/case-1.json.gz')])
def test_external_entry_pins_and_transport_cannot_be_substituted(external, field, value):
    site, datasets, key = external
    index = read(site, 'api/index.json')
    index['entries'][key][field] = value
    write(site, index, 'api/index.json')
    reseal(site, routes=False)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


@pytest.mark.parametrize('field,value', [('sha256', '0'*64), ('commit', 'main'),
    ('commit', '2'*40), ('path', '../datasets/manifest.json')])
def test_external_publication_ref_is_mandatory_and_commit_bound(external, field, value):
    site, datasets, key = external
    pub = read(site)
    pub['graph_data_manifest'][field] = value
    write(site, pub)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


def test_external_readme_never_becomes_a_dataset_url(external):
    site, datasets, key = external
    (datasets / 'README.md').write_text('Previously public source notice; no declassification claim.')
    index = read(site, 'api/index.json')
    index['entries'][key]['external_url'] = 'https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/'+'1'*40+'/datasets/README.md'
    write(site, index, 'api/index.json')
    reseal(site, routes=False)
    with pytest.raises(guard.PublicationError):
        guard.validate_publication(site)


@pytest.mark.parametrize('logical', ['/graph-assets-v4/cib/comparison.json',
    '/api/graph-v4-viewer?corpus=cib', '/api/condition-v6?case_id=case-1&config=llm_readings',
    '/api/flow-v6?case_id=case-1&config=llm_readings'])
def test_graph_and_fast_condition_flow_dag_transport_is_rejected_early(packed, logical, monkeypatch):
    index = read(packed, 'api/index.json')
    row = index['entries'].pop('/api/source-v6?case_id=case-1&source_id=packed-comparison')
    index['entries'][logical] = row
    write(packed, index, 'api/index.json')
    reseal(packed)
    def do_not_decode():
        raise AssertionError('Rejected transport must not load a graph DAG')
    monkeypatch.setattr(guard, 'pack_module', do_not_decode)
    with pytest.raises(guard.PublicationError, match='DAG transport is forbidden'):
        guard.validate_publication(packed)


def test_local_graph_bootstrap_case_ids_are_source_provenance(site):
    (site / 'data/graph-bootstrap.json').write_bytes(wire(dict(case_ids=['not-a-demo-case'])))
    index = read(site, 'api/index.json')
    raw = (site / 'data/graph-bootstrap.json').read_bytes()
    index['entries']['/graph-assets-v4/cib/comparison.json'] = dict(path='data/graph-bootstrap.json',
        encoding='identity', sha256=sha(raw), mime='application/json')
    write(site, index, 'api/index.json')
    reseal(site)
    assert guard.validate_publication(site)['status'] == 'PASS'


def test_data_and_site_budgets_remain_independent(external):
    site, datasets, key = external
    site_bytes = sum(p.stat().st_size for p in site.rglob('*') if p.is_file())
    dataset_bytes = sum(p.stat().st_size for p in datasets.rglob('*') if p.is_file())
    assert guard.validate_publication(site, max_total_bytes=site_bytes+1)['status'] == 'PASS'
    with pytest.raises(guard.PublicationError, match='total dataset'):
        guard.validate_publication(site, max_dataset_bytes=dataset_bytes)


def pass_proof(datasets, tmp_path):
    checker = guard.GraphDatasets(datasets, dataset_pin(datasets))
    result = checker.verify()
    path = tmp_path / 'qa/dataset-pass.json'
    guard.write_dataset_proof(path, guard.dataset_proof(checker, result))
    return dict(path=path, sha256=sha(path.read_bytes()))


def test_explicit_pass_proof_reuses_privacy_but_still_hashes_inputs(external, tmp_path, monkeypatch):
    site, datasets, key = external
    proof = pass_proof(datasets, tmp_path)
    def no_second_decode(*args, **kwargs):
        raise AssertionError('Dataset reuse must not decompress again')
    monkeypatch.setattr(gzip, 'GzipFile', no_second_decode)
    result = guard.validate_datasets(datasets, dataset_pin(datasets), proof_ref=proof)
    assert result['validation_mode'] == 'pinned-full-privacy-pass-plus-fresh-wire-hashes'
    assert result['dataset_files'] == 1


def test_site_validation_reuses_explicit_dataset_proof(external, tmp_path):
    site, datasets, key = external
    proof = pass_proof(datasets, tmp_path)
    result = guard.validate_publication(site, dataset_proof_ref=proof)
    assert result['datasets']['dataset_files'] == 1
    assert result['dataset_validation_mode'] == 'pinned-full-privacy-pass-plus-fresh-wire-hashes'


def test_reuse_rehashes_same_size_same_mtime_tampered_file(datasets, tmp_path):
    import os
    proof = pass_proof(datasets, tmp_path)
    row = read(datasets, 'manifest.json')['files'][0]
    path = datasets / row['path'].removeprefix('datasets/')
    before = path.stat()
    data = bytearray(path.read_bytes())
    data[-1] ^= 1
    path.write_bytes(data)
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    with pytest.raises(guard.PublicationError, match='changed during validation'):
        guard.validate_datasets(datasets, dataset_pin(datasets), proof_ref=proof)


@pytest.mark.parametrize('field,value', [('validator_sha256', '0'*64), ('checker_policy_sha256', '0'*64),
    ('manifest_sha256', '0'*64), ('full_privacy_scan', False), ('files', []), ('version', 'old-pass')])
def test_proof_reuse_requires_exact_code_source_inventory_and_version(datasets, tmp_path, field, value):
    proof = pass_proof(datasets, tmp_path)
    p = proof['path']
    value_obj = json.loads(p.read_bytes())
    value_obj[field] = value
    p.chmod(0o644)
    p.write_bytes(wire(value_obj))
    proof['sha256'] = sha(p.read_bytes())
    with pytest.raises(guard.PublicationError):
        guard.validate_datasets(datasets, dataset_pin(datasets), proof_ref=proof)


def test_pass_word_or_unpinned_receipt_never_authorizes_reuse(datasets, tmp_path):
    proof = pass_proof(datasets, tmp_path)
    with pytest.raises(guard.PublicationError, match='proof byte SHA256'):
        guard.validate_datasets(datasets, dataset_pin(datasets), proof_ref=dict(path=proof['path']))
    proof['path'].chmod(0o644)
    proof['path'].write_bytes(wire(dict(status='PASS')))
    proof['sha256'] = sha(proof['path'].read_bytes())
    with pytest.raises(guard.PublicationError, match='approved full dataset'):
        guard.validate_datasets(datasets, dataset_pin(datasets), proof_ref=proof)


def test_proof_includes_ancillary_notice_identity(datasets, tmp_path):
    (datasets / 'README.md').write_text('First public source notice.')
    proof = pass_proof(datasets, tmp_path)
    (datasets / 'README.md').write_text('Other public source notice.')
    with pytest.raises(guard.PublicationError, match='source/file membership'):
        guard.validate_datasets(datasets, dataset_pin(datasets), proof_ref=proof)


def test_only_completed_full_scan_can_issue_proof(datasets):
    checker = guard.GraphDatasets(datasets, dataset_pin(datasets))
    with pytest.raises(guard.PublicationError, match='completed full dataset scan'):
        guard.dataset_proof(checker, checker.summary())


def test_cli_full_scan_can_issue_immutable_explicit_qa_proof(datasets, tmp_path, capsys):
    proof = tmp_path / 'qa/full-pass.json'
    args = ['--datasets-only', '--dataset-root', str(datasets),
        '--dataset-manifest-sha256', dataset_pin(datasets), '--write-dataset-proof', str(proof)]
    assert guard.main(args) == 0
    value = json.loads(proof.read_bytes())
    assert value['full_privacy_scan'] is True
    assert guard.main(args) == 1  # Never replace an existing approval receipt.
    assert 'FAIL' in capsys.readouterr().err


@pytest.mark.parametrize('value', ['SECRET', 'private', 'Historical public cable',
    'private/source_proofs.json', '/Users/fake/private/file', 'http://localhost:8930/x',
    'https://FAKE:FAKE@archive.example.org/x', 'PASSWORD=FAKE-ONLY',
    'sk-proj-FAKE_ONLY_NOT_A_REAL_CREDENTIAL_12345', 'https://archive.example.org/document',
    'caf\u00e9', '%2FUsers%2Ffake%2Fprivate%2Ffile'])
@pytest.mark.parametrize('source_body', [False, True])
def test_pure_metadata_memo_has_exact_uncached_outcomes(value, source_body):
    guard._metadata_text_cached.cache_clear()
    def outcome(fn):
        try:
            fn(value, source_body)
            return 'PASS', None
        except guard.PublicationError as exc:
            return 'FAIL', str(exc)
    expected = outcome(guard._metadata_text_uncached)
    assert outcome(guard.metadata_text) == expected
    assert outcome(guard.metadata_text) == expected


def test_metadata_memo_role_cannot_cross_source_and_metadata_context():
    guard._metadata_text_cached.cache_clear()
    value = '/Users/fake/quoted-historical-path'
    guard.metadata_text(value, True)
    with pytest.raises(guard.PublicationError, match='filesystem'):
        guard.metadata_text(value, False)
    guard.metadata_text(value, True)
    assert guard._metadata_text_cached.cache_info().hits == 1


def test_metadata_memo_never_caches_errors():
    guard._metadata_text_cached.cache_clear()
    for _ in range(2):
        with pytest.raises(guard.PublicationError):
            guard.metadata_text('API_KEY=FAKE-ONLY', False)
    info = guard._metadata_text_cached.cache_info()
    assert info.misses == 2 and info.currsize == 0


def test_metadata_memo_is_bounded_and_long_strings_bypass_it():
    guard._metadata_text_cached.cache_clear()
    assert guard._metadata_text_cached.cache_info().maxsize == 65536
    for value in ('x'*2049, '\U0001f642'*2048):
        guard.metadata_text(value)
        guard.metadata_text(value)
    assert guard._metadata_text_cached.cache_info().currsize == 0
    guard.metadata_text('x'*2048)
    guard.metadata_text('x'*2048)
    assert guard._metadata_text_cached.cache_info().currsize == 1
    assert guard._metadata_text_cached.cache_info().hits == 1


def test_field_and_case_checks_still_run_after_metadata_literals_are_cached(monkeypatch):
    guard._metadata_text_cached.cache_clear()
    guard.scan_json(dict(case_id='graph-source-id'), None)
    with pytest.raises(guard.PublicationError, match='unknown or omitted case'):
        guard.scan_json(dict(case_id='graph-source-id'), {'selected-case'})
    guard.scan_json(dict(new_sensitive_field='fixture'), None)
    monkeypatch.setattr(guard, 'CREDENTIAL_KEYS', guard.CREDENTIAL_KEYS | {'new_sensitive_field'})
    with pytest.raises(guard.PublicationError, match='credential metadata field'):
        guard.scan_json(dict(new_sensitive_field='fixture'), None)
    monkeypatch.setattr(guard, 'PRIVATE_KEYS', guard.PRIVATE_KEYS | {'new_private_field'})
    guard.metadata_text('new_private_field')
    with pytest.raises(guard.PublicationError, match='private human-review'):
        guard.scan_json(dict(new_private_field='fixture'), None)


def test_dataset_wire_tamper_fails_even_with_warm_literal_memo(datasets):
    guard.validate_datasets(datasets, dataset_pin(datasets))
    assert guard._metadata_text_cached.cache_info().currsize > 0
    row = read(datasets, 'manifest.json')['files'][0]
    path = datasets / row['path'].removeprefix('datasets/')
    raw = bytearray(path.read_bytes())
    raw[-1] ^= 1
    path.write_bytes(raw)
    with pytest.raises(guard.PublicationError, match='wire SHA256'):
        guard.validate_datasets(datasets, dataset_pin(datasets))

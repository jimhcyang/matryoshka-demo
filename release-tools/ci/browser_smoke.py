"""Managed-shell release checks: current UI, unchanged archives, no inference.

Based on installed release-tools/ci/browser_smoke.py, SHA-256
8b3d032043af69ec80e9a2033b789f80baec3a0ff1bdcb6f3610cb35a70dcc16.
Old source/native checks remain; public-study UI expectations follow its OWN pin.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import sys
import threading
import traceback
from urllib.parse import parse_qs, urlencode, urlsplit

tools_root = Path(__file__).resolve().parents[1]
if not (tools_root / 'fragment_reader.py').is_file():
    tools_root = next((parent / 'matryoshka_demo_site/release-tools'
        for parent in Path(__file__).resolve().parents
        if (parent / 'matryoshka_demo_site/release-tools/fragment_reader.py').is_file()), None)
    if tools_root is None:
        raise RuntimeError('Run with the installed or contained release-tools closure')
sys.path.insert(0, str(tools_root))
from serve_static import server
from fragment_reader import Reader
from playwright.sync_api import expect, sync_playwright


class MemoryReader(Reader):
    """Keep the installed verifier unchanged except its file-only cleanup."""
    def close(self):
        self.pieces.cache_clear()
        self.db.close()

ARCHIVED_PINS = {
    'swedish-scoped-study-v04.json': '2d239fbce042a2a71323c11fd48bf9f3451660bd82cc40c847d28fa3a65abbae',
    'swedish-scoped-first-v03.json': 'bbd8769c9fe1f773e4cb04acd27ced561ac486403baebda1a2e179058d93b0f0',
    'swedish-scoped-second-v03.json': '5181b8ec3532fb0cbd9834d55c52397cff09be186f6a1ce3a6d00c4661837717',
    'swedish-scoped-first-completion-v03.json': 'aec8fbe816019742bae8f69560f49dd98dcee585a6bc82c9176cb7da77d11bb2',
    'swedish-scoped-second-completion-v03.json': '43ed6a035d52270c6f97bebbc5d866bf9a493169af72452f6677bc66fe75cda7',
}


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def safe_path(site, relative):
    assert isinstance(relative, str) and relative and not urlsplit(relative).scheme
    assert not relative.startswith('/') and '\\' not in relative
    assert all(part not in ('', '.', '..') for part in relative.split('/'))
    path = site / relative
    assert path.resolve() == path and path.is_file() and not path.is_symlink()
    return path


def pinned(site, reference):
    assert re.fullmatch('[a-f0-9]{64}', reference.get('sha256', ''))
    raw = safe_path(site, reference['path']).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == reference['sha256'], 'Study byte pin changed: ' + reference['path']
    return json.loads(raw)


class Metadata(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.values = {}
        self.attributes = {}
        self.feed(text)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'meta' and attrs.get('name'):
            self.values[attrs['name']] = attrs.get('content', '')
            self.attributes[attrs['name']] = attrs


def public_study(site):
    metadata = Metadata((site / 'swedish-study.html').read_text())
    meta = metadata.values
    expected = meta.get('study-data-sha256', '')
    assert re.fullmatch('[a-f0-9]{64}', expected), 'Public study must declare its own byte pin'
    path = meta.get('study-data-path') or metadata.attributes.get('study-data-sha256', {}).get('data-file')
    if not path:
        # Compatibility with the existing page's hash-only declaration. Never
        # substitute the archived study merely because its filename is familiar.
        matches = [p.name for p in site.glob('*.json') if hashlib.sha256(p.read_bytes()).hexdigest() == expected]
        assert len(matches) == 1, 'Declare study-data-path alongside study-data-sha256'
        path = matches[0]
    ref = dict(path=path, sha256=expected)
    study = pinned(site, ref)
    assert study.get('version') in {'swedish-scoped-shared-kernel-ui/3', 'cib-delegation-public-study/1'}, 'Unsupported public study contract'
    return ref, study


def validate_archive(site):
    values = {name: pinned(site, dict(path=name, sha256=sha)) for name, sha in ARCHIVED_PINS.items()}
    study = values['swedish-scoped-study-v04.json']
    assert study['execution_performed'] is True and study['canonical_native_run'] is False and study['gold'] is None
    output = []
    for display_ref, completion_ref in zip(study['cases'], study['public_completions'], strict=True):
        display, completion = pinned(site, display_ref), pinned(site, completion_ref)
        assert display['execution_performed'] is True and display['canonical_native_run'] is False and display['gold'] is None
        assert display['execution_version'] == 'narrative-scoped-source-study-execution/3'
        assert display['coordinate_policy_version'] == 'declared-producer-job-local-coordinates/3'
        assert completion['public_display_ref'] == display_ref and completion['gold'] is None
        assert completion['case_id'] == display['case']['case_id'] and completion['position'] == display['position']
        assert completion['source_view_sha256'] == display['source_view_sha256']
        assert completion['query_sha256'] == display['query_sha256'] == digest(display['case']['query'])
        assert completion['executed_snapshot_identity'] == study['executed_snapshot_identity']
        assert completion['raw_result_audit_digest'] == display['raw_result_audit_digest']
        assert any(c['source_variants'] for r in display['readings'] for c in r['candidates'])
        output.append(display)
    return dict(pin_count=len(values), exact_bytes_preserved=True, archived_not_current_evidence=True), output


def public_cases(site, study):
    if study['version'] == 'swedish-scoped-shared-kernel-ui/3':
        cases = [pinned(site, ref) for ref in study['cases']]
        assert len(study['public_completions']) == len(cases)
        for case, ref, seal in zip(cases, study['cases'], study['public_completions'], strict=True):
            completion = pinned(site, seal)
            assert completion['public_display_ref'] == ref
            assert completion['case_id'] == case['case']['case_id'] and completion['gold'] is None
        return cases
    projection = study.get('projection')
    if projection:
        assert projection['native_decisions_or_ranks_modified'] is False
        assert projection['all_input_arms_preserved'] is True and projection['technical_audits_abbreviated'] is True
        assert re.fullmatch('[a-f0-9]{64}', projection['source_ref']['sha256'])
    else:
        assert study['canonical_baseline_modified'] is False
    assert study['design']['preregistered'] is True and study['design']['unknown_gold'] is True
    assert study['trace_policy']['fresh_graph_routes_invented'] is False
    assert study['trace_policy']['direct_source_handoffs_only'] is True
    cases = study['cases']
    design = study['design']
    expected = {(arm['id'], position) for arm in design['window_arms'] for position in design['focal_positions']}
    assert len(cases) == len(expected)
    assert {(c['window_arm'], c['position']) for c in cases} == expected, 'Missing preregistered arm/focal case'
    assert study['completeness']['all_variants_visible'] is True
    assert study['completeness']['executed_cases'] == sum(c['execution_performed'] for c in cases)
    origin = study['origin']
    assert origin['input_only'] is True and origin['eligible_as_corpus_evidence'] is False
    assert origin['entire_origin_excluded'] is True
    assert origin.get('visible_clue_is_corpus_proof', False) is False
    window = origin['full_window']
    assert digest(window['text']) == window['page_text_sha256']
    assert hashlib.sha256(window['text'].encode()).hexdigest() == window['raw_utf8_sha256']
    mappings = {item['case_id']: item for item in origin['input_window_mappings']}
    for case in cases:
        assert case['gold'] is None and case['reference_answer'] is None
        assert case['scope']['strict_prior'] is True and case['scope']['whole_origin_excluded'] is True
        assert case['scope']['exact_origin_admitted'] is False and case['visible_clue_is_corpus_proof'] is False
        mapping = mappings[case['case']['case_id']]
        assert mapping['query_sha256'] == digest(case['case']['query'])
        for segment in mapping['segments']:
            a, b = segment['source_span']
            c, d = segment['query_span']
            original = window['text'][a:b]
            assert original == segment['exact_source_text'] and digest(original) == segment['source_text_sha256']
            assert case['case']['query'][c:d] == segment['rendered_query_text']
        if case['execution_performed']:
            assert re.fullmatch('[a-f0-9]{64}', case['execution_ref']['sha256'])
            if not projection:
                assert re.fullmatch('[a-f0-9]{64}', case['native_result_sha256'])
                assert case['original_canonical_native_execution'] is False
        for reading in case['readings']:
            for candidate in reading['candidates']:
                if projection:
                    assert re.fullmatch('[a-f0-9]{64}', candidate['native_candidate_sha256'])
                else:
                    assert candidate['citation_union_is_support_proof'] is False
                    assert candidate['individual_source_decisions_preserved'] is True
                for variant in candidate['source_variants']:
                    if projection:
                        assert re.fullmatch('[a-f0-9]{64}', variant['native_variant_sha256'])
                    for ref in variant.get('sources', []):
                        assert ref['document_id'] != case['case']['document_id'] and ref['date'] < case['case']['date']
                        assert re.fullmatch('[a-f0-9]{64}', ref['page_sha256'])
                        assert type(ref['start']) is int and type(ref['end']) is int and 0 <= ref['start'] < ref['end']
                        assert len(ref['text']) == ref['end'] - ref['start']
                        page = study.get('source_pages', {}).get(ref['canonical_page_id'])
                        if page:
                            assert page['document_id'] == ref['document_id'] and page['date'] == ref['date']
                            assert page['permitted'] is True and not page.get('quarantined')
                            assert page.get('origin_control_or_input_only') is not True
                            assert digest(page['text']) == ref['page_sha256']
                            assert page['text'][ref['start']:ref['end']] == ref['text']
    for control in study.get('historical_exact_origin_controls', []):
        assert control['control_only'] is True and control['ordinary_evidence'] is False
        assert control['scope']['exact_origin_admitted'] is True and control['gold'] is None
    return cases


def citation_refs(value):
    """Saved native/display references, not generated UI strings or gold."""
    if isinstance(value, dict):
        if {'canonical_page_id', 'text', 'start', 'end', 'page_sha256'} <= value.keys():
            yield value
        for item in value.values():
            yield from citation_refs(item)
    elif isinstance(value, list):
        for item in value:
            yield from citation_refs(item)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--datasets-root', type=Path)
    parser.add_argument('--minimum-free-gib', type=int, choices=(3, 8), default=8)
    parser.add_argument('--expected-cases', type=int, default=14, help='Release workbench count, not study variant count')
    parser.add_argument('--only', help='Development subset: archive,study,graph,walk,workbench,live; omitted means ALL')
    args = parser.parse_args()
    selected = set(args.only.split(',')) if args.only else {'archive', 'study', 'graph', 'walk', 'workbench', 'live'}
    assert selected <= {'archive', 'study', 'graph', 'walk', 'workbench', 'live'} and selected
    site, out = args.site.resolve(), args.output.absolute()
    assert shutil.disk_usage(out.parent).free >= args.minimum_free_gib * 1024**3, 'Disk reserve exhausted'
    out.mkdir(parents=True, exist_ok=False)
    entries = json.loads((site / 'data/api-index.json').read_bytes())['entries']
    from same_repo import dataset
    for key, entry in entries.items():
        if entry.get('external_url'):
            dataset(key, entry)
    report = json.loads((site / 'data/report-v6.json').read_bytes())
    assert len(report['cases']) == args.expected_cases
    leaked, external, rows = [], [], []
    http = server(site, prefix='/nested/matryoshka-demo/', logs=leaked, datasets_root=args.datasets_root)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    origin = 'http://127.0.0.1:' + str(http.server_port)
    base = origin + '/nested/matryoshka-demo/'
    # Identical hash-checking Reader, but its SQLite fragment index stays in
    # memory. The installed packet pack is ~490MB; duplicating it on this
    # workstation would breach the 3 GiB floor. No dataset copy is made.
    reader = MemoryReader(site, Path(':memory:'), minimum_free_bytes=args.minimum_free_gib * 1024**3)
    def packet(path, params):
        key = path + '?' + urlencode(sorted(params.items()))
        assert key in entries, 'No exact saved packet: ' + key
        return json.loads(reader.read(entries[key]))
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            def run(name, operation, mobile=False):
                context = browser.new_context(viewport=dict(width=390, height=844) if mobile else dict(width=1440, height=1000), reduced_motion='reduce')
                context.route('**/*', lambda r: r.continue_() if r.request.url.startswith(origin + '/') else (external.append(r.request.url), r.abort())[-1])
                page = context.new_page()
                errors, row = [], dict(name=name)
                page.on('pageerror', lambda error: errors.append(str(error)))
                try:
                    operation(page, row)
                    assert not errors, errors
                    row['pass'] = True
                except Exception:
                    row.update(**{'pass': False, 'error': traceback.format_exc()})
                try:
                    assert shutil.disk_usage(out).free >= args.minimum_free_gib * 1024**3
                    page.screenshot(path=str(out / (name + '.png')))
                finally:
                    context.close()
                rows.append(row)
                print(name, 'PASS' if row['pass'] else row['error'], flush=True)

            def graph(corpus):
                def check(page, row):
                    page.goto(base + 'graph-full-v6.html?corpus=' + corpus, wait_until='domcontentloaded')
                    page.wait_for_function("()=>document.body.dataset.graphReady==='true'", timeout=120000)
                    value = page.evaluate('async()=>{await ensureSlotCensus();return slotOverlayState.payload;}')
                    assert value['corpus'] == corpus and value['coverage']['complete'] and value['hidden_values_read'] is False
                    page.locator('#slots-menu > summary').click()
                    box = page.locator('#show-slot-overlay')
                    box.uncheck()
                    box.check()
                    row['node_count'] = page.evaluate('()=>state.panels.current.nodes.length')
                    assert row['node_count'] > 0
                    row['slots'] = value['coverage']['total_slots']
                return check
            if 'graph' in selected:
                for corpus in ('iran', 'cib', 'vietnam'):
                    run('graph-' + corpus, graph(corpus), mobile=corpus == 'cib')

            fixtures, traces = {}, {}
            if selected & {'walk', 'workbench'}:
                for key, entry in entries.items():
                    if not key.startswith('/api/narrative-v1/trace?'):
                        continue
                    params = {k: v[0] for k, v in parse_qs(urlsplit(key).query, keep_blank_values=True).items()}
                    trace = json.loads(reader.read(entry))
                    saved = next(r for r in report['cases'] if r['case']['case_id'] == params['case_id'])
                    if trace['reading_id'] != params['reading']:
                        assert params['reading'] == '' and saved['case']['task'] == 'redaction'
                        continue
                    traces.setdefault(params['case_id'], []).append(trace)
                    for path in trace['paths']:
                        steps = [next(s for s in trace['steps'] if s['id'] == identity) for identity in path['steps']]
                        true = [(i, n) for i, s in enumerate(steps) for n in s['nodes'] if n.get('is_graph_node') is True]
                        label = saved['case']['corpus'] + ('-graph' if true else '-source')
                        fixtures.setdefault(label, (params, saved, path, steps, true))

            def walk(fixture):
                params, saved, path, steps, true = fixture
                def check(page, row):
                    query = dict(corpus=saved['case']['corpus'], walk_case=params['case_id'], walk_config=params['config'],
                        walk_reading=params['reading'], walk_path=path['id'], **{k: params[k] for k in ('resource_id', 'registry_sha256', 'index_sha256')})
                    page.goto(base + 'graph-full-v6.html?' + urlencode(query), wait_until='domcontentloaded')
                    expect(page.get_by_test_id('kg-walk-reveal')).to_have_count(0)
                    page.wait_for_function("()=>document.querySelector('#saved-kg-walk')?.dataset.status==='ready'&&document.body.dataset.graphReady==='true'", timeout=120000)
                    boxes = page.locator('[data-walk-stage]')
                    assert boxes.count() == len(steps)
                    if true:
                        i, node = true[0]
                        boxes.nth(i).click()
                        page.wait_for_function("()=>document.querySelector('#saved-kg-walk')?.getAttribute('aria-busy')==='false'", timeout=120000)
                        page.locator('.walk-nodes > summary').click()
                        button = page.locator('[data-walk-node="' + node['id'] + '"]')
                        assert button.text_content() == node['label']
                        button.click()
                        page.wait_for_function("id=>state.panels.current.selected?.id===id&&state.panels.current.nodeMap.has(id)", arg=node['id'], timeout=120000)
                        assert page.locator('.walk-nodes').evaluate('n=>n.open')
                        row['actual_selected_id'] = node['id']
                    boxes.last.click()
                    expect(page.locator('.walk-current blockquote')).to_have_text([p['text'] for p in steps[-1]['source_refs']])
                    assert not page.locator('#study-guide-drawer').count()
                    row.update(source_only=not bool(true), opens_immediately=True)
                return check
            if 'walk' in selected:
                for label in ('iran-graph', 'cib-graph', 'cib-source', 'vietnam-source'):
                    if label in fixtures:
                        run('walk-' + label, walk(fixtures[label]), mobile='source' in label)

            if 'archive' in selected:
                def archive(page, row):
                    result, displays = validate_archive(site)
                    row.update(result, cases=[c['case']['case_id'] for c in displays])
                run('archived-study-exact-pins', archive)

            if 'study' in selected:
                def study_check(page, row):
                    reference, study = public_study(site)
                    cases = public_cases(site, study)
                    private_requests = []
                    page.on('request', lambda request: private_requests.append(request.url)
                        if '/phase/' in request.url or '/attempt0' in request.url or 'execution.json.gz' in request.url else None)
                    page.goto(base + 'swedish-study.html', wait_until='domcontentloaded')
                    page.wait_for_function("()=>document.body.dataset.studyReady==='true'", timeout=60000)
                    expect(page.locator('.study-badge')).to_contain_text('Reference')
                    expect(page.locator('.study-badge')).to_contain_text('Not given')
                    assert page.locator('input[type="checkbox"], [data-testid="origin-exception-ack"], [data-testid="open-saved-result"]').count() == 0
                    row.update(public_study_ref=reference, public_study_version=study['version'], cases=[])
                    for case in cases:
                        if 'window_arm' in case:
                            selector = page.get_by_test_id('study-window-select')
                            if selector.count():
                                selector.select_option(case['window_arm'])
                            else:
                                controls = page.locator('#window-controls button')
                                assert controls.count() == len(study['design']['window_arms'])
                                for index in range(controls.count()):
                                    controls.nth(index).click()
                                    if parse_qs(urlsplit(page.url).query).get('window') == [case['window_arm']]:
                                        break
                                else:
                                    raise AssertionError('No public control reaches this declared context arm')
                        tab = page.locator('[role="tab"][data-slot="' + case['position'] + '"]')
                        expect(tab).to_have_count(1)
                        tab.click()
                        expect(tab).to_have_attribute('aria-selected', 'true')
                        assert page.locator('#fact-list li').count() == len(case['facts'])
                        assert page.locator('#query-text mark').count() == case['case']['query'].count(case['case']['focal_marker'])
                        expected_readings = case['readings']
                        assert page.locator('#reading-select option').count() == len(expected_readings)
                        inspected = 0
                        for number, reading in enumerate(expected_readings):
                            page.select_option('#reading-select', str(number))
                            expected = reading['candidates']
                            expect(page.get_by_test_id('scoped-candidate')).to_have_count(len(expected))
                            assert page.locator('[data-testid="scoped-candidate"] .fill').all_text_contents() == [c['fill'] for c in expected]
                            if expected and expected[0].get('source_variants'):
                                variants = expected[0]['source_variants']
                                citations = [ref for variant in variants for ref in variant.get('sources', [])]
                                if citations:
                                    control = page.get_by_test_id('inspect-variants').first
                                    button_text = control.text_content()
                                    control.click()
                                    expect(page.locator('#source-dialog')).to_be_visible()
                                    if button_text == 'View sources':
                                        for citation in citations:
                                            expect(page.locator('#dialog-body')).to_contain_text(citation['text'])
                                    else:
                                        assert any(citation['text'] == button_text for citation in [*citations, *expected[0].get('sources', [])])
                                        expect(page.locator('#dialog-body')).to_contain_text(button_text)
                                    page.get_by_role('button', name='Close', exact=True).click()
                                    inspected += 1
                        archive = page.locator('#archive')
                        if archive.count() and archive.is_visible():
                            assert not archive.evaluate('element=>element.open')
                            archive.locator('summary').click()
                            for candidate in case.get('archived_lexical', {}).get('candidates', []):
                                expect(page.locator('#archive-results')).to_contain_text(candidate['fill'])
                            archive.locator('summary').click()
                        row['cases'].append(dict(case_id=case['case']['case_id'], window_arm=case.get('window_arm'),
                            position=case['position'], exact_sources_inspected=inspected,
                            execution_performed=case['execution_performed'], gold=None))
                    assert not private_requests, private_requests
                    row.update(unknown_reference=True, old_literal_counts_not_assumed=True)
                run('public-delegation-study', study_check, mobile=True)

            def workbench(saved):
                def check(page, row):
                    case = saved['case']
                    checksums = []
                    known_refs = []
                    active_params = None
                    for config, item in saved['configurations'].items():
                        params = dict(case_id=case['case_id'], config=config,
                            **{k: saved['resource_binding'][k] for k in ('resource_id', 'registry_sha256', 'index_sha256')})
                        condition = packet('/api/current/condition-v6', params)
                        assert condition['case'] == case and condition['resource_binding'] == saved['resource_binding']
                        display = condition['configurations'][config]
                        assert display['native_checkpoint'] == item['native_checkpoint']
                        native = packet('/api/current/native-v6', params)['native']
                        assert native['public_case'] == case
                        assert native['native_checksum'] == digest(native['result']) == display['native_checksum']
                        checksums.append(native['native_checksum'])
                        known_refs.extend(citation_refs(native['result']))
                        known_refs.extend(citation_refs(display.get('local_decisions_v65', {})))
                        active_params = params
                    page.goto(base + 'workbench-v6.html?' + urlencode(dict(case=case['case_id'])), wait_until='domcontentloaded')
                    page.get_by_test_id('evidence-map').wait_for(state='visible', timeout=90000)
                    assert page.locator('#page-error').is_hidden()
                    nav = page.locator('.workflow-nav').inner_text()
                    assert re.match(r'01\s+Input\s+02\s+Facts', nav), nav
                    assert not page.get_by_text('Open saved result', exact=True).count()
                    assert not page.get_by_text('Reveal all story answers', exact=True).count()
                    assert not page.locator('#retrieval-paths-v6 select, [data-testid="trace-path-target"]').count()
                    assert page.get_by_test_id('plan-atom').count() == len(display['plan']['atoms'])
                    fills = page.locator('[data-testid="candidate-card"] h3').all_text_contents()
                    assert len(fills) == len({text.casefold().strip() for text in fills}), 'Duplicate visible surfaces'
                    quotes = page.get_by_test_id('used-source-quote')
                    quote_rows = [(q.get_attribute('data-source-id'), q.locator('blockquote').text_content()) for q in quotes.all()]
                    witnesses = [*known_refs, *(ref for trace in traces.get(case['case_id'], []) for step in trace['steps'] for ref in step['source_refs'])]
                    for page_id, text in quote_rows:
                        assert any(ref['canonical_page_id'] == page_id and text in ref['text'] for ref in witnesses), 'UI quotation is outside saved native/decision/trace evidence'
                    inspected = False
                    if quote_rows:
                        source_id, quoted = quote_rows[0]
                        source = packet('/api/current/source-v6', dict(active_params, source_id=source_id))
                        source_page = source.get('page', source)
                        assert source_page['document_id'] != case['document_id'] and source_page['date'] < case['date']
                        assert digest(source_page['text']) == source_page.get('source_sha256', source_page.get('page_sha256'))
                        quotes.first.click()
                        page.locator('#detail-drawer[open] [data-testid="source-document"]').wait_for(state='visible', timeout=60000)
                        assert page.get_by_test_id('source-document').text_content() == source_page['text']
                        assert page.locator('#detail-drawer .transcript-segment').count() >= 1
                        if quoted != source_page['text']:
                            expect(page.locator('#detail-drawer .source-document mark')).not_to_have_count(0)
                            assert quoted in ''.join(page.locator('#detail-drawer .source-document mark').all_text_contents())
                        else:
                            expect(page.locator('#detail-drawer')).to_contain_text('entire segment')
                        page.locator('#detail-close').click()
                        inspected = True
                    row.update(case_id=case['case_id'], native_checksums=checksums, facts=page.get_by_test_id('plan-atom').count(),
                               used_quotes=len(quote_rows), exact_source_inspected=inspected, no_result_gates=True)
                    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+2'), 'Outer horizontal overflow'
                return check
            if 'workbench' in selected:
                for index, saved in enumerate(report['cases']):
                    run('workbench-' + str(index + 1).zfill(2), workbench(saved))
                run('workbench-mobile', workbench(report['cases'][0]), mobile=True)

            if 'live' in selected:
                def live(page, row):
                    requests = []
                    page.on('request', lambda request: requests.append(request.url))
                    page.goto(base + 'live.html', wait_until='networkidle')
                    expect(page.locator('#availability')).to_contain_text('unavailable')
                    expect(page.locator('#availability')).to_contain_text('GitHub Pages cannot execute')
                    assert page.locator('#run').is_disabled()
                    assert page.locator('#capability').input_value() == ''
                    assert page.locator('#capability').get_attribute('autocomplete') == 'off'
                    assert page.locator('#login-password').input_value() == ''
                    assert page.locator('#login-password').get_attribute('autocomplete') == 'off'
                    assert page.locator('input[name*="api_key" i],input[id*="api-key" i],input[id*="apikey" i]').count() == 0
                    assert not page.evaluate('()=>Boolean(window.PublicReplay)||localStorage.length||sessionStorage.length')
                    before = len(requests)
                    page.locator('#login-password').fill('sk-fixture-rejection-not-a-real-provider-key')
                    page.locator('#login-submit').click()
                    expect(page.locator('#availability')).to_contain_text('not a model API key')
                    assert page.locator('#login-password').input_value() == '' and len(requests) == before
                    page.locator('#connection > summary').click()
                    page.get_by_text('Advanced capability compatibility', exact=True).click()
                    page.locator('#capability').fill('sk-fixture-rejection-not-a-real-provider-key')
                    page.locator('#connect').click()
                    expect(page.locator('#availability')).to_contain_text('not a model API key')
                    assert page.locator('#capability').input_value() == '' and len(requests) == before
                    assert not any('/live-api/' in url or '/api.openai.com/' in url for url in requests)
                    csp = page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute('content')
                    connect = next(part.strip().split()[1:] for part in csp.split(';') if part.strip().startswith('connect-src '))
                    assert "'self'" in connect and '*' not in connect
                    assert all(value == "'self'" or re.fullmatch(r'http://127\.0\.0\.1:\d+', value) for value in connect), connect
                    row.update(honest_unavailable=True, password_login_no_provider_key=True, provider_key_rejected_before_transport=True,
                               automatic_backend_requests=False, browser_credential_storage=False, connect_src=connect)
                run('live-unconfigured', live, mobile=True)
            browser.close()
    finally:
        reader.close()
        http.shutdown()
        http.server_close()
        thread.join()
    result = dict(success=all(r['pass'] for r in rows) and not leaked and not external, cells=rows,
        leaked_api_requests=leaked, external_requests=external, managed_chromium_headless_shell=True,
        model_api_calls=0, native_executions=0, browser_closed=True,
        full_release_matrix=args.only is None, selected_groups=sorted(selected), expected_cases=args.expected_cases,
        installed_source_sha256='8b3d032043af69ec80e9a2033b789f80baec3a0ff1bdcb6f3610cb35a70dcc16')
    (out / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    if not result['success']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

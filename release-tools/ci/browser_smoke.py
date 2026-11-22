"""Managed-shell checks on the real installed candidate, without API backends."""
import argparse
import gzip
import json
from pathlib import Path
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--datasets-root', type=Path)
    parser.add_argument('--minimum-free-gib', type=int, choices=(3, 8), default=8,
                        help='Default CI reserve 8 GiB; explicit bounded-workstation option 3 GiB')
    args = parser.parse_args()
    site, out = args.site.resolve(), args.output.absolute()
    out.mkdir(parents=True, exist_ok=False)
    entries = json.loads((site / 'data/api-index.json').read_bytes())['entries']
    from same_repo import dataset
    for key, entry in entries.items():
        if entry.get('external_url'):
            dataset(key, entry)
    report = json.loads((site / 'data/report-v6.json').read_bytes())
    leaked, external, rows = [], [], []
    http = server(site, prefix='/nested/matryoshka-demo/', logs=leaked, datasets_root=args.datasets_root)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    origin = 'http://127.0.0.1:' + str(http.server_port)
    base = origin + '/nested/matryoshka-demo/'
    reader = Reader(site, out / 'smoke.sqlite3', minimum_free_bytes=args.minimum_free_gib * 1024**3)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            def run(name, operation, mobile=False):
                context = browser.new_context(viewport=dict(width=390,height=844) if mobile else dict(width=1440,height=1000), reduced_motion='reduce')
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
                page.screenshot(path=str(out / (name + '.png')))
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
            for corpus in ('iran','cib','vietnam'):
                run('graph-' + corpus, graph(corpus), mobile=corpus=='cib')
            fixtures = {}
            for key, entry in entries.items():
                if not key.startswith('/api/narrative-v1/trace?'):
                    continue
                params = {k:v[0] for k,v in parse_qs(urlsplit(key).query, keep_blank_values=True).items()}
                trace = json.loads(reader.read(entry))
                saved = next(r for r in report['cases'] if r['case']['case_id'] == params['case_id'])
                if trace['reading_id'] != params['reading']:
                    # Default aliases resolve to a named reading; UI links use its explicit ID.
                    assert params['reading'] == '' and saved['case']['task'] == 'redaction'
                    continue
                for path in trace['paths']:
                    steps = [next(s for s in trace['steps'] if s['id']==identity) for identity in path['steps']]
                    true = [(i,n) for i,s in enumerate(steps) for n in s['nodes'] if n.get('is_graph_node') is True]
                    label = saved['case']['corpus'] + ('-graph' if true else '-source')
                    fixtures.setdefault(label, (params, saved, path, steps, true))
            def walk(fixture):
                params, saved, path, steps, true = fixture
                def check(page, row):
                    query = dict(corpus=saved['case']['corpus'], walk_case=params['case_id'], walk_config=params['config'],
                        walk_reading=params['reading'], walk_path=path['id'], **{k:params[k] for k in ('resource_id','registry_sha256','index_sha256')})
                    page.goto(base + 'graph-full-v6.html?' + urlencode(query), wait_until='domcontentloaded')
                    expect(page.get_by_test_id('kg-walk-reveal')).to_be_visible(timeout=120000)
                    assert page.locator('[data-walk-stage]').count() == 0
                    page.get_by_test_id('kg-walk-reveal').click()
                    page.wait_for_function("()=>document.querySelector('#saved-kg-walk')?.dataset.status==='ready'&&document.body.dataset.graphReady==='true'",timeout=120000)
                    boxes = page.locator('[data-walk-stage]')
                    assert boxes.count() == len(steps)
                    if true:
                        i, node = true[0]
                        boxes.nth(i).click()
                        page.wait_for_function("()=>document.querySelector('#saved-kg-walk')?.getAttribute('aria-busy')==='false'", timeout=120000)
                        page.locator('.walk-nodes > summary').click()
                        button = page.locator('[data-walk-node="'+node['id']+'"]')
                        assert button.text_content() == node['label']
                        button.click()
                        page.wait_for_function("id=>state.panels.current.selected?.id===id&&state.panels.current.nodeMap.has(id)", arg=node['id'], timeout=120000)
                        assert page.locator('.walk-nodes').evaluate('n=>n.open')
                        row['actual_selected_id'] = node['id']
                    boxes.last.click()
                    assert page.locator('.walk-current blockquote').all_text_contents() == [p['text'] for p in steps[-1]['source_refs']]
                    assert not page.locator('#study-guide-drawer').count()
                    row['source_only'] = not bool(true)
                return check
            for label in ('iran-graph','cib-graph','cib-source','vietnam-source'):
                if label in fixtures:
                    run('walk-' + label, walk(fixtures[label]), mobile='source' in label)
            def swedish(page, row):
                study = json.loads((site / 'swedish-scoped-study-v04.json').read_bytes())
                assert study['execution_performed'] is True and study['canonical_native_run'] is False and study['gold'] is None
                private_requests = []
                page.on('request', lambda request: private_requests.append(request.url)
                        if '/phase/' in request.url or '/attempt0' in request.url or 'execution.json.gz' in request.url else None)
                page.goto(base + 'swedish-study.html', wait_until='domcontentloaded')
                page.wait_for_function("()=>document.body.dataset.studyReady==='true'", timeout=60000)
                assert page.get_by_role('tab').count() == 2
                assert page.locator('input[type="checkbox"], [data-testid="origin-exception-ack"], [data-testid="open-saved-result"]').count() == 0
                expect(page.locator('.study-badge')).to_contain_text('Reference unknown')
                row['queries'] = []
                for index, label in enumerate(('First query', 'Second query')):
                    display = json.loads((site / study['cases'][index]['path']).read_bytes())
                    completion = json.loads((site / study['public_completions'][index]['path']).read_bytes())
                    assert display['execution_performed'] is True and display['canonical_native_run'] is False and display['gold'] is None
                    assert display['execution_version'] == 'narrative-scoped-source-study-execution/3'
                    assert display['coordinate_policy_version'] == 'declared-producer-job-local-coordinates/3'
                    assert completion['public_display_ref'] == study['cases'][index] and completion['gold'] is None
                    page.get_by_role('tab', name=label, exact=True).click()
                    expect(page.locator('#tab-' + display['position'])).to_have_attribute('aria-selected', 'true')
                    assert 'policy=S2' in page.url
                    selected = next((i for i,r in enumerate(display['readings']) if r['reading']['outer_family'] == 'adjectival'), 0)
                    expect(page.locator('#reading-select')).to_have_value(str(selected))
                    expected = display['readings'][selected]['candidates']
                    expect(page.get_by_test_id('scoped-candidate')).to_have_count(len(expected))
                    assert page.locator('[data-testid="scoped-candidate"] .fill').all_text_contents() == [c['fill'] for c in expected]
                    assert page.locator('#fact-list li').count() == len(display['facts'])
                    assert page.locator('#query-text mark').count() == 1
                    assert page.locator('#query-text').inner_text().count('[MASKED]') == 3
                    inspected = False
                    for number, reading in enumerate(display['readings']):
                        if not reading['candidates']:
                            continue
                        page.select_option('#reading-select', str(number))
                        page.get_by_test_id('inspect-variants').first.click()
                        expect(page.locator('#source-dialog')).to_be_visible()
                        citation = reading['candidates'][0]['source_variants'][0]['sources'][0]
                        expect(page.locator('#dialog-body')).to_contain_text(citation['text'])
                        page.get_by_role('button', name='Close', exact=True).click()
                        inspected = True
                        break
                    assert inspected, 'These pinned runs have source-grounded candidates to inspect'
                    archive = page.locator('#archive')
                    assert not archive.evaluate('element=>element.open')
                    archive.locator('summary').click()
                    for candidate in display['archived_lexical']['candidates']:
                        expect(page.locator('#archive-results')).to_contain_text(candidate['fill'])
                    archive.locator('summary').click()
                    row['queries'].append(dict(position=display['position'], actual_execution=True,
                        canonical_native_run=False, gold=None, exact_source_inspected=inspected, archive_separate=True))
                assert not private_requests, private_requests
                row['default_policy'] = 'S2'
                row['explicit_acknowledgment'] = False
                row['unknown_gold'] = True
            run('swedish-S2', swedish, mobile=True)
            browser.close()
    finally:
        reader.close()
        http.shutdown()
        http.server_close()
        thread.join()
    result = dict(success=all(r['pass'] for r in rows) and not leaked and not external, cells=rows,
        leaked_api_requests=leaked, external_requests=external, managed_chromium_headless_shell=True,
        model_api_calls=0, native_executions=0, browser_closed=True)
    (out / 'receipt.json').write_text(json.dumps(result, indent=2)+'\n')
    if not result['success']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

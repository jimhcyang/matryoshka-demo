"""Managed-shell checks on the real installed candidate, without API backends."""
import argparse
import gzip
import json
from pathlib import Path
import sys
import threading
import traceback
from urllib.parse import parse_qs, urlencode, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from serve_static import server
from fragment_reader import Reader
from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--datasets-root', type=Path)
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
    reader = Reader(site, out / 'smoke.sqlite3')
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
                page.goto(base + 'swedish-study.html?policy=S2', wait_until='domcontentloaded')
                page.wait_for_function("()=>document.body.dataset.studyReady==='true'", timeout=60000)
                card = page.locator('[data-policy=S2]')
                expect(card.get_by_test_id('open-saved-result')).to_be_disabled()
                card.get_by_test_id('origin-exception-ack').check()
                card.get_by_test_id('open-saved-result').click()
                expect(card.get_by_test_id('saved-candidate').first).to_be_visible()
                row['explicit_acknowledgment'] = True
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

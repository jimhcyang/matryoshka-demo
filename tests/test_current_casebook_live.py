"""Opt-in smoke of the installed current casebook, not an old export or Pages.

Uses the existing nested static-site and managed Chromium fixtures. External
datasets, if requested, are the exact manifest-listed local wire bytes, not
synthetic graph data. Nothing here runs a model or changes installed files.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

import pytest

from test_current_site_browser import actual_site, managed_browser, actual_page


pytestmark=pytest.mark.skipif(os.environ.get('MATRYOSHKA_TEST_CURRENT_CASEBOOK')!='1',
    reason='Await lead current-site install, then set MATRYOSHKA_TEST_CURRENT_CASEBOOK=1')
PACKAGE=Path(__file__).resolve().parents[1]
CIB_RESOURCE='cib_resource_623c60e1e128944377f0'
CIB_GRAPH='graph_2e1f8d6c2443987c'
CIB_HIERARCHY='hierarchy_dcfb5058b0e6e571'
ARIAS='palette_v5_redaction_window_5cf22a8cf2b91a304dd7'
BIEN='current_h_vietnam_bien_hoa_partial_v02'
SOURCE_NOTICE='Original-source transcription is not attached in this temporary preview. The saved question and eligible evidence remain inspectable.'

# Observe the installed replay's returned status; return the same Response.
# Its API is virtual, so failures need not appear as network HTTP responses.
OBSERVER='''(()=>{
  const audit=window.__casebookSmoke={hooked:false,calls:[],pending:0};
  function hook(){
    if(audit.hooked||!window.PublicReplay||window.fetch!==window.PublicReplay.fetch)return;
    const original=window.fetch;audit.hooked=true;
    window.fetch=async function(...args){
      const input=args[0] instanceof Request?args[0].url:String(args[0]);audit.pending++;
      try{const response=await original.apply(this,args);
        audit.calls.push({url:new URL(input,location.href).href,status:response.status,replay:response.headers.get('X-Public-Replay')});
        return response;
      }catch(error){audit.calls.push({url:new URL(input,location.href).href,error:String(error)});throw error;}
      finally{audit.pending--;}
    };
  }
  new MutationObserver(hook).observe(document,{childList:true,subtree:true});
  document.addEventListener('load',hook,true);hook();
})();'''


def sha(raw):return hashlib.sha256(raw).hexdigest()


@pytest.fixture(scope='module')
def installed_current(actual_site):
    site=actual_site['site'];publication=actual_site['publication']
    raw=(site/'data/report-v6.json').read_bytes();report=json.loads(raw)
    assert publication['version']=='public-current-casebook/1', 'Current UI is not installed; do not certify the old site'
    assert report['version']=='current-workbench-publication/1'
    assert publication['ref']['sha256']==sha(raw)
    assert publication['canonical_cib_resource']==CIB_RESOURCE
    assert publication['native_outputs_modified']is False and publication['inference_api_calls']==0
    rows={row['case']['case_id']:row for row in report['cases']}
    assert len(rows)==len(report['cases'])==15
    assert Counter(row['case']['task']for row in rows.values())==dict(hypothesis=5,reconstruction=5,redaction=5)
    assert set(publication['case_ids'])==set(rows) and len(publication['case_ids'])==15
    assert ARIAS in rows and BIEN in rows
    for row in rows.values():
        assert row['current_resource_execution']is True and row['configurations']
        if row['case']['corpus']=='cib':
            binding=row['resource_binding']
            assert binding['resource_id']==CIB_RESOURCE
            assert binding['graph_id']==CIB_GRAPH and binding['hierarchy_id']==CIB_HIERARCHY
    releases=[r for r in actual_site['dataset']['graph_releases'].values()if r['corpus']=='cib'and r['role']=='current-exploration']
    assert len(releases)==1 and releases[0]['source_resource']['id']==CIB_RESOURCE
    assert releases[0]['graph_id']==CIB_GRAPH and releases[0]['hierarchy_id']==CIB_HIERARCHY
    refs=rows[BIEN].get('origin_refs')
    refs=refs.get('by_arm',{}).get('llm_readings')if isinstance(refs,dict)and 'by_arm'in refs else refs
    assert not refs or refs.get('masked')is None, 'This smoke specifically expects the declared unattached Bien Hoa preview'
    assert 'llm_readings'in rows[BIEN]['configurations']
    snapshots={name:sha((site/name).read_bytes())for name in ['publication.json','data/api-index.json','data/report-v6.json','workbench-v6.js']}
    configured=os.environ.get('MATRYOSHKA_CURRENT_CASEBOOK_QA_DIR')
    output=Path(configured)if configured else PACKAGE/'tests/artifacts/current-casebook'/(
        datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+str(os.getpid()))
    output.mkdir(parents=True,exist_ok=False)
    yield dict(report=report,rows=rows,report_sha256=sha(raw),snapshots=snapshots,output=output)
    for name,pin in snapshots.items():
        assert sha((site/name).read_bytes())==pin, 'Installed publication changed mid-receipt: '+name


def choose(page,cid):
    catalog=page.locator('#catalog-browser')
    if not catalog.evaluate('n=>n.open'):catalog.locator(':scope > summary').click()
    page.locator('[data-case="'+cid+'"]').click()


def ranked_items(page):
    return page.locator('.candidate-list article.candidate').evaluate_all('''rows=>rows.map(row=>({
      id:row.dataset.proposalId,rankAndFill:row.querySelector('.candidate-select')?.textContent}))''')


def logical_path(url):
    path=urlsplit(url).path
    marker=path.find('/api/')
    return path[marker:]if marker>=0 else path


def test_installed_current_home_casebook_arias_and_missing_bien_source(actual_page,actual_site,installed_current):
    from playwright.sync_api import expect

    page,width,errors,blocked,fetched=actual_page
    installed=installed_current;output=installed['output'];rows=installed['rows']
    events=[];failures=[];receipt=dict(status='FAIL',width=width,scope='Installed nested static site; real saved packets; no backend or model')
    page.add_init_script(OBSERVER)
    page.on('response',lambda r:events.append(dict(url=r.url,status=r.status)))
    page.on('requestfailed',lambda r:failures.append(dict(url=r.url,failure=r.failure)))
    try:
        page.goto(actual_site['base'],wait_until='domcontentloaded')
        destination=page.locator('a.destination.workbench')
        expect(destination).to_be_visible()
        home_url=page.url
        assert urljoin(page.url,destination.get_attribute('href'))==actual_site['base']+'workbench-v6.html'
        page.screenshot(path=str(output/f'home-{width}.png'),animations='disabled')
        destination.click()
        expect(page).to_have_url(re.compile(re.escape(actual_site['base'])+r'workbench-v6\.html(?:\?|$)'))
        expect(page.get_by_test_id('local-verdict-panel')).to_be_visible()
        expect(page.locator('#page-error')).to_be_hidden()
        page.wait_for_function('()=>window.__casebookSmoke?.hooked===true')
        health=page.evaluate('async()=>await(await fetch("/api/health")).json()')
        assert health['service']=='current-resource-workbench' and health['static_publication']is True
        assert health['live_inference']is False and health['api_calls']==0 and health['cases']==15
        assert health['report_ref']==dict(path='data/report-v6.json',sha256=installed['report_sha256'])
        assert health['source_report_ref']==installed['report']['source_report_ref']
        expect(page.locator('#arm-select')).to_have_value('A')
        expect(page.locator('#home-tab')).to_have_attribute('href',actual_site['base']+'index.html')
        if not page.locator('#catalog-browser').evaluate('n=>n.open'):
            page.locator('#catalog-browser > summary').click()
        page.locator('#case-show').select_option('all')
        cards=page.locator('#case-list [data-case]')
        expect(cards).to_have_count(15)
        assert set(cards.evaluate_all('nodes=>nodes.map(n=>n.dataset.case)'))==set(rows)
        receipt.update(publication_sha256=installed['snapshots']['publication.json'],report_sha256=installed['report_sha256'],
            api_index_sha256=installed['snapshots']['data/api-index.json'],health=health,task_counts=dict(Counter(r['case']['task']for r in rows.values())),
            canonical_cib_resource=CIB_RESOURCE,home_url=home_url)
        page.screenshot(path=str(output/f'workbench-15-cases-{width}.png'))
        if width==1440:
            receipt['desktop_arm_a_sweep']=[]
            for cid,row in rows.items():
                receipt['desktop_arm_a_active_case']=cid
                assert 'llm_readings'in row['configurations'], 'No other method may substitute for A'
                choose(page,cid)
                expect(page.locator('#arm-select')).to_have_value('A')
                expect(page.get_by_test_id('query-text')).to_have_text(row['case']['query'],timeout=120_000)
                verdict=page.get_by_test_id('local-verdict-title')
                expect(verdict).to_be_visible(timeout=120_000)
                bar=page.get_by_test_id('verdict-count-bar')
                expect(bar).to_be_visible(timeout=120_000)
                segments=bar.locator(':scope > span').count()
                assert segments>0 and verdict.inner_text().strip(), 'Saved local decision must be ready, not a placeholder'
                expect(page.locator('#page-error')).to_be_hidden()
                page.wait_for_function('()=>window.__casebookSmoke.pending===0',timeout=120_000)
                receipt['desktop_arm_a_sweep'].append(dict(case_id=cid,task=row['case']['task'],
                    query=row['case']['query'],verdict=verdict.inner_text(),decision_segments=segments))
            assert len(receipt['desktop_arm_a_sweep'])==15
            flow_calls=[c for c in page.evaluate('window.__casebookSmoke.calls')if logical_path(c['url'])=='/api/current/flow-v6']
            assert flow_calls and all(parse_qs(urlsplit(c['url']).query).get('limit')==['256']for c in flow_calls), 'Smoke must not expand into larger projections'
            receipt.pop('desktop_arm_a_active_case')
        choose(page,ARIAS)
        focal=page.get_by_test_id('focal-mask');expect(focal).to_be_enabled()
        expect(focal).to_have_text(rows[ARIAS]['case']['focal_marker'])
        expect(page.get_by_test_id('query-text')).to_have_text(rows[ARIAS]['case']['query'])
        expect(page.get_by_test_id('origin-reveal')).to_have_text('Explicitly reveal focal origin reference')
        expect(page.get_by_test_id('reference-key')).to_have_count(0)
        expect(page.get_by_test_id('candidate-grade')).to_have_count(0)
        initial_calls=page.evaluate('window.__casebookSmoke.calls')
        assert not[c for c in initial_calls if logical_path(c['url'])=='/api/current/origin-v63'and parse_qs(urlsplit(c['url']).query).get('reveal_focal')==['1']]
        map_url=page.locator('#graph-tab').get_attribute('href');map_query=parse_qs(urlsplit(map_url).query)
        assert map_query['corpus']==['cib'] and map_query['resource_id']==[CIB_RESOURCE]
        assert 'revision'not in map_query and 'graph_revision'not in map_query
        before_rank=ranked_items(page);assert before_rank
        before_verdict=page.get_by_test_id('local-verdict-panel').text_content()
        focal.evaluate('n=>n.scrollIntoView({block:"center"})');before_y=focal.bounding_box()['y']
        positions=[]
        for cycle in range(2):
            focal.click();expect(focal).to_have_text('like Harmodio Arias')
            expect(focal).to_have_attribute('aria-pressed','true')
            expect(page.get_by_test_id('origin-reveal')).to_have_text('Hide focal origin reference')
            expect(page.get_by_test_id('reference-key')).to_contain_text('like Harmodio Arias')
            page.wait_for_timeout(120);positions.append(dict(cycle=cycle,revealed_y=focal.bounding_box()['y']))
            assert abs(positions[-1]['revealed_y']-before_y)<4
            assert ranked_items(page)==before_rank
            if cycle==0:page.screenshot(path=str(output/f'arias-revealed-{width}.png'))
            focal.click();expect(focal).to_have_text(rows[ARIAS]['case']['focal_marker'])
            expect(focal).to_have_attribute('aria-pressed','false')
            expect(page.get_by_test_id('origin-reveal')).to_have_text('Explicitly reveal focal origin reference')
            expect(page.get_by_test_id('reference-key')).to_have_count(0)
            expect(page.get_by_test_id('candidate-grade')).to_have_count(0)
            assert not page.locator('#detail-body').text_content()
            page.wait_for_timeout(120);positions[-1]['remasked_y']=focal.bounding_box()['y']
            assert abs(positions[-1]['remasked_y']-before_y)<4
            assert ranked_items(page)==before_rank
        expect(page.get_by_test_id('query-text')).to_have_text(rows[ARIAS]['case']['query'])
        assert page.get_by_test_id('local-verdict-panel').text_content()==before_verdict
        receipt['arias']=dict(rank_snapshot=before_rank,initial_y=before_y,cycles=positions,map_url=map_url)
        page.screenshot(path=str(output/f'arias-remasked-{width}.png'))
        choose(page,BIEN)
        expect(page.get_by_test_id('local-verdict-panel')).to_be_visible()
        expect(page.get_by_test_id('query-text')).to_have_text(rows[BIEN]['case']['query'])
        expect(page.get_by_test_id('origin-panel')).to_contain_text(SOURCE_NOTICE)
        expect(page.get_by_test_id('origin-transcription')).to_have_count(0)
        expect(page.locator('#page-error')).to_be_hidden()
        page.wait_for_function('()=>window.__casebookSmoke.pending===0')
        calls=page.evaluate('window.__casebookSmoke.calls');receipt['logical_replay_calls']=calls
        assert not[c for c in calls if logical_path(c['url'])=='/api/current/origin-v63'and parse_qs(urlsplit(c['url']).query).get('case_id')==[BIEN]]
        assert not[c for c in calls if c.get('status',200)>=400 or c.get('error')]
        assert not[e for e in events if e['status']>=400]
        assert actual_site['backend']==[] and errors==[] and blocked==[]
        assert not[f for f in failures if f['failure']!='net::ERR_ABORTED'],failures
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2')
        receipt['external_datasets']=[]
        by_path={r['path']:r for r in actual_site['dataset']['files']}
        for url in sorted(set(fetched)):
            path=actual_site['allowed'][url];relative=path.relative_to(PACKAGE).as_posix();pin=by_path[relative]['wire_sha256']
            assert sha(path.read_bytes())==pin
            receipt['external_datasets'].append(dict(url=url,path=relative,wire_sha256=pin,mode='Exact manifest-listed local bytes, not remote-CORS certification'))
        receipt.update(status='PASS',bien_origin_api_requests=0,backend_network_requests=0)
        page.get_by_test_id('origin-panel').evaluate('n=>n.scrollIntoView({block:"center"})')
        page.screenshot(path=str(output/f'bien-unattached-{width}.png'))
    except Exception as error:
        receipt['error']=str(error);raise
    finally:
        receipt.update(network_responses=events,request_failures=failures,page_errors=list(errors),blocked_external=list(blocked),backend_network=list(actual_site['backend']))
        try:
            receipt.setdefault('logical_replay_calls',page.evaluate('()=>window.__casebookSmoke?.calls||[]'))
            page.screenshot(path=str(output/f'final-{width}.png'))
        finally:
            (output/f'receipt-{width}.json').write_text(json.dumps(receipt,indent=2)+'\n')


def test_current_cib_saved_guide_and_source_use_current_map(actual_page,actual_site,installed_current):
    from playwright.sync_api import expect
    sys.path.insert(0,str(PACKAGE/'tools'))
    from pack_graphs import Reader
    page,width,*_=actual_page
    key=None
    for candidate_key,entry in actual_site['index']['entries'].items():
        query=parse_qs(urlsplit(candidate_key).query)
        if not(candidate_key.startswith('/api/current/guide-v6?')and query.get('case_id')==[ARIAS]
            and query.get('config')==['llm_readings']):continue
        path=actual_site['site']/entry['path']
        packet=json.loads(b''.join(Reader(path.parent,json.loads(path.read_bytes())).iter_asset(entry['asset'])))
        route=packet['route']
        # Hierarchy-only witnesses legitimately have no source quotation.
        if any(route.get(field)for field in ('citations','sources','source_quotes'))or any(h.get('citations')for h in route.get('hops',[])):
            key=candidate_key;break
    assert key is not None,'A source-handoff check requires a saved quoted route, not an invented quotation'
    params={k:v[0]for k,v in parse_qs(urlsplit(key).query,keep_blank_values=True).items()}
    selection=dict(corpus='cib',guide_case=params['case_id'],guide_arm=params['config'],
        guide_reading=params['reading'],guide_candidate=params['candidate_id'],guide_route=params['route_index'],
        **{k:params[k]for k in ('resource_id','registry_sha256','index_sha256')})
    page.goto(actual_site['base']+'graph-full-v6.html?'+urlencode(selection),wait_until='domcontentloaded')
    try:
        page.wait_for_function("document.querySelector('.graph-grid [role=alert]') || state.guideError || (state.guidePath?.packet && state.guideOverlay?.version==='current-context-inspection/1')",timeout=20000)
    except Exception:
        diagnostic=page.evaluate("({purpose:document.querySelector('#purpose')?.textContent,guideError:state.guideError,hasGuide:!!state.guidePath,overlayVersion:state.guideOverlay?.version,guide:document.querySelector('#retrieval-path-guide')?.innerText,requests:performance.getEntriesByType('resource').map(r=>r.name).slice(-12)})")
        pytest.fail(json.dumps(diagnostic))
    alerts=page.locator('.graph-grid [role=alert]').all_text_contents()
    if alerts:page.screenshot(path=str(installed_current['output']/f'current-cib-guide-failure-{width}.png'))
    assert alerts==[],alerts
    assert page.evaluate('state.guideError')is None,page.evaluate('state.guideError')
    assert page.evaluate('refreshBinding.graph_run_id')==CIB_GRAPH
    assert page.evaluate('refreshBinding.hierarchy_run_id')==CIB_HIERARCHY
    assert page.evaluate('state.guidePath.packet.resource_binding.resource_id')==CIB_RESOURCE
    assert page.evaluate('state.guidePath.packet.case_id')==ARIAS
    assert 'Saved study graph'not in page.locator('#exploration-scope').inner_text()
    page.locator('#retrieval-path-guide details > summary').click()
    page.locator('[data-guide-source]').click(timeout=15000)
    mark=page.locator('#study-guide-drawer mark')
    expect(mark).to_be_visible()
    assert mark.inner_text().strip()
    assert 'Verified original eligible source' in page.locator('.study-proof-status').inner_text()
    assert page.locator('#study-guide-drawer [role=alert]').count()==0
    page.screenshot(path=str(installed_current['output']/f'current-cib-guide-source-{width}.png'))

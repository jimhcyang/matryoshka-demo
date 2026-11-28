"""Proposed fresh saved CI. No model calls, legacy native overrides or result edits."""
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import urlencode

SHA = re.compile(r'[a-f0-9]{64}')


def _json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            assert key not in result, 'Duplicate JSON key'
            result[key] = value
        return result
    def finite(token):
        value = float(token)
        assert math.isfinite(value), 'Nonfinite JSON'
        return value
    return json.loads(raw, object_pairs_hook=pairs, parse_float=finite,
        parse_constant=lambda _: (_ for _ in ()).throw(AssertionError('Nonfinite JSON')))


def _bytes(site, ref, kind):
    assert type(ref) is dict and set(ref) == {'path', 'sha256', 'bytes'}
    assert isinstance(ref['sha256'], str) and SHA.fullmatch(ref['sha256'])
    assert type(ref['bytes']) is int and 0 < ref['bytes'] <= (24 if kind == 'wire' else 8) * 1024**2
    name = ref['path']
    assert isinstance(name, str)
    if kind == 'report':
        assert name == 'data/report-v6.json'
    elif kind == 'code':
        assert name in {'live-result-adapter.js', 'workbench-live-source.js'}
    else:
        assert name == 'data/fresh-saved-v1/' + kind + '/' + ref['sha256'] + '.json'
    path = (site / name).resolve()
    assert path.is_relative_to(site.resolve()) and path.is_file() and not (site / name).is_symlink()
    raw = path.read_bytes()
    assert len(raw) == ref['bytes'] and hashlib.sha256(raw).hexdigest() == ref['sha256'], name
    return raw


def read_publication(site, report):
    """Actual refs-only catalog, never executing JS or inferring a newer result."""
    site = Path(site).resolve()
    path = site / 'workbench-fresh-publication-catalog.js'
    if not path.exists():
        return {'enabled': False, 'entries': [], 'by_case': {}}
    raw = path.read_bytes()
    assert len(raw) <= 16384
    text = raw.decode('utf-8')
    # Accept the exact old inert two-export literal, not executable JS expressions.
    legacy = re.fullmatch(r"export const manifestRef\s*=\s*null;\s*export const reportRef\s*=\s*Object\.freeze\(\{path:'data/report-v6.json',sha256:'([a-f0-9]{64})',bytes:([1-9][0-9]*)\}\);\s*", text)
    if legacy:
        _bytes(site, {'path': 'data/report-v6.json', 'sha256': legacy[1], 'bytes': int(legacy[2])}, 'report')
        return {'enabled': False, 'entries': [], 'by_case': {}, 'catalog_sha256': hashlib.sha256(raw).hexdigest()}
    statements = text.strip().splitlines()
    assert len(statements) == 3, 'Fresh catalog requires exact three refs-only exports'
    refs = {}
    for statement in statements:
        match = re.fullmatch(r'export const (manifestRef|reportRef|secondaryCatalogRef)\s*=\s*(null|Object\.freeze\((.+)\));', statement)
        assert match and match[1] not in refs, 'Unexpected executable catalog content'
        refs[match[1]] = None if match[2] == 'null' else _json(match[3])
    assert set(refs) == {'manifestRef', 'reportRef', 'secondaryCatalogRef'}
    base_raw = _bytes(site, refs['reportRef'], 'report')
    assert _json(base_raw) == report, 'Fresh catalog binds another immutable base report'
    if refs['manifestRef'] is None:
        assert refs['secondaryCatalogRef'] is None
        return {'enabled': False, 'entries': [], 'by_case': {}, 'catalog_sha256': hashlib.sha256(raw).hexdigest()}
    manifest = _json(_bytes(site, refs['manifestRef'], 'publications'))
    assert manifest['version'] in {'fresh-saved-publication/1', 'fresh-saved-publication/2'}
    assert manifest['status'] == 'APPROVED_COMPLETED_RESULTS' and manifest['fixture_only'] is False
    assert manifest['scope'] == 'diagnostic_demo_with_declared_limitations'
    assert manifest['no_native_or_old_grade_rewrite'] is True and manifest['benchmark_accuracy_claimed'] is False
    assert manifest['base_report_ref'] == refs['reportRef']
    secondary = refs['secondaryCatalogRef']
    assert manifest.get('secondary_catalog_ref') == secondary
    assert (manifest['version'] == 'fresh-saved-publication/2') == (secondary is not None)
    if secondary:
        _bytes(site, secondary, 'publications')
    for field in ['adapter_ref', 'receiver_ref']:
        _bytes(site, manifest[field], 'code')
    entries = manifest['entries']
    assert isinstance(entries, list) and 0 < len(entries) <= 64
    ids = [entry['case']['case_id'] for entry in entries]
    assert len(ids) == len(set(ids)) and len({e['original_case_id'] for e in entries}) == len(entries)
    for entry in entries:
        for field, kind in [('wire_ref', 'wire'), ('origin_ref', 'origins'),
            ('original_origin_ref', 'origins'), ('approval_ref', 'approvals')]:
            _bytes(site, entry[field], kind)
        assert SHA.fullmatch(entry['source_method_sha256']) and SHA.fullmatch(entry['query_sha256'])
    return {'enabled': True, 'refs': refs, 'entries': entries, 'by_case': dict(zip(ids, entries)),
        'catalog_sha256': hashlib.sha256(raw).hexdigest(), 'manifest_sha256': refs['manifestRef']['sha256']}


def cell_matrix(report, inventory):
    base_ids = [r['case']['case_id'] for r in report['cases']]
    assert len(base_ids) == len(set(base_ids))
    fresh_ids = [e['case']['case_id'] for e in inventory['entries']]
    extras = [case_id for case_id in fresh_ids if case_id not in base_ids]
    desktop = {case_id: 'workbench-' + str(i + 1).zfill(2) for i, case_id in enumerate(base_ids)}
    desktop.update({case_id: 'fresh-workbench-extra-' + str(i + 1).zfill(2) for i, case_id in enumerate(extras)})
    mobile = {case_id: 'fresh-workbench-mobile-' + str(i + 1).zfill(2) for i, case_id in enumerate(fresh_ids)}
    historical = [e['case']['case_id'] for e in inventory['entries'] if e.get('original_catalog_kind') == 'HISTORICAL_RECOVERY_TEN']
    archives = {case_id: 'fresh-historical-archive-' + str(i + 1).zfill(2) for i, case_id in enumerate(historical)}
    return {'version': 'fresh-saved-ci-matrix/1', 'base_case_ids': base_ids, 'fresh_case_ids': fresh_ids,
        'fresh_nonbase_case_ids': extras, 'desktop_cells': desktop, 'fresh_mobile_cells': mobile,
        'historical_archive_cells': archives,
        'expected_fresh_cells': [desktop[i] for i in fresh_ids] + list(mobile.values()) +
            (['workbench-mobile'] if base_ids and base_ids[0] in fresh_ids else []),
        'expected_additional_cells': [desktop[i] for i in extras] + list(mobile.values()) + list(archives.values()),
        'required_fresh_groups': ['workbench'] + (['archive'] if archives else []),
        'base_native_transport_unchanged': True, 'fresh_manifest_required_for_release': bool(fresh_ids),
        'expected_case_checks': [{'case_id': i, 'desktop_cell': desktop[i], 'fresh': i in fresh_ids} for i in [*base_ids, *extras]]}


def archive_url(base, case_id):
    return base + 'workbench-v6.html?' + urlencode({'recovery': case_id, 'historical': '1'})


REPLAY = r'''async ({entry,refs})=>{
 const must=(v,t)=>{if(!v)throw Error('Fresh CI: '+t);},stable=v=>v&&typeof v==='object'?
   Array.isArray(v)?v.map(stable):Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
 const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b)),q=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
 const catalog=await import('./workbench-fresh-publication-catalog.js?v=20261128-polish1');
 for(const key of ['manifestRef','reportRef','secondaryCatalogRef'])must(same(catalog[key]??null,refs[key]??null),'catalog ref drift '+key);
 must(typeof PublicReplay.staticBytes==='function','closed static transport missing');
 const F=await import('./workbench-fresh-saved.js?v=20261128-polish1');
 const publication=await F.loadFreshPublication({...refs,base:location.href,fetchBytes:(r,o)=>PublicReplay.staticBytes(r,o)});
 const declared=publication.entries.find(e=>e.case.case_id===entry.case.case_id);
 must(declared&&same(declared,entry),'exact approved fresh entry missing');
 const input=await F.loadFreshSavedInput(entry.case.case_id,{publication});F.assertLoadedFreshInput(input);
 const p=F.freshSavedPacket(input),root=q('#case-view');
 must(root?.dataset.sourceMethodSha===entry.source_method_sha256&&root.dataset.sourceRunId===entry.run_id,'main mount uses another run/method');
 must(p.run_id===entry.run_id&&p.source_method.sha256===entry.source_method_sha256&&same(input.inputCase,entry.case),'packet identity differs');
 must(!new URL(location.href).searchParams.has('live_run'),'static mount entered authenticated Live route');
 must(q('#stage-01 [data-testid=query-text]')?.dataset.nativeText===entry.case.query,'executed query changed');
 const S=await import('./workbench-live-source.js?v=20261128-polish1'),selected=q('[data-testid=plan-reading-select]')?.value;
 const data=S.normalizeLiveSourceMethod(p.source_method_handle,{selectedReadingId:selected||undefined}),m=p.source_method;
 must(q('[data-testid=local-verdict-title]')?.textContent===data.summary.title,'fresh summary replaced');
 const facts=all('#stage-02 [data-testid=plan-atom]');
 must(facts.length===data.facts.length&&facts.every((f,i)=>f.dataset.atomId===data.facts[i].id),'exact fact IDs/order differ');
 const asciiLower=s=>s.replace(/[A-Z]/g,c=>c.toLowerCase());
 facts.forEach((f,i)=>must(asciiLower(f.querySelector('p')?.textContent||'')===asciiLower(data.facts[i].text),'fact text differs'));
 let branch=data,cardRows;
 if(data.task==='redaction'){
   const ids=m.readings.map(b=>b.reading.id),select=q('[data-testid=plan-reading-select]');
   must(select&&same([...select.options].map(o=>o.value),ids)&&ids.includes(selected),'changed declared reading inventory');
   const original=m.readings.find(b=>b.reading.id===selected);
   cardRows=all('#stage-05 [data-testid=standard-candidate]').filter(n=>!n.closest('.sw-reserves'));
   const expected=data.candidates.slice(0,5);
   must(cardRows.length===expected.length&&same(original.top5_ids,expected.map(c=>c.id)),'fresh top5 inventory differs');
   cardRows.forEach((card,i)=>{const c=expected[i],raw=original.candidates[i];
     must(c.id===raw.id&&c.fill===raw.fill&&c.rank===raw.rank&&c.priority===raw.priority_index,'normalizer changed raw candidate');
     must(card.dataset.candidateId===raw.id&&card.querySelector('h3')?.textContent===raw.fill,'fill/order differs');
     must(card.querySelector('.sw-fact-label')?.textContent==='#'+raw.rank,'rank differs');
     must(card.querySelector('.sw-score-value')?.textContent===raw.priority_index.toFixed(4),'priority four decimals differ');
     must(card.querySelector('.sw-result-label')?.textContent===c.label,'source appraisal label differs');});
 }else{
   cardRows=all('#stage-05 [data-testid=result-atom]');must(cardRows.length===m.atoms.length,'source result inventory differs');
   cardRows.forEach((card,i)=>{const raw=m.atoms[i],unit=data.units[i];
     must(unit.id===raw.id&&unit.status===raw.status&&card.dataset.atomId===raw.id,'source atom status/ID changed');
     must(card.querySelector('.sw-result-label')?.textContent===unit.label,'source status label differs');
     if(data.task==='hypothesis')for(const direction of ['SUPPORT','OPPOSE']){
       const docs=new Map();for(const row of raw.evidence.filter(r=>r.effective_direction===direction))
         docs.set(row.document_id,Math.max(docs.get(row.document_id)||0,row.context_priority_index));
       const total=[...docs.values()].reduce((a,b)=>a+b,0);
       must(Math.abs(total-unit.directionalTotals[direction])<=1e-12&&card.querySelector('[data-direction='+direction+'] .sw-score-value')?.textContent===total.toFixed(4),'signed document total differs');
     }else if(unit.score!=null)must(card.querySelector('.sw-score-value')?.textContent===unit.score.toFixed(4),'source score differs');
     else must(!card.querySelector(':scope > .sw-score .sw-score-value'),'unrecorded source score fabricated');
   });
 }
 const key=p=>JSON.stringify([p.corpus,p.canonical_page_id,p.document_id,p.date,p.page_sha256,p.start,p.end,p.text]);
 const proofs=[...new Map(data.proofs.map(p=>[key(p),p])).values()];
 const shown=all('#stage-04 [data-testid=used-source-quote]').filter(n=>!n.closest('.sw-related-context'));
 must(shown.length===proofs.length,'selected quote inventory differs');
 const remaining=[...proofs],matched=[];
 shown.forEach((node,index)=>{const text=node.querySelector('blockquote')?.textContent;
   const at=remaining.findIndex(proof=>proof.canonical_page_id===node.dataset.sourceId&&proof.document_id===node.dataset.documentId&&proof.text===text);
   must(at>=0,'quote borrowed from another source');const proof=remaining.splice(at,1)[0],page=p.sources[proof.canonical_page_id];
   must(page&&page.document_id===proof.document_id&&page.date===proof.date&&page.source_sha256===proof.page_sha256&&
     Array.from(page.text).slice(proof.start,proof.end).join('')===proof.text,'own source/page/span binding');
   matched.push({index,proof,page_text:page.text});});
 if(entry.case.corpus==='cib'){
   const P=await import('./source-inspection.js');
   for(const own of matched){const pair=await P.cibPDFPair({page:p.sources[own.proof.canonical_page_id],proof:own.proof});
     must(pair.length===2&&new Set(pair.map(p=>p.release)).size===2,'both exact PDF releases unavailable');
     own.pdfs=pair.map(p=>({release:p.release,page:p.page,sha256:p.sha256,document_id:p.document_id}));}
 }
 const digest=q('[data-testid=standard-digest]');must(digest&&digest.getAttribute('aria-busy')!=='true','digest unsettled');
 if(m.digest.available)must(digest.textContent===m.digest.text,'actual digest changed');
 else must(digest.textContent==='Analyst summary unavailable.','missing digest fabricated or legacy digest substituted');
 must(q('[data-testid=evidence-map][data-map-method=RECORDED_SOURCE_ACCOUNTS]')?.dataset.originalTraversalClaimed==='false','source map became retrieval claim');
 const status=q('[data-case="'+CSS.escape(entry.case.case_id)+'"] [data-testid=casebook-status-dot]');
 const initialSummary=S.liveSourceSummary(p.source_method_handle);
 must(status?.dataset.tone===initialSummary.tone&&status.getAttribute('aria-label')===initialSummary.title,'fresh fixed status differs');
 const digestProofs=[];
 if(m.digest.available)for(const match of m.digest.text.matchAll(/\[S(\d+)\]|\bS(\d+)\b/g)){
   const proof=m.digest.sources[Number(match[1]||match[2])-1].citations[0].citation;
   digestProofs.push({proof,page_text:p.sources[proof.canonical_page_id].text});
 }
 let originPlan=null;
 if(input.origin.full_transcription){
   const O=await import('./workbench-origin.js?v=20261128-polish1'),D=await import('./workbench-display-catalog.js?v=20261128-polish1');
   must(D.displayReportSHA===refs.reportRef.sha256,'minimal Origin catalog belongs to another base report');
   const report=JSON.parse(new TextDecoder().decode(await PublicReplay.staticBytes(refs.reportRef)));
   const original=report.cases.find(row=>row.case.case_id===entry.original_case_id);
   const minimal=entry.replacement?input.origin.minimal_selection:D.minimalOriginSelections[entry.case.case_id]||null;
   originPlan=O.originHighlightPlan(input.origin,entry.case,{sourceQuerySpans:entry.replacement?[]:original?.source_query_spans||[],minimalSpans:minimal});
 }
 must(root===q('#case-view')&&root.isConnected!==false&&root.dataset.sourceMethodSha===entry.source_method_sha256&&root.dataset.sourceRunId===entry.run_id&&
   (q('[data-testid=plan-reading-select]')?.value??null)===(selected??null),'selection changed during asynchronous fresh replay');
 return {case_id:entry.case.case_id,task:data.task,run_id:p.run_id,method_sha256:m.sha256,query_sha256:entry.query_sha256,
   method_status:m.status,reading_ids:m.readings.map(b=>b.reading.id),selected_reading:selected||null,
   facts:data.facts.length,rows:cardRows.length,matched,origin:input.origin,origin_plan:originPlan,
   digest_available:m.digest.available,digest_proofs:digestProofs,
   digest_characters:m.digest.available?m.digest.text.length:0};
}'''


def _source(page, proof, text):
    page.locator('#detail-drawer[open] [data-testid=source-document]').wait_for(timeout=60000)
    selected = page.locator('#detail-drawer .transcript-segment[data-source-selected=true]')
    assert selected.count() == 1 and selected.get_attribute('data-source-id') == proof['canonical_page_id']
    assert selected.get_attribute('data-proof-start') == str(proof['start'])
    assert selected.get_attribute('data-proof-end') == str(proof['end'])
    assert selected.get_attribute('data-proof-hash') == proof['page_sha256']
    assert selected.locator('[data-testid=source-document]').get_attribute('data-original-text') == text
    assert proof['text'] == text[proof['start']:proof['end']]


def assert_origin_segments(full, rows):
    text = full['text']
    end = 0
    separators = full.get('display_segment_mapping', {}).get('separator_spans', full.get('separator_spans', []))
    for row in rows:
        start, stop = row['start'], row['end']
        assert type(start) is int and type(stop) is int and end <= start <= stop <= len(text)
        assert start == end or any(gap['raw_start'] == end and gap['raw_end'] == start and gap['text'] == text[end:start] for gap in separators), 'Unrecorded Origin omission'
        assert row['text'] == text[start:stop], 'Original raw Origin segment changed'
        end = stop
    assert end == len(text), 'Origin omitted its tail'


def _pdfs(page, corpus, expected):
    if corpus != 'cib':
        return 0
    canvases = page.locator('#detail-drawer canvas[data-render-state=verified]')
    canvases.nth(1).wait_for(timeout=60000)
    assert canvases.count() == 2, 'Both recorded CIB PDF releases required'
    actual = canvases.evaluate_all('ns=>ns.map(n=>({release:n.dataset.release,page:Number(n.dataset.pdfPage),sha256:n.dataset.pdfSha256}))')
    assert sorted(actual, key=lambda p: p['release']) == sorted([
        {k: item[k] for k in ['release', 'page', 'sha256']} for item in expected], key=lambda p: p['release']), 'Wrong verified PDF file or physical page'
    for canvas in canvases.all():
        assert canvas.evaluate('''n=>{if(n.width<10||n.height<10)return false;
          const p=n.getContext('2d').getImageData(0,0,n.width,n.height).data;
          for(let i=0;i<p.length;i+=64)if(p[i+3]&&Math.min(p[i],p[i+1],p[i+2])<230)return true;return false;}'''), 'Blank verified PDF canvas'
    return 2


def check(page, row, entry, inventory, base, native_checksums=None):
    page.goto(base + 'workbench-v6.html?' + urlencode({'case': entry['case']['case_id']}), wait_until='domcontentloaded')
    page.locator('#case-view[aria-busy=false] [data-testid=standard-summary]').wait_for(timeout=90000)
    assert not page.locator('#page-error').inner_text().strip()
    page.wait_for_function("()=>document.querySelector('[data-testid=standard-digest]')?.getAttribute('aria-busy')!=='true'")
    initial = page.evaluate(REPLAY, {'entry': entry, 'refs': inventory['refs']})
    selected_readings = initial['reading_ids'] if initial['task'] == 'redaction' else [None]
    callbacks, pdfs, hops = 0, 0, []
    for reading in selected_readings:
        if reading is not None:
            page.get_by_test_id('plan-reading-select').select_option(reading)
            page.wait_for_function('id=>document.querySelector("#case-view")?.dataset.reading===id', arg=reading)
        value = page.evaluate(REPLAY, {'entry': entry, 'refs': inventory['refs']})
        if not value['matched']:
            continue  # An actual empty/held reading is checked, never supplied fake evidence.
        own = value['matched'][0]; proof = own['proof']
        control = page.locator('#stage-04 [data-testid=used-source-quote]:not(.sw-related-context [data-testid=used-source-quote])').nth(own['index'])
        control.click(); _source(page, proof, own['page_text']); pdfs += _pdfs(page, entry['case']['corpus'], own.get('pdfs', []))
        page.locator('#detail-close').click(); callbacks += 1
        page.locator('#stage-04 [data-testid=standard-view-on-kg]:not(.sw-related-context [data-testid=standard-view-on-kg])').nth(own['index']).click()
        page.wait_for_function("()=>document.querySelector('#detail-drawer [data-testid=source-inspection-guide][aria-busy=false]')||document.querySelector('#detail-drawer [data-testid=source-document]')||document.querySelector('#detail-drawer .error-card')", timeout=90000)
        assert not page.locator('#detail-drawer .error-card').count(), 'KG callback failed rather than verified source handoff'
        guide = page.get_by_test_id('source-inspection-guide')
        if guide.count():
            steps = guide.locator('[data-inspection-step]').count()
            assert 0 < steps <= 128
            next_button = guide.get_by_role('button', name='Next', exact=True)
            for _ in range(steps):
                if next_button.is_disabled():
                    break
                next_button.click(); page.wait_for_function("()=>document.querySelector('[data-testid=source-inspection-guide]')?.getAttribute('aria-busy')==='false'", timeout=60000)
            assert page.get_by_test_id('inspection-endpoint-quote').inner_text() == proof['text']
            host = page.locator('[data-testid=workbench-kg-inspection]')
            hops.append(int(host.get_attribute('data-graph-hops') or '0'))
            page.get_by_role('button', name='Inspect selected source', exact=True).click()
        else:
            hops.append(0)  # Verified postselection source-only handoff, not a graph traversal.
        _source(page, proof, own['page_text']); pdfs += _pdfs(page, entry['case']['corpus'], own.get('pdfs', [])); page.locator('#detail-close').click()
        # Re-check source method/reading after both callbacks; no stale model/view swap.
        page.evaluate(REPLAY, {'entry': entry, 'refs': inventory['refs']})
    digest_callbacks = 0
    for index, own in enumerate(initial['digest_proofs']):
        page.locator('[data-testid=standard-digest] button').nth(index).click()
        _source(page, own['proof'], own['page_text'])
        page.locator('#detail-close').click(); digest_callbacks += 1
    page.get_by_role('button', name='Origin', exact=True).first.click()
    page.locator('#detail-drawer[open] [data-testid=origin-document]').first.wait_for(timeout=60000)
    origin = initial['origin']
    raw = page.locator('#detail-drawer .source-document[data-original-text]').evaluate_all('nodes=>nodes.map(n=>n.dataset.originalText)')
    if origin['version'] == 'historical-recovery-study-origin/1':
        assert raw == [p['text'] for p in origin['earlier_masked_pages']]
        expected = page.evaluate('''async ({origin,caseInfo})=>{
          const R=await import('./workbench-recovery-studies.js?v=20261128-polish1');
          return origin.earlier_masked_pages.flatMap(p=>R.recoveryOriginHighlights(p,caseInfo).map(s=>s.text));
        }''', {'origin': origin, 'caseInfo': entry['case']})
        marks = page.locator('#detail-drawer mark').evaluate_all('ns=>ns.map(n=>n.dataset.originalText||n.textContent)')
        assert ''.join(marks) == ''.join(expected), 'Historical minimal input Origin marks differ'
    else:
        segments = page.locator('#detail-drawer [data-testid=origin-document] .transcript-segment').evaluate_all('ns=>ns.map(n=>({start:Number(n.dataset.rawStart),end:Number(n.dataset.rawEnd),text:n.querySelector(".source-document").dataset.originalText}))')
        assert_origin_segments(origin['full_transcription'], segments)
        marks = page.locator('#detail-drawer mark').evaluate_all('nodes=>nodes.map(n=>n.dataset.originalText||n.textContent)')
        assert ''.join(marks) == ''.join(p['text'] for p in initial['origin_plan']['anchors']), 'Minimal input Origin marks differ'
        if initial['origin_plan']['requiresReview']:
            assert 'precise input correspondence needs review' in page.locator('#detail-drawer').inner_text()
    page.locator('#detail-close').click()
    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+2')
    row.update(case_id=entry['case']['case_id'],workbench_checked=True,fresh_saved_checked=True,
        fresh_wire_sha256=entry['wire_ref']['sha256'],fresh_run_id=entry['run_id'],fresh_method_sha256=entry['source_method_sha256'],
        query_sha256=entry['query_sha256'],method_status=initial['method_status'],facts=initial['facts'],
        declared_readings_checked=len(selected_readings),source_callbacks_checked=callbacks,original_pdf_canvases=pdfs,
        postselection_graph_hops=hops,original_retrieval_claimed=False,origin_checked=True,
        digest_available=initial['digest_available'],digest_characters=initial['digest_characters'],
        digest_source_callbacks_checked=digest_callbacks,
        legacy_native_checksums=native_checksums or [],legacy_base_native_transport_preserved=native_checksums is not None,
        source_truth_certified=False,benchmark_accuracy_claimed=False)


def check_archive(page, row, entry, base):
    page.goto(archive_url(base, entry['case']['case_id']), wait_until='domcontentloaded')
    page.locator('#case-view[aria-busy=false] [data-testid=standard-summary]').wait_for(timeout=90000)
    assert not page.locator('#page-error').inner_text().strip()
    assert 'historical=1' in page.url
    assert page.locator('#case-view').get_attribute('data-source-method-sha') != entry['source_method_sha256']
    replay = '''async id=>{
      const R=await import('./workbench-recovery-studies.js?v=20261128-polish1'),catalog=await R.loadRecoveryStudies();
      const handle=await R.loadRecoveryStudy(id,{catalog}),data=R.normalizeRecoveryStudy(handle);
      const query=document.querySelector('#stage-01 [data-testid=query-text]');
      if(handle.case.case_id!==id||(query?.dataset.nativeText??query?.textContent)!==handle.case.query)
        throw Error('Historical archive was substituted');
      const select=document.querySelector('[data-testid=plan-reading-select]'),ids=data.readings.map(r=>r.id);
      if(JSON.stringify([...select.options].map(o=>o.value))!==JSON.stringify(ids))throw Error('Original archive reading inventory changed');
      const branch=data.readings.find(r=>r.id===select.value),cards=[...document.querySelectorAll('#stage-05 [data-testid=standard-candidate]')].filter(c=>!c.closest('.sw-reserves'));
      if(cards.length!==branch.candidates.slice(0,5).length)throw Error('Original archive top five changed');
      cards.forEach((card,i)=>{const c=branch.candidates[i];
        if(card.dataset.candidateId!==c.id||card.querySelector('h3')?.textContent!==c.fill||
          card.querySelector('.sw-fact-label')?.textContent!=='#'+c.rank||card.querySelector('.sw-score-value')?.textContent!==c.priority.toFixed(4)||
          card.querySelector('.sw-result-label')?.textContent!==c.label)throw Error('Archive candidate/source score changed');});
      const quotes=[...document.querySelectorAll('#stage-04 [data-testid=used-source-quote]')].filter(n=>!n.closest('.sw-related-context'));
      if(quotes.length!==branch.proofs.length||quotes.some(q=>!branch.proofs.some(p=>p.canonical_page_id===q.dataset.sourceId&&p.document_id===q.dataset.documentId&&p.text===q.querySelector('blockquote')?.textContent)))
        throw Error('Archive quotations changed or borrowed');
      return {case_id:id,query:data.caseInfo.query,metadata:handle.metadata.packet_ref.sha256,reading_ids:ids};
    }'''
    result = page.evaluate(replay, entry['case']['case_id'])
    for reading in result['reading_ids']:
        page.get_by_test_id('plan-reading-select').select_option(reading)
        page.wait_for_function('id=>document.querySelector("#case-view")?.dataset.reading===id', arg=reading)
        page.evaluate(replay, entry['case']['case_id'])
        assert 'historical=1' in page.url, 'Archive flag disappeared on reading change'
    page.reload(wait_until='domcontentloaded')
    page.locator('#case-view[aria-busy=false] [data-testid=standard-summary]').wait_for(timeout=90000)
    page.evaluate(replay, entry['case']['case_id'])
    assert 'historical=1' in page.url
    row.update(case_id=result['case_id'],historical_archive_checked=True,explicit_historical_URL=True,
        original_packet_sha256=result['metadata'],fresh_result_substituted=False,
        archived_readings_checked=len(result['reading_ids']),archive_reload_checked=True)

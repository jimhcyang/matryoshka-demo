"""Verify the current source-method DOM without weakening native replay checks."""
import re


LEGACY_VERIFY=r"""async ({row,config})=>{
 const check=(v,t)=>{if(!v)throw Error(t);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const m=await import('./local-decisions-v65.js'),ui=await import('./workbench-reviewed-source.js?v=20261128-polish1');
 const params={case_id:row.case.case_id,config,...Object.fromEntries(['resource_id','registry_sha256','index_sha256'].map(k=>[k,row.resource_binding[k]]))};
 const url='/api/current/condition-v6?'+new URLSearchParams(params);
 const raw=await PublicReplay.verified(url),condition=m.verifyCurrentResourceResponse(url,JSON.parse(new TextDecoder().decode(raw.decoded)));
 const record=condition.configurations[config];
 const handle=await ui.loadReviewedSourceMethod({row,record,config,resourceBinding:row.resource_binding,
   base:location.href,verified:url=>PublicReplay.verified(url)});
 check(handle,'Verified current source-method handle is required');
 const view=handle.view,summary=ui.reviewedSourceSummary(handle);
 let citations;
 if(view.method_id==='source_realized_redaction_v1'){
   const {citation}=await import('./r-contract.js');citations=[];
   for(const b of view.readings)for(const c of b.candidates)for(const v of c.variants){
     const s=v.source_reader,p=view.source_pages.find(p=>p.page_id===s.canonical_page_id);
     citations.push(citation(p,s.quote_span),citation(p,s.phrase_span),citation(p,s.qualification_span));
     for(const context of s.focal_source_contexts||[])citations.push(citation(p,{...context.anchor,text:context.anchor.quote}),citation(p,context.qualification_span));
   }
 }else citations=view.atoms.flatMap(a=>a.evidence.flatMap(e=>[e.citation,e.qualification_citation].filter(Boolean)));
 check(document.querySelector('[data-testid=compact-verdict]')?.dataset.methodId===view.method_id,'Wrong displayed method');
 check(document.querySelector('[data-testid=local-verdict-title]')?.textContent===summary.title,'Wrong source-method verdict');
 const quotes=[...document.querySelectorAll('[data-testid=reviewed-source-quote]')];
 let chosen,control,facts,usedQuotes;
 if(view.method_id==='source_realized_redaction_v1'){
   const selected=document.querySelector('[data-testid=r-reading-select]');
   const branch=view.readings.find(b=>b.reading.id===selected?.value);check(branch,'Displayed reading is not recorded');
   const cards=[...document.querySelectorAll('#stage-05 [data-testid=r-candidate]')].filter(c=>!c.closest('[data-testid=r-reserves]'));
   const expected=branch.candidates.slice(0,5);check(cards.length===expected.length,'Wrong source-realized candidate count');
   cards.forEach((card,i)=>{const c=expected[i];check(card.dataset.candidateId===c.id&&Number(card.dataset.rank)===c.rank,'Wrong candidate or order');
     check(card.querySelector('[data-testid=r-priority-index]')?.textContent===c.priority.value.toFixed(4),'Wrong candidate score');});
   const expectedQuotes=new Map(),key=p=>JSON.stringify([p.canonical_page_id,p.page_sha256,p.start,p.end,p.text]);
   const {citation}=await import('./r-contract.js');
   for(const c of branch.candidates)for(const v of c.variants){
     const s=v.source_reader,p=view.source_pages.find(p=>p.page_id===s.canonical_page_id);
     const proofs=[citation(p,s.quote_span),...(s.focal_source_contexts||[]).map(context=>citation(p,{...context.anchor,text:context.anchor.quote}))];
     proofs.forEach(p=>expectedQuotes.set(key(p),p));
   }
   const shown=[...document.querySelectorAll('[data-testid=r-source-quote]')];
   usedQuotes=shown.length;
   check(same(shown.map(q=>q.dataset.sourceKey),[...expectedQuotes.keys()]),'Wrong full R quotation inventory');
   shown.forEach(q=>check(q.querySelector('blockquote')?.textContent===expectedQuotes.get(q.dataset.sourceKey)?.text&&q.querySelector('blockquote')?.dataset.originalText===expectedQuotes.get(q.dataset.sourceKey)?.text,'Unbound R quotation'));
   chosen=expectedQuotes.get(shown[0]?.dataset.sourceKey);control='[data-testid=r-source-quote] button';
   const factCards=[...document.querySelectorAll('[data-testid=r-public-fact]')];facts=factCards.length;
   check(facts===record.plan.atoms.length,'Changed native fact inventory');
   factCards.forEach((f,i)=>check(f.dataset.factId===record.plan.atoms[i].id&&f.querySelector('p')?.dataset.originalText===record.plan.atoms[i].text,'Changed native fact identity/text'));
 }else{
   usedQuotes=quotes.length;
   const cards=[...document.querySelectorAll('[data-testid=reviewed-source-atom]')];
   check(cards.length===view.atoms.length,'Wrong source-model fact count');
   cards.forEach((card,i)=>check(card.dataset.atomId===view.atoms[i].id&&card.dataset.sourceStatus===view.atoms[i].status,'Wrong fact verdict'));
   const entries=view.atoms.flatMap(a=>a.evidence);check(quotes.length===entries.length,'Wrong quotation count');
   quotes.forEach(q=>{const e=entries.find(e=>(e.appraisal_id??e.judgment_id)===q.dataset.judgmentId);
     check(e&&e.direction===q.dataset.direction&&q.querySelector('blockquote')?.textContent===e.citation.text,'Changed source quotation/direction');
     check(q.querySelector('[data-testid=reviewed-source-index]')?.textContent===e.context_priority_index.toFixed(4),'Wrong source score');});
   chosen=entries.find(e=>(e.appraisal_id??e.judgment_id)===quotes[0]?.dataset.judgmentId)?.citation;control='[data-testid=reviewed-source-inspect]';facts=cards.length;
 }
 check(chosen,'No independently bound source quotation available');
 return {method_id:view.method_id,proof:chosen,control,facts,used_quotes:usedQuotes,source_count:citations.length};
}"""


VERIFY=r"""async ({row,config})=>{
 const check=(v,t)=>{if(!v)throw Error(t);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const m=await import('./local-decisions-v65.js'),ui=await import('./workbench-reviewed-source.js?v=20261128-polish1');
 const {normalizeSourcePresentation,sourceProofKey}=await import('./workbench-source-presentation.js?v=20261128-polish1');
 const params={case_id:row.case.case_id,config,...Object.fromEntries(['resource_id','registry_sha256','index_sha256'].map(k=>[k,row.resource_binding[k]]))};
 const url='/api/current/condition-v6?'+new URLSearchParams(params);
 const raw=await PublicReplay.verified(url),condition=m.verifyCurrentResourceResponse(url,JSON.parse(new TextDecoder().decode(raw.decoded)));
 const record=condition.configurations[config];
 const handle=await ui.loadReviewedSourceMethod({row,record,config,resourceBinding:row.resource_binding,
   base:location.href,verified:url=>PublicReplay.verified(url)});
 check(handle,'Verified current source-method handle is required');
 const view=handle.view,summary=ui.reviewedSourceSummary(handle),data=normalizeSourcePresentation(view,record,summary);
 check(document.querySelector('[data-testid=standard-summary]'),'Common saved-case presentation missing');
 check(document.querySelector('[data-testid=local-verdict-title]')?.textContent===summary.title,'Wrong source-method verdict');
 const facts=[...document.querySelectorAll('#stage-02 [data-testid=plan-atom]')];
 check(facts.length===data.facts.length,'Changed fact inventory');
 facts.forEach((f,i)=>check(f.dataset.atomId===data.facts[i].id,'Changed fact identity'));
 let branch=data,expected;
 if(view.method_id==='source_realized_redaction_v1'){
   const selected=document.querySelector('[data-testid=plan-reading-select]');
   branch=data.readings.find(b=>b.id===selected?.value);check(branch,'Displayed reading is not recorded');
   const cards=[...document.querySelectorAll('#stage-05 [data-testid=standard-candidate]')].filter(c=>!c.closest('.sw-reserves'));
   expected=branch.candidates.slice(0,5);check(cards.length===expected.length,'Wrong candidate count');
   cards.forEach((card,i)=>{const c=expected[i],original=view.readings.find(b=>b.reading.id===branch.id).candidates[i];
     check(c.id===original.id&&c.rank===original.rank&&c.fill===original.fill&&c.priority===original.priority.value,'Normalizer changed original candidate');
     check(card.dataset.candidateId===c.id,'Wrong candidate order');
     check(card.querySelector('.sw-score-value')?.textContent===original.priority.value.toFixed(4),'Wrong candidate score');
     check(card.querySelector('.sw-result-label')?.textContent===c.label,'Wrong evidence label');});
 }else{
   const cards=[...document.querySelectorAll('#stage-05 [data-testid=result-atom]')];
   check(cards.length===view.atoms.length,'Wrong fact verdict count');
   cards.forEach((card,i)=>{const atom=view.atoms[i],unit=data.units[i];
     check(card.dataset.atomId===atom.id&&unit.status===atom.status,'Changed source verdict');
     check(card.querySelector('.sw-result-label')?.textContent===unit.label,'Wrong fact label');
     if(view.case.task==='hypothesis')for(const direction of ['SUPPORT','OPPOSE']){
       const docs=new Map();for(const e of unit.evidence.filter(e=>e.direction===direction))docs.set(e.proof.document_id,Math.max(docs.get(e.proof.document_id)||0,e.score));
       const total=[...docs.values()].reduce((a,b)=>a+b,0),bar=card.querySelector('[data-direction='+direction+']');
       check(bar?.querySelector('.sw-score-value')?.textContent===total.toFixed(4),'Wrong independently recomputed directional total');
     }
   });
 }
 const expectedQuotes=new Map(branch.proofs.map(p=>[sourceProofKey(p),p]));
 const shown=[...document.querySelectorAll('#stage-04 [data-testid=used-source-quote]')].filter(e=>!e.closest('.sw-related-context'));
 check(shown.length===expectedQuotes.size,'Wrong deduplicated selected-quote inventory');
 const matched=new Set();let chosen;
 for(const q of shown){const text=q.querySelector('blockquote')?.dataset.originalText||q.querySelector('blockquote')?.textContent;
   const p=[...expectedQuotes.values()].find(p=>p.canonical_page_id===q.dataset.sourceId&&p.document_id===q.dataset.documentId&&p.text===text);
   check(p,'Changed selected source/quotation');matched.add(sourceProofKey(p));chosen??=p;}
 check(matched.size===expectedQuotes.size&&chosen,'Missing original selected quotation');
 check(document.querySelector('#stage-03 svg'),'Facts-to-evidence map missing');
 return {method_id:view.method_id,proof:chosen,control:'#stage-04 [data-testid=used-source-quote]',facts:facts.length,
   used_quotes:shown.length,source_count:expectedQuotes.size};
}"""


def check(page,row,saved,display,params,packet,assert_source,digest,checksums):
    page.locator('[data-testid=standard-summary]').wait_for(state='visible',timeout=90000)
    assert not page.locator('#page-error').inner_text().strip()
    page.wait_for_function("document.querySelector('#case-view')?.getAttribute('aria-busy')==='false'",timeout=90000)
    assert re.match(r'01\s+Input\s+02\s+Facts',page.locator('.workflow-nav').inner_text())
    result=page.evaluate(VERIFY,dict(row=saved,config=params['config']))
    proof=result['proof']
    source=packet('/api/current/source-v6',dict(params,source_id=proof['canonical_page_id']))
    source_page=source.get('page',source)
    assert_source(saved,params['config'],source_page,full_page=True,execution=display,envelope=source)
    assert digest(source_page['text'])==proof['page_sha256']
    assert source_page['text'][proof['start']:proof['end']]==proof['text']
    control=page.locator(result['control']).first
    # Context accounts may be folded; open their actual ancestor before clicking.
    control.evaluate("n=>{for(let p=n.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;}")
    control.click()
    page.locator('#detail-drawer[open] [data-testid=source-document]').wait_for(state='visible',timeout=60000)
    assert page.get_by_test_id('source-document').get_attribute('data-original-text')==source_page['text']
    marks=page.locator('#detail-drawer .source-document mark')
    assert proof['text'] in ''.join(marks.get_attribute('data-original-text') or marks.text_content() for marks in marks.all())
    pdf_canvases=0
    if saved['case']['corpus']=='cib':
        canvases=page.locator('#detail-drawer canvas[data-render-state=verified]')
        canvases.nth(1).wait_for(state='visible',timeout=60000)
        assert canvases.count()==2, 'Both original release PDFs must render'
        for canvas in canvases.all():
            assert canvas.evaluate('''node=>{
              if(node.width<10||node.height<10)return false;
              const rgba=node.getContext('2d').getImageData(0,0,node.width,node.height).data;
              for(let i=0;i<rgba.length;i+=64)if(rgba[i+3]&&Math.min(rgba[i],rgba[i+1],rgba[i+2])<230)return true;
              return false;
            }'''), 'Original PDF canvas is blank'
        pdf_canvases=2
    page.locator('#detail-close').click()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2')
    row.update(case_id=saved['case']['case_id'],native_checksums=checksums,facts=result['facts'],
        used_quotes=result['used_quotes'],source_binding_proofs=result['source_count'],exact_source_inspected=True,
        original_pdf_canvases=pdf_canvases,method_id=result['method_id'],no_result_gates=True)

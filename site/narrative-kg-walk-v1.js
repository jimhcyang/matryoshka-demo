/* Saved step player beside the existing KG. Display links never become KG edges. */
(async()=>{
  const params=new URLSearchParams(location.search),id=params.get('walk_case');if(!id)return;
  const host=document.createElement('aside');host.id='saved-kg-walk';host.className='retrieval-path-guide';host.setAttribute('aria-label','Saved path walkthrough');
  document.querySelector('.graph-grid').before(host);
  const make=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
  host.append(make('h2','Saved path walkthrough'),make('p','Loading the saved steps…'));
  try{
    const [{loadSavedCatalog},{validateTrace},{canonicalGateJSON},{storyAccess,acknowledgeStoryReveal}]=await Promise.all([
      import('./narrative-catalog-v1.js'),import('./narrative-trace-v1.js'),import('./local-decisions-v65.js'),import('./narrative-attempts-v1.js')]);
    const {report}=await loadSavedCatalog(),row=report.cases.find(r=>r.case.case_id===id),config=params.get('walk_config')||'llm_readings',reading=params.get('walk_reading')||'';
    if(!row||row.case.corpus!==params.get('corpus')||!row.configurations[config])throw Error('This walkthrough does not match a released case.');
    if(!storyAccess(report,row).unlocked){
      host.replaceChildren(make('h2','Saved path walkthrough'),make('p','This saved walkthrough includes the story’s outcomes and source quotations.'));
      const reveal=make('button','Reveal story answers and show walkthrough');reveal.dataset.testid='kg-walk-reveal';reveal.onclick=()=>{acknowledgeStoryReveal(report,row);location.reload();};host.append(reveal);return;
    }
    const saved=row.configurations[config],query=new URLSearchParams({case_id:id,config,reading,...Object.fromEntries(['resource_id','registry_sha256','index_sha256'].map(k=>[k,row.resource_binding[k]]))});
    const response=await fetch('/api/narrative-v1/trace?'+query,{cache:'no-store'});if(!response.ok)throw Error('The exact saved trace is unavailable.');
    const envelope=await response.json(),query_sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalGateJSON(row.case.query))))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const trace=validateTrace(envelope,{case_id:id,config,reading_id:reading,query_sha256,native_checkpoint:saved.native_checkpoint,resource_binding:row.resource_binding});
    const path=trace.paths.find(p=>p.id===params.get('walk_path'));if(!path)throw Error('The selected saved path is unavailable.');
    const steps=path.steps.map(id=>trace.steps.find(s=>s.id===id));if(!steps.length||steps.some(s=>!s))throw Error('The saved step sequence is incomplete.');
    const style=make('style');style.textContent='#saved-kg-walk table{width:100%;border-collapse:collapse;margin:12px 0}#saved-kg-walk th,#saved-kg-walk td{text-align:left;padding:10px;border-bottom:1px solid #ccd8db;vertical-align:top;font-size:14px}#saved-kg-walk tr[aria-current="step"]{background:#e2eff1}#saved-kg-walk td button{font:inherit;text-align:left;white-space:normal}#saved-kg-walk .walk-table{overflow:auto}#saved-kg-walk blockquote{white-space:pre-wrap;margin:12px 0;padding:12px;border-left:3px solid #347d78}#saved-kg-walk .guide-actions{position:sticky;top:0;background:white;padding:10px 0;z-index:2}';
    host.replaceChildren(style,make('h2','Saved path walkthrough'));
    host.append(make('p',path.graph_hops?'Step through the saved graph/source connections. Connections locate sources; they do not establish the claim.':'Step through the saved question-to-source handoff. This path has zero recorded KG hops; its display links are not graph edges.'));
    const controls=make('div');controls.className='guide-actions';const previous=make('button','Previous'),play=make('button','Play'),next=make('button','Next'),count=make('span'),select=make('select');select.setAttribute('aria-label','Saved walkthrough step');
    steps.forEach((s,i)=>{const option=make('option',`${i+1}. ${s.label||s.kind}`);option.value=i;select.append(option);});controls.append(previous,play,next,count,select);host.append(controls);
    const wrap=make('div');wrap.className='walk-table';const table=make('table');table.setAttribute('aria-label','Saved path steps');const head=make('thead'),hr=make('tr');['Step','Saved phase','Recorded state'].forEach(t=>hr.append(make('th',t)));head.append(hr);table.append(head);const body=make('tbody');table.append(body);wrap.append(table);host.append(wrap);
    const detail=make('div');detail.setAttribute('role','status');host.append(detail);let index=0,timer=null;
    const stop=()=>{clearInterval(timer);timer=null;play.textContent='Play';};
    const render=()=>{
      body.replaceChildren();steps.forEach((s,i)=>{const tr=make('tr');if(i===index)tr.setAttribute('aria-current','step');tr.append(make('td',i+1),make('td',String(s.kind).replaceAll('_',' ')));const td=make('td'),button=make('button',s.label||s.kind);button.onclick=()=>{stop();index=i;render();};td.append(button);tr.append(td);body.append(tr);});
      count.textContent=`${index+1} / ${steps.length}`;select.value=index;previous.disabled=index===0;next.disabled=index===steps.length-1;const step=steps[index];detail.replaceChildren(make('h3',step.label||step.kind));
      const graphNodes=step.nodes.filter(n=>n.is_graph_node===true),panel=typeof state!=='undefined'?state.panels?.current:null;
      for(const n of graphNodes)if(panel?.nodeMap?.has(n.id)){panel.focusNode(n.id);break;}
      const refs=step.source_refs.map(v=>typeof v==='string'?(trace.sources||trace.source_refs_by_id||{})[v]:v).filter(Boolean);
      for(const ref of refs){detail.append(make('p',`${ref.document_id||''} · ${ref.date||''}`),make('blockquote',ref.text));}
      if(timer&&index===steps.length-1)stop();
    };
    previous.onclick=()=>{stop();index=Math.max(0,index-1);render();};next.onclick=()=>{stop();index=Math.min(steps.length-1,index+1);render();};select.onchange=()=>{stop();index=Number(select.value);render();};play.onclick=()=>{if(timer){stop();return;}if(index===steps.length-1)index=0;play.textContent='Pause';timer=setInterval(()=>{index=Math.min(steps.length-1,index+1);render();},1800);render();};
    window.addEventListener('pagehide',stop,{once:true});render();host.dataset.status='ready';
  }catch(error){host.replaceChildren(make('h2','Saved path walkthrough unavailable'),make('p',error.message));host.dataset.status='unavailable';}
})();

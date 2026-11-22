/* Saved stages navigate only their explicit graph nodes. Display links stay display links. */
function savedWalkProofs(trace,values){
  if(!Array.isArray(values))throw Error('The saved quotation inventory is incomplete.');
  const lookup=trace.sources||trace.source_refs_by_id||{};
  return values.map(value=>{const proof=typeof value==='string'?lookup[value]:value;if(!proof||typeof proof!=='object')throw Error('A saved quotation reference is missing.');return proof;});
}
function savedWalkStepProofs(trace,step){
  const values=[...step.source_refs];
  for(const node of step.nodes)if(node.citation)values.push(node.citation);
  for(const edge of step.edges){if(edge.citation)values.push(edge.citation);values.push(...(edge.citations||[]),...(edge.source_refs||[]));}
  const unique=new Map();
  for(const proof of savedWalkProofs(trace,values))unique.set(JSON.stringify([proof.document_id,proof.date,proof.canonical_page_id,proof.page_sha256,proof.start,proof.end,proof.text]),proof);
  return [...unique.values()];
}
function validateSavedWalkScope(trace,record){
  const proofs=trace.steps.flatMap(step=>savedWalkStepProofs(trace,step));
  for(const path of trace.paths)proofs.push(...savedWalkProofs(trace,path.source_refs),...savedWalkProofs(trace,path.decision_source_refs||[]));
  for(const proof of proofs)if(!proof.canonical_page_id||!proof.document_id||!/^\d{4}-\d{2}-\d{2}$/.test(proof.date||'')||
      !(proof.date<record.date)||proof.document_id===record.document_id||!/^[a-f0-9]{64}$/.test(proof.page_sha256||'')||
      !Number.isInteger(proof.start)||!Number.isInteger(proof.end)||proof.start<0||proof.end<=proof.start||
      typeof proof.text!=='string'||Array.from(proof.text).length!==proof.end-proof.start)throw Error('A saved quotation is outside the complete case source scope.');
  return trace;
}
function savedWalkStageTitle(kind){
  return {QUERY_ATOM:'Question',READING_CANDIDATE:'Reading',RECORDED_MATCH:'Saved match',SOURCE_GRAPH_NAVIGATION:'Graph state',SOURCE_READOUT:'Source'}[kind]||'Saved stage';
}
function savedWalkProofCaption(proof){
  const page=proof.earlier_page??proof.page_number;
  return proof.date+(Number.isInteger(page)&&page>0?` / Page ${page}`:'');
}
function savedWalkStageNode(step,requested){
  const nodes=step.nodes.filter(node=>node.is_graph_node===true);
  if(requested){const selected=nodes.find(node=>node.id===requested);if(!selected)throw Error('The selected ID is not an actual graph node in this saved stage.');return selected;}
  const edge=step.edges.at(-1),target=edge?.traversal_to||edge?.target;
  return nodes.find(node=>node.id===target)||nodes[0]||null;
}

(async()=>{
  const params=new URLSearchParams(location.search),id=params.get('walk_case');if(!id)return;
  const make=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;return node;};
  const host=make('aside');host.id='saved-kg-walk';host.className='retrieval-path-guide';host.setAttribute('aria-label','Saved path walkthrough');
  document.querySelector('.graph-grid').before(host);
  const style=make('style');style.textContent='#saved-kg-walk{display:flex;flex-direction:column;overflow:hidden}#saved-kg-walk>header,#saved-kg-walk .walk-stages,#saved-kg-walk .guide-actions,#saved-kg-walk .walk-status{flex-shrink:0}#saved-kg-walk>header{margin-bottom:0;gap:8px}#saved-kg-walk>header .walk-mode{margin:0;text-align:right}#saved-kg-walk .walk-stages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:6px 0}#saved-kg-walk .walk-stages button{min-width:0;width:100%;min-height:44px;padding:7px;text-align:left;white-space:normal;font-size:14px;line-height:1.3}#saved-kg-walk .walk-stages span{display:inline-block;margin-inline-end:4px;font-size:14px;color:var(--ink-soft)}#saved-kg-walk .walk-stages [aria-current="step"]{background:var(--teal-light);border-color:var(--teal)}#saved-kg-walk .guide-actions{margin-top:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px;max-width:100%}#saved-kg-walk .guide-actions button{min-width:0;min-height:36px;font-size:14px}#saved-kg-walk .walk-mode,#saved-kg-walk .walk-status,#saved-kg-walk .walk-proof-meta{font-size:14px;line-height:1.5;overflow-wrap:anywhere;margin:6px 0}#saved-kg-walk .walk-current{flex:1 1 auto;min-height:61px;overflow:auto;border-top:1px solid var(--line);margin-top:6px;padding-top:8px}#saved-kg-walk .walk-current h3{font-size:16px;line-height:1.5;margin:0 0 8px;overflow-wrap:anywhere}#saved-kg-walk blockquote{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 14px;padding:8px;border-left:3px solid #347d78;font-size:16px;line-height:1.6}#saved-kg-walk .walk-nodes{margin-top:10px;font-size:14px}#saved-kg-walk .walk-nodes button{display:block;width:100%;white-space:normal;overflow-wrap:anywhere;text-align:left;font-size:14px}@media(max-width:600px){#saved-kg-walk{max-height:min(calc(100dvh - var(--toolbar-bottom,190px) - 20px),max(36dvh,300px))}}';
  host.append(style,make('h2','KG Navigator'),make('p','Loading saved stages...'));
  try{
    const [{loadSavedCatalog},{validateTrace},{canonicalGateJSON}]=await Promise.all([
      import('./narrative-catalog-v1.js'),import('./narrative-trace-v1.js'),import('./local-decisions-v65.js')]);
    const {report}=await loadSavedCatalog(),row=report.cases.find(r=>r.case.case_id===id),config=params.get('walk_config')||'llm_readings',reading=params.get('walk_reading')||'';
    if(!row||row.case.corpus!==params.get('corpus')||!row.configurations[config])throw Error('This walkthrough does not match a released case.');
    for(const key of ['walk_case','walk_path','walk_config','walk_reading','resource_id','registry_sha256','index_sha256']){
      if(params.getAll(key).length>1||['resource_id','registry_sha256','index_sha256'].includes(key)&&params.has(key)&&params.get(key)!==row.resource_binding[key])throw Error('The saved walk selectors conflict with this released resource.');
    }
    const saved=row.configurations[config],query=new URLSearchParams({case_id:id,config,reading,...Object.fromEntries(['resource_id','registry_sha256','index_sha256'].map(key=>[key,row.resource_binding[key]]))});
    const response=await fetch('/api/narrative-v1/trace?'+query,{cache:'no-store'});if(!response.ok)throw Error('The exact saved trace is unavailable.');
    const envelope=await response.json(),query_sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalGateJSON(row.case.query))))].map(value=>value.toString(16).padStart(2,'0')).join('');
    const trace=validateSavedWalkScope(validateTrace(envelope,{case_id:id,config,reading_id:reading,query_sha256,
      native_checkpoint:saved.native_checkpoint,resource_binding:row.resource_binding,task:row.case.task,
      strictly_before:row.case.date,whole_origin_excluded:row.case.document_id}),row.case);
    const path=trace.paths.find(value=>value.id===params.get('walk_path'));if(!path)throw Error('The selected saved path is unavailable.');
    const proofKeys=['walk_source','walk_start','walk_end','walk_hash'];let handoff=null;
    if(proofKeys.some(key=>params.has(key))){
      if(proofKeys.some(key=>params.getAll(key).length!==1)||!/^\d+$/.test(params.get('walk_start'))||!/^\d+$/.test(params.get('walk_end'))||!/^[a-f0-9]{64}$/.test(params.get('walk_hash')))throw Error('Incomplete or mixed quotation handoff.');
      const refs=savedWalkProofs(trace,path.decision_source_refs?.length?path.decision_source_refs:path.source_refs),matches=refs.filter(p=>p.canonical_page_id===params.get('walk_source')&&p.page_sha256===params.get('walk_hash')&&p.start===Number(params.get('walk_start'))&&p.end===Number(params.get('walk_end')));
      const unique=new Map(matches.map(p=>[JSON.stringify(p),p]));if(unique.size!==1)throw Error('The exact selected quotation is not a final evidence endpoint of this route.');
      handoff=unique.values().next().value;
    }
    const steps=path.steps.map(stepId=>trace.steps.find(step=>step.id===stepId));if(!steps.length||steps.some(step=>!step))throw Error('The saved step sequence is incomplete.');
    const hasGraph=steps.some(step=>step.nodes.some(node=>node.is_graph_node===true));
    const mode=make('p',hasGraph?'Post-run graph view':path.graph_hops===0?'Source handoff / 0 hops':'Source handoff');mode.className='walk-mode';mode.title='Saved source navigation, not original execution chronology or proof of the query.';
    const stages=make('div');stages.className='walk-stages';stages.setAttribute('role','group');stages.setAttribute('aria-label','Saved walkthrough stages');
    const controls=make('div');controls.className='guide-actions';
    const previous=make('button','Previous'),play=make('button','Play'),next=make('button','Next'),count=make('output');
    for(const button of [previous,play,next])button.type='button';controls.append(previous,play,next,count);
    const status=make('p');status.className='walk-status';status.setAttribute('role','status');
    const current=make('section');current.className='walk-current';current.setAttribute('aria-label','Current saved stage');
    const header=make('header');header.append(make('h2','KG Navigator'),mode);
    host.replaceChildren(style,header,stages,controls,status,current);
    let index=0,playing=false,busy=false,timer=null,epoch=0,controller=null;
    const boxes=steps.map((step,i)=>{
      const button=make('button');button.type='button';button.dataset.walkStage=String(i);button.setAttribute('aria-label',`${i+1}. ${step.label||step.kind}`);
      button.append(make('span',String(i+1)),make('strong',savedWalkStageTitle(step.kind)));button.onclick=()=>activate(i);stages.append(button);return button;
    });
    const chrome=()=>{
      boxes.forEach((button,i)=>{button.disabled=busy;button.setAttribute('aria-current',i===index?'step':'false');});
      previous.disabled=busy||index===0;next.disabled=busy||index===steps.length-1;play.disabled=busy&&!playing;
      play.textContent=playing?'Pause':'Play';play.setAttribute('aria-pressed',String(playing));count.textContent=`${index+1} / ${steps.length}`;
      status.classList.toggle('sr-only',['focused','source-only'].includes(host.dataset.mapStatus));
      host.setAttribute('aria-busy',String(busy));host.dataset.activeStage=String(index);
    };
    const schedule=()=>{
      clearTimeout(timer);timer=null;
      if(playing&&!busy&&!document.hidden&&index<steps.length-1)timer=setTimeout(()=>activate(index+1,{automatic:true}),1800);
    };
    const stop=()=>{
      playing=false;clearTimeout(timer);timer=null;epoch++;controller?.abort();controller=null;busy=false;
      if(host.dataset.mapStatus==='navigating'){host.dataset.mapStatus='paused';delete host.dataset.focusedNode;status.textContent='Map navigation paused.';}
      chrome();
    };
    const detail=(step,nodesOpen)=>{
      current.replaceChildren(make('h3',step.label||step.kind));
      current.scrollTop=0;
      const proofs=step.kind==='SOURCE_READOUT'&&handoff?[handoff]:savedWalkStepProofs(trace,step);
      for(const proof of proofs){
        const meta=make('p',savedWalkProofCaption(proof));meta.className='walk-proof-meta';
        meta.title=`Document: ${proof.document_id}\nPage ID: ${proof.canonical_page_id}\nSHA-256: ${proof.page_sha256}\nQuotation: [${proof.start}, ${proof.end})`;
        const quote=make('blockquote');quote.dataset.proofPage=proof.canonical_page_id;quote.dataset.proofHash=proof.page_sha256;quote.dataset.proofStart=String(proof.start);quote.dataset.proofEnd=String(proof.end);
        const inspect=make('button',proof.text);inspect.type='button';inspect.className='walk-source-excerpt';inspect.onclick=()=>{stop();openSavedWalkSource(proof,{caseInfo:row.case,config,resourceBinding:row.resource_binding});};quote.append(inspect);
        current.append(meta,quote);
      }
      const nodes=step.nodes.filter(node=>node.is_graph_node===true);
      if(nodes.length){
        const list=make('details');list.className='walk-nodes';list.open=nodesOpen;list.append(make('summary',`Saved graph states (${nodes.length})`));
        for(const node of nodes){const button=make('button',node.label||'Saved graph state');button.type='button';button.title=node.id;button.dataset.walkNode=node.id;button.onclick=()=>activate(index,{nodeId:node.id});list.append(button);}
        current.append(list);
      }
    };
    async function activate(value,{automatic=false,nodeId}={}){
      if(!Number.isInteger(value)||value<0||value>=steps.length)return;
      const nodesOpen=value===index&&Boolean(current.querySelector('.walk-nodes')?.open);
      clearTimeout(timer);timer=null;if(!automatic)playing=false;
      const turn=++epoch;controller?.abort();controller=new AbortController();const signal=controller.signal;
      index=value;busy=true;delete host.dataset.focusedNode;detail(steps[index],nodesOpen);chrome();
      try{
        const node=savedWalkStageNode(steps[index],nodeId);
        if(node){
          host.dataset.mapStatus='navigating';status.textContent='Opening the exact saved node in the existing map...';
          status.classList.remove('sr-only');
          if(typeof navigateSavedWalkNode!=='function')throw Error('The existing map navigator is unavailable.');
          const result=await navigateSavedWalkNode(node,{resourceBinding:row.resource_binding,signal});
          if(turn!==epoch||signal.aborted)return;
          host.dataset.mapStatus=result.status;
          if(result.status==='focused'){host.dataset.focusedNode=result.id;status.textContent='Exact saved node selected.';}
          else status.textContent=result.message;
        }else{
          host.dataset.mapStatus='source-only';status.textContent='No saved graph node in this stage.';
          if(steps[index].kind==='SOURCE_READOUT'&&handoff)await openSavedWalkSource(handoff,{caseInfo:row.case,config,resourceBinding:row.resource_binding});
        }
      }catch(error){
        if(turn!==epoch)return;
        if(error.name==='AbortError'){host.dataset.mapStatus='paused';status.textContent='Map navigation paused.';}
        else{host.dataset.mapStatus='unavailable';status.textContent=error.message;playing=false;}
      }finally{
        if(turn===epoch){busy=false;controller=null;if(index===steps.length-1)playing=false;chrome();schedule();}
      }
    }
    previous.onclick=()=>activate(index-1);next.onclick=()=>activate(index+1);
    play.onclick=()=>{if(playing){stop();return;}playing=true;if(index===steps.length-1)activate(0,{automatic:true});else{chrome();schedule();}};
    document.addEventListener('pointerdown',event=>{if(!host.contains(event.target))stop();},true);
    document.addEventListener('wheel',event=>{if(!host.contains(event.target))stop();},{passive:true,capture:true});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')stop();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',stop);
    window.addEventListener('pagehide',stop,{once:true});
    await activate(0);host.dataset.status='ready';
    if(params.get('walk_autoplay')==='1'&&steps.length>1){playing=true;chrome();schedule();}
  }catch(error){host.replaceChildren(style,make('h2','KG Navigator'),make('p',error.message));host.dataset.status='unavailable';}
})();

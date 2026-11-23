/* Saved stages navigate only their explicit graph nodes. Display links stay display links. */
let savedWalkPolicyTools;
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
function validateSavedWalkScope(trace,record,saved){
  const scope=savedWalkPolicyTools.traceSourceScope(record,saved,trace);
  const proofs=trace.steps.flatMap(step=>savedWalkStepProofs(trace,step));
  for(const path of trace.paths)proofs.push(...savedWalkProofs(trace,path.source_refs),...savedWalkProofs(trace,path.decision_source_refs||[]));
  for(const proof of proofs)if(!proof.canonical_page_id||!proof.document_id||!/^\d{4}-\d{2}-\d{2}$/.test(proof.date||'')||
      !savedWalkPolicyTools.sourceScopeAllows(proof,scope)||!/^[a-f0-9]{64}$/.test(proof.page_sha256||'')||
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

function savedWalkMapNames(action,lookup,display){
  const name=node=>{
    if(node?.is_graph_node!==true)return null;
    const record=lookup(node.id);
    if(record?.id!==node.id||!record.label)return null;
    const full=String(display(record)||'').replace(/\s+/g,' ').trim();
    if(!full||full===node.id)return null;
    const label=full.length<=60?full:full.slice(0,57).replace(/\s+\S*$/,'')+'...';
    return {label,full};
  };
  return {origin:name(action.previousNode),target:name(action.node)};
}

(async()=>{
  const params=new URLSearchParams(location.search),id=params.get('walk_case');if(!id)return;
  const make=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;return node;};
  const host=make('aside');host.id='saved-kg-walk';host.className='retrieval-path-guide';host.setAttribute('aria-label','Saved path walkthrough');
  document.querySelector('.graph-grid').before(host);
  const style=make('style');style.textContent='#saved-kg-walk{display:flex;flex-direction:column;overflow:hidden}#saved-kg-walk>header,#saved-kg-walk .walk-stages,#saved-kg-walk .guide-actions,#saved-kg-walk .walk-status{flex-shrink:0}#saved-kg-walk>header{margin-bottom:0;gap:8px}#saved-kg-walk>header .walk-mode{margin:0;text-align:right}#saved-kg-walk .walk-stages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:6px 0}#saved-kg-walk .walk-stages button{min-width:0;width:100%;min-height:44px;padding:6px;text-align:left;white-space:normal;overflow-wrap:anywhere;font-size:14px;line-height:1.3}#saved-kg-walk .walk-stages span{display:block;font-size:14px;color:var(--ink-soft)}#saved-kg-walk .walk-stages [aria-current="step"]{background:var(--teal-light);border-color:var(--teal)}#saved-kg-walk .guide-actions{display:flex;align-items:center;gap:8px;margin:0;max-width:100%}#saved-kg-walk .guide-actions button,#saved-kg-walk [data-walk-source]{min-height:36px;font-size:14px}#saved-kg-walk .walk-mode,#saved-kg-walk .walk-status,#saved-kg-walk .walk-proof-meta{font-size:14px;line-height:1.5;overflow-wrap:anywhere;margin:6px 0}#saved-kg-walk .walk-current{flex:1 1 auto;min-height:61px;overflow:auto;border-top:1px solid var(--line);margin-top:6px;padding-top:8px}#saved-kg-walk .walk-current h3{font-size:16px;line-height:1.5;margin:0 0 8px;overflow-wrap:anywhere}#saved-kg-walk blockquote{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;padding:8px;border-left:3px solid #347d78;font-size:16px;line-height:1.6}#saved-kg-walk .walk-record{margin-top:14px;font-size:14px}#saved-kg-walk .walk-record pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}@media(max-width:600px){#saved-kg-walk{max-height:min(calc(100dvh - var(--toolbar-bottom,190px) - 20px),max(36dvh,300px))}}';
  host.append(style,make('h2','KG Navigator'),make('p','Loading saved stages...'));
  try{
    const [{loadSavedCatalog},{validateTrace},{canonicalGateJSON},{buildSavedWalkPlan,savedWalkNavigationContext,NAVIGATION_CONTRACT},{loadReaderCasing,readerText},sourcePolicy]=await Promise.all([
      import('./narrative-catalog-v1.js'),import('./narrative-trace-v1.js'),import('./local-decisions-v65.js'),import('./saved-walk-plan-v2.js'),import('./reader-casing.js'),import('./saved-source-policy.js')]);
    savedWalkPolicyTools=sourcePolicy;
    await loadReaderCasing();
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
      ...sourcePolicy.traceSourceScope(row.case,saved,envelope.trace||envelope)}),row.case,saved);
    const path=trace.paths.find(value=>value.id===params.get('walk_path'));if(!path)throw Error('The selected saved path is unavailable.');
    const proofKeys=['walk_source','walk_start','walk_end','walk_hash'];let handoff=null;
    if(proofKeys.some(key=>params.has(key))){
      if(proofKeys.some(key=>params.getAll(key).length!==1)||!/^\d+$/.test(params.get('walk_start'))||!/^\d+$/.test(params.get('walk_end'))||!/^[a-f0-9]{64}$/.test(params.get('walk_hash')))throw Error('Incomplete or mixed quotation handoff.');
      const refs=savedWalkProofs(trace,path.decision_source_refs?.length?path.decision_source_refs:path.source_refs),matches=refs.filter(p=>p.canonical_page_id===params.get('walk_source')&&p.page_sha256===params.get('walk_hash')&&p.start===Number(params.get('walk_start'))&&p.end===Number(params.get('walk_end')));
      const unique=new Map(matches.map(p=>[JSON.stringify(p),p]));if(unique.size!==1)throw Error('The exact selected quotation is not a final evidence endpoint of this route.');
      handoff=unique.values().next().value;
    }
    const plan=buildSavedWalkPlan(trace,path),actions=plan.actions;
    const mode=make('p',plan.graphNodeCount?'Post-run graph view':'Source handoff / 0 hops');mode.className='walk-mode';mode.title='Saved source navigation, not original execution chronology or proof of the query.';
    const stages=make('div');stages.className='walk-stages';stages.setAttribute('role','group');stages.setAttribute('aria-label','Saved walkthrough stages');
    const controls=make('div');controls.className='guide-actions';
    const play=make('button','Play'),count=make('output');play.type='button';play.dataset.walkPlay='';controls.append(play,count);play.hidden=actions.length===1;
    const status=make('p');status.className='walk-status';status.setAttribute('role','status');
    const current=make('section');current.className='walk-current';current.setAttribute('aria-label','Current saved stage');
    const header=make('header');header.append(make('h2','KG Navigator'),mode);
    host.replaceChildren(style,header,stages,controls,status,current);
    let index=0,playing=false,busy=false,timer=null,epoch=0,controller=null;
    const boxes=actions.map((action,i)=>{
      const button=make('button');button.type='button';button.dataset.walkStage=String(i);button.dataset.walkAction=action.kind;button.setAttribute('aria-label',`${i+1}. ${action.title}`);
      button.append(make('span',String(i+1)),make('strong',action.title));button.onclick=()=>activate(i);stages.append(button);return button;
    });
    const chrome=()=>{
      boxes.forEach((button,i)=>{button.disabled=busy;button.setAttribute('aria-current',i===index?'step':'false');});
      play.textContent=playing||busy?'Pause':'Play';play.setAttribute('aria-pressed',String(playing||busy));count.textContent=`${index+1} / ${actions.length}`;
      status.classList.toggle('sr-only',['focused','source-only'].includes(host.dataset.mapStatus)&&(!host.dataset.traceEdge||host.dataset.edgeVerification==='exact-source'));
      host.setAttribute('aria-busy',String(busy));host.dataset.activeStage=String(index);
    };
    const schedule=()=>{
      clearTimeout(timer);timer=null;
      if(playing&&!busy&&!document.hidden&&index<actions.length-1)timer=setTimeout(()=>activate(index+1,{automatic:true}),1800);
    };
    const stop=()=>{
      playing=false;clearTimeout(timer);timer=null;epoch++;controller?.abort();controller=null;busy=false;
      if(host.dataset.mapStatus==='navigating'){host.dataset.mapStatus='paused';delete host.dataset.focusedNode;status.textContent='Map navigation paused.';}
      chrome();
    };
    const connectionNames=action=>{
      if(action.kind!=='connection')return;
      const panel=state.panels.current,index=state.searchEvidenceIndexes[panel.view.key];
      const names=savedWalkMapNames(action,id=>panel.nodeMap.get(id)||index?.get(id),record=>readerText(mapDisplayLabel(record),row.case.corpus));
      for(const key of ['origin','target']){
        const label=current.querySelector('[data-walk-'+key+']'),value=names[key];
        if(label){label.textContent=value?.label||'';label.title=value?.full||'';label.parentElement.hidden=!value;}
      }
    };
    const detail=action=>{
      const step=action.step;current.replaceChildren(make('h3',action.kind==='connection'?'Map connection':readerText(action.title,row.case.corpus)));
      current.scrollTop=0;
      if(action.kind==='community')current.append(make('p','Start at the saved origin in its current map community.'));
      if(action.kind==='connection'){
        for(const [key,title] of [['origin','From: '],['target','To: ']]){
          const line=make('p'),label=make('strong');line.style.margin='6px 0';label.setAttribute('data-walk-'+key,'');line.append(document.createTextNode(title),label);current.append(line);
        }
        connectionNames(action);
      }
      const proofs=action.kind==='source'?(handoff?[handoff]:savedWalkStepProofs(trace,step)):[];
      for(const proof of proofs){
        const meta=make('p',savedWalkProofCaption(proof));meta.className='walk-proof-meta';
        meta.title=`Document: ${proof.document_id}\nPage ID: ${proof.canonical_page_id}\nSHA-256: ${proof.page_sha256}\nQuotation: [${proof.start}, ${proof.end})`;
        const quote=make('blockquote');quote.dataset.proofPage=proof.canonical_page_id;quote.dataset.proofHash=proof.page_sha256;quote.dataset.proofStart=String(proof.start);quote.dataset.proofEnd=String(proof.end);
        quote.textContent=readerText(proof.text,row.case.corpus);quote.dataset.proofRawText=proof.text;
        const inspect=make('button','Open source');inspect.type='button';inspect.dataset.walkSource='';inspect.onclick=()=>{stop();openSavedWalkSource(proof,{caseInfo:row.case,config,resourceBinding:row.resource_binding});};
        current.append(meta,quote,inspect);
      }
      const record=make('details');record.className='walk-record';record.append(make('summary','Raw saved record'));
      record.append(make('pre',JSON.stringify({route_mode:path.route_mode,original_traversal_claimed:path.original_traversal_claimed,
        active_step:step.id,active_edge:action.connection||null,steps:plan.steps},null,2)));current.append(record);
    };
    async function activate(value,{automatic=false}={}){
      if(!Number.isInteger(value)||value<0||value>=actions.length)return;
      clearTimeout(timer);timer=null;if(!automatic)playing=false;
      const turn=++epoch;controller?.abort();controller=new AbortController();const signal=controller.signal;
      index=value;busy=true;delete host.dataset.focusedNode;const action=actions[index];detail(action);chrome();
      host.dataset.traceStep=action.step.id;host.dataset.transition=action.kind;host.dataset.traceEdge=action.connection?.id||'';delete host.dataset.edgeVerification;
      try{
        guideCloseSource();
        if(action.node){
          host.dataset.mapStatus='navigating';status.textContent=action.kind==='community'?'Opening the origin community...':'Following the map connection...';
          status.classList.remove('sr-only');
          if(typeof navigateSavedWalkNode!=='function')throw Error('The existing map navigator is unavailable.');
          const context=savedWalkNavigationContext({row,saved,config,reading,query_sha256,trace,path,step:action.step});
          const result=await navigateSavedWalkNode(action.node,{resourceBinding:row.resource_binding,signal,
            previousNode:action.previousNode||null,connection:action.connection||null,transition:action.kind,context});
          if(turn!==epoch||signal.aborted)return;
          connectionNames(action);
          if(result.navigation_contract!==NAVIGATION_CONTRACT)throw Error('The map needs saved-walk navigation v2; no node-only substitute is presented.');
          host.dataset.mapStatus=result.status;
          host.dataset.edgeVerification=result.connection?.verification||(action.connection?(result.phases?.includes('connection')?'context-only':'unmatched'):'');
          if(result.status==='focused'){
            host.dataset.focusedNode=result.id;status.textContent='';
            if(action.connection&&result.connection?.verification!=='exact-source'){
              status.textContent='Map context only; its source identity has not been matched here.';status.classList.remove('sr-only');
            }
          }
          else{status.textContent=result.message;playing=false;}
        }else{
          host.dataset.mapStatus='source-only';status.textContent='No saved graph node in this stage.';
          if(action.kind==='source'&&handoff)await openSavedWalkSource(handoff,{caseInfo:row.case,config,resourceBinding:row.resource_binding});
        }
      }catch(error){
        if(turn!==epoch)return;
        if(error.name==='AbortError'){host.dataset.mapStatus='paused';status.textContent='Map navigation paused.';}
        else{host.dataset.mapStatus='unavailable';status.textContent=error.message;playing=false;}
      }finally{
        if(turn===epoch){busy=false;controller=null;if(index===actions.length-1)playing=false;chrome();schedule();}
      }
    }
    play.onclick=()=>{if(playing||busy){stop();return;}playing=true;if(index===actions.length-1)activate(0,{automatic:true});else{chrome();schedule();}};
    document.addEventListener('pointerdown',event=>{if(!host.contains(event.target))stop();},true);
    document.addEventListener('wheel',event=>{if(!host.contains(event.target))stop();},{passive:true,capture:true});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')stop();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',stop);
    window.addEventListener('pagehide',stop,{once:true});
    await activate(0);host.dataset.status='ready';
    if(params.get('walk_autoplay')==='1'&&actions.length>1){playing=true;chrome();schedule();}
  }catch(error){host.replaceChildren(style,make('h2','KG Navigator'),make('p',error.message));host.dataset.status='unavailable';}
})();

// Presentation adapter only. The caller must first verify the source-method handle.
import {citation,check} from './r-contract.js';
import {evidenceLabel,visibleReadingOptions} from './workbench-source-realized-r.js';
import {reviewedSourceSummary,reviewedSourceRecord} from './workbench-reviewed-source.js?v=20261127-unified1';
import {renderStandardWorkbench} from './workbench-standard-view.js';

const list=value=>Array.isArray(value)?value:[];
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
export const sourceProofKey=p=>JSON.stringify([p.corpus,p.canonical_page_id,p.document_id,p.date,p.page_sha256,p.start,p.end,p.text]);
const unique=values=>[...new Map(values.filter(Boolean).map(value=>[sourceProofKey(value),value])).values()];
const maximum=values=>values.length?Math.max(...values):null;
const statusLabels={SOURCE_ASCRIBED:'Evidence-backed mosaic component',PARTIAL_SOURCE_ASCRIPTION:'Partially recovered',
  OPPOSING_SOURCE_ACCOUNT:'Opposing evidence',CONTESTED_SOURCE_ACCOUNTS:'Supporting and opposing evidence',
  SOURCE_VIEWS_RECORDED:'Qualified source views',CONTEXT_ONLY:'Related context',UNRESOLVED:'Unresolved'};

function focalFacts(facts,caseInfo){
  const marker=caseInfo.focal_marker,offset=typeof marker==='string'?caseInfo.query.indexOf(marker):-1;
  const start=offset<0?-1:Array.from(caseInfo.query.slice(0,offset)).length,end=start+Array.from(marker||'').length;
  return facts.filter(fact=>typeof fact.text==='string'&&marker&&fact.text.includes(marker)
    ||start>=0&&list(fact.query_spans).some(span=>span.start<end&&start<span.end));
}

function redactionBranch(branch,facts,pages,allowed){
  const proofMetadata={},sourceLinks=[],graphItems=[],nativeCandidates=[];
  const retain=(proof,factIds)=>{
    allowed.push(proof);const key=sourceProofKey(proof);
    proofMetadata[key]??={fact_ids:[],directions:[]};
    proofMetadata[key].fact_ids=[...new Set([...proofMetadata[key].fact_ids,...factIds])];
    return proof;
  };
  const candidates=branch.candidates.map(group=>{
    const representative=group.variants.find(variant=>variant.id===group.representative_id);
    check(representative,'recorded representative required; no best-grade substitution');
    const proofRows=[];
    for(const variant of group.variants){
      const reader=variant.source_reader,page=pages.get(reader.canonical_page_id);
      check(page,'source page is absent from the verified view');
      const main=retain(citation(page,reader.quote_span),facts.map(fact=>fact.id));proofRows.push(main);
      for(const key of ['phrase_span','qualification_span'])retain(citation(page,reader[key]),facts.map(fact=>fact.id));
      const direction=variant.priority.evidence_state==='DIRECT_SOURCE_APPROVED'?'SUPPORT':'CONTEXT';
      const contexts=list(reader.focal_source_contexts).map(context=>{
        const p=retain(citation(page,{...context.anchor,text:context.anchor.quote}),facts.map(fact=>fact.id));
        retain(citation(page,context.qualification_span),facts.map(fact=>fact.id));return p;
      });
      proofRows.push(...contexts);
      graphItems.push({id:variant.id});
      nativeCandidates.push({id:variant.id,reading_id:branch.reading.id,fill:variant.fill,
        source_wording:reader.phrase_span.text,source_span:[reader.phrase_span.start,reader.phrase_span.end],
        sources:[main],source_occurrences:[{source_wording:reader.phrase_span.text,
          source_span:[reader.phrase_span.start,reader.phrase_span.end],citation:main}]});
      for(const proof of [main,...contexts])for(const fact of facts){
        proofMetadata[sourceProofKey(proof)].directions.push(direction);
        sourceLinks.push({factId:fact.id,itemId:variant.id,proof,direction,
          basis:'RECORDED_SOURCE_PROPOSAL_FOR_FOCAL_READING',readingId:branch.reading.id,
          source_graph_edge:false,original_retrieval_claimed:false});
      }
    }
    const reader=representative.source_reader;
    return {id:group.id,rank:group.rank,fill:group.fill,priority:group.priority.value,
      label:evidenceLabel(group.priority),evidenceState:group.priority.evidence_state,
      proofs:unique(proofRows),details:{completedInput:representative.completed_input,
        originalPhrase:reader.phrase_span.text,transformation:representative.transformation.description,
        facets:representative.priority.focal_row?.raw_focal_assessment?.assessment?.facets||{},
        qualification:citation(pages.get(reader.canonical_page_id),reader.qualification_span)}};
  });
  return {id:branch.reading.id,label:branch.reading.explanation||branch.reading.outer_family,
    explanation:(branch.reading.explanation||'').replace(/\s*Function:.*$/s,'').replace(/\s*Requires a new constructor.*$/s,''),
    candidates,proofs:unique(candidates.flatMap(candidate=>candidate.proofs)),
    proofMetadata,sourceLinks,graphItems,nativeCandidates};
}

export function normalizeSourcePresentation(view,record,summary){
  check(view&&record&&summary&&view.case.case_id===record.case.case_id,'matching verified source case required');
  const allowedProofs=[];
  if(view.case.task==='redaction'){
    const facts=list(record.plan?.atoms),focal=focalFacts(facts,view.case),pages=new Map(view.source_pages.map(page=>[page.page_id,page]));
    check(facts.length>0,'actual public fact inventory is required');
    const allBranches=new Map(view.readings.map(branch=>[branch.reading.id,redactionBranch(branch,focal,pages,allowedProofs)]));
    const options=visibleReadingOptions(view),readings=options.map(option=>{
      const data=allBranches.get(option.branch.reading.id);
      return {...data,id:option.id,label:option.label,description:option.branch.reading.explanation};
    });
    return {task:'redaction',caseInfo:view.case,facts,readings,summary,allowedProofs:unique(allowedProofs),
      selectedReadingId:options.find(option=>option.id===view.selection.display_reading_id)?.id||options[0]?.id||'',
      candidates:[],units:[],proofs:[],proofMetadata:{},sourceLinks:[],graphItems:[],nativeCandidates:[],
      sourcePolicy:view.source_view_policy,originalMethodId:view.method_id};
  }
  const facts=view.atoms.map(atom=>({id:atom.id,text:atom.text,query_spans:atom.query_spans})),proofMetadata={},sourceLinks=[],relatedProofs=[];
  const units=view.atoms.map(atom=>{
    const evidence=list(atom.evidence).filter(row=>!row.temporal_eligibility_hold),proofs=[];
    const decisive=evidence.filter(entry=>entry.direction!=='CONTEXT'),selected=decisive.length?decisive:evidence;
    const totals={SUPPORT:new Map(),OPPOSE:new Map(),CONTEXT:new Map(),PARTIAL:new Map()};
    for(const entry of [...list(atom.evidence),...list(atom.held_source_context)]){
      if(entry.citation)allowedProofs.push(entry.citation);
      if(entry.qualification_citation)allowedProofs.push(entry.qualification_citation);
    }
    for(const entry of evidence){
      const p=entry.citation,key=sourceProofKey(p),direction=entry.direction;
      if(!selected.includes(entry)){relatedProofs.push(p);continue;}
      proofMetadata[key]??={fact_ids:[],directions:[]};
      if(!proofMetadata[key].fact_ids.includes(atom.id))proofMetadata[key].fact_ids.push(atom.id);
      if(!proofMetadata[key].directions.includes(direction))proofMetadata[key].directions.push(direction);
      proofs.push(p);sourceLinks.push({factId:atom.id,itemId:atom.id,proof:p,direction,
        basis:'RECORDED_SOURCE_ASSESSMENT',source_graph_edge:false,original_retrieval_claimed:false});
      if(totals[direction])totals[direction].set(p.document_id,Math.max(totals[direction].get(p.document_id)||0,entry.context_priority_index));
    }
    return {id:atom.id,text:atom.text,label:statusLabels[atom.status]||atom.label||atom.status,
      status:atom.status,score:maximum(selected.map(entry=>entry.context_priority_index)),
      complete:atom.complete_by_model_source_review===true,proofs:unique(proofs),
      directionalTotals:Object.fromEntries(Object.entries(totals).map(([sign,docs])=>[sign,[...docs.values()].reduce((a,b)=>a+b,0)])),
      evidence:selected.map(entry=>({proof:entry.citation,direction:entry.direction,score:entry.context_priority_index,
        voice:entry.source_attribution?.speaker_quote||'',details:entry.review?.reason||''}))};
  });
  return {task:view.case.task,caseInfo:view.case,facts,readings:[],selectedReadingId:'',summary,
    candidates:[],units,proofs:unique(units.flatMap(unit=>unit.proofs)),proofMetadata,sourceLinks,
    graphItems:units.map(unit=>({id:unit.id})),nativeCandidates:[],allowedProofs:unique(allowedProofs),
    relatedProofs:unique(relatedProofs),
    sourcePolicy:view.source_view_policy,originalMethodId:view.method_id};
}

export function sourceAccountMap(data,readingId=data.selectedReadingId){
  const branch=data.task==='redaction'?data.readings.find(reading=>reading.id===readingId):data;
  check(branch,'selected recorded source reading required');
  const paths=branch.sourceLinks.map((link,index)=>({id:'source-account-'+index,
    candidate_or_atom_id:data.task==='redaction'?readingId+'/'+link.itemId:link.itemId,
    query_atom_id:link.factId,direction:link.direction,steps:[],graph_hops:0,route_mode:'DIRECT_SOURCE_HANDOFF',
    original_traversal_claimed:false,decision_source_refs:[link.proof],source_refs:[link.proof],
    display_association_basis:link.basis}));
  return {trace:{version:'source-account-presentation-map/1',task:data.task,reading_id:readingId,
    paths,steps:[],sources:{},original_traversal_claimed:false,source_graph_edges_created:false},
    plan:{atoms:data.facts},items:branch.graphItems,nativeCandidates:branch.nativeCandidates,
    proofs:branch.proofs,sourcePolicy:data.sourcePolicy};
}

export function renderStandardSourceWorkspace(handle,options){
  const assertCurrent=()=>{reviewedSourceSummary(handle);options.assertSelectionCurrent?.();};
  assertCurrent();const summary=reviewedSourceSummary(handle),view=handle.view;
  check(options.record===reviewedSourceRecord(handle),'presentation requires the exact reader-bound record');
  const data=normalizeSourcePresentation(view,options.record,summary);
  const selectedId=data.readings.some(reading=>reading.id===options.selectedReadingId)
    ?options.selectedReadingId:data.selectedReadingId;
  const branch=data.task==='redaction'?data.readings.find(reading=>reading.id===selectedId):data;
  const onSource=proof=>{
    assertCurrent();check(data.allowedProofs.some(allowed=>same(allowed,proof)),
      'source callback outside the current verified method');return options.onSource(proof);
  };
  const renderDigest=async host=>{
    const record=options.record,native=view.original_native?.native_ref||view.original_native_ref;
    const binding={case_id:view.case.case_id,config:record.config,method_id:view.method_id,
      query_sha256:view.query_sha256,original_view_sha256:view.original_view_sha256,public_view_sha256:view.sha256,
      native_checkpoint_sha256:native.sha256,native_checksum:record.native_checksum,
      source_view_policy:structuredClone(view.source_view_policy)};
    check(typeof options.renderVerifiedDigest==='function','an actual source-method summary is required');
    const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
    const expected=freeze(structuredClone(binding));
    const context=Object.freeze({binding:expected,assertCurrent:()=>{assertCurrent();return expected;},onSource});
    const pending=document.createElement('p');pending.textContent='Loading the recorded analyst summary...';host.append(pending);
    const digest=await options.renderVerifiedDigest(context);assertCurrent();
    check(digest&&[1,11].includes(digest.nodeType),'the verified model summary is unavailable');
    host.replaceChildren(digest);
  };
  const proofMetadata=Object.entries(branch?.proofMetadata||{}).flatMap(([key,meta])=>{
    const proof=branch.proofs.find(value=>sourceProofKey(value)===key);return proof?
      (meta.directions.length?meta.directions:[null]).map(direction=>({proof,atom_ids:meta.fact_ids,direction})):[];
  });
  return renderStandardWorkbench({...data,...branch,...options,selectedReadingId:selectedId,
    proofMetadata,assertCurrent,onSource,renderDigest,
    onMapMount:(host,selection)=>options.onMapMount?.(host,{...data,...selection,
      map:sourceAccountMap(data,selection?.readingId||selectedId)})});
}

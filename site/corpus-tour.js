import {CORPORA,TASKS,loadSavedCatalog,savedInvestigation,savedStoryQuestion,savedQuestionURL} from './narrative-catalog-v1.js';
import {contextSections} from './narrative-context-v1.js';

const descriptions={
  mosaic:'Assemble only the components supported by eligible source quotations. Unresolved components remain gaps.',
  hypothesis:'Compare the full claim with the saved evidence. Attribution, uncertainty and consideration are not completed actions.',
  redaction:'Inspect the masked question and its proposed fills. Contextual rank is not an answer or factual support.'
};
const node=(tag,text,className)=>{const item=document.createElement(tag);if(text!=null)item.textContent=text;if(className)item.className=className;return item;};
function questionStep(match,task,label){
  const row=match.row,c=row.case,item=node('li',null,'tour-question');item.dataset.task=task;item.dataset.case=c.case_id;
  item.append(node('h3',label),node('p',descriptions[task],'story-note'));
  const words=c.query.trim().split(/\s+/),excerpt=words.slice(0,28).join(' ')+(words.length>28?'...':'');
  const question=node('blockquote',excerpt);question.dataset.testid='tour-public-query';item.append(question);
  if(words.length>28){const detail=node('details');detail.append(node('summary','Read the complete saved question'),node('p',c.query));item.append(detail);}
  item.append(node('p',`Question origin: ${c.document_id} / ${c.date}. Provenance only; this whole document is excluded from evidence.`,'story-note'));
  const actions=node('div',null,'tour-actions'),original=node('a','Inspect the original document');
  original.href=savedQuestionURL(match,{stage:'01'});original.dataset.testid='tour-origin';
  const open=node('a',`Open saved ${label}`);open.href=savedQuestionURL(match);open.dataset.testid='tour-question';
  actions.append(original,open);item.append(actions);return item;
}
function storyTour(report,story,corpus){
  const tour=report.presentation_tours?.[story?.id];
  if(tour?.approved_spoiler_safe!==true||tour.presentation_only_never_inference_input!==true||tour.corpus!==corpus||
      !/^\d{4}-\d{2}-\d{2}$/.test(tour.cutoff_exclusive)||!Array.isArray(tour.stops)||!tour.stops.length)return null;
  const row=report.cases.find(value=>value.case.corpus===corpus&&value.narrative_id===story.id),binding=row?.resource_binding;
  if(!binding||binding.resource_id!==tour.resource_id||!binding.graph_id||!binding.hierarchy_id)return null;
  const before=new Date(tour.cutoff_exclusive+'T00:00:00Z');before.setUTCDate(before.getUTCDate()-1);const asOf=before.toISOString().slice(0,10);
  const section=node('section',null,'tour-orientation story-tour');section.dataset.testid='bound-story-tour';
  section.append(node('p',`${tour.duration_seconds||75} seconds / source stops`,'eyebrow'),node('h2','A short tour of this record.'),
    node('p',`Use the earlier source view through ${asOf}. The map date is inclusive; the workbench requires evidence strictly before ${tour.cutoff_exclusive}. The independent map does not exclude the question’s origin document.`,'story-note'));
  for(const stop of tour.stops){
    const quote=stop.quotation,endpoint=stop.nodes?.[0];
    if(stop.cross_stop_traversal_claimed!==false||!endpoint?.node_id||!endpoint.label||!quote?.text||!quote.document_id||
        !(quote.publication_date<tour.cutoff_exclusive)||!stop.actual_edge_id)continue;
    const card=node('article',null,'tour-question');card.dataset.testid='bound-tour-stop';
    card.append(node('h3',`New map search: ${endpoint.label}`),node('p','Open the exact recorded node, center on all direct connections, then inspect its source relation. Each stop starts a separate search; no path between the stops is claimed.','story-note'),
      node('blockquote',quote.text),node('p',`${quote.document_id} / ${quote.publication_date}`,'story-note'));
    const params=new URLSearchParams({corpus,node:endpoint.node_id,release:'earlier',as_of:asOf,
      resource_id:binding.resource_id,registry_sha256:binding.registry_sha256,index_sha256:binding.index_sha256,
      focus_graph_id:binding.graph_id,focus_hierarchy_id:binding.hierarchy_id,return_to:location.pathname+location.search});
    const actions=node('div',null,'tour-actions'),open=node('a','Inspect this recorded node');open.href='graph-full-v6.html?'+params;open.dataset.testid='bound-tour-node';actions.append(open);card.append(actions);section.append(card);
  }
  if(!section.querySelector('[data-testid=bound-tour-stop]'))return null;
  section.append(node('p','The hierarchy is retrospective navigation. A source relation or community membership does not establish an answer. Return to the saved questions below to inspect their separate decisions.','story-note'));
  return section;
}
async function start(){
  const params=new URLSearchParams(location.search),corpus=params.get('corpus'),entry=CORPORA.find(([id])=>id===corpus);
  const status=document.querySelector('#tour-status');
  for(const [id,label] of CORPORA){const link=node('a',label);link.href='corpus-tour.html?'+new URLSearchParams({corpus:id});if(id===corpus)link.setAttribute('aria-current','page');document.querySelector('#tour-corpora').append(link);}
  if(!entry||params.getAll('corpus').length!==1){status.textContent='Choose a collection above. No story or graph is substituted.';status.dataset.status='unavailable';return;}
  const graph='graph-full-v6.html?'+new URLSearchParams({corpus});
  document.querySelector('#nav-graph').href=graph;
  try{
    const {report}=await loadSavedCatalog(),story=savedInvestigation(report,corpus);
    document.querySelector('#tour-collection').textContent=entry[1];
    document.querySelector('#tour-title').textContent=story?.title||'Explore this collection';
    const introduction=contextSections(report,{case:{corpus},narrative_id:story?.id});if(introduction)status.before(introduction);
    const levels=document.querySelector('#tour-map-levels');
    for(const [level,label] of [['domain','Start with domains'],['theme','Explore themes'],['community','Explore communities']]){
      const link=node('a',label);link.href='graph-full-v6.html?'+new URLSearchParams({corpus,level});link.dataset.level=level;levels.append(link);
    }
    document.querySelector('#tour-orientation').hidden=false;
    document.querySelector('#tour-orientation').dataset.mapScope='CORPUS_OVERVIEW_ORIENTATION_ONLY';
    const tour=storyTour(report,story,corpus);if(tour)document.querySelector('#tour-orientation').after(tour);
    const matches=TASKS.map(([task,label])=>({task,label,match:savedStoryQuestion(report,corpus,task,{story})})).filter(({match})=>
      match&&typeof match.row.case.query==='string'&&match.row.case.query.trim()&&
      typeof match.row.case.document_id==='string'&&match.row.case.document_id&&/^\d{4}-\d{2}-\d{2}$/.test(match.row.case.date));
    for(const {task,label,match} of matches)document.querySelector('#tour-steps').append(questionStep(match,task,label));
    document.querySelector('#tour-questions').hidden=!matches.length;
    document.querySelector('#tour-limit').hidden=false;
    if(matches.length)document.querySelector('#nav-workbench').href=savedQuestionURL(matches[0].match);
    status.textContent=matches.length?`${matches.length} saved ${story?.collection==='bench'?'bench':'starter'} tasks in this investigation. Start with the map, then open the available questions below.`:
      'No source-bound saved starter is published for this story. The existing corpus map remains available for general exploration.';
    status.dataset.status='ready';
  }catch{
    status.textContent='The saved story could not be verified. Open the existing corpus map for general exploration; no question or source route is substituted.';
    status.dataset.status='unavailable';
  }
}
await start();

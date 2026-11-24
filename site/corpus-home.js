"use strict";
import {CORPORA,TASKS,loadSavedCatalog,savedInvestigation,savedStoryQuestion,savedQuestionURL,savedCondition,savedRedactionOutcome,ADDITIONAL_COLLECTION,questionCollection} from './narrative-catalog-v1.js';
import {contextSections} from './narrative-context-v1.js';
import {hasOpenedResult} from './narrative-attempts-v1.js';
import {gateWalkthrough} from './narrative-guide-access-v1.js';
// Keep the older Home bookmark on the same reader copy without changing its data.
document.title='Matryoshka | Home';
const welcome=document.querySelector('.welcome');
if(welcome){
  welcome.querySelector('.eyebrow').textContent='Historical records and source-based analysis';
  const title=welcome.querySelector('#welcome-title'),emphasis=document.createElement('em');
  emphasis.textContent='with Matryoshka.';
  title.replaceChildren('Explore historical records',document.createElement('br'),emphasis);
  welcome.querySelector('.lede').textContent='Matryoshka connects people, events and claims in intelligence bulletins and diplomatic cables. Explore those connections, then inspect the original passages behind a saved analysis.';
  welcome.querySelector('.destination.graph p').textContent='Browse people, organizations, events and claims extracted from each collection. Open a connection to inspect its source passages.';
  welcome.querySelector('.destination.workbench p').textContent='Follow saved analyses of missing text, historical claims and multi-part questions. Compare candidates and check the evidence behind each result.';
  welcome.querySelector('.graph .destination-action').textContent='Open the knowledge graph';
  welcome.querySelector('.workbench .destination-action').textContent='Open the analyst workbench';
}
function element(tag,text,className){
  const value=document.createElement(tag);if(text!=null)value.textContent=text;
  if(className)value.className=className;return value;
}
function taskEntry(report,corpus,task,label,options){
  const entry=element('li',null,'story-step'),match=savedStoryQuestion(report,corpus,task,options);
  entry.dataset.task=task;
  if(match){
    const link=element('a',label);link.href=savedQuestionURL(match,options);link.dataset.case=match.row.case.case_id;
    link.title=match.row.presentation_title||label;entry.append(link);
    if(options.bench&&match.row.presentation_title)entry.append(element('span',match.row.presentation_title,'bench-title'));
  }else{entry.append(element('span',label),element('span',report.qualified_release_ready===true?'Not yet released':'Pending','story-pending'));entry.dataset.pending='true';}
  return entry;
}
function renderStories(manifest,report){
  const host=document.querySelector('#narrative-stories'),bench=document.querySelector('#narrative-bench-cells');
  const cards=[],benchCards=[];
  for(const [corpus,label] of CORPORA){
    const story=savedInvestigation(report,corpus),card=element('article',null,'story-card');card.dataset.corpus=corpus;
    const supplied=typeof story?.title==='string'&&story.title.trim();
    const isBench=story?.collection==='bench';card.dataset.collection=isBench?'bench':'starter';
    card.append(element('p',label+(isBench?' · Bench':''),'eyebrow'),element('h3',supplied?story.title:story?'Explore this investigation':'Story pending'));
    const introduction=contextSections(report,{case:{corpus},narrative_id:story?.id});if(introduction){const background=element('details',null,'story-background');background.append(element('summary','Historical background'),introduction);card.append(background);}
    const steps=element('ol',null,'story-steps'),tour=element('li',null,'story-step'),map=element('a','KG tour');
    map.href='corpus-tour.html?'+new URLSearchParams({corpus});
    map.title='Start with this story, orient in the existing map, then inspect saved questions.';map.dataset.testid='story-map';tour.append(map);steps.append(tour);
    for(const [task,name] of TASKS)steps.append(taskEntry(report,corpus,task,name,{story,bench:isBench}));
    card.append(steps);cards.push(card);
    const benchCard=element('article',null,'bench-card');benchCard.dataset.corpus=corpus;
    benchCard.append(element('h3',label));const benchSteps=element('ul',null,'story-steps');
    if(isBench)benchSteps.append(element('li','This bench narrative is available in the story card above.','story-note'));
    else for(const [task,name] of TASKS)benchSteps.append(taskEntry(report,corpus,task,name,{bench:true}));
    benchCard.append(benchSteps);benchCards.push(benchCard);
  }
  host.replaceChildren(...cards);host.dataset.status='ready';bench.replaceChildren(...benchCards);
  const starters=report.cases.filter(row=>row.selected_demo===true&&savedCondition(row)).length,benches=report.cases.filter(row=>row.selected_bench===true&&savedCondition(row)).length;
  document.querySelector('#narrative-bench').hidden=benches===0;
  document.querySelector('#story-status').textContent='Explore the map, then follow each investigation through its three saved tasks.';
  const extras=report.cases.filter(row=>questionCollection(row)===ADDITIONAL_COLLECTION&&savedCondition(row)).length;
  document.querySelector('#core-saved-counts').textContent=report.qualified_release_ready===true?
    `Released: ${starters}/9 starter tasks · ${benches}/9 bench tasks · ${extras}/5 additional CIB redactions. ${Math.max(0,23-starters-benches-extras)} questions are not yet released.`:
    `${starters} saved tasks across three collections${benches?` / ${benches} bench tasks`:''}.`;
}
async function renderAdditional(report){
  const host=document.querySelector('#additional-redaction-cases'),rows=report.cases.filter(row=>questionCollection(row)===ADDITIONAL_COLLECTION);
  const entries=await Promise.all(rows.map(async row=>{
    const card=element('article',null,'bench-card additional-redaction-card');card.dataset.case=row.case.case_id;
    card.append(element('h3',row.presentation_title||'CIB redaction'));
    const match=savedCondition(row),outcome=hasOpenedResult(report,row)?await savedRedactionOutcome(match):{label:'Saved result',detail:'Open this task’s completed analysis to inspect its outcome.'},label=element('p',outcome.label,'additional-outcome');
    label.title=outcome.detail;label.dataset.testid='additional-outcome';card.append(label);
    if(match){const link=element('a','Open saved Redaction');link.href=savedQuestionURL(match);card.append(link);}
    else card.append(element('p','Saved execution pending','story-note'));
    return card;
  }));
  host.replaceChildren(...entries);
  const available=rows.filter(row=>savedCondition(row)).length;
  document.querySelector('#additional-redaction-status').textContent=rows.length?
    `${available} saved executions / ${rows.length} published additional redactions. Separate from the starter and bench tasks.`:
    report.qualified_release_ready===true?'Released: 0/5 additional CIB redactions. Five are not yet released.':'No additional CIB redactions have been published in this saved selection.';
}
async function openStories(){
  const host=document.querySelector('#narrative-stories');if(!host)return;
  try{
    const {manifest,report}=await loadSavedCatalog();gateWalkthrough(report);renderStories(manifest,report);await renderAdditional(report);
  }catch{
    host.replaceChildren();host.dataset.status='unavailable';
    document.querySelector('#story-status').textContent='Saved stories are unavailable. The corpus maps and workbench remain accessible.';
    document.querySelector('#additional-redaction-status').textContent='The additional collection could not be verified.';
  }
}
// Preserve bookmarked case links when the site root is now the landing page.
const previous = new URL(location.href);
if (previous.searchParams.has("case") && previous.searchParams.get("view") !== "home") {
  const target = new URL("workbench-v6.html", location.href);
  target.search = previous.search;
  target.hash = previous.hash;
  location.replace(target.href);
}else await openStories();

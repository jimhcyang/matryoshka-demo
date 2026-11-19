// Sealed presentation prose only. This module never modifies a query or plan.
import {storyAccess} from './narrative-attempts-v1.js';
const make=(tag,text,className)=>{const value=document.createElement(tag);if(text!=null)value.textContent=text;if(className)value.className=className;return value;};
const pin=value=>typeof value?.path==='string'&&value.path&&!value.path.startsWith('/')&&/^[a-f0-9]{64}$/.test(value.sha256||'');
const canonical=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):value);
const sourceRequests=new Map();

function boundParagraph(value){
  if(!value||typeof value.text!=='string'||!value.text.trim())return null;
  if(pin(value.sources_ref))return value;
  if(!Array.isArray(value.citations)||!value.citations.length||value.citations.some(c=>!c||typeof c.document_id!=='string'||!c.document_id||typeof c.text!=='string'||!c.text.trim()))return null;
  return value;
}

async function deferredSources(report,row){
  const corpus=row.case.corpus,narrative=row.narrative_id||'',ref=report.presentation_context_sources_ref;
  if(!pin(ref)||!storyAccess(report,row).unlocked)throw Error('The source bindings are available after the story results are opened.');
  const id=canonical([report.run_id,ref,corpus,narrative]);
  if(!sourceRequests.has(id))sourceRequests.set(id,(async()=>{
    const response=await fetch('/api/narrative-v1/presentation-context-sources?'+new URLSearchParams({corpus,narrative_id:narrative}),{cache:'no-store'});
    if(!response.ok)throw Error('The introduction source bindings are unavailable.');
    const packet=await response.json();
    if(packet.version!=='narrative-presentation-context-sources/1'||packet.corpus!==corpus||packet.narrative_id!==narrative||
        packet.report_run_id!==report.run_id||canonical(packet.sources_ref)!==canonical(ref))throw Error('The introduction source binding belongs to another saved story.');
    if(ref.payload_sha256){
      const bytes=new TextEncoder().encode(canonical(packet.content).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0')));
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
      if(hash!==ref.payload_sha256)throw Error('The introduction source content failed its integrity check.');
    }
    return packet.content||packet;
  })());
  return sourceRequests.get(id);
}

function sourceList(sources){
  if(!Array.isArray(sources)||!sources.length||sources.some(source=>typeof source?.document_id!=='string'||typeof source.text!=='string'))throw Error('No source-bound introduction citations were supplied.');
  const list=make('ul');
  for(const source of sources){
    const item=make('li');item.append(make('p',[source.document_id,source.date||source.publication_date].filter(Boolean).join(' / ')));
    if(source.kind==='CORPUS_METADATA_FIELD_NOT_HISTORICAL_QUOTATION')item.append(make('p','Collection metadata: '+source.text));
    else item.append(make('blockquote',source.text));list.append(item);
  }
  return list;
}

export function presentationContext(report,row){
  const context=report?.presentation_context;
  if(context?.presentation_only!==true)return null;
  const corpus=boundParagraph(context.corpora?.[row?.case?.corpus]);
  const narrative=boundParagraph(context.narratives?.[row?.narrative_id]);
  return corpus||narrative?{corpus,narrative}:null;
}

export function contextSections(report,row){
  const context=presentationContext(report,row);if(!context)return null;
  const host=make('section',null,'narrative-context');host.dataset.testid='narrative-context';
  host.setAttribute('aria-label','Historical introduction');
  for(const [key,title] of [['corpus','About this corpus'],['narrative','The situation']]){
    const value=context[key];if(!value)continue;
    const section=make('section',null,'narrative-context-card');section.dataset.context=key;
    section.append(make('h2',title),make('p',value.text,'narrative-context-text'));
    if(!storyAccess(report,row).unlocked){host.append(section);continue;}
    const citations=make('details',null,'narrative-context-sources');citations.append(make('summary','Sources for this introduction'));
    if(value.sources_ref){
      let loaded=false;
      citations.addEventListener('toggle',async()=>{
        if(!citations.open||loaded)return;loaded=true;
        const status=make('p','Opening the source bindings…');citations.append(status);
        try{
          const packet=await deferredSources(report,row),sources=key==='corpus'?packet.corpora?.[row.case.corpus]?.citations:packet.narratives?.[row.narrative_id]?.citations;
          status.replaceWith(sourceList(sources));
        }catch(error){status.textContent=error.message;}
      });
    }else citations.append(sourceList(value.citations));
    section.append(citations);host.append(section);
  }
  return host;
}

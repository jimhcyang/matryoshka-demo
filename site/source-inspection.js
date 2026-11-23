// Presentation only. Native code-point spans and indexed PDF routes are the authority.
import {currentPDFURL} from './local-decisions-v65.js';
import pageLocators from './source-pdf-locators.js';

export function exactSourceAnchor(text, proof) {
  const chars=Array.from(text);
  if(!Number.isSafeInteger(proof?.start)||!Number.isSafeInteger(proof?.end)||
      proof.start<0||proof.end<=proof.start||proof.end>chars.length||
      typeof proof.text!=='string'||chars.slice(proof.start,proof.end).join('')!==proof.text)
    throw Error('The exact source quotation does not replay.');
  return {start:proof.start,end:proof.end,text:proof.text};
}

export function focalReferenceFromOrigin(c,masked,revealed) {
  const before=Array.from(masked.text),after=Array.from(revealed.text);
  const a=(masked.anchors||[]).filter(anchor=>anchor.text===c.focal_marker);
  const b=a.length===1?(revealed.anchors||[]).filter(anchor=>anchor.start===a[0].start):[];
  if(masked.focal_revealed!==false||revealed.focal_revealed!==true||a.length!==1||b.length!==1||
      !b[0].text||b[0].text===c.focal_marker)
    throw Error('The revealed focal source anchor does not replay against the masked original. No reference is inferred.');
  exactSourceAnchor(masked.text,a[0]);exactSourceAnchor(revealed.text,b[0]);
  if(after.slice(0,b[0].start).join('')+c.focal_marker+after.slice(b[0].end).join('')!==before.join(''))
    throw Error('The revealed origin changes more than the focal mask.');
  return b[0].text;
}

const pageNumber=value=>Number.isSafeInteger(value)&&value>0?value:null;
const SHA=/^[a-f0-9]{64}$/;
const indexRequests=new Map();
async function byteHash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');}
async function boundedBytes(response,limit){
  if(!response.ok)throw Error('The published source file is unavailable.');
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>limit)throw Error('The source file exceeds the inspection limit.');
  const reader=response.body?.getReader();if(!reader)throw Error('The source file has no readable bytes.');
  const chunks=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>limit){await reader.cancel();throw Error('The source file exceeds the inspection limit.');}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function loadSourcePDFIndex(){
  const runtime=document.querySelector('script#matryoshka-public-api')||document.querySelector('script[src$="runtime/public-runtime.js"]');
  const pin=document.querySelector('meta[name="source-api-index-sha256"]')?.content||runtime?.dataset.indexSha256;
  if(!SHA.test(pin||''))throw Error('The source PDF catalog has no valid byte pin.');
  const url=new URL('data/api-index.json',import.meta.url),key=url.href+'#'+pin;
  if(url.origin!==location.origin)throw Error('The source PDF catalog must be same-origin.');
  if(!indexRequests.has(key))indexRequests.set(key,(async()=>{
    let index;
    if(runtime&&globalThis.PublicReplay?.ready){
      if(runtime.dataset.indexSha256!==pin)throw Error('The PDF catalog and public runtime pins differ.');
      // PublicReplay.ready performs the byte-level index SHA check using its native asset transport.
      index=await globalThis.PublicReplay.ready;
    }else{
      const bytes=await boundedBytes(await fetch(url,{credentials:'omit',redirect:'error',mode:'same-origin',cache:'no-store'}),64*1024**2);
      if(await byteHash(bytes)!==pin)throw Error('The source PDF catalog failed its byte pin.');
      index=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    }
    if(index?.version!=='matryoshka-public-api-index/1'||!index.entries||Array.isArray(index.entries))throw Error('Unsupported source PDF catalog.');
    return index;
  })());
  try{return await indexRequests.get(key);}catch(error){indexRequests.delete(key);throw error;}
}
export async function cibPDFPair({page,proof={},binding,caseId,config,base=globalThis.location?.href,index}={}) {
  if(!page?.document_id||proof.document_id&&proof.document_id!==page.document_id)
    throw Error('The PDF locator belongs to another source document.');
  const catalog=index??await loadSourcePDFIndex();
  if(!catalog?.entries)return [];
  const hash=page.source_sha256||page.page_sha256,locator=pageLocators[page.canonical_page_id||page.id];
  if(proof.page_sha256&&proof.page_sha256!==hash)throw Error('The PDF source hash differs from the citation.');
  const paired=locator?.document_id===page.document_id&&[locator.source_sha256,locator.later_sha256].includes(hash)?locator:null;
  const result=[];
  for(const release of ['earlier','later']){
    const direct=pageNumber(proof[release+'_page']),stored=pageNumber(page[release+'_page']);
    const recorded=pageNumber(page[release+'_source_page']),aligned=pageNumber(paired?.[release+'_page']);
    const physical=page.source_page;
    const source=physical&&typeof physical==='object'&&physical.release===release?
      pageNumber(physical.page??physical.physical_page):null;
    const numbers=[direct,stored,recorded,source,aligned].filter(value=>value!==null);
    if(new Set(numbers).size>1)throw Error('Conflicting recorded PDF page locators.');
    const number=numbers[0]??null;
    let route=currentPDFURL('/api/cib-pdf?'+new URLSearchParams({doc_id:page.document_id,release}),
      {binding,caseId,config},base);
    const key=url=>url.pathname+'?'+new URLSearchParams([...url.searchParams].sort(([a],[b])=>a.localeCompare(b)));
    let entry=catalog.entries[key(route)],scope=binding?'case-resource':'document-catalog';
    // Catalog PDF inspection is not a source API fallback or an eligibility upgrade.
    if(!entry&&binding&&/^[a-f0-9]{64}$/.test(hash||'')){
      const catalogRoute=currentPDFURL('/api/cib-pdf?'+new URLSearchParams({doc_id:page.document_id,release}),{},base);
      const published=catalog.entries[key(catalogRoute)];
      if(published){route=catalogRoute;entry=published;scope='document-catalog';}
    }
    if(!entry||entry.mime!=='application/pdf'||!/^[a-f0-9]{64}$/.test(entry.sha256||''))continue;
    if(entry.encoding!=='identity'||!SHA.test(entry.wire_sha256||'')||entry.external_url||
        !/^data\/replays\/[a-f0-9]{64}\.pdf$/.test(entry.path||'')||entry.path.split('/').at(-1)!==entry.wire_sha256+'.pdf')
      throw Error('The PDF catalog entry is not a pinned local PDF asset.');
    const asset=new URL(entry.path,new URL('./',base));
    if(asset.origin!==new URL(base).origin)throw Error('The PDF asset must be same-origin.');
    if(number)route.hash='page='+number;
    result.push({release,page:number,href:route.href,asset_url:asset.href,sha256:entry.sha256,wire_sha256:entry.wire_sha256,
      document_id:page.document_id,scope,inspection_only:true});
  }
  return result;
}

async function verifiedPDFBytes(item,signal){
  let bytes;
  if(globalThis.PublicReplay?.verified){
    const packet=await globalThis.PublicReplay.verified(item.href,signal);bytes=packet.wire;
    if(bytes.byteLength>32*1024**2)throw Error('The PDF exceeds the inspection limit.');
  }else bytes=await boundedBytes(await fetch(item.asset_url,{credentials:'omit',redirect:'error',mode:'same-origin',signal}),32*1024**2);
  const hash=await byteHash(bytes);
  if(hash!==item.wire_sha256||hash!==item.sha256||!new TextDecoder('ascii').decode(bytes.slice(0,1024)).includes('%PDF-'))throw Error('The original PDF failed its byte check.');
  return bytes;
}
let nextPair=0;
function sourcePDFStyles(){
  if(document.querySelector('link[data-source-inspection-style]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('source-inspection.css',import.meta.url).href;link.dataset.sourceInspectionStyle='true';document.head.append(link);
}
export async function appendCIBPDFPair(host,options) {
  const links=await cibPDFPair(options);
  if(!links.length)return null;
  sourcePDFStyles();
  const section=document.createElement('section');section.className='source-pdf-pair';
  section.dataset.testid='source-pdf-pair';
  const heading=document.createElement('h3');heading.textContent='Original PDFs';section.append(heading);
  for(const item of links){
    const label=document.createElement('span');label.className='source-pdf-locator';
    label.textContent=item.release.toUpperCase()+' / '+(item.page?'page '+item.page:'page not recorded');
    label.dataset.release=item.release;label.dataset.documentId=item.document_id;
    label.dataset.pdfScope=item.scope;label.dataset.inspectionOnly='true';
    label.dataset.pdfSha256=item.sha256;if(item.page)label.dataset.pdfPage=String(item.page);
    section.append(label);
  }
  const button=document.createElement('button');button.type='button';button.textContent='View PDF pair';
  button.dataset.testid='source-pdf-open';button.setAttribute('aria-expanded','false');
  const views=document.createElement('div');views.className='source-pdf-views';views.hidden=true;views.id='source-pdf-pair-'+(++nextPair);
  button.setAttribute('aria-controls',views.id);
  const status=document.createElement('p');status.className='note';status.setAttribute('role','status');status.dataset.testid='source-pdf-status';
  const note=document.createElement('p');note.className='note';
  note.textContent='Release comparison only. The later PDF is not additional evidence.';
  section.append(button,status,views,note);host.append(section);
  let controller=null,urls=[],observer=null,dialog=null,epoch=0;
  function hide(){
    epoch++;controller?.abort();controller=null;for(const url of urls)URL.revokeObjectURL(url);urls=[];
    for(const frame of views.querySelectorAll('iframe'))frame.removeAttribute('src');views.replaceChildren();views.hidden=true;
    section.dataset.pdfStatus='idle';button.textContent='View PDF pair';button.setAttribute('aria-expanded','false');status.textContent='';button.disabled=false;
  }
  function dispose(){hide();observer?.disconnect();observer=null;dialog?.removeEventListener('close',dispose);globalThis.removeEventListener('pagehide',dispose);}
  button.onclick=async()=>{
    if(controller){hide();return;}
    if(links.length!==2){status.textContent='Both release PDFs are not published in this catalog.';return;}
    controller=new AbortController();const signal=controller.signal,run=++epoch;
    dialog=section.closest('dialog');dialog?.addEventListener('close',dispose);
    observer?.disconnect();observer=new MutationObserver(()=>{if(!section.isConnected||section.closest('dialog:not([open]),[hidden],[aria-hidden="true"]'))dispose();});
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open','aria-hidden']});
    globalThis.addEventListener('pagehide',dispose,{once:true});
    section.dataset.pdfStatus='loading';button.textContent='Cancel PDF loading';status.textContent='Verifying the two original PDF files...';
    try{
      const files=await Promise.all(links.map(item=>verifiedPDFBytes(item,signal)));
      if(signal.aborted||run!==epoch||!section.isConnected)return;
      links.forEach((item,index)=>{
        const url=URL.createObjectURL(new Blob([files[index]],{type:'application/pdf'}));urls.push(url);
        const column=document.createElement('section');column.className='source-pdf-column';
        const heading=document.createElement('h4');heading.textContent=item.release.toUpperCase()+' / '+(item.page?'page '+item.page:'page not recorded');
        const frame=document.createElement('iframe');frame.title=heading.textContent+' / '+item.document_id;
        frame.referrerPolicy='no-referrer';frame.src=url+(item.page?'#page='+item.page:'');frame.dataset.release=item.release;
        if(item.page)frame.dataset.pdfPage=String(item.page);
        const download=document.createElement('a');download.href=url;download.download=item.document_id+'-'+item.release+'.pdf';download.textContent='Download verified '+item.release+' PDF';
        column.append(heading,frame,download);views.append(column);
      });
      views.hidden=false;section.dataset.pdfStatus='verified';button.textContent='Hide PDF pair';button.setAttribute('aria-expanded','true');status.textContent='Both original PDF files verified.';
    }catch(error){if(!signal.aborted&&run===epoch){hide();section.dataset.pdfStatus='unavailable';status.textContent=error.message+' No PDF is substituted.';}}
  };
  section.disposeSourcePDFs=dispose;
  return section;
}

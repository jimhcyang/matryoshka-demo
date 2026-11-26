// Local, byte-verified release inspection only; no evidence or page inference.
import {renderVerifiedPDF} from './source-pdf-canvas.js';
const SHA=/^[a-f0-9]{64}$/;
export function workbenchPDFURL(item,base=location.href){
  const url=new URL(item.asset_url,base),root=new URL(base);
  if(url.origin!==root.origin||!/^https?:$/.test(url.protocol)||url.search||url.hash||
    !/\/data\/replays\/[a-f0-9]{64}\.pdf$/.test(url.pathname)||
    !SHA.test(item.sha256||'')||item.sha256!==item.wire_sha256||
    url.pathname.split('/').at(-1)!==item.sha256+'.pdf'||
    !['earlier','later'].includes(item.release)||!Number.isSafeInteger(item.page)||item.page<1||item.page>1000000)
    throw Error('The original PDF lacks a verified local release/page binding.');
  return url;
}
async function pdfBytes(item,signal){
  const url=workbenchPDFURL(item);
  if(globalThis.PublicReplay?.verified){
    const route=new URL(item.href,location.href);
    if(route.origin!==location.origin||! /\/api\/(?:current\/)?cib-pdf$/.test(route.pathname)||
      route.searchParams.get('doc_id')!==item.document_id||route.searchParams.get('release')!==item.release)
      throw Error('The original PDF route has a different document or release.');
    const packet=await globalThis.PublicReplay.verified(route.href,signal);
    return checkPDF(packet.wire,item);
  }
  const response=await fetch(url,{credentials:'omit',mode:'same-origin',redirect:'error',signal});
  if(!response.ok)throw Error('The original PDF is unavailable.');
  if(Number(response.headers.get('content-length'))>32*1024**2)throw Error('The original PDF exceeds the inspection limit.');
  const reader=response.body?.getReader();if(!reader)throw Error('The original PDF has no readable bytes.');
  const parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>32*1024**2){await reader.cancel();throw Error('The original PDF exceeds the inspection limit.');}parts.push(value);
  }}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  return checkPDF(bytes,item);
}
async function checkPDF(bytes,item){
  if(bytes.byteLength>32*1024**2)throw Error('The original PDF exceeds the inspection limit.');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==item.sha256||!new TextDecoder('ascii').decode(bytes.slice(0,1024)).includes('%PDF-'))
    throw Error('The original PDF failed its content hash or format check.');
  return bytes;
}
export async function showWorkbenchPDFs(host,items){
  const ordered=[...items].sort((a,b)=>Number(a.release==='later')-Number(b.release==='later')||a.page-b.page);
  if(!ordered.length||!host.isConnected)return;
  const controller=new AbortController(),urls=[],renderers=[];
  let observer;
  const dispose=()=>{controller.abort();observer?.disconnect();for(const url of urls)URL.revokeObjectURL(url);
    for(const rendered of renderers)rendered.destroy();
    for(const frame of host.querySelectorAll('iframe'))frame.removeAttribute('src');globalThis.removeEventListener('pagehide',dispose);};
  host.disposeWorkbenchPDFs=dispose;
  const dialog=host.closest('dialog');dialog?.addEventListener('close',dispose,{once:true});
  observer=new MutationObserver(()=>{if(!host.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Verifying original PDF bytes...';host.append(status);
  try{
    const files=await Promise.all(ordered.map(item=>pdfBytes(item,controller.signal)));
    if(controller.signal.aborted||!host.isConnected||dialog&&!dialog.open){dispose();return;}
    const views=document.createElement('div');views.className='workbench-pdf-views';views.dataset.testid='workbench-pdf-views';
    host.append(views);status.textContent='Rendering the exact verified original pages locally...';
    for(const [index,item] of ordered.entries()){
      const blob=URL.createObjectURL(new Blob([files[index]],{type:'application/pdf'}));urls.push(blob);
      const column=document.createElement('section');column.className='workbench-pdf-column';
      const title=document.createElement('h4');title.textContent=`${item.release==='earlier'?'Earlier':'Later'} release / page ${item.page}`;
      const pageHost=document.createElement('div');pageHost.className='workbench-pdf-page';pageHost.dataset.release=item.release;
      const link=document.createElement('a');link.href=blob+'#page='+item.page+'&zoom=page-width';link.target='_blank';link.rel='noopener';
      link.textContent='Open verified '+item.release+' PDF at page '+item.page;
      link.dataset.release=item.release;link.dataset.pdfPage=String(item.page);
      column.append(title,pageHost,link);views.append(column);
      const rendered=await renderVerifiedPDF(pageHost,files[index],{page:item.page,pdfSha256:item.sha256,
        signal:controller.signal,label:title.textContent+' / '+item.document_id});
      rendered.canvas.dataset.release=item.release;renderers.push(rendered);
    }
    if(controller.signal.aborted||!host.isConnected){dispose();return;}
    host.dataset.pdfStatus='verified';host.dataset.pdfRenderer='pdfjs';
    status.textContent='Original PDF bytes verified and exact pages rendered locally. Release comparison is not an evidence vote.';
    if(dialog?.querySelector('[data-testid="origin-pdf-pair"]')===host)host.scrollIntoView({block:'start',behavior:'instant'});
    globalThis.addEventListener('pagehide',dispose,{once:true});
  }catch(error){dispose();if(error.name!=='AbortError'){host.dataset.pdfStatus='unavailable';status.textContent=error.message+' No PDF is substituted.';}}
}

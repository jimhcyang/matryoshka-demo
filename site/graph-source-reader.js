/* Read-only graph inspection; reuse the pinned catalog's exact PDF alignment. */
import {cibPDFPair,exactSourceAnchor} from './source-inspection.js';

export function exactContextMarkup(text,proof,escape){
  const span=exactSourceAnchor(text,proof),chars=Array.from(text);
  return escape(chars.slice(0,span.start).join(''))+
    '<mark class="source-quotation" data-proof-start="'+span.start+'" data-proof-end="'+span.end+'">'+
    escape(span.text)+'</mark>'+escape(chars.slice(span.end).join(''));
}

async function localPDFBytes(item,signal){
  let bytes;
  if(globalThis.PublicReplay?.verified){
    bytes=(await globalThis.PublicReplay.verified(item.href,signal)).wire;
  }else{
    const url=new URL(item.asset_url);
    if(url.origin!==location.origin)throw Error('Graph PDFs must remain local.');
    const response=await fetch(url,{signal,credentials:'omit',redirect:'error',mode:'same-origin'});
    if(!response.ok||Number(response.headers.get('content-length'))>32*1024**2)throw Error('The local PDF is unavailable or too large.');
    const reader=response.body.getReader(),chunks=[];let count=0;
    try{
      while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;
        if(count>32*1024**2){await reader.cancel();throw Error('The PDF exceeds the inspection limit.');}chunks.push(value);}
    }finally{reader.releaseLock();}
    bytes=new Uint8Array(count);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  }
  if(bytes.byteLength>32*1024**2)throw Error('The PDF exceeds the inspection limit.');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==item.sha256||hash!==item.wire_sha256||!new TextDecoder('ascii').decode(bytes.slice(0,1024)).includes('%PDF-'))
    throw Error('The original PDF failed its exact byte check.');
  return bytes;
}

export async function appendGraphOriginalPDFs(host,options){
  const section=document.createElement('section');section.className='graph-original-pdfs';
  section.dataset.pdfStatus='loading';
  const heading=document.createElement('h3');heading.textContent='Original release PDFs';
  const status=document.createElement('p');status.setAttribute('role','status');
  status.textContent='Verifying both local originals and their recorded page locators...';
  section.append(heading,status);host.append(section);
  const controller=new AbortController(),urls=[],renderedPages=new Set();
  let observer;
  const dispose=()=>{
    controller.abort();observer?.disconnect();
    for(const rendered of renderedPages)rendered.destroy();renderedPages.clear();
    for(const frame of section.querySelectorAll('iframe'))frame.removeAttribute('src');
    urls.splice(0).forEach(url=>URL.revokeObjectURL(url));
    globalThis.removeEventListener('pagehide',dispose);
  };
  section.disposeSourcePDFs=dispose;
  observer=new MutationObserver(()=>{
    if(!section.isConnected||section.closest('[hidden],[aria-hidden="true"]'))dispose();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','aria-hidden']});
  globalThis.addEventListener('pagehide',dispose,{once:true});
  try{
    if(options.proof?.canonical_page_id&&options.proof.canonical_page_id!==(options.page.canonical_page_id||options.page.id))
      throw Error('The PDF proof selects another canonical source page.');
    const links=await cibPDFPair(options);
    if(links.length!==2||new Set(links.map(item=>item.release)).size!==2||
        links.some(item=>!Number.isSafeInteger(item.page)||item.page<1))
      throw Error('Both original PDFs need exact recorded page locators; no page 1 fallback is used.');
    const files=await Promise.all(links.map(item=>localPDFBytes(item,controller.signal)));
    if(controller.signal.aborted||!section.isConnected)return section;
    const views=document.createElement('div');views.className='graph-original-pdf-views';
    const canvasFallback=!navigator.pdfViewerEnabled,renderTasks=[];
    const renderer=canvasFallback?await import('./source-pdf-canvas.js'):null;
    if(controller.signal.aborted||!section.isConnected)return section;
    section.dataset.renderer=canvasFallback?'canvas-loading':'browser';section.append(views);
    links.forEach((item,index)=>{
      const column=document.createElement('section'),title=document.createElement('h4');
      title.textContent=item.release.toUpperCase()+' / original page '+item.page;
      const url=URL.createObjectURL(new Blob([files[index]],{type:'application/pdf'}));urls.push(url);
      const frame=document.createElement('iframe');frame.src=url+'#page='+item.page+'&zoom=page-width';
      frame.title=item.document_id+' / '+title.textContent;frame.referrerPolicy='no-referrer';
      frame.dataset.release=item.release;frame.dataset.pdfPage=String(item.page);frame.dataset.pdfSha256=item.sha256;
      frame.hidden=canvasFallback;
      const download=document.createElement('a');download.href=url;download.download=item.document_id+'-'+item.release+'.pdf';
      download.textContent='Download verified '+item.release+' original';
      column.append(title,frame,download);views.append(column);
      if(canvasFallback){
        const pageHost=document.createElement('div');pageHost.className='graph-pdf-canvas';
        pageHost.dataset.release=item.release;pageHost.dataset.pdfPage=String(item.page);pageHost.dataset.pdfSha256=item.sha256;
        pageHost.dataset.renderStatus='loading';column.insertBefore(pageHost,frame);
        renderTasks.push(renderer.renderVerifiedPDF(pageHost,files[index],{
          page:item.page,pdfSha256:item.sha256,signal:controller.signal,
          label:item.document_id+' / '+item.release+' / original page '+item.page
        }).then(rendered=>{
          if(controller.signal.aborted||!section.isConnected){rendered.destroy();return;}
          renderedPages.add(rendered);pageHost.dataset.renderStatus='verified';
        }));
      }
    });
    const note=document.createElement('p');note.className='graph-pdf-inspection-note';
    note.textContent='Source inspection only. Viewing either release does not change the graph, case cutoff, source eligibility or saved judgments.';
    status.textContent=canvasFallback?'Original PDF bytes verified. Rendering both exact pages locally...':'Both local original PDFs verified.';
    await Promise.all(renderTasks);
    if(controller.signal.aborted||!section.isConnected)return section;
    section.dataset.renderer=canvasFallback?'canvas':'browser';section.dataset.pdfStatus='verified';section.append(note);
    status.textContent=canvasFallback?'Both original PDF files verified; the recorded pages are rendered locally.':'Both local original PDFs verified.';
  }catch(error){
    if(!controller.signal.aborted){
      controller.abort();for(const rendered of renderedPages)rendered.destroy();renderedPages.clear();
      section.dataset.pdfStatus='unavailable';section.dataset.renderer='unavailable';
      status.textContent=error.message+' No substitute source or PDF page is shown.';
    }
  }
  return section;
}

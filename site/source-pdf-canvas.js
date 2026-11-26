// Inert page pixels from verified original bytes; no viewer actions or links.
export const PDF_CANVAS_VERSION='local-verified-pdf-canvas/1';
export const PDF_CANVAS_MAX_PIXELS=4000000;
const PDF_LIMIT=32*1024**2,PDFJS_VERSION='5.4.624';
let library;

export function pdfCanvasSize(viewport,{width=1200,maxPixels=PDF_CANVAS_MAX_PIXELS}={}){
  if(!Number.isFinite(viewport?.width)||!Number.isFinite(viewport?.height)||viewport.width<=0||viewport.height<=0||
      !Number.isSafeInteger(width)||width<1||width>8192||!Number.isSafeInteger(maxPixels)||maxPixels<1||maxPixels>PDF_CANVAS_MAX_PIXELS)
    throw Error('Invalid or excessive PDF canvas dimensions.');
  const scale=Math.min(width/viewport.width,Math.sqrt(maxPixels/(viewport.width*viewport.height)),
    8192/viewport.width,8192/viewport.height);
  const w=Math.max(1,Math.floor(viewport.width*scale)),h=Math.max(1,Math.floor(viewport.height*scale));
  if(!Number.isFinite(scale)||scale<=0||w*h>maxPixels)throw Error('The PDF canvas exceeds its pixel bound.');
  return {width:w,height:h,scale};
}

export async function verifyPDFCanvasBytes(bytes,{page,pdfSha256}={}){
  if(!Number.isSafeInteger(page)||page<1||page>1000000||!/^[a-f0-9]{64}$/.test(pdfSha256||''))
    throw Error('An exact PDF hash and positive physical page are required.');
  const input=bytes instanceof Uint8Array?bytes:bytes instanceof ArrayBuffer?new Uint8Array(bytes):null;
  if(!input||input.byteLength<8||input.byteLength>PDF_LIMIT||!new TextDecoder('ascii').decode(input.subarray(0,1024)).includes('%PDF-'))
    throw Error('The PDF has invalid bytes or exceeds the32MiB bound.');
  // Transfer only a private copy to PDF.js; the caller's verified bytes stay intact.
  const copy=new Uint8Array(input);
  const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',copy))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(actual!==pdfSha256)throw Error('The rendered PDF differs from its verified original hash.');
  return copy;
}

class NoExternalPDFData{
  fetch(){return Promise.reject(Error('External PDF resources are disabled.'));}
}
function localVendor(name){
  const url=new URL('./vendor/pdfjs/'+name,import.meta.url);
  if(url.origin!==location.origin||!/^https?:$/.test(url.protocol))throw Error('PDF.js must use the local pinned vendor.');
  return url;
}
async function pdfLibrary(){
  if(!library)library=import(localVendor('pdf.mjs').href).then(module=>{
    if(module.version!==PDFJS_VERSION)throw Error('The local PDF.js version differs from the pinned vendor.');return module;
  }).catch(error=>{library=null;throw error;});
  return library;
}

export async function renderVerifiedPDF(host,verifiedBytes,{page,signal,pdfSha256,width=1200,maxPixels=PDF_CANVAS_MAX_PIXELS,label='Verified original PDF page',timeoutMs=20000}={}){
  if(!host?.append||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Invalid bounded PDF render request.');
  let canvas,renderTask,loadingTask,pdfWorker,port,timer,disposed=false,finished=false,stop;
  const stopped=new Promise((_,reject)=>{stop=reject;});stopped.catch(()=>{});
  const wait=promise=>Promise.race([promise,stopped]);
  const release=()=>{
    if(!finished)try{renderTask?.cancel();}catch{}
    try{Promise.resolve(loadingTask?.destroy()).catch(()=>{});}catch{}
    try{pdfWorker?.destroy();}catch{}
    try{port?.terminate();}catch{}
    loadingTask=pdfWorker=port=renderTask=null;
  };
  const destroy=(reason=new DOMException('PDF inspection closed.','AbortError'))=>{
    if(disposed)return;disposed=true;stop(reason);release();
    if(canvas){canvas.width=0;canvas.height=0;canvas.remove();}
    signal?.removeEventListener('abort',onAbort);clearTimeout(timer);
  };
  const onAbort=()=>destroy(new DOMException('PDF rendering cancelled.','AbortError'));
  signal?.addEventListener('abort',onAbort,{once:true});
  try{
    if(signal?.aborted){onAbort();throw new DOMException('PDF rendering cancelled.','AbortError');}
    timer=setTimeout(()=>destroy(Error('The bounded PDF render deadline was reached.')),timeoutMs);
    const data=await wait(verifyPDFCanvasBytes(verifiedBytes,{page,pdfSha256}));
    // Validate caller bounds before importing or starting any worker.
    pdfCanvasSize({width:1,height:1},{width,maxPixels});
    const pdfjs=await wait(pdfLibrary());
    if(disposed)throw new DOMException('PDF rendering cancelled.','AbortError');
    port=new Worker(localVendor('pdf.worker.mjs'),{type:'module',name:'verified-local-pdf-page'});
    pdfWorker=new pdfjs.PDFWorker({port});
    loadingTask=pdfjs.getDocument({data,worker:pdfWorker,isEvalSupported:false,enableXfa:false,
      disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,useWasm:false,
      isOffscreenCanvasSupported:false,isImageDecoderSupported:false,
      disableAutoFetch:true,disableRange:true,disableStream:true,stopAtErrors:true,
      maxImageSize:32000000,canvasMaxAreaInBytes:PDF_CANVAS_MAX_PIXELS*4,
      CMapReaderFactory:NoExternalPDFData,StandardFontDataFactory:NoExternalPDFData,WasmFactory:NoExternalPDFData,
      verbosity:0});
    loadingTask.onPassword=()=>destroy(Error('Password-protected PDF inspection is unavailable.'));
    const document=await wait(loadingTask.promise);
    if(page>document.numPages)throw Error('The recorded physical PDF page is outside this original document.');
    const original=await wait(document.getPage(page));
    const size=pdfCanvasSize(original.getViewport({scale:1}),{width,maxPixels});
    const viewport=original.getViewport({scale:size.scale});
    canvas=globalThis.document.createElement('canvas');canvas.className='source-pdf-canvas';
    canvas.width=size.width;canvas.height=size.height;canvas.style.maxWidth='100%';canvas.style.height='auto';
    canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label);
    canvas.dataset.pdfPage=String(page);canvas.dataset.pdfSha256=pdfSha256;canvas.dataset.renderer=PDF_CANVAS_VERSION;
    canvas.dataset.renderState='loading';host.append(canvas);
    const context=canvas.getContext('2d',{alpha:false});if(!context)throw Error('This browser cannot create the bounded PDF canvas.');
    renderTask=original.render({canvasContext:context,viewport,background:'rgb(255,255,255)'});
    await wait(renderTask.promise);
    if(disposed)throw new DOMException('PDF rendering cancelled.','AbortError');
    finished=true;canvas.dataset.renderState='verified';
    return {canvas,page,pdfSha256,width:size.width,height:size.height,pixels:size.width*size.height,destroy};
  }catch(error){destroy(error);throw error;}
  finally{clearTimeout(timer);release();}
}

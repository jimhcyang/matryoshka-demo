let catalogVerified=false;
document.addEventListener('click',event=>{
  const link=event.target.closest?.('a[href]');if(!link)return;
  const target=new URL(link.href,location.href);
  if(!catalogVerified&&target.origin===location.origin&&target.pathname.endsWith('/docs/matryoshka-guide.pdf')){event.preventDefault();event.stopImmediatePropagation();}
},true);

export function gateWalkthrough(report){
  if(!report||!Array.isArray(report.cases))throw Error('A verified case catalog is required.');
  catalogVerified=true;
  for(const link of document.querySelectorAll('[data-walkthrough-href]')){link.href=link.dataset.walkthroughHref;link.removeAttribute('title');}
}

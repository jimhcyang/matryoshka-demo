import {storyAccess,acknowledgeStoryReveal} from './narrative-attempts-v1.js';
let catalogVerified=false;
document.addEventListener('click',event=>{
  const link=event.target.closest?.('a[href]');if(!link)return;
  const target=new URL(link.href,location.href);
  if(!catalogVerified&&target.origin===location.origin&&target.pathname.endsWith('/docs/matryoshka-guide.pdf')){event.preventDefault();event.stopImmediatePropagation();}
},true);

export function gateWalkthrough(report){
  catalogVerified=true;
  for(const link of document.querySelectorAll('[data-walkthrough-href]')){link.href=link.dataset.walkthroughHref;link.removeAttribute('title');}
  if(!report.privacy_contract)return;
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');if(!link)return;
    const target=new URL(link.href,location.href);
    if(target.origin!==location.origin||!target.pathname.endsWith('/docs/matryoshka-guide.pdf'))return;
    if(report.cases.every(row=>storyAccess(report,row).unlocked))return;
    event.preventDefault();
    const dialog=document.createElement('dialog');dialog.className='narrative-guide-access';
    const title=document.createElement('h2');title.textContent='Walkthrough with answer reveals';
    const text=document.createElement('p');text.textContent='This guide includes the released stories’ saved outcomes and proposed fills. Open each story’s task results first, or explicitly reveal all released story answers now.';
    const actions=document.createElement('div'),open=document.createElement('button'),cancel=document.createElement('button');
    open.textContent='Reveal all story answers and open PDF';open.dataset.testid='acknowledge-walkthrough-reveal';
    cancel.textContent='Return to the questions';cancel.onclick=()=>dialog.close();
    open.onclick=()=>{for(const row of report.cases)acknowledgeStoryReveal(report,row);dialog.close();location.assign(target.href);};
    actions.append(open,cancel);dialog.append(title,text,actions);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
  });
}

// Anchor the control, not a whole stage. User scrolling always overrides retention.
export function createViewportAnchor({quietMs=900}={}) {
  let active=null,raf=0,timer=0;
  const pending=new Set(),selector="button,summary,select,input,a[data-preserve-viewport]";
  function scope(node){
    const parts=[];
    for(let at=node.parentElement;at&&at!==document.body;at=at.parentElement){
      if(at.id&&!/^evidence-list-\d+$/.test(at.id))parts.push("id:"+at.id);
      for(const name of ["anchor-scope","proposal-id","atom-id","document-id","direction","reading-id"])if(at.hasAttribute("data-"+name))parts.push(name+":"+at.getAttribute("data-"+name));
    }
    return parts.reverse().join("/");
  }
  function identity(node){
    const kind=node.id||node.dataset.anchorKey||node.dataset.testid||node.dataset.dimension||node.getAttribute("aria-label")||node.name||
      (node.tagName==="SUMMARY"?node.textContent.trim():node.textContent.trim());
    return scope(node)+"/"+node.tagName+":"+kind;
  }
  function locate(token){return token.node.isConnected?token.node:[...document.querySelectorAll(selector)].find(node=>identity(node)===token.key);}
  function cancel(){active=null;clearTimeout(timer);cancelAnimationFrame(raf);document.documentElement.classList.remove("retaining-control");}
  function restore(token){
    if(active!==token)return;
    const node=locate(token);if(!node)return;
    const modal=document.querySelector("dialog[open]");if(modal&&!modal.contains(node)){cancel();return;}
    token.node=node;
    let delta=node.getBoundingClientRect().top-token.top;
    for(let port=node.parentElement;port&&port!==document.body&&Math.abs(delta)>.5;port=port.parentElement){
      if(/auto|scroll/.test(getComputedStyle(port).overflowY)&&port.scrollHeight>port.clientHeight){port.scrollTop+=delta;delta=node.getBoundingClientRect().top-token.top;}
    }
    if(Math.abs(delta)>.5&&!node.closest("dialog"))window.scrollBy({top:delta,left:0,behavior:"instant"});
    if(token.focus&&document.activeElement!==node&&!document.querySelector("dialog[open]"))node.focus({preventScroll:true});
  }
  function schedule(){
    const token=active;if(!token)return;
    cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>restore(token));
    clearTimeout(timer);
    if(!pending.size)timer=setTimeout(()=>{restore(token);if(active===token)cancel();},quietMs);
  }
  function begin(node){
    if(!node?.matches(selector))return;
    cancel();active={node,key:identity(node),top:node.getBoundingClientRect().top,focus:document.activeElement===node};
    document.documentElement.classList.add("retaining-control");schedule();
  }
  async function run(fn){
    const token={};pending.add(token);
    try{return await fn();}finally{pending.delete(token);schedule();}
  }
  function candidate(target){return target instanceof Element?target.closest(selector):null;}
  function navigation(node){return !!node?.closest(".workflow-nav,.primary-tabs,.case-button,[data-stage-navigation]");}
  document.addEventListener("pointerdown",event=>{
    const node=candidate(event.target);if(!node||navigation(node)){cancel();return;}begin(node);
  },true);
  document.addEventListener("click",event=>{
    const node=candidate(event.target);if(!node||navigation(node))return;
    if(active?.node!==node)begin(node);else{active.focus=document.activeElement===node;schedule();}
  },true);
  document.addEventListener("change",event=>{const node=candidate(event.target);if(node&&!navigation(node)){if(active?.node!==node)begin(node);else schedule();}},true);
  document.addEventListener("keydown",event=>{
    const node=candidate(event.target);
    if(["Tab","PageDown","PageUp","Home","End","ArrowDown","ArrowUp","ArrowLeft","ArrowRight"].includes(event.key)&&!node?.matches("select,input"))cancel();
    else if(["Enter"," "].includes(event.key)&&node&&!navigation(node))begin(node);
  },true);
  for(const event of ["wheel","touchmove"])document.addEventListener(event,cancel,{capture:true,passive:true});
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["open","hidden"]});
  new ResizeObserver(schedule).observe(document.body);
  return {run,cancel,schedule,begin};
}

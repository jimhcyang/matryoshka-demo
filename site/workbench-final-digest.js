// Layout only: the caller must supply its already-trusted digest verifier/renderer.
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export function mountFinalDigest(finalSection,{binding,assertCurrent,onSource},renderer){
  if(renderer==null)return;
  if(typeof renderer!=='function')throw Error('Final digest requires an explicit trusted callback');
  assertCurrent();const host=document.createElement('section');host.className='reviewed-source-digest';host.dataset.testid='reviewed-source-digest';host.hidden=true;finalSection.append(host);
  const expected=freeze(structuredClone(binding));
  const context=Object.freeze({binding:expected,assertCurrent:()=>{assertCurrent();return expected;},onSource:p=>{assertCurrent();onSource(p);}});
  const accept=node=>{assertCurrent();if(node==null)return;
    if(![1,11].includes(node.nodeType)||typeof node.appendChild!=='function')throw Error('Digest callback must render trusted DOM, not raw JSON or HTML');
    host.replaceChildren(node);host.hidden=false;};
  const held=()=>{host.replaceChildren();host.hidden=true;host.dataset.digestStatus='held';};
  try{const result=renderer(context);if(result&&typeof result.then==='function')Promise.resolve(result).then(node=>{if(host.isConnected)accept(node);}).catch(held);else accept(result);}
  catch(error){held();throw error;}
}

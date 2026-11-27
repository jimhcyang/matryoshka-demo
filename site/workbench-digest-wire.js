// Raw JSON authority: reject duplicate keys and retain source-view numeric spelling.
export const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const ascii=x=>JSON.stringify(x).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':object(x)?'{'+Object.keys(x).sort().map(k=>ascii(k)+':'+canonical(x[k])).join(',')+'}':ascii(x);
export const same=(a,b)=>canonical(a)===canonical(b);
export function check(ok,message){if(!ok)throw Error('Source digest: '+message);}
export function parseWire(bytes,{integersOnly=true,limit=2*1024**2}={}){
  check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=limit,'bounded byte-verified response required');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let i=0,nodes=0;
  const ws=()=>{while(i<text.length&&/[\t\n\r ]/.test(text[i]))i++;};
  function value(depth=0){
    check(depth<=80&&++nodes<=1000000,'JSON structure limit');ws();const start=i,c=text[i];
    if(c==='"'){
      i++;let escaped=false;while(i<text.length){const ch=text[i++];if(!escaped&&ch==='"'){const v=JSON.parse(text.slice(start,i));return {v,c:ascii(v)};}if(!escaped&&ch==='\\')escaped=true;else escaped=false;}
      check(false,'unterminated JSON string');
    }
    if(c==='{'||c==='['){
      i++;ws();const members=[],keys=new Set(),array=c==='[',end=array?']':'}';
      if(text[i]!==end)for(;;){
        let key;if(!array){check(text[i]==='"','JSON object key required');const k=value(depth+1);key=k.v;check(!keys.has(key),'duplicate JSON key');keys.add(key);ws();check(text[i++]===':','JSON colon required');}
        const item=value(depth+1);members.push(array?item:{key,...item});ws();if(text[i]===end)break;check(text[i++]===',','JSON comma required');ws();
      }
      check(text[i++]===end,'JSON close required');
      const v=array?members.map(x=>x.v):Object.fromEntries(members.map(x=>[x.key,x.v]));
      const encode=list=>array?'['+list.map(x=>x.c).join(',')+']':'{'+list.slice().sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(x=>ascii(x.key)+':'+x.c).join(',')+'}';
      return {v,c:encode(members),withoutSHA:array?null:encode(members.filter(x=>x.key!=='sha256'))};
    }
    for(const [word,v]of [['true',true],['false',false],['null',null]])if(text.startsWith(word,i)){i+=word.length;return {v,c:word};}
    const match=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    check(match,'invalid JSON value');const raw=match[0],v=Number(raw);i+=raw.length;
    check(Number.isFinite(v)&&(!Number.isInteger(v)||Number.isSafeInteger(v)),'unsafe JSON number');
    check(!integersOnly||(/^-?(?:0|[1-9]\d*)$/.test(raw)&&raw!=='-0'),'D3 requires integer numbers and fixed-four-decimal score strings');
    return {v,c:raw};
  }
  const tree=value();ws();check(i===text.length&&object(tree.v),'one complete JSON object required');return {value:tree.v,canonicalWithoutSHA:tree.withoutSHA};
}

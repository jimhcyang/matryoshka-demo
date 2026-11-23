// A reader edition changes letter case only. Verification always uses raw text.
const lowerASCII = text => text.replace(/[A-Z]/g, char => char.toLowerCase());
let entries = [];
const cache = new Map();

export async function loadReaderCasing() {
  const meta = document.querySelector('meta[name="reader-casing"]');
  if (!meta) return;
  const expected = meta.dataset.contentSha256;
  if (!/^[a-f0-9]{64}$/.test(expected || '')) throw Error('The reader edition has no valid byte pin.');
  const url=new URL(meta.content,document.baseURI),base=new URL(document.baseURI);
  if(url.origin!==base.origin||url.search||url.hash||!url.pathname.endsWith('/data/reader-casing.js'))throw Error('Invalid reader-edition module location.');
  // Module loading uses the normal browser loader, without changing the saved
  // replay fetch allowlist or bypassing its source/API authorization guards.
  const {default:value}=await import(url.href);
  const canonical=JSON.stringify(value).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (hash !== expected) throw Error('The reader edition failed its byte pin.');
  await verifyReaderCasingSources(value);
  installReaderCasing(value);
}

export async function verifyReaderCasingSources(value) {
  for(const row of value.items||[]){
    if(typeof row.original!=='string'||!/^[a-f0-9]{64}$/.test(row.source_sha256||''))throw Error('Invalid reader source hash.');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.original)))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==row.source_sha256)throw Error('The reader edition has a mismatched original-source hash.');
  }
}

export function installReaderCasing(value) {
  if (value.version !== 'source-letter-case-only/1' || !Array.isArray(value.items) ||
      value.inference_inputs_modified !== false || value.source_characters_and_offsets_preserved !== true) {
    throw Error('Unsupported reader edition.');
  }
  const checked = [];
  for (const row of value.items) {
    if (typeof row.original !== 'string' || typeof row.display !== 'string' ||
        row.original.length !== row.display.length || lowerASCII(row.original) !== lowerASCII(row.display) ||
        JSON.stringify(row.original.match(/\[[^\]]*\]/g)) !== JSON.stringify(row.display.match(/\[[^\]]*\]/g))) {
      throw Error('The reader edition changes more than letter case.');
    }
    checked.push(row);
  }
  entries = checked.sort((a, b) => a.original.length - b.original.length);
  cache.clear();
}

export function readerText(value, corpus, {sourceText,start,end}={}) {
  const text = String(value ?? '');
  if (!['iran', 'vietnam'].includes(corpus) || !text || !/[A-Z]{2}/.test(text)) return text;
  if(typeof sourceText==='string'&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>start){
    const original=Array.from(sourceText),exact=entries.find(row=>row.original===sourceText);
    if(exact&&original.slice(start,end).join('')===text)return Array.from(exact.display).slice(start,end).join('');
  }
  const key = corpus + '\u241f' + text;
  if (cache.has(key)) return cache.get(key);
  const exact=entries.find(row=>row.original===text);
  let display=exact?.display??text;
  if(!exact){
    const choices=new Set();
    for (const row of entries) {
      let at=row.original.indexOf(text);
      while(at>=0){
        choices.add(row.display.slice(at,at+text.length));
        if(choices.size>1)break;
        at=row.original.indexOf(text,at+1);
      }
      if(choices.size>1)break;
    }
    if(choices.size===1)display=choices.values().next().value;
  }
  if (cache.size > 2048) cache.clear();
  cache.set(key, display);
  return display;
}

export function readerSlice(text, start, end, corpus) {
  return Array.from(readerText(text, corpus)).slice(start, end).join('');
}

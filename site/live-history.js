// Compact history is navigation metadata, never a reduced inference envelope.
import {LiveResultHistory as LegacyHistory,LIVE_HISTORY_LIMITS as LEGACY,credentialLike,verifyEnvelope} from './live-result-adapter.js?v=20261128-polish1';

export const LIVE_HISTORY_LIMITS=Object.freeze({...LEGACY,key:'matryoshka.live.results.v2',referenceBytes:8192});
export const HISTORY_VERSION='matryoshka-live-reference-history/2';
const RUN=/^live_[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
const sameKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const validTime=value=>Number.isSafeInteger(value)&&value<=Date.now()+60000&&Date.now()-value<=LEGACY.maxAgeMs;
const reject=(message,code='HISTORY_INVALID')=>{const error=new Error(message);error.code=code;throw error;};
export function historyBackendURL(value){
  if(typeof value!=='string'||value.length>2048||credentialLike(value))throw Error('Reconnect to an explicitly configured Live backend.');
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/live-api/')||
    !['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Invalid history backend.');
  return url.href;
}
async function queryHash(value){
  const json=JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function referenceValid(row){
  const summary=row?.summary;
  return sameKeys(row,['kind','id','saved_at','backend','query_sha256','native_checksum','summary'])&&row.kind==='reference'&&
    RUN.test(row.id)&&validTime(row.saved_at)&&HASH.test(row.query_sha256)&&
    (HASH.test(row.native_checksum||'')||summary?.execution_kind==='fixture'&&row.native_checksum===null)&&
    historyBackendURL(row.backend)===row.backend&&
    sameKeys(summary,['query','corpus','task','as_of','execution_kind'])&&typeof summary.query==='string'&&
    Array.from(summary.query).length<=150&&!credentialLike(summary.query)&&
    ['cib','iran','vietnam'].includes(summary.corpus)&&['redaction','hypothesis','mosaic'].includes(summary.task)&&
    ['live','fixture'].includes(summary.execution_kind)&&/^\d{4}-\d{2}-\d{2}$/.test(summary.as_of)&&
    JSON.stringify(row).length*2<=LIVE_HISTORY_LIMITS.referenceBytes;
}
function serialized(row){return row.kind==='legacy-v1'?{kind:row.kind,legacy:row.legacy}:row;}
function rowID(row){return row.kind==='legacy-v1'?row.legacy.id:row.id;}
function savedAt(row){return row.kind==='legacy-v1'?row.legacy.saved_at:row.saved_at;}
async function legacyRows(rows){
  const text=JSON.stringify({version:'matryoshka-live-history/1',entries:rows});
  const storage={getItem:key=>key===LEGACY.key?text:null,setItem(){},removeItem(){}};
  const history=new LegacyHistory(storage);
  await history.load();
  return new Map(history.entries().map(entry=>[entry.runId,entry.envelope]));
}

export class LiveResultHistory {
  #storage;#rows=[];#loading;#revision=0;#current=null;#migrate=false;
  constructor(storage){try{this.#storage=storage===undefined?globalThis.sessionStorage:storage;}catch{this.#storage=null;}}
  #prune(){
    const rows=this.#rows.filter(row=>validTime(savedAt(row)));
    if(rows.length!==this.#rows.length){this.#rows=rows;this.#persist();}
    if(this.#current&&!this.#rows.some(row=>rowID(row)===this.#current.id))this.#current=null;
  }
  entries(){
    this.#prune();
    return this.#rows.map(row=>{
      const envelope=row.kind==='legacy-v1'?row.envelope:this.#current?.id===row.id?this.#current.envelope:null;
      return {runId:rowID(row),savedAt:savedAt(row),envelope,kind:row.kind,
        backend:row.backend||null,summary:row.kind==='reference'?{...row.summary}:{query:Array.from(envelope.request.query).slice(0,150).join(''),
          corpus:envelope.request.corpus,task:envelope.request.task,as_of:envelope.request.as_of,execution_kind:envelope.execution_kind}};
    });
  }
  get(id){this.#prune();const row=this.#rows.find(item=>rowID(item)===id);return row?.kind==='legacy-v1'?row.envelope:row&&this.#current?.id===id?this.#current.envelope:null;}
  entry(id){return this.entries().find(row=>row.runId===id)||null;}
  load(){return this.#loading||=this.#read();}
  async #read(){
    const revision=this.#revision;let data,removed=0;
    try{
      const raw=this.#storage?.getItem(LIVE_HISTORY_LIMITS.key);
      if(raw){
        if(raw.length*2>LEGACY.storageBytes)throw Error('History size');
        data=JSON.parse(raw);
        if(!sameKeys(data,['version','entries'])||data.version!==HISTORY_VERSION||!Array.isArray(data.entries)||data.entries.length>LEGACY.entries)throw Error('History version');
      }
    }catch{data=null;removed++;try{this.#storage?.removeItem(LIVE_HISTORY_LIMITS.key);}catch{/* Storage may be disabled. */}}
    if(!data){
      try{
        const raw=this.#storage?.getItem(LEGACY.key);
        if(!raw)return {entries:this.entries(),removed};
        if(raw.length*2>LEGACY.storageBytes)throw Error('Legacy history size');
        const old=JSON.parse(raw);
        if(!sameKeys(old,['version','entries'])||old.version!=='matryoshka-live-history/1'||!Array.isArray(old.entries)||old.entries.length>LEGACY.entries)throw Error('Legacy history version');
        data={version:HISTORY_VERSION,entries:old.entries.map(legacy=>({kind:'legacy-v1',legacy}))};this.#migrate=true;
      }catch{try{this.#storage?.removeItem(LEGACY.key);}catch{/* Storage may be disabled. */}return {entries:this.entries(),removed:removed+1};}
    }
    const legacy=data.entries.filter(row=>row?.kind==='legacy-v1'&&sameKeys(row,['kind','legacy']));
    let originals;
    try{originals=await legacyRows(legacy.map(row=>row.legacy));}catch{originals=new Map();}
    if(revision!==this.#revision)return {entries:this.entries(),removed:0};
    const rows=[],seen=new Set();
    for(const row of data.entries){
      try{
        let saved=row;
        if(row?.kind==='legacy-v1'){
          if(!sameKeys(row,['kind','legacy'])||!originals.has(row.legacy?.id))throw Error('Legacy entry');
          saved={...row,envelope:originals.get(row.legacy.id)};
        }else if(!referenceValid(row))throw Error('Reference entry');
        const id=rowID(saved);if(seen.has(id))throw Error('Duplicate history ID');seen.add(id);rows.push(saved);
      }catch{removed++;}
    }
    this.#rows=rows.sort((a,b)=>savedAt(b)-savedAt(a));
    if(this.#migrate||removed)this.#persist();
    return {entries:this.entries(),removed};
  }
  #persist(){
    const encode=()=>JSON.stringify({version:HISTORY_VERSION,entries:this.#rows.map(serialized)});
    let text=encode();
    while(this.#rows.length&&text.length*2>LEGACY.storageBytes){this.#rows.pop();text=encode();}
    try{
      if(!this.#storage)return false;
      this.#storage.setItem(LIVE_HISTORY_LIMITS.key,text);
      // Migration commits first. A quota failure never destroys the V1 payload.
      if(this.#migrate){this.#storage.removeItem(LEGACY.key);this.#migrate=false;}
      return true;
    }catch{return false;}
  }
  async remember(value,{backend}={}){
    const revision=this.#revision;await this.load();await verifyEnvelope(value);
    if(revision!==this.#revision)return {stored:false,memory:false,reason:'History was cleared.'};
    const q=value.request;
    if(credentialLike(q.query))return {stored:false,memory:false,reason:'Credential-shaped query content was not saved.'};
    const row={kind:'reference',id:value.run_id,saved_at:Date.now(),backend:historyBackendURL(backend),
      query_sha256:await queryHash(q.query),native_checksum:value.native.native_checksum||null,
      summary:{query:Array.from(q.query).slice(0,150).join(''),corpus:q.corpus,task:q.task,as_of:q.as_of,execution_kind:value.execution_kind}};
    if(!referenceValid(row))throw Error('The compact history reference is invalid.');
    if(revision!==this.#revision)return {stored:false,memory:false,reason:'History was cleared.'};
    const old=this.#rows.find(item=>rowID(item)===row.id);
    if(old?.kind==='reference'&&(old.query_sha256!==row.query_sha256||old.native_checksum!==row.native_checksum||old.backend!==row.backend))throw Error('The same run ID has a different saved result binding.');
    if(old?.kind==='legacy-v1'){
      if(await queryHash(old.envelope.request.query)!==row.query_sha256||(old.envelope.native.native_checksum||null)!==row.native_checksum)throw Error('The same run ID has a different legacy result binding.');
      if(revision!==this.#revision)return {stored:false,memory:false,reason:'History was cleared.'};
      return {stored:this.#persist(),memory:true,reference:false};
    }
    this.#current={id:row.id,envelope:value};
    this.#rows=[row,...this.#rows.filter(item=>rowID(item)!==row.id)].slice(0,LEGACY.entries);
    return {stored:this.#persist(),memory:true,reference:true};
  }
  async recover(id,{backend,fetchResult}={}){
    await this.load();const revision=this.#revision,cached=this.get(id);
    if(cached){await verifyEnvelope(cached,id);if(revision!==this.#revision||!this.entry(id))reject('History was cleared.','HISTORY_CLEARED');return cached;}
    const row=this.#rows.find(item=>rowID(item)===id);
    if(!row)reject('This run is not in tab history, or its history has expired. No backend request was made.','HISTORY_MISSING');
    if(!fetchResult)reject('Reconnect to the saved Live backend, then select this run again. No new analysis is needed.','HISTORY_RECONNECT');
    if(historyBackendURL(backend)!==row.backend)reject('Connect to this run\'s original backend before reopening it. No request was sent.','HISTORY_BACKEND');
    const envelope=await fetchResult(id.slice(5));
    await verifyEnvelope(envelope,id);
    if(await queryHash(envelope.request.query)!==row.query_sha256||(envelope.native.native_checksum||null)!==row.native_checksum||
      envelope.request.task!==row.summary.task||envelope.request.corpus!==row.summary.corpus||envelope.request.as_of!==row.summary.as_of||
      envelope.execution_kind!==row.summary.execution_kind)reject('The backend result differs from this saved run reference. No substitute was opened.');
    if(revision!==this.#revision||!this.entry(id))reject('History changed while this result was opening. No substitute was opened.','HISTORY_CLEARED');
    this.#current={id,envelope};return envelope;
  }
  clear(){
    this.#revision++;this.#rows=[];this.#current=null;this.#loading=Promise.resolve({entries:[],removed:0});this.#migrate=false;
    for(const key of [LIVE_HISTORY_LIMITS.key,LEGACY.key])try{this.#storage?.removeItem(key);}catch{/* Memory is still cleared. */}
  }
}

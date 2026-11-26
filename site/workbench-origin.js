// Display-only boundaries. Original verified text and code-point offsets stay unchanged.
export function physicalOriginPage(segment={}){
  const locator=segment.locator||{};
  const explicit=segment.physical_page??locator.physical_page_1based??locator.physical_pdf_page;
  return Number.isSafeInteger(explicit)&&explicit>0?explicit:null;
}

export function originBoundary(segment={},index=0){
  const page=physicalOriginPage(segment),locator=segment.locator||{};
  if(page){
    const release=locator.release||(/LATER/.test(locator.kind||'')?'later':/EARLIER/.test(locator.kind||'')?'earlier':null);
    return {label:(release?release[0].toUpperCase()+release.slice(1)+' release / ':'')+'Page '+page,kind:'physical-page'};
  }
  if(segment.section_label)return {label:segment.section_label,kind:'source-section'};
  return {label:index===0?'Original source text':'Source text continuation',kind:'source-text'};
}

export function originDisplaySections(text,segments){
  const chars=Array.from(text),rows=segments.length?segments:[{start:0,end:chars.length}];
  return rows.flatMap(segment=>{
    if(!Number.isSafeInteger(segment.start)||!Number.isSafeInteger(segment.end)||segment.start<0||segment.end<segment.start||segment.end>chars.length)
      throw Error('The original source boundary is invalid.');
    if(physicalOriginPage(segment))return [segment];
    const raw=chars.slice(segment.start,segment.end).join('');
    const matches=[...raw.matchAll(/^(?:[ \t]*)(\d{1,3})\.[ \t]+(?=\S)/gm)];
    if(!matches.length)return [segment];
    const starts=matches.map(m=>({at:segment.start+Array.from(raw.slice(0,m.index)).length,label:'Section '+m[1]}));
    if(starts[0].at>segment.start)starts.unshift({at:segment.start,label:'Document header'});
    return starts.map((part,index)=>({...segment,start:part.at,end:starts[index+1]?.at??segment.end,
      section_label:part.label,original_segment_start:segment.start,original_segment_end:segment.end}));
  });
}

export function originPDFLocator(segment={}){
  const locator=segment.locator||{},kind=locator.kind||'';
  const release=locator.release||(/CANONICAL_LATER_TRANSCRIPTION_PHYSICAL_PDF_PAGE/.test(kind)?'later':null);
  const page=physicalOriginPage(segment);
  return ['earlier','later'].includes(release)&&page?{[release+'_page']:page}:{};
}

function words(text){
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)].map(m=>({
    key:m[0].toLocaleLowerCase('en'),start:Array.from(text.slice(0,m.index)).length,
    end:Array.from(text.slice(0,m.index+m[0].length)).length}));
}
export function narrowOriginAnchors(text,query,anchors,{pageSegments=[]}={}){
  const chars=Array.from(text),queryWords=words(query),result=[];
  for(const anchor of anchors){
    if(!Number.isSafeInteger(anchor.start)||!Number.isSafeInteger(anchor.end)||anchor.start<0||anchor.end<=anchor.start||anchor.end>chars.length||
        chars.slice(anchor.start,anchor.end).join('')!==anchor.text)throw Error('The recorded origin quotation does not replay.');
    // A producer's short birth quotation is authoritative even for paraphrases,
    // OCR variants and changed tense. Query similarity is not its provenance.
    if(anchor.end-anchor.start<=600){result.push({...anchor});continue;}
    const wholePage=anchor.start===0&&anchor.end===chars.length||pageSegments.some(segment=>
      physicalOriginPage(segment)&&anchor.start===segment.start&&anchor.end===segment.end);
    const source=words(anchor.text),matches=[];
    for(let i=0;i<source.length;i++)for(let q=0;q<queryWords.length;q++){
      let length=0;while(source[i+length]&&queryWords[q+length]&&source[i+length].key===queryWords[q+length].key)length++;
      if(length<6||source.slice(i,i+length).filter(w=>w.key.length>=4).length<3)continue;
      const keys=source.slice(i,i+length).map(w=>w.key);
      // Repeated wording is not a uniquely localized birth phrase.
      if(source.filter((_,at)=>keys.every((key,n)=>source[at+n]?.key===key)).length!==1)continue;
      matches.push({start:anchor.start+source[i].start,end:anchor.start+source[i+length-1].end});
    }
    for(const match of matches)if(!matches.some(other=>other!==match&&other.start<=match.start&&other.end>=match.end&&
        (other.start<match.start||other.end>match.end)))result.push({...match,text:chars.slice(match.start,match.end).join('')});
    if(!matches.length&&!wholePage)result.push({...anchor});
  }
  const ordered=[...new Map(result.map(a=>[a.start+':'+a.end,a])).values()].sort((a,b)=>a.start-b.start||b.end-a.end),merged=[];
  for(const anchor of ordered){const previous=merged.at(-1);
    if(previous&&anchor.start<previous.end){previous.end=Math.max(previous.end,anchor.end);previous.text=chars.slice(previous.start,previous.end).join('');}
    else merged.push({...anchor});
  }
  return merged;
}

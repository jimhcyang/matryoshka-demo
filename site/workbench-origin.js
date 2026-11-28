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

function exactSpan(text,span){
  const chars=Array.from(text);
  if(!span||!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||span.start<0||span.end<=span.start||
      span.end>chars.length||chars.slice(span.start,span.end).join('')!==span.text)
    throw Error('The recorded origin quotation does not replay.');
  return {start:span.start,end:span.end,text:span.text};
}
function mergeSpans(text,spans){
  const chars=Array.from(text),ordered=spans.map(span=>exactSpan(text,span)).sort((a,b)=>a.start-b.start||a.end-b.end),merged=[];
  for(const span of ordered){const last=merged.at(-1);
    if(last&&span.start<=last.end){last.end=Math.max(last.end,span.end);last.text=chars.slice(last.start,last.end).join('');}
    else merged.push({...span});
  }
  return merged;
}
const covers=(spans,span)=>spans.some(value=>value.start<=span.start&&value.end>=span.end);

// Compatibility call: only a unique, literal whole input may narrow provenance.
// Short quotations and matching evidence phrases are not proof of minimality.
export function narrowOriginAnchors(text,query,anchors){
  const recorded=mergeSpans(text,anchors);
  if(typeof query!=='string'||!query)return [];
  const at=text.indexOf(query);
  if(at<0||text.indexOf(query,at+1)>=0)return [];
  const start=Array.from(text.slice(0,at)).length,span={start,end:start+Array.from(query).length,text:query};
  return covers(recorded,span)?[span]:[];
}

export function originHighlightPlan(data,caseInfo,{sourceQuerySpans=[],minimalSpans=null}={}){
  if(!data||data.case_id!==caseInfo?.case_id||data.query!==caseInfo.query||data.document_id!==caseInfo.document_id||
      data.date!==caseInfo.date||data.eligible_evidence!==false)throw Error('Origin display belongs to another input.');
  const full=data.full_transcription||data,text=full.text;
  if(typeof text!=='string')throw Error('Original transcription is unavailable.');
  if(caseInfo.task==='redaction'&&data.focal_revealed!==false)throw Error('Minimal input provenance requires the masked executed-input coordinates.');
  const recorded=mergeSpans(text,full.query_anchors||full.anchors||[]);
  // source_query_spans can be in the revealed source coordinate space. Never
  // relocate them by searching their text in a masked or rewritten transcript.
  const unmapped=[];
  for(const span of sourceQuerySpans){
    try{const exact=exactSpan(text,span);if(!covers(recorded,exact))unmapped.push(span);}
    catch{unmapped.push(span);}
  }
  const focal=caseInfo.task==='redaction'?(full.anchors||data.anchors||[]).filter(span=>{
    exactSpan(text,span);return data.focal_revealed===true||span.text===caseInfo.focal_marker;
  }):[];
  if(caseInfo.task==='redaction'&&!focal.length&&data.focal_reference_status==='UNKNOWN_STILL_WITHHELD'&&
      data.reference_answer_available===false&&data.focal_reference===null){
    const at=caseInfo.query.indexOf(caseInfo.focal_marker),prefix=caseInfo.query.slice(0,at),matches=[];
    // An exact public prefix may bind an opaque source slot, not a guessed fill.
    if(at>=24&&caseInfo.query.indexOf(caseInfo.focal_marker,at+1)<0)for(const span of recorded){
      if(!span.text.startsWith(prefix))continue;
      const token=/^\[REDACTED\]/.exec(span.text.slice(prefix.length));
      if(token){const start=span.start+Array.from(prefix).length;matches.push({start,end:start+token[0].length,text:token[0]});}
    }
    if(matches.length===1)focal.push(matches[0]);
  }
  let anchors,basis;
  if(minimalSpans!==null){
    if(minimalSpans.version!=='origin-minimal-selection/1'||minimalSpans.case_id!==caseInfo.case_id||
        minimalSpans.query_sha256!==data.query_sha256||minimalSpans.source_text_sha256!==full.text_sha256||
        !Array.isArray(minimalSpans.spans)||!minimalSpans.spans.length)
      throw Error('The minimal Origin selection has another input or transcription binding.');
    anchors=mergeSpans(text,minimalSpans.spans);
    if(anchors.some(span=>!covers(recorded,span)))throw Error('Minimal Origin selection is outside recorded input provenance.');
    basis='reviewed-exact-original-provenance';
  }else{anchors=narrowOriginAnchors(text,caseInfo.query,recorded);basis='unique-literal-whole-input';}
  const focalIncluded=caseInfo.task!=='redaction'||focal.length>0&&focal.every(span=>covers(anchors,span));
  const contextIncluded=caseInfo.task!=='redaction'||anchors.some(span=>focal.some(slot=>
    span.start<=slot.start&&span.end>=slot.end&&(span.start<slot.start||span.end>slot.end)));
  const wholePage=anchors.some(span=>span.start===0&&span.end===Array.from(text).length||
    (full.segments||[]).some(segment=>physicalOriginPage(segment)&&span.start===(segment.start??segment.raw_start)&&span.end===(segment.end??segment.raw_end)));
  const accepted=anchors.length>0&&focalIncluded&&contextIncluded&&!wholePage;
  return Object.freeze({status:accepted?'EXACT_MINIMAL_ORIGIN_DISPLAY':'ORIGINAL_CORRESPONDENCE_REVIEW_REQUIRED',
    anchors:Object.freeze((accepted?anchors:[]).map(Object.freeze)),requiresReview:!accepted,
    focalIncluded,contextIncluded,unmappedSourceQuerySpans:unmapped.length,basis,
    sourceOrEvidenceAuthorityAdded:false});
}

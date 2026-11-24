// Optional input provenance only. No inference policy, source text or answers.
export const INPUT_LOCATOR_VERSION='audited-input-pdf-locator-supplement/1';
export const INPUT_LOCATOR_AUDIT_SHA256='2fa111df048718930800308ac1e22edd0c4f62f11d153b2b5b240a0a4999e312';
export const INPUT_LOCATOR_CATALOG_SHA256='eb01bc2edbc1a8a2720d05c096af565337ba3a074f60dc6abd58ff19fbf25699';
const pin=Object.freeze({
  case_id:'narrative_cib_revision_ac4fb499beb4b345b5384ae6',
  document_id:'CIA-RDP79T00975A005400500001-6',date:'1960-12-28',
  query_sha256:'a6988bbd921880dbdb499f0b5a12447fc0b37b27a9531ae675a6e8314318837e',
  origin_text_sha256:'9346e168f06ba9316c37901d546d333c2f9a8dfdcc60a9f071fccd0157a7827d',
  origin_path:'experiments/full_resume_20261120/publication_preview_v01/cases/narrative_cib_revision_ac4fb499beb4b345b5384ae6/origin_masked.json.gz',
  origin_sha256:'6cbede35fbbc48c8013dfe70eeadcfa97cf2731744dc6e9fe96590d93e0c1674',
  source_proof_path:'experiments/narrative_parallel/cib_companions/query_revision_v01/private/source_proofs.json',
  source_proof_sha256:'97e9ac1e64f230b80e466a37e2ef177b7bc5ac25c8437349a2890154d461556c',
  canonical_page_id:'page_7270f49271faa6a0946d',
  source_target_id:'cloze_58e8550212498c5d863f8883',
});
const pdfs=Object.freeze([
  Object.freeze({release:'earlier',page:5,page_count:8,sha256:'6d2ba5c572f2dc1f2b30815f1e7549a0d7d49a409f8212e478c70a657dffaae8'}),
  Object.freeze({release:'later',page:6,page_count:11,sha256:'7eb85f204e45baceef1d00cabd41493bbaf955ec83a0200e0cc831b0861a931b'}),
]);
async function digest(value){
  const serialized=JSON.stringify(value).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized)))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function boundRef(ref,path,sha256){
  return ref?.sha256===sha256&&(ref.path===path||ref.path===null&&
    ref.publication_availability==='Unpublished audit artifact; content hash retained');
}

export async function inputOriginPDFLocators({caseInfo,origin,maskedOriginRef,catalogSHA256}={}){
  if(caseInfo?.case_id!==pin.case_id||caseInfo.corpus!=='cib'||caseInfo.task!=='redaction'||
      caseInfo.document_id!==pin.document_id||caseInfo.date!==pin.date||catalogSHA256!==INPUT_LOCATOR_CATALOG_SHA256||
      !boundRef(maskedOriginRef,pin.origin_path,pin.origin_sha256)||
      origin?.case_id!==pin.case_id||origin.document_id!==pin.document_id||origin.date!==pin.date||
      origin.query!==caseInfo.query||origin.query_sha256!==pin.query_sha256||origin.focal_revealed!==false||
      origin.eligible_evidence!==false||typeof origin.text!=='string'||origin.text_sha256!==pin.origin_text_sha256||
      !boundRef(origin.source_proof_ref,pin.source_proof_path,pin.source_proof_sha256))return null;
  if(await digest(caseInfo.query)!==pin.query_sha256||await digest(origin.text)!==pin.origin_text_sha256)return null;
  return Object.freeze({version:INPUT_LOCATOR_VERSION,audit_sha256:INPUT_LOCATOR_AUDIT_SHA256,
    case_id:pin.case_id,document_id:pin.document_id,canonical_page_id:pin.canonical_page_id,
    source_target_id:pin.source_target_id,catalog_sha256:INPUT_LOCATOR_CATALOG_SHA256,
    scope:'INPUT_SOURCE_PROVENANCE_ONLY',used_for_inference:false,hidden_answer_text_exported:false,
    pdfs:Object.freeze(pdfs.map(item=>Object.freeze({...item,document_id:pin.document_id,
      public_path:'data/replays/'+item.sha256+'.pdf',href:'data/replays/'+item.sha256+'.pdf#page='+item.page}))),
  });
}

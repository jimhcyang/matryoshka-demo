import {loadSavedCatalog} from './narrative-catalog-v1.js';
try {
  const {report}=await loadSavedCatalog(),slot=new URLSearchParams(location.search).get('slot')||'first';
  if(!['first','last'].includes(slot))throw Error('Choose the first or last gap.');
  const choices=report.cases.filter(row=>row.study_slot===slot&&row.case.corpus==='cib'&&row.case.task==='redaction');
  if(choices.length!==1||choices[0].reference_answer_kind!=='unknown_still_withheld')throw Error('The bound delegation input is unavailable.');
  const query=new URLSearchParams({case:choices[0].case.case_id,arm:'A',stage:'01'});
  location.replace(new URL('workbench-v6.html?'+query,location.href).href);
} catch(error) {
  document.getElementById('study-status').textContent=error.message;
}

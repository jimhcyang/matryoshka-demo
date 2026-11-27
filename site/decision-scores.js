// Explicit 8/10 dispatch. Every earlier validator remains in its exact frozen module.
import * as legacy from './legacy-decision-scores.js';
import * as v8 from './context-priority-v8.js';
import * as v10 from './context-priority-v10.js';
export * from './legacy-decision-scores.js';
export const CONTEXT_PRIORITY_V10_VERSION=v10.CONTEXT_PRIORITY_V10_VERSION;
export const CONTEXT_PRIORITY_VERSIONS=Object.freeze([v8.CONTEXT_PRIORITY_VERSION,v10.CONTEXT_PRIORITY_V10_VERSION]);
export function isContextPriorityVersion(version){return CONTEXT_PRIORITY_VERSIONS.includes(version);}
const version=record=>record?.result?.terminal_scores?.version??record?.terminal_scores?.version;
export function computeDecisionScores(record={}){
  return version(record)===v10.CONTEXT_PRIORITY_V10_VERSION?v10.computeContextPriorityV10Scores(record):legacy.computeDecisionScores(record);
}
export async function verifyContextualScoreBindings(record,caseInfo,digest,options){
  v10.revokeContextPriorityV10(record);
  if(version(record)===v10.CONTEXT_PRIORITY_V10_VERSION)return v10.verifyContextPriorityV10Bindings(record,caseInfo,digest,options);
  return legacy.verifyContextualScoreBindings(record,caseInfo,digest,options);
}
export function formatDecisionScore(value,scoreVersion=null){
  return scoreVersion===v10.CONTEXT_PRIORITY_V10_VERSION?v10.formatContextPriorityV10(value):legacy.formatDecisionScore(value,scoreVersion);
}
export function contextPriorityReadout(record){
  return version(record)===v10.CONTEXT_PRIORITY_V10_VERSION?v10.contextPriorityV10Readout(record):v8.contextPriorityReadout(record);
}
export function renderContextPriorityCards(record,options){
  return version(record)===v10.CONTEXT_PRIORITY_V10_VERSION?v10.renderContextPriorityV10Cards(record,options):v8.renderContextPriorityCards(record,options);
}


// Presentation of supplied checks only; never a source verifier or score compiler.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' && value.trim() ? value : null;
const el = (tag, value, className) => {
  const node = document.createElement(tag);
  if (value != null) node.textContent = value;
  if (className) node.className = className;
  return node;
};

export function evidenceRoles(directions = []) {
  const tones = new Set(), descriptions = new Set();
  for (const value of Array.isArray(directions) || directions instanceof Set ? directions : []) {
    if (/^(FOR|SUPPORT|SUPPORTED)$/.test(value)) { tones.add('support'); descriptions.add('Support'); }
    else if (/^(AGAINST|OPPOSE|OPPOSED|COUNTER|COUNTEREVIDENCE)$/.test(value)) { tones.add('oppose'); descriptions.add('Opposition'); }
    else if (/^(CONTEXT|CONTEXT_ONLY)$/.test(value)) { tones.add('context'); descriptions.add('Context'); }
    else if (/^(PARTIAL|PARTIAL_SOURCE_ACCOUNT)$/.test(value)) { tones.add('context'); descriptions.add('Partial account'); }
  }
  const ordered = ['support', 'oppose', 'context'].filter(tone => tones.has(tone));
  return {tones: ordered, palette: ordered.join('-') || 'unspecified',
    description: ordered.length ? ['Support', 'Opposition', 'Context', 'Partial account'].filter(label => descriptions.has(label)).join(' + ') : 'Direction not recorded'};
}

const fields = {
  actor: 'Actor', actors: 'Actors', action: 'Action', relation_property: 'Relationship or property',
  role_argument: 'Role in the claim', arguments: 'Roles and arguments', issue: 'Issue',
  event_identity: 'Event or issue', time: 'Time', event_time: 'Event time', quantity: 'Quantity',
  polarity: 'Polarity', modality: 'Certainty or possibility', attribution: 'Attribution',
  qualification: 'Qualification', conditions: 'Conditions'
};
const states = {
  MATCHED: 'Aligned', CONFLICTING: 'Conflicting', INFERRED: 'Inferred', MISSING: 'Missing',
  NOT_REQUESTED: 'Not requested', NOT_APPLICABLE: 'Not applicable', UNRESOLVED: 'Unresolved',
  ACCEPT: 'Accepted', ACCEPTED: 'Accepted', REJECT: 'Rejected', HOLD: 'Held', VALID: 'Valid',
  INVALID: 'Invalid', PASS: 'Passed', FAIL: 'Failed', BOUND: 'Bound to the issue',
  SOURCE_ASCRIBED: 'Evidence-backed source account', PARTIAL_SOURCE_ASCRIPTION: 'Partial source account',
  PARTIAL_SOURCE_ACCOUNT: 'Partial source account', CONTEXT_ONLY: 'Context only',
  SOURCE_VIEWS_RECORDED: 'Source views recorded', OPPOSING_SOURCE_ACCOUNT: 'Opposing source account',
  SOURCE_OPPOSED: 'Opposing source account', CONTESTED_SOURCE_ACCOUNTS: 'Supporting and opposing accounts',
  CONFLICTED_SOURCE_ACCOUNTS: 'Conflicting source accounts', DIRECT_SOURCE_APPROVED: 'Evidence-backed suggestion',
  DIRECT_TARGET_SOURCE: 'Direct source assessment', INFERENTIAL_CONTEXT: 'Contextual suggestion',
  NOMINATION_ONLY: 'Nomination only', EXPLICIT_CONFLICT: 'Explicit conflict',
  HOLD_SEMANTIC_REVIEW: 'Semantic review held', SUPPORT: 'Support', OPPOSE: 'Opposition',
  CONTEXT: 'Context', PARTIAL: 'Partial account', DOCUMENT_REPORTING_VOICE: 'Document reporting voice',
  NAMED_SOURCE: 'Named source', CONDITIONAL: 'Conditional', UNCERTAIN: 'Uncertain',
  DIRECT_STANCE: 'Direct stance', REASONED_ARGUMENT: 'Reasoned argument', NONE: 'None recorded'
};
const human = value => states[value] || null;

export function renderEvidenceDetails(value, {onSource, assertCurrent} = {}) {
  if (value == null) return null;
  const outer = object(value) ? value : {};
  const data = object(outer.details) ? outer.details : outer;
  const host = el('div', null, 'evidence-details');
  host.dataset.testid = 'evidence-decision-details';
  const current = () => { try { return assertCurrent?.() !== false; } catch { return false; } };
  const section = (parent, title, body) => {
    if (!body?.childNodes.length) return;
    const item = el('section', null, 'evidence-detail-section');
    item.append(el('h4', title), body); parent.append(item);
  };
  const paragraph = (parent, content) => { if (text(content)) parent.append(el('p', content)); };
  const row = (parent, label, content) => {
    if (!text(content)) return;
    const term = el('div', null, 'evidence-detail-row');
    term.append(el('dt', label), el('dd', content)); parent.append(term);
  };
  const inspect = (parent, proof, label) => {
    if (!object(proof) || !text(proof.text)) return;
    parent.append(el('blockquote', proof.text));
    if (typeof onSource === 'function') {
      const button = el('button', label, 'sw-button'); button.type = 'button';
      button.addEventListener('click', () => { if (current()) onSource(proof); });
      parent.append(button);
    }
  };
  const checkFields = (parent, input) => {
    if (!object(input)) return;
    const checks = el('dl', null, 'evidence-checks');
    for (const [key, field] of Object.entries(input)) {
      if (!fields[key] || !object(field)) continue;
      const state = human(field.status ?? field.state), reason = text(field.reason);
      if (state || reason) {
        row(checks, fields[key], [state, reason].filter(Boolean).join('. '));
        const detail = checks.lastElementChild.lastElementChild;
        for (const [name, quotes] of [['Input wording', field.query_quotes], ['Source wording', field.source_quotes]]) {
          for (const quote of list(quotes)) if (text(quote)) {
            detail.append(el('p', name, 'evidence-wording-label'), el('blockquote', quote));
          }
        }
      }
    }
    section(parent, 'Recorded checks', checks);
  };
  const review = (parent, input) => {
    if (!object(input)) return;
    const body = el('dl');
    row(body, 'Review decision', human(input.decision ?? input.status));
    row(body, 'Reason', text(input.reason));
    for (const [key, label] of Object.entries({same_issue_verified: 'Same issue verified',
      same_target: 'Same target checked', whole_component_sufficient: 'Whole component supported',
      directional_stance_supported: 'Directional stance supported', anchor_binding_verified: 'Quotation binding checked',
      independent_rederivation: 'Independent review recorded',
      attribution_verified: 'Attribution verified', qualifications_retained: 'Qualifications retained',
      operators_retained: 'Operators retained', owner_role_aligned: 'Owner and role aligned',
      causal_role_compatible: 'Causal role compatible', time_scope_compatible: 'Time scope compatible'})) {
      if (typeof input[key] === 'boolean') row(body, label, input[key] ? 'Yes' : 'No');
    }
    section(parent, 'Source review', body);
  };
  if (typeof value === 'string') paragraph(host, value);
  if (typeof outer.details === 'string') paragraph(host, outer.details);
  const wording = el('div');
  paragraph(wording, data.completedInput ?? data.completed_input);
  section(host, 'Completed input', wording);
  const source = el('div');
  const original = text(data.originalPhrase ?? data.original_phrase ?? outer.sourceWord);
  if (original) source.append(el('blockquote', original));
  const transform = data.transformation;
  paragraph(source, typeof transform === 'string' ? transform : transform?.description);
  section(host, 'Source wording and transformation', source);
  const decision = el('dl');
  row(decision, 'Recorded result', text(outer.label) || human(data.status ?? data.stored_status ?? outer.status));
  row(decision, 'Assessment', human(data.source_class ?? data.evidenceState));
  row(decision, 'Reason', text(data.reason ?? data.text));
  // A label by itself is not an expandable decision/check record.
  const meaningful = decision.children.length > Number(!!(text(outer.label) || human(data.status ?? data.stored_status ?? outer.status)));
  if (meaningful || text(data.status ?? data.stored_status)) section(host, 'Recorded decision', decision);
  checkFields(host, data.facets ?? data.fields);
  review(host, data.review);
  const grammar = el('div'), g = data.grammar;
  if (typeof g === 'string') paragraph(grammar, g);
  else if (object(g)) {
    paragraph(grammar, human(g.decision ?? g.status)); paragraph(grammar, g.reason);
    for (const diagnostic of list(g.unsupported_diagnostics)) paragraph(grammar, diagnostic.reason);
  }
  section(host, 'Insertion checks', grammar);
  const qualification = data.qualification ?? data.full_qualification;
  const context = el('div');
  if (text(qualification)) context.append(el('blockquote', qualification));
  else inspect(context, qualification, 'Inspect complete source context');
  section(host, 'Complete source qualification', context);
  if (list(data.full_qualifications).length) {
    const full = el('div');
    for (const qualification of data.full_qualifications) inspect(full, qualification, 'Inspect complete qualification');
    section(host, 'Complete source qualifications', full);
  }
  const proof = el('div'); inspect(proof, data.proof, 'Inspect recorded quotation');
  section(host, 'Source quotation', proof);
  for (const [index, account] of list(data.accounts).entries()) {
    if (!object(account)) continue;
    const body = el('div'), description = evidenceRoles([account.direction]);
    const information = el('dl');
    row(information, 'Recorded role', description.tones.length ? description.description : null);
    row(information, 'Account type', human(account.kind));
    row(information, 'Source scope', human(account.mode));
    if (typeof account.score === 'number' && Number.isFinite(account.score)) row(information, 'Recorded index', account.score.toFixed(4));
    row(information, 'Reason', text(account.reason));
    const voice = account.source_attribution;
    row(information, 'Voice', human(voice?.kind));
    row(information, 'Attributed wording', text(voice?.speaker_quote));
    if (body.childNodes.length || information.childNodes.length) body.append(information);
    if (account.eligibilityHeld === true || account.temporal_eligibility_hold != null) {
      paragraph(body, 'Held for source eligibility; not credited as selected evidence.');
      paragraph(body, typeof account.temporal_eligibility_hold === 'string' ? account.temporal_eligibility_hold : account.temporal_eligibility_hold?.reason);
    }
    checkFields(body, account.fields ?? account.facets);
    review(body, account.review);
    const issue = account.issue;
    if (object(issue) && (human(issue.state) || text(issue.reason))) {
      const issueBody = el('dl'); row(issueBody, 'Issue binding', human(issue.state));
      row(issueBody, 'Reason', text(issue.reason)); section(body, 'Issue and owner', issueBody);
    }
    const q = el('div'); inspect(q, account.proof, 'Inspect account quotation');
    section(body, 'Exact quotation', q);
    const full = el('div'); inspect(full, account.qualification, 'Inspect complete qualification');
    section(body, 'Complete source qualification', full);
    if (!body.childNodes.length) continue;
    const disclosure = el('details', null, 'evidence-account-details');
    disclosure.append(el('summary', 'Source account ' + (index + 1) + (description.tones.length ? ': ' + description.description : '')), body);
    host.append(disclosure);
  }
  return host.childNodes.length ? host : null;
}

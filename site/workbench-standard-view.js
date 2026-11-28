// Presentation only: source authority, selection and scores belong to the caller.
import {evidenceRoles, renderEvidenceDetails} from './workbench-evidence-details.js?v=20261128-polish1';
export const STANDARD_WORKBENCH_VERSION = 'standard-workbench-view/1';
let instance = 0;

const list = value => Array.isArray(value) ? value : [];
export const readingDisplayText = value => String(value || '')
  .replace(/\s*(?:Function:|Legacy subset route:)[\s\S]*$/i, '').trim();
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text != null) value.textContent = String(text);
  if (className) value.className = className;
  return value;
};
const require = (value, message) => { if (!value) throw Error('Standard workbench: ' + message); };
const scoreValue = value => {
  if (value == null) return null;
  require(typeof value === 'number' || typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value), 'invalid supplied score');
  const number = Number(value);
  require(Number.isFinite(number), 'nonfinite supplied score');
  return number;
};

export function renderStandardWorkbench(options) {
  require(options && typeof options === 'object', 'options required');
  const {task, caseInfo = {}, summary = {}, selectedReadingId, stage} = options;
  require(['redaction', 'mosaic', 'reconstruction', 'hypothesis'].includes(task), 'unknown task');
  require(typeof stage === 'function', 'stage factory required');
  const id = 'standard-workbench-' + (++instance);
  const facts = list(options.facts), readings = list(options.readings);
  require(new Set(facts.map(fact => fact.id)).size === facts.length && facts.every(fact => typeof fact.id === 'string' && typeof fact.text === 'string'), 'unique fact IDs and text required');
  require(new Set(readings.map(reading => reading.id)).size === readings.length && readings.every(reading => typeof reading.id === 'string'), 'unique reading IDs required');
  const selected = readings.find(reading => reading.id === selectedReadingId);
  require(!readings.length || selected, 'selected reading must be explicit');
  const candidates = list(options.candidates ?? selected?.candidates);
  const units = list(options.units ?? selected?.units);
  require(candidates.every(item => typeof item.id === 'string' && typeof item.fill === 'string'), 'candidate IDs and fill text required');
  require(units.every(item => typeof item.id === 'string' && typeof item.text === 'string'), 'unit IDs and text required');
  const format = value => {
    const text = options.formatText ? options.formatText(String(value)) : String(value);
    require(typeof text === 'string', 'formatText must return plain text');
    return text;
  };
  let disposed = false;
  const current = () => {
    if (disposed) return false;
    try { return options.assertCurrent?.() !== false; } catch { return false; }
  };
  require(current(), 'selection is stale');
  const action = (label, callback, className = 'sw-button') => {
    const button = node('button', label, className);
    button.type = 'button';
    button.disabled = typeof callback !== 'function';
    button.addEventListener('click', () => { if (current()) callback?.(); });
    return button;
  };
  const makeStage = (number, title, kicker) => {
    const result = stage(number, title, kicker);
    require(result?.outer instanceof Element && result?.body instanceof Element && result.outer.contains(result.body), 'invalid stage factory result');
    result.outer.classList.add('standard-workbench', 'sw-stage');
    result.outer.dataset.standardStage = number;
    return result;
  };
  const labels = new Map(facts.map((fact, index) => [fact.id, 'F' + (index + 1)]));
  const factLabels = ids => [...new Set(list(ids).map(value => labels.get(value) || value))].join(' / ');
  const inventory = list(options.proofs), relatedInventory = list(options.relatedProofs), byId = new Map();
  for (const proof of [...inventory, ...relatedInventory]) {
    if (proof.id == null) continue;
    require(!byId.has(proof.id) || byId.get(proof.id) === proof, 'duplicate proof ID');
    byId.set(proof.id, proof);
  }
  const resolve = value => {
    const proof = typeof value === 'string' ? byId.get(value) : value;
    require(proof && typeof proof === 'object' && typeof proof.text === 'string', 'exact source quote required');
    return proof;
  };
  const groups = new Map(), relatedGroups = new Map();
  const proofKey = proof => JSON.stringify([proof.corpus ?? '', proof.document_id ?? proof.docid ?? '', proof.canonical_page_id ?? proof.page_id, proof.page_sha256 ?? '', proof.start, proof.end]);
  const addProof = (value, atomIds = [], direction, target = groups) => {
    const proof = resolve(value), page = proof.canonical_page_id ?? proof.page_id;
    require(typeof page === 'string' && page && Number.isSafeInteger(proof.start) && Number.isSafeInteger(proof.end) && proof.start >= 0 && proof.end > proof.start, 'exact page/span required');
    const key = proofKey(proof);
    let group = target.get(key);
    if (!group) {
      group = {proof, atomIds: new Set(), names: new Set(), directions: new Set(), qualifications: new Set()};
      target.set(key, group);
    }
    require(group.proof.text === proof.text, 'conflicting text for same page/hash/span');
    for (const atom of [...list(proof.atom_ids), ...list(proof.fact_ids), ...list(atomIds)]) group.atomIds.add(atom);
    for (const name of [...list(proof.digest_ids), proof.label, /^S\d+$/.test(proof.id || '') ? proof.id : null]) if (name) group.names.add(name);
    for (const item of [proof.direction, direction]) if (typeof item === 'string' && item) group.directions.add(item);
    for (const text of [proof.qualification, ...list(proof.qualifications)]) if (typeof text === 'string' && text) group.qualifications.add(text);
    return proof;
  };
  inventory.forEach(proof => addProof(proof));
  for (const item of [...candidates, ...units]) {
    const atomIds = item.fact_ids ?? item.atom_ids ?? (labels.has(item.id) ? [item.id] : []);
    list(item.proofs).forEach(proof => addProof(proof, atomIds, item.direction));
    list(item.evidence).forEach(evidence => addProof(evidence.proof, atomIds, evidence.direction));
  }
  relatedInventory.forEach(proof => {
    // A duplicate selected citation stays primary, never a second context card.
    addProof(proof, [], undefined, groups.has(proofKey(proof)) ? groups : relatedGroups);
  });
  for (const meta of list(options.proofMetadata)) {
    const key = proofKey(resolve(meta.proof));
    addProof(meta.proof, meta.atom_ids, meta.direction, relatedGroups.has(key) && !groups.has(key) ? relatedGroups : groups);
  }

  const hero = node('aside', null, 'standard-workbench sw-hero');
  hero.dataset.testid = 'standard-summary';
  hero.dataset.task = task;
  if (typeof summary.tone === 'string') hero.dataset.tone = summary.tone;
  hero.append(node('p', caseInfo.title || ({redaction: 'Redaction', hypothesis: 'Hypothesis', mosaic: 'Mosaic', reconstruction: 'Mosaic'})[task], 'sw-kicker'));
  const verdictTitle = node('h2', summary.title || 'Saved result');
  verdictTitle.dataset.testid = 'local-verdict-title'; hero.append(verdictTitle);
  if (summary.text) hero.append(node('p', summary.text, 'sw-copy'));

  const plan = makeStage('02', 'Facts to look for', 'Input');
  plan.body.append(node('p', 'Input assertions, not established facts.', 'sw-note'));
  const cards = node('div', null, 'sw-facts');
  for (const fact of facts) {
    const card = node('article', null, 'sw-fact');
    card.dataset.testid = 'plan-atom'; card.dataset.atomId = fact.id;
    card.append(node('span', labels.get(fact.id), 'sw-fact-label'), node('p', format(fact.text)));
    cards.append(card);
  }
  plan.body.append(cards.childElementCount ? cards : node('p', 'No facts were supplied.', 'sw-note'));
  if (readings.length) {
    const control = node('div', null, 'sw-reading');
    const label = node('label', 'Reading');
    label.htmlFor = id + '-reading';
    const select = node('select'); select.id = label.htmlFor; select.dataset.testid = 'plan-reading-select';
    select.disabled = typeof options.onReadingChange !== 'function';
    for (const [readingIndex, reading] of readings.entries()) {
      const option = node('option', readingDisplayText(reading.label) || 'Reading ' + (readingIndex + 1));
      option.value = reading.id; option.selected = reading.id === selectedReadingId; select.append(option);
    }
    select.addEventListener('change', () => {
      if (current()) options.onReadingChange?.(select.value);
      // Parent owns selection and must re-render from its newly verified DTO.
      select.value = selectedReadingId;
    });
    control.append(label, select);
    const explanation = readingDisplayText(selected.explanation);
    if (explanation) control.append(node('p', format(explanation), 'sw-copy'));
    plan.body.append(control);
  }

  const map = makeStage('03', 'Facts to evidence', 'Source map');
  const mapHost = node('div', null, 'sw-map');
  mapHost.id = id + '-map'; mapHost.dataset.testid = 'flow-host';
  map.body.append(mapHost);
  const sources = makeStage('04', 'Selected evidence', 'Sources');
  const sourceCards = node('div', null, 'sw-source-list');
  const sourceCard = (group, related = false) => {
    const {proof} = group, card = node('article', null, 'sw-source');
    card.dataset.testid = related ? 'standard-related-source-card' : 'standard-source-card';
    const roles = evidenceRoles(group.directions);
    card.dataset.palette = roles.palette;
    card.dataset.directions = [...group.directions].join(' ');
    const line = [...group.names, factLabels([...group.atomIds])].filter(Boolean).join(' / ');
    const roleId = id + '-source-role-' + (groups.size + relatedGroups.size) + '-' + [...groups.values(), ...relatedGroups.values()].indexOf(group);
    card.setAttribute('aria-label', (line || 'Selected source') + ': ' + roles.description);
    card.setAttribute('aria-describedby', roleId);
    const header = node('header', null, 'sw-source-header');
    header.append(node('p', line || 'Selected source', 'sw-source-label'));
    if (typeof options.onKG === 'function') {
      const kg = action('View on KG', () => options.onKG(proof), 'sw-button sw-quiet');
      kg.dataset.testid = 'standard-view-on-kg'; header.append(kg);
    }
    card.append(header);
    const role = node('p', roles.description, 'sw-source-role'); role.id = roleId;
    card.append(role);
    const content = node('div', null, 'sw-source-content');
    content.tabIndex = 0; content.setAttribute('role', 'region');
    content.setAttribute('aria-label', 'Complete quotation and qualifications; scroll for full text');
    const quote = action('', typeof options.onSource === 'function' ? () => options.onSource(proof) : null, 'sw-quote');
    quote.dataset.testid = 'used-source-quote';
    quote.dataset.sourceId = proof.canonical_page_id ?? proof.page_id;
    quote.dataset.documentId = proof.document_id ?? proof.docid ?? '';
    quote.setAttribute('aria-label', 'Inspect full source');
    // Source text is never case-normalized, abbreviated or rewritten.
    quote.append(node('blockquote', proof.text));
    content.append(quote);
    for (const qualification of group.qualifications) content.append(node('p', qualification, 'sw-qualification'));
    card.append(content);
    const page = proof.earlier_page ?? proof.physical_page ?? proof.page;
    card.append(node('footer', [proof.document_id ?? proof.docid, proof.date, page != null ? 'Page ' + page : proof.canonical_page_id ?? proof.page_id].filter(Boolean).join(' / ')));
    return card;
  };
  for (const group of groups.values()) sourceCards.append(sourceCard(group));
  sources.body.append(sourceCards.childElementCount ? sourceCards : node('p', 'No selected source quotes were supplied.', 'sw-note'));
  if (relatedGroups.size) {
    const related = node('details', null, 'sw-related-context');
    related.dataset.testid = 'standard-related-context';
    related.append(node('summary', 'Related context (' + relatedGroups.size + ')'));
    const relatedCards = node('div', null, 'sw-source-list');
    for (const group of relatedGroups.values()) relatedCards.append(sourceCard(group, true));
    related.append(relatedCards); sources.body.append(related);
  }

  const results = makeStage('05', task === 'redaction' ? 'Saved fills' : task === 'hypothesis' ? 'Hypothesis findings' : 'Mosaic findings', 'Saved result');
  const score = (value, caption, range = {min: 0, max: 1}) => {
    const number = scoreValue(value), host = node('div', null, 'sw-score');
    if (number == null) { host.append(node('span', caption + ' not supplied', 'sw-note')); return host; }
    host.append(node('span', caption, 'sw-score-label'), node('strong', number.toFixed(4), 'sw-score-value'));
    require(Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min, 'invalid supplied score range');
    if (number >= range.min && number <= range.max) {
      const meter = node('meter'); meter.min = range.min; meter.max = range.max; meter.value = number;
      meter.setAttribute('aria-label', caption); meter.setAttribute('aria-valuetext', number.toFixed(4)); host.append(meter);
    }
    return host;
  };
  const proofLinks = (parent, values) => {
    const links = node('div', null, 'sw-proof-links'), proofs = [...new Set(values.map(resolve))];
    for (const [index, proof] of proofs.entries()) {
      const fallback = proofs.length > 1 ? 'Source ' + (index + 1) : 'Inspect source';
      links.append(action(proof.digest_ids?.join(', ') || proof.label || (/^S\d+$/.test(proof.id || '') ? proof.id : fallback), typeof options.onSource === 'function' ? () => options.onSource(proof) : null, 'sw-button sw-quiet'));
    }
    if (links.childElementCount) parent.append(links);
  };
  const detail = (parent, item) => {
    const body = renderEvidenceDetails(item, {onSource: options.onSource, assertCurrent: () => current()});
    if (!body) return;
    const disclosure = node('details', null, 'sw-details');
    disclosure.append(node('summary', 'Decision and checks'), body);
    if (typeof options.onDetails === 'function') disclosure.append(action('Inspect checks', () => options.onDetails(item), 'sw-button sw-quiet'));
    parent.append(disclosure);
  };
  const hypothesisDirections = item => {
    const totals = item.directionalTotals, evidence = list(item.evidence);
    require(totals && typeof totals === 'object', 'supplied hypothesis directional totals required');
    const values = ['SUPPORT', 'OPPOSE'].map(direction => {
      const value = scoreValue(totals[direction]);
      require(value != null && value >= 0, 'finite nonnegative directional total required');
      const present = evidence.some(entry => entry.direction === direction);
      require(value === 0 || present, 'positive directional total has no corresponding evidence');
      return {direction, value, present};
    });
    const maximum = Math.max(...values.map(item => item.value));
    const chart = node('div', null, 'sw-h-directions');
    chart.dataset.testid = 'standard-h-direction-bars'; chart.dataset.scaleMax = String(maximum);
    for (const {direction, value, present} of values) {
      const caption = direction === 'SUPPORT' ? present ? 'Support evidence' : 'No support evidence recorded' : present ? 'Opposing evidence' : 'No opposing evidence recorded';
      const bar = score(value, caption, {min: 0, max: maximum || 1});
      bar.dataset.direction = direction; bar.dataset.evidencePresent = String(present);
      if (!maximum) {
        bar.querySelector('meter')?.remove();
        bar.append(node('span', null, 'sw-zero-track'));
      }
      chart.append(bar);
    }
    chart.append(node('p', 'Directional totals; shared scale, not probabilities.', 'sw-note'));
    return chart;
  };
  const resultCard = (item, redaction) => {
    const card = node('article', null, 'sw-result' + (redaction ? ' sw-fill' : '')); card.dataset.testid = redaction ? 'standard-candidate' : 'result-atom';
    if (item.id != null) card.dataset[redaction ? 'candidateId' : 'atomId'] = item.id;
    const header = node('header');
    const prefix = redaction ? (item.rank != null ? '#' + item.rank : '') : factLabels(item.fact_ids ?? item.atom_ids ?? (labels.has(item.id) ? [item.id] : []));
    if (prefix) header.append(node('span', prefix, 'sw-fact-label'));
    header.append(node('h3', format(redaction ? item.fill : item.text)));
    card.append(header);
    if (item.label) card.append(node('p', item.label, 'sw-result-label'));
    if (item.direction) card.append(node('p', item.direction, 'sw-direction'));
    if (task === 'hypothesis' && item.directionalTotals != null) {
      card.append(hypothesisDirections(item));
      const evidence = list(item.evidence), counter = node('p', evidence.length + ' selected source accounts. ', 'sw-note');
      const link = node('a', 'See selected evidence'); link.href = '#stage-04';
      link.addEventListener('click', event => { if (!current()) event.preventDefault(); });
      counter.append(link); card.append(counter);
      const voices = evidence.filter(entry => entry.voice);
      if (voices.length) {
        const attribution = node('details', null, 'sw-h-attributions');
        attribution.append(node('summary', 'Source attributions (' + voices.length + ')'));
        for (const entry of voices) attribution.append(node('p', [entry.direction, entry.voice].filter(Boolean).join(' / '), 'sw-copy'));
        card.append(attribution);
      }
    } else {
      card.append(score(redaction ? item.priority : item.score, redaction ? 'Priority' : 'Recorded score', item.scoreRange ?? options.scoreRange));
      proofLinks(card, list(item.proofs));
      for (const evidence of list(item.evidence)) {
        const lane = node('div', null, 'sw-evidence-account');
        if (evidence.direction) lane.append(node('p', evidence.direction, 'sw-direction'));
        if (evidence.voice) lane.append(node('p', evidence.voice, 'sw-copy'));
        if (evidence.score != null) lane.append(score(evidence.score, 'Recorded score', evidence.scoreRange ?? options.scoreRange));
        proofLinks(lane, [evidence.proof]); card.append(lane);
      }
    }
    detail(card, item); return card;
  };
  const rows = task === 'redaction' ? candidates : units;
  rows.slice(0, task === 'redaction' ? 5 : rows.length).forEach(item => results.body.append(resultCard(item, task === 'redaction')));
  if (!rows.length) results.body.append(node('p', task === 'redaction' ? 'No saved fills were supplied.' : 'No saved findings were supplied.', 'sw-note'));
  if (task === 'redaction' && rows.length > 5) {
    const reserves = node('details', null, 'sw-reserves');
    reserves.append(node('summary', 'More saved fills (' + (rows.length - 5) + ')'));
    rows.slice(5).forEach(item => reserves.append(resultCard(item, true))); results.body.append(reserves);
  }

  const review = makeStage('06', 'Analyst Summary', 'Review');
  const technical = node('details', null, 'sw-technical');
  technical.append(node('summary', 'Technical details'));
  const technicalBody = renderEvidenceDetails(options.technicalDetails, {onSource: options.onSource, assertCurrent: () => current()});
  if (technicalBody) technical.append(technicalBody);
  if (typeof options.onBaseline === 'function') technical.append(action('Native result', () => options.onBaseline(), 'sw-button sw-quiet'));
  if (technicalBody && typeof options.onDetails === 'function') technical.append(action('Inspect saved record', () => options.onDetails({details: options.technicalDetails}), 'sw-button sw-quiet'));
  const digestHost = node('div', null, 'sw-digest'); digestHost.dataset.testid = 'standard-digest';
  review.body.append(digestHost);
  if(technicalBody||typeof options.onBaseline==='function')review.body.append(technical);
  const context = {readingId: selectedReadingId, facts, candidates, units, proofs: [...groups.values()].map(group => group.proof), assertCurrent: () => require(current(), 'selection is stale')};
  const mount = (host, callback, unavailable, failure) => {
    if (typeof callback !== 'function') { host.append(node('p', unavailable, 'sw-note')); return; }
    host.setAttribute('aria-busy', 'true');
    queueMicrotask(() => {
      if (!current() || !host.isConnected) return;
      Promise.resolve().then(() => { if (current()) return callback(host, context); }).then(result => {
        if (!current() || !host.isConnected) return;
        if (result instanceof Node && result !== host && !host.contains(result)) host.append(result);
        host.removeAttribute('aria-busy');
        if (!host.childNodes.length) host.append(node('p', unavailable, 'sw-note'));
      }).catch(() => {
        if (!current() || !host.isConnected) return;
        host.removeAttribute('aria-busy'); host.replaceChildren(node('p', failure, 'sw-note'));
      });
    });
  };
  mount(mapHost, options.onMapMount, 'No source map was supplied.', 'The source map could not be displayed.');
  mount(digestHost, options.renderDigest, 'No analyst summary was supplied.', 'The analyst summary could not be displayed.');
  const panels = [hero, plan.outer, map.outer, sources.outer, results.outer, review.outer];
  Object.defineProperty(panels, 'destroy', {value: () => { disposed = true; }});
  return panels;
}

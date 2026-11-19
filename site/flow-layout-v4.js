/* Layout is a view of recorded states, never an additional diffusion kernel. */
export function formatNumber(value,missing="Not supplied") {
  if(!Number.isFinite(value))return missing;
  if(value===0)return "0";
  const rounded=value.toLocaleString("en-US",{maximumFractionDigits:2});
  return Math.abs(value)<.001||Number(rounded.replaceAll(",",""))===0?value.toExponential(2):rounded;
}
export function formatTargetText(item={},task){
  const text=String(item.fill||item.label||item.id||'');
  if(!['hypothesis','mosaic'].includes(task))return text;
  const labels={FOR:'SUPPORT',SUPPORT:'SUPPORT',SUPPORTED:'SUPPORT',AGAINST:'OPPOSE',COUNTER:'OPPOSE',OPPOSED:'OPPOSE',SOME:'PARTIAL',PARTIAL:'PARTIAL'};
  const direction=labels[String(item.direction||'').toUpperCase()];
  return text.replace(/^(FOR|SUPPORT|SUPPORTED|AGAINST|COUNTER|OPPOSED|SOME|PARTIAL)(\s*\/\s*)/,(all,raw,separator)=>labels[raw]===direction?labels[raw]+separator:all);
}

export function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : "new";
  return 100 * (current - previous) / previous;
}

export function massRadius(mass, maximum) {
  if (!Number.isFinite(mass) || mass < 0) return 0;
  return Math.max(2.5, maximum > 0 ? 18 * Math.sqrt(mass / maximum) : 2.5);
}

export function changeColor(value) {
  if (value === "new") return "#ddb33e";
  if (!Number.isFinite(value) || value === 0) return "#c6d9e8";
  const amount = 2 * Math.atan(Math.abs(value) / 100) / Math.PI;
  const from = value > 0 ? [218, 239, 231] : [250, 226, 216];
  const to = value > 0 ? [17, 132, 101] : [204, 69, 45];
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * amount)).join(",")})`;
}

export function visibleUniverse(projection, limit = 96, selectedCandidate = null) {
  const all = new Map(projection.nodes.map(n => [n.id, n]));
  const visible = new Set();
  function add(id, required = false) {
    const chain = new Set();
    let at = id;
    while (at) {
      if (!all.has(at) || chain.has(at)) throw Error("The saved hierarchy contains an invalid parent chain.");
      chain.add(at); at = all.get(at).parent_id;
    }
    const needed = [...chain].filter(id => !visible.has(id));
    if (visible.size + needed.length > limit && !required) return;
    needed.forEach(id => visible.add(id));
  }
  projection.nodes.filter(n => n.candidate_ranks?.length || n.source_candidate_ranks?.length).forEach(n => add(n.id, true));
  const candidate = projection.candidates.find(c => c.id === selectedCandidate);
  for (const path of candidate?.routes || []) for (const n of path.nodes || []) if (all.has(n.id)) add(n.id);
  for (const edge of candidate?.contribution_edges || []) { if (all.has(edge.source)) add(edge.source); if (all.has(edge.target)) add(edge.target); }
  for (const starter of projection.starters) {
    const best = [...starter.targets].sort((a, b) => b.mass - a.mass || a.id.localeCompare(b.id))[0];
    if (best && all.has(best.id)) add(best.id);
  }
  [...projection.nodes].sort((a, b) => (b.final_mass || 0) - (a.final_mass || 0) || a.id.localeCompare(b.id)).forEach(n => add(n.id));
  return projection.nodes.filter(n => visible.has(n.id));
}

function partition(items, box, weight, out) {
  if (!items.length) return;
  if (items.length === 1) { out.set(items[0].id, box); return; }
  const total = items.reduce((sum, n) => sum + weight(n), 0);
  let middle = 1, value = weight(items[0]);
  while (middle < items.length - 1 && value + weight(items[middle]) / 2 < total / 2) value += weight(items[middle++]);
  const ratio = value / total, gap = 4;
  if (box.w >= box.h) {
    const first = Math.max(0, box.w * ratio - gap / 2);
    partition(items.slice(0, middle), {...box, w: first}, weight, out);
    partition(items.slice(middle), {...box, x: box.x + first + gap, w: Math.max(0, box.w - first - gap)}, weight, out);
  } else {
    const first = Math.max(0, box.h * ratio - gap / 2);
    partition(items.slice(0, middle), {...box, h: first}, weight, out);
    partition(items.slice(middle), {...box, y: box.y + first + gap, h: Math.max(0, box.h - first - gap)}, weight, out);
  }
}

export function nestedLayout(nodes, width, height) {
  const all = new Map(nodes.map(n => [n.id, n])), children = new Map(), roots = [], counts = new Map();
  const isGroup = n => ["domain", "theme", "community"].includes(n.type.toLowerCase());
  for (const node of nodes) {
    if (node.parent_id) {
      if (!all.has(node.parent_id)) throw Error("A displayed child is missing its actual parent.");
      if (!children.has(node.parent_id)) children.set(node.parent_id, []);
      children.get(node.parent_id).push(node);
    } else roots.push(node);
  }
  const counting = new Set();
  function count(n) {
    if (counts.has(n.id)) return counts.get(n.id);
    if (counting.has(n.id)) throw Error("Cyclic hierarchy cannot be displayed.");
    counting.add(n.id);
    const value = 1 + (children.get(n.id) || []).reduce((sum, child) => sum + count(child), 0);
    counting.delete(n.id); counts.set(n.id, value); return value;
  }
  roots.forEach(count);
  if (counts.size !== nodes.length) throw Error("A hierarchy component has no root.");
  const positions = new Map(), regions = [];
  function place(items, box, depth = 0) {
    const groups = items.filter(isGroup).sort((a, b) => count(b) - count(a) || a.id.localeCompare(b.id));
    const leaves = items.filter(n => !isGroup(n));
    const partitioned = new Map();
    partition([...groups, ...(leaves.length ? [{id:"__leaves__",type:"layout",count:leaves.length}] : [])], box,
      n => n.id === "__leaves__" ? n.count : count(n), partitioned);
    for (const group of groups) {
      const rect = partitioned.get(group.id), header = Math.min(39, Math.max(10, rect.h * .3));
      regions.push({...rect, id:group.id, depth, label:group.label, type:group.type, header});
      positions.set(group.id, {x:rect.x + Math.min(23, rect.w / 2), y:rect.y + header / 2, region:rect});
      const kids = children.get(group.id) || [];
      place(kids, {x:rect.x + 5, y:rect.y + header + 3, w:Math.max(0, rect.w - 10), h:Math.max(0, rect.h - header - 8)}, depth + 1);
    }
    if (leaves.length) {
      const rect = partitioned.get("__leaves__"), columns = Math.max(1, Math.ceil(Math.sqrt(leaves.length * Math.max(1, rect.w) / Math.max(1, rect.h))));
      const rows = Math.ceil(leaves.length / columns);
      [...leaves].sort((a, b) => a.id.localeCompare(b.id)).forEach((node, i) => positions.set(node.id, {
        x:rect.x + (i % columns + .5) * rect.w / columns,
        y:rect.y + (Math.floor(i / columns) + .5) * rect.h / rows, region:rect}));
    }
  }
  place(roots, {x:12,y:12,w:Math.max(1,width-24),h:Math.max(1,height-24)});
  return {positions, regions};
}

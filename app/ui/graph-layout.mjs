// Tidy top-down layout: rows aligned by depth, single-parent children centred under their parent,
// join nodes (several parents) centred under their parents. Edges share a bus just above each row.
const GAP_X = 20, GAP_Y = 52;
export async function layoutGraph(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n])), parents = id => edges.filter(e => e.target === id).map(e => e.source).filter(p => byId.has(p));
  const depth = new Map(), seen = new Set();
  const d = id => { if (depth.has(id)) return depth.get(id); if (seen.has(id)) return 0; seen.add(id); const p = parents(id), v = p.length ? Math.max(...p.map(d)) + 1 : 0; depth.set(id, v); return v; };
  nodes.forEach(n => d(n.id));
  const rows = [], rowY = [0];
  for (const n of nodes) rows[depth.get(n.id)] = Math.max(rows[depth.get(n.id)] || 0, n.height);
  for (let i = 1; i <= rows.length; i++) rowY[i] = rowY[i - 1] + (rows[i - 1] || 0) + GAP_Y;
  const kids = id => nodes.filter(n => { const p = parents(n.id); return p.length === 1 && p[0] === id; });
  const span = new Map(), sp = id => { if (span.has(id)) return span.get(id); const k = kids(id), w = Math.max(byId.get(id).width, k.reduce((t, c) => t + sp(c.id), 0) + GAP_X * Math.max(0, k.length - 1)); span.set(id, w); return w; };
  const x = new Map();
  const place = (id, left) => { const w = sp(id), k = kids(id); x.set(id, left + w / 2); let total = k.reduce((t, c) => t + sp(c.id), 0) + GAP_X * Math.max(0, k.length - 1), cur = left + (w - total) / 2; for (const c of k) { place(c.id, cur); cur += sp(c.id) + GAP_X; } };
  let left = 0;
  for (const n of nodes.filter(n => !parents(n.id).length)) { place(n.id, left); left += sp(n.id) + GAP_X; }
  const joins = nodes.filter(n => parents(n.id).length > 1).sort((a, b) => depth.get(a.id) - depth.get(b.id));
  for (const n of joins) { const p = parents(n.id).filter(id => x.has(id)), cx = p.length ? p.reduce((t, id) => t + x.get(id), 0) / p.length : left + sp(n.id) / 2; place(n.id, cx - sp(n.id) / 2); }
  const pos = id => ({ x: x.get(id) - byId.get(id).width / 2, y: rowY[depth.get(id)] });
  return {
    nodes: nodes.map(n => ({ ...n, position: pos(n.id) })),
    edges: edges.filter(e => byId.has(e.source) && byId.has(e.target)).map(e => {
      const s = byId.get(e.source), t = byId.get(e.target), sx = x.get(e.source), sy = pos(e.source).y + s.height, tx = x.get(e.target), ty = pos(e.target).y, my = ty - GAP_Y / 2;
      return { ...e, points: sx === tx ? [{ x: sx, y: sy }, { x: tx, y: ty }] : [{ x: sx, y: sy }, { x: sx, y: my }, { x: tx, y: my }, { x: tx, y: ty }] };
    })
  };
}
export function sideGraph(side, exit) {
  const nodes = [],
    edges = [];
  let sequence = 0;
  const connect = (source, target) => {
    if (source !== target) edges.push({
      id: `side-edge-${sequence++}`,
      source,
      target
    });
  };
  const walk = (tree, prefix) => {
    const inputs = [];
    const predecessorIds = derivation => derivation.entries.flatMap(e => [
      ...(!e.deleted && !e.derivation ? [e.mainId] : []),
      ...(e.derivation ? predecessorIds(e.derivation) : [])
    ]);
    const alreadyRepresented = new Set(tree.entries.flatMap(e => e.derivation ? predecessorIds(e.derivation) : []));
    for (const [i, entry] of tree.entries.entries()) {
      if (!entry.deleted && !entry.derivation && alreadyRepresented.has(entry.mainId)) continue;
      const id = `entry-${prefix}-${i}`,
        previous = entry.derivation ? walk(entry.derivation, `${prefix}-${i}`) : null;
      nodes.push({
        id,
        width: 150,
        height: 104,
        data: {
          ...entry.snapshot,
          title: undefined,
          text: entry.snapshot.title,
          entry: true,
          deleted: entry.deleted
        },
        type: 'side'
      });
      if (previous) for (const leaf of previous.leaves) connect(leaf, id);
      inputs.push(id);
    }
    for (const n of tree.nodes) {
      nodes.push({
        id: n.id,
        width: 150,
        height: 116,
        type: 'side',
        data: {
          ...n,
          key: tree.keyId === n.id
        }
      });
      if (n.parentId) connect(n.parentId, n.id);else for (const entry of inputs) connect(entry, n.id);
    }
    const leaves = tree.nodes.filter(n => !tree.nodes.some(c => c.parentId === n.id) && n.state !== 'rejected').map(n => n.id);
    return {
      leaves: leaves.length ? leaves : inputs
    };
  };
  const result = walk(side, 'root'),
    id = `exit-${exit.id}`;
  if (exit.sourceSideId && nodes.some(n => n.id === exit.sourceSideId)) {
    nodes.find(n => n.id === exit.sourceSideId).data.exit = true;
  } else {
    nodes.push({
      id,
      width: 150,
      height: 116,
      type: 'side',
      data: {
        ...exit,
        text: exit.title,
        exit: true
      }
    });
    for (const leaf of result.leaves) connect(leaf, id);
  }
  for (const n of nodes) {
    const d = n.data,
      lines = Math.ceil((2 + [...(d.text || '')].reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : .55), 0)) / 9);
    const metaLines = Math.ceil((10 + (d.note?.length || 0)) / 12);
    n.height = Math.max(62, 22 + lines * 20 + metaLines * 17 + (d.entry || d.exit ? 20 : 0));
  }
  return {
    nodes,
    edges
  };
}

import { randomUUID } from 'node:crypto';
import { Store, AppError, PROJECT_ROOT, identifier, text, now } from './storage.mjs';
export { Store, AppError, PROJECT_ROOT, identifier, text, now };
export const uid = prefix => `${prefix}-${randomUUID()}`;
const required = (v, name, max = 4000) => {
  const s = text(v, name, max).trim();
  if (!s) throw new AppError(`${name}不能为空。`);
  return s;
};
const choice = (v, values) => {
  if (!values.includes(v)) throw new AppError(`无效值 ${v}。`);
  return v;
};
const MAIN = ['frontier', 'tentative', 'aligned'],
  SIDE = ['open', 'aligned', 'rejected', 'revised'];
export const emptySide = () => ({
  entries: [],
  nodes: [],
  keyId: null
});
export function emptyProject(name, id = uid('project')) {
  return {
    id: identifier(id),
    name: required(name, '项目名称', 160),
    description: '',
    revision: 0,
    createdAt: now(),
    updatedAt: now(),
    main: {
      nodes: [],
      edges: []
    },
    side: {},
    counters: {
      m: 0,
      s: 0,
      e: 0
    },
    proposals: {},
    view: {
      positions: {},
      focus: null
    },
    undo: [],
    redo: [],
    events: []
  };
}
export function project(data, id) {
  identifier(id);
  if (!Object.hasOwn(data.projects, id)) throw new AppError('找不到项目。', 404, 'project_missing');
  const p = data.projects[id];
  if (p.deletedAt) throw new AppError('项目已移入回收站。', 410, 'project_deleted');
  return validateProject(p);
}
export const publicProject = p => {
  const {
    undo,
    redo,
    events,
    ...rest
  } = p;
  return {
    ...structuredClone(rest),
    canUndo: !!undo.length,
    canRedo: !!redo.length
  };
};
export const snapshot = p => structuredClone({
  name: p.name,
  description: p.description,
  main: p.main,
  side: p.side,
  proposals: p.proposals
});
export const frontierNodes = p => p.main.nodes.filter(n => !p.main.edges.some(e => e.source === n.id));
export function orderedNodes(nodes, edges) {
  const degree = new Map(nodes.map(n => [n.id, 0]));
  for (const e of edges) degree.set(e.target, (degree.get(e.target) || 0) + 1);
  const ready = nodes.filter(n => degree.get(n.id) === 0),
    result = [];
  while (ready.length) {
    const n = ready.shift();
    result.push(n);
    for (const e of edges.filter(e => e.source === n.id)) {
      degree.set(e.target, degree.get(e.target) - 1);
      if (!degree.get(e.target)) ready.push(nodes.find(n => n.id === e.target));
    }
  }
  return {
    nodes: result,
    cyclic: result.length !== nodes.length
  };
}
// Retired conclusions are explicit junctions: prior derivation -> conclusion -> receiving tree.
// Each derivation retains its original parents, including rejected alternatives.
export const sideTrees = side => [side, ...side.entries.flatMap(e => e.derivation ? sideTrees(e.derivation) : [])];
export const sideNodes = side => sideTrees(side).flatMap(s => s.nodes);
function locate(p, mainId, id) {
  const side = p.side[mainId];
  if (!side) throw new AppError('副图不存在。');
  const tree = sideTrees(side).find(s => s.nodes.some(n => n.id === id));
  return tree && {
    tree,
    node: tree.nodes.find(n => n.id === id)
  };
}
function validateNode(n, states) {
  identifier(n.id);
  choice(n.state, states);
  choice(n.by, ['user', 'ai', 'aligned']);
  if (!Number.isInteger(n.turn) || n.turn < 0) throw new AppError('轮次无效。');
  if (n.state === 'aligned') required(n.alignedBy, '用户认可原话');
  if (n.state === 'rejected') required(n.note, '否定理由');
}
export function validateProject(p) {
  if (!p.main || !p.side || 'authority' in p || 'nodes' in p || 'selection' in p) throw new AppError('旧格式项目无法打开；不提供迁移，请由用户自行清理。', 400, 'unsupported_format');
  const ids = new Set(p.main.nodes.map(n => n.id));
  if (ids.size !== p.main.nodes.length) throw new AppError('主图标识重复。');
  for (const n of p.main.nodes) {
    validateNode(n, MAIN);
    required(n.title, '标题');
    if (!p.side[n.id]) throw new AppError('缺少副图。');
  }
  if (new Set(p.main.edges.map(e => e.id)).size !== p.main.edges.length) throw new AppError('连线标识重复。');
  const pairs = new Set();
  for (const e of p.main.edges) {
    identifier(e.id);
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) throw new AppError('连线端点无效。');
    const pair = `${e.source}/${e.target}`;
    if (pairs.has(pair)) throw new AppError('连线重复。');
    pairs.add(pair);
  }
  if (orderedNodes(p.main.nodes, p.main.edges).cyclic) throw new AppError('主图必须无环。', 400, 'cyclic_main');
  const allIds = new Set();
  for (const [mainId, side] of Object.entries(p.side)) {
    if (!ids.has(mainId)) throw new AppError('副图没有主图节点。');
    const trees = sideTrees(side);
    if (trees.filter(s => s.keyId != null).length > 1) throw new AppError('每张副图最多一个重点。');
    for (const tree of trees) {
      const local = new Set(tree.nodes.map(n => n.id));
      if (tree.keyId != null && (typeof tree.keyId !== 'string' || !local.has(tree.keyId))) throw new AppError('重点必须属于副图。');
      if (tree.nodes.length && tree.nodes.filter(n => n.parentId === null).length !== 1) throw new AppError('副图必须有且只有一个根问题。');
      for (const n of tree.nodes) {
        validateNode(n, SIDE);
        required(n.text, '副图文字');
        if (allIds.has(n.id)) throw new AppError('副图标识重复。');
        allIds.add(n.id);
        if (n.parentId !== null && !local.has(n.parentId)) throw new AppError('父节点必须在同一副图树中。');
      }
      if (orderedNodes(tree.nodes, tree.nodes.filter(n => n.parentId).map(n => ({
        source: n.parentId,
        target: n.id
      }))).cyclic) throw new AppError('副图不能形成循环。');
      for (const e of tree.entries) {
        identifier(e.mainId);
        if (!e.snapshot || typeof e.deleted !== 'boolean') throw new AppError('入口快照无效。');
      }
    }
    const incoming = p.main.edges.filter(e => e.target === mainId).map(e => e.source).sort(),
      live = side.entries.filter(e => !e.deleted && !e.derivation).map(e => e.mainId).sort();
    if (JSON.stringify(incoming) !== JSON.stringify(live)) throw new AppError('入口与前驱不一致。');
  }
  return p;
}
function syncEntries(p) {
  for (const n of p.main.nodes) {
    const s = p.side[n.id];
    s.entries = [...s.entries.filter(e => e.deleted || e.derivation), ...p.main.edges.filter(e => e.target === n.id).map(e => ({
      mainId: e.source,
      deleted: false,
      snapshot: structuredClone(p.main.nodes.find(n => n.id === e.source))
    }))];
  }
}
const allocate = (p, prefix) => `${prefix}${++p.counters[prefix]}`;
function mainNode(p, id) {
  const n = p.main.nodes.find(n => n.id === id);
  if (!n) throw new AppError('主图节点不存在。');
  return n;
}
function protect(n, actor) {
  if (actor === 'ai' && (n.state === 'aligned' || n.userEdited)) throw new AppError('请使用 proposeRevision 提出待审修订。', 409, 'protected_content');
}
function sources(n, values, actor) {
  if (!Array.isArray(values)) throw new AppError('来源必须是列表。');
  for (const v of values) {
    const s = {
        id: identifier(v.id || uid('source')),
        label: text(v.label || '讨论来源', '来源标题', 200),
        kind: choice(v.kind || 'note', ['quote', 'document', 'node', 'note']),
        reference: text(v.reference || '', '出处', 1000),
        quote: text(v.quote || '', '原话', 60000),
        author: text(v.author || '', '作者', 120)
      },
      old = n.sources.find(x => x.id === s.id);
    if (old && actor === 'ai' && JSON.stringify(old) !== JSON.stringify(s)) throw new AppError('AI 不能替换已有原文。', 409, 'protected_source');
    if (old) Object.assign(old, s);else n.sources.push(s);
  }
}
function patchNode(n, op, actor, main) {
  for (const key of main ? ['title', 'summary', 'body'] : ['text', 'note']) if (op[key] !== undefined) n[key] = text(op[key], key, key === 'body' ? 160000 : 4000);
  if (op.state !== undefined) n.state = choice(op.state, main ? MAIN : SIDE);
  n.by = choice(op.by ?? actor, ['user', 'ai', 'aligned']);
  if (op.turn !== undefined) n.turn = op.turn;
  if (op.alignedBy !== undefined) n.alignedBy = required(op.alignedBy, '用户认可原话');
  if (n.state === 'aligned' && op.state === 'aligned') required(op.alignedBy, '本次用户认可原话');
  if (op.sources !== undefined) sources(n, op.sources, actor);
  n.updatedAt = now();
  if (actor === 'user') n.userEdited = true;
}
function version(n, op, actor) {
  const {
    versions,
    ...previous
  } = structuredClone(n);
  n.versions.push({
    ...previous,
    at: now(),
    by: op.by || actor,
    reason: op.reason || '刷新'
  });
}
export function needsRevision(p, ops) {
  return ops.some(op => ['refreshMain', 'convergeMain', 'deleteMain', 'proposeRevision', 'renameProject', 'promoteSide', 'mergeMain'].includes(op.op) || op.op === 'upsertMain' && p.main.nodes.some(n => n.id === op.id) || op.op === 'linkMain' && p.main.edges.some(e => e.id === op.id));
}
export function mutate(p, operations, {
  actor = 'user'
} = {}) {
  choice(actor, ['user', 'ai']);
  if (!Array.isArray(operations) || !operations.length || operations.length > 300) throw new AppError('需要 1 至 300 项操作。');
  const draft = structuredClone(p),
    aliases = {};
  const resolve = id => id?.startsWith('@') ? aliases[id] || (() => {
    throw new AppError(`未定义临时标识 ${id}。`);
  })() : id;
  const newMains = new Set();
  for (const original of operations) {
    const op = {
      ...original
    };
    let allocated = false;
    if (['upsertMain', 'upsertSide', 'linkMain'].includes(op.op) && (!op.id || op.id.startsWith('@') && !aliases[op.id])) {
      const id = allocate(draft, {
        upsertMain: 'm',
        upsertSide: 's',
        linkMain: 'e'
      }[op.op]);
      if (op.id) aliases[op.id] = id;
      op.id = id;
      allocated = true;
    }
    for (const key of ['id', 'mainId', 'parentId', 'source', 'target', 'keyId', 'replacementId', 'targetId']) if (op[key] != null) op[key] = resolve(op[key]);
    if (op.id) identifier(op.id);
    if (['upsertMain', 'refreshMain', 'convergeMain'].includes(op.op)) {
      let n = draft.main.nodes.find(n => n.id === op.id);
      if (!n && op.op !== 'upsertMain') throw new AppError('主图节点不存在。');
      if (n) {
        protect(n, actor);
        version(n, op, actor);
      } else {
        if (!allocated) throw new AppError('新主图 ID 必须由服务端分配。');
        newMains.add(op.id);
        if (!/^m[1-9]\d*$/.test(op.id)) throw new AppError('新节点使用服务端短 ID。');
        draft.counters.m = Math.max(draft.counters.m, Number(op.id.slice(1)));
        n = {
          id: op.id,
          title: '',
          summary: '',
          body: '',
          sources: [],
          state: 'frontier',
          by: actor,
          turn: 0,
          versions: [],
          userEdited: false,
          createdAt: now()
        };
        draft.main.nodes.push(n);
        draft.side[n.id] = emptySide();
      }
      patchNode(n, op.op === 'convergeMain' ? {
        ...op,
        state: 'aligned'
      } : op, actor, true);
      required(n.title, '标题');
    } else if (op.op === 'linkMain') {
      const from = mainNode(draft, op.source),
        to = mainNode(draft, op.target),
        old = draft.main.edges.find(e => e.id === op.id);
      if (actor === 'ai' && (from.structureLocked && !newMains.has(to.id) || to.structureLocked || old?.userEdited || old && [old.source, old.target].some(id => mainNode(draft, id).structureLocked))) throw new AppError('用户结构已锁定。', 409, 'locked_structure');
      const e = {
        id: op.id,
        source: from.id,
        target: to.id,
        userEdited: actor === 'user'
      };
      if (old) Object.assign(old, e);else draft.main.edges.push(e);
    } else if (op.op === 'upsertSide') {
      mainNode(draft, op.mainId);
      const found = locate(draft, op.mainId, op.id);
      if (found) {
        if (actor === 'ai' && (found.node.userEdited || op.text !== undefined && op.text !== found.node.text || op.parentId !== undefined && op.parentId !== found.node.parentId)) throw new AppError('副图只追加；状态变化使用 setSideState。', 409, 'protected_content');
        if (op.parentId !== undefined) found.node.parentId = op.parentId;
        patchNode(found.node, op, actor, false);
      } else {
        if (!allocated) throw new AppError('新副图 ID 必须由服务端分配。');
        if (!/^s[1-9]\d*$/.test(op.id)) throw new AppError('新节点使用服务端短 ID。');
        draft.counters.s = Math.max(draft.counters.s, Number(op.id.slice(1)));
        const n = {
          id: op.id,
          parentId: op.parentId ?? null,
          text: '',
          sources: [],
          note: '',
          state: 'open',
          by: actor,
          turn: 0,
          userEdited: false
        };
        patchNode(n, op, actor, false);
        draft.side[op.mainId].nodes.push(n);
      }
    } else if (op.op === 'setSideState') {
      const found = locate(draft, op.mainId, op.id);
      if (!found) throw new AppError('副图节点不存在。');
      if (actor === 'ai' && found.node.userEdited) throw new AppError('不能修改用户手改节点。', 409, 'protected_content');
      patchNode(found.node, {
        state: op.state,
        note: op.note,
        alignedBy: op.alignedBy,
        by: op.by,
        turn: op.turn
      }, actor, false);
    } else if (op.op === 'setKey') {
      const side = draft.side[op.mainId];
      if (!side) throw new AppError('副图不存在。');
      if (actor === 'ai' && side.keyLocked) throw new AppError('用户重点已锁定。', 409, 'locked_structure');
      const id = op.keyId ?? null,
        found = id && locate(draft, op.mainId, id);
      if (id && !found) throw new AppError('重点不存在。');
      for (const tree of sideTrees(side)) tree.keyId = null;
      if (found) found.tree.keyId = id;
      if (actor === 'user') side.keyLocked = true;
    } else if (op.op === 'deleteMain') {
      const n = mainNode(draft, op.id);
      protect(n, actor);
      if (actor === 'ai' && n.structureLocked) throw new AppError('用户结构已锁定。', 409, 'locked_structure');
      const incoming = draft.main.edges.filter(e => e.target === n.id),
        outgoing = draft.main.edges.filter(e => e.source === n.id);
      let target = op.replacementId;
      if (!target && outgoing.length > 1) throw new AppError('请指定接收副图的后继节点。', 400, 'replacement_required');
      target ||= outgoing[0]?.target;
      if (!target) {
        target = allocate(draft, 'm');
        const next = {
          ...structuredClone(n),
          id: target,
          title: `进行中：${n.title.replace(/^进行中：/, '')}`,
          summary: '',
          state: 'frontier',
          alignedBy: undefined,
          versions: [],
          by: actor,
          userEdited: actor === 'user',
          createdAt: now(),
          updatedAt: now()
        };
        draft.main.nodes.push(next);
        draft.side[target] = emptySide();
      }
      if (target === n.id) throw new AppError('不能用自身替换。');
      const receiver = mainNode(draft, target);
      protect(receiver, actor);
      const originalSide = draft.side[n.id],
        receivingSide = draft.side[target];
      if (sideTrees(receivingSide).some(s => s.keyId)) for (const tree of sideTrees(originalSide)) tree.keyId = null;
      receivingSide.entries.unshift({
        mainId: n.id,
        deleted: true,
        snapshot: structuredClone(n),
        derivation: originalSide
      });
      draft.main.edges = draft.main.edges.filter(e => e.source !== n.id && e.target !== n.id);
      const connect = (source, target) => {
        if (source !== target && !draft.main.edges.some(e => e.source === source && e.target === target)) draft.main.edges.push({
          id: allocate(draft, 'e'),
          source,
          target,
          userEdited: actor === 'user'
        });
      };
      for (const e of incoming) connect(e.source, target);
      for (const e of outgoing) if (e.target !== target) connect(target, e.target);
      draft.main.nodes = draft.main.nodes.filter(x => x.id !== n.id);
      delete draft.side[n.id];
      delete draft.proposals[n.id];
      if (actor === 'user') {
        receiver.structureLocked = true;
        for (const e of [...incoming, ...outgoing]) {
          const other = draft.main.nodes.find(x => x.id === (e.source === n.id ? e.target : e.source));
          if (other) other.structureLocked = true;
        }
      }
    } else if (op.op === 'mergeMain') {
      if (actor !== 'user') throw new AppError('合并只能由用户操作。', 403, 'manual_only');
      const other = op.targetId;
      mainNode(draft, op.id);
      mainNode(draft, other);
      const edge = draft.main.edges.find(e => e.source === op.id && e.target === other || e.source === other && e.target === op.id);
      if (!edge) throw new AppError('只能合并相邻主图节点。');
      const earlier = edge.source,
        later = edge.target;
      mutate(draft, [{
        op: 'deleteMain',
        id: earlier,
        replacementId: later
      }], {
        actor: 'user'
      });
      draft.side[later].entries.find(e => e.mainId === earlier && e.derivation).deleted = false;
    } else if (op.op === 'promoteSide') {
      if (actor !== 'user') throw new AppError('提升只能由用户操作。', 403, 'manual_only');
      const original = mainNode(draft, op.mainId),
        found = locate(draft, op.mainId, op.id);
      if (!found) throw new AppError('副图节点不存在。');
      const tree = found.tree,
        chosen = found.node,
        path = [];
      let cursor = chosen;
      while (cursor) {
        path.unshift(cursor.id);
        cursor = tree.nodes.find(n => n.id === cursor.parentId);
      }
      const moved = new Set(path),
        include = id => {
          moved.add(id);
          for (const child of tree.nodes.filter(n => n.parentId === id)) include(child.id);
        };
      for (const id of path) {
        const n = tree.nodes.find(n => n.id === id);
        for (const sibling of tree.nodes.filter(s => s.parentId === n.parentId && s.id !== id && s.state === 'rejected')) include(sibling.id);
      }
      const newId = allocate(draft, 'm'),
        newMain = {
          id: newId,
          title: op.title || chosen.text,
          summary: '',
          body: '',
          sources: structuredClone(chosen.sources),
          state: chosen.state === 'aligned' ? 'aligned' : 'tentative',
          alignedBy: chosen.alignedBy,
          by: 'user',
          turn: chosen.turn,
          versions: [],
          userEdited: true,
          structureLocked: true,
          sourceSideId: chosen.id,
          createdAt: now(),
          updatedAt: now()
        };
      const movedNodes = tree.nodes.filter(n => moved.has(n.id)).map(n => ({
        ...structuredClone(n),
        userEdited: true
      }));
      const remaining = tree.nodes.filter(n => !moved.has(n.id)),
        copies = new Map();
      const copyAncestor = id => {
        if (!id || !moved.has(id)) return id;
        if (copies.has(id)) return copies.get(id).id;
        const source = tree.nodes.find(n => n.id === id),
          copy = {
            ...structuredClone(source),
            id: allocate(draft, 's'),
            parentId: copyAncestor(source.parentId),
            referenceMainId: newId,
            note: source.note,
            userEdited: true
          };
        copies.set(id, copy);
        const originalCopy = movedNodes.find(n => n.id === id);
        if (originalCopy) {
          originalCopy.referenceMainId = op.mainId;
        }
        return copy.id;
      };
      for (const n of remaining) n.parentId = copyAncestor(n.parentId);
      const newSide = {
        entries: tree.entries,
        nodes: movedNodes,
        keyId: moved.has(tree.keyId) ? tree.keyId : null,
        keyLocked: true
      };
      tree.nodes = [...copies.values(), ...remaining];
      tree.entries = [];
      if (moved.has(tree.keyId)) tree.keyId = null;
      draft.main.nodes.splice(draft.main.nodes.indexOf(original), 0, newMain);
      draft.side[newId] = newSide;
      for (const e of draft.main.edges.filter(e => e.target === original.id)) {
        e.target = newId;
        e.userEdited = true;
        mainNode(draft, e.source).structureLocked = true;
      }
      draft.main.edges.push({
        id: allocate(draft, 'e'),
        source: newId,
        target: original.id,
        userEdited: true
      });
      original.structureLocked = true;
      aliases.promotedId = newId;
    } else if (op.op === 'proposeRevision') {
      const n = mainNode(draft, op.id);
      if (draft.proposals[n.id]) throw new AppError('已有待审修订。', 409, 'pending_revision');
      const patch = {};
      for (const key of ['title', 'summary', 'body', 'state', 'alignedBy', 'sources', 'turn', 'by', 'reason']) if (op[key] !== undefined) patch[key] = op[key];
      if (!Object.keys(patch).length) throw new AppError('修订需要内容。');
      const checked = structuredClone(n);
      patchNode(checked, patch, 'user', true);
      validateNode(checked, MAIN);
      required(checked.title, '标题');
      draft.proposals[n.id] = {
        id: uid('proposal'),
        patch,
        base: JSON.stringify(n),
        createdAt: now()
      };
    } else if (op.op === 'renameProject') draft.name = required(op.name, '项目名称', 160);else throw new AppError(`不支持操作 ${op.op}。`);
  }
  syncEntries(draft);
  validateProject(draft);
  Object.assign(p, draft);
  return aliases;
}
export function commit(p, before, {
  actor = 'user',
  sessionId = null,
  message = '更新项目',
  history = true
} = {}) {
  if (history) {
    p.undo.push(before);
    if (p.undo.length > 30) p.undo.shift();
    p.redo = [];
  }
  p.revision++;
  p.updatedAt = now();
  const diff = (old, current) => ({
      upserted: current.filter(n => JSON.stringify(n) !== JSON.stringify(old.find(x => x.id === n.id))),
      removed: old.filter(n => !current.some(x => x.id === n.id)).map(n => n.id)
    }),
    side = {};
  for (const id of Object.keys(p.side)) if (JSON.stringify(before.side[id]) !== JSON.stringify(p.side[id])) side[id] = {
    nodes: structuredClone(diff(before.side[id] ? sideNodes(before.side[id]) : [], sideNodes(p.side[id]))),
    entries: p.side[id].entries.map(e => ({
      mainId: e.mainId,
      deleted: e.deleted
    })),
    keyId: sideTrees(p.side[id]).find(s => s.keyId)?.keyId || null
  };
  p.events.push({
    revision: p.revision,
    actor,
    sessionId,
    message,
    at: p.updatedAt,
    nodes: structuredClone(diff(before.main.nodes, p.main.nodes)),
    edges: structuredClone(diff(before.main.edges, p.main.edges)),
    side,
    removedSideIds: Object.keys(before.side).filter(id => !p.side[id]),
    proposalIds: [...new Set([...Object.keys(before.proposals || {}), ...Object.keys(p.proposals)])].filter(id => JSON.stringify(before.proposals?.[id]) !== JSON.stringify(p.proposals[id]))
  });
  if (p.events.length > 200) p.events.shift();
}
export function assertRevision(p, expected) {
  if (!Number.isInteger(expected) || expected !== p.revision) throw new AppError(`项目已更新，当前版本 ${p.revision}。`, 409, 'revision_conflict');
}
export function markdown(p, language = 'en', includeSources = false) {
  const zh = language === 'zh-CN';
  const states = { aligned: '对齐', frontier: '进行中', tentative: '暂定' };
  const lines = [`# ${p.name}`, ''];
  for (const n of orderedNodes(p.main.nodes, p.main.edges).nodes) {
    lines.push(`## ${n.title}`, '', `${n.id} · ${zh ? states[n.state] : n.state} · ${zh ? '第 ' + n.turn + ' 轮' : 'Turn ' + n.turn}`, '', n.body || n.summary, '');
    if (includeSources) for (const s of n.sources) lines.push(`- ${s.label}${s.reference ? `: ${s.reference}` : ''}`, ...(s.quote ? s.quote.split('\n').map(l => `> ${l}`) : []), '');
  }
  if (p.main.edges.length) {
    lines.push(zh ? '## 主图关系' : '## Main connections', '');
    for (const e of p.main.edges) lines.push(`- ${e.source} → ${e.target}`);
    lines.push('');
  }
  lines.push(language === 'zh-CN' ? `项目版本：${p.revision}` : `Revision: ${p.revision}`);
  return lines.join('\n');
}

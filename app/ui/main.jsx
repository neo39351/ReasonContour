import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, BaseEdge, useReactFlow, useViewport, applyNodeChanges, useNodesInitialized, useStore } from '@xyflow/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { layoutGraph, sideGraph } from './graph-layout.mjs';
import { applySavedAppearance, setAppearance, useAppearance } from './appearance.jsx';
import '@xyflow/react/dist/style.css';
import { LocaleContext, useText } from './i18n.jsx';
import './theme.css';
import './style.css';
import './shell.css';
const symbols = {
  aligned: '●',
  frontier: '?',
  tentative: '?',
  open: '?',
  rejected: '✗',
  revised: '↺'
};
const labels = {
  aligned: '对齐',
  frontier: '进行中',
  tentative: '暂定',
  open: '进行中',
  rejected: '被否',
  revised: '修正'
};
const people = {
  user: '你',
  ai: 'AI',
  aligned: '双方对齐'
};
const textWidth = value => [...(value || '')].reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : .55), 0);
const cardHeight = n => 30 + Math.min(3, Math.ceil(textWidth(n.title) / 16.5)) * 22 + 25 + (n.state !== 'aligned' && n.summary ? 8 + Math.min(2, Math.ceil(textWidth('当前倾向：' + n.summary) / 19)) * 18 : 0);
async function action(action, args = {}) {
  const r = await fetch('/api/action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action,
      args
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
function Ports() {
  return <><Handle type="target" position={Position.Top} /><Handle type="source" position={Position.Bottom} /></>;
}
function MainCard({
  id,
  data,
  selected
}) {
  const t = useText();
  return <div data-main={id} className={`main-card ${data.state} ${selected ? 'selected' : ''} ${data.mergeTarget ? 'merge-target' : ''}`}><Ports /><div className="card-title" onDoubleClick={e => {
      e.stopPropagation();
      data.edit?.(id);
    }}>{data.editing ? <input className="inline-editor nodrag" aria-label={t('编辑主图标题')} autoFocus value={data.draft} onChange={e => data.setDraft(e.target.value)} onKeyDown={e => {
        if (e.key === 'Enter') {
          e.stopPropagation();
          data.save();
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          data.cancel();
        }
      }} /> : data.title}</div><div className="meta">{data.userRevised && <span className="status revised">↺ </span>}<span className={`status ${data.state}`}>{symbols[data.state]}</span> {t(labels[data.state])} · 第 {data.turn} 轮{data.versions?.length > 0 && ` · 已刷新 ${data.versions.length}`}</div>{data.state !== 'aligned' && data.summary && <div className="tendency">{t('当前倾向')}：{data.summary}</div>}{data.fresh && <i className="fresh-dot" />}{data.remove && <details className="node-menu nodrag"><summary aria-label={t('节点操作')}>⋯</summary><button onClick={() => data.remove(id)}>{t('删除')}</button></details>}</div>;
}
function SideCard({
  id,
  data
}) {
  const t = useText();
  return <div data-side={id} onMouseEnter={data.seen} className={`side-card ${data.state} ${data.key ? "key" : ""} ${data.entry ? "entry" : ""} ${data.exit ? "exit" : ""}`}><Ports />{data.key && <span className="key-tag">{t('重点')}</span>}{data.deleted && <span className="deleted-tag">{t('已删除')}</span>}{data.exit && <span className="deleted-tag">{t('出口')}</span>}{data.state === 'revised' && <span className="revision-mark">↺</span>}<div className="side-text"><span className={`status ${data.state}`}>{!data.entry && data.state !== 'revised' && symbols[data.state]} </span>{data.text}</div><div className="meta">{data.entry ? '入口' : `${t(people[data.by] || 'AI')} · 第 ${data.turn} 轮`}{data.note && ` · ${data.note}`}{data.referenceMainId && <button className="reference-link nodrag" onClick={() => data.selectMain?.(data.referenceMainId)}>见 {data.referenceMainId}</button>}</div>{data.fresh && <i className="fresh-dot" />}{data.promote && !data.entry && !data.exit && <details className="node-menu nodrag"><summary aria-label={t('副图节点操作')}>⋯</summary><button onClick={() => data.promote(id)}>{t('升为主图节点')}</button></details>}</div>;
}
function OrthogonalEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data
}) {
  const points = data?.points;
  const d = points?.length ? points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') : `M ${sourceX} ${sourceY} V ${(sourceY + targetY) / 2} H ${targetX} V ${targetY}`;
  return <BaseEdge path={d} style={{
    stroke: 'var(--line)',
    strokeWidth: 1.5,
    strokeLinejoin: 'round'
  }} />;
}
const nodeTypes = {
    main: MainCard,
    side: SideCard
  },
  edgeTypes = {
    orthogonal: OrthogonalEdge
  };
function Zoom() {
  const t = useText();
  const flow = useReactFlow(),
    {
      zoom
    } = useViewport();
  return <div className="zoom-tools"><button aria-label={t('缩小')} onClick={() => flow.zoomOut({
      duration: 180
    })}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label={t('放大')} onClick={() => flow.zoomIn({
      duration: 180
    })}>+</button><button onClick={() => flow.fitView({
      padding: .18,
      duration: 180,
      maxZoom: 1
    })}>⤢ {t('适应')}</button></div>;
}
function CanvasInner({
  graph,
  selected,
  onSelect,
  focus,
  kind,
  onDrag,
  onDrop,
  onDragStart
}) {
  const [placed, setPlaced] = useState({
      nodes: [],
      edges: []
    }),
    flow = useReactFlow(),
    initialized = useNodesInitialized();
  const viewportSize = useStore(state => `${state.width}/${state.height}`);
  const latest = useRef(graph),
    home = useRef([]);
  latest.current = graph;
  const geometry = JSON.stringify([graph.nodes.map(n => [n.id, n.width, n.height]), graph.edges.map(e => [e.id, e.source, e.target])]);
  useEffect(() => {
    let active = true;
    layoutGraph(graph.nodes, graph.edges).then(layout => {
      if (active) {
        home.current = layout.nodes;
        setPlaced({ ...layout, geometry });
      }
    });
    return () => {
      active = false;
    };
  }, [geometry]);
  const nodes = placed.nodes.map(n => ({
    ...n,
    data: graph.nodes.find(x => x.id === n.id)?.data || n.data,
    selected: n.id === selected
  }));
  const candidate = node => placed.nodes.find(n => n.id !== node.id && graph.edges.some(e => e.source === node.id && e.target === n.id || e.target === node.id && e.source === n.id) && Math.abs(n.position.x + n.width / 2 - node.position.x - node.width / 2) < (n.width + node.width) / 2 && Math.abs(n.position.y + n.height / 2 - node.position.y - node.height / 2) < (n.height + node.height) / 2)?.id;
  const edges = placed.edges.map(e => ({
    ...e,
    type: 'orthogonal',
    data: {
      points: placed.nodes.some(n => n.dragging && (n.id === e.source || n.id === e.target)) ? null : e.points
    }
  }));
  useEffect(() => {
    if (!nodes.length || placed.geometry !== geometry || !initialized || !flow.viewportInitialized) return;
    const timer = setTimeout(() => {
      const [w, h] = viewportSize.split('/').map(Number);
      if (kind === 'main' && focus) {
        const n = nodes.find(n => n.id === focus), bottom = Math.max(...nodes.map(n => n.position.y + n.height)), top = Math.min(...nodes.map(n => n.position.y));
        // Whole main graph fits comfortably (below the floating header): show it all; otherwise centre the frontier.
        if ((h - 140) / (bottom - top) >= .85) flow.fitView({ padding: { top: '64px', bottom: '64px', left: '40px', right: '40px' }, maxZoom: 1, duration: 180 });
        else if (n) flow.setCenter(n.position.x + n.width / 2, n.position.y + n.height / 2, {
          zoom: 1,
          duration: 180
        });
      } else {
        const minX = Math.min(...nodes.map(n => n.position.x)), maxX = Math.max(...nodes.map(n => n.position.x + n.width)), minY = Math.min(...nodes.map(n => n.position.y)), maxY = Math.max(...nodes.map(n => n.position.y + n.height));
        if (Math.min((w - 48) / (maxX - minX), (h - 48) / (maxY - minY)) >= .78) flow.fitView({ padding: .12, maxZoom: 1, duration: 180 });
        else {
          // Too big to read when fitted: keep the top visible and centre the key point (or the exit) horizontally.
          const z = .78, anchor = nodes.find(n => n.data?.key) || nodes.find(n => n.data?.exit) || nodes[0], cx = anchor.position.x + anchor.width / 2;
          flow.setViewport({ x: Math.min(24 - minX * z, Math.max(w - 24 - maxX * z, w / 2 - cx * z)), y: 24 - minY * z, zoom: z }, { duration: 180 });
        }
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [geometry, placed.geometry, initialized, focus, flow.viewportInitialized, viewportSize]);
  useEffect(() => {
    const fit = () => flow.fitView({
      padding: .18,
      maxZoom: 1,
      duration: 180
    });
    window.addEventListener(`fit-${kind}`, fit);
    return () => window.removeEventListener(`fit-${kind}`, fit);
  }, [flow, kind]);
  return <div className={`canvas ${kind}-canvas`} data-canvas={kind}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={!!onDrop} nodesConnectable={false} elementsSelectable={kind === 'main'} onNodeClick={(_, n) => onSelect?.(n.id)} onNodeDragStart={onDragStart} onNodeDrag={(_, node) => onDrag?.(node.id, candidate(node))} onNodeDragStop={(_, node) => {
      onDrop?.(node.id, candidate(node));
      setPlaced(old => ({
        ...old,
        nodes: old.nodes.map(n => ({
          ...n,
          position: home.current.find(x => x.id === n.id)?.position || n.position
        }))
      }));
    }} onNodesChange={changes => setPlaced(old => ({
      ...old,
      nodes: applyNodeChanges(changes, old.nodes)
    }))} minZoom={.2} maxZoom={2} zoomOnScroll panOnScroll={false} deleteKeyCode={null} proOptions={{
      hideAttribution: true
    }}><Background id={kind} variant="dots" gap={20} size={1} color="var(--dot)" /><Zoom /></ReactFlow></div>;
}
function Canvas(props) {
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}
function App() {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [projectId, setProjectId] = useState(new URLSearchParams(location.search).get('projectId') || 'reasoncontour');
  const [selected, setSelected] = useState(null),
    [pinned, setPinned] = useState(false),
    [panel, setPanel] = useState(true),
    [tab, setTab] = useState('推导'),
    [menu, setMenu] = useState(null),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(false),
    [width, setWidth] = useState(50),
    [toast, setToast] = useState(null),
    [fresh, setFresh] = useState([]),
    [creating, setCreating] = useState(false),
    [newName, setNewName] = useState(''),
    [locale, setLocale] = useState('en');
  const [editing, setEditing] = useState(null),
    [draft, setDraft] = useState(''),
    [deleteChoice, setDeleteChoice] = useState(null),
    [mergePreview, setMergePreview] = useState(null),
    [mergeTarget, setMergeTarget] = useState(null);
  const dragRevision = useRef(null),
    previewRequest = useRef(0),
    dragCandidate = useRef(null),
    dragCancelled = useRef(false);
  const appearance = useAppearance(),
    previous = useRef(null),
    ref = useRef({});
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/state?projectId=${encodeURIComponent(projectId)}`),
        next = await r.json();
      if (!r.ok) throw new Error(next.error);
      const old = previous.current;
      if (old && old.project.id === next.project.id && old.project.revision !== next.project.revision && next.lastChange?.actor === 'ai') {
        setFresh([...(next.lastChange.nodes?.upserted || []).map(n => n.id), ...Object.values(next.lastChange.side || {}).flatMap(s => s.nodes.upserted.map(n => n.id))]);
      }
      previous.current = next;
      setData(next);
      applySavedAppearance(next.preferences);
      setLocale(next.preferences.language);
      document.documentElement.lang = next.preferences.language;
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [projectId]);
  useEffect(() => {
    previous.current = null;
    setData(null);
    setSelected(null);
    setPinned(false);
    setPanel(true);
    load();
    const events = new EventSource('/api/events');
    events.addEventListener('refresh', load);
    return () => events.close();
  }, [load]);
  const p = data?.project,
    frontiers = p?.main.nodes.filter(n => !p.main.edges.some(e => e.source === n.id)) || [],
    front = frontiers.at(-1)?.id;
  useEffect(() => {
    if (!p) return;
    if (!pinned || !p.main.nodes.some(n => n.id === selected)) setSelected(front || null);
  }, [p?.revision, p?.id, front, pinned]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!fresh.length) return;
    const id = setTimeout(() => setFresh([]), 10000);
    return () => clearTimeout(id);
  }, [fresh]);
  const notify = (message, undo = false) => setToast({
    message,
    undo
  });
  async function perform(name, args, message, undo = false) {
    try {
      const result = await action(name, args);
      await load();
      if (message) notify(message, undo);
      return result;
    } catch (e) {
      notify(e.message);
    }
  }
  async function history(direction = 'undo') {
    if (!p) return;
    await perform('history', {
      projectId: p.id,
      expectedRevision: p.revision,
      direction
    }, direction === 'undo' ? '已撤销' : '已重做');
  }
  ref.current = {
    p,
    history,
    setPanel,
    remove,
    selected
  };
  useEffect(() => {
    const key = e => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
      if (e.key === 'Escape') {
        dragCancelled.current = true;
        setDeleteChoice(null);
        setMergePreview(null);
        setMergeTarget(null);
        previewRequest.current++;
        setPanel(false);
        setMenu(null);
        setQuery(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        ref.current.history(e.shiftKey ? 'redo' : 'undo');
      }
      if (e.key === 'Delete' && ref.current.selected) {
        e.preventDefault();
        ref.current.remove(ref.current.selected);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuery(true);
        return;
      }
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        window.dispatchEvent(new Event('fit-main'));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  function select(id) {
    setSelected(id);
    setPinned(id !== front);
    setPanel(true);
    setTab('推导');
    setFresh(old => old.filter(value => value !== id));
  }
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      notify('已复制');
    } catch {
      notify('无法访问剪贴板');
    }
  }
  function resize(e) {
    const move = event => setWidth(Math.min(75, Math.max(25, (innerWidth - event.clientX) / innerWidth * 100)));
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  }
  async function write(operations, message) {
    return perform('mutate', {
      projectId: p.id,
      expectedRevision: p.revision,
      operations
    }, message, true);
  }
  function edit(id) {
    const node = p.main.nodes.find(n => n.id === id);
    setEditing(id);
    setDraft(node.title);
  }
  async function save() {
    if (!draft.trim()) return;
    await write([{
      op: 'refreshMain',
      id: editing,
      title: draft.trim(),
      reason: '用户手动修改',
      by: 'user'
    }], '已修改');
    setEditing(null);
  }
  function remove(id) {
    const next = p.main.edges.filter(e => e.source === id).map(e => e.target);
    if (next.length > 1) {
      setDeleteChoice({
        id,
        receiver: next[0],
        options: next
      });
      return;
    }
    write([{
      op: 'deleteMain',
      id
    }], '已删除，内容并入下一个节点');
  }
  async function promote(id) {
    const result = await write([{
      op: 'promoteSide',
      mainId: n.id,
      id
    }], '已升为主图节点');
    if (result?.ids?.promotedId) {
      setSelected(result.ids.promotedId);
      setPinned(true);
      setPanel(true);
      setTab('推导');
    }
  }
  async function drag(id, target) {
    if (dragCandidate.current === target) return;
    dragCandidate.current = target;
    const generation = ++previewRequest.current;
    setMergeTarget(target || null);
    if (!target) {
      setMergePreview(null);
      return;
    }
    try {
      const preview = await action('preview', {
        projectId: p.id,
        expectedRevision: dragRevision.current,
        operations: [{
          op: 'mergeMain',
          id,
          targetId: target
        }]
      });
      if (generation === previewRequest.current) {
        const edge = p.main.edges.find(e => e.source === id && e.target === target || e.target === id && e.source === target);
        setMergePreview({
          project: preview,
          mainId: edge.target
        });
        setPanel(true);
        setTab('推导');
      }
    } catch (e) {
      if (generation === previewRequest.current) notify(e.message);
    }
  }
  async function drop(id, target) {
    if (dragCancelled.current) {
      setMergeTarget(null);
      setMergePreview(null);
      return;
    }
    previewRequest.current++;
    setMergeTarget(null);
    setMergePreview(null);
    dragCandidate.current = null;
    if (!target) return;
    const edge = p.main.edges.find(e => e.source === id && e.target === target || e.target === id && e.source === target);
    const result = await perform('mutate', {
      projectId: p.id,
      expectedRevision: dragRevision.current,
      operations: [{
        op: 'mergeMain',
        id,
        targetId: target
      }]
    }, '已合并', true);
    if (result) {
      setSelected(edge.target);
      setPinned(true);
      setPanel(true);
    }
  }
  const n = p?.main.nodes.find(n => n.id === selected),
    mainGraph = useMemo(() => p ? {
      nodes: p.main.nodes.map(n => ({
        id: n.id,
        type: 'main',
        width: 280,
        height: cardHeight(n),
        data: {
          ...n,
          fresh: fresh.includes(n.id),
          userRevised: n.versions?.at(-1)?.reason === '用户手动修改',
          editing: editing === n.id,
          draft,
          setDraft,
          edit,
          save,
          cancel: () => setEditing(null),
          remove,
          mergeTarget: mergeTarget === n.id
        }
      })),
      edges: p.main.edges
    } : null, [p, fresh, editing, draft, mergeTarget]);
  const shownProject = mergePreview?.project || p,
    shownNode = mergePreview ? shownProject.main.nodes.find(n => n.id === mergePreview.mainId) : n;
  const derivation = useMemo(() => {
    if (!shownNode) return null;
    const graph = sideGraph(shownProject.side[shownNode.id], shownNode);
    for (const item of graph.nodes) item.data = {
      ...item.data,
      fresh: fresh.includes(item.id),
      seen: () => setFresh(old => old.filter(id => id !== item.id)),
      promote: mergePreview ? null : promote,
      selectMain: select
    };
    return graph;
  }, [shownProject, shownNode, mergePreview, fresh]);
  const en = locale === 'en',
    tr = (zh, english) => en ? english : zh;
  if (error && !data) return <main className="startup-error"><h1>ReasonContour</h1><p role="alert">{error}</p><button onClick={load}>重试</button></main>;
  if (!data) return <main className="loading">ReasonContour…</main>;
  const stateName = s => tr({ aligned: '已对齐', frontier: '进行中', tentative: '暂定' }[s] || s, { aligned: 'Aligned', frontier: 'In progress', tentative: 'Tentative' }[s] || s);
  const connected = data.sessions.some(s => s.state === 'active');
  const indexOf = id => p.main.nodes.findIndex(x => x.id === id) + 1;
  const copyPrompt = () => copy(en ? data.connection.prompt : data.connection.promptZh);
  const trashProject = async () => {
    const result = await perform('deleteProject', { projectId: p.id, expectedRevision: p.revision });
    if (result) {
      setProjectId(result.nextProjectId);
      setToast({ message: '项目已移入回收站', restore: p.id });
    }
    setMenu(null);
  };
  const exportMarkdown = async () => {
    const result = await perform('material', { projectId: p.id, language: locale, includeSources: true });
    if (result) {
      const url = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' })), a = document.createElement('a');
      a.href = url;
      a.download = `${p.name}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setMenu(null);
  };
  const review = accept => perform('reviewRevision', { projectId: p.id, nodeId: n.id, proposalId: p.proposals[n.id].id, expectedRevision: p.revision, accept }, accept ? '已接受修订' : '已拒绝修订', true);
  const sideCount = n ? (p.side[n.id]?.nodes.length || 0) : 0;
  const hits = p.main.nodes.filter(x => !search || [x.title, x.summary, x.body].some(s => (s || '').toLowerCase().includes(search.toLowerCase())));
  return <LocaleContext.Provider value={locale}><div className="app">
 <header className="topbar">
  <div className="brand"><img className="logo" src="/logo.svg" alt="" aria-hidden="true" /><b>ReasonContour</b></div>
  <span className="crumb-sep">/</span>
  <button className={`project-switch ${menu === 'project' ? 'open' : ''}`} onClick={() => setMenu(menu === 'project' ? null : 'project')}><span className="avatar">{[...p.name][0]}</span><span className="name">{p.name}</span><em>⌄</em></button>
  <button className="search-box" onClick={() => setQuery(true)}><span>⌕</span>{tr('搜索结论', 'Search conclusions')}<kbd>Ctrl K</kbd></button>
  <div className="top-actions">
   <button className="icon-btn" title={tr('撤销 Ctrl+Z', 'Undo Ctrl+Z')} disabled={!p.canUndo} onClick={() => history()}>↶</button>
   <button className="icon-btn" title={tr('重做 Ctrl+Shift+Z', 'Redo Ctrl+Shift+Z')} disabled={!p.canRedo} onClick={() => history('redo')}>↷</button>
   <span className="bar-sep" />
   <button className={`ai-status ${connected ? 'on' : ''} ${menu === 'ai' ? 'open' : ''}`} onClick={() => setMenu(menu === 'ai' ? null : 'ai')}><i key={p.revision} className={`${connected ? 'connected' : ''} ${fresh.length ? 'writing' : ''}`} />{connected ? tr('AI 已连接', 'AI connected') : tr('AI 未连接', 'AI offline')}</button>
   <button className={`icon-btn ${menu === 'more' ? 'open' : ''}`} aria-label={tr('更多操作', 'More actions')} onClick={() => setMenu(menu === 'more' ? null : 'more')}>⋯</button>
  </div>
 </header>
 {menu && <div className="menu-scrim" onClick={() => setMenu(null)} />}
 {menu === 'project' && <div className="menu project-menu">
  <div className="menu-label">{tr('项目', 'Projects')}</div>
  {data.projects.map(item => <button key={item.id} className={`menu-item ${item.id === p.id ? 'current' : ''}`} onClick={() => { setProjectId(item.id); setMenu(null); }}><span className="avatar">{[...item.name][0]}</span><span className="grow">{item.name}</span>{item.id === p.id && <span className="check">✓</span>}</button>)}
  <button className="menu-item" onClick={() => { setCreating(true); setMenu(null); }}><span className="avatar ghost">＋</span><span className="grow">{tr('新建项目', 'New project')}</span></button>
  <hr />
  <div className="menu-label">{tr('回收站', 'Recycle bin')}<span className="count">{data.deletedProjects.length}</span></div>
  {data.deletedProjects.length === 0 ? <div className="menu-empty">{tr('空', 'Empty')}</div> : data.deletedProjects.map(item => <button key={item.id} className="menu-item" onClick={() => perform('restoreProject', { projectId: item.id }, '已恢复')}><span className="grow muted">{item.name}</span><span className="hint">{tr('恢复', 'Restore')}</span></button>)}
  <hr />
  <button className="menu-item danger" onClick={trashProject}><span className="grow">{tr('将此项目移入回收站', 'Move project to recycle bin')}</span></button>
 </div>}
 {creating && <><div className="modal-scrim" onClick={() => setCreating(false)} /><form className="dialog" onSubmit={async e => {
   e.preventDefault();
   const result = await perform('create', { name: newName });
   if (result) { setProjectId(result.id); setCreating(false); setNewName(''); }
 }}><h3>{tr('新建项目', 'New project')}</h3><input autoFocus placeholder={tr('项目名称', 'Project name')} value={newName} onChange={e => setNewName(e.target.value)} required /><div className="dialog-actions"><button type="button" onClick={() => setCreating(false)}>{tr('取消', 'Cancel')}</button><button className="primary">{tr('创建', 'Create')}</button></div></form></>}
 {menu === 'ai' && <div className="menu right-menu ai-menu">
  <div className="ai-head"><i className={connected ? 'connected' : ''} /><div><b>{connected ? tr('AI 正在记录这场讨论', 'AI is recording this discussion') : tr('还没有 AI 接入', 'No AI connected yet')}</b><p>{tr('把接入说明粘贴进 AI 对话即可开始。', 'Paste the instructions into your AI chat to start.')}</p></div></div>
  <button className="menu-item" onClick={copyPrompt}><span className="grow">{tr('复制接入说明', 'Copy connection instructions')}</span><span className="hint">⧉</span></button>
  <button className="menu-item" onClick={() => copy(data.connection.mcpConfig)}><span className="grow">{tr('复制 MCP 配置', 'Copy MCP configuration')}</span><span className="hint">⧉</span></button>
  {data.sessions.length > 0 && <><hr /><div className="menu-label">{tr('会话', 'Sessions')}</div>{data.sessions.map(s => <div className="session" key={s.id}><i className={s.state === 'active' ? 'connected' : ''} /><span className="grow">{s.label} · {s.mode}</span><button onClick={() => perform('session', { sessionId: s.id, action: s.state === 'active' ? 'pause' : 'resume' })}>{s.state === 'active' ? tr('暂停', 'Pause') : tr('恢复', 'Resume')}</button></div>)}</>}
 </div>}
 {menu === 'more' && <div className="menu right-menu">
  <div className="menu-label">{tr('外观', 'Appearance')}</div>
  <div className="segmented">{[['light', '浅色', 'Light'], ['dark', '深色', 'Dark'], ['system', '跟随系统', 'System']].map(([v, zh, e]) => <button key={v} aria-pressed={appearance.mode === v} onClick={() => setAppearance({ mode: v }).catch(e => notify(e.message))}>{tr(zh, e)}</button>)}</div>
  <div className="menu-label">{tr('语言', 'Language')}</div>
  <div className="segmented">{[['zh-CN', '简体中文'], ['en', 'English']].map(([v, label]) => <button key={v} aria-pressed={locale === v} onClick={() => perform('preferences', { language: v })}>{label}</button>)}</div>
  <hr />
  <button className="menu-item" onClick={exportMarkdown}><span className="grow">{tr('导出 Markdown', 'Export Markdown')}</span><span className="hint">↓</span></button>
 </div>}
 {query && <><div className="modal-scrim" onClick={() => setQuery(false)} /><div className="palette" role="dialog">
  <div className="palette-input"><span>⌕</span><input autoFocus placeholder={tr('搜索主图结论、倾向和正文', 'Search conclusions, leanings and notes')} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && hits[0]) { select(hits[0].id); setQuery(false); } }} /><kbd>Esc</kbd></div>
  <div className="palette-list">{hits.length === 0 ? <div className="menu-empty">{tr('没有匹配的结论', 'No matching conclusions')}</div> : hits.map(x => <button key={x.id} className="palette-item" onClick={() => { select(x.id); setQuery(false); }}><span className="index">{indexOf(x.id)}</span><span className="grow">{x.title}</span><span className={`state-pill ${x.state}`}>{stateName(x.state)}</span></button>)}</div>
 </div></>}
 <div className="workspace">
  <section className="stage">
   {p.main.nodes.length > 0 && <div className="stage-head"><b>{tr('主图', 'Main graph')}</b><span>{p.main.nodes.length} {tr('个结论', 'conclusions')}</span><span className="dot-sep">·</span><span>{p.main.nodes.filter(x => x.state === 'aligned').length} {tr('已对齐', 'aligned')}</span></div>}
   {p.main.nodes.length ? <Canvas graph={mainGraph} selected={selected} onSelect={select} focus={front} kind="main" onDragStart={() => {
     dragRevision.current = p.revision;
     dragCandidate.current = null;
     dragCancelled.current = false;
   }} onDrag={drag} onDrop={drop} /> : <div className="empty-canvas"><div className="empty-mark"><img className="logo big" src="/logo.svg" alt="" aria-hidden="true" /></div><h2>{tr('这里会长出讨论的主线', 'Your discussion will grow here')}</h2><p>{tr('在 AI 对话里启用 ReasonContour，每次收敛都会成为主图上的一个结论。', 'Enable ReasonContour in your AI chat; every convergence becomes a conclusion here.')}</p><button className="primary" onClick={copyPrompt}>{tr('复制接入说明', 'Copy connection instructions')}</button></div>}
   {p.main.nodes.length > 0 && <div className="legend"><span><i className="lg aligned" />{tr('对齐', 'Aligned')}</span><span><i className="lg open" />{tr('进行中', 'Open')}</span><span><i className="lg rejected" />{tr('被否', 'Rejected')}</span><span><i className="lg revised" />{tr('修正', 'Revised')}</span><span><i className="lg key" />{tr('重点', 'Key')}</span></div>}
   {!(panel && n) && n && <button className="reopen" onClick={() => setPanel(true)}>{tr('打开副图', 'Open derivation')} ›</button>}
  </section>
  {panel && n && <><div className="sheet-scrim" onClick={() => setPanel(false)} /><aside className="sheet" style={{ width: `${width}%` }}>
   <div className="sheet-resize" role="separator" aria-label={tr('调整副屏宽度', 'Resize side panel')} onPointerDown={resize} />
   <div className="sheet-head">
    <div className="sheet-eyebrow"><span className="index">{indexOf(shownNode?.id)}</span><span>{tr('副图', 'Derivation')}</span>{shownNode && <span className={`state-pill ${shownNode.state}`}>{stateName(shownNode.state)}</span>}{!pinned && <span className="follow">{tr('跟随前沿', 'Following frontier')}</span>}<span className="grow" />{pinned && <button className="icon-btn" title={tr('解除钉住，回到前沿', 'Unpin and follow frontier')} onClick={() => { setPinned(false); setSelected(front); }}>📌</button>}<button className="icon-btn" aria-label={tr('关闭副屏', 'Close side panel')} onClick={() => setPanel(false)}>✕</button></div>
    <h2>{shownNode?.title}</h2>
    <nav className="tabs">{[['推导', 'Derivation', sideCount], ['正文', 'Notes', null], ['历史', 'History', n.versions.length]].map(([value, e, count]) => <button role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{en ? e : value}{count ? <span className="count">{count}</span> : null}</button>)}</nav>
   </div>
   {mergePreview && <div className="merge-preview">{tr('合并预览 · 松手保存', 'Merge preview · release to save')}</div>}
   <div className="sheet-body">{tab === '推导' ? <Canvas graph={derivation} kind="side" /> : tab === '正文' ? <div className="reader">
    {n.summary && n.body && <p className="lead">{n.summary}</p>}
    <article dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(n.body || n.summary || tr('暂无正文。AI 只在你要求时写长篇正文。', 'No notes yet.'))) }} />
    {n.sources.length > 0 && <section><h3>{tr('来源', 'Sources')}</h3>{n.sources.map(s => <div className="source" key={s.id}><strong>{s.label}</strong><span>{s.reference}</span>{s.quote && <blockquote>{s.quote}</blockquote>}</div>)}</section>}
    {p.proposals[n.id] && <section className="proposal"><h3>{tr('待审修订', 'Pending revision')}</h3><p><b>{p.proposals[n.id].patch.title}</b></p><p>{p.proposals[n.id].patch.summary}</p><article dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(p.proposals[n.id].patch.body || '')) }} /><div className="dialog-actions"><button onClick={() => review(false)}>{tr('拒绝', 'Reject')}</button><button className="primary" onClick={() => review(true)}>{tr('接受修订', 'Accept revision')}</button></div></section>}
   </div> : <div className="history-list">
    <div className="tl-item current"><i /><div><span className="tl-meta">{tr('当前版本', 'Current')}</span><h3>{n.title}</h3>{n.summary && <p>{n.summary}</p>}</div></div>
    {n.versions.length === 0 ? <p className="muted">{tr('还没有刷新过。', 'Never refreshed.')}</p> : [...n.versions].reverse().map((v, i) => <div className="tl-item" key={i}><i /><div><span className="tl-meta">{people[v.by]} · {new Date(v.at).toLocaleString()}{v.reason && ` · ${v.reason}`}</span><h3>{v.title}</h3>{v.summary && <p>{v.summary}</p>}</div></div>)}
   </div>}</div>
  </aside></>}
</div>{deleteChoice && <><div className="modal-scrim" onClick={() => setDeleteChoice(null)} /><form className="dialog" onSubmit={async e => {
        e.preventDefault();
        await write([{
          op: "deleteMain",
          id: deleteChoice.id,
          replacementId: deleteChoice.receiver
        }], "已删除，内容并入下一个节点");
        setDeleteChoice(null);
      }}><label>由哪个后继接收副图？<select aria-label="接收节点" value={deleteChoice.receiver} onChange={e => setDeleteChoice({
            ...deleteChoice,
            receiver: e.target.value
          })}>{deleteChoice.options.map(id => <option key={id} value={id}>{p.main.nodes.find(n => n.id === id).title}</option>)}</select></label><div className="dialog-actions"><button type="button" onClick={() => setDeleteChoice(null)}>{tr('取消', 'Cancel')}</button><button className="primary" type="submit">删除并并入</button></div></form></>}{toast && <div className="toast" role="status">{toast.message}{toast.undo && <button onClick={() => history()}>{tr('撤销', 'Undo')}</button>}{toast.restore && <button onClick={async () => {
          await perform('restoreProject', {
            projectId: toast.restore
          }, '已恢复');
          setProjectId(toast.restore);
        }}>{tr('撤销', 'Undo')}</button>}</div>}
 </div></LocaleContext.Provider>;
}
createRoot(document.getElementById('root')).render(<App />);

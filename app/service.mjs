import { recordingGuide, recordingGuideVersion, writeExample, briefSide } from './agent-context.mjs';
import { readPreferences, writePreferences } from './preferences.mjs';
import { connectionInfo } from './connection.mjs';
import { Store, AppError, uid, now, text, identifier, project, emptyProject, publicProject, snapshot, commit, assertRevision, mutate, needsRevision, validateProject, frontierNodes, sideNodes, markdown } from './model.mjs';
function getSession(data, id) {
  identifier(id, '会话标识');
  const s = Object.hasOwn(data.sessions, id) && data.sessions[id];
  if (!s) throw new AppError('会话不存在。', 404, 'session_missing');
  return s;
}
export class Service {
  constructor({
    store = new Store(),
    boundProjectId,
    boundSessionId
  } = {}) {
    this.store = store;
    this.boundProjectId = boundProjectId;
    this.boundSessionId = boundSessionId;
  }
  async init() {
    const data = await this.store.read();
    if (!Object.keys(data.projects).length) await this.store.update(data => {
      if (!Object.keys(data.projects).length) data.projects.reasoncontour = emptyProject('My project', 'reasoncontour');
    });
    return this;
  }
  async list() {
    const data = await this.store.read();
    return {
      projects: Object.values(data.projects).filter(p => !p.deletedAt).map(p => ({
        id: p.id,
        name: p.name,
        revision: p.revision,
        nodeCount: p.main.nodes.length,
        updatedAt: p.updatedAt
      }))
    };
  }
  async create(name) {
    return this.store.update(data => {
      const p = emptyProject(name);
      data.projects[p.id] = p;
      return publicProject(p);
    });
  }
  async deleteProject({
    projectId,
    expectedRevision
  }) {
    return this.store.update(data => {
      const p = project(data, projectId);
      assertRevision(p, expectedRevision);
      p.deletedAt = now();
      for (const s of Object.values(data.sessions)) if (s.projectId === p.id) s.state = 'closed';
      let next = Object.values(data.projects).find(p => !p.deletedAt);
      if (!next) {
        next = emptyProject('My project');
        data.projects[next.id] = next;
      }
      return {
        deletedProjectId: p.id,
        nextProjectId: next.id
      };
    });
  }
  async restoreProject({
    projectId
  }) {
    return this.store.update(data => {
      identifier(projectId);
      const p = data.projects[projectId];
      if (!p?.deletedAt) throw new AppError('回收站中没有此项目。');
      delete p.deletedAt;
      return {
        projectId
      };
    });
  }
  async state(id = 'reasoncontour') {
    const data = await this.store.read(),
      p = project(data, id);
    return {
      sequence: data.sequence,
      project: publicProject(p),
      connection: connectionInfo(p, this.store.directory),
      preferences: await readPreferences(this.store),
      projects: Object.values(data.projects).filter(p => !p.deletedAt).map(p => ({
        id: p.id,
        name: p.name
      })),
      deletedProjects: Object.values(data.projects).filter(p => p.deletedAt).map(p => ({
        id: p.id,
        name: p.name,
        nodeCount: p.main.nodes.length
      })),
      sessions: Object.values(data.sessions).filter(s => s.projectId === id),
      lastChange: p.events.at(-1) || null
    };
  }
  context(p) {
    return {
      revision: p.revision,
      main: p.main.nodes.map(({
        id,
        title,
        state
      }) => ({
        id,
        title,
        state
      })),
      side: Object.fromEntries(frontierNodes(p).map(n => [n.id, briefSide(p.side[n.id])]))
    };
  }
  async session({
    action = 'start',
    projectId = this.boundProjectId,
    sessionId = this.boundSessionId,
    label = 'AI 对话',
    mode = 'auto'
  } = {}) {
    if (!['auto', 'manual'].includes(mode)) throw new AppError('模式无效。');
    return this.store.update(data => {
      if (action === 'start') {
        const p = project(data, projectId),
          s = {
            id: uid('session'),
            projectId: p.id,
            label: text(label, '会话名称', 160),
            mode,
            state: 'active',
            createdAt: now(),
            lastWriteAt: null,
            guideVersion: recordingGuideVersion
          };
        data.sessions[s.id] = s;
        return {
          session: {
            id: s.id,
            mode: s.mode
          },
          guideVersion: recordingGuideVersion,
          guide: recordingGuide,
          example: writeExample,
          ...this.context(p)
        };
      }
      const s = getSession(data, sessionId);
      if (!['pause', 'resume', 'close'].includes(action)) throw new AppError('会话操作无效。');
      if (action === 'resume') project(data, s.projectId);
      s.state = {
        pause: 'paused',
        resume: 'active',
        close: 'closed'
      }[action];
      return {
        session: s
      };
    });
  }
  async read({
    projectId = this.boundProjectId,
    sessionId = this.boundSessionId,
    scope = 'overview',
    nodeIds = [],
    mainId,
    sourceId,
    sinceRevision,
    query = ''
  } = {}) {
    const data = await this.store.read();
    if (sessionId) {
      const s = getSession(data, sessionId);
      if (projectId && projectId !== s.projectId) throw new AppError('会话项目不匹配。', 409, 'project_mismatch');
      projectId = s.projectId;
    }
    const p = project(data, projectId),
      envelope = {
        revision: p.revision
      };
    if (sessionId && data.sessions[sessionId].guideVersion !== recordingGuideVersion) {
      envelope.guideUpdate = recordingGuide;
      envelope.guideVersion = recordingGuideVersion;
      await this.store.update(data => {
        data.sessions[sessionId].guideVersion = recordingGuideVersion;
      });
    }
    if (scope === 'overview') return {
      ...this.context(p),
      ...envelope
    };
    if (scope === 'side') {
      if (!p.side[mainId]) throw new AppError('副图不存在。');
      return {
        ...envelope,
        side: briefSide(p.side[mainId])
      };
    }
    if (scope === 'changes') {
      if (!Number.isInteger(sinceRevision) || sinceRevision < 0 || sinceRevision > p.revision) throw new AppError('增量版本无效。');
      const floor = p.events[0]?.revision ?? p.revision + 1;
      return {
        ...envelope,
        resetRequired: sinceRevision < floor - 1,
        ...(sinceRevision < floor - 1 ? {} : {
          events: p.events.filter(e => e.revision > sinceRevision).map(e => ({
            revision: e.revision,
            actor: e.actor,
            nodes: {
              removed: e.nodes.removed,
              upserted: e.nodes.upserted.map(({
                id,
                title,
                state
              }) => ({
                id,
                title,
                state
              }))
            },
            edges: e.edges,
            side: Object.fromEntries(Object.entries(e.side).map(([id, s]) => [id, {
              ...s,
              nodes: {
                removed: s.nodes.removed,
                upserted: s.nodes.upserted.map(({
                  id,
                  parentId,
                  text,
                  state,
                  by,
                  turn,
                  note
                }) => ({
                  id,
                  parentId,
                  text,
                  state,
                  by,
                  turn,
                  note
                }))
              }
            }])),
            removedSideIds: e.removedSideIds,
            proposalIds: e.proposalIds || []
          }))
        })
      };
    }
    if (scope === 'edges') return {
      ...envelope,
      edges: p.main.edges
    };
    if (scope === 'search') {
      const needle = text(query, '搜索词', 500).trim().toLowerCase();
      if (!needle) throw new AppError('搜索词不能为空。');
      return {
        ...envelope,
        matches: p.main.nodes.filter(n => [n.title, n.summary, n.body, ...sideNodes(p.side[n.id]).map(s => s.text)].some(v => v.toLowerCase().includes(needle))).map(({
          id,
          title,
          state
        }) => ({
          id,
          title,
          state
        }))
      };
    }
    const nodes = nodeIds.map(id => {
      const n = p.main.nodes.find(n => n.id === id) || Object.values(p.side).flatMap(sideNodes).find(n => n.id === id);
      if (!n) throw new AppError('节点不存在。');
      return n;
    });
    if (scope === 'body') return {
      ...envelope,
      nodes
    };
    if (scope === 'nodes') return {
      ...envelope,
      nodes: nodes.map(({
        id,
        title,
        text,
        state,
        by,
        turn
      }) => ({
        id,
        title,
        text,
        state,
        by,
        turn
      }))
    };
    const n = nodes[0];
    if (!n) throw new AppError('请指定节点。');
    if (scope === 'proposal') return {
      ...envelope,
      proposal: p.proposals[n.id] || null
    };
    if (scope === 'sources') return {
      ...envelope,
      sources: n.sources.map(({
        quote,
        ...s
      }) => ({
        ...s,
        quoteCharacters: quote.length
      }))
    };
    if (scope === 'source') {
      const source = n.sources.find(s => s.id === sourceId);
      if (!source) throw new AppError('来源不存在。');
      return {
        ...envelope,
        source
      };
    }
    throw new AppError('读取范围无效。');
  }
  async transact({
    projectId = this.boundProjectId,
    sessionId = this.boundSessionId,
    expectedRevision,
    operations,
    message = '整理项目思路'
  }, actor = 'user') {
    return this.store.update(data => {
      let session;
      if (actor === 'ai') {
        session = getSession(data, sessionId);
        if (session.state !== 'active') throw new AppError('会话未启用。', 403, 'inactive_session');
        if (projectId && projectId !== session.projectId) throw new AppError('会话项目不匹配。', 409, 'project_mismatch');
        projectId = session.projectId;
      }
      const p = project(data, projectId);
      if (!Array.isArray(operations)) throw new AppError('操作必须是列表。');
      if (actor === 'user' || needsRevision(p, operations)) assertRevision(p, expectedRevision);
      const before = snapshot(p),
        ids = mutate(p, operations, {
          actor
        });
      commit(p, before, {
        actor,
        sessionId: session?.id,
        message: text(message, '修改说明', 500)
      });
      if (session) session.lastWriteAt = now();
      return {
        revision: p.revision,
        applied: operations.length,
        ...(Object.keys(ids).length ? {
          ids
        } : {}),
        frontier: frontierNodes(p).map(({
          id,
          state
        }) => ({
          id,
          state
        }))
      };
    });
  }
  async history({
    projectId,
    expectedRevision,
    direction = 'undo'
  }) {
    if (!['undo', 'redo'].includes(direction)) throw new AppError('历史操作无效。');
    return this.store.update(data => {
      const p = project(data, projectId);
      assertRevision(p, expectedRevision);
      const value = p[direction].pop();
      if (!value) throw new AppError('没有可恢复的修改。');
      const before = snapshot(p);
      p[direction === 'undo' ? 'redo' : 'undo'].push(before);
      Object.assign(p, value);
      validateProject(p);
      commit(p, before, {
        history: false,
        message: direction
      });
      return {
        revision: p.revision
      };
    });
  }
  async reviewRevision({
    projectId,
    nodeId,
    proposalId,
    expectedRevision,
    accept = false
  }) {
    return this.store.update(data => {
      const p = project(data, projectId);
      assertRevision(p, expectedRevision);
      const proposal = p.proposals[nodeId],
        n = p.main.nodes.find(n => n.id === nodeId);
      if (!proposal || proposal.id !== proposalId) throw new AppError('修订已变化。', 409, 'proposal_changed');
      if (accept && JSON.stringify(n) !== proposal.base) throw new AppError('原文已变化。', 409, 'proposal_stale');
      const before = snapshot(p);
      if (accept) mutate(p, [{
        op: 'refreshMain',
        id: nodeId,
        ...proposal.patch
      }]);
      delete p.proposals[nodeId];
      commit(p, before, {
        message: accept ? '接受修订' : '拒绝修订'
      });
      return {
        revision: p.revision
      };
    });
  }
  async view({
    projectId,
    focus,
    positions,
    expectedRevision
  }) {
    return this.store.update(data => {
      const p = project(data, projectId);
      if (expectedRevision !== undefined) assertRevision(p, expectedRevision);
      if (focus !== undefined) {
        if (focus !== null && !p.main.nodes.some(n => n.id === focus)) throw new AppError('焦点不存在。');
        p.view.focus = focus;
      }
      if (positions) {
        for (const [id, pos] of Object.entries(positions)) {
          if (!p.main.nodes.some(n => n.id === id) || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) throw new AppError('位置无效。');
          p.view.positions[id] = {
            x: pos.x,
            y: pos.y
          };
        }
      }
      return p.view;
    });
  }
  async preview({
    projectId,
    expectedRevision,
    operations
  }) {
    const data = await this.store.read(),
      p = project(data, projectId);
    assertRevision(p, expectedRevision);
    mutate(p, operations, {
      actor: 'user'
    });
    return publicProject(p);
  }
  async material({
    projectId = this.boundProjectId,
    includeSources = false,
    language = 'en'
  } = {}) {
    const data = await this.store.read(),
      p = project(data, projectId);
    return {
      revision: p.revision,
      markdown: markdown(p, language, includeSources)
    };
  }
  async action(name, args = {}) {
    switch (name) {
      case 'state':
        return this.state(args.projectId);
      case 'projects':
        return this.list();
      case 'create':
        return this.create(args.name);
      case 'mutate':
        return this.transact(args);
      case 'preferences':
        return writePreferences(this.store, args);
      default:
        if (['preview', 'deleteProject', 'restoreProject', 'history', 'reviewRevision', 'view', 'material', 'session', 'read'].includes(name)) return this[name](args);
        throw new AppError('不支持的操作。');
    }
  }
}

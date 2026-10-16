import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Service } from '../service.mjs';
import { Store, PROJECT_ROOT, emptyProject, mutate, sideNodes, sideTrees, validateProject } from '../model.mjs';
import { startServer } from '../server.mjs';
async function setup(t) {
  const base = path.join(PROJECT_ROOT, '.test-data');
  await fs.mkdir(base, {
    recursive: true
  });
  const dir = await fs.mkdtemp(path.join(base, 'main-side-'));
  t.after(() => fs.rm(dir, {
    recursive: true,
    force: true
  }));
  const s = await new Service({
    store: new Store(dir)
  }).init();
  const {
    session
  } = await s.session({
    projectId: 'reasoncontour'
  });
  return {
    s,
    sessionId: session.id
  };
}
const read = async s => (await s.state()).project;
async function ai(ctx, ops, extra = {}) {
  return ctx.s.transact({
    sessionId: ctx.sessionId,
    operations: ops,
    ...extra
  }, 'ai');
}
async function user(s, ops) {
  const p = await read(s);
  return s.transact({
    projectId: p.id,
    expectedRevision: p.revision,
    operations: ops
  });
}
async function seed(ctx) {
  return ai(ctx, [{
    op: 'upsertMain',
    id: '@a',
    title: '进行中：原因',
    turn: 1
  }, {
    op: 'upsertSide',
    id: '@q',
    mainId: '@a',
    text: '原因是什么？',
    turn: 1
  }, {
    op: 'upsertSide',
    id: '@x',
    mainId: '@a',
    parentId: '@q',
    text: '硬件问题',
    turn: 2
  }, {
    op: 'upsertSide',
    id: '@y',
    mainId: '@a',
    parentId: '@q',
    text: '运维问题',
    turn: 2
  }, {
    op: 'setKey',
    mainId: '@a',
    keyId: '@y'
  }]);
}
test('short aliases, source attribution, isolated side trees and automatic multi-entry DAG', () => {
  const p = emptyProject('Test');
  mutate(p, [{
    op: 'upsertMain',
    id: '@a',
    title: 'A'
  }, {
    op: 'upsertMain',
    id: '@b',
    title: 'B'
  }, {
    op: 'upsertMain',
    id: '@c',
    title: 'C'
  }, {
    op: 'linkMain',
    source: '@a',
    target: '@c'
  }, {
    op: 'linkMain',
    source: '@b',
    target: '@c'
  }], {
    actor: 'ai'
  });
  assert.deepEqual(p.side.m3.entries.map(e => e.mainId), ['m1', 'm2']);
  assert.equal(p.main.nodes[0].by, 'ai');
  assert.equal(p.authority, undefined);
  assert.equal(p.selection, undefined);
  assert.equal(p.authorityVersion, undefined);
});
test('main cycles, side cycles, cross-tree parents and invalid keys roll back the complete batch', () => {
  const p = emptyProject('Test');
  mutate(p, [{
    op: 'upsertMain',
    id: '@a',
    title: 'A'
  }, {
    op: 'upsertMain',
    id: '@b',
    title: 'B'
  }, {
    op: 'linkMain',
    source: '@a',
    target: '@b'
  }, {
    op: 'upsertSide',
    mainId: '@a',
    text: 'Root'
  }], {
    actor: 'ai'
  });
  const before = structuredClone(p);
  for (const ops of [[{
    op: 'linkMain',
    source: 'm2',
    target: 'm1'
  }], [{
    op: 'upsertSide',
    mainId: 'm2',
    parentId: 's1',
    text: 'Cross tree'
  }], [{
    op: 'setKey',
    mainId: 'm1',
    keyId: 'missing'
  }], [{
    op: 'upsertSide',
    id: 's1',
    mainId: 'm1',
    parentId: 's1',
    text: 'Cycle'
  }]]) {
    assert.throws(() => mutate(p, ops));
    assert.deepEqual(p, before);
  }
  const corrupt = structuredClone(p);
  corrupt.side.m1.keyId = ['s1'];
  assert.throws(() => validateProject(corrupt));
});
test('aligned main AND side nodes require user quote; rejected choices require reasons', async t => {
  const ctx = await setup(t);
  await seed(ctx);
  for (const op of [{
    op: 'convergeMain',
    id: 'm1'
  }, {
    op: 'setSideState',
    mainId: 'm1',
    id: 's3',
    state: 'aligned'
  }, {
    op: 'setSideState',
    mainId: 'm1',
    id: 's2',
    state: 'rejected'
  }]) await assert.rejects(() => ai(ctx, [op], {
    expectedRevision: 1
  }));
  assert.equal((await read(ctx.s)).revision, 1);
  await ai(ctx, [{
    op: 'setSideState',
    mainId: 'm1',
    id: 's2',
    state: 'rejected',
    note: '硬件没坏过'
  }, {
    op: 'setSideState',
    mainId: 'm1',
    id: 's3',
    state: 'aligned',
    alignedBy: '都是半夜出事没人管'
  }, {
    op: 'convergeMain',
    id: 'm1',
    title: '服务器宕机：没有人运维',
    alignedBy: '对，问题是运维。'
  }], {
    expectedRevision: 1
  });
  const p = await read(ctx.s);
  assert.equal(p.main.nodes[0].state, 'aligned');
  assert.equal(p.side.m1.nodes[1].note, '硬件没坏过');
  assert.equal(p.side.m1.nodes[2].alignedBy, '都是半夜出事没人管');
});
test('refresh preserves complete prior version and does not create extra main nodes', async t => {
  const ctx = await setup(t);
  await seed(ctx);
  await ai(ctx, [{
    op: 'refreshMain',
    id: 'm1',
    title: '进行中：运维怎么解决',
    summary: '当前倾向：托管云（暂定）',
    reason: '用户纠正方向',
    by: 'user',
    turn: 4
  }, {
    op: 'upsertSide',
    mainId: 'm1',
    parentId: 's3',
    text: '问题不是迁云，而是没人运维',
    state: 'revised',
    by: 'user',
    turn: 4
  }], {
    expectedRevision: 1
  });
  const p = await read(ctx.s);
  assert.equal(p.main.nodes.length, 1);
  assert.equal(p.main.nodes[0].versions[0].title, '进行中：原因');
  assert.equal(p.main.nodes[0].versions[0].reason, '用户纠正方向');
  assert.equal(p.main.nodes[0].turn, 4);
});
test('protected main nodes require proposals; accept, reject, stale proposals and undo', async t => {
  const ctx = await setup(t);
  await seed(ctx);
  await ai(ctx, [{
    op: 'convergeMain',
    id: 'm1',
    alignedBy: '对，就是这样'
  }], {
    expectedRevision: 1
  });
  for (const op of [{
    op: 'refreshMain',
    id: 'm1',
    title: 'Overwrite'
  }, {
    op: 'deleteMain',
    id: 'm1'
  }]) await assert.rejects(() => ai(ctx, [op], {
    expectedRevision: 2
  }), {
    code: 'protected_content'
  });
  await ai(ctx, [{
    op: 'proposeRevision',
    id: 'm1',
    title: '范围：覆盖两阶段',
    reason: '整体范围'
  }], {
    expectedRevision: 2
  });
  let p = await read(ctx.s);
  assert.equal(p.main.nodes[0].title, '进行中：原因');
  await assert.rejects(() => ai(ctx, [{
    op: 'proposeRevision',
    id: 'm1',
    title: 'Duplicate'
  }], {
    expectedRevision: 3
  }), {
    code: 'pending_revision'
  });
  await ctx.s.reviewRevision({
    projectId: p.id,
    nodeId: 'm1',
    proposalId: p.proposals.m1.id,
    expectedRevision: p.revision,
    accept: true
  });
  p = await read(ctx.s);
  assert.equal(p.main.nodes[0].title, '范围：覆盖两阶段');
  assert.equal(p.main.nodes[0].userEdited, true);
  await ctx.s.history({
    projectId: p.id,
    expectedRevision: p.revision
  });
  p = await read(ctx.s);
  assert.ok(p.proposals.m1);
  assert.equal(p.main.nodes[0].title, '进行中：原因');
  await user(ctx.s, [{
    op: 'refreshMain',
    id: 'm1',
    title: 'User changed'
  }]);
  p = await read(ctx.s);
  await assert.rejects(() => ctx.s.reviewRevision({
    projectId: p.id,
    nodeId: 'm1',
    proposalId: p.proposals.m1.id,
    expectedRevision: p.revision,
    accept: true
  }), {
    code: 'proposal_stale'
  });
  await ctx.s.reviewRevision({
    projectId: p.id,
    nodeId: 'm1',
    proposalId: p.proposals.m1.id,
    expectedRevision: p.revision,
    accept: false
  });
});
test('append-only writes need no read/revision; concurrent appends both survive, main refresh conflicts', async t => {
  const ctx = await setup(t);
  await seed(ctx);
  const outcomes = await Promise.all([ai(ctx, [{
    op: 'upsertSide',
    mainId: 'm1',
    parentId: 's1',
    text: 'A'
  }]), ai(ctx, [{
    op: 'upsertSide',
    mainId: 'm1',
    parentId: 's1',
    text: 'B'
  }], {
    expectedRevision: 0
  })]);
  assert.equal(outcomes.length, 2);
  assert.equal((await read(ctx.s)).side.m1.nodes.length, 5);
  const writes = await Promise.allSettled([ai(ctx, [{
    op: 'refreshMain',
    id: 'm1',
    title: 'A'
  }], {
    expectedRevision: 3
  }), ai(ctx, [{
    op: 'refreshMain',
    id: 'm1',
    title: 'B'
  }], {
    expectedRevision: 3
  })]);
  assert.equal(writes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(writes.find(x => x.status === 'rejected').reason.code, 'revision_conflict');
});
test('delete migrates every branch, preserves conclusion junction and prefers receiver key; undo/redo exact', async t => {
  const ctx = await setup(t);
  await seed(ctx);
  await ai(ctx, [{
    op: 'upsertMain',
    id: '@b',
    title: 'Next'
  }, {
    op: 'linkMain',
    source: 'm1',
    target: '@b'
  }, {
    op: 'upsertSide',
    id: '@q',
    mainId: '@b',
    text: 'Next question'
  }, {
    op: 'setKey',
    mainId: '@b',
    keyId: '@q'
  }]);
  const before = await read(ctx.s);
  await user(ctx.s, [{
    op: 'deleteMain',
    id: 'm1'
  }]);
  let p = await read(ctx.s);
  assert.deepEqual(p.main.nodes.map(n => n.id), ['m2']);
  assert.equal(sideNodes(p.side.m2).length, 4);
  assert.equal(p.side.m2.entries[0].deleted, true);
  assert.equal(p.side.m2.entries[0].snapshot.title, '进行中：原因');
  assert.deepEqual(sideTrees(p.side.m2).filter(s => s.keyId).map(s => s.keyId), ['s4']);
  assert.equal(p.main.nodes[0].structureLocked, true);
  await ctx.s.history({
    projectId: p.id,
    expectedRevision: p.revision
  });
  p = await read(ctx.s);
  assert.deepEqual(p.main, before.main);
  assert.deepEqual(p.side, before.side);
  await ctx.s.history({
    projectId: p.id,
    expectedRevision: p.revision,
    direction: 'redo'
  });
  assert.equal(sideNodes((await read(ctx.s)).side.m2).length, 4);
});
test('delete terminal creates new frontier and retains prior key/history/sources', async t => {
  const ctx = await setup(t);
  await seed(ctx);
  await user(ctx.s, [{
    op: 'deleteMain',
    id: 'm1'
  }]);
  const p = await read(ctx.s);
  assert.equal(p.main.nodes[0].state, 'frontier');
  assert.match(p.main.nodes[0].title, /^进行中：/);
  assert.equal(p.side.m2.entries[0].mainId, 'm1');
  assert.deepEqual(sideTrees(p.side.m2).filter(s => s.keyId).map(s => s.keyId), ['s3']);
  assert.equal(sideNodes(p.side.m2).length, 3);
});
test('branch deletion requires receiver and reconnects remaining successors to it', async t => {
  const ctx = await setup(t);
  await seed(ctx);
  await ai(ctx, [{
    op: 'upsertMain',
    id: '@b',
    title: 'B'
  }, {
    op: 'upsertMain',
    id: '@c',
    title: 'C'
  }, {
    op: 'linkMain',
    source: 'm1',
    target: '@b'
  }, {
    op: 'linkMain',
    source: 'm1',
    target: '@c'
  }]);
  await assert.rejects(() => user(ctx.s, [{
    op: 'deleteMain',
    id: 'm1'
  }]), {
    code: 'replacement_required'
  });
  await user(ctx.s, [{
    op: 'deleteMain',
    id: 'm1',
    replacementId: 'm2'
  }]);
  const p = await read(ctx.s);
  assert.deepEqual(p.main.edges.map(e => [e.source, e.target]), [['m2', 'm3']]);
  assert.deepEqual(p.side.m3.entries.map(e => e.mainId), ['m2']);
  await assert.rejects(() => ai(ctx, [{
    op: 'linkMain',
    source: 'm3',
    target: 'm2'
  }]), {
    code: 'locked_structure'
  });
});
test('side text and source evidence cannot be silently rewritten by AI', async t => {
  const ctx = await setup(t);
  await seed(ctx);
  await assert.rejects(() => ai(ctx, [{
    op: 'upsertSide',
    mainId: 'm1',
    id: 's1',
    text: 'Changed'
  }]), {
    code: 'protected_content'
  });
  await ai(ctx, [{
    op: 'upsertSide',
    mainId: 'm1',
    id: 's1',
    sources: [{
      id: 'quote',
      quote: 'Original'
    }]
  }]);
  await assert.rejects(() => ai(ctx, [{
    op: 'upsertSide',
    mainId: 'm1',
    id: 's1',
    sources: [{
      id: 'quote',
      quote: 'Changed'
    }]
  }]), {
    code: 'protected_source'
  });
  await user(ctx.s, [{
    op: 'upsertSide',
    mainId: 'm1',
    id: 's1',
    text: 'User edit'
  }]);
  await assert.rejects(() => ai(ctx, [{
    op: 'setSideState',
    mainId: 'm1',
    id: 's1',
    state: 'revised'
  }]), {
    code: 'protected_content'
  });
});
test('session isolation, paused writes, recycle bin and independent material export', async t => {
  const ctx = await setup(t);
  await seed(ctx);
  const other = await ctx.s.create('Other');
  await assert.rejects(() => ai(ctx, [{
    op: 'upsertMain',
    title: 'X'
  }], {
    projectId: other.id
  }), {
    code: 'project_mismatch'
  });
  await ai(ctx, [{
    op: 'refreshMain',
    id: 'm1',
    body: 'Saved body'
  }], {
    expectedRevision: 1
  });
  const content = await ctx.s.material({
    projectId: 'reasoncontour'
  });
  assert.match(content.markdown, /Saved body/);
  await ctx.s.view({
    projectId: 'reasoncontour',
    positions: {
      m1: {
        x: 100,
        y: 200
      }
    }
  });
  assert.deepEqual(await ctx.s.material({
    projectId: 'reasoncontour'
  }), content);
  await ctx.s.session({
    action: 'pause',
    sessionId: ctx.sessionId
  });
  await assert.rejects(() => ai(ctx, [{
    op: 'upsertMain',
    title: 'X'
  }]), {
    code: 'inactive_session'
  });
  const before = await read(ctx.s);
  await ctx.s.deleteProject({
    projectId: before.id,
    expectedRevision: before.revision
  });
  await assert.rejects(() => ctx.s.read({
    projectId: before.id
  }), {
    code: 'project_deleted'
  });
  await ctx.s.restoreProject({
    projectId: before.id
  });
  assert.deepEqual((await read(ctx.s)).main, before.main);
  assert.equal((await ctx.s.state()).sessions[0].state, 'closed');
});
test('history preserves monotonic IDs and emits changes; invalid batches leave durable state unchanged', async t => {
  const ctx = await setup(t);
  await seed(ctx);
  const before = await read(ctx.s);
  await assert.rejects(() => ai(ctx, [{
    op: 'upsertMain',
    title: 'Temporary'
  }, {
    op: 'linkMain',
    source: 'm1',
    target: 'missing'
  }]));
  assert.deepEqual(await read(ctx.s), before);
  await ctx.s.history({
    projectId: before.id,
    expectedRevision: before.revision
  });
  const result = await ai(ctx, [{
    op: 'upsertMain',
    id: '@next',
    title: 'New'
  }]);
  assert.equal(result.ids['@next'], 'm2');
  const changes = await ctx.s.read({
    projectId: before.id,
    scope: 'changes',
    sinceRevision: 1
  });
  assert.equal(changes.events.length, 2);
  assert.deepEqual(changes.events[0].nodes.removed, ['m1']);
  assert.equal(changes.events[1].nodes.upserted[0].id, 'm2');
});
test('server publishes independent writes and rejects foreign origins', async t => {
  const {
      s
    } = await setup(t),
    app = await startServer({
      service: s
    });
  t.after(() => app.close());
  const controller = new AbortController(),
    response = await fetch(app.url + '/api/events', {
      signal: controller.signal
    }),
    reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /ready/);
  await s.create('Sync');
  const event = await Promise.race([reader.read(), new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 3000).unref())]);
  assert.match(new TextDecoder().decode(event.value), /refresh/);
  controller.abort();
  const rejected = await fetch(app.url + '/api/action', {
    method: 'POST',
    headers: {
      Origin: 'https://example.com',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'create',
      args: {
        name: 'Blocked'
      }
    })
  });
  assert.equal(rejected.status, 403);
});

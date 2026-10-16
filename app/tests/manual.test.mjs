import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Service } from '../service.mjs';
import { Store, PROJECT_ROOT, sideNodes, sideTrees } from '../model.mjs';
async function setup(t) {
  const base = path.join(PROJECT_ROOT, '.test-data');
  await fs.mkdir(base, {
    recursive: true
  });
  const dir = await fs.mkdtemp(path.join(base, 'manual-'));
  t.after(() => fs.rm(dir, {
    recursive: true,
    force: true
  }));
  const s = await new Service({
      store: new Store(dir)
    }).init(),
    {
      session
    } = await s.session({
      projectId: 'reasoncontour'
    });
  await s.transact({
    sessionId: session.id,
    operations: [{
      op: 'upsertMain',
      id: '@m',
      title: 'Original'
    }, {
      op: 'upsertSide',
      id: '@q',
      mainId: '@m',
      text: 'Root question'
    }, {
      op: 'upsertSide',
      id: '@chosen',
      mainId: '@m',
      parentId: '@q',
      text: 'Chosen route',
      state: 'aligned',
      alignedBy: '就选这个'
    }, {
      op: 'upsertSide',
      id: '@rejected',
      mainId: '@m',
      parentId: '@q',
      text: 'Rejected sibling',
      state: 'rejected',
      note: '太贵'
    }, {
      op: 'upsertSide',
      id: '@open',
      mainId: '@m',
      parentId: '@q',
      text: 'Open sibling'
    }, {
      op: 'upsertSide',
      id: '@next',
      mainId: '@m',
      parentId: '@chosen',
      text: 'Follow-up question'
    }, {
      op: 'setKey',
      mainId: '@m',
      keyId: '@chosen'
    }]
  }, 'ai');
  return {
    s,
    session
  };
}
const read = async s => (await s.state()).project;
async function write(s, operations) {
  const p = await read(s);
  return s.transact({
    projectId: p.id,
    expectedRevision: p.revision,
    operations
  });
}
test('promote moves chosen path/rejected siblings; open siblings and descendants retain copied ancestors with reciprocal references', async t => {
  const {
      s
    } = await setup(t),
    before = await read(s),
    r = await write(s, [{
      op: 'promoteSide',
      mainId: 'm1',
      id: 's2'
    }]);
  assert.equal(r.ids.promotedId, 'm2');
  const p = await read(s);
  assert.deepEqual(p.main.nodes.map(n => n.id), ['m2', 'm1']);
  assert.equal(p.main.nodes[0].state, 'aligned');
  assert.equal(p.main.nodes[0].alignedBy, '就选这个');
  assert.deepEqual(sideNodes(p.side.m2).map(n => n.text), ['Root question', 'Chosen route', 'Rejected sibling']);
  assert.ok(sideNodes(p.side.m1).some(n => n.text === 'Open sibling'));
  assert.ok(sideNodes(p.side.m1).some(n => n.text === 'Follow-up question'));
  assert.equal(p.side.m2.keyId, 's2');
  assert.equal(p.side.m1.keyId, null);
  const rootCopy = p.side.m1.nodes.find(n => n.text === 'Root question');
  assert.notEqual(rootCopy.id, 's1');
  assert.equal(rootCopy.referenceMainId, 'm2');
  assert.equal(p.side.m2.nodes.find(n => n.id === 's1').referenceMainId, 'm1');
  assert.deepEqual(p.main.edges.map(e => [e.source, e.target]), [['m2', 'm1']]);
  await s.history({
    projectId: p.id,
    expectedRevision: p.revision
  });
  assert.deepEqual((await read(s)).main, before.main);
  assert.deepEqual((await read(s)).side, before.side);
});
test('merge requires adjacency and always keeps later conclusion, joins derivation and prefers later key', async t => {
  const {
    s,
    session
  } = await setup(t);
  await s.transact({
    sessionId: session.id,
    operations: [{
      op: 'upsertMain',
      id: '@b',
      title: 'Later conclusion'
    }, {
      op: 'linkMain',
      source: 'm1',
      target: '@b'
    }, {
      op: 'upsertSide',
      id: '@next',
      mainId: '@b',
      text: 'Later question'
    }, {
      op: 'setKey',
      mainId: '@b',
      keyId: '@next'
    }]
  }, 'ai');
  const before = await read(s);
  await write(s, [{
    op: 'mergeMain',
    id: 'm2',
    targetId: 'm1'
  }]);
  const p = await read(s);
  assert.equal(p.main.nodes[0].title, 'Later conclusion');
  assert.equal(p.main.nodes.length, 1);
  assert.equal(p.side.m2.entries[0].deleted, false);
  assert.equal(p.side.m2.entries[0].snapshot.title, 'Original');
  assert.equal(sideNodes(p.side.m2).length, 6);
  assert.deepEqual(sideTrees(p.side.m2).filter(s => s.keyId).map(s => s.keyId), ['s6']);
  await s.history({
    projectId: p.id,
    expectedRevision: p.revision
  });
  assert.deepEqual((await read(s)).side, before.side);
});
test('preview is read-only; stale release cannot commit over concurrent changes', async t => {
  const {
    s,
    session
  } = await setup(t);
  await s.transact({
    sessionId: session.id,
    operations: [{
      op: 'upsertMain',
      id: '@b',
      title: 'B'
    }, {
      op: 'linkMain',
      source: 'm1',
      target: '@b'
    }]
  }, 'ai');
  const before = await s.store.read(),
    p = before.projects.reasoncontour,
    args = {
      projectId: p.id,
      expectedRevision: p.revision,
      operations: [{
        op: 'mergeMain',
        id: 'm1',
        targetId: 'm2'
      }]
    };
  const preview = await s.preview(args);
  assert.equal(preview.main.nodes.length, 1);
  assert.deepEqual(await s.store.read(), before);
  await s.transact({
    sessionId: session.id,
    operations: [{
      op: 'upsertSide',
      mainId: 'm2',
      text: 'Concurrent question'
    }]
  }, 'ai');
  await assert.rejects(() => s.transact(args), {
    code: 'revision_conflict'
  });
  assert.equal((await read(s)).main.nodes.length, 2);
});
test('manual operations reject AI; editing preserves structure and is undone in one step', async t => {
  const {
      s,
      session
    } = await setup(t),
    p = await read(s);
  await assert.rejects(() => s.transact({
    sessionId: session.id,
    expectedRevision: p.revision,
    operations: [{
      op: 'promoteSide',
      mainId: 'm1',
      id: 's2'
    }]
  }, 'ai'), {
    code: 'manual_only'
  });
  await write(s, [{
    op: 'refreshMain',
    id: 'm1',
    title: 'Edited conclusion',
    reason: '用户手动修改'
  }]);
  const edited = await read(s);
  assert.deepEqual(edited.main.edges, p.main.edges);
  assert.deepEqual(edited.side, p.side);
  assert.equal(edited.main.nodes[0].versions.at(-1).title, 'Original');
  assert.equal(edited.main.nodes[0].userEdited, true);
  await assert.rejects(() => s.transact({
    sessionId: session.id,
    expectedRevision: edited.revision,
    operations: [{
      op: 'refreshMain',
      id: 'm1',
      title: 'Overwrite'
    }]
  }, 'ai'), {
    code: 'protected_content'
  });
  await s.history({
    projectId: p.id,
    expectedRevision: edited.revision
  });
  assert.deepEqual((await read(s)).main, p.main);
});
test('promote from a previously merged derivation preserves all material and rejects nonadjacent merge', async t => {
  const {
    s,
    session
  } = await setup(t);
  await s.transact({
    sessionId: session.id,
    operations: [{
      op: 'upsertMain',
      id: '@b',
      title: 'B'
    }, {
      op: 'linkMain',
      source: 'm1',
      target: '@b'
    }, {
      op: 'upsertSide',
      mainId: '@b',
      text: 'Next question'
    }]
  }, 'ai');
  await write(s, [{
    op: 'mergeMain',
    id: 'm1',
    targetId: 'm2'
  }]);
  await write(s, [{
    op: 'promoteSide',
    mainId: 'm2',
    id: 's2'
  }]);
  const p = await read(s);
  const all = Object.values(p.side).flatMap(sideNodes);
  for (const word of ['Root question', 'Chosen route', 'Rejected sibling', 'Open sibling', 'Follow-up question', 'Next question']) assert.ok(all.some(n => n.text === word));
  assert.equal(new Set(all.map(n => n.id)).size, all.length);
  await write(s, [{
    op: 'upsertMain',
    title: 'Disconnected'
  }]);
  await assert.rejects(() => write(s, [{
    op: 'mergeMain',
    id: 'm2',
    targetId: 'm4'
  }]));
});
test('auto can append a new frontier after manual structure without rearranging it', async t => {
  const {
    s,
    session
  } = await setup(t);
  await write(s, [{
    op: 'promoteSide',
    mainId: 'm1',
    id: 's2'
  }]);
  const before = await read(s);
  await s.transact({
    sessionId: session.id,
    operations: [{
      op: 'upsertMain',
      id: '@next',
      title: 'New continuation'
    }, {
      op: 'linkMain',
      source: 'm1',
      target: '@next'
    }]
  }, 'ai');
  const after = await read(s);
  assert.deepEqual(after.main.edges.slice(0, before.main.edges.length), before.main.edges);
  assert.equal(after.main.nodes.length, 3);
  assert.deepEqual(after.side.m1.nodes, before.side.m1.nodes);
});

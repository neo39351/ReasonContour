import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Store, PROJECT_ROOT } from '../storage.mjs';
import { Service } from '../service.mjs';
async function setup(t) {
  const base = path.join(PROJECT_ROOT, '.test-data');
  await fs.mkdir(base, {
    recursive: true
  });
  const dir = await fs.mkdtemp(path.join(base, 'storage-'));
  t.after(() => fs.rm(dir, {
    recursive: true,
    force: true
  }));
  return new Store(dir);
}
test('projects and sessions persist separately and portable project keeps its graph', async t => {
  const store = await setup(t),
    s = await new Service({
      store
    }).init(),
    a = await s.session({
      projectId: 'reasoncontour'
    }),
    b = await s.create('Independent'),
    bSession = await s.session({
      projectId: b.id
    });
  const bytes = await fs.readFile(store.projectFile(b.id), 'utf8'),
    stat = await fs.stat(store.projectFile(b.id));
  await s.transact({
    sessionId: a.session.id,
    operations: [{
      op: 'upsertMain',
      title: 'Only A'
    }]
  }, 'ai');
  assert.equal(await fs.readFile(store.projectFile(b.id), 'utf8'), bytes);
  assert.equal((await fs.stat(store.projectFile(b.id))).mtimeMs, stat.mtimeMs);
  assert.deepEqual(JSON.parse(bytes).sessions.map(s => s.id), [bSession.session.id]);
  const moved = path.join(store.directory, 'relocated');
  await fs.mkdir(moved);
  await fs.cp(path.dirname(store.projectFile(b.id)), path.join(moved, path.basename(path.dirname(store.projectFile(b.id)))), {
    recursive: true
  });
  assert.equal((await new Service({
    store: new Store(moved)
  }).state(b.id)).project.name, 'Independent');
});
test('legacy v2 and v3 are rejected without migration or changing original bytes', async t => {
  for (const version of [2, 3]) {
    const store = await setup(t),
      file = version === 2 ? path.join(store.directory, 'store.json') : store.file,
      bytes = JSON.stringify({
        version,
        projects: {
          old: {
            nodes: [],
            edges: []
          }
        },
        sessions: {}
      });
    await fs.writeFile(file, bytes);
    await assert.rejects(() => new Service({
      store
    }).init(), {
      code: 'unsupported_format'
    });
    assert.equal(await fs.readFile(file, 'utf8'), bytes);
    assert.deepEqual(await fs.readdir(store.directory), [path.basename(file)]);
  }
});
test('old standalone project bundle is rejected without rewrite', async t => {
  const store = await setup(t),
    file = store.projectFile('old'),
    bytes = JSON.stringify({
      version: 3,
      project: {
        id: 'old',
        nodes: [],
        edges: []
      },
      sessions: []
    });
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, bytes);
  await assert.rejects(() => store.read(), {
    code: 'unsupported_format'
  });
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
});
test('interrupted v4 transaction replays durable journal before exposing data', async t => {
  const store = await setup(t);
  await new Service({
    store
  }).init();
  const data = await store.read(),
    bundle = store.bundle(data, 'reasoncontour');
  bundle.project.name = 'Recovered';
  await store.atomic(store.journal, {
    version: 4,
    bundles: [bundle],
    workspace: {
      version: 4,
      sequence: data.sequence + 1
    }
  });
  assert.equal((await new Store(store.directory).read()).projects.reasoncontour.name, 'Recovered');
  await assert.rejects(() => fs.access(store.journal), {
    code: 'ENOENT'
  });
});

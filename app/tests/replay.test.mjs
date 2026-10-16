import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Service } from '../service.mjs';
import { Store, PROJECT_ROOT } from '../storage.mjs';
import { sideNodes, sideTrees } from '../model.mjs';
import { cloudTurns, workspaceTurns } from './fixtures/replays.mjs';
import { replay } from './fixtures/replay.mjs';
async function setup(t, name) {
  const base = path.join(PROJECT_ROOT, '.test-data');
  await fs.mkdir(base, {
    recursive: true
  });
  const directory = await fs.mkdtemp(path.join(base, 'replay-'));
  t.after(() => fs.rm(directory, {
    recursive: true,
    force: true
  }));
  const s = await new Service({
    store: new Store(directory),
    boundProjectId: 'reasoncontour'
  }).init();
  return s;
}
function report(name, r) {
  for (const row of r.stats) console.log(`${name} turn=${row.turn} RC in=${row.inputChars} out=${row.outputChars} total=${row.total} writes=${row.writes}`);
  console.log(`${name} RC average=${r.average.toFixed(1)}, total=${r.total} (includes session guide; read-free writes)`);
  assert.ok(r.average <= 1000);
  assert.ok(r.stats.every(s => s.writes <= 1));
}
test('团队工作台 19-turn fictional replay preserves convergence and stays below mean 1000 RC characters', async t => {
  const s = await setup(t),
    r = await replay(s, workspaceTurns);
  report('workspace', r);
  const p = r.states.at(-1);
  assert.equal(p.main.nodes.length, 3);
  assert.deepEqual(p.main.nodes.map(n => n.state), ['aligned', 'aligned', 'frontier']);
  assert.equal(p.main.nodes[0].turn, 8);
  assert.match(p.main.nodes[0].title, /覆盖两阶段/);
  assert.match(p.main.nodes[1].title, /每个库被直接做成一个页面/);
  assert.equal(p.main.nodes[1].turn, 11);
  assert.equal(p.main.nodes[2].turn, 19);
  assert.match(p.main.nodes[2].title, /保留现有资料访问能力/);
  const side = sideNodes(p.side[p.main.nodes[2].id]);
  for (const [pattern, state] of [[/拆成/, 'rejected'], [/统一的/, 'rejected'], [/过度设计/, 'revised'], [/六个功能区/, 'open'], [/保留在资料区/, 'open']]) assert.equal(side.find(n => pattern.test(n.text)).state, state);
  assert.equal(side.find(n => /统一的/.test(n.text)).note, '过度设计：团队无需新增管理层');
  for (const turn of [4, 5, 6]) assert.equal(r.stats[turn - 1].total, 0);
  assert.equal(r.states[7].main.nodes.length, 1);
  assert.equal(r.states[7].main.nodes[0].versions.at(-1).title, '方向：先梳理团队工作台 需要支持的任务，再设计导航');
});
test('Cloud 14-turn replay preserves tombstone, rejections, key replacement and tentative final plan', async t => {
  const s = await setup(t),
    r = await replay(s, cloudTurns);
  report('cloud', r);
  assert.equal(r.states[3].main.nodes.length, 1);
  assert.equal(r.states[4].main.nodes[0].state, 'aligned');
  const p = r.states.at(-1);
  assert.equal(p.main.nodes.length, 2);
  assert.deepEqual(p.main.nodes.map(n => n.state), ['aligned', 'tentative']);
  assert.equal(p.main.nodes[0].title, '服务器宕机：没有人运维');
  assert.equal(p.main.nodes[1].title, '解决方案：迁云，先做主从同步，追平后再切换');
  const diagnosis = p.side[p.main.nodes[0].id];
  assert.equal(diagnosis.entries[0].deleted, true);
  assert.match(diagnosis.entries[0].snapshot.title, /要不要迁云/);
  const side = sideNodes(p.side[p.main.nodes[1].id]);
  for (const word of ['招一个运维', '外包运维', '只迁业务服务器', '一次性停机迁移（停一天）']) assert.equal(side.find(n => n.text === word).state, 'rejected');
  assert.equal(side.find(n => n.text === '按量付费约 1.3 倍').state, 'open');
  const key = sideTrees(p.side[p.main.nodes[1].id]).find(s => s.keyId).keyId;
  assert.equal(side.find(n => n.id === key).text, '主从同步，追平后切换');
  assert.match(r.states[12].main.nodes[1].title, /主从同步/);
  assert.equal(side.at(-1).text, '我们的数据库版本能用吗？');
  for (const n of p.main.nodes.filter(n => n.state === 'aligned')) assert.ok(n.alignedBy);
  for (const n of Object.values(p.side).flatMap(sideNodes).filter(n => n.state === 'aligned')) assert.ok(n.alignedBy);
});

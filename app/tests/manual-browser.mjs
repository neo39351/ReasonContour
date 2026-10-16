import { launchBrowser } from './browser-runtime.mjs';
import { writePreferences } from '../preferences.mjs';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { Service } from '../service.mjs';
import { Store, PROJECT_ROOT } from '../storage.mjs';
import { startServer } from '../server.mjs';
const base = path.join(PROJECT_ROOT, '.test-data');
await fs.mkdir(base, {
  recursive: true
});
const directory = await fs.mkdtemp(path.join(base, 'manual-ui-')),
  service = await new Service({
    store: new Store(directory)
  }).init(),
  {
    session
  } = await service.session({
    projectId: 'reasoncontour'
  });
await service.transact({
  sessionId: session.id,
  operations: [{
    op: 'upsertMain',
    id: '@a',
    title: '方向：先定位原因'
  }, {
    op: 'upsertMain',
    id: '@b',
    title: '方案：选择托管云'
  }, {
    op: 'upsertMain',
    id: '@c',
    title: '进行中：数据库如何迁移'
  }, {
    op: 'linkMain',
    source: '@a',
    target: '@b'
  }, {
    op: 'linkMain',
    source: '@b',
    target: '@c'
  }, {
    op: 'upsertSide',
    id: '@q',
    mainId: '@b',
    text: '如何解决运维问题？'
  }, {
    op: 'upsertSide',
    id: '@chosen',
    mainId: '@b',
    parentId: '@q',
    text: '结论：使用托管云',
    state: 'aligned',
    alignedBy: '就选托管云'
  }, {
    op: 'upsertSide',
    mainId: '@b',
    parentId: '@q',
    text: '招一个运维',
    state: 'rejected',
    note: '太贵'
  }, {
    op: 'upsertSide',
    mainId: '@b',
    parentId: '@q',
    text: '外包仍待评估'
  }, {
    op: 'upsertSide',
    mainId: '@b',
    parentId: '@chosen',
    text: '范围待确认'
  }]
}, 'ai');
await writePreferences(service.store, {
  language: 'zh-CN'
});
const app = await startServer({
    service
  }),
  browser = await launchBrowser(),
  page = await browser.newPage({
    viewport: {
      width: 1500,
      height: 980
    }
  }),
  errors = [];
page.on('pageerror', e => errors.push(e.message));
const shots = process.env.REASONCONTOUR_QA_DIR || path.join(PROJECT_ROOT, 'work/ui-qa');
await fs.mkdir(shots, {
  recursive: true
});
const p = async () => (await service.state()).project;
const updated = async revision => {
  await page.waitForFunction(async r => (await (await fetch('/api/state')).json()).project.revision > r, revision);
  await page.waitForTimeout(250);
};
const undo = async () => {
  const revision = (await p()).revision;
  await page.keyboard.press('Control+z');
  await updated(revision);
};
try {
  await page.goto(app.url);
  await page.waitForSelector('[data-main="m3"]');
  await page.waitForSelector('.react-flow__edge', {
    state: 'attached'
  });
  await page.waitForTimeout(500);
  const before = await p();
  await page.locator('[data-main="m3"] .card-title').dblclick();
  await page.getByLabel('编辑主图标题').fill('修改：保留原结构');
  await page.getByLabel('编辑主图标题').press('Enter');
  await updated(before.revision);
  assert.equal((await p()).main.nodes[2].title, '修改：保留原结构');
  assert.deepEqual((await p()).main.edges, before.main.edges);
  await undo();
  assert.equal((await p()).main.nodes[2].title, before.main.nodes[2].title);
  await page.locator('[data-main="m3"] .card-title').dblclick();
  await page.getByLabel('编辑主图标题').fill('不要保存');
  await page.getByLabel('编辑主图标题').press('Escape');
  assert.equal((await p()).main.nodes[2].title, before.main.nodes[2].title);
  await page.locator('[data-main="m3"]').click();
  const r = (await p()).revision;
  await page.keyboard.press('Delete');
  await updated(r);
  assert.equal((await p()).main.nodes.length, 3);
  assert.ok(!(await p()).main.nodes.some(n => n.id === 'm3'));
  await page.getByRole('status').getByRole('button', {
    name: '撤销'
  }).click();
  await updated(r + 1);
  assert.ok((await p()).main.nodes.some(n => n.id === 'm3'));
  await page.locator('.main-canvas .zoom-tools button').last().click();
  await page.waitForTimeout(250);
  await page.locator('[data-main="m2"]').click();
  await page.waitForSelector('[data-side="s2"]');
  await page.locator('[data-side="s2"]').hover();
  await page.locator('[data-side="s2"] summary').click();
  const rp = (await p()).revision;
  await page.getByRole('button', {
    name: '升为主图节点',
    exact: true
  }).click();
  await updated(rp);
  assert.equal((await p()).main.nodes.length, 4);
  const promoted = (await p()).main.nodes.find(n => n.sourceSideId === 's2');
  assert.ok(promoted);
  assert.ok(await page.locator(`[data-main="${promoted.id}"]`).isVisible());
  assert.match(await page.locator('.sheet-head h2').textContent(), /使用托管云/);
  await page.screenshot({
    path: path.join(shots, 'manual-promote.png')
  });
  await undo();
  assert.equal((await p()).main.nodes.length, 3);
  await page.locator('.main-canvas .zoom-tools button').last().click();
  await page.waitForTimeout(350);
  const a = await page.locator('[data-main="m2"]').boundingBox(),
    b = await page.locator('[data-main="m3"]').boundingBox(),
    rm = (await p()).revision;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
    steps: 15
  });
  await page.locator('.merge-preview').waitFor();
  assert.equal((await p()).revision, rm);
  assert.equal((await p()).main.nodes.length, 3);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.side-canvas'), bounds = canvas.getBoundingClientRect();
    return canvas.querySelectorAll('.side-card.entry').length === 2 && [...canvas.querySelectorAll('[data-side]')].every(node => {
      const r = node.getBoundingClientRect();
      return r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom;
    });
  });
  await page.screenshot({
    path: path.join(shots, 'manual-merge-preview.png')
  });
  await page.mouse.up();
  await updated(rm);
  assert.equal((await p()).main.nodes.length, 2);
  assert.equal((await p()).main.nodes.at(-1).title, '进行中：数据库如何迁移');
  await undo();
  assert.equal((await p()).main.nodes.length, 3);
  // A second drag cancelled with Escape must never commit on mouse-up.
  await page.locator('.main-canvas .zoom-tools button').last().click();
  await page.waitForTimeout(300);
  const aa = await page.locator('[data-main="m2"]').boundingBox(),
    bb = await page.locator('[data-main="m3"]').boundingBox(),
    rc = (await p()).revision;
  await page.mouse.move(aa.x + aa.width / 2, aa.y + aa.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, {
    steps: 12
  });
  await page.locator('.merge-preview').waitFor();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal((await p()).revision, rc);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    passed: ['inline edit + Escape + undo', 'terminal delete + toast undo', 'promote + panel follow + undo', 'merge preview read-only + release + undo', 'Escape cancels drag'],
    errors
  }, null, 2));
} catch (e) {
  await page.screenshot({
    path: path.join(shots, 'manual-failure.png')
  });
  throw e;
} finally {
  await browser.close();
  await app.close();
  if (!directory.startsWith(base + path.sep)) throw new Error('unsafe cleanup');
  await fs.rm(directory, {
    recursive: true,
    force: true
  });
}

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Service } from '../service.mjs';
import { Store, PROJECT_ROOT } from '../storage.mjs';
import { startServer } from '../server.mjs';
import { writePreferences } from '../preferences.mjs';
import { launchBrowser } from './browser-runtime.mjs';
const base = path.join(PROJECT_ROOT, '.test-data');
await fs.mkdir(base, {
  recursive: true
});
const dir = await fs.mkdtemp(path.join(base, 'live-main-side-')),
  service = await new Service({
    store: new Store(dir)
  }).init(),
  {
    session
  } = await service.session({
    projectId: 'reasoncontour'
  });
await writePreferences(service.store, {
  language: 'zh-CN'
});
const write = operations => service.transact({
  sessionId: session.id,
  operations
}, 'ai');
await write([{
  op: 'upsertMain',
  title: '进行中：第一个问题'
}]);
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
try {
  await page.goto(app.url);
  await page.waitForSelector('[data-main="m1"]');
  await write([{
    op: 'upsertSide',
    mainId: 'm1',
    text: '刚补充的问题'
  }]);
  await page.waitForSelector('[data-side="s1"] .fresh-dot');
  assert.equal(await page.locator('.fresh-dot').count(), 1);
  await page.locator('[data-side="s1"]').hover();
  await page.waitForSelector('[data-side="s1"] .fresh-dot', {
    state: 'detached'
  });
  await write([{
    op: 'upsertMain',
    id: '@next',
    title: '进行中：后续讨论'
  }, {
    op: 'linkMain',
    source: 'm1',
    target: '@next'
  }, {
    op: 'upsertSide',
    mainId: '@next',
    text: '下一步怎么办？'
  }]);
  await page.waitForFunction(() => document.querySelector('.sheet-head h2')?.textContent === '进行中：后续讨论');
  await page.locator('.main-canvas .zoom-tools button').last().click();
  await page.waitForTimeout(250);
  await page.locator('[data-main="m1"]').click();
  await page.getByTitle('解除钉住，回到前沿').waitFor();
  await write([{
    op: 'upsertSide',
    mainId: 'm2',
    parentId: 's2',
    text: '新选项'
  }]);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.sheet-head h2').textContent(), '进行中：第一个问题');
  await page.getByTitle('解除钉住，回到前沿').click();
  await page.waitForSelector('[data-side="s3"]');
  const before = (await service.state()).project.revision;
  await page.getByRole('button', {
    name: '更多操作'
  }).click();
  await page.getByRole('button', {name:'English',exact:true}).click();
  await page.waitForSelector('html[lang="en"]');
  assert.equal(await page.getByRole('button', {
    name: 'More actions',
    exact: true
  }).count(), 1);
  await page.reload();
  await page.getByRole('button', {
    name: 'More actions',
    exact: true
  }).waitFor();
  assert.equal((await service.state()).project.revision, before);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    passed: ['live side marker + seen dismissal', 'new frontier follow', 'pin survives external update + unpin', 'English preference survives reload without content revision'],
    errors
  }, null, 2));
} finally {
  await browser.close();
  await app.close();
  if (!dir.startsWith(base + path.sep)) throw new Error('unsafe cleanup');
  await fs.rm(dir, {
    recursive: true,
    force: true
  });
}

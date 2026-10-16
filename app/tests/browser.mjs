import { launchBrowser } from './browser-runtime.mjs';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { Service } from '../service.mjs';
import { Store, PROJECT_ROOT } from '../storage.mjs';
import { startServer } from '../server.mjs';
import { writePreferences } from '../preferences.mjs';
import { cloudTurns, workspaceTurns } from './fixtures/replays.mjs';
import { replay } from './fixtures/replay.mjs';
const base = path.join(PROJECT_ROOT, '.test-data');
await fs.mkdir(base, {
  recursive: true
});
const directory = await fs.mkdtemp(path.join(base, 'ui-main-side-'));
const service = await new Service({
  store: new Store(directory)
}).init();
const empty = 'reasoncontour',
  workspace = (await service.create('团队工作台 · 19 轮')).id,
  cloud = (await service.create('迁云 · 第 13 轮')).id;
await replay(new Service({
  store: service.store,
  boundProjectId: workspace
}), workspaceTurns);
await replay(new Service({
  store: service.store,
  boundProjectId: cloud
}), cloudTurns, {
  stopAt: 13
});
await writePreferences(service.store, {
  language: 'zh-CN'
});
const app = await startServer({
  service
});
const shots = process.env.REASONCONTOUR_QA_DIR || path.join(PROJECT_ROOT, 'work', 'ui-qa');
await fs.mkdir(shots, {
  recursive: true
});
const browser = await launchBrowser();
const errors = [],
  checks = [];
const page = await browser.newPage({
  viewport: {
    width: 1500,
    height: 980
  }
});
page.on('pageerror', e => errors.push(e.message));
const open = async id => {
  await page.goto(`${app.url}/?projectId=${encodeURIComponent(id)}`);
  await page.waitForSelector('.topbar');
  if (id !== empty) {
    await page.waitForSelector('[data-main]');
    await page.waitForSelector('[data-side]');
    await page.waitForSelector('.react-flow__edge', {
      state: 'attached'
    });
    await page.locator('.side-canvas .zoom-tools button').last().click();
    await page.waitForTimeout(250);
  }
};
try {
  for (const theme of ['light', 'dark']) {
    await writePreferences(service.store, {
      mode: theme
    });
    await open(empty);
    await page.screenshot({
      path: path.join(shots, `${theme}-empty.png`)
    });
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    await open(workspace);
    await page.screenshot({
      path: path.join(shots, `${theme}-workspace.png`)
    });
    assert.equal(await page.locator('[data-main]').count(), 3);
    assert.equal(await page.locator('.sheet').isVisible(), true);
    assert.match(await page.locator('.sheet-head h2').textContent(), /边界和重叠/);
    const sizes = await page.evaluate(() => {
      const card = document.querySelector('[data-main]'),
        side = document.querySelector('[data-side]'),
        style = getComputedStyle(card);
      return {
        main: style.width,
        radius: style.borderRadius,
        title: getComputedStyle(card.querySelector('.card-title')).fontSize,
        side: getComputedStyle(side).width,
        top: getComputedStyle(document.querySelector('.topbar')).height,
        background: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim().toUpperCase()
      };
    });
    assert.deepEqual(sizes, {
      main: '280px',
      radius: '10px',
      title: '15px',
      side: '150px',
      top: '52px',
      background: theme === 'light' ? '#F5F2EC' : '#1E1D1B'
    });
    // WCAG AA text contrast for the specified foregrounds on both principal surfaces.
    const ratios = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement),
        rgb = h => {
          h = h.trim().replace('#', '');
          return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        },
        l = h => rgb(h).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      return ['--text', '--text-2'].flatMap(f => ['--surface', '--canvas'].map(b => {
        const a = l(s.getPropertyValue(f)),
          c = l(s.getPropertyValue(b));
        return (Math.max(a, c) + .05) / (Math.min(a, c) + .05);
      }));
    });
    assert.ok(ratios.every(r => r >= 4.5));
    assert.equal(await page.locator('.side-card.key').count(), 1);
    assert.equal(await page.locator('.main-canvas .react-flow__edge').count(), 2);
    const visible = await page.locator('.side-canvas').evaluate(canvas => {
      const c = canvas.getBoundingClientRect();
      return [...canvas.querySelectorAll('[data-side]')].every(n => {
        const r = n.getBoundingClientRect();
        return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1;
      });
    });
    assert.equal(visible, true, 'all derivation cards fit the side panel');
    await open(cloud);
    await page.screenshot({
      path: path.join(shots, `${theme}-cloud-13.png`)
    });
    assert.match(await page.locator('.sheet-head h2').textContent(), /主从同步/);
    await page.setViewportSize({
      width: 760,
      height: 900
    });
    await page.waitForTimeout(500);
    // Dense derivations stay readable at the default zoom; Fit exposes the full tree.
    await page.locator('.side-canvas .zoom-tools button').last().click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.side-canvas').evaluate(canvas=>{const c=canvas.getBoundingClientRect();return [...canvas.querySelectorAll('[data-side]')].every(n=>{const r=n.getBoundingClientRect();return r.left>=c.left-1&&r.right<=c.right+1&&r.top>=c.top-1&&r.bottom<=c.bottom+1;});}),true,'narrow derivation remains fully visible');
    await page.screenshot({
      path: path.join(shots, `${theme}-narrow.png`)
    });
    assert.equal(await page.locator('.sheet').evaluate(el => getComputedStyle(el).position), 'absolute');
    assert.equal(await page.locator('.topbar').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.sheet').count(), 0);
    await page.setViewportSize({
      width: 1500,
      height: 980
    });
    checks.push(`${theme}: empty, 团队工作台, cloud turn 13, narrow drawer; fixed sizes and AA text contrast`);
  }
  await open(workspace);
  await page.locator('.main-canvas .zoom-tools button').last().click();
  await page.waitForTimeout(300);
  await page.locator('[data-main="m1"]').click();
  await page.getByTitle('解除钉住，回到前沿').waitFor();
  assert.match(await page.locator('.sheet-head h2').textContent(), /方向/);
  await page.getByRole('tab', {
    name: /^历史/
  }).click();
  assert.ok((await page.locator('.history-list').textContent()).includes('范围调整为收集与协作两阶段'));
  await page.getByTitle('解除钉住，回到前沿').click();
  assert.match(await page.locator('.sheet-head h2').textContent(), /边界和重叠/);
  await page.getByRole('button', {
    name: '更多操作'
  }).click();
  await page.getByRole('button', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({
    colorScheme: 'dark'
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.emulateMedia({
    colorScheme: 'light'
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.deepEqual(await page.locator('.menu .segmented').first().getByRole('button').allTextContents(), ['浅色', '深色', '跟随系统']);
  checks.push('pin/unpin, version history, system appearance, only three appearance choices');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(shots, 'ui-results.json'), JSON.stringify({
    checks,
    errors
  }, null, 2));
  console.log(JSON.stringify({
    passed: checks.length,
    checks,
    shots,
    errors
  }, null, 2));
} catch (e) {
  await page.screenshot({
    path: path.join(shots, 'failure.png')
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

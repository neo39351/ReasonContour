// Capture the real, built application. Demo discussions are invented and isolated.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { Service } from '../app/service.mjs';
import { Store, PROJECT_ROOT } from '../app/storage.mjs';
import { startServer } from '../app/server.mjs';
import { writePreferences } from '../app/preferences.mjs';

const base = path.join(PROJECT_ROOT,'.test-data');
await fs.mkdir(base,{recursive:true});
const directory=await fs.mkdtemp(path.join(base,'readme-demo-'));
const out=path.join(PROJECT_ROOT,'docs/assets');
await fs.mkdir(out,{recursive:true});
const service=await new Service({store:new Store(directory)}).init();
const browser=await chromium.launch({headless:true,executablePath:process.env.REASONCONTOUR_CHROMIUM || undefined});
let app;
try {
  app=await startServer({service});
  for(const language of ['zh-CN','en']) {
    const zh=language==='zh-CN',t=(cn,en)=>zh?cn:en;
    const project=(await service.create(t('团队知识库选型','Team knowledge base'))).id;
    const {session}=await service.session({projectId:project,label:t('演示讨论（虚构）','Demo discussion (fictional)')});
    const agreement=t('同意，先用现成知识库，把全文搜索做好。','Agreed. Use an existing knowledge base and prioritize full-text search.');
    const main=(id,title,turn,extra={})=>({op:'upsertMain',id,title,turn,...extra});
    const side=(id,parentId,text,turn,extra={})=>({op:'upsertSide',id,mainId:'@choice',parentId,text,turn,...extra});
    await service.transact({projectId:project,sessionId:session.id,expectedRevision:0,operations:[
      main('@goal',t('目标：团队资料集中、方便检索','Goal: one searchable team library'),3,{state:'aligned',alignedBy:t('对，先让大家能找到已有资料。','Yes. Help everyone find the material we already have.')}),
      main('@choice',t('进行中：自研还是选现成产品？','Open: build or adopt an existing tool?'),4),
      {op:'linkMain',source:'@goal',target:'@choice'},
      side('@question',null,t('怎样搭建团队知识库？','How should we build the knowledge base?'),4,{by:'user'}),
      side('@build','@question',t('从零自研','Build from scratch'),5,{state:'rejected',note:t('维护成本太高','Too much maintenance')}),
      side('@adopt','@question',t('使用现成产品','Use an existing tool'),5,{state:'aligned',alignedBy:agreement,note:t('先解决实际问题','Solve the immediate need')}),
      side('@folders','@question',t('继续用共享文件夹','Keep shared folders'),5,{state:'rejected',note:t('仍然难以检索','Still hard to search')}),
      side('@priority','@adopt',t('优先满足哪项能力？','Which capability comes first?'),6),
      side('@search','@priority',t('先把全文搜索做好','Prioritize full-text search'),7,{state:'aligned',alignedBy:agreement,note:t('用户明确认同','Explicitly agreed by the user')}),
      side('@approval','@priority',t('先做复杂审批流','Complex approval workflows'),7,{state:'rejected',note:t('当前团队用不上','No current team need')}),
      {op:'setKey',mainId:'@choice',keyId:'@search'},
      {op:'refreshMain',id:'@choice',title:t('方案：现成知识库，搜索优先','Choice: an existing tool; search first'),state:'aligned',alignedBy:agreement,turn:8,reason:t('根据用户确认收敛方案','Converged after explicit user agreement')},
      main('@migration',t('进行中：怎样迁移旧文档？','Open: how do we migrate old documents?'),9,{summary:t('先用一个小项目试点（暂定）','Start with a small pilot (tentative)')}),
      {op:'linkMain',source:'@choice',target:'@migration'},
      {op:'upsertSide',mainId:'@migration',text:t('从哪个项目开始试点？','Which project should we pilot first?'),turn:9}
    ]},'ai');
    await writePreferences(service.store,{mode:'light',language});
    const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${app.url}/?projectId=${encodeURIComponent(project)}`);
    await page.locator('[data-main="m2"]').waitFor();
    await page.waitForTimeout(600);
    await page.locator('[data-main="m2"]').click();
    await page.locator('.sheet-head h2').filter({hasText:t('方案：','Choice:')}).waitFor();
    await page.locator('.side-card.key').waitFor();
    await page.locator('.main-canvas .zoom-tools button').last().click();
    await page.locator('.side-canvas .zoom-tools button').last().click();
    await page.mouse.move(20,20);
    await page.waitForTimeout(900);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    assert.equal(await page.locator('.brand img.logo').getAttribute('src'),'/logo.svg');
    assert.equal(await page.locator('.brand img.logo').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    assert.equal(await page.locator('[data-main]').count(),3);
    assert.equal(await page.locator('.side-card.rejected').count(),3);
    assert.deepEqual(errors,[]);
    const clipped=await page.locator('.side-canvas').evaluate(canvas=>{
      const bounds=canvas.getBoundingClientRect();
      return [...canvas.querySelectorAll('[data-side]')].filter(node=>{const r=node.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1||r.top<bounds.top-1||r.bottom>bounds.bottom+1;}).map(n=>n.textContent);
    });
    assert.deepEqual(clipped,[],'the full derivation must fit in the screenshot');
    const filename=path.join(out,`reasoncontour-light.${language}.png`);
    await page.screenshot({path:filename});
    console.log(JSON.stringify({screenshot:path.relative(PROJECT_ROOT,filename),language,theme:'light',mainNodes:3,clipped}));
    await page.close();
  }
} finally {
  await browser.close();
  await app?.close();
  if(!directory.startsWith(base+path.sep))throw new Error('Unexpected demo directory.');
  await fs.rm(directory,{recursive:true,force:true});
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Service } from '../service.mjs';
import { Store, PROJECT_ROOT } from '../storage.mjs';
import { callTool, TOOLS } from '../tools.mjs';
import { boundedResult, recordingGuide, writeExample, recordingGuideVersion } from '../agent-context.mjs';
async function setup(t) {
  const base = path.join(PROJECT_ROOT, '.test-data');
  await fs.mkdir(base, {
    recursive: true
  });
  const dir = await fs.mkdtemp(path.join(base, 'protocol-'));
  t.after(() => fs.rm(dir, {
    recursive: true,
    force: true
  }));
  return new Service({
    store: new Store(dir),
    boundProjectId: 'reasoncontour'
  }).init();
}
function run(s, file, input, args = [], sessionId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'app', file), ...args], {
      env: {
        ...process.env,
        REASONCONTOUR_DATA_DIR: s.store.directory,
        REASONCONTOUR_PROJECT_ID: 'reasoncontour',
        ...(sessionId ? {
          REASONCONTOUR_SESSION_ID: sessionId
        } : {})
      },
      windowsHide: true
    });
    let out = '',
      err = '';
    child.stdout.on('data', x => out += x);
    child.stderr.on('data', x => err += x);
    child.on('error', reject);
    child.on('close', code => code ? reject(new Error(err || out)) : resolve(out));
    child.stdin.end(input);
  });
}
test('guide includes all events and constraints once, example fits 1500 characters', async t => {
  assert.ok(recordingGuide.length + JSON.stringify(writeExample).length <= 1500);
  for (const word of ['不写', 'rejected', 'revised', 'convergeMain', 'refreshMain', 'deleteMain', 'alignedBy', 'proposeRevision', '不重排']) assert.ok(recordingGuide.includes(word));
  const s = await setup(t),
    start = await callTool(s, 'rc_session');
  assert.equal(start.guideVersion, recordingGuideVersion);
  assert.equal(s.boundSessionId, start.session.id);
  assert.equal((await callTool(s, 'rc_read')).guideUpdate, undefined);
  await s.store.update(d => {
    d.sessions[start.session.id].guideVersion = 'old';
  });
  const before = (await s.state()).project;
  assert.ok((await callTool(s, 'rc_read')).guideUpdate);
  assert.equal((await callTool(s, 'rc_read')).guideUpdate, undefined);
  assert.deepEqual((await s.state()).project.main, before.main);
  assert.equal((await s.state()).project.revision, before.revision);
});
test('bound writes use one batch, default reads contain all main titles and only frontier derivations', async t => {
  const s = await setup(t);
  await callTool(s, 'rc_session');
  const write = await callTool(s, 'rc_write', {
    operations: [{
      op: 'upsertMain',
      id: '@a',
      title: 'A',
      body: 'Large detail'
    }, {
      op: 'upsertSide',
      mainId: '@a',
      text: 'Earlier reasoning'
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
      mainId: '@b',
      text: 'Current question',
      sources: [{
        id: 'quote',
        quote: 'Do not repeat'
      }]
    }]
  });
  assert.ok(JSON.stringify(write).length < 300);
  assert.equal(write.frontier[0].id, 'm2');
  const read = await callTool(s, 'rc_read');
  assert.equal(read.main.length, 2);
  assert.deepEqual(Object.keys(read.main[0]), ['id', 'title', 'state']);
  assert.deepEqual(Object.keys(read.side), ['m2']);
  assert.ok(!JSON.stringify(read).includes('Large detail'));
  assert.ok(!JSON.stringify(read).includes('Do not repeat'));
  assert.equal((await callTool(s, 'rc_read', {
    scope: 'side',
    mainId: 'm1'
  })).side.nodes[0].text, 'Earlier reasoning');
  assert.equal((await callTool(s, 'rc_read', {
    scope: 'body',
    nodeIds: ['m1']
  })).body, 'Large detail');
  assert.equal((await callTool(s, 'rc_read', {
    scope: 'source',
    nodeIds: ['s2'],
    sourceId: 'quote'
  })).quote, 'Do not repeat');
});
test('changes contain only changed nodes/edges; unknown legacy fields and cross-project sessions rejected', async t => {
  const s = await setup(t);
  await callTool(s, 'rc_session');
  await callTool(s, 'rc_write', {
    operations: [{
      op: 'upsertMain',
      id: '@m',
      title: 'A'
    }, {
      op: 'upsertSide',
      id: '@q',
      mainId: '@m',
      text: 'Root'
    }]
  });
  await callTool(s, 'rc_write', {
    operations: [{
      op: 'upsertSide',
      mainId: 'm1',
      parentId: 's1',
      text: 'New option'
    }]
  });
  const d = await callTool(s, 'rc_read', {
    scope: 'changes',
    sinceRevision: 1
  });
  assert.equal(d.events[0].side.m1.nodes.upserted.length, 1);
  assert.equal(d.events[0].side.m1.nodes.upserted[0].text, 'New option');
  assert.equal(d.events[0].nodes.upserted.length, 0);
  for (const args of [{
    expectedAuthorityVersion: 0,
    operations: []
  }, {
    operations: [{
      op: 'upsertNode',
      title: 'Old'
    }]
  }, {
    operations: [{
      op: 'upsertMain',
      title: 'X',
      unexpected: true
    }]
  }]) await assert.rejects(() => callTool(s, 'rc_write', args));
  const other = await s.create('Other');
  await assert.rejects(() => callTool(s, 'rc_read', {
    projectId: other.id
  }), {
    code: 'project_scope'
  });
  await assert.rejects(() => callTool(s, 'rc_read', {
    sessionId: 'other'
  }), {
    code: 'session_scope'
  });
});
test('long bodies, quotes and Markdown export page without losing characters', () => {
  const body = '材料\n"'.repeat(20000);
  for (const [name, args, value, key] of [['rc_read', {
    scope: 'body'
  }, {
    revision: 1,
    nodes: [{
      id: 'm1',
      title: 'A',
      body
    }]
  }, 'body'], ['rc_read', {
    scope: 'source'
  }, {
    revision: 1,
    source: {
      id: 'q',
      quote: body
    }
  }, 'quote'], ['rc_material', {}, {
    revision: 1,
    markdown: body
  }, 'markdown']]) {
    let textOffset = 0,
      whole = '';
    do {
      const r = boundedResult(name, {
        ...args,
        textOffset,
        maxChars: 1500
      }, value);
      assert.ok(JSON.stringify(r).length <= 1500);
      whole += r[key];
      textOffset = r.nextTextOffset;
    } while (textOffset !== null);
    assert.equal(whole, body);
  }
});
test('MCP session binding survives subsequent calls; CLI uses short stdin commands and env session', async t => {
  const s = await setup(t);
  const requests = [{
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize'
  }, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list'
  }, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'rc_session',
      arguments: {}
    }
  }, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'rc_write',
      arguments: {
        operations: [{
          op: 'upsertMain',
          title: 'MCP bound'
        }]
      }
    }
  }];
  const messages = (await run(s, 'mcp.mjs', requests.map(JSON.stringify).join('\n') + '\n')).trim().split('\n').map(JSON.parse);
  assert.equal(messages[1].result.tools.length, 5);
  assert.equal(messages[3].result.isError, undefined);
  const start = JSON.parse(messages[2].result.content[0].text);
  const result = JSON.parse(await run(s, 'cli.mjs', JSON.stringify({
    operations: [{
      op: 'upsertSide',
      mainId: 'm1',
      text: 'CLI append'
    }]
  }), ['write'], start.session.id));
  assert.equal(result.revision, 2);
  const read = JSON.parse(await run(s, 'cli.mjs', '{}', ['read'], start.session.id));
  assert.equal(read.side.m1.nodes[0].text, 'CLI append');
  assert.ok(TOOLS.every(t => t.description.length < 100));
});

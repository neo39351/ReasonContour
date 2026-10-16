import { promises as fs } from 'node:fs';
import { Service } from './service.mjs';
import { Store } from './storage.mjs';
import { parseOptions } from './connection.mjs';
import { TOOLS, callTool } from './tools.mjs';
try {
  const {
    args,
    projectId,
    directory,
    sessionId
  } = parseOptions(process.argv.slice(2));
  const [command = 'help', name, file] = args;
  if (command === 'help' || command === 'tools') process.stdout.write(JSON.stringify({
    usage: 'rc session | read | write | material; JSON from stdin. Bind --project/--session or REASONCONTOUR_PROJECT_ID/REASONCONTOUR_SESSION_ID once. MCP preferred.',
    tools: name ? TOOLS.filter(t => t.name === name) : TOOLS.map(({
      name,
      description
    }) => ({
      name,
      description
    }))
  }) + '\n');else {
    const tool = command === 'call' ? name : {
      session: 'rc_session',
      read: 'rc_read',
      write: 'rc_write',
      material: 'rc_material',
      projects: 'rc_projects'
    }[command];
    if (!tool) throw new Error('Unknown command');
    let raw = '';
    if (command === 'call' && file) raw = await fs.readFile(file, 'utf8');else {
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 5000000) throw new Error('Input too large');
      }
    }
    const service = await new Service({
      store: new Store(directory),
      boundProjectId: projectId,
      boundSessionId: sessionId
    }).init();
    process.stdout.write(JSON.stringify(await callTool(service, tool, raw.trim() ? JSON.parse(raw.replace(/^\uFEFF/, '')) : {})) + '\n');
  }
} catch (error) {
  process.stdout.write(JSON.stringify({
    error: error.message,
    code: error.code || 'invalid_input'
  }) + '\n');
  process.exitCode = 1;
}

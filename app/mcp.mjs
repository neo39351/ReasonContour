import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from './service.mjs';
import { Store } from './storage.mjs';
import { parseOptions } from './connection.mjs';
import { TOOLS, callTool } from './tools.mjs';
export async function runMcp(service = new Service()) {
  await service.init(); let input = '', chain = Promise.resolve();
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk; if (Buffer.byteLength(input) > 5000000) { process.stderr.write('MCP input exceeded limit\n'); process.stdin.destroy(); return; }
    let end;
    while ((end = input.indexOf('\n')) !== -1) {
      const line = input.slice(0, end); input = input.slice(end + 1);
      if (!line.trim()) continue;
      chain = chain.then(async () => {
        let request; try { request = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); return; }
        if (request.id === undefined) return;
        const { method, params = {}, id } = request; let result;
        if (method === 'initialize') result = { protocolVersion: ['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'reasoncontour', version: '0.5.2' }, instructions: '用户启用后调用 rc_session，一次获取记录规则；随后按需增量写入，保护用户已对齐内容。' };
        else if (method === 'ping') result = {};
        else if (method === 'tools/list') result = { tools: TOOLS };
        else if (method === 'tools/call') {
          try { const value = await callTool(service, params.name, params.arguments); result = { content: [{ type: 'text', text: JSON.stringify(value) }] }; }
          catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }], structuredContent: { error: error.message, code: error.code || 'invalid_input' } }; }
        } else { send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }); return; }
        send({ jsonrpc: '2.0', id, result });
      }).catch(error => process.stderr.write(`${error.message}\n`));
    }
  });
  return new Promise(resolve => process.stdin.on('end', () => chain.then(resolve)));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const { projectId, directory, sessionId } = parseOptions(process.argv.slice(2)); await runMcp(new Service({ store: new Store(directory), boundProjectId: projectId, boundSessionId: sessionId })); }

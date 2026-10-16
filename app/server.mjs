import http from 'node:http';
import { promises as fs, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from './service.mjs';
import { PROJECT_ROOT, AppError } from './model.mjs';
const dist = path.join(PROJECT_ROOT, 'app/dist');
export async function startServer({ service = new Service(), port = Number(process.env.REASONCONTOUR_PORT || 0) } = {}) {
  await service.init(); const clients = new Set(); let debounce;
  const watcher = watch(service.store.directory, (_, name) => { if (name !== 'workspace.json') return; clearTimeout(debounce); debounce = setTimeout(() => { for (const client of clients) client.write('event: refresh\ndata: {}\n\n'); }, 60); });
  const server = http.createServer(async (request, response) => {
    const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); };
    try {
      const url = new URL(request.url, 'http://127.0.0.1'), host = request.headers.host, port = server.address().port;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) throw new AppError('请求来源无效。', 403);
      if (request.method === 'GET' && url.pathname === '/api/health') return json(200, { app: 'ReasonContour', version: '0.5.2' });
      if (request.method === 'GET' && url.pathname === '/api/state') return json(200, await service.state(url.searchParams.get('projectId') || 'reasoncontour'));
      if (request.method === 'GET' && url.pathname === '/api/events') {
        if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new AppError('请求来源无效。', 403);
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' }); response.write('event: ready\ndata: {}\n\n'); clients.add(response); request.on('close', () => clients.delete(response)); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/action') {
        if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new AppError('不接受其他网页的写入请求。', 403);
        if (!request.headers['content-type']?.startsWith('application/json')) throw new AppError('需要 JSON 请求。', 415);
        let body = ''; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 4000000) throw new AppError('单次提交过大。', 413); }
        const input = JSON.parse(body); return json(200, await service.action(input.action, input.args));
      }
      if (request.method === 'GET') {
        const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname), filename = path.resolve(dist, '.' + relative);
        if (!filename.startsWith(dist + path.sep)) throw new AppError('无效路径。', 403);
        const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' }[path.extname(filename)];
        if (!type) return json(404, { error: '找不到文件。' });
        let content; try { content = await fs.readFile(filename); } catch (error) { if (error.code === 'ENOENT') return json(404, { error: '界面尚未构建，请运行 npm run build。' }); throw error; }
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'" }); response.end(content); return;
      }
      json(404, { error: '找不到这个地址。' });
    } catch (error) { if (!error.status) console.error(error.stack || error.message); json(error.status || 500, { error: error.status ? error.message : '服务未能完成操作。', code: error.code || 'server_error' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { service, server, url: `http://127.0.0.1:${server.address().port}`, async close() { watcher.close(); clearTimeout(debounce); for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startServer(); console.log(JSON.stringify({ app: 'ReasonContour', url: app.url, pid: process.pid }));
  const stop = async () => { await app.close(); process.exit(0); }; process.on('SIGINT', stop); process.on('SIGTERM', stop);
  process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { if (value.trim() === 'shutdown') stop(); });
}

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export class AppError extends Error {
  constructor(message, status = 400, code = 'invalid_input') { super(message); this.status = status; this.code = code; }
}
export function text(value, name, limit = 12000) {
  if (typeof value !== 'string' || value.length > limit) throw new AppError(`${name}格式或长度不正确。`);
  return value;
}
export function identifier(value, name = '标识') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(value)) throw new AppError(`${name}不正确。`);
  return value;
}
export const now = () => new Date().toISOString();
const empty = () => ({ version: 4, sequence: 0, projects: {}, sessions: {} });
async function json(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

// Every project is a self-contained document. A small recoverable journal protects
// initialization as well as project + workspace notification updates.
export class Store {
  constructor(directory = process.env.REASONCONTOUR_DATA_DIR || path.join(PROJECT_ROOT, 'projects')) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'workspace.json');
    this.lock = path.join(this.directory, 'workspace.lock');
    this.journal = path.join(this.directory, 'pending.json');
  }
  projectFile(id) { return path.join(this.directory, `p-${encodeURIComponent(identifier(id))}`, 'project.json'); }
  async acquire() {
    await fs.mkdir(this.directory, { recursive: true });
    const until = Date.now() + 10000;
    while (true) {
      try {
        const handle = await fs.open(this.lock, 'wx');
        const owner = { pid: process.pid, createdAt: Date.now(), token: randomUUID() };
        await handle.writeFile(JSON.stringify(owner));
        return async () => {
          await handle.close();
          for (let attempt = 0; attempt < 20; attempt++) {
            try {
              if (attempt && (await json(this.lock))?.token !== owner.token) return;
              await fs.unlink(this.lock); return;
            } catch (error) {
              if (error.code === 'ENOENT') return;
              if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt === 19) throw error;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
          }
        };
      } catch (error) {
        // Windows can report access denied while another process closes/deletes
        // the lock. Treat it as temporary contention, not a failed API request.
        if (['EPERM','EACCES','EBUSY'].includes(error.code)) {
          if (Date.now() > until) throw new AppError('数据正在写入，请稍后再试。', 409, 'write_busy');
          await new Promise(resolve => setTimeout(resolve, 20)); continue;
        }
        if (error.code !== 'EEXIST') throw error;
        try {
          const lock = await json(this.lock);
          if (lock && Date.now() - lock.createdAt > 30000) {
            try { process.kill(lock.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') await fs.unlink(this.lock).catch(() => {}); }
          }
        } catch { /* A concurrent process can still be creating the lock. */ }
        if (Date.now() > until) throw new AppError('数据正在写入，请稍后再试。', 409, 'write_busy');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
  }
  async atomic(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, 'wx');
      try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(temp, file); break; }
        catch (error) { if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt >= 7) throw error; await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1))); }
      }
    } finally { await fs.unlink(temp).catch(() => {}); }
  }
  async recover() {
    const pending = await json(this.journal);
    if (!pending) return;
    if (pending.version !== 4 || !Array.isArray(pending.bundles) || !pending.workspace) throw new AppError('存储恢复记录无效。', 500);
    for (const bundle of pending.bundles) await this.atomic(this.projectFile(bundle.project.id), bundle);
    await this.atomic(this.file, pending.workspace);
    await fs.unlink(this.journal);
  }
  async snapshot() {
    const metadata = await json(this.file), data = empty();
    if (metadata && metadata.version !== 4) throw new AppError('旧格式工作区无法打开；不会迁移，请由用户自行清理。', 400, 'unsupported_format');
    if (metadata) Object.assign(data, { sequence: metadata.sequence });
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('p-')) continue;
      const file = path.join(this.directory, entry.name, 'project.json'), bundle = await json(file);
      if (!bundle) continue;
      if (bundle.version !== 4 || !bundle.project?.main || !bundle.project?.side || !Array.isArray(bundle.sessions) || this.projectFile(bundle.project.id) !== file) throw new AppError('旧格式项目无法打开或目录名称不正确；不会迁移。', 400, 'unsupported_format');
      Object.defineProperty(data.projects, bundle.project.id, { value: bundle.project, enumerable: true, writable: true, configurable: true });
      for (const session of bundle.sessions) {
        if (session.projectId !== bundle.project.id || Object.hasOwn(data.sessions, session.id)) throw new AppError('项目会话归属不正确。', 500);
        identifier(session.id);
        Object.defineProperty(data.sessions, session.id, { value: session, enumerable: true, writable: true, configurable: true });
      }
    }
    if (!metadata && await json(path.join(this.directory, 'store.json'))) throw new AppError('旧格式项目无法打开；不会迁移。', 400, 'unsupported_format');
    return data;
  }
  bundle(data, id) { return { version: 4, project: data.projects[id], sessions: Object.values(data.sessions).filter(s => s.projectId === id) }; }
  async persist(before, data) {
    const bundles = Object.keys(data.projects).filter(id => JSON.stringify(this.bundle(before, id)) !== JSON.stringify(this.bundle(data, id))).map(id => this.bundle(data, id));
    const workspace = { version: 4, sequence: data.sequence };
    await this.atomic(this.journal, { version: 4, bundles, workspace });
    await this.recover();
  }
  async read() {
    const release = await this.acquire();
    try { await this.recover(); return await this.snapshot(); } finally { await release(); }
  }
  async update(mutator) {
    const release = await this.acquire();
    try {
      await this.recover(); const data = await this.snapshot(), before = structuredClone(data);
      const result = await mutator(data); data.sequence++;
      await this.persist(before, data); return structuredClone(result);
    } finally { await release(); }
  }
}

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError } from './storage.mjs';
export async function readPreferences(store) {
  try {
    const p = JSON.parse(await fs.readFile(path.join(store.directory, 'preferences.json'), 'utf8'));
    return {
      language: p.language || 'zh-CN',
      mode: p.mode || 'system'
    };
  } catch (e) {
    if (e.code === 'ENOENT') return {
      language: 'zh-CN',
      mode: 'system'
    };
    throw e;
  }
}
export async function writePreferences(store, changes) {
  const allowed = {
    language: ['en', 'zh-CN'],
    mode: ['system', 'light', 'dark']
  };
  for (const [k, v] of Object.entries(changes)) if (!allowed[k]?.includes(v)) throw new AppError('Invalid preference.');
  const release = await store.acquire();
  try {
    const result = {
      ...(await readPreferences(store)),
      ...changes
    };
    await store.atomic(path.join(store.directory, 'preferences.json'), result);
    return result;
  } finally {
    await release();
  }
}

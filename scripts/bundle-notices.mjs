// Copy full dependency license texts for the actual production dependency tree.
import { promises as fs } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const out = process.argv[2];
if (!out) throw new Error('Provide a license output directory.');
await fs.mkdir(out, { recursive: true });
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const seen = new Set(), notices = [];
async function collect(name, from) {
  let search = from, dir, dependency;
  while (true) {
    try {
      const candidateDir = path.join(search, 'node_modules', name);
      const candidate = JSON.parse(await fs.readFile(path.join(candidateDir, 'package.json'), 'utf8'));
      if (candidate.name === name) { dependency = candidate; dir = candidateDir; break; }
    } catch {}
    if (search === path.dirname(search)) break;
    search = path.dirname(search);
  }
  if (!dependency) throw new Error(`Package metadata not found: ${name}`);
  const key = `${name}@${dependency.version}`;
  if (seen.has(key)) return;
  seen.add(key);
  const files = (await fs.readdir(dir)).filter(file => /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(file));
  if (!files.length) throw new Error(`No license text found for ${key}`);
  const texts = [];
  for (const file of files) {
    if ((await fs.stat(path.join(dir, file))).isFile()) texts.push(`--- ${file} ---\n${await fs.readFile(path.join(dir, file), 'utf8')}`);
  }
  const filename = key.replace(/[@/]/g, '_') + '.txt';
  const source = `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${dependency.version}.tgz`;
  await fs.writeFile(path.join(out, filename), `${key}\nLicense: ${dependency.license || 'see texts'}\nSource: ${source}\n\n${texts.join('\n\n')}\n`);
  notices.push(`${key}: ${dependency.license || 'see license text'}`);
  for (const child of Object.keys(dependency.dependencies || {})) await collect(child, dir);
}
for (const name of Object.keys(pkg.dependencies)) await collect(name, root);
await fs.writeFile(path.join(out, 'DEPENDENCIES.txt'), notices.sort().join('\n') + '\n');
console.log(`Collected complete license texts for ${seen.size} production dependencies.`);

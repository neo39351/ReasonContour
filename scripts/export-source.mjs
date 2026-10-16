import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2] && path.resolve(process.argv[2]);
if (!destination || destination === root || destination.startsWith(root + path.sep)) throw new Error('Provide a new destination outside the source directory.');
const files = [
  'README.md', 'README.en.md', '.gitattributes', 'LICENSE', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md', '.gitignore', 'package.json', 'package-lock.json',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml', 'docs/RELEASE_NOTES.md',
  'desktop/build-installer.ps1', 'desktop/test-installer.ps1', 'desktop/installer.iss',
  'scripts/windows-build.mjs', 'scripts/bundle-notices.mjs',
  'docs/assets/reasoncontour-light.zh-CN.png', 'docs/assets/reasoncontour-light.en.png', 'scripts/capture-readme.mjs',
  'app/agent-context.mjs', 'app/preferences.mjs', 'app/storage.mjs', 'app/model.mjs', 'app/service.mjs', 'app/server.mjs', 'app/connection.mjs', 'app/cli.mjs', 'app/mcp.mjs', 'app/tools.mjs', 'app/vite.config.mjs',
  'app/ui/index.html', 'app/ui/main.jsx', 'app/ui/style.css', 'app/ui/shell.css', 'app/ui/graph-layout.mjs', 'app/ui/appearance.jsx', 'app/ui/theme.css', 'app/ui/public/logo.svg', 'app/ui/public/logo.ico', 'app/ui/public/logo.png', 'app/ui/i18n.jsx',
  'app/tests/live-updates.mjs', 'app/tests/drag-updates.mjs', 'app/tests/layout.test.mjs', 'app/tests/agent-context.test.mjs', 'app/tests/core.test.mjs', 'app/tests/storage.test.mjs', 'app/tests/appearance.mjs', 'app/tests/browser.mjs', 'app/tests/browser-runtime.mjs', 'app/tests/manual-browser.mjs', 'app/tests/manual.test.mjs', 'app/tests/replay.test.mjs', 'app/tests/fixtures/replay.mjs', 'app/tests/fixtures/replays.mjs',
  'desktop/ReasonContour.cs', 'desktop/build.ps1', 'desktop/app.manifest',
  'docs/design/TREE_MECHANISM_SPEC.md', 'docs/design/UI_UX_SPEC.md', 'docs/AI_USAGE.md', 'docs/ARCHITECTURE.md', 'docs/DEVELOPMENT.md', 'skills/reasoncontour/SKILL.md', 'scripts/build-icons.mjs', 'scripts/export-source.mjs'
];
const manifest = [];
// Validate the complete allowlist before creating a destination.
for (const name of files) {
  const stat = await fs.lstat(path.join(root, name));
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular public source file: ${name}`);
}
await fs.mkdir(destination); // Intentionally fails if anything already exists here.
for (const name of files) {
  const bytes = await fs.readFile(path.join(root, name));
  const output = path.join(destination, name);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, bytes, { flag: 'wx' });
  manifest.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await fs.writeFile(path.join(destination, 'SOURCE_MANIFEST.json'), JSON.stringify({ version: '0.5.2', files: manifest }, null, 2) + '\n');
console.log(JSON.stringify({ destination, files: manifest.length, bytes: manifest.reduce((sum, file) => sum + file.bytes, 0) }));

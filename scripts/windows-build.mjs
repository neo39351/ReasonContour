// Use Windows PowerShell's own module paths when launched from PowerShell 7/npm.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
if (process.platform !== 'win32') throw new Error('Windows desktop builds require Windows.');
const scripts = { host: 'build.ps1', installer: 'build-installer.ps1', 'test-installer': 'test-installer.ps1' };
const name = scripts[process.argv[2]];
if (!name) throw new Error('Choose host, installer or test-installer.');
const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'desktop', name), ...process.argv.slice(3)], {cwd:root,env,stdio:'inherit',windowsHide:true});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

import path from 'node:path';
import { PROJECT_ROOT, identifier } from './storage.mjs';
export function parseOptions(input) {
  const args = [],
    options = {};
  for (let i = 0; i < input.length; i++) {
    if (['--project', '--data-dir', '--session'].includes(input[i])) {
      const key = input[i],
        value = input[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      options[key === '--project' ? 'projectId' : key === '--session' ? 'sessionId' : 'directory'] = value;
    } else args.push(input[i]);
  }
  options.sessionId ??= process.env.REASONCONTOUR_SESSION_ID;
  if (options.sessionId) identifier(options.sessionId);
  options.projectId ??= process.env.REASONCONTOUR_PROJECT_ID;
  if (options.projectId) identifier(options.projectId);
  return {
    args,
    ...options
  };
}
function command(args) {
  const quote = value => process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
  return `${process.platform === 'win32' ? '& ' : ''}${args.map(quote).join(' ')}`;
}
export function connectionInfo(project, directory) {
  const scope = ['--project', project.id, '--data-dir', directory];
  const cli = [process.execPath, path.join(PROJECT_ROOT, 'app', 'cli.mjs'), ...scope];
  const mcp = {
    command: process.execPath,
    args: [path.join(PROJECT_ROOT, 'app', 'mcp.mjs'), ...scope]
  };
  return {
    cliTools: command([...cli, 'session']),
    mcpConfig: JSON.stringify({
      mcpServers: {
        reasoncontour: mcp
      }
    }, null, 2),
    prompt: `Use ReasonContour project “${project.name}” for this discussion, automatically organizing key reasoning while following existing project instructions. Use its connected MCP tools if available; otherwise run the command below to start; its response contains the complete guide. Bind the returned session.id once using REASONCONTOUR_SESSION_ID; then use read/write with JSON stdin.\n\n${command([...cli, 'tools'])}`,
    promptZh: `本次讨论使用 ReasonContour 项目「${project.name}」，自动整理思路，遵循已有项目指令。已连接对应 MCP 就直接使用；否则运行下面的命令开始会话（返回全部规则）。将返回的 session.id 一次性绑定到环境变量 REASONCONTOUR_SESSION_ID，之后用 read/write 子命令从 stdin 读 JSON。\n\n${command([...cli, 'tools'])}`
  };
}

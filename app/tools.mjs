import { boundedResult } from './agent-context.mjs';
import { AppError } from './model.mjs';
const str = {
    type: 'string'
  },
  integer = {
    type: 'integer',
    minimum: 0
  },
  strings = {
    type: 'array',
    items: str
  };
const schema = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
});
const tool = (name, description, properties, required = [], readOnly = true) => ({
  name,
  description,
  inputSchema: schema(properties, required),
  annotations: {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly,
    openWorldHint: false
  }
});
const source = schema({
  id: str,
  label: str,
  kind: {
    enum: ['quote', 'document', 'node', 'note']
  },
  reference: str,
  quote: str,
  author: str
});
const operation = schema({
  op: {
    enum: ['upsertMain', 'refreshMain', 'convergeMain', 'deleteMain', 'linkMain', 'upsertSide', 'setSideState', 'setKey', 'proposeRevision']
  },
  id: str,
  mainId: str,
  parentId: {
    type: ['string', 'null']
  },
  keyId: {
    type: ['string', 'null']
  },
  replacementId: str,
  source: str,
  target: str,
  title: str,
  summary: str,
  body: str,
  text: str,
  note: str,
  reason: str,
  by: {
    enum: ['user', 'ai', 'aligned']
  },
  turn: integer,
  state: {
    enum: ['frontier', 'tentative', 'aligned', 'open', 'rejected', 'revised']
  },
  alignedBy: str,
  sources: {
    type: 'array',
    items: source
  }
}, ['op']);
export const TOOLS = [tool('rc_projects', '列出项目，或按用户要求创建项目。', {
  action: {
    enum: ['list', 'create']
  },
  name: str
}, [], false), tool('rc_session', '启用并绑定当前讨论，返回规则、写入示例和最小上下文。', {
  action: {
    enum: ['start', 'pause', 'resume', 'close']
  },
  projectId: str,
  sessionId: str,
  label: str,
  mode: {
    enum: ['auto', 'manual']
  }
}, [], false), tool('rc_read', '默认读主图标题状态和前沿副图，按 ID 读详情或按 revision 读差异。', {
  projectId: str,
  sessionId: str,
  scope: {
    enum: ['overview', 'side', 'body', 'nodes', 'sources', 'source', 'proposal', 'changes', 'search', 'edges']
  },
  mainId: str,
  nodeIds: strings,
  sourceId: str,
  sinceRevision: integer,
  query: str,
  textOffset: integer,
  maxChars: integer
}), tool('rc_write', '把本轮改动原子写入；修改或删除主图须 expectedRevision，追加副图无需版本。', {
  projectId: str,
  sessionId: str,
  expectedRevision: integer,
  operations: {
    type: 'array',
    items: operation,
    minItems: 1,
    maxItems: 300
  }
}, ['operations'], false), tool('rc_material', '按主图逻辑顺序导出结论及正文。', {
  projectId: str,
  includeSources: {
    type: 'boolean'
  },
  language: {
    enum: ['en', 'zh-CN']
  },
  textOffset: integer,
  maxChars: integer
})];
function validate(value, definition, path = '参数') {
  if (definition.enum && !definition.enum.includes(value)) throw new AppError(`${path}无效。`);
  if (definition.type) {
    const types = [definition.type].flat();
    const valid = types.some(type => type === 'null' ? value === null : type === 'integer' ? Number.isInteger(value) : type === 'array' ? Array.isArray(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === type);
    if (!valid) throw new AppError(`${path}类型无效。`);
  }
  if (definition.minimum !== undefined && value < definition.minimum) throw new AppError(`${path}超出范围。`);
  if (definition.type === 'object') {
    for (const key of definition.required || []) if (value[key] === undefined) throw new AppError(`缺少 ${path}.${key}。`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(definition.properties, key)) throw new AppError(`未知参数 ${path}.${key}。`);
      validate(value[key], definition.properties[key], `${path}.${key}`);
    }
  }
  if (definition.type === 'array') {
    if (value.length < (definition.minItems ?? 0) || value.length > (definition.maxItems ?? Infinity)) throw new AppError(`${path}数量无效。`);
    value.forEach((v, i) => validate(v, definition.items, `${path}[${i}]`));
  }
}
export async function callTool(service, name, args = {}) {
  const def = TOOLS.find(t => t.name === name);
  if (!def) throw new AppError('工具不存在。', 404);
  validate(args, def.inputSchema);
  args = {
    ...args
  };
  if (service.boundSessionId) {
    if (args.sessionId && args.sessionId !== service.boundSessionId) throw new AppError('此入口绑定其他会话。', 403, 'session_scope');
    args.sessionId = service.boundSessionId;
  }
  if (service.boundProjectId) {
    const bound = service.boundProjectId;
    if (args.projectId && args.projectId !== bound) throw new AppError('此入口绑定其他项目。', 403, 'project_scope');
    if (args.sessionId) {
      const s = (await service.store.read()).sessions[args.sessionId];
      if (!s || s.projectId !== bound) throw new AppError('会话不属于此入口项目。', 403, 'project_scope');
    }
    args.projectId = bound;
    if (name === 'rc_projects') {
      if (args.action === 'create') throw new AppError('请在界面创建项目。', 403, 'project_scope');
      return {
        projects: (await service.list()).projects.filter(p => p.id === bound)
      };
    }
  }
  if (name === 'rc_projects') return args.action === 'create' ? service.create(args.name) : service.list();
  if (name === 'rc_session') {
    const result = await service.session(args);
    if ((args.action || 'start') === 'start') service.boundSessionId = result.session.id;
    return result;
  }
  if (name === 'rc_read') return boundedResult(name, args, await service.read(args));
  if (name === 'rc_write') return service.transact(args, 'ai');
  if (name === 'rc_material') return boundedResult(name, args, await service.material(args));
}

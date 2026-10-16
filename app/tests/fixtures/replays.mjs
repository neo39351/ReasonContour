// Public test scenarios: a fictional team workspace and a generic cloud migration.
const main = (id, title, turn, extra = {}) => ({
  op: 'upsertMain',
  id,
  title,
  turn,
  ...extra
});
const side = (id, mainId, parentId, text, turn, extra = {}) => ({
  op: 'upsertSide',
  id,
  mainId,
  parentId,
  text,
  turn,
  ...extra
});
const state = (id, mainId, state, extra = {}) => ({
  op: 'setSideState',
  id,
  mainId,
  state,
  ...extra
});
const refresh = (id, title, turn, extra = {}) => ({
  op: 'refreshMain',
  id,
  title,
  turn,
  ...extra
});
export const cloudTurns = [{
  turn: 1,
  operations: [main('@a', '进行中：服务器总宕机，要不要迁云？', 1, {
    by: 'user'
  })]
}, {
  turn: 2,
  operations: [side('@a1', '@a', null, '宕机原因是什么？', 2), side('@a2', '@a', '@a1', '硬件老化', 2), side('@a3', '@a', '@a1', '机房网络', 2), side('@a4', '@a', '@a1', '半夜出事没人管', 2)]
}, {
  turn: 3,
  operations: [state('@a2', '@a', 'rejected', {
    note: '硬件没坏过'
  }), state('@a3', '@a', 'rejected', {
    note: '网络正常'
  }), state('@a4', '@a', 'aligned', {
    alignedBy: '都是半夜出事没人管，第二天才发现。'
  })]
}, {
  turn: 4,
  operations: [side('@a5', '@a', '@a4', '问题不是迁不迁云，而是没人运维', 4, {
    state: 'revised',
    note: '等你确认'
  }), {
    op: 'setKey',
    mainId: '@a',
    keyId: '@a5'
  }]
}, {
  turn: 5,
  revision: true,
  operations: [main('@diagnosis', '服务器宕机：没有人运维', 5), {
    op: 'deleteMain',
    id: '@a',
    replacementId: '@diagnosis'
  }, state('@a1', '@diagnosis', 'aligned', {
    alignedBy: '对，问题是运维。'
  }), state('@a5', '@diagnosis', 'aligned', {
    alignedBy: '对，问题是运维。'
  }), {
    op: 'convergeMain',
    id: '@diagnosis',
    alignedBy: '对，问题是运维。'
  }]
}, {
  turn: 6,
  operations: [main('@b', '进行中：怎么解决没人运维', 6), {
    op: 'linkMain',
    source: '@diagnosis',
    target: '@b'
  }, side('@b1', '@b', null, '怎么解决没人运维？', 6), side('@b2', '@b', '@b1', '招一个运维', 6), side('@b3', '@b', '@b1', '外包运维', 6), side('@b4', '@b', '@b1', '迁到托管云', 6)]
}, {
  turn: 7,
  revision: true,
  operations: [state('@b2', '@b', 'rejected', {
    note: '太贵'
  }), state('@b3', '@b', 'rejected', {
    note: '上次合作差'
  }), state('@b4', '@b', 'aligned', {
    alignedBy: '迁云吧。'
  }), {
    op: 'setKey',
    mainId: '@b',
    keyId: '@b4'
  }, refresh('@b', '进行中：怎么解决没人运维', 7, {
    summary: '迁云（暂定）'
  })]
}, {
  turn: 8,
  operations: [side('@b5', '@b', '@b4', '全部迁，还是只迁一半？', 8), side('@b6', '@b', '@b5', '只迁业务服务器', 8), side('@b7', '@b', '@b5', '全部迁走', 8)]
}, {
  turn: 9,
  revision: true,
  operations: [state('@b1', '@b', 'aligned', {
    alignedBy: '都迁，留一半等于还要有人管。'
  }), state('@b5', '@b', 'aligned', {
    alignedBy: '都迁，留一半等于还要有人管。'
  }), state('@b6', '@b', 'rejected', {
    note: '留一半还得有人管'
  }), state('@b7', '@b', 'aligned', {
    alignedBy: '都迁，留一半等于还要有人管。'
  }), refresh('@b', '解决方案：全部迁到托管云', 9, {
    state: 'tentative',
    summary: '全部迁云（暂定）'
  })]
}, {
  turn: 10,
  operations: [side('@b8', '@b', '@b7', '费用会涨多少？', 10), side('@b11', '@b', '@b7', '数据库怎么迁？', 10)]
}, {
  turn: 11,
  operations: [side('@b9', '@b', '@b8', '加上限：不超过 1.5 倍', 11, {
    by: 'user',
    state: 'revised'
  }), side('@b10', '@b', '@b8', '按量付费约 1.3 倍', 11, {
    note: 'AI 估算，未获用户明确认可'
  })]
}, {
  turn: 12,
  revision: true,
  operations: [side('@b12', '@b', '@b11', '一次性停机迁移（停一天）', 12), refresh('@b', '解决方案：全部迁云，停机一天迁数据库', 12, {
    summary: '停机一天迁移（暂定）',
    reason: '补充迁移方式'
  })]
}, {
  turn: 13,
  revision: true,
  operations: [state('@b12', '@b', 'rejected', {
    note: '业务不能停一天'
  }), side('@b13', '@b', '@b11', '主从同步，追平后切换', 13, {
    note: '只停几分钟，多测一周'
  }), {
    op: 'setKey',
    mainId: '@b',
    keyId: '@b13'
  }, refresh('@b', '解决方案：迁云，先做主从同步，追平后再切换', 13, {
    summary: '只停几分钟，多测一周（暂定）',
    reason: '业务不能停一天',
    by: 'user'
  })]
}, {
  turn: 14,
  revision: true,
  operations: [side('@b14', '@b', '@b13', '我们的数据库版本能用吗？', 14, {
    by: 'user',
    note: '待确认'
  }), refresh('@b', '解决方案：迁云，先做主从同步，追平后再切换', 14, {
    state: 'tentative',
    summary: '同步方案的数据库版本兼容性待确认',
    reason: '还有一项待确认',
    by: 'user'
  })]
}];
export const workspaceTurns = [{
  turn: 1,
  operations: [main('@direction', '进行中：怎样组织团队工作台？', 1, {
    by: 'user'
  }), side('@scope', '@direction', null, '先列清团队任务，再确定导航', 1), side('@flows', '@direction', '@scope', '资料收集和成员协作有交接，界面应覆盖完整流程', 1, {
    by: 'user'
  })]
}, {
  turn: 2,
  operations: []
}, {
  turn: 3,
  revision: true,
  operations: [state('@scope', '@direction', 'aligned', {
    alignedBy: '先梳理团队收集与协作流程，以及交接点'
  }), {
    op: 'convergeMain',
    id: '@direction',
    title: '方向：先梳理团队工作台 需要支持的任务，再设计导航',
    turn: 3,
    alignedBy: '先梳理团队收集与协作流程，以及交接点，确认覆盖范围后再画界面。'
  }]
}, {
  turn: 4,
  operations: []
}, {
  turn: 5,
  operations: []
}, {
  turn: 6,
  operations: []
}, {
  turn: 7,
  operations: []
}, {
  turn: 8,
  actor: 'user',
  revision: true,
  operations: [refresh('@direction', '方向：先梳理团队工作台（覆盖两阶段）需要支持的任务，再设计导航', 8, {
    reason: '范围调整为收集与协作两阶段',
    alignedBy: '范围应当包含收集与协作两个阶段，请一起整理。',
    by: 'user'
  })]
}, {
  turn: 9,
  operations: []
}, {
  turn: 10,
  operations: [main('@diagnosis', '进行中：为什么团队仍然找不到入口？', 10), {
    op: 'linkMain',
    source: '@direction',
    target: '@diagnosis'
  }, side('@cause', '@diagnosis', null, '每个库被直接做成一个页面，没有按团队任务组织', 10)]
}, {
  turn: 11,
  revision: true,
  operations: [state('@cause', '@diagnosis', 'aligned', {
    alignedBy: '同意，先解决入口与任务不匹配的问题。'
  }), {
    op: 'convergeMain',
    id: '@diagnosis',
    title: '诊断：每个库被直接做成一个页面，缺少任务入口',
    turn: 11,
    alignedBy: '同意，先解决入口与任务不匹配的问题。'
  }]
}, {
  turn: 12,
  operations: [main('@organization', '进行中：团队工作台应有哪些分区？', 12), {
    op: 'linkMain',
    source: '@diagnosis',
    target: '@organization'
  }, side('@organize', '@organization', null, '怎样分区，原有便签放在哪里？', 12), side('@split', '@organization', '@organize', '拆成收集、协作、归档三个模块', 12)]
}, {
  turn: 13,
  operations: [side('@unify', '@organization', '@organize', '统一的项目、资料、活动管理入口', 13)]
}, {
  turn: 14,
  operations: []
}, {
  turn: 15,
  revision: true,
  operations: [state('@split', '@organization', 'rejected', {
    note: '没有依据团队任务验证'
  }), state('@unify', '@organization', 'rejected', {
    note: '过度设计：团队无需新增管理层'
  }), side('@correction', '@organization', '@organize', '过度设计：先使用现有任务清单', 15, {
    by: 'user',
    state: 'revised'
  }), {
    op: 'setKey',
    mainId: '@organization',
    keyId: '@correction'
  }, refresh('@organization', '进行中：按现有任务重新整理分区', 15, {
    by: 'user',
    reason: '用户要求缩减设计范围'
  })]
},
// The invented continuation checks that an AI suggestion remains unapproved
// while the user redirects the discussion to task boundaries.
{
  turn: 16,
  operations: [side('@six', '@organization', '@organize', '六个功能区：收件箱、资料、项目、日历、协作、设置', 16), side('@keep', '@organization', '@six', '便签 保留在资料区', 16)]
}, {
  turn: 17,
  operations: []
}, {
  turn: 18,
  operations: []
}, {
  turn: 19,
  revision: true,
  operations: [side('@boundary', '@organization', '@organize', '先讲清收集、检索、归档的边界和重叠，保留现有资料访问能力', 19, {
    state: 'revised',
    by: 'user'
  }), {
    op: 'setKey',
    mainId: '@organization',
    keyId: '@boundary'
  }, refresh('@organization', '进行中：先讲清收集、检索、归档的边界和重叠，保留现有资料访问能力；之后再定 便签 去留和整体组织', 19, {
    summary: '六个功能区，便签 留在资料区（AI，未认可）',
    by: 'user',
    reason: '先确认收集与检索的职责边界'
  })]
}];

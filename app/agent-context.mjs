export const recordingGuideVersion = 'main-side-2';
export const recordingGuide = `每轮最多一次批量写入；解释、换说法、讨论 RC 本身→不写。
新问题/选项/理由→追加前沿副图；用户否定→setSideState rejected+note；用户纠正→追加 revised 并 refreshMain。
用户明确认可→对应副图 aligned，convergeMain；主、副图 aligned 均必须带用户原话 alignedBy，AI 推断保持 open（主图用 frontier/tentative）。
收敛后在结论上继续→新主图前沿+linkMain；补充已有结论→refreshMain；取代旧结论→deleteMain replacementId，保留旧推导及入口。
AI 不得修改/删除 aligned 或用户手改的主图，不得改用户锁定结构；使用 proposeRevision 等待用户处理。规则更新只影响后续写入，不重排已有图。
一句话节点；body 仅用户要求时写；副图只追加不重写。追加 upsertSide/setSideState/setKey 无须读取或版本号；修改/删除主图须 expectedRevision。新 ID 服务端分配，@临时名可在同批引用。会话在入口绑定，不必每次传。
默认读取主图标题/状态和前沿副图；其他副图 scope:side+mainId，正文 scope:body+nodeIds，来源 scope:sources/source，增量 scope:changes+sinceRevision。`;
export const writeExample = {
  operations: [{
    op: 'upsertMain',
    id: '@m',
    title: '进行中：如何迁移',
    turn: 1
  }, {
    op: 'upsertSide',
    mainId: '@m',
    id: '@q',
    text: '是否可以停机？',
    turn: 1
  }]
};
export function briefSide(side) {
  return {
    entries: side.entries.map(e => ({
      mainId: e.mainId,
      deleted: e.deleted,
      snapshot: {
        title: e.snapshot.title,
        state: e.snapshot.state
      },
      ...(e.derivation ? {
        derivation: briefSide(e.derivation)
      } : {})
    })),
    keyId: side.keyId,
    nodes: side.nodes.map(({
      id,
      parentId,
      text,
      by,
      turn,
      state,
      note
    }) => ({
      id,
      parentId,
      text,
      by,
      turn,
      state,
      ...(note ? {
        note
      } : {})
    }))
  };
}
export function boundedResult(name, args, value) {
  const budget = Math.max(1000, Math.min(24000, args.maxChars || 6000)),
    offset = args.textOffset || 0;
  const slice = (content, key, base) => {
    const size = Math.max(1, Math.floor((budget - JSON.stringify(base).length - 200) / 6)),
      part = content.slice(offset, offset + size);
    return {
      ...base,
      [key]: part,
      totalCharacters: content.length,
      nextTextOffset: offset + part.length < content.length ? offset + part.length : null
    };
  };
  if (name === 'rc_material') return slice(value.markdown, 'markdown', {
    revision: value.revision
  });
  if (name === 'rc_read' && args.scope === 'body') {
    if (value.nodes.length !== 1) throw new Error('正文请按单个节点 ID 读取。');
    const n = value.nodes[0];
    return slice(n.body || '', 'body', {
      revision: value.revision,
      id: n.id,
      title: n.title.slice(0, 200)
    });
  }
  if (name === 'rc_read' && args.scope === 'source') {
    const {
      quote,
      ...source
    } = value.source;
    return slice(quote || '', 'quote', {
      revision: value.revision,
      source: {
        ...source,
        reference: source.reference?.slice(0, 300)
      }
    });
  }
  return value;
}

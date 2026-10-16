import { callTool } from '../../tools.mjs';
export async function replay(service, turns, {
  stopAt = turns.length,
  onTurn
} = {}) {
  const ids = {},
    stats = [],
    states = [];
  let revision = 0;
  const startInput = {
      action: 'start'
    },
    start = await callTool(service, 'rc_session', startInput);
  let startup = JSON.stringify({
    name: 'rc_session',
    arguments: startInput
  }).length + JSON.stringify(start).length;
  for (const row of turns.slice(0, stopAt)) {
    const operations = row.operations.map(op => Object.fromEntries(Object.entries(op).map(([key, value]) => [key, typeof value === 'string' && value.startsWith('@') && ids[value] ? ids[value] : value])));
    let inputChars = 0,
      outputChars = 0;
    if (operations.length) {
      const input = {
        operations,
        ...(row.revision ? {
          expectedRevision: revision
        } : {})
      };
      let result;
      if (row.actor === 'user') {
        // A user-directed edit is replayed as a user action, not an AI bypass or fabricated review click.
        const args = {
          projectId: service.boundProjectId,
          expectedRevision: revision,
          operations
        };
        inputChars = JSON.stringify({
          action: 'mutate',
          args
        }).length;
        result = await service.transact(args, 'user');
      } else {
        inputChars = JSON.stringify({
          name: 'rc_write',
          arguments: input
        }).length;
        result = await callTool(service, 'rc_write', input);
      }
      outputChars = JSON.stringify(result).length;
      Object.assign(ids, result.ids || {});
      revision = result.revision;
    }
    if (row.turn === 1) {
      inputChars += JSON.stringify({
        name: 'rc_session',
        arguments: startInput
      }).length;
      outputChars += startup - JSON.stringify({
        name: 'rc_session',
        arguments: startInput
      }).length;
    }
    stats.push({
      turn: row.turn,
      inputChars,
      outputChars,
      total: inputChars + outputChars,
      writes: operations.length ? 1 : 0
    });
    const state = (await service.state(service.boundProjectId)).project;
    states.push(state);
    await onTurn?.(row, state);
  }
  return {
    stats,
    states,
    ids,
    total: stats.reduce((sum, r) => sum + r.total, 0),
    average: stats.reduce((sum, r) => sum + r.total, 0) / stats.length
  };
}

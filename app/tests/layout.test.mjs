import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph, sideGraph } from '../ui/graph-layout.mjs';
test('main graph is vertical, fork/join cards do not overlap and all segments are orthogonal', async () => {
  const nodes = ['a', 'b', 'c', 'd'].map(id => ({
      id,
      width: 280,
      height: 116
    })),
    edges = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']].map(([source, target], i) => ({
      id: `e${i}`,
      source,
      target
    })),
    g = await layoutGraph(nodes, edges);
  for (const e of g.edges) {
    assert.ok(g.nodes.find(n => n.id === e.source).position.y < g.nodes.find(n => n.id === e.target).position.y);
    for (let i = 1; i < e.points.length; i++) assert.ok(e.points[i].x === e.points[i - 1].x || e.points[i].y === e.points[i - 1].y);
  }
  for (const a of g.nodes) for (const b of g.nodes) if (a !== b) assert.ok(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y);
});
test('retired derivation precedes conclusion junction, receiver question follows it', () => {
  const side = {
      entries: [{
        mainId: 'm1',
        deleted: true,
        snapshot: {
          title: 'Prior'
        },
        derivation: {
          entries: [],
          keyId: null,
          nodes: [{
            id: 's1',
            text: 'Question',
            parentId: null,
            state: 'open'
          }, {
            id: 's2',
            text: 'Rejected',
            parentId: 's1',
            state: 'rejected'
          }, {
            id: 's3',
            text: 'Accepted',
            parentId: 's1',
            state: 'aligned'
          }]
        }
      }],
      keyId: 's4',
      nodes: [{
        id: 's4',
        parentId: null,
        text: 'Next',
        state: 'open'
      }]
    },
    g = sideGraph(side, {
      id: 'm2',
      title: 'Next conclusion'
    }),
    entry = g.nodes.find(n => n.data.deleted);
  assert.ok(g.edges.some(e => e.source === 's3' && e.target === entry.id));
  assert.ok(g.edges.some(e => e.source === entry.id && e.target === 's4'));
  assert.ok(!g.edges.some(e => e.source === 's2' && e.target === entry.id));
  assert.equal(g.nodes.find(n => n.id === 's4').data.key, true);
});

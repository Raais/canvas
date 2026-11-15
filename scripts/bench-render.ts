import { createEdgeProjection, createNodeProjection } from '../src/components/flow-projection';
import { addNodes, createEmptyBoard, createTextNode } from '../src/domain/board';
import { connectNodes } from '../src/domain/graph';
import { relaxBoard } from '../src/domain/physics';
import type { Board, BoardNode } from '../src/domain/types';

const now = '2026-11-15T00:00:00.000Z';

for (const count of [100, 500, 1000]) {
  const board = sample(count);
  const projection = createNodeProjection();
  const edges = createEdgeProjection();
  const input = {
    selected: new Set<string>(),
    editingId: null,
    readOnly: false,
    unlocked: new Map<string, { text: string }>(),
    registry: null,
    library: new Map(),
  };
  const cold = median(() => {
    const fresh = createNodeProjection();
    const projected = fresh.project(board.nodes, input);
    JSON.stringify(projected);
  });
  projection.project(board.nodes, input);
  const changed = board.nodes.map((node, index) => index === 0 && node.kind === 'text' ? { ...node, text: 'changed' } : node);
  const warm = median(() => {
    projection.project(changed, input);
  });
  const edgeCold = median(() => {
    const fresh = createEdgeProjection();
    const projected = fresh.project(board.edges, new Set([board.edges[0]?.id ?? '']));
    JSON.stringify(projected);
  });
  edges.project(board.edges, new Set());
  const edgeWarm = median(() => {
    edges.project(board.edges, new Set());
  });
  const physics = median(() => {
    relaxBoard(board, ['n0'], 8);
  });
  console.log(`${count} nodes  projection cold+json ${cold.toFixed(3)} ms  warm ${warm.toFixed(3)} ms  edges cold+json ${edgeCold.toFixed(3)} ms  warm ${edgeWarm.toFixed(3)} ms  physics ${physics.toFixed(3)} ms`);
}

function median(run: () => void): number {
  const samples: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  return samples[3] ?? 0;
}

function sample(count: number): Board {
  const nodes: BoardNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const node = createTextNode({ x: (index % 40) * 280, y: Math.floor(index / 40) * 180 }, `note ${index}`, now);
    node.id = `n${index}`;
    nodes.push(node);
  }
  let board = addNodes(createEmptyBoard(now), nodes, now);
  for (let index = 0; index < count - 1; index += 7) {
    const joined = connectNodes(board, `n${index}`, `n${index + 1}`, 'right', 'left', now);
    if (joined) board = joined;
  }
  return board;
}

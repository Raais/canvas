import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildArchive } from '../src/archive/zip';
import { addNodes, createEmbeddedImageNode, createEmptyBoard, createFileNode, createTextNode } from '../src/domain/board';
import { connectNodes } from '../src/domain/graph';
import { groupSelection } from '../src/domain/groups';
import { SYNTHETIC_PNG } from '../src/project/synthetic-png';
import type { AssetRecord, BoardNode } from '../src/domain/types';

const count = Number(process.argv[2] ?? '100');
const output = process.argv[3];
if (!output || ![100, 500, 1000].includes(count)) {
  console.log('Usage: bun scripts/make-perf-board.ts <100|500|1000> <output.canvas.zip>');
  console.log('Import the zip into a disposable board. It is not written to IndexedDB by this script.');
  process.exit(output ? 1 : 0);
}

const now = '2026-11-15T00:00:00.000Z';
const nodes: BoardNode[] = [];
const assets: AssetRecord[] = [];
for (let index = 0; index < count; index += 1) {
  const column = index % 40;
  const row = Math.floor(index / 40);
  const distant = index % 17 === 0;
  const center = { x: distant ? 8000 + column * 40 : column * 280, y: distant ? -6000 - row * 30 : row * 200 };
  const kind = index % 11;
  if (kind === 0) {
    const image = createEmbeddedImageNode({ center, assetId: `img-${index}`, intrinsicWidth: 1, intrinsicHeight: 1, now });
    image.id = `node-${index}`;
    nodes.push(image);
    assets.push(asset(`img-${index}`, 'image/png'));
  } else if (kind === 1) {
    const file = createFileNode({ center, assetId: `file-${index}`, filename: `notes-${index}.pdf`, now });
    file.id = `node-${index}`;
    nodes.push(file);
    assets.push(asset(`file-${index}`, 'application/pdf'));
  } else if (kind === 2) {
    nodes.push(text(`node-${index}`, center, `# Note ${index}\n\n- [ ] item`, 'markdown'));
  } else if (kind === 3) {
    nodes.push(text(`node-${index}`, center, `export const value${index} = ${index};\n`, 'code'));
  } else {
    nodes.push(text(`node-${index}`, center, `Plain note ${index}`, 'text'));
  }
}
let board = addNodes(createEmptyBoard(now), nodes, now);
board = { ...board, title: `Performance ${count}` };
for (let index = 0; index < count - 1; index += 9) {
  const joined = connectNodes(board, `node-${index}`, `node-${index + 1}`, 'right', 'left', now);
  if (!joined) continue;
  const edge = joined.edges[joined.edges.length - 1];
  if (!edge) continue;
  board = {
    ...joined,
    edges: joined.edges.map((entry) => entry.id === edge.id ? { ...entry, label: index % 18 === 0 ? 'long' : undefined, style: index % 18 === 0 ? 'red-string' : 'solid' } : entry),
  };
}
const groupedIds = ['node-2', 'node-3', 'node-4'].filter((id) => board.nodes.some((node) => node.id === id));
const framed = groupSelection(board, groupedIds, now);
board = 'error' in framed ? board : framed.board;

const bytes = await buildArchive(board, assets, now);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, bytes);
console.log(`Wrote ${count} nodes to ${output} (${bytes.byteLength} bytes).`);

function text(id: string, center: { x: number; y: number }, body: string, presentation: 'text' | 'markdown' | 'code'): BoardNode {
  const node = createTextNode(center, body, now, presentation === 'text' ? undefined : { presentation, ...(presentation === 'code' ? { codeLanguage: 'typescript' } : {}) });
  node.id = id;
  return node;
}

function asset(id: string, mimeType: string): AssetRecord {
  const bytes = mimeType === 'image/png' ? SYNTHETIC_PNG : Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return { id, mimeType, byteSize: copy.byteLength, createdAt: now, blob: new Blob([copy]) };
}

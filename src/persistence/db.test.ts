import { describe, expect, test } from 'bun:test';
import { createEmbeddedImageNode, createEmptyBoard } from '../domain/board';
import type { AssetRecord } from '../domain/types';
import { planAssetWrite } from './db';

describe('asset writes', () => {
  test('drops unreferenced uploads and keeps a shared asset', () => {
    const image = createEmbeddedImageNode({
      center: { x: 0, y: 0 },
      assetId: 'keep',
      intrinsicWidth: 20,
      intrinsicHeight: 20,
    });
    const board = {
      ...createEmptyBoard('2026-11-13T00:00:00.000Z'),
      nodes: [image],
    };
    const keep: AssetRecord = {
      id: 'keep',
      mimeType: 'image/png',
      byteSize: 1,
      createdAt: '2026-11-13T00:00:00.000Z',
      blob: new Blob(['a']),
    };
    const orphan: AssetRecord = { ...keep, id: 'orphan', blob: new Blob(['b']) };
    const plan = planAssetWrite(board, [keep, orphan], ['keep', 'gone']);
    expect(plan.upserts.map((asset) => asset.id)).toEqual(['keep']);
    expect(plan.deleteIds).toEqual(['gone']);
  });
});

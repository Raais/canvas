import { describe, expect, test } from 'bun:test';

declare const Bun: {
  file(path: URL): { text(): Promise<string> };
};
import { HANDLE_SIDES, handleAnchorTransform, visualHandleTransform } from '../editor/handles';
import { toggleImageFlip, addNodes, createEmptyBoard } from '../domain/board';
import type { ImageNode } from '../domain/types';

const now = '2026-11-14T13:00:00.000Z';

describe('connection handle geometry', () => {
  test('keeps zoom scale off the measured anchor', () => {
    for (const side of HANDLE_SIDES) {
      const anchor = handleAnchorTransform(side);
      expect(anchor.includes('scale(')).toBe(false);
      expect(visualHandleTransform().includes('scale(var(--handle-scale, 1))')).toBe(true);
    }
    expect(handleAnchorTransform('right') === handleAnchorTransform('bottom')).toBe(false);
    expect(HANDLE_SIDES).toEqual(['top', 'right', 'bottom', 'left']);
  });
});

describe('flip controls', () => {
  test('horizontal and vertical toggles stay on their own axes', () => {
    const image: ImageNode = {
      id: 'pic',
      kind: 'image',
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      mode: 'aspect',
      intrinsicWidth: 40,
      intrinsicHeight: 20,
      sizedFromImage: true,
      source: { type: 'embedded', assetId: 'a' },
    };
    const board = addNodes(createEmptyBoard(now), [image], now);
    const horizontal = toggleImageFlip(board, 'pic', 'x', now);
    const node = horizontal.nodes[0];
    expect(node?.kind === 'image' && node.flipX).toBe(true);
    expect(node?.kind === 'image' ? node.flipY : false).toBe(undefined);
    const vertical = toggleImageFlip(board, 'pic', 'y', now);
    const down = vertical.nodes[0];
    expect(down?.kind === 'image' && down.flipY).toBe(true);
    expect(down?.kind === 'image' ? down.flipX : false).toBe(undefined);
  });
});

describe('control styles', () => {
  test('styles the current chrome and rails instead of the removed toolbar wrapper', async () => {
    const css = await Bun.file(new URL('../styles/app.css', import.meta.url)).text();
    expect(css.includes('.chrome button')).toBe(true);
    expect(css.includes('.rail button')).toBe(true);
    expect(css.includes('appearance: none')).toBe(true);
    expect(css.includes('--radius-control: 9999px')).toBe(true);
    expect(css.includes('.toolbar button')).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';
import { canonicalCanvasAddress } from './address';

describe('canvas address', () => {
  test('drops only the trailing slash on the site root', () => {
    expect(canonicalCanvasAddress('/canvas/')).toBe('/canvas');
    expect(canonicalCanvasAddress('/canvas/', '?board=1', '#notes')).toBe('/canvas?board=1#notes');
    expect(canonicalCanvasAddress('/canvas')).toBeNull();
    expect(canonicalCanvasAddress('/canvas/index.html')).toBeNull();
    expect(canonicalCanvasAddress('/')).toBeNull();
  });
});

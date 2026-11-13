import { describe, expect, test } from 'bun:test';
import { contentSignature, decodeDataImage, interpretClipboard } from './clipboard';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('clipboard precedence', () => {
  test('prefers image bytes over html and text', () => {
    const result = interpretClipboard({
      imageKeys: [{ key: 'shot', mimeType: 'image/png' }],
      html: '<p>Hello</p><img src="https://example.com/a.png">',
      plainText: 'Hello',
    });
    expect(result.actions).toEqual([{ type: 'file-image', fileKey: 'shot' }]);
  });

  test('dedupes repeated representations of one file', () => {
    const result = interpretClipboard({
      imageKeys: [
        { key: 'shot', mimeType: 'image/png' },
        { key: 'shot', mimeType: 'image/png' },
        { key: 'other', mimeType: 'image/jpeg' },
      ],
      html: null,
      plainText: null,
    });
    expect(result.actions).toHaveLength(2);
  });

  test('uses a standalone html image url', () => {
    const result = interpretClipboard({
      imageKeys: [],
      html: '<img alt="pic" src="https://images.example.com/photo?id=1&amp;size=large">',
      plainText: 'https://images.example.com/photo?id=1&size=large',
    });
    expect(result.actions).toEqual([
      { type: 'external-image', url: 'https://images.example.com/photo?id=1&size=large' },
    ]);
  });

  test('decodes a standalone data image', () => {
    const result = interpretClipboard({
      imageKeys: [],
      html: `<img src="${PNG}">`,
      plainText: null,
    });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.type).toBe('bytes-image');
  });

  test('keeps mixed html as plain text', () => {
    const result = interpretClipboard({
      imageKeys: [],
      html: '<p>Plan the scene</p><img src="https://example.com/a.png">',
      plainText: 'Plan the scene',
    });
    expect(result.actions).toEqual([{ type: 'text', text: 'Plan the scene' }]);
  });

  test('treats a bare image url as an image and other urls as text', () => {
    expect(
      interpretClipboard({ imageKeys: [], html: null, plainText: 'https://example.com/a.png?x=1' }).actions,
    ).toEqual([{ type: 'external-image', url: 'https://example.com/a.png?x=1' }]);
    expect(
      interpretClipboard({ imageKeys: [], html: null, plainText: 'https://example.com/notes' }).actions,
    ).toEqual([{ type: 'text', text: 'https://example.com/notes' }]);
  });

  test('rejects unsafe and unsupported image sources', () => {
    const script = interpretClipboard({
      imageKeys: [],
      html: '<img src="javascript:alert(1)">',
      plainText: null,
    });
    expect(script.actions).toEqual([]);
    expect(script.warnings.length).toBeGreaterThan(0);

    const svg = decodeDataImage('data:image/svg+xml;base64,PHN2Zy8+');
    expect('error' in svg ? svg.error : '').toBe('SVG images are not supported.');
  });

  test('signatures change with the bytes', () => {
    const left = contentSignature('image/png', new Uint8Array([1, 2, 3]));
    const right = contentSignature('image/png', new Uint8Array([1, 2, 4]));
    expect(left === right).toBe(false);
  });
});

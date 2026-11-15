import { Inflate } from 'fflate';

export function inflateBounded(data: Uint8Array, limit: number): Uint8Array | 'overflow' | 'corrupt' {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  const stream = new Inflate((chunk) => {
    if (overflow) return;
    total += chunk.byteLength;
    if (total > limit) {
      overflow = true;
      return;
    }
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    chunks.push(copy);
  });
  try {
    stream.push(data, true);
  } catch {
    return overflow ? 'overflow' : 'corrupt';
  }
  if (overflow) return 'overflow';
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

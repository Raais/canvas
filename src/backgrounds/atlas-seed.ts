export function seedFromProjectName(title: string): number {
  const normalized = title.normalize('NFC').trim() || 'Untitled board';
  const bytes = new TextEncoder().encode(normalized);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function seedVectors(seed: number): { a: [number, number]; b: [number, number]; c: [number, number] } {
  const mix = (value: number) => {
    let next = Math.imul(value ^ seed, 0x45d9f3b) >>> 0;
    next = Math.imul(next ^ (next >>> 16), 0x45d9f3b) >>> 0;
    return next / 4294967295;
  };
  return {
    a: [mix(1) * 80, mix(2) * 80],
    b: [mix(3) * 80, mix(4) * 80],
    c: [mix(5) * 80, mix(6) * 80],
  };
}

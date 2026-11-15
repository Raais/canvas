import type { Board, BoardNode, ProtectedTextPayload, TextNode } from './types';

export const TEXT_KDF = { iterations: 3, memoryKiB: 32_768, parallelism: 1 } as const;
export const PROTECTION_AAD = 'canvas-protected-text-v1';

const LIMITS = {
  minIterations: 1,
  maxIterations: 5,
  minMemoryKiB: 8_192,
  maxMemoryKiB: 65_536,
  parallelism: 1,
  saltBytes: 16,
  nonceBytes: 24,
  minCipherBytes: 16,
  maxCipherBytes: 1_500_000,
};

export function isProtectedTextNode(node: BoardNode): node is TextNode & { protection: ProtectedTextPayload } {
  return node.kind === 'text' && node.protection != null;
}

export function passwordIsUsable(password: string): boolean {
  return password.length > 0 && password.trim().length > 0 && password.length <= 1024;
}

export function parseProtectedPayload(value: unknown): ProtectedTextPayload | undefined | null {
  if (value == null) return undefined;
  if (!isRecord(value)) return null;
  if (value.version !== 1 || value.cipher !== 'xchacha20poly1305' || value.kdf !== 'argon2id') return null;
  if (!isBoundedInt(value.iterations, LIMITS.minIterations, LIMITS.maxIterations)) return null;
  if (!isBoundedInt(value.memoryKiB, LIMITS.minMemoryKiB, LIMITS.maxMemoryKiB)) return null;
  if (value.parallelism !== LIMITS.parallelism) return null;
  const salt = decodeBase64(value.salt);
  const nonce = decodeBase64(value.nonce);
  const ciphertext = decodeBase64(value.ciphertext);
  if (!salt || salt.length !== LIMITS.saltBytes) return null;
  if (!nonce || nonce.length !== LIMITS.nonceBytes) return null;
  if (!ciphertext || ciphertext.length < LIMITS.minCipherBytes || ciphertext.length > LIMITS.maxCipherBytes) return null;
  return {
    version: 1,
    cipher: 'xchacha20poly1305',
    kdf: 'argon2id',
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
    iterations: value.iterations,
    memoryKiB: value.memoryKiB,
    parallelism: 1,
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function decodeBase64(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_000_000) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (bytesToBase64(bytes) !== value) return null;
    return bytes;
  } catch {
    return null;
  }
}

export function preferProtectedBoard(captured: Board, live: Board): Board {
  if (captured === live) return captured;
  for (const node of live.nodes) {
    if (!isProtectedTextNode(node)) continue;
    const previous = captured.nodes.find((entry) => entry.id === node.id);
    if (!previous || previous.kind !== 'text' || previous.text.length > 0 || !previous.protection) return live;
  }
  return captured;
}

export function forgetRemovedSessions<T>(sessions: Map<string, T>, liveIds: ReadonlySet<string>): boolean {
  let removed = false;
  for (const id of [...sessions.keys()]) {
    if (liveIds.has(id)) continue;
    sessions.delete(id);
    removed = true;
  }
  return removed;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function isBoundedInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

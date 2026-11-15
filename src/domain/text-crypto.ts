import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { argon2id } from 'hash-wasm';
import {
  PROTECTION_AAD,
  TEXT_KDF,
  bytesToBase64,
  decodeBase64,
  parseProtectedPayload,
  randomBytes,
} from './text-protection';
import type { ProtectedTextPayload } from './types';

export type KdfParams = { iterations: number; memoryKiB: number; parallelism: number };

const aad = () => utf8ToBytes(PROTECTION_AAD);

export async function protectPlaintext(text: string, password: string, kdf: KdfParams = TEXT_KDF): Promise<ProtectedTextPayload> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, kdf);
  return seal(text, key, salt, kdf);
}

export async function openProtected(
  payload: ProtectedTextPayload,
  password: string,
): Promise<{ text: string; key: Uint8Array } | null> {
  const parsed = parseProtectedPayload(payload);
  if (!parsed) return null;
  try {
    const salt = decodeBase64(parsed.salt);
    if (!salt) return null;
    const key = await deriveKey(password, salt, parsed);
    return { text: unseal(parsed, key), key };
  } catch {
    return null;
  }
}

export function reseal(payload: ProtectedTextPayload, key: Uint8Array, text: string): ProtectedTextPayload {
  const salt = decodeBase64(payload.salt);
  if (!salt || key.length !== 32) throw new Error('The protected note could not be saved.');
  return seal(text, key, salt, payload);
}

export async function deriveKey(password: string, salt: Uint8Array, kdf: KdfParams): Promise<Uint8Array> {
  const key = await argon2id({
    password,
    salt,
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memoryKiB,
    hashLength: 32,
    outputType: 'binary',
  });
  return key;
}

function seal(text: string, key: Uint8Array, salt: Uint8Array, kdf: KdfParams): ProtectedTextPayload {
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce, aad()).encrypt(utf8ToBytes(text));
  const payload = {
    version: 1 as const,
    cipher: 'xchacha20poly1305' as const,
    kdf: 'argon2id' as const,
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
    iterations: kdf.iterations,
    memoryKiB: kdf.memoryKiB,
    parallelism: kdf.parallelism,
  };
  const parsed = parseProtectedPayload(payload);
  if (!parsed) throw new Error('The protected note could not be saved.');
  return parsed;
}

function unseal(payload: ProtectedTextPayload, key: Uint8Array): string {
  const nonce = decodeBase64(payload.nonce);
  const ciphertext = decodeBase64(payload.ciphertext);
  if (!nonce || !ciphertext) throw new Error('damaged');
  const plain = xchacha20poly1305(key, nonce, aad()).decrypt(ciphertext);
  return bytesToUtf8(plain);
}

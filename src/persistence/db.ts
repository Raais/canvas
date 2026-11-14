import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { createEmptyBoard, parseBoard, referencedAssetIds } from '../domain/board';
import type { AssetRecord, Board } from '../domain/types';

export const DATABASE_NAME = 'raais-canvas-db';
export const DATABASE_VERSION = 1;
export const ACTIVE_BOARD_KEY = 'active';

interface CanvasDB extends DBSchema {
  board: {
    key: string;
    value: Board | AppPreferences;
  };
  assets: {
    key: string;
    value: AssetRecord;
  };
}

export type Appearance = 'dark' | 'light';

export type AppPreferences = {
  kind: 'preferences';
  appearance: Appearance;
};

export const PREFERENCES_KEY = 'preferences';

export function parseAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object') return 'dark';
  const record = value as Partial<AppPreferences>;
  return record.kind === 'preferences' && (record.appearance === 'dark' || record.appearance === 'light') ? record.appearance : 'dark';
}

function isPreferences(value: Board | AppPreferences | undefined): value is AppPreferences {
  return Boolean(value && 'kind' in value && value.kind === 'preferences');
}

function asBoard(value: Board | AppPreferences | undefined): Board | undefined {
  if (!value || isPreferences(value)) return undefined;
  return value;
}

export type CanvasDatabase = IDBPDatabase<CanvasDB>;

export function createAssetRecord(blob: Blob, mimeType: string, now = new Date().toISOString()): AssetRecord {
  return {
    id: crypto.randomUUID(),
    mimeType,
    byteSize: blob.size,
    createdAt: now,
    blob,
  };
}

export async function openDatabase(): Promise<CanvasDatabase> {
  return openDB<CanvasDB>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('board')) database.createObjectStore('board');
      if (!database.objectStoreNames.contains('assets')) {
        database.createObjectStore('assets', { keyPath: 'id' });
      }
    },
  });
}

export async function readSession(database: CanvasDatabase): Promise<{ board: Board; assets: AssetRecord[] } | null> {
  const stored = await database.get('board', ACTIVE_BOARD_KEY);
  const boardValue = asBoard(stored);
  if (!boardValue) return null;
  const board = parseBoard(boardValue);
  if (!board) throw new Error('The stored board could not be read. It was left unchanged.');
  const assets = await database.getAll('assets');
  return { board, assets };
}

export class RevisionConflictError extends Error {
  constructor() {
    super('Another tab changed the stored board. This tab kept the open edits and did not overwrite them.');
    this.name = 'RevisionConflictError';
  }
}

export type StoredExpectation = { id: string; revision: number };

export function storedRevisionConflicts(stored: Board | undefined, expected: StoredExpectation): boolean {
  if (!stored) return false;
  return stored.id !== expected.id || stored.revision !== expected.revision;
}

export async function writeBoardSnapshot(
  database: CanvasDatabase,
  board: Board,
  upserts: readonly AssetRecord[],
  deleteIds: readonly string[],
  expected?: StoredExpectation,
): Promise<void> {
  const transaction = database.transaction(['board', 'assets'], 'readwrite');
  const boardStore = transaction.objectStore('board');
  if (expected) {
    const current = asBoard(await boardStore.get(ACTIVE_BOARD_KEY));
    if (storedRevisionConflicts(current, expected)) {
      transaction.abort();
      throw new RevisionConflictError();
    }
  }
  const assets = transaction.objectStore('assets');
  for (const asset of upserts) assets.put(asset);
  for (const id of deleteIds) assets.delete(id);
  boardStore.put(board, ACTIVE_BOARD_KEY);
  await transaction.done;
}

export async function replaceStoredBoard(
  database: CanvasDatabase,
  board: Board,
  assets: readonly AssetRecord[],
  expected: StoredExpectation,
): Promise<void> {
  const transaction = database.transaction(['board', 'assets'], 'readwrite');
  const boardStore = transaction.objectStore('board');
  const assetStore = transaction.objectStore('assets');
  const current = asBoard(await boardStore.get(ACTIVE_BOARD_KEY));
  if (storedRevisionConflicts(current, expected)) {
    transaction.abort();
    throw new RevisionConflictError();
  }
  const keep = new Set(assets.map((asset) => asset.id));
  for (const key of await assetStore.getAllKeys()) {
    if (!keep.has(String(key))) assetStore.delete(key);
  }
  for (const asset of assets) assetStore.put(asset);
  boardStore.put(board, ACTIVE_BOARD_KEY);
  await transaction.done;
}

export async function readAppearance(database: CanvasDatabase): Promise<Appearance> {
  const stored = await database.get('board', PREFERENCES_KEY);
  return isPreferences(stored) ? stored.appearance : 'dark';
}

export async function writeAppearance(database: CanvasDatabase, appearance: Appearance): Promise<void> {
  const record: AppPreferences = { kind: 'preferences', appearance };
  await database.put('board', record, PREFERENCES_KEY);
}

export function planAssetWrite(
  board: Board,
  upserts: readonly AssetRecord[],
  deleteIds: readonly string[],
): { upserts: AssetRecord[]; deleteIds: string[] } {
  const referenced = referencedAssetIds(board);
  const kept = new Map<string, AssetRecord>();
  for (const asset of upserts) {
    if (referenced.has(asset.id)) kept.set(asset.id, asset);
  }
  return {
    upserts: [...kept.values()],
    deleteIds: [...new Set(deleteIds)].filter((id) => !referenced.has(id)),
  };
}

let opening: Promise<{ database: CanvasDatabase; board: Board; assets: AssetRecord[] }> | null = null;

export function openSession(): Promise<{ database: CanvasDatabase; board: Board; assets: AssetRecord[] }> {
  if (!opening) {
    opening = initialize().catch((error: unknown) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

async function initialize(): Promise<{ database: CanvasDatabase; board: Board; assets: AssetRecord[] }> {
  const database = await openDatabase();
  const existing = await readSession(database);
  if (existing) return { database, ...existing };
  const board = createEmptyBoard();
  await writeBoardSnapshot(database, board, [], []);
  return { database, board, assets: [] };
}

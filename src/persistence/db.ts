import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { createEmptyBoard, parseBoard, referencedAssetIds } from '../domain/board';
import type { AssetRecord, Board } from '../domain/types';

export const DATABASE_NAME = 'raais-canvas-db';
export const DATABASE_VERSION = 1;
export const ACTIVE_BOARD_KEY = 'active';

interface CanvasDB extends DBSchema {
  board: {
    key: string;
    value: Board;
  };
  assets: {
    key: string;
    value: AssetRecord;
  };
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
  if (!stored) return null;
  const board = parseBoard(stored);
  if (!board) throw new Error('The stored board could not be read. It was left unchanged.');
  const assets = await database.getAll('assets');
  return { board, assets };
}

export async function writeBoardSnapshot(
  database: CanvasDatabase,
  board: Board,
  upserts: readonly AssetRecord[],
  deleteIds: readonly string[],
): Promise<void> {
  const transaction = database.transaction(['board', 'assets'], 'readwrite');
  const assets = transaction.objectStore('assets');
  for (const asset of upserts) assets.put(asset);
  for (const id of deleteIds) assets.delete(id);
  transaction.objectStore('board').put(board, ACTIVE_BOARD_KEY);
  await transaction.done;
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

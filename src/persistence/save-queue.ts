import type { CanvasDatabase } from './db';
import { planAssetWrite, writeBoardSnapshot } from './db';
import type { AssetRecord, Board } from '../domain/types';

export type SaveStatus = 'saving' | 'saved' | 'unsaved' | 'error';

export class SaveQueue {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private dirty = false;
  private upserts = new Map<string, AssetRecord>();
  private deleteIds = new Set<string>();

  constructor(
    private readonly database: CanvasDatabase,
    private readonly getBoard: () => Board,
    private readonly onStatus: (status: SaveStatus, message?: string) => void,
  ) {}

  addAssets(assets: readonly AssetRecord[]): void {
    for (const asset of assets) {
      this.upserts.set(asset.id, asset);
      this.deleteIds.delete(asset.id);
    }
  }

  removeAssets(ids: readonly string[]): void {
    for (const id of ids) {
      this.upserts.delete(id);
      this.deleteIds.add(id);
    }
  }

  markUnsaved(): void {
    this.dirty = true;
    this.onStatus('unsaved');
  }

  schedule(delay = 500): void {
    this.markUnsaved();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  saveNow(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.markUnsaved();
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.dirty || this.upserts.size > 0 || this.deleteIds.size > 0) {
        this.dirty = false;
        const board = this.getBoard();
        const plan = planAssetWrite(board, [...this.upserts.values()], [...this.deleteIds]);
        this.upserts.clear();
        this.deleteIds.clear();
        this.onStatus('saving');
        try {
          await writeBoardSnapshot(this.database, board, plan.upserts, plan.deleteIds);
        } catch (error) {
          for (const asset of plan.upserts) this.upserts.set(asset.id, asset);
          for (const id of plan.deleteIds) this.deleteIds.add(id);
          this.dirty = true;
          throw error;
        }
      }
      this.onStatus('saved');
    } catch (error) {
      this.onStatus('error', errorMessage(error));
    } finally {
      this.writing = false;
    }
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'This browser refused to store more data for canvas.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Could not save the board.';
}

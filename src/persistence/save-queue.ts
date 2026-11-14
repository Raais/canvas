import type { CanvasDatabase } from './db';
import { planAssetWrite, RevisionConflictError, writeBoardSnapshot, type StoredExpectation } from './db';
import type { AssetRecord, Board } from '../domain/types';

export type SaveStatus = 'saving' | 'saved' | 'unsaved' | 'error';

export class SaveQueue {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private dirty = false;
  private suspended = false;
  private expected: StoredExpectation | null = null;
  private upserts = new Map<string, AssetRecord>();
  private deleteIds = new Set<string>();

  constructor(
    private readonly database: CanvasDatabase,
    private readonly getBoard: () => Board,
    private readonly onStatus: (status: SaveStatus, message?: string) => void,
    private readonly onPersisted?: (board: Board) => void,
  ) {}

  adopt(board: Board): void {
    this.expected = { id: board.id, revision: board.revision };
    this.suspended = false;
    this.discardPending();
  }

  expectation(): StoredExpectation {
    if (!this.expected) throw new Error('The board has no persisted revision yet.');
    return this.expected;
  }

  suspend(): void {
    this.suspended = true;
    this.discardPending();
  }

  resume(): void {
    this.suspended = false;
  }

  holdForReplacement(): { dirty: boolean; upserts: number; deletes: number } {
    this.suspended = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return { dirty: this.dirty, upserts: this.upserts.size, deletes: this.deleteIds.size };
  }

  abortReplacement(): void {
    this.suspended = false;
    if (this.dirty || this.upserts.size > 0 || this.deleteIds.size > 0) {
      this.onStatus('unsaved');
      this.schedule(500);
    }
  }

  pendingSummary(): { suspended: boolean; dirty: boolean; upserts: number; deletes: number } {
    return { suspended: this.suspended, dirty: this.dirty, upserts: this.upserts.size, deletes: this.deleteIds.size };
  }

  discardPending(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty = false;
    this.upserts.clear();
    this.deleteIds.clear();
  }

  async idle(): Promise<void> {
    while (this.writing) await new Promise((resolve) => setTimeout(resolve, 15));
  }

  addAssets(assets: readonly AssetRecord[]): void {
    if (this.suspended) return;
    for (const asset of assets) {
      this.upserts.set(asset.id, asset);
      this.deleteIds.delete(asset.id);
    }
  }

  removeAssets(ids: readonly string[]): void {
    if (this.suspended) return;
    for (const id of ids) {
      this.upserts.delete(id);
      this.deleteIds.add(id);
    }
  }

  markUnsaved(): void {
    if (this.suspended) return;
    this.dirty = true;
    this.onStatus('unsaved');
  }

  schedule(delay = 500): void {
    if (this.suspended) return;
    this.markUnsaved();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  saveNow(): void {
    if (this.suspended) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.markUnsaved();
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.writing || this.suspended || !this.expected) return;
    this.writing = true;
    try {
      while (!this.suspended && (this.dirty || this.upserts.size > 0 || this.deleteIds.size > 0)) {
        this.dirty = false;
        const board = this.getBoard();
        const plan = planAssetWrite(board, [...this.upserts.values()], [...this.deleteIds]);
        this.upserts.clear();
        this.deleteIds.clear();
        this.onStatus('saving');
        const expected = this.expected;
        try {
          await writeBoardSnapshot(this.database, board, plan.upserts, plan.deleteIds, expected);
          this.expected = { id: board.id, revision: board.revision };
          this.onPersisted?.(board);
        } catch (error) {
          if (error instanceof RevisionConflictError) {
            this.suspended = true;
            this.dirty = false;
            this.upserts.clear();
            this.deleteIds.clear();
            throw error;
          }
          for (const asset of plan.upserts) this.upserts.set(asset.id, asset);
          for (const id of plan.deleteIds) this.deleteIds.add(id);
          this.dirty = true;
          throw error;
        }
      }
      if (!this.suspended) this.onStatus('saved');
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
  if (error instanceof RevisionConflictError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Could not save the board.';
}

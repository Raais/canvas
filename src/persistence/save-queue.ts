import { preferProtectedBoard } from '../domain/text-protection';
import type { CanvasDatabase } from './db';
import { planAssetWrite, RevisionConflictError, writeBoardSnapshot, type StoredExpectation } from './db';
import type { AssetRecord, Board } from '../domain/types';

export type SaveStatus = 'saving' | 'saved' | 'unsaved' | 'error';

export class SaveQueue {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private dirty = false;
  private suspended = false;
  private recoverable: { board: Board; assets: AssetRecord[] } | null = null;
  private inflight: { board: Board; upserts: AssetRecord[]; deleteIds: string[] } | null = null;
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
    this.recoverable = null;
    this.inflight = null;
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

  pauseForConflict(): void {
    this.suspended = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const assets = new Map<string, AssetRecord>();
    for (const asset of this.inflight?.upserts ?? []) assets.set(asset.id, asset);
    for (const asset of this.upserts.values()) assets.set(asset.id, asset);
    const pending = this.dirty || assets.size > 0 || this.deleteIds.size > 0 || this.inflight !== null;
    if (pending) {
      this.recoverable = { board: structuredClone(this.getBoard()), assets: [...assets.values()] };
      this.onStatus('unsaved');
    }
  }

  recovery(): { board: Board; assets: AssetRecord[] } | null {
    return this.recoverable;
  }

  hasUnpersisted(): boolean {
    return this.dirty || this.upserts.size > 0 || this.deleteIds.size > 0 || this.recoverable !== null || this.inflight !== null;
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
        const board = preferProtectedBoard(this.getBoard(), this.getBoard());
        const plan = planAssetWrite(board, [...this.upserts.values()], [...this.deleteIds]);
        this.upserts.clear();
        this.deleteIds.clear();
        this.inflight = { board, upserts: plan.upserts, deleteIds: plan.deleteIds };
        this.onStatus('saving');
        const expected = this.expected;
        try {
          await writeBoardSnapshot(this.database, board, plan.upserts, plan.deleteIds, expected);
          this.inflight = null;
          this.expected = { id: board.id, revision: board.revision };
          const follow = this.getBoard();
          if (follow !== board && preferProtectedBoard(board, follow) === follow) this.dirty = true;
          this.onPersisted?.(board);
        } catch (error) {
          this.restoreUncommitted(plan);
          if (error instanceof RevisionConflictError) {
            this.pauseForConflict();
            throw error;
          }
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

  private restoreUncommitted(plan: { upserts: AssetRecord[]; deleteIds: string[] }): void {
    this.inflight = null;
    for (const asset of plan.upserts) {
      if (!this.upserts.has(asset.id)) this.upserts.set(asset.id, asset);
    }
    for (const id of plan.deleteIds) {
      if (!this.upserts.has(id)) this.deleteIds.add(id);
    }
    this.dirty = true;
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

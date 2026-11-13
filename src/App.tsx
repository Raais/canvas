import { useEffect, useState } from 'react';
import { BoardView } from './components/BoardView';
import { CanvasErrorBoundary } from './components/ErrorBoundary';
import { openSession } from './persistence/db';
import { errorMessage } from './persistence/save-queue';
import type { AssetRecord, Board } from './domain/types';
import type { CanvasDatabase } from './persistence/db';

type ReadySession = {
  database: CanvasDatabase;
  board: Board;
  assets: AssetRecord[];
};

export function App() {
  const [session, setSession] = useState<ReadySession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    openSession()
      .then((loaded) => {
        if (!cancelled) setSession(loaded);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <main className="storage-error">
        <h1>canvas cannot store this board</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!session) return <main className="boot">Loading canvas…</main>;

  return <CanvasErrorBoundary><BoardView session={session} /></CanvasErrorBoundary>;
}

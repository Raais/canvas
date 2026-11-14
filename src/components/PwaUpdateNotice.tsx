/// <reference types="vite-plugin-pwa/react" />
import { useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function PwaUpdateNotice({
  prepareUpdate,
}: {
  prepareUpdate: () => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const approved = useRef(false);
  const [detail, setDetail] = useState<string | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload() {
      if (approved.current) window.location.reload();
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (document.visibilityState === 'visible') void registration.update();
      };
      document.addEventListener('visibilitychange', check);
    },
    onRegisterError(error) {
      console.error(error);
    },
  });

  async function updateNow() {
    const result = await prepareUpdate();
    if (!result.ok) {
      setDetail(result.message);
      return;
    }
    approved.current = true;
    await updateServiceWorker(true);
  }

  return (
    <div className="pwa-stack">
      {needRefresh ? (
        <aside className="pwa-notice nodrag nopan" role="status" aria-label="Update available">
          <p><strong>Update available</strong> A new version of canvas is ready.</p>
          {detail ? <small>{detail}</small> : null}
          <div>
            <button type="button" onClick={() => void updateNow()}>Update now</button>
            <button type="button" onClick={() => { setNeedRefresh(false); setDetail(null); }}>Later</button>
          </div>
        </aside>
      ) : null}
      {offlineReady ? (
        <aside className="pwa-notice nodrag nopan" role="status" aria-label="Offline ready">
          <p>canvas is ready to use offline.</p>
          <div>
            <button type="button" onClick={() => setOfflineReady(false)}>Dismiss</button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const NodeClockContext = createContext<Date>(new Date());

export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 60_000);
    const onShow = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return now;
}

export function NodeClockProvider({ now, children }: { now: Date; children: ReactNode }) {
  return <NodeClockContext.Provider value={now}>{children}</NodeClockContext.Provider>;
}

export function useNodeClock(): Date {
  return useContext(NodeClockContext);
}

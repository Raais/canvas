const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function parseStoredTimestamp(value: unknown): string | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return null;
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) return null;
  return normalized;
}

export function formatNodeDate(iso: string | undefined, now: Date): { label: string; title: string } {
  if (!iso) return { label: '-', title: 'No date' };
  const stored = parseStoredTimestamp(iso);
  if (!stored) return { label: '-', title: 'No date' };
  const then = new Date(stored);
  const day = `${pad(then.getDate())}/${pad(then.getMonth() + 1)}`;
  const title = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(then);
  const elapsed = now.getTime() - then.getTime();
  if (elapsed < MINUTE) return { label: `just now | ${day}`, title };
  if (elapsed < HOUR) return { label: `${Math.floor(elapsed / MINUTE)}m ago | ${day}`, title };
  if (elapsed < DAY) return { label: `${Math.floor(elapsed / HOUR)}h ago | ${day}`, title };
  const days = Math.floor(elapsed / DAY);
  if (days < 7) return { label: `${days}d ago | ${day}`, title };
  if (days < 30) return { label: `${Math.floor(days / 7)}w ago | ${day}`, title };
  if (days < 365) return { label: `${Math.floor(days / 30)}mo ago | ${day}`, title };
  return { label: `${Math.floor(days / 365)}y ago | ${day}`, title };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

import { formatNodeDate } from '../domain/node-date';
import { useNodeClock } from './node-clock';

export function NodeDateLabel({ iso }: { iso?: string }) {
  const now = useNodeClock();
  const formatted = formatNodeDate(iso, now);
  if (!iso) return <span className="node-date" title={formatted.title}>{formatted.label}</span>;
  return <time className="node-date" dateTime={iso} title={formatted.title}>{formatted.label}</time>;
}

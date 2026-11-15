import { nodeDateLabelText, nodeDateTitle } from '../domain/image-size';
import { formatNodeDate } from '../domain/node-date';
import { useNodeClock } from './node-clock';

export function NodeDateLabel({ iso, byteSize }: { iso?: string; byteSize?: number }) {
  const now = useNodeClock();
  const formatted = formatNodeDate(iso, now);
  const label = nodeDateLabelText(formatted.label, byteSize);
  const title = nodeDateTitle(formatted.title, byteSize);
  if (!iso) return <span className="node-date" title={title}>{label}</span>;
  return <time className="node-date" dateTime={iso} title={title}>{label}</time>;
}

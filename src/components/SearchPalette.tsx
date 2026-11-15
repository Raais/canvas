import { File, Frame, Globe, Image, Mic, StickyNote } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SearchResult } from '../domain/search';
import { xrayQueryLabel } from '../domain/xray';

export function SearchPalette({
  query,
  results,
  notice,
  dateLabel,
  xray,
  showConnections,
  onQuery,
  onXray,
  onShowConnections,
  onJump,
  onClose,
}: {
  query: string;
  results: readonly SearchResult[];
  notice: string | null;
  dateLabel: string | null;
  xray: boolean;
  showConnections: boolean;
  onQuery: (query: string) => void;
  onXray: (enabled: boolean) => void;
  onShowConnections: (enabled: boolean) => void;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const selected = Math.min(active, Math.max(results.length - 1, 0));

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !option) return;
    const listRect = list.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    if (optionRect.top < listRect.top) list.scrollTop -= listRect.top - optionRect.top;
    else if (optionRect.bottom > listRect.bottom) list.scrollTop += optionRect.bottom - listRect.bottom;
  }, [selected, query, results]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  return (
    <div ref={rootRef} className="search-palette nodrag nopan" role="dialog" aria-label="Search">
      <input
        className="search-input"
        aria-label="Search notes, groups, and dates"
        aria-controls="search-results"
        placeholder="Search notes, groups, and dates"
        value={query}
        autoFocus
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && results[selected]) {
            event.preventDefault();
            event.stopPropagation();
            onJump(results[selected].id);
          }
        }}
      />
      <div className="xray-toggles" role="group" aria-label="X-ray search">
        <button type="button" aria-pressed={xray} onClick={() => onXray(!xray)}>X-ray</button>
        {xray ? (
          <button type="button" aria-pressed={showConnections} onClick={() => onShowConnections(!showConnections)}>Show connections</button>
        ) : null}
      </div>
      <div ref={listRef} id="search-results" role="listbox" aria-label="Search results">
        {notice ? <p className="search-empty">{notice}</p> : null}
        {query.trim() && !notice && results.length === 0 ? <p className="search-empty">No matches.</p> : null}
        {!query.trim() ? <p className="search-empty">Search notes, files, voice notes, websites, groups, and dates.</p> : null}
        {results.map((result, index) => {
          const showDate = result.section === 'date' && results[index - 1]?.section !== 'date';
          const showContent = result.section === 'content' && results.some((entry) => entry.section === 'date') && results[index - 1]?.section !== 'content';
          return (
            <div key={result.id}>
              {showDate ? <p className="search-section">Date matches · {dateLabel}</p> : null}
              {showContent ? <p className="search-section">Content matches</p> : null}
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                className={index === selected ? 'search-result is-active' : 'search-result'}
                onMouseEnter={() => setActive(index)}
                onClick={() => onJump(result.id)}
              >
                {result.kind === 'group' ? <Frame size={15} strokeWidth={1.75} /> : result.kind === 'image' ? <Image size={15} strokeWidth={1.75} /> : result.kind === 'file' ? <File size={15} strokeWidth={1.75} /> : result.kind === 'website' ? <Globe size={15} strokeWidth={1.75} /> : result.kind === 'voice' ? <Mic size={15} strokeWidth={1.75} /> : <StickyNote size={15} strokeWidth={1.75} />}
                <span>
                  <strong>{result.title}</strong>
                  {result.parentLabel ? <em>{result.parentLabel}</em> : null}
                  {result.snippet ? <small>{result.snippet}</small> : null}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function XrayStatusChip({
  query,
  count,
  onEdit,
  onExit,
}: {
  query: string;
  count: number;
  onEdit: () => void;
  onExit: () => void;
}) {
  const label = xrayQueryLabel(query);
  const matches = count === 1 ? '1 match' : `${count} matches`;
  return (
    <div className="xray-chip nodrag nopan" role="status" aria-live="polite">
      <span>X-ray</span>
      <span className="xray-query" title={query.trim()}>{label}</span>
      <span>{matches}</span>
      <button type="button" onClick={onEdit}>Edit search</button>
      <button type="button" onClick={onExit}>Exit X-ray</button>
    </div>
  );
}

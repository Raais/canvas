import { Frame, StickyNote } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../domain/search';

export function SearchPalette({
  query,
  results,
  onQuery,
  onJump,
  onClose,
}: {
  query: string;
  results: readonly SearchHit[];
  onQuery: (query: string) => void;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const selected = Math.min(active, Math.max(results.length - 1, 0));

  useEffect(() => {
    setActive(0);
  }, [query]);

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
        aria-label="Search notes and groups"
        aria-controls="search-results"
        placeholder="Search notes and groups"
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
      <div id="search-results" role="listbox" aria-label="Search results">
        {query.trim() && results.length === 0 ? <p className="search-empty">No matches.</p> : null}
        {!query.trim() ? <p className="search-empty">Search notes and groups.</p> : null}
        {results.map((result, index) => (
          <button
            key={result.id}
            type="button"
            role="option"
            aria-selected={index === selected}
            className={index === selected ? 'search-result is-active' : 'search-result'}
            onMouseEnter={() => setActive(index)}
            onClick={() => onJump(result.id)}
          >
            {result.kind === 'group' ? <Frame size={15} strokeWidth={1.75} /> : <StickyNote size={15} strokeWidth={1.75} />}
            <span>
              <strong>{result.title}</strong>
              {result.parentLabel ? <em>{result.parentLabel}</em> : null}
              {result.snippet ? <small>{result.snippet}</small> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

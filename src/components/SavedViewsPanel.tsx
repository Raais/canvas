import { Check, LocateFixed, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { nextViewName } from '../domain/saved-views';
import type { SavedView, Viewport } from '../domain/types';

export function SavedViewsPanel({
  views,
  readOnly,
  onClose,
  onSave,
  onRecall,
  onRename,
  onUpdate,
  onDelete,
}: {
  views: readonly SavedView[];
  readOnly: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  onRecall: (view: SavedView) => void;
  onRename: (id: string, name: string) => void;
  onUpdate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  function beginSave() {
    setNaming(true);
    setDraft(nextViewName(views));
  }

  function commitSave() {
    onSave(draft);
    setNaming(false);
  }

  return (
    <div ref={rootRef} className="views-panel nodrag nopan" role="dialog" aria-label="Saved views">
      <div className="views-head">
        <p>Views</p>
        <button type="button" className="icon-button" aria-label="Close saved views" title="Close" onClick={onClose}>
          <X size={15} strokeWidth={1.75} />
        </button>
      </div>
      {views.length === 0 && !naming ? <p className="search-empty">No saved views yet.</p> : null}
      {naming ? (
        <form
          className="view-name"
          onSubmit={(event) => {
            event.preventDefault();
            commitSave();
          }}
        >
          <input
            aria-label="View name"
            value={draft}
            maxLength={60}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setNaming(false);
              }
            }}
          />
          <button type="submit" className="icon-button" aria-label="Save current view" title="Save current view">
            <Check size={15} strokeWidth={1.75} />
          </button>
        </form>
      ) : (
        <button type="button" className="view-save" onClick={beginSave} disabled={readOnly || views.length >= 32}>
          Save current view
        </button>
      )}
      <ul className="views-list">
        {views.map((view) => (
          <li key={view.id}>
            {renaming === view.id ? (
              <form
                className="view-name"
                onSubmit={(event) => {
                  event.preventDefault();
                  onRename(view.id, renameDraft);
                  setRenaming(null);
                }}
              >
                <input
                  aria-label={`Rename ${view.name}`}
                  value={renameDraft}
                  maxLength={60}
                  autoFocus
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                />
              </form>
            ) : (
              <button type="button" className="view-jump" title={viewportLabel(view.viewport)} onClick={() => onRecall(view)}>
                {view.name}
              </button>
            )}
            <button type="button" className="icon-button" aria-label={`Go to ${view.name}`} title="Go to" onClick={() => onRecall(view)}>
              <LocateFixed size={14} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Rename ${view.name}`}
              title="Rename"
              disabled={readOnly}
              onClick={() => {
                setRenaming(view.id);
                setRenameDraft(view.name);
              }}
            >
              <Pencil size={14} strokeWidth={1.75} />
            </button>
            <button type="button" className="icon-button" aria-label={`Update ${view.name}`} title="Update to current camera" disabled={readOnly} onClick={() => onUpdate(view.id)}>
              <RefreshCw size={14} strokeWidth={1.75} />
            </button>
            <button type="button" className="icon-button" aria-label={`Delete ${view.name}`} title="Delete" disabled={readOnly} onClick={() => onDelete(view.id)}>
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function viewportLabel(viewport: Viewport): string {
  return `x ${Math.round(viewport.x)}, y ${Math.round(viewport.y)}, ${viewport.zoom.toFixed(2)}×`;
}

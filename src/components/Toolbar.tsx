import { useReactFlow } from '@xyflow/react';
import {
  Bookmark,
  Frame,
  Image as ImageIcon,
  Moon,
  MousePointer2,
  Redo2,
  StickyNote,
  Sun,
  Undo2,
  Ungroup,
  ZoomIn,
  ZoomOut,
  Group,
  Scan,
  Search,
} from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import type { Appearance } from '../persistence/db';
import type { SaveStatus } from '../persistence/save-queue';

const STATUS_LABEL: Record<SaveStatus, string> = {
  saving: 'Saving',
  saved: 'Saved',
  unsaved: 'Unsaved',
  error: 'Save failed',
};

type ToolbarProps = {
  title: string;
  status: SaveStatus;
  tool: 'select' | 'frame';
  appearance: Appearance;
  canGroup: boolean;
  canUngroup: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTitle: (title: string) => void;
  onNewNote: () => void;
  onAddImages: (files: FileList) => void;
  onViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  onTool: (tool: 'select' | 'frame') => void;
  onGroup: () => void;
  onUngroup: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAppearance: () => void;
  onSearch: () => void;
  onToggleViews: () => void;
  viewsOpen: boolean;
  trailing: ReactNode;
};

export function Toolbar({
  title,
  status,
  tool,
  appearance,
  canGroup,
  canUngroup,
  canUndo,
  canRedo,
  onTitle,
  onNewNote,
  onAddImages,
  onViewport,
  onTool,
  onGroup,
  onUngroup,
  onUndo,
  onRedo,
  onAppearance,
  onSearch,
  onToggleViews,
  viewsOpen,
  trailing,
}: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { zoomIn, zoomOut, fitView, getViewport } = useReactFlow();

  function settle(action: () => Promise<boolean>) {
    void action().then(() => onViewport(getViewport()));
  }

  return (
    <>
      <div className="chrome chrome-title">
        <div className="toolbar-group">
          <p className="mark"><a href="https://github.com/Raais/canvas" target="_blank" rel="noopener noreferrer">canvas</a></p>
          <input
            className="title-input"
            aria-label="Board title"
            value={title}
            placeholder="Untitled board"
            onChange={(event) => onTitle(event.target.value)}
          />
        </div>
      </div>
      <div className="chrome chrome-create">
        <div className="toolbar-group">
          <button type="button" className="icon-button" aria-label="Search" title="Search" onClick={onSearch}>
            <Search size={17} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-pressed={tool === 'select'} aria-label="Select" title="Select" onClick={() => onTool('select')}>
            <MousePointer2 size={17} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-label="New note" title="New note" onClick={onNewNote}>
            <StickyNote size={17} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-label="Add image" title="Add image" onClick={() => fileRef.current?.click()}>
            <ImageIcon size={17} strokeWidth={1.75} />
          </button>
          <input
            ref={fileRef}
            className="file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            multiple
            onChange={(event) => {
              const files = event.target.files;
              if (files && files.length > 0) onAddImages(files);
              event.target.value = '';
            }}
          />
          <button type="button" className="icon-button" aria-pressed={tool === 'frame'} aria-label="Frame" title="Frame" onClick={() => onTool(tool === 'frame' ? 'select' : 'frame')}>
            <Frame size={17} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="chrome chrome-status">
        <div className="toolbar-group">
          <span className={status === 'error' ? 'status is-error' : 'status'} role="status" aria-live="polite">
            {STATUS_LABEL[status]}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={appearance === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={appearance === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onAppearance}
          >
            {appearance === 'dark' ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
          </button>
          {trailing}
        </div>
      </div>
      <div className="rail rail-left">
        <div className="toolbar-group rail-group">
          <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => settle(() => zoomIn({ duration: 150 }))}>
            <ZoomIn size={17} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => settle(() => zoomOut({ duration: 150 }))}>
            <ZoomOut size={17} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-label="Fit" title="Fit" onClick={() => settle(() => fitView({ padding: 0.2, duration: 150 }))}>
            <Scan size={17} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-pressed={viewsOpen} aria-label="Saved views" title="Saved views" onClick={onToggleViews}>
            <Bookmark size={17} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="rail rail-right">
        <div className="toolbar-group rail-group">
          <button type="button" className="icon-button" aria-label="Group selection" title="Group" onClick={onGroup} disabled={!canGroup}>
            <Group size={17} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-label="Ungroup" title="Ungroup" onClick={onUngroup} disabled={!canUngroup}>
            <Ungroup size={17} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-label="Undo" title="Undo" onClick={onUndo} disabled={!canUndo}>
            <Undo2 size={17} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-label="Redo" title="Redo" onClick={onRedo} disabled={!canRedo}>
            <Redo2 size={17} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </>
  );
}

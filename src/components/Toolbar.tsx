import { useReactFlow } from '@xyflow/react';
import { useRef } from 'react';
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
  onTitle: (title: string) => void;
  onNewNote: () => void;
  onAddImages: (files: FileList) => void;
  onViewport: (viewport: { x: number; y: number; zoom: number }) => void;
};

export function Toolbar({ title, status, onTitle, onNewNote, onAddImages, onViewport }: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { zoomIn, zoomOut, fitView, getViewport } = useReactFlow();

  function settle(action: () => Promise<boolean>) {
    void action().then(() => onViewport(getViewport()));
  }

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <p className="mark">canvas</p>
        <input
          className="title-input"
          aria-label="Board title"
          value={title}
          placeholder="Untitled board"
          onChange={(event) => onTitle(event.target.value)}
        />
      </div>
      <div className="toolbar-group">
        <button type="button" onClick={onNewNote}>
          Note
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Image
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
      </div>
      <div className="toolbar-group">
        <button type="button" onClick={() => settle(() => zoomOut({ duration: 150 }))}>
          Zoom out
        </button>
        <button type="button" onClick={() => settle(() => zoomIn({ duration: 150 }))}>
          Zoom in
        </button>
        <button type="button" onClick={() => settle(() => fitView({ padding: 0.2, duration: 150 }))}>
          Fit
        </button>
      </div>
      <div className="toolbar-group status-group">
        <span className={status === 'error' ? 'status is-error' : 'status'} role="status" aria-live="polite">
          {STATUS_LABEL[status]}
        </span>
      </div>
    </div>
  );
}

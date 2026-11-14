import type { LogicalUsage } from '../project/storage';
import { formatBytes, formatOriginEstimate } from '../project/storage';
import type { BackgroundPattern } from '../domain/types';

type ProjectMenuProps = {
  open: boolean;
  usage: LogicalUsage | null;
  estimate: { usage?: number; quota?: number } | null;
  persisted: boolean | null;
  pattern: BackgroundPattern;
  onPattern: (pattern: BackgroundPattern) => void;
  onToggle: () => void;
  onExport: () => void;
  onExportNew: () => void;
  onImport: (file: File) => void;
  onBlank: () => void;
  onClear: () => void;
  onPersist: () => void;
};

export function ProjectMenu({
  open,
  usage,
  estimate,
  persisted,
  pattern,
  onPattern,
  onToggle,
  onExport,
  onExportNew,
  onImport,
  onBlank,
  onClear,
  onPersist,
}: ProjectMenuProps) {
  const origin = formatOriginEstimate(estimate);
  return (
    <div className="project-menu">
      <button type="button" aria-expanded={open} onClick={onToggle}>
        Project
      </button>
      {open ? (
        <div className="project-panel" role="dialog" aria-label="Project and storage">
          <div className="project-actions">
            <p className="storage-label">Canvas background</p>
            {(['dots', 'grid', 'cross', 'blank'] as const).map((choice) => (
              <button key={choice} type="button" aria-pressed={pattern === choice} onClick={() => onPattern(choice)}>
                {choice}
              </button>
            ))}
            <button type="button" onClick={onExport}>
              Export
            </button>
            <button type="button" onClick={onExportNew}>
              Export & start new
            </button>
            <label className="file-action">
              Import
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) onImport(file);
                }}
              />
            </label>
            <button type="button" onClick={onBlank}>
              New blank board
            </button>
            <button type="button" onClick={onClear}>
              Clear canvas data
            </button>
          </div>
          <dl>
            <div>
              <dt>Canvas data</dt>
              <dd>{usage ? `${formatBytes(usage.totalBytes)} logical` : '…'}</dd>
            </div>
            <div>
              <dt>Contents</dt>
              <dd>
                {usage
                  ? `${usage.notes} notes, ${usage.groups} groups, ${usage.links} links, ${usage.embeddedAssets} embedded, ${usage.externalImages} external`
                  : '…'}
              </dd>
            </div>
            <div>
              <dt>Origin storage</dt>
              <dd>
                {origin.usage} of {origin.quota} ({origin.percent}). This includes other sites on raais.github.io, not only canvas.
              </dd>
            </div>
            <div>
              <dt>Persistence</dt>
              <dd>{persisted === null ? 'Unavailable' : persisted ? 'Requested and granted' : 'Not persistent'}</dd>
            </div>
          </dl>
          <p className="project-note">
            Browser data can still be removed. An exported archive is the copy to keep.
          </p>
          {persisted === false ? (
            <button type="button" onClick={onPersist}>
              Request persistent storage
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

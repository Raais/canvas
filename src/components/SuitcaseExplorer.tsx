import { useMemo, useState } from 'react';
import { Archive, ChevronRight, File, Folder } from 'lucide-react';
import type { ZipListing, ZipListingEntry } from '../archive/zip-directory';
import { planUnpack } from '../domain/suitcase';
import { formatBytes } from '../project/storage';

type FolderNode = {
  name: string;
  path: string;
  folders: FolderNode[];
  files: ZipListingEntry[];
};

export function SuitcaseExplorer({
  filename,
  byteSize,
  listing,
  loading,
  readOnly,
  busy,
  error,
  onClose,
  onDownload,
  onUnpack,
}: {
  filename: string;
  byteSize?: number;
  listing: ZipListing | null;
  loading: boolean;
  readOnly: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onDownload: () => void;
  onUnpack: (paths: string[], group: boolean) => void;
}) {
  const tree = useMemo(() => (listing ? buildTree(listing.entries) : null), [listing]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [group, setGroup] = useState(true);
  const [pending, setPending] = useState<{ paths: string[]; bytes: number; group: boolean } | null>(null);
  const files = listing?.entries.filter((entry) => !entry.directory) ?? [];
  const chosen = files.filter((entry) => selected.has(entry.path));
  const plan = planUnpack(chosen.map((entry) => ({ path: entry.path, uncompressedSize: entry.uncompressedSize, extractable: entry.extractable })), 'selected');
  const allPlan = listing ? planUnpack(files.map((entry) => ({ path: entry.path, uncompressedSize: entry.uncompressedSize, extractable: entry.extractable })), 'all') : { error: 'Select a file to unpack.' };

  function requestUnpack(paths: string[], bytes: number, grouped: boolean) {
    if (paths.length >= 20 || bytes >= 16 * 1024 * 1024) {
      setPending({ paths, bytes, group: grouped });
      return;
    }
    onUnpack(paths, grouped);
  }

  function toggle(path: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="password-layer">
      <form
        className="password-dialog suitcase-explorer"
        role="dialog"
        aria-modal="true"
        aria-label={filename}
        onSubmit={(event) => event.preventDefault()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onClose();
        }}
      >
        <p className="menu-label"><Archive size={15} strokeWidth={1.75} /> {filename}</p>
        <p className="voice-privacy">
          {listing ? `${listing.fileCount} files` : 'Reading archive'}
          {byteSize !== undefined ? ` · ${formatBytes(byteSize)} compressed` : ''}
          {listing ? ` · ${formatBytes(listing.declaredBytes)} expanded` : ''}
        </p>
        {loading ? <p className="voice-privacy">Reading the file list…</p> : null}
        {error ? <p className="voice-error" role="alert">{error}</p> : null}
        {!error && files.length > 0 && 'error' in allPlan && allPlan.error !== 'Select a file to unpack.' ? <p className="voice-error">{allPlan.error}</p> : null}
        <div className="suitcase-tree" role="tree">
          {tree ? <FolderRows node={tree} open={open} selected={selected} onOpen={setOpen} onToggle={toggle} /> : null}
        </div>
        {readOnly ? <p className="voice-privacy">This tab can browse and download the ZIP. Unpacking is off.</p> : null}
        <label className="suitcase-group">
          <input type="checkbox" checked={group} disabled={readOnly || busy} onChange={(event) => setGroup(event.target.checked)} />
          Group extracted files
        </label>
        <p className="voice-privacy" role="status">{chosen.length} selected{('bytes' in plan) ? ` · ${formatBytes(plan.bytes)}` : ''}</p>
        {pending ? (
          <p className="voice-privacy" role="status">
            Unpack {pending.paths.length} files ({formatBytes(pending.bytes)}) as {pending.paths.length} notes{pending.group ? ', grouped together' : ''}?
          </p>
        ) : null}
        <div className="voice-dialog-actions">
          {readOnly ? null : pending ? (
            <>
              <button type="button" disabled={busy} onClick={() => { const next = pending; setPending(null); onUnpack(next.paths, next.group); }}>Confirm unpack</button>
              <button type="button" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy || !('paths' in allPlan)} onClick={() => { if ('paths' in allPlan) setSelected(new Set(allPlan.paths)); }}>Select all</button>
              <button type="button" disabled={busy || !('paths' in plan)} onClick={() => { if ('paths' in plan) requestUnpack(plan.paths, plan.bytes, group && plan.paths.length > 1); }}>Unpack selected</button>
              <button type="button" disabled={busy || !('paths' in allPlan)} onClick={() => { if ('paths' in allPlan) requestUnpack(allPlan.paths, allPlan.bytes, group && allPlan.paths.length > 1); }}>Unpack all</button>
            </>
          )}
          <button type="button" onClick={onDownload}>Download original</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </form>
    </div>
  );
}

function FolderRows({
  node,
  open,
  selected,
  onOpen,
  onToggle,
}: {
  node: FolderNode;
  open: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onOpen: (next: ReadonlySet<string>) => void;
  onToggle: (path: string) => void;
}) {
  return (
    <>
      {node.folders.map((folder) => {
        const expanded = open.has(folder.path);
        return (
          <div key={folder.path || folder.name}>
            <button
              type="button"
              className="suitcase-folder"
              aria-expanded={expanded}
              onClick={() => {
                const next = new Set(open);
                if (expanded) next.delete(folder.path);
                else next.add(folder.path);
                onOpen(next);
              }}
            >
              <ChevronRight size={14} strokeWidth={1.75} className={expanded ? 'is-open' : ''} />
              <Folder size={14} strokeWidth={1.75} />
              <span>{folder.name}</span>
            </button>
            {expanded ? (
              <div className="suitcase-children">
                <FolderRows node={folder} open={open} selected={selected} onOpen={onOpen} onToggle={onToggle} />
              </div>
            ) : null}
          </div>
        );
      })}
      {node.files.map((file) => (
        <label key={file.path} className="suitcase-file">
          <input
            type="checkbox"
            checked={selected.has(file.path)}
            disabled={!file.extractable}
            onChange={() => onToggle(file.path)}
          />
          <File size={14} strokeWidth={1.75} />
          <span title={file.path}>{file.path.split('/').pop()}</span>
          <span className="suitcase-size">{file.extractable ? formatBytes(file.uncompressedSize) : file.reason === 'method' ? 'Unsupported' : 'Unavailable'}</span>
        </label>
      ))}
    </>
  );
}

function buildTree(entries: readonly ZipListingEntry[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], files: [] };
  for (const entry of entries) {
    const directory = entry.directory || entry.path.endsWith('/');
    const parts = entry.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = root;
    const folderParts = directory ? parts : parts.slice(0, -1);
    folderParts.forEach((part, index) => {
      const path = folderParts.slice(0, index + 1).join('/');
      let next = cursor.folders.find((folder) => folder.name === part);
      if (!next) {
        next = { name: part, path, folders: [], files: [] };
        cursor.folders.push(next);
      }
      cursor = next;
    });
    if (!directory) cursor.files.push(entry);
  }
  return root;
}

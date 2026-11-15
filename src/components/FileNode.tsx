import { memo } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { Download, File } from 'lucide-react';
import { FILE_MIN_HEIGHT, FILE_MIN_WIDTH } from '../domain/types';
import { fileKindLabel } from '../domain/files';
import { formatBytes } from '../project/storage';
import { useBoardActions } from './board-context';
import { NodeDateLabel } from './NodeDateLabel';
import { PortHandles } from './PortHandles';

export type FileNodeData = {
  filename: string;
  sourcePath?: string;
  byteSize?: number;
  missing: boolean;
  lastEditedAt?: string;
};

export type FileFlowNode = Node<FileNodeData, 'file'>;

function FileNodeComponent({ id, data, selected }: NodeProps<FileFlowNode>) {
  const actions = useBoardActions();
  const label = data.missing ? 'Missing file' : fileKindLabel(data.filename);
  const size = data.byteSize === undefined ? 'Unavailable' : formatBytes(data.byteSize);

  return (
    <article className={`file-note${selected ? ' is-selected' : ''}${data.missing ? ' is-missing' : ''}`} aria-label={data.filename}>
      <NodeResizer isVisible={selected} minWidth={FILE_MIN_WIDTH} minHeight={FILE_MIN_HEIGHT} />
      <PortHandles />
      <File className="file-note-icon" size={18} strokeWidth={1.75} />
      <div className="file-note-copy">
        <button
          type="button"
          className="file-name nodrag nopan"
          title={data.filename}
          disabled={data.missing}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => actions.downloadFile(id)}
        >
          {data.filename}
        </button>
        <p className="file-meta">{label} · {size}</p>
      </div>
      <button
        type="button"
        className="file-download nodrag nopan"
        aria-label={`Download ${data.filename}`}
        title="Download"
        disabled={data.missing}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => actions.downloadFile(id)}
      >
        <Download size={16} strokeWidth={1.75} />
      </button>
      <NodeDateLabel iso={data.lastEditedAt} />
    </article>
  );
}

export const FileNode = memo(FileNodeComponent);

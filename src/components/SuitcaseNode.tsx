import { memo } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { Archive, Download } from 'lucide-react';
import { SUITCASE_MIN_HEIGHT, SUITCASE_MIN_WIDTH } from '../domain/suitcase';
import { formatBytes } from '../project/storage';
import { useBoardActions } from './board-context';
import { NodeDateLabel } from './NodeDateLabel';
import { PortHandles } from './PortHandles';

export type SuitcaseNodeData = {
  filename: string;
  fileCount: number;
  byteSize?: number;
  missing: boolean;
  readOnly: boolean;
  lastEditedAt?: string;
};

export type SuitcaseFlowNode = Node<SuitcaseNodeData, 'suitcase'>;

function SuitcaseComponent({ id, data, selected }: NodeProps<SuitcaseFlowNode>) {
  const actions = useBoardActions();
  const size = data.byteSize === undefined ? 'Unavailable' : formatBytes(data.byteSize);
  return (
    <article className={`suitcase-note${selected ? ' is-selected' : ''}${data.missing ? ' is-missing' : ''}`} aria-label={data.filename}>
      <NodeResizer isVisible={selected} minWidth={SUITCASE_MIN_WIDTH} minHeight={SUITCASE_MIN_HEIGHT} />
      <PortHandles />
      <div className="suitcase-top">
        <Archive className="suitcase-icon" size={16} strokeWidth={1.75} />
        <p className="suitcase-name" title={data.filename}>{data.filename}</p>
        <button
          type="button"
          className="voice-download nodrag nopan"
          aria-label={`Download ${data.filename}`}
          title="Download original ZIP"
          disabled={data.missing}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => actions.downloadSuitcase(id)}
        >
          <Download size={15} strokeWidth={1.75} />
        </button>
      </div>
      <p className="file-meta">{data.missing ? 'Archive unavailable' : `${data.fileCount} files · ${size}`}</p>
      <button
        type="button"
        className="suitcase-browse nodrag nopan"
        disabled={data.missing}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => actions.browseSuitcase(id)}
      >
        Browse
      </button>
      <NodeDateLabel iso={data.lastEditedAt} />
    </article>
  );
}

export const SuitcaseNode = memo(SuitcaseComponent);

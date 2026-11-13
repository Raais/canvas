import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useState } from 'react';
import type { ImageDisplayMode } from '../domain/types';
import { useBoardActions } from './board-context';

export type ImageNodeData = {
  mode: ImageDisplayMode;
  src: string | null;
  externalUrl: string | null;
};

export type ImageFlowNode = Node<ImageNodeData, 'image'>;

export function ImageNoteNode({ id, data, selected }: NodeProps<ImageFlowNode>) {
  const actions = useBoardActions();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [data.src]);

  const className = [
    'image-note',
    data.mode === 'contain' ? 'is-contain' : 'is-aspect',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const showImage = Boolean(data.src) && !failed;

  return (
    <div className={className}>
      <NodeResizer
        isVisible={selected}
        minWidth={48}
        minHeight={48}
        keepAspectRatio={data.mode === 'aspect'}
        color="#2f6f9f"
        lineStyle={{ borderColor: '#2f6f9f' }}
      />
      {selected ? (
        <div className="image-tools nodrag nopan nowheel" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            aria-pressed={data.mode === 'aspect'}
            onClick={() => actions.setMode(id, 'aspect')}
          >
            Lock ratio
          </button>
          <button
            type="button"
            aria-pressed={data.mode === 'contain'}
            onClick={() => actions.setMode(id, 'contain')}
          >
            Free frame
          </button>
        </div>
      ) : null}
      {showImage ? (
        <img
          src={data.src ?? undefined}
          alt={data.externalUrl ? 'External image' : 'Embedded image'}
          draggable={false}
          decoding="async"
          onLoad={(event) => {
            actions.noteIntrinsicSize(id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          }}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="image-missing">
          <span>{data.src ? 'Image unavailable' : 'Stored image is missing'}</span>
          {data.externalUrl ? (
            <span className="image-url" title={data.externalUrl}>
              {data.externalUrl}
            </span>
          ) : null}
        </div>
      )}
      {data.externalUrl ? <span className="image-flag">External</span> : null}
    </div>
  );
}

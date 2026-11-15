import { memo } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { ExternalLink, Globe, Pencil } from 'lucide-react';
import { WEBSITE_MIN_HEIGHT, WEBSITE_MIN_WIDTH } from '../domain/types';
import { canonicalWebsiteUrl, websiteHostname } from '../domain/websites';
import { useBoardActions } from './board-context';
import { NodeDateLabel } from './NodeDateLabel';
import { PortHandles } from './PortHandles';

export type WebsiteNodeData = {
  url: string;
  title: string;
  lastEditedAt?: string;
  readOnly: boolean;
};

export type WebsiteFlowNode = Node<WebsiteNodeData, 'website'>;

function WebsiteNodeComponent({ id, data, selected }: NodeProps<WebsiteFlowNode>) {
  const actions = useBoardActions();
  const url = canonicalWebsiteUrl(data.url, 'absolute');
  const host = url ? websiteHostname(url) : 'Invalid address';

  return (
    <article className={`website-note${selected ? ' is-selected' : ''}`} aria-label={data.title}>
      <NodeResizer isVisible={selected} minWidth={WEBSITE_MIN_WIDTH} minHeight={WEBSITE_MIN_HEIGHT} />
      <PortHandles />
      <Globe className="website-note-icon" size={18} strokeWidth={1.75} />
      <p className="website-title" title={data.title}>{data.title}</p>
      <p className="website-host" title={data.url}>{host}</p>
      <div className="website-actions">
        <button
          type="button"
          className="website-action nodrag nopan"
          aria-label="Edit website"
          disabled={data.readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => actions.editWebsite(id)}
        >
          <Pencil size={14} strokeWidth={1.75} />
          Edit
        </button>
        <a
          className={`website-action nodrag nopan${url ? '' : ' is-disabled'}`}
          href={url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open website"
          title={data.url}
          aria-disabled={url ? undefined : true}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            if (!url) event.preventDefault();
          }}
        >
          <ExternalLink size={14} strokeWidth={1.75} />
          Open
        </a>
      </div>
      <NodeDateLabel iso={data.lastEditedAt} />
    </article>
  );
}

export const WebsiteNode = memo(WebsiteNodeComponent);

import { memo } from 'react';
import { type Node, type NodeProps } from '@xyflow/react';
import { pathFromPairs } from '../domain/drawing';
import { organicSvgPath } from '../domain/organic-ink';
import type { DrawingBrush, DrawingColor } from '../domain/types';

export type DrawingNodeData = {
  color: DrawingColor;
  brush: DrawingBrush;
  strokeWidth: number;
  points: number[];
  dot: boolean;
};

export type DrawingFlowNode = Node<DrawingNodeData, 'drawing'>;

function DrawingNodeView({ data, selected }: NodeProps<DrawingFlowNode>) {
  const colorClass = `stroke-${data.color}`;
  const selectedClass = selected ? ' is-selected' : '';
  if (data.dot) return <Dot data={data} colorClass={colorClass} selectedClass={selectedClass} />;
  if (data.brush === 'legacy') return <LegacyStroke data={data} colorClass={colorClass} selectedClass={selectedClass} />;
  return <OrganicStroke data={data} colorClass={colorClass} selectedClass={selectedClass} />;
}

function Dot({ data, colorClass, selectedClass }: { data: DrawingNodeData; colorClass: string; selectedClass: string }) {
  const cx = data.points[0] ?? data.strokeWidth / 2;
  const cy = data.points[1] ?? data.strokeWidth / 2;
  return (
    <svg className="drawing-node" width="100%" height="100%" aria-label="Drawing">
      <circle
        className={`drawing-ink ${colorClass}${selectedClass}`}
        cx={cx}
        cy={cy}
        r={Math.max(data.strokeWidth / 2, 0.5)}
        stroke="transparent"
        strokeWidth={14}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function LegacyStroke({ data, colorClass, selectedClass }: { data: DrawingNodeData; colorClass: string; selectedClass: string }) {
  const path = pathFromPairs(data.points);
  return (
    <svg className="drawing-node" width="100%" height="100%" aria-label="Drawing">
      <path className="drawing-hit" d={path} fill="none" stroke="transparent" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path className={`drawing-ink ${colorClass}${selectedClass}`} d={path} fill="none" strokeWidth={data.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OrganicStroke({ data, colorClass, selectedClass }: { data: DrawingNodeData; colorClass: string; selectedClass: string }) {
  const centerline = pathFromPairs(data.points);
  const ink = organicSvgPath(data.points, data.brush === 'legacy' ? 'fountain' : data.brush, data.strokeWidth);
  return (
    <svg className="drawing-node" width="100%" height="100%" aria-label="Drawing">
      <path className={`drawing-organic ${colorClass}${selectedClass}`} d={ink} />
      <path className="drawing-hit" d={centerline} fill="none" stroke="transparent" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export const DrawingNode = memo(DrawingNodeView);

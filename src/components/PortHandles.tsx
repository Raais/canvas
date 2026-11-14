import { Handle, Position } from '@xyflow/react';
import type { HandleSide } from '../domain/types';
import { visualHandleTransform } from '../editor/handles';

const PORTS: { id: HandleSide; position: Position }[] = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
];

export function PortHandles() {
  return (
    <>
      {PORTS.map((port) => (
        <Handle key={port.id} id={port.id} type="source" position={port.position} className="port nodrag nopan">
          <span className="port-dot" style={{ transform: visualHandleTransform() }} />
        </Handle>
      ))}
    </>
  );
}

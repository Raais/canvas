import { Handle, Position } from '@xyflow/react';
import { handleTransform } from '../editor/handles';
import type { HandleSide } from '../domain/types';

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
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={port.position}
          className="port nodrag nopan"
          style={{ transform: handleTransform(port.id) }}
        />
      ))}
    </>
  );
}

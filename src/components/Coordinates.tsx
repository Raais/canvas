import { forwardRef, useImperativeHandle, useRef } from 'react';

export type CoordinatesHandle = {
  setCursor: (x: number, y: number) => void;
};

type CoordinatesProps = {
  selection: string | null;
};

export const Coordinates = forwardRef<CoordinatesHandle, CoordinatesProps>(function Coordinates({ selection }, ref) {
  const cursorRef = useRef<HTMLSpanElement>(null);

  useImperativeHandle(ref, () => ({
    setCursor(x, y) {
      const node = cursorRef.current;
      if (!node) return;
      node.textContent = `Cursor  X: ${x}  Y: ${y}`;
    },
  }));

  return (
    <div className="coordinates" aria-live="off">
      <span ref={cursorRef}>Cursor  X: —  Y: —</span>
      {selection ? <span>{selection}</span> : null}
    </div>
  );
});

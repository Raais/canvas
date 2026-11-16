import type { ReactNode } from 'react';

export function PdfPageFrame({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children?: ReactNode;
}) {
  return (
    <div className="pdf-paper" data-pdf-paper="" style={{ width, height, background: '#fff' }}>
      {children}
    </div>
  );
}

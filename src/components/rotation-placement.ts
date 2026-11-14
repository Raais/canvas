export type RotationAnchor = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type RotationPanelBox = {
  top: number;
  left: number;
  maxHeight: number;
};

const GAP = 6;
const MARGIN = 8;

export function placeRotationPanel(
  anchor: RotationAnchor,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): RotationPanelBox {
  const width = Math.min(panel.width, Math.max(0, viewport.width - MARGIN * 2));
  const height = Math.max(0, panel.height);
  let left = anchor.left;
  if (left + width > viewport.width - MARGIN) left = viewport.width - MARGIN - width;
  if (left < MARGIN) left = MARGIN;

  const room = Math.max(0, viewport.height - MARGIN * 2);
  const above = anchor.top - GAP - height;
  const below = anchor.bottom + GAP;
  const fitsAbove = above >= MARGIN;
  const fitsBelow = below + height <= viewport.height - MARGIN;
  let top = fitsAbove || !fitsBelow ? above : below;
  if (top < MARGIN) top = MARGIN;
  if (top + Math.min(height, room) > viewport.height - MARGIN) {
    top = Math.max(MARGIN, viewport.height - MARGIN - Math.min(height, room));
  }
  return {
    top: Math.round(top),
    left: Math.round(left),
    maxHeight: Math.round(room),
  };
}

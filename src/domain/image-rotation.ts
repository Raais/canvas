export function normalizeRotation(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  let angle = Math.round(value) % 360;
  if (angle > 180) angle -= 360;
  if (angle < -180) angle += 360;
  return angle;
}

export function nudgeRotation(current: number, delta: number): number {
  return normalizeRotation(current + delta) ?? current;
}

export function coverScale(width: number, height: number, degrees: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  if (!Number.isFinite(degrees)) return 1;
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const scale = Math.max(cosine + (height / width) * sine, cosine + (width / height) * sine);
  if (!Number.isFinite(scale) || scale < 1) return 1;
  if (scale - 1 < 1e-10) return 1;
  return scale;
}

export function imageContentTransform(input: {
  width: number;
  height: number;
  degrees: number;
  flipX: boolean;
  flipY: boolean;
}): string {
  const degrees = normalizeRotation(input.degrees) ?? 0;
  const scale = degrees === 0 ? 1 : coverScale(input.width, input.height, degrees);
  const scaleX = (input.flipX ? -1 : 1) * scale;
  const scaleY = (input.flipY ? -1 : 1) * scale;
  const scaled = `scale(${scaleX}, ${scaleY})`;
  if (degrees === 0) return scaled;
  return `rotate(${degrees}deg) ${scaled}`;
}

export type RotationDrag = {
  origin: number;
  preview: number;
  active: boolean;
};

export function startRotationDrag(origin: number): RotationDrag {
  return { origin, preview: origin, active: true };
}

export function moveRotationDrag(drag: RotationDrag, value: number): RotationDrag {
  if (!drag.active) return drag;
  const preview = normalizeRotation(value);
  if (preview === null) return drag;
  return { ...drag, preview };
}

export function finishRotationDrag(drag: RotationDrag): { angle: number; commit: boolean } {
  return { angle: drag.preview, commit: drag.active && drag.preview !== drag.origin };
}

export function cancelRotationDrag(drag: RotationDrag): number {
  return drag.origin;
}

export function mayCommitRotation(readOnly: boolean): boolean {
  return !readOnly;
}

export function pendingRotationBlocksReplacement(adjusting: boolean): boolean {
  return adjusting;
}

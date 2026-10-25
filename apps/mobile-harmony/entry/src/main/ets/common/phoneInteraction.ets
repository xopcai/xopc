export interface XopcPhonePoint { x: number; y: number; }
/** Coordinates exclude contain letterboxes and use the existing 0..1000 wire space. */
export function phonePoint(viewWidth: number, viewHeight: number, imageWidth: number, imageHeight: number,
  touchX: number, touchY: number): XopcPhonePoint | undefined {
  if (viewWidth <= 0 || viewHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return undefined;
  const scale = Math.min(viewWidth / imageWidth, viewHeight / imageHeight);
  const left = (viewWidth - imageWidth * scale) / 2;
  const top = (viewHeight - imageHeight * scale) / 2;
  const x = (touchX - left) / (imageWidth * scale);
  const y = (touchY - top) / (imageHeight * scale);
  if (x < 0 || x > 1 || y < 0 || y > 1) return undefined;
  return { x: Math.round(x * 1000), y: Math.round(y * 1000) };
}
export function phoneInputEnabled(ownControl: boolean, busy: boolean, visible: boolean, connected: boolean): boolean {
  return ownControl && !busy && visible && connected;
}

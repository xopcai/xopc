// Keep the same image point under the gesture focal point across zoom changes.
export function imageZoomOffset(focal: number, startOffset: number, startZoom: number, nextZoom: number): number {
  return focal - (focal - startOffset) * nextZoom / startZoom;
}

export function boundedImageOffset(offset: number, fittedExtent: number, viewportExtent: number, zoom: number): number {
  const limit = Math.max(0, (fittedExtent * zoom - viewportExtent) / 2);
  return Math.max(-limit, Math.min(limit, offset));
}

// Keep the same image point under the gesture focal point across zoom changes.
export function imageZoomOffset(focal: number, startOffset: number, startZoom: number, nextZoom: number): number {
  return focal - (focal - startOffset) * nextZoom / startZoom;
}

export function boundedImageOffset(offset: number, fittedExtent: number, viewportExtent: number, zoom: number): number {
  const limit = Math.max(0, (fittedExtent * zoom - viewportExtent) / 2);
  return Math.max(-limit, Math.min(limit, offset));
}

export function chatImageGridColumns(count: number): number {
  return count <= 1 ? 1 : count === 2 || count === 4 ? 2 : 3;
}

export function chatImageGridHeight(count: number, viewport: number, gap: number): number {
  if (count <= 0) return 0;
  const columns = chatImageGridColumns(count);
  const tile = Math.max(1, (viewport - (columns - 1) * gap) / columns);
  return Math.ceil(count / columns) * (tile + gap) - gap;
}

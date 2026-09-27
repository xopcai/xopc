export interface XopcImageSize { width: number; height: number; }
export interface XopcImageCrop { x: number; y: number; width: number; height: number; }

export function rotatedImageSize(source: XopcImageSize, rotation: number): XopcImageSize {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 270
    ? { width: source.height, height: source.width } : { width: source.width, height: source.height };
}

export function centeredImageCrop(source: XopcImageSize, aspect: number): XopcImageCrop {
  if (source.width <= 0 || source.height <= 0 || !Number.isFinite(aspect) || aspect <= 0) {
    return { x: 0, y: 0, width: Math.max(1, source.width), height: Math.max(1, source.height) };
  }
  const current = source.width / source.height;
  if (Math.abs(current - aspect) < 0.0001) return { x: 0, y: 0, width: source.width, height: source.height };
  if (current > aspect) {
    const width = Math.max(1, Math.round(source.height * aspect));
    return { x: Math.floor((source.width - width) / 2), y: 0, width, height: source.height };
  }
  const height = Math.max(1, Math.round(source.width / aspect));
  return { x: 0, y: Math.floor((source.height - height) / 2), width: source.width, height };
}

export function imageEditAspect(value: string): number {
  if (value === 'square') return 1;
  if (value === '4:3') return 4 / 3;
  if (value === '16:9') return 16 / 9;
  return 0;
}

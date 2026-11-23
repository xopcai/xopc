export interface XopcVideoFrameSize {
  width: number;
  height: number;
}

export function parseVideoAspectRatio(ratio?: string): number {
  if (!ratio) return 0;
  const parts = ratio.trim().split(':');
  if (parts.length !== 2) return 0;
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width / height;
}

export function fittedVideoFrame(stageWidth: number, stageHeight: number, ratio: number): XopcVideoFrameSize | undefined {
  if (!Number.isFinite(stageWidth) || !Number.isFinite(stageHeight) || stageWidth <= 0 || stageHeight <= 0) {
    return undefined;
  }
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined;
  const width = Math.min(stageWidth, stageHeight * ratio);
  const height = width / ratio;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return { width, height };
}

export function clampVideoTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return seconds;
  return Math.min(seconds, duration);
}

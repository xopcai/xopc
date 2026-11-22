import type { AnnotationItem, StrokeSizePreset } from './types.js';

export const WECHAT_ANNOTATION_COLORS = [
  '#fa5151', // Red (default)
  '#ffc300', // Amber
  '#07c160', // WeChat Green
  '#10aeff', // Blue
  '#ffffff', // White
  '#1f2329', // Charcoal
] as const;

export function strokePixelWidth(preset: StrokeSizePreset): number {
  switch (preset) {
    case 'sm':
      return 2;
    case 'md':
      return 4;
    case 'lg':
      return 7;
  }
}

export function fontPixelSize(preset: StrokeSizePreset): number {
  switch (preset) {
    case 'sm':
      return 15;
    case 'md':
      return 20;
    case 'lg':
      return 28;
  }
}

export function mosaicBlockSize(preset: StrokeSizePreset): number {
  switch (preset) {
    case 'sm':
      return 8;
    case 'md':
      return 14;
    case 'lg':
      return 22;
  }
}

export function nextBadgeNumber(items: readonly AnnotationItem[]): number {
  let max = 0;
  for (const item of items) {
    if (item.kind === 'badge' && item.number > max) {
      max = item.number;
    }
  }
  return max + 1;
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTestAnnotation(item: AnnotationItem, x: number, y: number, tolerance = 8): boolean {
  switch (item.kind) {
    case 'rect': {
      const left = Math.min(item.x, item.x + item.width);
      const right = Math.max(item.x, item.x + item.width);
      const top = Math.min(item.y, item.y + item.height);
      const bottom = Math.max(item.y, item.y + item.height);
      const nearH = (Math.abs(y - top) <= tolerance || Math.abs(y - bottom) <= tolerance) && x >= left - tolerance && x <= right + tolerance;
      const nearV = (Math.abs(x - left) <= tolerance || Math.abs(x - right) <= tolerance) && y >= top - tolerance && y <= bottom + tolerance;
      return nearH || nearV;
    }
    case 'ellipse': {
      const cx = item.x + item.width / 2;
      const cy = item.y + item.height / 2;
      const rx = Math.max(4, Math.abs(item.width) / 2);
      const ry = Math.max(4, Math.abs(item.height) / 2);
      const norm = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const tolNorm = tolerance / Math.min(rx, ry);
      return Math.abs(norm - 1) <= Math.max(0.18, tolNorm);
    }
    case 'arrow':
    case 'line':
      return distanceToSegment(x, y, item.x1, item.y1, item.x2, item.y2) <= tolerance;
    case 'pen':
    case 'mosaic': {
      const hitRadius = item.kind === 'mosaic' ? mosaicBlockSize(item.strokeSize) : tolerance;
      for (let i = 0; i < item.points.length; i += 1) {
        const pt = item.points[i]!;
        if (i === 0) {
          if (Math.hypot(x - pt.x, y - pt.y) <= hitRadius) return true;
        } else {
          const prev = item.points[i - 1]!;
          if (distanceToSegment(x, y, prev.x, prev.y, pt.x, pt.y) <= hitRadius) return true;
        }
      }
      return false;
    }
    case 'badge': {
      const radius = item.strokeSize === 'sm' ? 12 : item.strokeSize === 'md' ? 15 : 19;
      return Math.hypot(x - item.x, y - item.y) <= radius + 4;
    }
    case 'text': {
      const size = fontPixelSize(item.strokeSize);
      const lines = item.text.split('\n');
      const maxChars = Math.max(1, ...lines.map((line) => line.length));
      const approxWidth = maxChars * size * 0.72 + 12;
      const approxHeight = lines.length * size * 1.35 + 8;
      return x >= item.x - 4 && x <= item.x + approxWidth && y >= item.y - 4 && y <= item.y + approxHeight;
    }
  }
}

export function findHitAnnotation(items: readonly AnnotationItem[], x: number, y: number): AnnotationItem | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    // Mosaic strokes stay anchored to underlying pixels; all vector shapes/text/badges are movable.
    if (item.kind === 'mosaic') continue;
    if (hitTestAnnotation(item, x, y)) {
      return item;
    }
  }
  return null;
}

export function translateAnnotation(item: AnnotationItem, dx: number, dy: number): AnnotationItem {
  switch (item.kind) {
    case 'rect':
    case 'ellipse':
    case 'badge':
    case 'text':
      return { ...item, x: item.x + dx, y: item.y + dy };
    case 'arrow':
    case 'line':
      return { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy };
    case 'pen':
    case 'mosaic':
      return { ...item, points: item.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) };
  }
}

export class AnnotationHistory {
  private past: AnnotationItem[][] = [];
  private future: AnnotationItem[][] = [];
  private present: AnnotationItem[] = [];

  get items(): readonly AnnotationItem[] {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  commit(next: AnnotationItem[]): void {
    this.past.push(this.present.map((item) => structuredClone(item)));
    if (this.past.length > 60) this.past.shift();
    this.present = next.map((item) => structuredClone(item));
    this.future = [];
  }

  undo(): readonly AnnotationItem[] {
    const prev = this.past.pop();
    if (!prev) return this.present;
    this.future.push(this.present);
    this.present = prev;
    return this.present;
  }

  redo(): readonly AnnotationItem[] {
    const next = this.future.pop();
    if (!next) return this.present;
    this.past.push(this.present);
    this.present = next;
    return this.present;
  }

  clear(): void {
    if (this.present.length === 0) return;
    this.commit([]);
  }

  reset(): void {
    this.past = [];
    this.future = [];
    this.present = [];
  }
}

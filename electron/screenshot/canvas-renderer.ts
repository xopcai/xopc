import { fontPixelSize, mosaicBlockSize, strokePixelWidth } from './annotations.js';
import type { AnnotationItem, PenAnnotationItem } from './types.js';

function drawTaperedArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  baseWidth: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return;

  const angle = Math.atan2(dy, dx);
  const headLen = Math.min(dist * 0.55, Math.max(14, baseWidth * 4.2));
  const headHalfWidth = Math.max(6, baseWidth * 2.1);
  const neckHalfWidth = Math.max(1.8, baseWidth * 0.65);
  const tailHalfWidth = Math.max(0.9, baseWidth * 0.22);

  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const neckX = x2 - headLen * cos;
  const neckY = y2 - headLen * sin;
  const wingBackX = x2 - headLen * 1.15 * cos;
  const wingBackY = y2 - headLen * 1.15 * sin;

  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1 - tailHalfWidth * sin, y1 + tailHalfWidth * cos);
  ctx.lineTo(neckX - neckHalfWidth * sin, neckY + neckHalfWidth * cos);
  ctx.lineTo(wingBackX - headHalfWidth * sin, wingBackY + headHalfWidth * cos);
  ctx.lineTo(x2, y2);
  ctx.lineTo(wingBackX + headHalfWidth * sin, wingBackY - headHalfWidth * cos);
  ctx.lineTo(neckX + neckHalfWidth * sin, neckY - neckHalfWidth * cos);
  ctx.lineTo(x1 + tailHalfWidth * sin, y1 - tailHalfWidth * cos);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function buildPixelatedCanvas(
  sourceImage: CanvasImageSource,
  pixelWidth: number,
  pixelHeight: number,
  logicalBlockSize: number,
  scaleFactor: number,
): HTMLCanvasElement {
  const blockPx = Math.max(4, Math.round(logicalBlockSize * scaleFactor));
  const smallW = Math.max(1, Math.ceil(pixelWidth / blockPx));
  const smallH = Math.max(1, Math.ceil(pixelHeight / blockPx));

  const tiny = document.createElement('canvas');
  tiny.width = smallW;
  tiny.height = smallH;
  const tinyCtx = tiny.getContext('2d');
  if (tinyCtx) {
    tinyCtx.imageSmoothingEnabled = true;
    tinyCtx.drawImage(sourceImage, 0, 0, smallW, smallH);
  }

  const full = document.createElement('canvas');
  full.width = pixelWidth;
  full.height = pixelHeight;
  const fullCtx = full.getContext('2d');
  if (fullCtx) {
    fullCtx.imageSmoothingEnabled = false;
    fullCtx.drawImage(tiny, 0, 0, smallW, smallH, 0, 0, pixelWidth, pixelHeight);
  }
  return full;
}

/**
 * Renders all vector & mosaic annotations in logical display coordinates onto `ctx`
 * (assumes `ctx` has already been scaled by `scaleFactor`, or `scaleFactor = 1` if logical).
 */
export function renderAnnotationsToContext(options: {
  ctx: CanvasRenderingContext2D;
  items: readonly AnnotationItem[];
  selectedId?: string | null;
  editingTextId?: string | null;
  scaleFactor: number;
  offsetX?: number;
  offsetY?: number;
  getMosaicSource: (blockSize: number) => HTMLCanvasElement;
}): void {
  const {
    ctx,
    items,
    selectedId,
    editingTextId,
    scaleFactor,
    offsetX = 0,
    offsetY = 0,
    getMosaicSource,
  } = options;

  // 1. Render mosaic strokes first so vector annotations/text stay crisp on top of blurred regions!
  const mosaicItems = items.filter((i): i is PenAnnotationItem => i.kind === 'mosaic');
  if (mosaicItems.length > 0) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = ctx.canvas.width;
    maskCanvas.height = ctx.canvas.height;
    const maskCtx = maskCanvas.getContext('2d');
    if (maskCtx) {
      for (const item of mosaicItems) {
        if (item.points.length === 0) continue;
        const block = mosaicBlockSize(item.strokeSize);
        const pixelated = getMosaicSource(block);

        maskCtx.globalCompositeOperation = 'source-over';
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskCtx.save();
        maskCtx.scale(scaleFactor, scaleFactor);
        if (offsetX !== 0 || offsetY !== 0) {
          maskCtx.translate(offsetX, offsetY);
        }
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';
        maskCtx.strokeStyle = '#000000';
        maskCtx.fillStyle = '#000000';
        const brushWidth = block * 1.6;
        maskCtx.lineWidth = brushWidth;
        if (item.points.length === 1) {
          maskCtx.beginPath();
          maskCtx.arc(item.points[0]!.x, item.points[0]!.y, brushWidth / 2, 0, Math.PI * 2);
          maskCtx.fill();
        } else {
          maskCtx.beginPath();
          maskCtx.moveTo(item.points[0]!.x, item.points[0]!.y);
          for (let i = 1; i < item.points.length; i += 1) {
            const prev = item.points[i - 1]!;
            const curr = item.points[i]!;
            maskCtx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
          }
          const last = item.points[item.points.length - 1]!;
          maskCtx.lineTo(last.x, last.y);
          maskCtx.stroke();
        }
        maskCtx.restore();

        maskCtx.globalCompositeOperation = 'source-in';
        maskCtx.drawImage(pixelated, 0, 0, maskCanvas.width, maskCanvas.height);

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(maskCanvas, 0, 0);
        ctx.restore();
      }
    }
  }

  // 2. Render vector shapes, pens, badges, and text.
  for (const item of items) {
    if (item.kind === 'mosaic') continue;
    if (item.kind === 'text' && item.id === editingTextId) continue;

    const lineW = strokePixelWidth(item.strokeSize);
    ctx.save();
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (item.kind) {
      case 'rect': {
        const x = Math.min(item.x, item.x + item.width);
        const y = Math.min(item.y, item.y + item.height);
        const w = Math.abs(item.width);
        const h = Math.abs(item.height);
        ctx.strokeRect(x, y, w, h);
        break;
      }
      case 'ellipse': {
        const cx = item.x + item.width / 2;
        const cy = item.y + item.height / 2;
        const rx = Math.abs(item.width) / 2;
        const ry = Math.abs(item.height) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'line': {
        ctx.beginPath();
        ctx.moveTo(item.x1, item.y1);
        ctx.lineTo(item.x2, item.y2);
        ctx.stroke();
        break;
      }
      case 'arrow': {
        drawTaperedArrow(ctx, item.x1, item.y1, item.x2, item.y2, item.color, lineW);
        break;
      }
      case 'pen': {
        if (item.points.length === 1) {
          ctx.beginPath();
          ctx.arc(item.points[0]!.x, item.points[0]!.y, lineW / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (item.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(item.points[0]!.x, item.points[0]!.y);
          for (let i = 1; i < item.points.length; i += 1) {
            const prev = item.points[i - 1]!;
            const curr = item.points[i]!;
            ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
          }
          const last = item.points[item.points.length - 1]!;
          ctx.lineTo(last.x, last.y);
          ctx.stroke();
        }
        break;
      }
      case 'badge': {
        const radius = item.strokeSize === 'sm' ? 11 : item.strokeSize === 'md' ? 14 : 18;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1;
        ctx.beginPath();
        ctx.arc(item.x, item.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = 1.75;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.fillStyle = item.color.toLowerCase() === '#ffffff' || item.color.toLowerCase() === '#ffc300' ? '#111827' : '#ffffff';
        ctx.font = `700 ${Math.round(radius * 1.12)}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(item.number), item.x, item.y + 0.5);
        break;
      }
      case 'text': {
        const fontSize = fontPixelSize(item.strokeSize);
        ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        const lines = item.text.split('\n');
        const lineHeight = Math.round(fontSize * 1.32);
        // Subtle outline for legibility on both light and dark backgrounds
        ctx.lineWidth = 3;
        ctx.strokeStyle =
          item.color.toLowerCase() === '#1f2329' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.55)';
        for (let idx = 0; idx < lines.length; idx += 1) {
          const line = lines[idx]!;
          const ly = item.y + idx * lineHeight;
          ctx.strokeText(line, item.x, ly);
          ctx.fillText(line, item.x, ly);
        }
        break;
      }
    }

    if (selectedId && item.id === selectedId) {
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = '#07c160';
      if (item.kind === 'rect' || item.kind === 'ellipse') {
        ctx.strokeRect(
          Math.min(item.x, item.x + item.width) - 4,
          Math.min(item.y, item.y + item.height) - 4,
          Math.abs(item.width) + 8,
          Math.abs(item.height) + 8,
        );
      } else if (item.kind === 'arrow' || item.kind === 'line') {
        ctx.strokeRect(
          Math.min(item.x1, item.x2) - 5,
          Math.min(item.y1, item.y2) - 5,
          Math.abs(item.x2 - item.x1) + 10,
          Math.abs(item.y2 - item.y1) + 10,
        );
      } else if (item.kind === 'badge') {
        ctx.strokeRect(item.x - 20, item.y - 20, 40, 40);
      } else if (item.kind === 'text') {
        const fontSize = fontPixelSize(item.strokeSize);
        const lines = item.text.split('\n');
        const maxW = Math.max(24, ...lines.map((l) => ctx.measureText(l).width));
        ctx.strokeRect(item.x - 4, item.y - 4, maxW + 8, lines.length * fontSize * 1.32 + 8);
      }
    }

    ctx.restore();
  }
}

import type { ResizeHandle, ScreenshotRect, SnapWindowRect } from './types.js';

export const MIN_SELECTION_SIZE = 4;

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): ScreenshotRect {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

export function clampRectToBounds(rect: ScreenshotRect, bounds: { width: number; height: number }): ScreenshotRect {
  const maxWidth = Math.max(1, Math.floor(bounds.width));
  const maxHeight = Math.max(1, Math.floor(bounds.height));
  const x = Math.max(0, Math.min(Math.round(rect.x), maxWidth - 1));
  const y = Math.max(0, Math.min(Math.round(rect.y), maxHeight - 1));
  const width = Math.max(1, Math.min(Math.round(rect.width), maxWidth - x));
  const height = Math.max(1, Math.min(Math.round(rect.height), maxHeight - y));
  return { x, y, width, height };
}

export function moveRectWithinBounds(
  rect: ScreenshotRect,
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
): ScreenshotRect {
  const maxX = Math.max(0, bounds.width - rect.width);
  const maxY = Math.max(0, bounds.height - rect.height);
  return {
    x: Math.round(Math.max(0, Math.min(rect.x + dx, maxX))),
    y: Math.round(Math.max(0, Math.min(rect.y + dy, maxY))),
    width: rect.width,
    height: rect.height,
  };
}

export function nudgeRect(
  rect: ScreenshotRect,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
  step: number,
  bounds: { width: number; height: number },
): ScreenshotRect {
  const delta = Math.max(1, Math.round(step));
  switch (key) {
    case 'ArrowUp':
      return moveRectWithinBounds(rect, 0, -delta, bounds);
    case 'ArrowDown':
      return moveRectWithinBounds(rect, 0, delta, bounds);
    case 'ArrowLeft':
      return moveRectWithinBounds(rect, -delta, 0, bounds);
    case 'ArrowRight':
      return moveRectWithinBounds(rect, delta, 0, bounds);
  }
}

export function applyResizeHandle(
  initial: ScreenshotRect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
  lockAspect = false,
): ScreenshotRect {
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;

  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;

  if (lockAspect && (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se')) {
    const ratio = initial.width > 0 && initial.height > 0 ? initial.width / initial.height : 1;
    const rawW = Math.abs(right - left);
    const rawH = Math.abs(bottom - top);
    const targetW = Math.max(rawW, rawH * ratio);
    const targetH = targetW / ratio;
    if (handle.includes('w')) {
      left = right >= left ? right - targetW : right + targetW;
    } else {
      right = right >= left ? left + targetW : left - targetW;
    }
    if (handle.includes('n')) {
      top = bottom >= top ? bottom - targetH : bottom + targetH;
    } else {
      bottom = bottom >= top ? top + targetH : top - targetH;
    }
  }

  const normalized = normalizeRect(left, top, right, bottom);
  const clamped = clampRectToBounds(
    {
      x: normalized.x,
      y: normalized.y,
      width: Math.max(MIN_SELECTION_SIZE, normalized.width),
      height: Math.max(MIN_SELECTION_SIZE, normalized.height),
    },
    bounds,
  );
  return clamped;
}

export function screenToDisplayRect(rect: ScreenshotRect, displayBounds: ScreenshotRect): ScreenshotRect | null {
  const left = Math.max(rect.x, displayBounds.x);
  const top = Math.max(rect.y, displayBounds.y);
  const right = Math.min(rect.x + rect.width, displayBounds.x + displayBounds.width);
  const bottom = Math.min(rect.y + rect.height, displayBounds.y + displayBounds.height);
  if (right - left < MIN_SELECTION_SIZE || bottom - top < MIN_SELECTION_SIZE) {
    return null;
  }
  return {
    x: Math.round(left - displayBounds.x),
    y: Math.round(top - displayBounds.y),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

export function displayToScreenRect(localRect: ScreenshotRect, displayBounds: ScreenshotRect): ScreenshotRect {
  return {
    x: Math.round(displayBounds.x + localRect.x),
    y: Math.round(displayBounds.y + localRect.y),
    width: Math.round(localRect.width),
    height: Math.round(localRect.height),
  };
}

export function logicalToPhysicalRect(
  localRect: ScreenshotRect,
  displayLogicalSize: { width: number; height: number },
  bitmapSize: { width: number; height: number },
): ScreenshotRect {
  const scaleX = displayLogicalSize.width > 0 ? bitmapSize.width / displayLogicalSize.width : 1;
  const scaleY = displayLogicalSize.height > 0 ? bitmapSize.height / displayLogicalSize.height : 1;
  return clampRectToBounds(
    {
      x: Math.round(localRect.x * scaleX),
      y: Math.round(localRect.y * scaleY),
      width: Math.max(1, Math.round(localRect.width * scaleX)),
      height: Math.max(1, Math.round(localRect.height * scaleY)),
    },
    bitmapSize,
  );
}

/**
 * Finds the topmost visible window under cursor `(localX, localY)` on the given display.
 * Windows are expected sorted by ascending `zOrder` (0 = frontmost).
 */
export function findTopSnapWindow(
  localX: number,
  localY: number,
  displayBounds: ScreenshotRect,
  windows: readonly SnapWindowRect[],
): (SnapWindowRect & { localRect: ScreenshotRect }) | null {
  const screenX = displayBounds.x + localX;
  const screenY = displayBounds.y + localY;
  const ordered = [...windows].sort((a, b) => a.zOrder - b.zOrder);
  for (const win of ordered) {
    if (win.width < 24 || win.height < 24) continue;
    if (
      screenX >= win.x &&
      screenX <= win.x + win.width &&
      screenY >= win.y &&
      screenY <= win.y + win.height
    ) {
      const localRect = screenToDisplayRect(win, displayBounds);
      if (localRect) {
        return { ...win, localRect };
      }
    }
  }
  return null;
}

export interface ToolbarPlacement {
  x: number;
  y: number;
  position: 'below' | 'above' | 'inside';
}

/**
 * Places the floating toolbar WeChat-style:
 * 1. Below right edge of selection (+10px gap) when space allows.
 * 2. Above right edge (-10px gap) if bottom lacks space (including sub-bar room).
 * 3. Docked inside bottom-right of selection if selection spans near full screen height.
 */
export function computeToolbarPlacement(
  selection: ScreenshotRect,
  toolbarSize: { width: number; height: number },
  viewport: { width: number; height: number },
  subbarHeight = 44,
): ToolbarPlacement {
  const margin = 8;
  const gap = 10;
  const preferredX = selection.x + selection.width - toolbarSize.width;
  const x = Math.round(
    Math.max(margin, Math.min(preferredX, viewport.width - toolbarSize.width - margin)),
  );

  const belowY = selection.y + selection.height + gap;
  if (belowY + toolbarSize.height + subbarHeight + margin <= viewport.height) {
    return { x, y: Math.round(belowY), position: 'below' };
  }

  const aboveY = selection.y - toolbarSize.height - gap;
  if (aboveY - subbarHeight >= margin) {
    return { x, y: Math.round(aboveY), position: 'above' };
  }

  if (belowY + toolbarSize.height + margin <= viewport.height) {
    return { x, y: Math.round(belowY), position: 'below' };
  }

  const insideX = Math.round(
    Math.max(
      margin,
      Math.min(selection.x + selection.width - toolbarSize.width - 10, viewport.width - toolbarSize.width - margin),
    ),
  );
  const insideY = Math.round(
    Math.max(
      margin,
      Math.min(selection.y + selection.height - toolbarSize.height - 10, viewport.height - toolbarSize.height - margin),
    ),
  );
  return { x: insideX, y: insideY, position: 'inside' };
}

export function computeMagnifierPlacement(
  cursorX: number,
  cursorY: number,
  loupeSize: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const offset = 20;
  const margin = 8;
  let x = cursorX + offset;
  let y = cursorY + offset;
  if (x + loupeSize.width + margin > viewport.width) {
    x = cursorX - loupeSize.width - offset;
  }
  if (y + loupeSize.height + margin > viewport.height) {
    y = cursorY - loupeSize.height - offset;
  }
  return {
    x: Math.round(Math.max(margin, Math.min(x, viewport.width - loupeSize.width - margin))),
    y: Math.round(Math.max(margin, Math.min(y, viewport.height - loupeSize.height - margin))),
  };
}

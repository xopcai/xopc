export type DesktopPetWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_WIDTH = 180;
const MIN_HEIGHT = 140;
const EDGE_INSET = 24;
const BOTTOM_INSET = 72;

function horizontalInset(workArea: DesktopPetWindowBounds): number {
  return Math.min(EDGE_INSET, Math.max(0, Math.floor((workArea.width - MIN_WIDTH) / 2)));
}

function verticalInsets(workArea: DesktopPetWindowBounds): { top: number; bottom: number } {
  const available = Math.max(0, workArea.height - MIN_HEIGHT);
  const top = Math.min(EDGE_INSET, Math.floor(available / 2));
  return { top, bottom: Math.min(BOTTOM_INSET, available - top) };
}

export function desktopPetDefaultBounds(
  workArea: DesktopPetWindowBounds,
  scale: number,
): DesktopPetWindowBounds {
  const width = Math.round(360 * scale);
  const height = Math.round(250 * scale);
  const { bottom } = verticalInsets(workArea);
  const right = horizontalInset(workArea);
  return {
    width,
    height,
    x: Math.round(workArea.x + workArea.width - width - right),
    y: Math.round(workArea.y + workArea.height - height - bottom),
  };
}

/** Keeps the transparent pet window clear of display edges and auto-hidden taskbars. */
export function clampDesktopPetBounds(
  bounds: DesktopPetWindowBounds,
  workArea: DesktopPetWindowBounds,
): DesktopPetWindowBounds {
  const side = horizontalInset(workArea);
  const { top, bottom } = verticalInsets(workArea);
  const availableWidth = Math.max(1, workArea.width - side * 2);
  const availableHeight = Math.max(1, workArea.height - top - bottom);
  const width = Math.min(Math.max(MIN_WIDTH, bounds.width), availableWidth);
  const height = Math.min(Math.max(MIN_HEIGHT, bounds.height), availableHeight);
  const minX = workArea.x + side;
  const maxX = workArea.x + workArea.width - side - width;
  const minY = workArea.y + top;
  const maxY = workArea.y + workArea.height - bottom - height;
  return {
    width,
    height,
    x: Math.min(Math.max(minX, bounds.x), Math.max(minX, maxX)),
    y: Math.min(Math.max(minY, bounds.y), Math.max(minY, maxY)),
  };
}

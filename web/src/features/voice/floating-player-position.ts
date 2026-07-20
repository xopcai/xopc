export type FloatingPlayerPosition = { x: number; y: number };

export function clampFloatingPlayerPosition(
  position: FloatingPlayerPosition,
  playerSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
  margin = 12,
): FloatingPlayerPosition {
  const maxX = Math.max(margin, viewportSize.width - playerSize.width - margin);
  const maxY = Math.max(margin, viewportSize.height - playerSize.height - margin);
  return {
    x: Math.min(maxX, Math.max(margin, position.x)),
    y: Math.min(maxY, Math.max(margin, position.y)),
  };
}

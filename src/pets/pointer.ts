export type DesktopPetPointer = { x: number; y: number };

/** A nearby cursor attracts attention; distant cursors let the pet settle back. */
export function desktopPetPointerTarget(cursor: DesktopPetPointer, center: DesktopPetPointer, size: number): DesktopPetPointer {
  const dx = cursor.x - center.x;
  const dy = cursor.y - center.y;
  const radius = Math.max(220, size * 2.5);
  const strength = Math.max(0, Math.min(1, (radius - Math.hypot(dx, dy)) / (radius - size * .6)));
  const reach = Math.max(1, size * .85);
  const limit = (value: number) => Math.round(Math.max(-1, Math.min(1, value / reach)) * strength * 1000) / 1000;
  return { x: limit(dx), y: limit(dy) };
}

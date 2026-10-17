import { desktopPetPointerTarget, type DesktopPetPointer } from '../../../../src/pets/pointer';

/** Updates only composited SVG layers, leaving task animations and React state intact. */
export function followLoopiPointer(host: HTMLElement, initiallyEnabled = true) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let enabled = initiallyEnabled;
  let latest: DesktopPetPointer = { x: 0, y: 0 };
  const draw = (point: DesktopPetPointer) => {
    const limit = (value: number) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    host.style.setProperty('--loopi-pointer-x', String(reduce?.matches ? 0 : limit(point.x)));
    host.style.setProperty('--loopi-pointer-y', String(reduce?.matches ? 0 : limit(point.y)));
  };
  const move = (point: DesktopPetPointer) => {
    latest = point;
    if (enabled) draw(point);
  };
  const reset = () => move({ x: 0, y: 0 });
  const preference = () => draw(enabled ? latest : { x: 0, y: 0 });
  const pointer = (event: PointerEvent) => {
    if (!enabled || event.pointerType === 'touch') return;
    const bounds = host.getBoundingClientRect();
    move(desktopPetPointerTarget({ x: event.clientX, y: event.clientY }, {
      x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2,
    }, bounds.height));
  };
  const native = host.closest('.desktop-pet-window') ? window.electronAPI?.pet?.onPointerChanged : undefined;
  const offPointer = native?.(move);
  if (!offPointer) {
    window.addEventListener('pointermove', pointer);
    document.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
  }
  reduce?.addEventListener('change', preference);
  return {
    setEnabled(value: boolean) {
      enabled = value;
      preference();
    },
    dispose() {
      offPointer?.();
      window.removeEventListener('pointermove', pointer);
      document.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
      reduce?.removeEventListener('change', preference);
      draw({ x: 0, y: 0 });
    },
  };
}

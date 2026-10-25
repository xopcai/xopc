import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

import { usePhoneWorkspaceStore } from './phone-workspace-store';

type Point = { x: number; y: number };
type Size = { width: number; height: number };

export function clampPhoneWindowPosition(point: Point, size: Size, viewport: Size): Point {
  return {
    x: Math.round(Math.max(12, Math.min(point.x, Math.max(12, viewport.width - size.width - 12)))),
    y: Math.round(Math.max(12, Math.min(point.y, Math.max(12, viewport.height - size.height - 12)))),
  };
}

export function phoneWindowWidthLimits(viewport: Size) {
  const max = Math.min(432, viewport.width - 24, (viewport.height - 24) * 288 / 640);
  return { min: Math.min(216, max), max };
}

export function usePhoneWindowLayout(open: boolean, floating: boolean) {
  const panelRef = useRef<HTMLElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const move = useCallback((point: Point) => {
    const bounds = panelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    usePhoneWorkspaceStore.getState().setPosition(clampPhoneWindowPosition(point, bounds, { width: window.innerWidth, height: window.innerHeight }));
  }, []);
  useLayoutEffect(() => {
    if (!open || !floating) return;
    const update = () => {
      const limits = phoneWindowWidthLimits({ width: window.innerWidth, height: window.innerHeight });
      const width = usePhoneWorkspaceStore.getState().floatingWidth;
      const next = Math.max(limits.min, Math.min(width, limits.max));
      if (next !== width) usePhoneWorkspaceStore.getState().setFloatingWidth(next);
      const bounds = panelRef.current?.getBoundingClientRect();
      if (bounds) move(usePhoneWorkspaceStore.getState().position ?? { x: window.innerWidth - bounds.width - 16, y: 80 });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    if (panelRef.current) observer?.observe(panelRef.current);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); dragCleanup.current?.(); };
  }, [open, floating, move]);

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (!floating || event.button !== 0 || (event.target as Element).closest('button, a, input, select, [role="button"]')) return;
    const bounds = panelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    dragCleanup.current?.();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const update = (next: globalThis.PointerEvent) => {
      if (next.pointerId === event.pointerId) move({ x: bounds.x + next.clientX - event.clientX, y: bounds.y + next.clientY - event.clientY });
    };
    const stop = () => {
      if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      dragCleanup.current = null;
    };
    dragCleanup.current = stop;
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  }
  function startResize(event: PointerEvent<HTMLElement>) {
    if (!floating || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragCleanup.current?.();
    const bounds = panelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const update = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      const limits = phoneWindowWidthLimits({ width: window.innerWidth, height: window.innerHeight });
      const delta = ((next.clientX - event.clientX) + (next.clientY - event.clientY) * 288 / 640) / 2;
      usePhoneWorkspaceStore.getState().setFloatingWidth(Math.max(limits.min, Math.min(limits.max, bounds.width + delta)));
    };
    const stop = () => {
      if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      dragCleanup.current = null;
    };
    dragCleanup.current = stop;
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  }
  function moveWithKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (!floating || event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 40 : 16;
    const offsets: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    const delta = offsets[event.key];
    if (!delta) return;
    event.preventDefault();
    const point = usePhoneWorkspaceStore.getState().position ?? { x: 12, y: 12 };
    move({ x: point.x + delta.x, y: point.y + delta.y });
  }
  return { panelRef, startDrag, startResize, moveWithKeyboard };
}

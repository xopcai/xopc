import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { PendingFollowUp } from './pending-follow-up.types';

type Slot = { id: string; top: number; height: number; sortable: boolean };
type Drag = {
  pointerId: number;
  id: string;
  row: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  left: number;
  top: number;
  offsetY: number;
  slots: Slot[];
  allSlots: Slot[];
  landingTop: number;
  from: number;
  to: number;
  scroller: HTMLElement | null;
  initialScroll: number;
  overlay: HTMLElement | null;
  frame: number;
  cursor: string;
  userSelect: string;
};
type DragView = { id: string; targetId: string; shifts: Record<string, number> };

function findScroller(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

/** Pointer sorting keeps the full row above the clipped queue, with its original slot reserved. */
export function useFollowUpRowDrag({ items, disabled, onReorder }: {
  items: PendingFollowUp[];
  disabled: boolean;
  onReorder: (fromIndex: number, toIndex: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClickUntil = useRef(0);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ items, onReorder });
  latest.current = { items, onReorder };
  const [view, setView] = useState<DragView | null>(null);
  const signature = items.map(item => `${item.id}:${item.version}:${item.status}`).join('|');

  function cleanup() {
    const drag = dragRef.current;
    if (!drag) return;
    cancelAnimationFrame(drag.frame);
    drag.overlay?.remove();
    if (drag.row.hasPointerCapture?.(drag.pointerId)) drag.row.releasePointerCapture(drag.pointerId);
    if (drag.overlay) {
      suppressClickUntil.current = Date.now() + 250;
      document.body.style.cursor = drag.cursor;
      document.body.style.userSelect = drag.userSelect;
    }
    dragRef.current = null;
    if (finishTimer.current) clearTimeout(finishTimer.current);
    finishTimer.current = null;
  }

  useEffect(() => {
    setView(null);
    return cleanup;
  }, [signature, disabled]);

  function updateTarget(drag: Drag) {
    const scrollDelta = (drag.scroller?.scrollTop ?? 0) - drag.initialScroll;
    const center = drag.y - drag.offsetY + drag.slots[drag.from].height / 2;
    const to = drag.slots.filter((slot, index) => index !== drag.from && center > slot.top - scrollDelta + slot.height / 2).length;
    drag.to = to;
    const sorted = [...drag.slots];
    sorted.splice(to, 0, sorted.splice(drag.from, 1)[0]);
    const shifts: Record<string, number> = {};
    let queuedIndex = 0;
    let top = drag.allSlots[0].top;
    drag.allSlots.forEach((original, index) => {
      const slot = original.sortable ? sorted[queuedIndex++] : original;
      shifts[slot.id] = top - slot.top;
      if (slot.id === drag.id) drag.landingTop = top;
      const next = drag.allSlots[index + 1];
      top += slot.height + (next ? next.top - original.top - original.height : 0);
    });
    setView(previous => previous?.id === drag.id && previous.targetId === drag.slots[to].id
      ? previous : { id: drag.id, targetId: drag.slots[to].id, shifts });
  }

  function autoScroll(drag: Drag) {
    if (dragRef.current !== drag || !drag.overlay) return;
    const scroller = drag.scroller;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const edge = Math.min(32, rect.height / 4);
      const speed = drag.y < rect.top + edge ? -Math.min(8, (rect.top + edge - drag.y) / 4)
        : drag.y > rect.bottom - edge ? Math.min(8, (drag.y - rect.bottom + edge) / 4) : 0;
      if (speed) {
        scroller.scrollTop += speed;
        updateTarget(drag);
      }
    }
    drag.frame = requestAnimationFrame(() => autoScroll(drag));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>, item: PendingFollowUp) {
    if (disabled || item.status !== 'queued' || event.button !== 0 || dragRef.current) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input') && !target.closest('[data-follow-up-drag-surface]')) return;
    // Preserve vertical touch scrolling outside the explicit handle.
    if (event.pointerType === 'touch' && !target.closest('[data-follow-up-drag-handle]')) return;
    const row = event.currentTarget;
    const rect = row.getBoundingClientRect();
    const allSlots = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-follow-up-id]') ?? [])
      .map(element => {
        const bounds = element.getBoundingClientRect();
        return { id: element.dataset.followUpId!, top: bounds.top, height: bounds.height, sortable: element.dataset.followUpSortable === 'true' };
      });
    const slots = allSlots.filter(slot => slot.sortable);
    if (slots.length < 2) return;
    const from = slots.findIndex(slot => slot.id === item.id);
    if (from < 0) return;
    const scroller = findScroller(row);
    dragRef.current = { pointerId: event.pointerId, id: item.id, row,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      left: rect.left, top: rect.top, offsetY: event.clientY - rect.top, slots, allSlots, landingTop: rect.top, from, to: from,
      scroller, initialScroll: scroller?.scrollTop ?? 0, overlay: null, frame: 0,
      cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
  }

  function onPointerMove(event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'preventDefault'>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || finishTimer.current) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.overlay && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
    event.preventDefault();
    if (!drag.overlay) {
      drag.row.setPointerCapture?.(drag.pointerId);
      const overlay = drag.row.cloneNode(true) as HTMLElement;
      overlay.removeAttribute('data-follow-up-id');
      overlay.removeAttribute('data-follow-up-sortable');
      overlay.setAttribute('data-follow-up-drag-overlay', '');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.setAttribute('inert', '');
      overlay.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
      Object.assign(overlay.style, { position: 'fixed', left: `${drag.left}px`, top: `${drag.top}px`,
        width: `${drag.row.getBoundingClientRect().width}px`, height: `${drag.slots[drag.from].height}px`,
        zIndex: '60', pointerEvents: 'none', margin: '0', opacity: '1',
        background: 'var(--color-surface-overlay)', border: '1px solid var(--color-edge-strong)',
        boxShadow: 'var(--shadow-popover)', willChange: 'transform', transition: 'none' });
      document.body.append(overlay);
      drag.overlay = overlay;
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      drag.frame = requestAnimationFrame(() => autoScroll(drag));
    }
    drag.overlay.style.transform = `translate3d(${drag.x - drag.startX}px, ${drag.y - drag.startY}px, 0) scale(1.015)`;
    updateTarget(drag);
  }

  function finish(commit: boolean) {
    const drag = dragRef.current;
    if (!drag || finishTimer.current) return;
    if (!drag.overlay) { cleanup(); return; }
    suppressClickUntil.current = Date.now() + 250;
    cancelAnimationFrame(drag.frame);
    const landingTop = commit ? drag.landingTop : drag.top;
    const delta = (drag.scroller?.scrollTop ?? 0) - drag.initialScroll;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    drag.overlay.style.transition = reducedMotion ? 'none' : 'transform 160ms ease-out, opacity 160ms ease-out';
    drag.overlay.style.transform = `translate3d(0, ${landingTop - delta - drag.top}px, 0) scale(1)`;
    finishTimer.current = setTimeout(() => { cleanup(); setView(null); }, reducedMotion ? 0 : 170);
    if (commit && drag.to !== drag.from) {
      const fromIndex = latest.current.items.findIndex(item => item.id === drag.id);
      const toIndex = latest.current.items.findIndex(item => item.id === drag.slots[drag.to].id);
      if (fromIndex >= 0 && toIndex >= 0) latest.current.onReorder(fromIndex, toIndex);
    }
  }

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current) {
        event.preventDefault();
        cleanup();
        setView(null);
      }
    };
    const blur = () => { cleanup(); setView(null); };
    const move = (event: PointerEvent) => onPointerMove(event);
    const up = (event: PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) finish(true);
    };
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) finish(false);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('keydown', cancel);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
    };
  }, []);

  return { listRef, view, onPointerDown,
    onClickCapture: (event: React.MouseEvent) => {
      if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
    },
  };
}

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

const COMPOSER = '[data-chat-composer-frame]';
const GAP = 12;

type Point = { x: number; y: number };
type Area = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };

export function clampFloatingPosition(point: Point, size: Size, area: Area): Point {
  return {
    x: Math.max(area.left, Math.min(point.x, area.right - size.width)),
    y: Math.max(area.top, Math.min(point.y, area.bottom - size.height)),
  };
}

function visibleBounds(element: Element, area: Area): DOMRect | null {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.right > area.left && rect.left < area.right
    && rect.bottom > area.top && rect.top < area.bottom ? rect : null;
}

function measureLayout(element: HTMLElement | null, peerSelector?: string, topInset?: number) {
  const viewport = window.visualViewport;
  const x = viewport?.offsetLeft ?? 0;
  const y = viewport?.offsetTop ?? 0;
  const area = { left: x + GAP, top: y + GAP, right: x + (viewport?.width ?? window.innerWidth) - GAP,
    bottom: y + (viewport?.height ?? window.innerHeight) - GAP };
  for (const composer of document.querySelectorAll(COMPOSER)) {
    const rect = visibleBounds(composer, area);
    if (rect) area.bottom = Math.max(area.top, Math.min(area.bottom, rect.top - GAP));
  }
  const size = element?.getBoundingClientRect();
  const width = Math.min(size?.width ?? 0, area.right - area.left);
  const height = Math.min(size?.height ?? 0, area.bottom - area.top);
  let dockTop = Math.min(y + (topInset ?? GAP), area.bottom - height);
  let dockBottom = area.bottom;
  const peer = peerSelector ? document.querySelector(peerSelector) : null;
  const peerBounds = peer && visibleBounds(peer, area);
  if (peerBounds && peerBounds.right > area.right - width) {
    if (topInset !== undefined && peerBounds.top < dockTop + height && peerBounds.bottom > dockTop
      && peerBounds.bottom + GAP + height <= area.bottom) {
      dockTop = peerBounds.bottom + GAP;
    } else if (topInset === undefined && peerBounds.bottom > area.bottom - height
      && peerBounds.top - GAP - height >= area.top) {
      dockBottom = peerBounds.top - GAP;
    }
  }
  return { ...area, dockTop, dockBottom, width, height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
}

export function useComposerSafeFloatingLayout(
  ref: RefObject<HTMLElement | null>, visible: boolean, position: Point | null, peerSelector?: string, topInset?: number,
) {
  const [layout, setLayout] = useState(() => measureLayout(null, peerSelector, topInset));

  useLayoutEffect(() => {
    if (!visible || !ref.current) return;
    const panel = ref.current;
    const selector = peerSelector ? `${COMPOSER}, ${peerSelector}` : COMPOSER;
    const measure = () => {
      const next = measureLayout(panel, peerSelector, topInset);
      setLayout(previous => (Object.keys(next) as (keyof typeof next)[]).every(key => next[key] === previous[key]) ? previous : next);
    };
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const peerChanges = new MutationObserver(schedule);
    const observeBounds = () => {
      resize?.disconnect();
      peerChanges.disconnect();
      resize?.observe(panel);
      for (const element of document.querySelectorAll(selector)) {
        resize?.observe(element);
        if (element.parentElement) resize?.observe(element.parentElement);
        if (peerSelector && element.matches(peerSelector)) peerChanges.observe(element, { attributes: true, attributeFilter: ['style'] });
      }
      measure();
    };
    const hasAnchor = (node: Node) => node instanceof Element && (node.matches(selector) || Boolean(node.querySelector(selector)));
    const routeChanges = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(hasAnchor))) observeBounds();
    });
    routeChanges.observe(document.body, { childList: true, subtree: true });
    observeBounds();
    const viewport = window.visualViewport;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', schedule, true);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      routeChanges.disconnect();
      peerChanges.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', schedule, true);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [ref, visible, peerSelector, topInset]);

  const clamp = (point: Point) => clampFloatingPosition(point, layout, layout);
  const fitted = position && clamp(position);
  const style: CSSProperties = {
    maxWidth: Math.max(0, layout.right - layout.left),
    maxHeight: Math.max(0, layout.bottom - layout.top),
    ...(fitted ? { left: fitted.x, top: fitted.y, right: 'auto', bottom: 'auto' }
      : topInset !== undefined
        ? { right: layout.viewportWidth - layout.right,
          top: `min(max(${layout.dockTop}px, calc(${topInset}px + env(safe-area-inset-top))), ${layout.bottom - layout.height}px)` }
        : { right: layout.viewportWidth - layout.right,
          bottom: `max(${layout.viewportHeight - layout.dockBottom}px, env(safe-area-inset-bottom))` }),
  };
  return { area: layout, clamp, style };
}

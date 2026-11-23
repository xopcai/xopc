import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

import { PersonalAvatar, type PersonalAppearance, type PersonalAvatarActivity } from './personal-avatar';

export type PersonalAvatarAnchorId = 'header' | 'panel';

export type AvatarRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PersonalAvatarFlightMedia = {
  appearance: PersonalAppearance;
  agentId?: string;
  activity: PersonalAvatarActivity;
};

export type PendingPersonalAvatarFlight = {
  id: number;
  from: PersonalAvatarAnchorId;
  to: PersonalAvatarAnchorId;
  sourceRect: AvatarRect;
  media: PersonalAvatarFlightMedia;
};

export type ActivePersonalAvatarFlight = {
  id: number;
  from: PersonalAvatarAnchorId;
  to: PersonalAvatarAnchorId;
  sourceRect: AvatarRect;
  targetRect: AvatarRect;
  media: PersonalAvatarFlightMedia;
};

type AnchorRegistration = {
  element: HTMLElement;
  getMedia: () => PersonalAvatarFlightMedia;
};

type FlightState = {
  pending: PendingPersonalAvatarFlight | null;
  active: ActivePersonalAvatarFlight | null;
  justLanded: { anchor: PersonalAvatarAnchorId; id: number } | null;
};

const anchors: Partial<Record<PersonalAvatarAnchorId, AnchorRegistration>> = {};
let lastKnownMedia: PersonalAvatarFlightMedia | null = null;
let liveFlightNode: HTMLElement | null = null;
let nextFlightId = 1;
let pendingTimeout: number | undefined;
let landedTimeout: number | undefined;

export const usePersonalAvatarFlightStore = create<FlightState>(() => ({
  pending: null,
  active: null,
  justLanded: null,
}));

function clearPendingTimer() {
  if (pendingTimeout !== undefined) {
    window.clearTimeout(pendingTimeout);
    pendingTimeout = undefined;
  }
}

function clearLandedTimer() {
  if (landedTimeout !== undefined) {
    window.clearTimeout(landedTimeout);
    landedTimeout = undefined;
  }
}

function parseTranslateOffset(transform: string): { x: number; y: number } {
  if (!transform || transform === 'none') return { x: 0, y: 0 };
  const matrix2d = /^matrix\(([^)]+)\)$/.exec(transform);
  if (matrix2d) {
    const parts = matrix2d[1].split(',').map(Number);
    if (parts.length === 6 && Number.isFinite(parts[4]) && Number.isFinite(parts[5])) {
      return { x: parts[4], y: parts[5] };
    }
  }
  const matrix3d = /^matrix3d\(([^)]+)\)$/.exec(transform);
  if (matrix3d) {
    const parts = matrix3d[1].split(',').map(Number);
    if (parts.length === 16 && Number.isFinite(parts[12]) && Number.isFinite(parts[13])) {
      return { x: parts[12], y: parts[13] };
    }
  }
  return { x: 0, y: 0 };
}

function isRectVisible(rect: AvatarRect): boolean {
  if (!(rect.width > 0 && rect.height > 0)) return false;
  return rect.left + rect.width > 0
    && rect.top + rect.height > 0
    && rect.left < window.innerWidth
    && rect.top < window.innerHeight;
}

/** Measures an element's resting viewport rect by removing ancestor translate transforms. */
export function measureRestingAvatarRect(element: HTMLElement): AvatarRect | null {
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  let offsetX = 0;
  let offsetY = 0;
  let current: HTMLElement | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    const offset = parseTranslateOffset(style.transform);
    offsetX += offset.x;
    offsetY += offset.y;
    current = current.parentElement;
  }
  return {
    left: rect.left - offsetX,
    top: rect.top - offsetY,
    width: rect.width,
    height: rect.height,
  };
}

export function canAnimatePersonalAvatarFlight(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (document.visibilityState === 'hidden') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.animate === 'function';
}

export function registerPersonalAvatarAnchor(
  anchor: PersonalAvatarAnchorId,
  element: HTMLElement | null,
  getMedia: () => PersonalAvatarFlightMedia,
) {
  if (!element) {
    if (anchors[anchor]) delete anchors[anchor];
    return;
  }
  anchors[anchor] = { element, getMedia };
  lastKnownMedia = getMedia();
}

export function beginPersonalAvatarFlight(
  from: PersonalAvatarAnchorId,
  to: PersonalAvatarAnchorId,
  mediaOverride?: PersonalAvatarFlightMedia,
): boolean {
  if (from === to || !canAnimatePersonalAvatarFlight()) return false;
  const currentState = usePersonalAvatarFlightStore.getState();
  if (currentState.pending?.from === from && currentState.pending.to === to) return true;

  const registration = anchors[from];
  const fallbackElement = document.querySelector<HTMLElement>(`[data-personal-avatar-anchor="${from}"]`);
  const sourceElement = registration?.element.isConnected ? registration.element
    : fallbackElement?.isConnected ? fallbackElement : null;
  let sourceRect: AvatarRect | null = null;
  const media = mediaOverride ?? registration?.getMedia() ?? currentState.active?.media ?? lastKnownMedia;

  if (liveFlightNode?.isConnected) {
    const liveRect = liveFlightNode.getBoundingClientRect();
    if (isRectVisible(liveRect)) {
      sourceRect = {
        left: liveRect.left,
        top: liveRect.top,
        width: liveRect.width,
        height: liveRect.height,
      };
    }
  }
  if (!sourceRect && sourceElement) {
    const rect = sourceElement.getBoundingClientRect();
    if (isRectVisible(rect)) {
      sourceRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
  }
  if (!sourceRect || !media) return false;

  lastKnownMedia = media;
  clearPendingTimer();
  clearLandedTimer();
  const id = nextFlightId++;
  usePersonalAvatarFlightStore.setState({
    pending: { id, from, to, sourceRect, media },
    active: null,
    justLanded: null,
  });
  pendingTimeout = window.setTimeout(() => {
    const state = usePersonalAvatarFlightStore.getState();
    if (state.pending?.id === id) {
      usePersonalAvatarFlightStore.setState({ pending: null });
    }
  }, 360);
  return true;
}

export function completePendingPersonalAvatarFlight(
  anchor: PersonalAvatarAnchorId,
  targetElement: HTMLElement | null,
): boolean {
  const { pending } = usePersonalAvatarFlightStore.getState();
  if (!pending || pending.to !== anchor || !targetElement) return false;
  const targetRect = measureRestingAvatarRect(targetElement);
  if (!targetRect || !isRectVisible(targetRect)) return false;

  clearPendingTimer();
  const dx = Math.abs((pending.sourceRect.left + pending.sourceRect.width / 2) - (targetRect.left + targetRect.width / 2));
  const dy = Math.abs((pending.sourceRect.top + pending.sourceRect.height / 2) - (targetRect.top + targetRect.height / 2));
  const dw = Math.abs(pending.sourceRect.width - targetRect.width);
  if (dx < 2 && dy < 2 && dw < 2) {
    usePersonalAvatarFlightStore.setState({ pending: null, active: null });
    return false;
  }

  usePersonalAvatarFlightStore.setState({
    pending: null,
    active: {
      id: pending.id,
      from: pending.from,
      to: pending.to,
      sourceRect: pending.sourceRect,
      targetRect,
      media: pending.media,
    },
  });
  return true;
}

export function finishPersonalAvatarFlight(id: number, landed = true) {
  const { active } = usePersonalAvatarFlightStore.getState();
  if (!active || active.id !== id) return;
  clearLandedTimer();
  if (landed) {
    usePersonalAvatarFlightStore.setState({
      active: null,
      justLanded: { anchor: active.to, id },
    });
    landedTimeout = window.setTimeout(() => {
      const current = usePersonalAvatarFlightStore.getState();
      if (current.justLanded?.id === id) {
        usePersonalAvatarFlightStore.setState({ justLanded: null });
      }
    }, 440);
  } else {
    usePersonalAvatarFlightStore.setState({ active: null, justLanded: null });
  }
}

export function cancelPersonalAvatarFlight() {
  clearPendingTimer();
  clearLandedTimer();
  usePersonalAvatarFlightStore.setState({ pending: null, active: null, justLanded: null });
}

export function isPersonalAvatarAnchorHidden(state: FlightState, anchor: PersonalAvatarAnchorId): boolean {
  return state.pending?.to === anchor
    || state.active?.to === anchor
    || state.pending?.from === anchor
    || state.active?.from === anchor;
}

function sampleCubicBezier(t: number, x1: number, y1: number, x2: number, y2: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const sampleDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  let u = t;
  for (let i = 0; i < 6; i++) {
    const err = sampleX(u) - t;
    if (Math.abs(err) < 1e-6) break;
    const dx = sampleDX(u);
    if (Math.abs(dx) < 1e-6) break;
    u = Math.max(0, Math.min(1, u - err / dx));
  }
  return sampleY(u);
}

/**
 * Generates GPU-composited, unhurried curved-glide keyframes using an iOS-style
 * fluid easing curve so the avatar travels gracefully between header and right panel.
 */
export function buildPersonalAvatarFlightKeyframes(
  source: AvatarRect,
  target: AvatarRect,
  to: PersonalAvatarAnchorId,
): { keyframes: Keyframe[]; baseSize: number; duration: number } {
  const baseSize = Math.max(source.width, target.width, 1);
  const sx = source.left + source.width / 2;
  const sy = source.top + source.height / 2;
  const tx = target.left + target.width / 2;
  const ty = target.top + target.height / 2;
  const dx0 = sx - tx;
  const dy0 = sy - ty;
  const dist = Math.hypot(dx0, dy0);
  const s0 = source.width / baseSize;
  const s1 = target.width / baseSize;

  const opening = to === 'panel';
  const duration = opening ? 540 : 480;
  const distanceFactor = Math.min(1, dist / 36);
  const arcPeak = Math.min(18, Math.max(5, dist * 0.04)) * distanceFactor;
  const travelDir = Math.sign(tx - sx) || (opening ? 1 : -1);
  const maxTilt = Math.min(2.4, Math.max(0.8, Math.abs(tx - sx) * 0.005)) * distanceFactor;

  const steps = 36;
  const keyframes: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (i === 0) {
      keyframes.push({
        offset: 0,
        transform: `translate3d(${dx0.toFixed(2)}px, ${dy0.toFixed(2)}px, 0) scale(${s0.toFixed(4)}, ${s0.toFixed(4)}) rotate(0deg)`,
      });
      continue;
    }
    if (i === steps) {
      keyframes.push({
        offset: 1,
        transform: `translate3d(0px, 0px, 0) scale(${s1.toFixed(4)}, ${s1.toFixed(4)}) rotate(0deg)`,
      });
      continue;
    }
    const p = sampleCubicBezier(t, 0.38, 0.04, 0.18, 1);
    const x = dx0 * (1 - p);
    const arcEnv = Math.sin(p * Math.PI);
    const y = dy0 * (1 - p) - arcPeak * arcEnv;
    const scale = s0 + (s1 - s0) * p;
    const tilt = travelDir * maxTilt * Math.sin(p * Math.PI);
    keyframes.push({
      offset: t,
      transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)}, ${scale.toFixed(4)}) rotate(${tilt.toFixed(2)}deg)`,
    });
  }

  return { keyframes, baseSize, duration };
}

/** Fixed-layer portal that smoothly flies the Personal Agent avatar across layout boundaries. */
export function PersonalAvatarFlightOverlay() {
  const active = usePersonalAvatarFlightStore(state => state.active);
  const flightRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!active || !flightRef.current) return;
    const node = flightRef.current;
    liveFlightNode = node;
    const { keyframes, duration } = buildPersonalAvatarFlightKeyframes(
      active.sourceRect,
      active.targetRect,
      active.to,
    );

    let done = false;
    let animation: Animation | undefined;
    let fallbackTimer: number | undefined;

    const settle = (landed: boolean) => {
      if (done) return;
      done = true;
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      window.removeEventListener('resize', onInterrupt);
      document.removeEventListener('visibilitychange', onVisibility);
      animation?.cancel();
      if (liveFlightNode === node) liveFlightNode = null;
      finishPersonalAvatarFlight(active.id, landed);
    };

    const onInterrupt = () => settle(false);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') settle(false);
    };

    try {
      animation = node.animate(keyframes, { duration, easing: 'linear', fill: 'both' });
    } catch {
      settle(false);
      return;
    }

    window.addEventListener('resize', onInterrupt);
    document.addEventListener('visibilitychange', onVisibility);
    fallbackTimer = window.setTimeout(() => settle(true), duration + 140);
    void animation.finished.then(() => settle(true), () => settle(false));

    return () => {
      done = true;
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      window.removeEventListener('resize', onInterrupt);
      document.removeEventListener('visibilitychange', onVisibility);
      animation?.cancel();
      if (liveFlightNode === node) liveFlightNode = null;
    };
  }, [active]);

  if (!active || typeof document === 'undefined') return null;

  const baseSize = Math.max(active.sourceRect.width, active.targetRect.width, 1);
  const targetCenterX = active.targetRect.left + active.targetRect.width / 2;
  const targetCenterY = active.targetRect.top + active.targetRect.height / 2;

  return createPortal(
    <div
      data-personal-avatar-flight
      data-flight-direction={active.to === 'panel' ? 'to-panel' : 'to-header'}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[95]"
    >
      <div
        ref={flightRef}
        data-personal-avatar-flight-node
        className={`relative grid place-items-center rounded-full will-change-transform ${active.to === 'panel' ? 'bg-surface-inset' : 'bg-surface-base'}`}
        style={{
          position: 'fixed',
          left: targetCenterX - baseSize / 2,
          top: targetCenterY - baseSize / 2,
          width: baseSize,
          height: baseSize,
          transformOrigin: 'center center',
        }}
      >
        <PersonalAvatar
          appearance={active.media.appearance}
          agentId={active.media.agentId}
          activity={active.media.activity}
          className="relative z-10 size-full"
        />
      </div>
    </div>,
    document.body,
  );
}

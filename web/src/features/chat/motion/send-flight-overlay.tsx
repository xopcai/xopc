import { useLayoutEffect, useRef, useState } from 'react';
import { Link2, Paperclip } from 'lucide-react';
import { createPortal } from 'react-dom';

import type { SendFlightRect, SendFlightRequest } from './send-flight.types';

const TARGET_SETTLE_FRAMES = 5;
const TARGET_WAIT_FRAMES = 18;
const TARGET_SETTLE_TOLERANCE_PX = 0.75;
const TARGET_DRIFT_TOLERANCE_PX = 2;
const MIN_FLIGHT_DURATION_MS = 480;
const MAX_FLIGHT_DURATION_MS = 620;
const MAX_FLIGHT_SURFACE_HEIGHT = 120;

interface SendFlightGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  destinationLeft: number;
  destinationTop: number;
}

interface PreparedSendFlight {
  geometry: SendFlightGeometry;
  ready: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function buildSendFlightGeometry(
  source: SendFlightRect,
  target: SendFlightRect,
  viewport: { width: number; height: number },
): SendFlightGeometry | null {
  if (source.width <= 0 || source.height <= 0 || target.width <= 0 || target.height <= 0) return null;

  const gutter = 8;
  const availableWidth = Math.max(0, viewport.width - gutter * 2);
  const availableHeight = Math.max(0, viewport.height - gutter * 2);
  if (
    target.width > availableWidth
    || target.height > availableHeight
    || target.height > MAX_FLIGHT_SURFACE_HEIGHT
  ) return null;
  const width = target.width;
  const height = target.height;

  return {
    left: clamp(source.left, gutter, viewport.width - width - gutter),
    top: clamp(source.top + (source.height - height) / 2, gutter, viewport.height - height - gutter),
    width,
    height,
    destinationLeft: clamp(target.left, gutter, viewport.width - width - gutter),
    destinationTop: clamp(target.top, gutter, viewport.height - height - gutter),
  };
}

export function sendFlightDurationMs(geometry: SendFlightGeometry): number {
  const distance = Math.hypot(
    geometry.destinationLeft - geometry.left,
    geometry.destinationTop - geometry.top,
  );
  return Math.round(clamp(
    MIN_FLIGHT_DURATION_MS + distance * 0.14,
    MIN_FLIGHT_DURATION_MS,
    MAX_FLIGHT_DURATION_MS,
  ));
}

export function isSendFlightRectStable(
  previous: SendFlightRect | null,
  next: SendFlightRect,
  tolerance = TARGET_SETTLE_TOLERANCE_PX,
): boolean {
  if (!previous) return false;
  return Math.abs(previous.left - next.left) <= tolerance
    && Math.abs(previous.top - next.top) <= tolerance
    && Math.abs(previous.width - next.width) <= tolerance
    && Math.abs(previous.height - next.height) <= tolerance;
}

function findFlightTarget(request: SendFlightRequest, allowLatestFallback: boolean): HTMLElement | null {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-message-row]'));
  for (const row of rows) {
    const matchesSubmission = row.dataset.clientSubmissionId === request.clientSubmissionId;
    const matchesRenderKey = Boolean(
      request.messageRenderKey && row.dataset.messageRenderKey === request.messageRenderKey,
    );
    if (!matchesSubmission && !matchesRenderKey) continue;
    return row.querySelector<HTMLElement>('[data-send-flight-target]');
  }
  if (!allowLatestFallback) return null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const target = rows[index]?.querySelector<HTMLElement>('[data-send-flight-target]');
    if (!target) continue;
    return target;
  }
  return null;
}

export function SendFlightOverlay({ request, onComplete }: {
  request: SendFlightRequest | null;
  onComplete: (clientSubmissionId: string) => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const completeRef = useRef(onComplete);
  const [preparedFlight, setPreparedFlight] = useState<PreparedSendFlight | null>(null);
  completeRef.current = onComplete;

  useLayoutEffect(() => {
    setPreparedFlight(null);
    targetRef.current = null;
    if (!request) return undefined;

    let cancelled = false;
    let frame = 0;
    let frameId = 0;
    let previewVisible = false;
    let stableFrames = 0;
    let previousTargetRect: SendFlightRect | null = null;
    const finish = () => {
      if (!cancelled) completeRef.current(request.clientSubmissionId);
    };
    const findTarget = () => {
      if (cancelled) return;
      frame += 1;
      const target = findFlightTarget(request, frame >= 3);
      if (target && frame >= 2) {
        const rect = target.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          if (frame >= TARGET_WAIT_FRAMES) {
            finish();
            return;
          }
          frameId = window.requestAnimationFrame(findTarget);
          return;
        }
        const targetRect = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
        const next = buildSendFlightGeometry(
          request.sourceRect,
          targetRect,
          { width: window.innerWidth, height: window.innerHeight },
        );
        if (!next || rect.bottom <= 0 || rect.top >= window.innerHeight) {
          finish();
          return;
        }
        if (!previewVisible) {
          previewVisible = true;
          setPreparedFlight({ geometry: next, ready: false });
        }
        stableFrames = isSendFlightRectStable(previousTargetRect, targetRect)
          ? stableFrames + 1
          : 0;
        previousTargetRect = targetRect;
        if (stableFrames >= TARGET_SETTLE_FRAMES) {
          targetRef.current = target;
          setPreparedFlight({ geometry: next, ready: true });
          return;
        }
      }
      if (frame >= TARGET_WAIT_FRAMES) {
        finish();
        return;
      }
      frameId = window.requestAnimationFrame(findTarget);
    };

    frameId = window.requestAnimationFrame(findTarget);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [request]);

  useLayoutEffect(() => {
    const element = overlayRef.current;
    const surface = surfaceRef.current;
    if (!request || !preparedFlight?.ready || !element || !surface) return undefined;
    const { geometry } = preparedFlight;

    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      completeRef.current(request.clientSubmissionId);
    };
    if (typeof element.animate !== 'function') {
      finish();
      return undefined;
    }
    const duration = sendFlightDurationMs(geometry);
    const from = `translate3d(${geometry.left}px, ${geometry.top}px, 0)`;
    const to = `translate3d(${geometry.destinationLeft}px, ${geometry.destinationTop}px, 0)`;
    const animation = element.animate([
      { transform: from },
      { transform: to },
    ], {
      duration,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'forwards',
    });
    const surfaceAnimation = surface.animate([
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.76 },
      { opacity: 0.72, offset: 0.88 },
      { opacity: 0, offset: 1 },
    ], {
      duration,
      easing: 'linear',
      fill: 'forwards',
    });
    const target = targetRef.current;
    const targetAnimation = target && typeof target.animate === 'function'
      ? target.animate([
          { opacity: 0, offset: 0 },
          { opacity: 0, offset: 0.76 },
          { opacity: 0.28, offset: 0.86 },
          { opacity: 0.72, offset: 0.95 },
          { opacity: 1, offset: 1 },
        ], {
          duration,
          easing: 'linear',
          fill: 'forwards',
        })
      : undefined;
    const interruptIfTargetMoved = () => {
      if (!target || animation.playState !== 'running') return;
      const rect = target.getBoundingClientRect();
      const drift = Math.hypot(
        rect.left - geometry.destinationLeft,
        rect.top - geometry.destinationTop,
      );
      if (drift > TARGET_DRIFT_TOLERANCE_PX) animation.cancel();
    };
    const interruptForResize = () => animation.cancel();
    document.addEventListener('scroll', interruptIfTargetMoved, { capture: true, passive: true });
    window.addEventListener('resize', interruptForResize, { passive: true });
    animation.addEventListener('finish', finish, { once: true });
    animation.addEventListener('cancel', finish, { once: true });
    const fallbackTimer = window.setTimeout(finish, duration + 100);

    return () => {
      window.clearTimeout(fallbackTimer);
      animation.removeEventListener('finish', finish);
      animation.removeEventListener('cancel', finish);
      document.removeEventListener('scroll', interruptIfTargetMoved, true);
      window.removeEventListener('resize', interruptForResize);
      animation.cancel();
      surfaceAnimation.cancel();
      targetAnimation?.cancel();
    };
  }, [preparedFlight, request]);

  if (!request || !preparedFlight) return null;
  const { geometry, ready } = preparedFlight;

  return createPortal(
    <div
      ref={overlayRef}
      aria-hidden="true"
      data-send-flight-overlay
      data-send-flight-phase={ready ? 'moving' : 'settling'}
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{
        width: geometry.width,
        height: geometry.height,
        transform: `translate3d(${geometry.left}px, ${geometry.top}px, 0)`,
        transformOrigin: 'top left',
        contain: 'layout paint style',
        willChange: ready ? 'transform' : undefined,
      }}
    >
      <div
        ref={surfaceRef}
        className="h-full w-full overflow-hidden rounded-2xl bg-surface-hover/80 px-4 py-3 text-left text-[0.9375rem] leading-[1.6667] text-fg dark:bg-surface-hover/50"
        style={{
          backfaceVisibility: 'hidden',
          willChange: ready ? 'opacity' : undefined,
        }}
      >
        {request.text ? (
          <div className="line-clamp-2 break-words whitespace-pre-wrap">{request.text}</div>
        ) : null}
        {(request.attachmentCount > 0 || request.contextCount > 0) ? (
          <div className="mt-1.5 flex items-center gap-3 text-xs text-fg-muted">
            {request.attachmentCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="size-3.5" strokeWidth={1.75} />
                {request.attachmentCount}
              </span>
            ) : null}
            {request.contextCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Link2 className="size-3.5" strokeWidth={1.75} />
                {request.contextCount}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

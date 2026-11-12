import { useCallback, useEffect, useState } from 'react';

import { attachGeneratedMedia, startGeneratedMedia, type GeneratedMediaSource } from './generated-media';

export function useGeneratedMedia({ kind, src, title }: GeneratedMediaSource) {
  const [element, setElement] = useState<HTMLMediaElement | null>(null);
  const hostRef = useCallback((host: HTMLDivElement | null) => {
    if (!host) return;
    const { element, detach } = attachGeneratedMedia({ kind, src, title }, host);
    setElement(element);
    return detach;
  }, [kind, src, title]);
  return { element, hostRef };
}

const mediaEvents = ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'volumechange', 'play', 'playing', 'waiting', 'pause', 'ended', 'error'];

function readMedia(element: HTMLMediaElement | null) {
  return {
    position: element?.currentTime ?? 0,
    duration: element && Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0,
    muted: element?.muted ?? false,
    volume: element?.volume ?? 1,
    playing: Boolean(element && !element.paused && !element.ended),
    failed: Boolean(element?.error),
  };
}

export function useGeneratedMediaControls(element: HTMLMediaElement | null) {
  const [snapshot, setSnapshot] = useState(() => readMedia(element));
  const [startingElement, setStartingElement] = useState<HTMLMediaElement | null>(null);
  const [failedElement, setFailedElement] = useState<HTMLMediaElement | null>(null);

  useEffect(() => {
    const update = () => setSnapshot(readMedia(element));
    update();
    if (!element) return;
    for (const event of mediaEvents) element.addEventListener(event, update);
    return () => {
      for (const event of mediaEvents) element.removeEventListener(event, update);
    };
  }, [element]);

  const toggle = () => {
    if (!element) return;
    if (!element.paused && !element.ended) {
      element.pause();
      return;
    }
    setFailedElement(null);
    setStartingElement(element);
    void startGeneratedMedia(element).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailedElement(element);
    }).finally(() => setStartingElement(current => current === element ? null : current));
  };

  const seek = (next: number) => {
    if (!element || !snapshot.duration) return;
    element.currentTime = next;
    setSnapshot(readMedia(element));
  };

  return { ...snapshot, starting: Boolean(element && startingElement === element),
    failed: snapshot.failed || Boolean(element && failedElement === element), toggle, seek };
}

export function formatPlaybackTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

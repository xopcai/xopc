import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { renderLoopiSvg } from '../../../../src/pets/loopi-artwork';

import type { DesktopPetAction } from '@/types/electron';

import { followLoopiPointer } from './loopi-pointer-motion';

import './loopi-desktop-pet.css';

export function loopiStateForAction(action: DesktopPetAction): string {
  if (['research', 'read', 'create', 'execute', 'prepare'].includes(action)) return 'work';
  if (action === 'success') return 'done';
  if (action === 'wait') return 'wait';
  if (['sleep', 'concern', 'pickedUp', 'released'].includes(action)) return action;
  return 'idle';
}

export function LoopiDesktopPet({ action, animationKey, displayHeight, reducedMotion, className }: {
  action: DesktopPetAction;
  animationKey?: string;
  displayHeight: number;
  reducedMotion: boolean;
  className?: string;
}) {
  const id = useId();
  const artwork = useMemo(() => ({ __html: renderLoopiSvg(id.replace(/[^a-zA-Z0-9_-]/g, '')) }), [id]);
  const host = useRef<HTMLSpanElement>(null);
  const [paused, setPaused] = useState(() => document.hidden);
  const playback = useRef({ action, animationKey });
  const pointerMotion = useRef<ReturnType<typeof followLoopiPointer> | null>(null);
  const followingDisabled = paused || reducedMotion || action === 'sleep' || action === 'pickedUp' || action === 'released';

  useEffect(() => {
    if (!host.current) return;
    const motion = followLoopiPointer(host.current, false);
    pointerMotion.current = motion;
    return () => { motion.dispose(); pointerMotion.current = null; };
  }, []);

  useEffect(() => {
    pointerMotion.current?.setEnabled(!followingDisabled);
  }, [followingDisabled]);

  useLayoutEffect(() => {
    const previous = playback.current;
    playback.current = { action, animationKey };
    if (action !== 'success' || previous.action !== 'success' || previous.animationKey === animationKey) return;
    // Consecutive completed runs replay their celebration without replacing the SVG.
    for (const animation of host.current?.getAnimations?.({ subtree: true }) ?? []) animation.currentTime = 0;
  }, [action, animationKey]);

  useEffect(() => {
    let visible = true;
    const update = () => setPaused(document.hidden || !visible);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    if (host.current) observer.observe(host.current);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return <span
    ref={host}
    className={`loopi-desktop ${className ?? ''}`}
    data-state={loopiStateForAction(action)}
    data-paused={paused}
    data-reduced-motion={reducedMotion}
    style={{ width: displayHeight, height: displayHeight }}
    aria-hidden
    // Artwork is static application-owned SVG; no pet package content is interpolated.
    dangerouslySetInnerHTML={artwork}
  />;
}

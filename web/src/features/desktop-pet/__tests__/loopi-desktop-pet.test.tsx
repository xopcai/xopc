// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopPetAction } from '@/types/electron';

import { LoopiDesktopPet, loopiStateForAction } from '../loopi-desktop-pet';

describe('Loopi desktop renderer', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let onIntersection: IntersectionObserverCallback;
  const disconnect = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { onIntersection = callback; }
      observe() {}
      disconnect = disconnect;
    });
    disconnect.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    delete window.electronAPI;
  });

  it('retains the latest cursor while paused or dragged, restores it without movement, and cleans up on unmount', () => {
    container.className = 'desktop-pet-window';
    let pointer: (point: { x: number; y: number }) => void = () => {};
    const off = vi.fn();
    const subscribe = vi.fn((callback: typeof pointer) => { pointer = callback; return off; });
    window.electronAPI = { pet: { onPointerChanged: subscribe } } as never;
    render('idle');
    const host = container.querySelector<HTMLElement>('.loopi-desktop')!;
    const svg = host.querySelector('svg');
    act(() => pointer({ x: 1, y: -.5 }));
    expect(host.style.getPropertyValue('--loopi-pointer-x')).toBe('1');
    expect(host.style.getPropertyValue('--loopi-pointer-y')).toBe('-0.5');
    render('execute');
    expect(host.querySelector('svg')).toBe(svg);
    expect(host.style.getPropertyValue('--loopi-pointer-x')).toBe('1');
    render('pickedUp');
    expect(off).not.toHaveBeenCalled();
    expect(host.style.getPropertyValue('--loopi-pointer-x')).toBe('0');
    act(() => pointer({ x: -.6, y: .2 }));
    expect(host.style.getPropertyValue('--loopi-pointer-x')).toBe('0');
    render('wait');
    expect(subscribe).toHaveBeenCalledOnce();
    expect(host.style.getPropertyValue('--loopi-pointer-x')).toBe('-0.6');
    render('wait', true);
    expect(host.style.getPropertyValue('--loopi-pointer-x')).toBe('0');
    render('wait');
    expect(host.style.getPropertyValue('--loopi-pointer-x')).toBe('-0.6');
    expect(host.querySelector('svg')).toBe(svg);
    act(() => root.unmount());
    expect(off).toHaveBeenCalledOnce();
    root = createRoot(container);
  });

  function render(action: DesktopPetAction, reducedMotion = false) {
    act(() => root.render(<LoopiDesktopPet action={action} displayHeight={112} reducedMotion={reducedMotion} />));
  }

  it('keeps layered artwork stable while real task states change', () => {
    render('idle');
    const svg = container.querySelector('svg');
    for (const [action, state] of [['execute', 'work'], ['wait', 'wait'], ['success', 'done']] as const) {
      render(action);
      expect(container.firstElementChild?.getAttribute('data-state')).toBe(state);
      expect(container.querySelector('svg')).toBe(svg);
    }
    expect(container.querySelectorAll('.loopi-pet-core-motion')).toHaveLength(1);
    expect(container.querySelectorAll('.loopi-pet-happy-eyes')).toHaveLength(1);
  });

  it('pauses offscreen animation, resumes it on return, and exposes reduced motion', () => {
    render('execute', true);
    expect(container.firstElementChild?.getAttribute('data-reduced-motion')).toBe('true');
    act(() => onIntersection([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(container.firstElementChild?.getAttribute('data-paused')).toBe('true');
    act(() => onIntersection([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(container.firstElementChild?.getAttribute('data-paused')).toBe('false');
    act(() => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
    root = createRoot(container);
  });

  it('uses work animation for every active tool phase and retains sleep and drag states', () => {
    for (const action of ['prepare', 'research', 'read', 'create', 'execute'] as const) {
      expect(loopiStateForAction(action)).toBe('work');
    }
    for (const action of ['sleep', 'concern', 'pickedUp', 'released'] as const) {
      expect(loopiStateForAction(action)).toBe(action);
    }
  });

  it('replays consecutive completed runs without remounting the artwork', () => {
    act(() => root.render(<LoopiDesktopPet action="success" animationKey="run-1" displayHeight={112} reducedMotion={false} />));
    const svg = container.querySelector('svg');
    const animation = { currentTime: 500 };
    const getAnimations = vi.fn(() => [animation]);
    Object.assign(container.firstElementChild!, { getAnimations });
    act(() => root.render(<LoopiDesktopPet action="success" animationKey="run-2" displayHeight={112} reducedMotion={false} />));
    expect(animation.currentTime).toBe(0);
    expect(container.querySelector('svg')).toBe(svg);
    animation.currentTime = 200;
    act(() => root.render(<LoopiDesktopPet action="success" animationKey="run-2" displayHeight={112} reducedMotion={false} />));
    expect(animation.currentTime).toBe(200);
  });
});

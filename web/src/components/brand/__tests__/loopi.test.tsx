// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Loopi } from '../loopi';

describe('Loopi companion', () => {
  let container: HTMLDivElement;
  let root: Root;
  let reduced = false;
  let intersection: IntersectionObserverCallback;
  const disconnect = vi.fn();
  const requestFrame = vi.fn((_callback: FrameRequestCallback) => 42);
  const cancelFrame = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    reduced = false;
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersection = callback; }
      observe() {}
      disconnect = disconnect;
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount()); container.remove();
    vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks();
    requestFrame.mockImplementation(() => 42);
  });

  it('keeps paint IDs unique, the face upright, and avatars free of nested buttons', () => {
    act(() => root.render(<><a href="/user-model"><Loopi variant="avatar" /></a><Loopi /></>));
    const ids = Array.from(container.querySelectorAll('[id]'), element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelector('a button')).toBeNull();
    expect(container.querySelector('[data-face-rotation]')?.getAttribute('data-face-rotation')).toBe('0');
  });

  it('keeps sidebar avatars asleep until keyboard focus and cleans up on unmount', () => {
    act(() => root.render(<a href="/user-model"><Loopi variant="avatar" /></a>));
    expect(requestFrame).not.toHaveBeenCalled();
    act(() => container.querySelector('a')!.focus());
    expect(requestFrame).toHaveBeenCalled();
    act(() => root.render(null));
    expect(disconnect).toHaveBeenCalled();
    expect(cancelFrame).toHaveBeenCalledWith(42);
    requestFrame.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('honors reduced motion while reflecting actual mood changes', () => {
    reduced = true;
    act(() => root.render(<Loopi interactive mood="decision" />));
    expect(requestFrame).not.toHaveBeenCalled();
    expect(container.querySelector('svg')?.dataset.mood).toBe('decision');
    act(() => root.render(<Loopi interactive mood="care" />));
    expect(container.querySelector('svg')?.dataset.mood).toBe('care');
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('looks around without pointer input, while keeping the face upright', () => {
    vi.spyOn(Math, 'random').mockReturnValue(.75);
    let frame: FrameRequestCallback = () => {};
    requestFrame.mockImplementation(callback => { frame = callback; return 42; });
    act(() => root.render(<Loopi interactive cycle />));
    const face = container.querySelector('[data-part="face"]')!;
    const initial = face.getAttribute('transform');
    for (let now = 16; now <= 1440; now += 16) frame(now);
    expect(face.getAttribute('transform')).not.toBe(initial);
    expect(face.getAttribute('transform')).not.toContain('rotate');
    expect(container.querySelector('svg')?.dataset.mood).toBe('listen');
  });

  it('has no playback control and stops while offscreen, then resumes', () => {
    act(() => root.render(<Loopi interactive cycle language="zh" />));
    expect(container.querySelector('.loopi-pause')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('和小环打个招呼');
    requestFrame.mockClear();
    act(() => intersection([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(requestFrame).not.toHaveBeenCalled();
    act(() => intersection([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(requestFrame).toHaveBeenCalled();
  });
});

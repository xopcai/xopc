// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loopiDesktopPet } from '../../../../../electron/desktop-pet/loopi';

import { DesktopPetRoot } from '../desktop-pet-root';

describe('native pet drag completion', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.electronAPI;
    vi.unstubAllGlobals();
  });

  it('tracks screen movement even when local coordinates stay fixed and ends on a window-level release', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    class Observer { observe() {} disconnect() {} }
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.stubGlobal('ResizeObserver', Observer);
    const drag = vi.fn(async () => {});
    const endDrag = vi.fn(async () => {});
    const openMainWindow = vi.fn();
    window.electronAPI = { pet: {
      getState: async () => ({
        prefs: { selectedPetId: 'loopi', sizePercent: 100, behaviorMode: 'companion', bubbleEnabled: true, interactionEnabled: true },
        relationship: {}, pets: [loopiDesktopPet], activities: [],
      }),
      onStateChanged: () => () => {}, onEvent: () => () => {},
      setContentSize: async () => {}, startDrag: async () => {}, drag, endDrag, openMainWindow,
    } } as never;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<DesktopPetRoot />));
    const pet = container.querySelector<HTMLButtonElement>('.desktop-pet-hit-area')!;
    pet.setPointerCapture = vi.fn();
    function pointer(type: string, target: EventTarget, screenX: number) {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { pointerId: 1, button: 0, clientX: 50, clientY: 50, screenX, screenY: 300 });
      act(() => target.dispatchEvent(event));
    }
    pointer('pointerdown', pet, 200);
    pointer('pointermove', pet, 260);
    expect(drag).toHaveBeenCalledWith({ screenX: 260, screenY: 300 });
    pointer('pointerup', window, 260);
    expect(endDrag).toHaveBeenCalledOnce();
    pointer('pointerdown', pet, 200);
    pointer('pointerup', window, 360);
    expect(drag).toHaveBeenLastCalledWith({ screenX: 360, screenY: 300 });
    expect(endDrag).toHaveBeenCalledTimes(2);
    act(() => pet.click());
    expect(openMainWindow).not.toHaveBeenCalled();
    pointer('pointerup', window, 260);
    expect(endDrag).toHaveBeenCalledTimes(2);
  });
});

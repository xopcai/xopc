// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loopiDesktopPet } from '../../../../../electron/desktop-pet/loopi';

import { DesktopPetRoot } from '../desktop-pet-root';

describe('opening a pet message', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.electronAPI;
    vi.unstubAllGlobals();
  });

  it.each(['waiting', 'success'] as const)('opens a %s message without replacing the pet SVG', async (state) => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    class Observer { observe() {} disconnect() {} }
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.stubGlobal('ResizeObserver', Observer);
    const openMainWindow = vi.fn(async () => {});
    const acknowledgeEvent = vi.fn(async () => {});
    window.electronAPI = { pet: {
      getState: async () => ({
        prefs: { selectedPetId: 'loopi', sizePercent: 100, behaviorMode: 'companion', bubbleEnabled: true },
        relationship: {}, pets: [loopiDesktopPet],
        activities: [{ conversationId: 'conversation-1', runId: 'run-1', sequence: 1, timestamp: Date.now(), state, phase: 'waiting', action: 'Test task' }],
      }),
      onStateChanged: () => () => {}, onEvent: () => () => {},
      setContentSize: async () => {}, acknowledgeEvent, openMainWindow,
    } } as never;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<DesktopPetRoot />));
    const svg = container.querySelector('.loopi-desktop svg');
    expect(svg).not.toBeNull();
    const message = container.querySelector<HTMLButtonElement>('.desktop-pet-session-open')!;
    await act(async () => message.click());
    expect(openMainWindow).toHaveBeenCalledWith('/chat/conversation-1');
    expect(acknowledgeEvent).toHaveBeenCalledWith('conversation-1', 'run-1');
    expect(container.querySelector('.desktop-pet-queue')).toBeNull();
    expect(container.querySelector('.loopi-desktop svg')).toBe(svg);
    expect(container.querySelector('.loopi-desktop')?.getAttribute('data-state')).toBe('idle');
  });
});

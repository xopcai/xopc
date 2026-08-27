// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PetSessionUpdate } from '@/types/electron';

import { DesktopPetEventBridge } from '../desktop-pet-event-bridge';

vi.mock('@/lib/fetch', () => ({
  apiFetch: vi.fn(async () => ({ ok: false })),
}));

describe('DesktopPetEventBridge', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const sendEvent = vi.fn(async (_update: PetSessionUpdate) => {});

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    sendEvent.mockClear();
    window.electronAPI = { pet: { sendEvent } } as never;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<DesktopPetEventBridge />));
  });

  afterEach(() => {
    act(() => root.unmount());
    delete window.electronAPI;
    container.remove();
    vi.useRealTimers();
  });

  function stream(type: string, payload: Record<string, unknown> = {}): void {
    window.dispatchEvent(new CustomEvent('agent-stream-event', {
      detail: {
        sessionKey: 'agent:main:webchat:test',
        activityDetailLevel: 'stream',
        event: { type, runId: 'run-1', payload },
      },
    }));
  }

  it('does not let delta coalescing swallow animation transitions', () => {
    act(() => {
      stream('run_start');
      stream('assistant_message_start', { messageId: 'm1' });
      stream('assistant_delta', { messageId: 'm1', delta: 'Hello' });
      stream('run_end', { status: 'success' });
    });

    expect(sendEvent.mock.calls.map(([update]) => update.animation)).toEqual([
      'prepare',
      'create',
      'success',
    ]);
    act(() => vi.advanceTimersByTime(500));
    expect(sendEvent).toHaveBeenCalledTimes(3);
  });

  it('keeps repeated output updates coalesced after create starts immediately', () => {
    act(() => {
      stream('assistant_message_start', { messageId: 'm1' });
      stream('assistant_delta', { messageId: 'm1', delta: 'A' });
      stream('assistant_delta', { messageId: 'm1', delta: 'B' });
    });

    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent.mock.calls[0]?.[0]).toMatchObject({ animation: 'create' });
    act(() => vi.advanceTimersByTime(500));
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(sendEvent.mock.calls[1]?.[0]).toMatchObject({
      animation: 'create',
      sequence: 3,
    });
  });
});

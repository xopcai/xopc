// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({ portal: false }));
vi.mock('@/lib/use-media-query', () => ({ useMediaQuery: () => media.portal }));
vi.mock('@/features/voice/realtime/use-realtime-voice', () => ({
  useRealtimeVoice: () => ({
    phase: 'idle',
    voiceActive: false,
    elapsedLabel: '00:00',
    audioLevel: 0,
    partialTranscript: '',
    finalTranscript: '',
    error: null,
    settingsRequired: false,
    startVoiceInput: vi.fn(),
    cancelVoiceInput: vi.fn(),
    confirmVoiceInput: vi.fn(),
    retryVoiceInput: vi.fn(),
  }),
}));

import { SettingsSheet } from '@/components/shell/settings-sheet';
import { useGatewayStore } from '@/stores/gateway-store';
import { GlobalQuickCaptureHost } from '../global-quick-capture';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Location() {
  return <output data-testid="route">{useLocation().pathname}</output>;
}

const route = () => document.querySelector('[data-testid="route"]')?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useGatewayStore.setState({ conversationId: 'test-token' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  media.portal = false;
});

afterEach(async () => {
  try {
    await act(async () => {
      root.unmount();
      await vi.runOnlyPendingTimersAsync();
    });
  } finally {
    useGatewayStore.setState({ conversationId: '' });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

describe('GlobalQuickCaptureHost over SettingsSheet', () => {
  it.each([false, true])('focuses the textarea, allows typing, and closes without leaving settings (portal=%s)', async (portal) => {
    media.portal = portal;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/settings/overview']}>
          <GlobalQuickCaptureHost />
          <SettingsSheet>
            <button type="button">Settings control</button>
          </SettingsSheet>
          <Location />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('open-quick-capture'));
      await vi.runOnlyPendingTimersAsync();
    });

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);

    const dialog = textarea!.closest<HTMLElement>('[role="dialog"]')!;
    expect(dialog.style.pointerEvents).toBe('auto');

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      nativeSetter.call(textarea, 'Quick note');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(textarea!.value).toBe('Quick note');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await vi.runOnlyPendingTimersAsync();
    });
    expect(document.querySelector('textarea')).toBeNull();
    expect(route()).toBe('/settings/overview');
  });
});

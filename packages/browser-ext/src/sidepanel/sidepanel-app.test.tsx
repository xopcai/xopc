// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('./auth', () => ({ readProfile: async () => ({ gatewayId: 'test', gatewayUrl: 'http://localhost', deviceId: 'device' }) }));
vi.mock('./chat-panel', () => ({ ChatPanel: () => null }));
vi.mock('./recording-panel', () => ({ RecordingPanel: () => null }));
import { SidePanelApp } from './sidepanel-app';

afterEach(() => vi.unstubAllGlobals());
it('shows one explicit resume control, and never resumes during initialization or reload', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const sendMessage = vi.fn(async (input: { type: string }) => input.type === 'browser/get-status' ? { controlPaused: true } : { ok: true });
  vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<SidePanelApp initialLocale="en" initialTheme="light" />));
    const buttons = [...container.querySelectorAll('button')].filter(button => button.textContent === 'browserControlResume');
    expect(buttons).toHaveLength(1);
    expect(sendMessage.mock.calls.some(([input]) => input.type === 'browser/resume-control')).toBe(false);
    await act(async () => buttons[0].click());
    expect(sendMessage).toHaveBeenCalledWith({ type: 'browser/resume-control' });
    expect(container.textContent).not.toContain('browserControlResume');
  } finally { await act(async () => root.unmount()); }
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import messages from '../../_locales/en/messages.json';

const mocks = vi.hoisted(() => ({ query: vi.fn(), update: vi.fn(), sendMessage: vi.fn(), gatewayFetch: vi.fn() }));
vi.mock('./auth', () => ({ gatewayFetch: mocks.gatewayFetch }));
import { RecordingPanel, recordingErrorMessage } from './recording-panel';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
const sessions = { id: 'recording', tabId: 2, state: 'recording' };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.query.mockResolvedValue([{ id: 1, active: true, title: 'New Tab', url: 'chrome://newtab' }]);
  mocks.sendMessage.mockResolvedValue({ ok: true, value: [] });
  mocks.update.mockResolvedValue({});
  vi.stubGlobal('chrome', {
    i18n: { getMessage: (key: keyof typeof messages) => messages[key]?.message || key },
    runtime: { sendMessage: mocks.sendMessage },
    tabs: { query: mocks.query, update: mocks.update, onActivated: event(), onUpdated: event(), onRemoved: event(), onCreated: event() },
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<RecordingPanel />)); }
function button(label: string) { return Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)!; }

describe('recording panel', () => {
  it('shows guidance and disables recording for internal browser pages', async () => {
    await render();
    expect(container.textContent).toContain('Open the website you want to record');
    expect(container.textContent).not.toContain('Error:');
    expect(button('Start recording').disabled).toBe(true);
    expect(mocks.sendMessage).toHaveBeenCalledWith({ type: 'browser/recording-command', operation: 'status' });
  });
  it('explicitly records the selected HTTP page even when the active tab is an internal page', async () => {
    mocks.query.mockResolvedValue([{ id: 1, active: true, title: 'Extensions', url: 'chrome://extensions' }, { id: 2, active: false, title: 'Orders', url: 'https://example.com/orders' }]);
    await render();
    expect(container.textContent).toContain('Orders');
    mocks.sendMessage.mockResolvedValue({ ok: true, value: sessions });
    await act(async () => button('Start recording').click());
    expect(mocks.update).toHaveBeenCalledWith(2, { active: true });
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({ type: 'browser/recording-command', operation: 'start', tabId: 2 });
    expect(button('Finish and save')).toBeDefined();
    expect(button('Pause')).toBeDefined();
    expect(container.querySelector('.recording-status.is-recording')).not.toBeNull();
  });
  it('requires selection if multiple websites are open and none is active', async () => {
    mocks.query.mockResolvedValue([{ id: 2, active: false, title: 'Orders', url: 'https://example.com' }, { id: 3, active: false, title: 'Reports', url: 'https://reports.example.com' }]);
    await render();
    expect(button('Start recording').disabled).toBe(true);
    await act(async () => {
      const select = container.querySelector('select')!;
      select.value = '3'; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(button('Start recording').disabled).toBe(false);
  });
  it('finishes without automatically rerunning the recorded business action', async () => {
    mocks.sendMessage.mockResolvedValue({ ok: true, value: [sessions] });
    await render();
    mocks.sendMessage.mockResolvedValue({ ok: true, value: { ...sessions, state: 'stopped' } });
    await act(async () => button('Finish and save').click());
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({ type: 'browser/recording-command', operation: 'finish' });
    expect(container.textContent).toContain('Saved locally. Syncing');
    expect(mocks.gatewayFetch).not.toHaveBeenCalled();
  });
  it('removes repeated error prefixes and localizes unavailable-page guidance', () => {
    expect(recordingErrorMessage(new Error('Error: Error: The tab was closed.'))).toBe('The tab was closed.');
    expect(recordingErrorMessage(new Error('Error: RECORDING_PAGE_UNAVAILABLE'))).toContain('Open the website you want to record');
  });
});

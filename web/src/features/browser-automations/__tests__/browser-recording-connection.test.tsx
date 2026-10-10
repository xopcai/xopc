// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const { api, install, open, extensionStatus } = vi.hoisted(() => ({
  api: { list: vi.fn(), recordingAvailability: vi.fn(), recording: vi.fn() },
  install: vi.fn(async () => ({})), open: vi.fn(async () => ({})), extensionStatus: vi.fn(),
}));
vi.mock('../browser-automation-api', () => ({ browserAutomationApi: api }));
vi.mock('@/features/settings/browser/browser-control-api', () => ({ installBrowserExtension: install, openBrowserExtension: open }));
vi.mock('@/lib/fetch', () => ({ fetchJson: extensionStatus }));

import { BrowserAutomationsPage } from '../browser-automations-page';

function Header() { return <>{usePageHeaderStore((state) => state.end)}</>; }
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  useLocaleStore.setState({ language: 'zh' });
  api.list.mockResolvedValue({ automations: [] });
  api.recordingAvailability.mockResolvedValue({ state: 'connect_required', endpoints: [] });
  extensionStatus.mockResolvedValue({ artifacts: { installed: false, extensionDir: '/extension' } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<MemoryRouter><Header /><BrowserAutomationsPage /></MemoryRouter>)); }
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
it('shows installation guidance on the empty page instead of dispatching a disconnected recording', async () => {
  await render(); await click('录制我的操作');
  expect(container.textContent).toContain('连接 Chrome，录制你的操作');
  expect(container.textContent).not.toContain('Error:');
  expect(api.recording).not.toHaveBeenCalled();
  await click('安装 Chrome 扩展');
  expect(install).toHaveBeenCalledWith(false);
  expect(open).toHaveBeenCalledWith('both');
  expect(container.textContent).toContain('加载已解压的扩展程序');
});
it('distinguishes an outdated connected extension and refreshes its files', async () => {
  api.recordingAvailability.mockResolvedValue({ state: 'update_required', endpoints: [] });
  extensionStatus.mockResolvedValue({ artifacts: { installed: true, extensionDir: '/extension' } });
  await render(); await click('录制我的操作'); await click('更新并打开扩展页');
  expect(install).toHaveBeenCalledWith(true);
  expect(open).toHaveBeenCalledWith('chrome');
  expect(container.textContent).toContain('重新加载');
  expect(api.recording).not.toHaveBeenCalled();
});
it('continues from connection guidance with the newly connected browser', async () => {
  await render(); await click('录制我的操作');
  api.recordingAvailability.mockResolvedValue({ state: 'ready', endpoints: [{ endpointId: 'chrome', displayName: 'Chrome' }] });
  api.recording.mockResolvedValue({ endpointId: 'chrome', value: { id: 'recording', state: 'recording', automationId: 'saved' } });
  await click('检查连接');
  expect(container.textContent).toContain('浏览器已连接');
  expect(api.recording).not.toHaveBeenCalled();
  await click('开始录制');
  expect(api.recording).toHaveBeenCalledWith('start', 'chrome');
  expect(container.textContent).toContain('完成并保存');
  expect(container.textContent).not.toContain('连接 Chrome，录制你的操作');
});
it('requires a browser choice instead of silently starting on one of multiple browsers', async () => {
  api.recordingAvailability.mockResolvedValue({ state: 'choose_browser', endpoints: [{ endpointId: 'one', displayName: 'Work Chrome' }, { endpointId: 'two', displayName: 'Personal Chrome' }] });
  await render(); await click('录制我的操作');
  const start = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '开始录制');
  expect(start?.disabled).toBe(true);
  expect(container.textContent).toContain('选择浏览器');
  expect(api.recording).not.toHaveBeenCalled();
});
it('starts immediately when one browser is ready, without showing a setup or approval step', async () => {
  api.recordingAvailability.mockResolvedValue({ state: 'ready', endpoints: [{ endpointId: 'chrome', displayName: 'Chrome' }] });
  api.recording.mockResolvedValue({ endpointId: 'chrome', value: { id: 'recording', state: 'recording', automationId: 'saved' } });
  await render(); await click('录制我的操作');
  expect(api.recording).toHaveBeenCalledWith('start', 'chrome');
  expect(extensionStatus).not.toHaveBeenCalled();
  expect(container.textContent).toContain('完成并保存');
});
it('shows guidance if the connection disappears between the check and the start request', async () => {
  api.recordingAvailability.mockResolvedValue({ state: 'ready', endpoints: [{ endpointId: 'chrome', displayName: 'Chrome' }] });
  api.recording.mockRejectedValue(Object.assign(new Error('Recording requires a connected browser with recording support.'), { body: { code: 'connect_required', endpoints: [] } }));
  await render(); await click('录制我的操作');
  expect(container.textContent).toContain('连接 Chrome，录制你的操作');
  expect(container.textContent).not.toContain('Recording requires');
});

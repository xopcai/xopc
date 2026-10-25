// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/features/settings/runtime-tools/phone-dependencies-card', () => ({ PhoneDependenciesCard: () => null }));

const fixture = vi.hoisted(() => ({
  cloudOnly: false,
  defaults: { models: { chat: { primary: 'chat/model', fallbacks: [] }, phoneUse: { primary: 'phone-mock/settings-about', fallbacks: [] } }, tools: { exec_command: { mode: 'deny' } } },
}));
vi.mock('@/features/settings/global-defaults-api', () => ({
  fetchGlobalDefaults: vi.fn(async () => ({ defaults: structuredClone(fixture.defaults), builtinTools: [] })),
  updateGlobalDefaults: vi.fn(async defaults => { fixture.defaults = defaults; return { defaults, builtinTools: [] }; }),
}));
vi.mock('../phone-model-connection', () => ({ PhoneModelConnection: ({ onSave }: { onSave(value: string): Promise<void> }) => <button onClick={() => { void onSave('phone-bigmodel/autoglm-phone'); }}>Save AutoGLM</button> }));
vi.mock('../phone-api', () => ({
  MOCK_MODEL: 'phone-mock/settings-about',
  fetchPhoneSettings: async () => ({ config: { enabled: true }, agentId: 'main' }),
  fetchPhoneDevices: async () => ({ devices: [{ id: 'phone-one', name: 'Local emulator', serial: 'emulator-5554', enabled: true, allowedApps: ['com.android.settings'], ...(fixture.cloudOnly ? { connection: { kind: 'aliyun-adb', endpoint: 'cloud.example:10001' } } : {}) }], discovery: [{ serial: 'emulator-5554', state: 'device', emulator: true }], defaultDeviceId: 'phone-one', diagnostic: fixture.cloudOnly ? 'PHONE_ADB_UNAVAILABLE' : undefined }),
  fetchPhoneApplications: vi.fn(async () => [{ packageName: 'com.android.settings', label: '设置' }, { packageName: 'com.android.deskclock', label: '时钟' }]),
  fetchPhoneScreen: vi.fn(),
  phoneRequest: vi.fn(async path => path === '/sessions' ? { id: 'session-one', report: {} } : path === '/sessions/session-one' ? { status: 'ready', actions: 0, modelRequests: 0, deviceName: 'Local emulator', facts: [] } : {}),
}));

import { usePhoneWorkspaceStore } from '@/features/phone/phone-workspace-store';
import { PhoneSettingsPage } from '../phone-settings-page';
import { fetchPhoneScreen, phoneRequest } from '../phone-api';
import { updateGlobalDefaults } from '@/features/settings/global-defaults-api';
import { useLocaleStore } from '@/stores/locale-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.cloudOnly = false;
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:phone-preview'), revokeObjectURL: vi.fn() });
  vi.mocked(fetchPhoneScreen).mockResolvedValue(new Blob(['pixels'], { type: 'image/png' }));
  sessionStorage.clear(); useLocaleStore.setState({ language: 'zh' });
  fixture.defaults.models.phoneUse = { primary: 'phone-mock/settings-about', fallbacks: [] };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><MemoryRouter><PhoneSettingsPage /></MemoryRouter></SWRConfig>)); }
async function click(label: string) { await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === label)!.click()); }

it('shows model, device and test setup without triggering input actions on load', async () => {
  await render();
  expect(container.querySelector('header a')?.textContent).toBe('AI 配置');
  expect(container.querySelectorAll('a[href*="skill=configure-xopc"]')).toHaveLength(1);
  expect(container.textContent).toContain('手机管理'); expect(container.textContent).toContain('Local emulator');
  expect(container.textContent).not.toContain('运行模拟测试');
  expect(container.textContent).toContain('本次授权的小目标');
  expect(phoneRequest).not.toHaveBeenCalled();
});
it('does not report missing host ADB as an error for cloud-only phones', async () => {
  fixture.cloudOnly = true; await render();
  expect(container.textContent).not.toContain('PHONE_ADB_UNAVAILABLE');
  expect(container.textContent).not.toContain('检查 Gateway 电脑的 Android SDK 与 ADB');
});
it('saves only the model route while preserving chat and unrelated tool policies', async () => {
  await render(); await click('Save AutoGLM');
  expect(updateGlobalDefaults).toHaveBeenCalledWith(expect.objectContaining({ models: {
    chat: { primary: 'chat/model', fallbacks: [] }, phoneUse: { primary: 'phone-bigmodel/autoglm-phone', fallbacks: [] },
  }, tools: { exec_command: { mode: 'deny' } } }), expect.objectContaining({ scope: 'models' }));
});
it('disables test runs for a previously saved mock model', async () => {
  await render();
  const start = [...container.querySelectorAll('button')].find(button => button.textContent === '开始试运行')!;
  expect(start.disabled).toBe(true);
  await act(async () => start.click());
  expect(phoneRequest).not.toHaveBeenCalled();
});

it('manages phones without a second Agent allowlist', async () => {
  await render(); await click('管理');
  expect(document.body.textContent).not.toContain('允许的 Agent ID');
  expect(document.body.textContent).toContain('已启用 phone_use 工具的 Agent');
});

it('opens the shared global viewer in read-only mode without a separate screen dialog', async () => {
  usePhoneWorkspaceStore.setState({ open: false, selected: null, controlConversationId: 'another-chat' });
  await render(); await click('查看屏幕');
  expect(phoneRequest).toHaveBeenCalledWith('/devices/phone-one/view', {});
  expect(usePhoneWorkspaceStore.getState()).toMatchObject({ open: true, selected: 'phone-one', controlConversationId: null });
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(fetchPhoneScreen).not.toHaveBeenCalled();
});
it('reports a failed connection without opening an unrelated phone', async () => {
  usePhoneWorkspaceStore.setState({ open: false, selected: null, controlConversationId: null });
  vi.mocked(phoneRequest).mockRejectedValueOnce(new Error('Phone offline'));
  await render(); await click('查看屏幕');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Phone offline');
  expect(usePhoneWorkspaceStore.getState().open).toBe(false);
});
it('creates a device-bound conversation without sending any phone operation', async () => {
  vi.mocked(phoneRequest).mockResolvedValueOnce({ conversationId: 'new-phone-chat' });
  const created = vi.fn(); window.addEventListener('session-created', created);
  try {
    await render(); await click('对话控制手机');
    expect(phoneRequest).toHaveBeenCalledWith('/devices/phone-one/conversations', {});
    expect(phoneRequest).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledOnce();
  } finally { window.removeEventListener('session-created', created); }
});
it('updates diagnostics in the reserved device row without inserting a page banner', async () => {
  await render();
  const row = container.querySelector('[aria-label="手机管理"] [role="status"]')!;
  expect(row.textContent).toBe(''); expect(row.className).toContain('h-5');
  vi.mocked(phoneRequest).mockResolvedValueOnce({ state: 'device' });
  await act(async () => { container.querySelector('[aria-haspopup="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await act(async () => { (document.body.querySelector('[role="menuitem"]') as HTMLElement).click(); });
  expect(row.textContent).toContain('已连接');
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  vi.mocked(phoneRequest).mockRejectedValueOnce(new Error('ADB unavailable'));
  await act(async () => { container.querySelector('[aria-haspopup="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await act(async () => { (document.body.querySelector('[role="menuitem"]') as HTMLElement).click(); });
  expect(row.textContent).toBe('ADB unavailable');
  expect(row.className).toContain('h-5');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('replaces package editing with a native app picker and saves explicit all-app access', async () => {
  await render(); await click('管理');
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).not.toContain('允许的应用包名');
  expect(dialog.querySelector('input[aria-label="设置"]')).not.toBeNull();
  await act(async () => (dialog.querySelector('input[type="radio"][value="all"]') as HTMLInputElement).click());
  expect(dialog.querySelector('input[aria-label="设置"]')).toBeNull();
  await act(async () => [...dialog.querySelectorAll('button')].find(b => b.textContent === '保存手机')!.click());
  expect(phoneRequest).toHaveBeenCalledWith('/devices/phone-one', { name: 'Local emulator', appAccess: 'all', allowedApps: [], textInput: 'auto', enabled: true }, 'PATCH');
});

it('saves selected applications by their native labels without editing package names', async () => {
  await render(); await click('管理');
  const dialog = document.body.querySelector('[role="dialog"]')!;
  const settings = dialog.querySelector('input[aria-label="设置"]') as HTMLInputElement;
  const clock = dialog.querySelector('input[aria-label="时钟"]') as HTMLInputElement;
  expect(settings.checked).toBe(true);
  await act(async () => { clock.click(); settings.click(); });
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain('1');
  await act(async () => [...dialog.querySelectorAll('button')].find(b => b.textContent === '保存手机')!.click());
  expect(phoneRequest).toHaveBeenCalledWith('/devices/phone-one', { name: 'Local emulator', appAccess: 'selected', allowedApps: ['com.android.deskclock'], textInput: 'auto', enabled: true }, 'PATCH');
});

it('defaults to main Agent collaboration and saves direct execution without changing other phone settings', async () => {
  await render();
  const selector = container.querySelector('[aria-label="默认执行方式"]') as HTMLButtonElement;
  expect(selector.textContent).toContain('主 Agent 协作');
  await act(async () => selector.click());
  await act(async () => [...document.body.querySelectorAll('button')].find(b => b.textContent === '直接执行')!.click());
  expect(phoneRequest).toHaveBeenCalledWith('/settings', { enabled: true, executionMode: 'direct' }, 'PATCH');
});

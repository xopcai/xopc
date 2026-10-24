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

it('shows a fixed screen dialog and revokes its temporary image on close', async () => {
  await render(); await click('查看屏幕');
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  expect(dialog.className).toContain('h-[min(48rem,90dvh)]');
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe('blob:phone-preview');
  expect(container.querySelector('img')).toBeNull();
  expect(fetchPhoneScreen).toHaveBeenCalledWith('phone-one', expect.any(AbortSignal));
  await act(async () => (dialog.querySelector('[aria-label="关闭预览"]') as HTMLButtonElement).click());
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:phone-preview');
});
it('keeps loading and capture failures inside the dialog', async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(fetchPhoneScreen).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  await render(); await click('查看屏幕');
  expect(document.body.querySelector('[role="dialog"] [aria-busy="true"]')).not.toBeNull();
  await act(async () => reject(new Error('Phone offline')));
  expect(document.body.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('Phone offline');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it('discards a capture that completes after the dialog closes', async () => {
  let resolve!: (blob: Blob) => void;
  vi.mocked(fetchPhoneScreen).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await render(); await click('查看屏幕');
  await act(async () => (document.body.querySelector('[aria-label="关闭预览"]') as HTMLButtonElement).click());
  await act(async () => resolve(new Blob(['late pixels'])));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('updates diagnostics in the reserved device row without inserting a page banner', async () => {
  await render();
  const row = container.querySelector('[aria-label="手机管理"] [role="status"]')!;
  expect(row.textContent).toBe(''); expect(row.className).toContain('h-5');
  vi.mocked(phoneRequest).mockResolvedValueOnce({ state: 'device' });
  await click('诊断');
  expect(row.textContent).toContain('已连接');
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  vi.mocked(phoneRequest).mockRejectedValueOnce(new Error('ADB unavailable'));
  await click('诊断');
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

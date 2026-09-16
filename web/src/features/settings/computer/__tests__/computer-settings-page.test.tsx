// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/features/gateway/gateway-config-swr', () => ({ useGatewayConfigSwr: () => ({ data: { payload: { config: { computer: { enabled: false } } } }, mutate: vi.fn() }) }));
vi.mock('swr', () => ({ default: (key: string) => ({ data: key === 'gateway-configured-models'
  ? [{ id: 'dashscope-cn/gui-plus-2026-02-26', name: 'GUI-Plus', provider: 'dashscope-cn', computerUse: { profile: 'gui-plus-2026-02-26' } }]
  : { defaults: { models: {} } }, mutate: vi.fn() }) }));
vi.mock('@/features/chat/model/model-selector', () => ({ ModelSelector: ({ onChange }: any) => <>
  <button data-model="dashscope-cn/gui-plus-2026-02-26" onClick={() => onChange('dashscope-cn/gui-plus-2026-02-26')}>GUI-Plus</button>
  <button data-model="not-a-provider-model" onClick={() => onChange('not-a-provider-model')}>Invalid</button>
</> }));
vi.mock('@/features/settings/global-defaults-api', () => ({ fetchGlobalDefaults: vi.fn(), updateGlobalDefaults: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));
import { ComputerSettingsPanel } from '../computer-settings-page';
import { fetchJson } from '@/lib/fetch';
import { fetchGlobalDefaults, updateGlobalDefaults } from '@/features/settings/global-defaults-api';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
const previousApi = window.electronAPI;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; window.electronAPI = previousApi; vi.clearAllMocks(); });

async function renderPanel(zh = true) {
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><ComputerSettingsPanel zh={zh} /></MemoryRouter>));
  return container;
}

it('offers native reenrollment even when computer control is disabled and keeps cancellation retryable', async () => {
  const status = { connected: false, reenrollmentRequired: true, permissions: { accessibility: false, screenRecording: 'unknown' } };
  const reenroll = vi.fn().mockResolvedValueOnce(status).mockResolvedValueOnce({ ...status, reenrollmentRequired: false, connected: true });
  window.electronAPI = { platform: 'darwin', computer: { status: async () => status, stop: vi.fn(), reenroll } } as any;
  const container = await renderPanel();
  const button = () => [...container.querySelectorAll('button')].find(item => item.textContent === '重新注册桌面设备');
  expect(button()).toBeDefined();
  await act(async () => button()!.click());
  expect(reenroll).toHaveBeenCalledOnce();
  expect(button()).toBeDefined();
  await act(async () => button()!.click());
  expect(reenroll).toHaveBeenCalledTimes(2);
  expect(button()).toBeUndefined();
  expect(container.textContent).toContain('桌面已连接');
});

it('changes only computer enablement and links to existing browser and model settings', async () => {
  window.electronAPI = undefined;
  const container = await renderPanel();
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle.click());
  expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining('/api/config'), expect.objectContaining({
    method: 'PATCH', body: JSON.stringify({ computer: { enabled: true } }),
  }));
  expect(container.querySelector('a[href="/settings/agent-browser"]')).not.toBeNull();
  expect(container.querySelector('a[href="/settings/capabilities/models?add=1"]')).not.toBeNull();
  expect(container.textContent).toContain('网页控制台不能批准本机操作');
  expect(container.querySelector<HTMLButtonElement>('[aria-label="完全控制"]')!.disabled).toBe(true);
  expect(container.textContent).not.toContain('Excel');
});

it('wires missing macOS permissions and keeps stop usable during a pending permission request', async () => {
  const stop = vi.fn().mockResolvedValue({ ok: true });
  let finishPermission!: () => void;
  const requestAccessibility = vi.fn(() => new Promise<void>(resolve => { finishPermission = resolve; }));
  const requestScreen = vi.fn().mockResolvedValue({});
  window.electronAPI = { platform: 'darwin',
    computer: { status: async () => ({ connected: true, permissions: { accessibility: false, screenRecording: 'denied' } }), stop },
    system: { requestAccessibility, requestScreen },
  } as any;
  const container = await renderPanel();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开设置: 屏幕录制"]')!.click());
  expect(requestScreen).toHaveBeenCalledOnce();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开设置: 辅助功能"]')!.click());
  expect(requestAccessibility).toHaveBeenCalledOnce();
  const stopButton = [...container.querySelectorAll('button')].find(button => button.textContent === '停止桌面操作')!;
  expect(stopButton.disabled).toBe(false);
  await act(async () => stopButton.click());
  expect(stop).toHaveBeenCalledOnce();
  await act(async () => finishPermission());
});

it('does not offer native control actions on unsupported platforms', async () => {
  window.electronAPI = { platform: 'win32', computer: { status: vi.fn() }, system: {} } as any;
  const container = await renderPanel();
  expect(container.textContent).toContain('本机桌面控制目前仅支持 macOS');
  expect(container.textContent).not.toContain('停止桌面操作');
  expect(window.electronAPI!.computer!.status).not.toHaveBeenCalled();
});

it('reports native status failures instead of showing an unverified connection', async () => {
  window.electronAPI = { platform: 'darwin', computer: { status: vi.fn().mockRejectedValue(new Error('offline')), stop: vi.fn() } } as any;
  const container = await renderPanel();
  expect(container.textContent).toContain('无法读取桌面状态');
  expect(container.textContent).not.toContain('桌面已连接');
});

it('changes full control only through native settings and reflects cancellation and saved state', async () => {
  const status = { connected: true, fullControl: false, controlPaused: false, permissions: { accessibility: true, screenRecording: 'granted' } };
  const setFullControl = vi.fn().mockResolvedValueOnce(status).mockResolvedValueOnce({ ...status, fullControl: true }).mockResolvedValueOnce(status);
  window.electronAPI = { platform: 'darwin', computer: { status: async () => status, setFullControl } } as any;
  const container = await renderPanel();
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="完全控制"]')!;
  expect(toggle.disabled).toBe(false);
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(container.textContent).toContain('仅本机保存');
  await act(async () => toggle.click());
  expect(setFullControl.mock.calls.map(args => args[0])).toEqual([true, true, false]);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(fetchJson).not.toHaveBeenCalled();
});

it('shows native save errors without optimistically enabling full control', async () => {
  window.electronAPI = { platform: 'darwin', computer: {
    status: async () => ({ connected: true, fullControl: false, controlPaused: false, permissions: { accessibility: true, screenRecording: 'granted' } }),
    setFullControl: vi.fn().mockRejectedValue(new Error('disk full')),
  } } as any;
  const container = await renderPanel();
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="完全控制"]')!;
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(container.textContent).toContain('disk full');
});

it('refreshes stop state immediately and requires explicit resume', async () => {
  let paused = false;
  const status = () => ({ connected: true, fullControl: true, controlPaused: paused, permissions: { accessibility: true, screenRecording: 'granted' } });
  const resume = vi.fn(async () => { paused = false; return status(); });
  window.electronAPI = { platform: 'darwin', computer: { status: async () => status(), stop: async () => { paused = true; return { ok: true }; }, resume } } as any;
  const container = await renderPanel();
  await act(async () => [...container.querySelectorAll('button')].find(item => item.textContent === '停止桌面操作')!.click());
  expect(container.textContent).toContain('桌面操作已停止');
  expect(container.textContent).toContain('自动重试不会恢复');
  await act(async () => [...container.querySelectorAll('button')].find(item => item.textContent === '恢复桌面控制')!.click());
  expect(resume).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain('自动重试不会恢复');
});

it('translates an existing stop notice when the app language changes', async () => {
  window.electronAPI = { platform: 'darwin', computer: {
    status: async () => ({ connected: true, fullControl: false, controlPaused: false, permissions: { accessibility: true, screenRecording: 'granted' } }),
    stop: async () => ({ ok: true }),
  } } as any;
  const container = await renderPanel();
  await act(async () => [...container.querySelectorAll('button')].find(item => item.textContent === '停止桌面操作')!.click());
  expect(container.textContent).toContain('桌面操作已停止');
  await act(async () => root!.render(<MemoryRouter><ComputerSettingsPanel zh={false} /></MemoryRouter>));
  expect(container.textContent).toContain('Desktop operations stopped.');
  expect(container.textContent).not.toContain('桌面操作已停止');
});

async function changeModel(container: HTMLElement, value: string) {
  await act(async () => container.querySelector<HTMLButtonElement>(`[data-model="${value}"]`)!.click());
  const save = [...container.querySelectorAll('button')].find(button => button.textContent === '保存模型')!;
  await act(async () => save.click());
}

it('saves the GUI model without replacing the latest chat model and other defaults', async () => {
  window.electronAPI = undefined;
  const latest = { defaults: { models: { primary: 'existing/chat' }, tools: { exec: { mode: 'deny' } } }, builtinTools: [] };
  vi.mocked(fetchGlobalDefaults).mockResolvedValue(latest as any);
  vi.mocked(updateGlobalDefaults).mockResolvedValue(latest as any);
  const container = await renderPanel();
  await changeModel(container, 'dashscope-cn/gui-plus-2026-02-26');
  expect(updateGlobalDefaults).toHaveBeenCalledWith({
    ...latest.defaults,
    models: { ...latest.defaults.models, computerUse: { primary: 'dashscope-cn/gui-plus-2026-02-26', fallbacks: [] } },
  });
  expect(container.textContent).toContain('模型已保存');
});

it('rejects invalid model references without writing defaults', async () => {
  window.electronAPI = undefined;
  const container = await renderPanel();
  await changeModel(container, 'not-a-provider-model');
  expect(updateGlobalDefaults).not.toHaveBeenCalled();
  expect(container.textContent).toContain('此模型当前不可选择');
});

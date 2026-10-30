// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../phone-dependencies-api', () => ({
  phoneDependenciesKey: () => 'phone-deps-fixture',
  loadPhoneDependencies: vi.fn(async () => ({ statuses: [
    { kind: 'adb', state: 'ready', source: 'system', version: '37.0.1', requestedVersion: '37.0.1', canInstall: true },
    { kind: 'scrcpy', state: 'absent', requestedVersion: '3.3.3', canInstall: true },
  ] })),
  installPhoneDependency: vi.fn(async () => {}), useExistingPhoneAdb: vi.fn(async () => {}),
}));
import { PhoneDependenciesCard } from '../phone-dependencies-card';
import { installPhoneDependency } from '../phone-dependencies-api';
import { useLocaleStore } from '@/stores/locale-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>; let node: HTMLDivElement;
beforeEach(() => { vi.clearAllMocks(); useLocaleStore.setState({ language: 'zh' }); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
const render = async (cloudOnly = false) => act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><PhoneDependenciesCard cloudOnly={cloudOnly} /></SWRConfig>));
it('shows host installation and existing path options without provisioning on load', async () => {
  await render(); expect(node.textContent).toContain('Gateway 电脑'); expect(node.textContent).toContain('使用已有 ADB');
  expect(installPhoneDependency).not.toHaveBeenCalled();
  await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === '安装')!.click());
  expect(installPhoneDependency).toHaveBeenCalledWith('scrcpy', 'install', expect.any(Function), undefined);
  expect(node.textContent).toContain('依赖已就绪');
});
it('does not require local ADB for cloud-only phones', async () => {
  await render(true); expect(node.textContent).toContain('阿里云连接无需本机 ADB');
  expect(node.textContent).not.toContain('Android Platform Tools'); expect(node.textContent).toContain('scrcpy server');
  await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === '连接本机手机？查看 ADB 依赖')!.click());
  expect(node.textContent).toContain('Android Platform Tools');
});
it('keeps installation failures visible and allows retry', async () => {
  vi.mocked(installPhoneDependency).mockRejectedValueOnce(new Error('checksum mismatch'));
  await render(true); await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === '安装')!.click());
  expect(node.querySelector('[role="alert"]')?.textContent).toBe('checksum mismatch');
  expect([...node.querySelectorAll('button')].find(button => button.textContent === '安装')?.disabled).toBe(false);
});

it('installs missing HarmonyOS components together and keeps Android dependencies separate', async () => {
  const { loadPhoneDependencies } = await import('../phone-dependencies-api');
  const statuses = [
    { kind: 'hdc' as const, state: 'ready' as const, requestedVersion: '6.0.0.47', canInstall: true },
    { kind: 'java' as const, state: 'absent' as 'absent' | 'ready', requestedVersion: '17', canInstall: true },
    { kind: 'hoscrcpy' as const, state: 'absent' as 'absent' | 'ready', requestedVersion: '1.0.18-beta', canInstall: true, distribution: 'third-party distribution' },
  ];
  vi.mocked(loadPhoneDependencies).mockResolvedValue({ location: 'gateway', installationEnabled: true, statuses });
  vi.mocked(installPhoneDependency).mockImplementation(async kind => { const item = statuses.find(item => item.kind === kind); if (item) item.state = 'ready'; });
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><PhoneDependenciesCard initialPlatform="harmonyos" /></SWRConfig>));
  expect(node.textContent).toContain('无需安装 DevEco Studio');
  expect(node.textContent).toContain('third-party distribution');
  expect(node.textContent).not.toContain('Android Platform Tools');
  expect(installPhoneDependency).not.toHaveBeenCalled();
  await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === '一键安装缺失组件')!.click());
  expect(vi.mocked(installPhoneDependency).mock.calls.map(call => call[0])).toEqual(['java', 'hoscrcpy']);
  expect(node.textContent).toContain('鸿蒙连接组件已就绪');
});

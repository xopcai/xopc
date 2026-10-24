// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../phone-api', () => ({ fetchPhoneApplications: vi.fn() }));
import { fetchPhoneApplications } from '../phone-api';
import { PhoneAppPicker } from '../phone-app-picker';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>; let node: HTMLDivElement;
beforeEach(() => { node = document.createElement('div'); document.body.append(node); root = createRoot(node); vi.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
async function mount() {
  function Harness() {
    const [mode, setMode] = useState<'all' | 'selected'>('all'); const [selected, setSelected] = useState<string[]>([]);
    return <PhoneAppPicker serial="emulator-5554" mode={mode} selected={selected} onModeChange={setMode} onSelectedChange={setSelected} zh />;
  }
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Harness /></SWRConfig>));
}
it('loads native labels only when selected-only access is chosen and supports searching and checking apps', async () => {
  vi.mocked(fetchPhoneApplications).mockResolvedValue([{ packageName: 'com.android.settings', label: '设置' }, { packageName: 'com.android.deskclock', label: '时钟' }]);
  await mount();
  expect(fetchPhoneApplications).not.toHaveBeenCalled();
  expect((node.querySelector('input[value="all"]') as HTMLInputElement).checked).toBe(true);
  await act(async () => (node.querySelector('input[value="selected"]') as HTMLInputElement).click());
  await act(async () => (node.querySelector('input[aria-label="时钟"]') as HTMLInputElement).click());
  expect(node.querySelector('[role="status"]')?.textContent).toContain('1');
  const search = node.querySelector('input[type="search"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '时钟');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(node.querySelector('input[aria-label="设置"]')).toBeNull();
  expect(node.querySelector('input[aria-label="时钟"]')).not.toBeNull();
});
it('keeps a loading placeholder and permits retry after an app-list failure', async () => {
  let fail!: (error: Error) => void;
  vi.mocked(fetchPhoneApplications).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  await mount(); await act(async () => (node.querySelector('input[value="selected"]') as HTMLInputElement).click());
  expect(node.querySelector('[aria-busy="true"]')).not.toBeNull();
  await act(async () => fail(new Error('Device disconnected')));
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('暂时无法读取应用');
  expect(node.textContent).not.toContain('Device disconnected');
  vi.mocked(fetchPhoneApplications).mockResolvedValueOnce([{ packageName: 'com.android.settings', label: '设置' }]);
  await act(async () => [...node.querySelectorAll('button')].find(b => b.textContent === '重试')!.click());
  expect(node.querySelector('input[aria-label="设置"]')).not.toBeNull();
});

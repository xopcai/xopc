// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

vi.mock('../phone-api', () => ({ fetchPhoneDevices: vi.fn(async () => ({ devices: [], discovery: [
  { serial: 'usb-one', name: 'My phone', state: 'unauthorized', emulator: false },
  { serial: 'emulator-5554', name: 'Test emulator', state: 'device', emulator: true },
] })) }));
import { AddPhoneDialog } from '../add-phone-dialog';
import { fetchPhoneDevices } from '../phone-api';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onSelect = vi.fn();
beforeEach(() => { vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><AddPhoneDialog zh onClose={vi.fn()} onSelect={onSelect} /></SWRConfig>)); }
async function click(text: string) { await act(async () => [...document.body.querySelectorAll('button')].find(button => button.textContent?.includes(text))!.click()); }

it('offers cloud ADB configuration without probing local devices', async () => {
  await render();
  expect(document.body.textContent).toContain('阿里云手机'); expect(document.body.textContent).toContain('腾讯云手机');
  expect(document.body.textContent).toContain('通过本地连接器连接'); expect(fetchPhoneDevices).not.toHaveBeenCalled();
  await click('阿里云手机');
  expect(document.body.textContent).toContain('ADB 地址');
  expect(document.body.querySelector('input[type=file]')).not.toBeNull(); expect(onSelect).not.toHaveBeenCalled();
});
it('explains the Gateway location and only selects authorized connected devices', async () => {
  await render(); await click('Gateway 电脑上的手机');
  expect(document.body.textContent).toContain('连接位置：Gateway 所在电脑');
  expect(document.body.textContent).toContain('等待手机授权');
  const choices = [...document.body.querySelectorAll('button')].filter(button => button.textContent === '选择设备');
  expect(choices).toHaveLength(2); expect(choices[0].disabled).toBe(true); expect(choices[1].disabled).toBe(false);
  await act(async () => choices[1].click());
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ serial: 'emulator-5554', state: 'device' }));
});

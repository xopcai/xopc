// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../phone-api', () => ({ phoneRequest: vi.fn() }));
vi.mock('@/features/tunnel/mobile-pair-qr', () => ({ encodeMobilePairQr: vi.fn(async () => 'data:image/svg+xml,test') }));
import { WirelessPhoneForm } from '../wireless-phone-form';
import { WirelessReconnectDialog } from '../wireless-reconnect-dialog';
import { phoneRequest } from '../phone-api';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const selected = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.mocked(phoneRequest).mockImplementation(async path => {
    if (path === '/wireless/discovery') return { mdns: true, services: [{ name: 'phone', kind: 'pairing', host: '192.168.1.5', port: 39123 }, { name: 'phone', kind: 'connect', host: '192.168.1.5', port: 40001 }] };
    if (path === '/wireless/pairings') return { id: 'session-one', status: 'waiting', expiresAt: Date.now() + 90_000, qrPayload: 'WIFI:T:ADB;S:test;P:secret;;' };
    return {};
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function render() { await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><WirelessPhoneForm zh onSelect={selected} /></SWRConfig>)); }
async function click(label: string) { await act(async () => [...document.body.querySelectorAll('button')].find(button => button.textContent === label)!.click()); }
async function input(label: string, value: string) {
  const element = [...document.body.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))!.querySelector('input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}

it('shows a QR and selects the connected device only after backend confirmation', async () => {
  await render();
  expect(container.textContent).toContain('等待扫码'); expect(container.querySelector('img')?.alt).toContain('配对二维码');
  expect(selected).not.toHaveBeenCalled();
  vi.mocked(phoneRequest).mockResolvedValueOnce({ id: 'session-one', status: 'connected', device: { serial: '192.168.1.5:40001', state: 'device', name: 'Phone', emulator: false } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ serial: '192.168.1.5:40001' }));
});
it('fills discovered pairing and connection ports separately and submits a six-digit code', async () => {
  await render(); await click('配对码'); await click('192.168.1.5:39123');
  await input('六位配对码', '012345');
  const form = container.querySelector('form')!;
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(phoneRequest).toHaveBeenCalledWith('/wireless/pairings', { method: 'code', host: '192.168.1.5', pairingPort: 39123, code: '012345', connectPort: 40001 });
  expect(phoneRequest).toHaveBeenCalledWith('/wireless/pairings/session-one', undefined, 'DELETE');
});
it('explains connection timeout after pairing and allows connection without re-pairing', async () => {
  await render();
  vi.mocked(phoneRequest).mockResolvedValueOnce({ id: 'session-one', status: 'timeout', errorCode: 'PHONE_CONNECT_TIMEOUT' });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.textContent).toContain('无需重新配对');
  await click('连接已配对设备'); await click('192.168.1.5:40001');
  vi.mocked(phoneRequest).mockResolvedValueOnce({ serial: '192.168.1.5:40001', state: 'device' });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(phoneRequest).toHaveBeenCalledWith('/wireless/connect', { host: '192.168.1.5', port: 40001 });
  expect(selected).toHaveBeenCalled();
});
it('cancels on unmount and ignores a pairing response arriving after dismissal', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(phoneRequest).mockImplementation(async path => path === '/wireless/pairings' ? new Promise(done => { resolve = done; }) : { mdns: true, services: [] });
  await render(); await act(async () => root.render(null));
  await act(async () => resolve({ id: 'late-session', status: 'waiting' }));
  expect(phoneRequest).toHaveBeenCalledWith('/wireless/pairings/late-session', undefined, 'DELETE');
  expect(selected).not.toHaveBeenCalled();
});
it('offers manual address recovery when registered device reconnection fails', async () => {
  const onConnected = vi.fn(async () => {}); const onClose = vi.fn();
  await act(async () => root.render(<WirelessReconnectDialog zh device={{ id: 'one', serial: 'old', name: 'My phone', enabled: true, allowedApps: [], revision: 1, createdAt: 1, wireless: { host: '192.168.1.5', port: 39999, guid: 'guid', hardwareSerial: 'hw' } }} onConnected={onConnected} onClose={onClose} />));
  vi.mocked(phoneRequest).mockRejectedValueOnce(new Error('Enable wireless debugging'));
  await click('重新连接');
  expect(document.body.textContent).toContain('Enable wireless debugging');
  await input('连接端口', '40002');
  await click('重新连接');
  expect(phoneRequest).toHaveBeenLastCalledWith('/devices/one/reconnect', { host: '192.168.1.5', port: 40002 });
  expect(onConnected).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
});

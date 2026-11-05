// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  data: { mode: 'remote', origin: 'https://gateway.example', remoteOrigin: 'https://gateway.example', hasCredential: true, endpointConnected: true },
  mutate: vi.fn(), switch: vi.fn(),
}));
vi.mock('@/features/gateway/use-desktop-gateway-connection', () => ({ useDesktopGatewayConnection: () => ({ data: mocks.data, mutate: mocks.mutate }) }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: () => 'zh' }));

import { DesktopGatewayConnection } from '../desktop-gateway-connection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { gateway: { connection: vi.fn(), switchConnection: mocks.switch } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<DesktopGatewayConnection />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete window.electronAPI; });
async function click(text: string) { const button = [...container.querySelectorAll('button')].find(button => button.textContent === text)!; await act(async () => button.click()); }
async function address(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[autocomplete="url"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }

it('shows a compact current connection and opens editing only on request', async () => {
  expect(container.querySelector('form')).toBeNull();
  expect(container.textContent).toContain('gateway.example'); expect(container.textContent).toContain('本机已授权能力已就绪');
  await click('更改连接'); expect(container.querySelector('form')).not.toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('');
  expect([...container.querySelectorAll('button')].find(button => button.textContent === '连接并切换')?.disabled).toBe(true);
  await address('https://other.example'); await click('取消');
  expect(container.querySelector('form')).toBeNull(); expect(mocks.switch).not.toHaveBeenCalled();
});
it('does not reuse a saved token for another address', async () => {
  await click('更改连接'); await address('https://other.example'); await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('请输入此服务的访问令牌'); expect(mocks.switch).not.toHaveBeenCalled();
});
it('validates the server address without sending a native request', async () => {
  await click('更改连接'); await address('https://gateway.example/private'); await submit();
  expect(container.querySelector('[aria-invalid="true"]')).not.toBeNull(); expect(mocks.switch).not.toHaveBeenCalled();
});

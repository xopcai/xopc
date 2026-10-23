// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../phone-api', () => ({ phoneRequest: vi.fn() }));
import { phoneRequest } from '../phone-api';
import { AliyunPhoneForm } from '../aliyun-phone-form';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const onAdded = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.mocked(phoneRequest).mockResolvedValue({ token: 'test-token', model: 'Cloud', androidVersion: '12', screenshot: 'data:image/jpeg;base64,AA==', expiresAt: Date.now() + 600000 }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<AliyunPhoneForm zh onAdded={onAdded} />)); }
async function address(value: string) { const input = container.querySelectorAll('input')[1]; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function upload() {
  const input = container.querySelector('input[type=file]')!;
  const file = new File(['private test data'], 'adbkey'); Object.defineProperty(file, 'text', { value: async () => 'private test data' });
  await act(async () => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function click(text: string) { await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === text)!.click()); }
it('requires a successful connection test before adding and sends only its token on add', async () => {
  await render(); expect(container.textContent).not.toContain('连接成功'); expect(container.querySelector('button')!.disabled).toBe(true);
  await address('cloud.example:10001'); await upload(); await click('测试连接');
  expect(phoneRequest).toHaveBeenCalledWith('/cloud/aliyun/test', { endpoint: 'cloud.example:10001', privateKey: 'private test data' });
  expect(container.textContent).toContain('Android 12'); expect(container.querySelector('img')).not.toBeNull();
  await click('添加手机');
  expect(phoneRequest).toHaveBeenCalledWith('/cloud/aliyun/add', { token: 'test-token', name: '阿里云手机', makeDefault: false }); expect(onAdded).toHaveBeenCalledOnce();
});
it('invalidates the tested credentials when the address changes', async () => {
  await render(); await address('cloud.example:10001'); await upload(); await click('测试连接'); await address('other.example:10001');
  expect(container.textContent).not.toContain('连接成功'); expect(phoneRequest).toHaveBeenCalledWith('/cloud/aliyun/tests/test-token', undefined, 'DELETE');
  expect(onAdded).not.toHaveBeenCalled();
});
it('shows connection failures without offering to add an unverified phone', async () => {
  await render(); await address('cloud.example:10001'); await upload(); vi.mocked(phoneRequest).mockRejectedValueOnce(new Error('Authentication failed')); await click('测试连接');
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Authentication failed'); expect(container.textContent).not.toContain('连接成功'); expect(onAdded).not.toHaveBeenCalled();
});

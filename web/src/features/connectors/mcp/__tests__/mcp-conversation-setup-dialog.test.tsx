// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ data: undefined as Record<string, unknown> | undefined, fetch: vi.fn(), mutate: vi.fn() }));
vi.mock('swr', () => ({ default: () => ({ data: mocks.data, error: undefined, mutate: mocks.mutate }) }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.fetch }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (select: (state: { language: 'zh' }) => unknown) => select({ language: 'zh' }) }));

import { McpConversationSetupDialog } from '../mcp-conversation-setup-page';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const onClose = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); mocks.fetch.mockResolvedValue({}); mocks.mutate.mockResolvedValue(undefined);
  mocks.data = { setupId: 'test', serverId: 'docs', conversationId: 'original', displayName: '资料服务', endpointOrigin: 'https://docs.example.com', version: 3, phase: 'token_required', expired: false };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<McpConversationSetupDialog setupId="test" onClose={onClose} />)); }
function button(label: string) { return [...document.querySelectorAll('button')].find(node => node.textContent === label)!; }

it('keeps keyboard focus in a labelled dialog and hides secondary connection actions in details', async () => {
  await render();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute('aria-labelledby')).toBe(document.querySelector('h2')!.id);
  expect(document.activeElement).toBe(document.querySelector('h2'));
  expect((document.querySelector('details') as HTMLDetailsElement).open).toBe(false);
  expect(button('保存并连接').disabled).toBe(true);
  expect(document.querySelector('input')!.type).toBe('password');
});

it('offers first-time Token input for a blocked access refusal without claiming a key was rejected', async () => {
  mocks.data = { ...mocks.data, phase: 'blocked', errorCode: 'access_denied', canProvideToken: true, canReplaceToken: false };
  await render(); expect(document.querySelector('input')!.type).toBe('password');
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('账号或服务权限');
  expect(document.querySelector('[role="alert"]')).toBeNull(); expect(button('保存并连接')).toBeTruthy();
});

it('keeps non-authentication failures out of the Token form', async () => {
  mocks.data = { ...mocks.data, phase: 'blocked', errorCode: 'tls', canProvideToken: false };
  await render(); expect(document.querySelector('input')).toBeNull(); expect(button('重新检查')).toBeTruthy();
});

it('clears the secret before a pending save and uses the current form version', async () => {
  await render(); const input = document.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'fixture-secret');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.querySelector('button[aria-label*="复制"]')).toBeNull();
  let finish!: () => void;
  mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}); }));
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(input.value).toBe('');
  expect(input.disabled).toBe(true);
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ action: 'token', expectedVersion: 3, value: 'fixture-secret' });
  await act(async () => finish());
});

it('dismissing the sheet does not cancel the durable request or submit credentials', async () => {
  await render(); await act(async () => button('稍后继续').click());
  expect(onClose).toHaveBeenCalledWith(mocks.data);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it('shows the exact peer, full endpoint, objective and shared impact before owner approval', async () => {
  mocks.data = { ...mocks.data, phase: 'approval_required', approval: { accountId: 'bot-a', peerId: 'alice@im.wechat', endpoint: 'https://docs.example.com/private', purpose: '读取我的资料' } };
  await render();
  const text = document.querySelector('[role="dialog"]')!.textContent;
  for (const value of ['bot-a / alice@im.wechat', 'https://docs.example.com/private', '读取我的资料', '不会授予微信用户管理权限']) expect(text).toContain(value);
  expect(document.querySelector('input')).toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => button('允许这次连接').click());
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).action).toBe('approve');
});

it('keeps Weixin completion in the sheet and retries only the saved result on delivery failure', async () => {
  mocks.data = { ...mocks.data, phase: 'ready', returnChannel: 'weixin', replyDelivery: 'failed' };
  await render(); expect(onClose).not.toHaveBeenCalled();
  await act(async () => button('重试发送结果').click());
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).action).toBe('retry_delivery');
});

it('returns a ready Web connection to its original chat without another confirmation', async () => {
  mocks.data = { ...mocks.data, phase: 'ready' }; await render();
  expect(onClose).toHaveBeenCalledWith(mocks.data);
});

it('offers the native OAuth link without entering secrets into the conversation', async () => {
  mocks.data = { ...mocks.data, phase: 'authorizing', authorizationUrl: 'https://docs.example.com/authorize?state=fixture' };
  await render(); const link = document.querySelector('a')!;
  expect(link.textContent).toBe('继续登录');
  expect(link.target).toBe('_blank'); expect(link.rel).toContain('noopener');
  expect(document.querySelector('input')).toBeNull();
});

it('submits all documented secret fields together and clears them before the pending request', async () => {
  mocks.data = { ...mocks.data, secretFields: [{ id: 'api', label: 'API key', name: 'X-API-Key', location: 'header' }, { id: 'tenant', label: 'Tenant token', name: 'X-Tenant-Token', location: 'header' }] };
  await render();
  for (const [id, value] of [['api', 'fixture-api'], ['tenant', 'fixture-tenant']]) await act(async () => {
    const input = document.getElementById(`mcp-setup-${id}`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  let finish!: () => void;
  mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}); }));
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect([...document.querySelectorAll('input')].every(input => input.value === '')).toBe(true);
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ action: 'token', expectedVersion: 3, value: { api: 'fixture-api', tenant: 'fixture-tenant' } });
  await act(async () => finish());
});

it('disables every recheck action and credential input during the service cooldown', async () => {
  mocks.data = { ...mocks.data, phase: 'auth_unknown', canProvideToken: true, nextRetryAt: Date.now() + 120000 };
  await render();
  expect([...document.querySelectorAll('input')].every(input => input.disabled)).toBe(true);
  expect([...document.querySelectorAll('button')].filter(node => node.textContent === '重新检查').every(node => node.disabled)).toBe(true);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

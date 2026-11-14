// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchJson: vi.fn(), mutate: vi.fn(), phase: 'token_required' }));
vi.mock('@/lib/fetch', () => ({ fetchJson: api.fetchJson }));

vi.mock('swr', () => ({ default: (key: string) => ({ data: key.includes('/conversations/')
  ? { permitted: true, setup: { setupId: 'goal', serverId: 'docs', displayName: '资料服务', purpose: '查询会员积分', phase: api.phase, version: 1 } }
  : { setupId: 'goal', serverId: 'docs', displayName: '资料服务', endpointOrigin: 'https://docs.example.com', conversationId: 'original', phase: 'token_required', version: 1 }, mutate: api.mutate }) }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (select: (state: { language: 'zh' }) => unknown) => select({ language: 'zh' }) }));

import { McpSetupActionBar } from '@/features/chat/connections/mcp-setup-action-bar';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function LocationProbe() { const location = useLocation(); const navigate = useNavigate(); return <><output>{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Go back</button></>; }
beforeEach(() => { api.phase = 'token_required'; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(entry = '/chat/original?view=compact') {
  await act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><McpSetupActionBar conversationId="original" /><LocationProbe /></MemoryRouter>); });
}
it.each([
  ['approval_required', '查看来源'],
  ['token_required', '填写访问密钥'],
  ['oauth_required', '登录并继续'],
  ['auth_unknown', '查看连接'],
])('offers one accurate primary action in phase %s', async (phase, label) => {
  api.phase = phase;
  await render();
  const actions = Array.from(container.querySelectorAll('section a'));
  expect(actions.map(action => action.textContent)).toEqual([label]);
  expect(container.querySelector('section')?.textContent).toContain('查询会员积分');
});

it('opens over the original chat, keeps other URL state and lets browser Back dismiss it', async () => {
  await render();
  await act(async () => { (container.querySelector('a') as HTMLAnchorElement).click(); });
  expect(container.querySelector('output')!.textContent).toBe('/chat/original?view=compact&mcpSetup=goal');
  await vi.waitFor(async () => { await act(async () => {}); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); });
  expect(container.querySelector('a')!.getAttribute('href')).toBe('/mcp-setup/goal');
  await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Go back')!.click(); });
  expect(container.querySelector('output')!.textContent).toBe('/chat/original?view=compact');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('restores a pending sheet from the URL after reload and closes without leaving the chat', async () => {
  await render('/chat/original?mcpSetup=goal');
  await vi.waitFor(async () => { await act(async () => {}); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); });
  await act(async () => { (document.querySelector('button[aria-label="暂时关闭"]') as HTMLButtonElement).click(); });
  expect(container.querySelector('output')!.textContent).toBe('/chat/original');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('cancels the pending request directly from chat with the current version', async () => {
  api.fetchJson.mockResolvedValueOnce({ payload: { phase: 'cancelled' } });
  await render();
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="取消连接请求"]')!.click(); });
  expect(api.fetchJson).toHaveBeenCalledWith(expect.stringContaining('/api/mcp/setup/goal'), {
    method: 'POST', body: JSON.stringify({ action: 'cancel', expectedVersion: 1 }),
  });
  expect(api.mutate).toHaveBeenCalledWith(expect.any(Function));
});

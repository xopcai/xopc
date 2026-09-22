// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { BrowserApprovalCard } from './browser-approval-card';
import { parseBrowserApprovalState, type BrowserApprovalState } from './browser-approval';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.fetch }));
const approval: BrowserApprovalState = { id: 'approval', conversationId: 'chat', risk: 'external_effect', summary: 'Saved action',
  expiresAt: new Date(Date.now() + 600000).toISOString(), status: 'pending' };
describe('authoritative browser approval card', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.fetch.mockReset();
    useLocaleStore.setState({ language: 'en' });
    useGatewayStore.setState({ baseUrl: 'http://fixture', conversationId: 'identity' });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  async function render() {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}>
      <BrowserApprovalCard approval={{ ...approval, summary: 'Historical summary' }} conversationId="chat" />
    </SWRConfig>));
  }
  const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!;
  it.each(['expired', 'consumed', 'denied'] as const)('does not offer approval for a %s record', async status => {
    mocks.fetch.mockResolvedValue({ approvals: [{ ...approval, status }] });
    await render();
    expect(button('Approve once')).toBeUndefined();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).toContain('Saved action');
  });
  it('uses the returned expired status instead of the requested approved decision', async () => {
    mocks.fetch.mockResolvedValueOnce({ approvals: [approval] }).mockResolvedValueOnce({ approval: { ...approval, status: 'expired' } });
    await render();
    await act(async () => button('Approve once').click());
    expect(container.textContent).toContain('request expired');
    expect(container.textContent).not.toContain('Approved once.');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('disables both actions while waiting and ignores a late response after logout', async () => {
    let finish!: () => void;
    mocks.fetch.mockResolvedValueOnce({ approvals: [approval] }).mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({ approval: { ...approval, status: 'approved' } });
    }));
    await render();
    await act(async () => button('Approve once').click());
    expect(button('Deny').disabled).toBe(true);
    expect(button('Approve once').disabled).toBe(true);
    await act(async () => useGatewayStore.setState({ conversationId: undefined }));
    await act(async () => finish());
    expect(container.textContent).not.toContain('Approved once.');
  });
  it('rejects malformed, missing and wrong-conversation records', async () => {
    expect(parseBrowserApprovalState({ ...approval, expiresAt: 'not a date' })).toBeNull();
    mocks.fetch.mockResolvedValue({ approvals: [{ ...approval, conversationId: 'other' }] });
    await render();
    expect(button('Approve once')).toBeUndefined();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

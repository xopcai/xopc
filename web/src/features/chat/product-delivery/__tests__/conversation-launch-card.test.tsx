// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationLaunchView, ConversationOrigin } from '@xopcai/gateway-contract';

import { ProductDeliveryRows } from '../product-delivery-tail';
import { ConversationOriginLabel } from '../../messages/conversation-origin';
import { normalizeAgentMessages } from '../../messages/agent-messages';
import { useLocaleStore } from '@/stores/locale-store';

const realtime = vi.hoisted(() => ({ listeners: [] as Array<{ onEvent: (event: { data: unknown; event: string }) => void; onGap?: () => void }> }));
vi.mock('@/features/gateway/gateway-realtime', () => ({
  subscribeRealtimeTopic: (_topic: string, listener: typeof realtime.listeners[number]) => {
    realtime.listeners.push(listener);
    return () => { realtime.listeners = realtime.listeners.filter(value => value !== listener); };
  },
}));
const api = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: api.fetchJson }));

const sourceId = 'e078f1fa-481b-4aa3-a69a-c33f1ecb3604';
const targetId = '59052eaf-bd55-442f-a32e-54c0e0c4f608';
const launchId = '988853d5-d93c-4bc7-a060-cd921b56bb0d';
const origin: ConversationOrigin = { launchId, conversationId: sourceId, agentId: 'main' };
const snapshot: ConversationLaunchView = { launchId, conversationId: targetId, inputId: 'first', title: 'Greeting', status: 'running' };

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname}</output>;
}

describe('conversation launch presentation', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'zh' });
    realtime.listeners = [];
    api.fetchJson.mockReset();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  const renderCards = async () => {
    await act(async () => root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter initialEntries={[`/chat/${sourceId}`]}>
          <ul><ProductDeliveryRows language="zh" conversationId={sourceId} deliveries={[{ key: 'created', delivery: {
            version: 2, operation: 'created', primary: { kind: 'session', id: targetId, title: 'Greeting', capabilities: ['open'] },
          } }]} /></ul>
          <LocationProbe />
        </MemoryRouter>
      </SWRConfig>,
    ));
  };

  it('refreshes the first-input result on realtime changes and reconnect, then opens the independent chat', async () => {
    api.fetchJson.mockResolvedValue({ items: [snapshot] });
    await renderCards();
    expect(container.textContent).toContain('运行中');
    expect(api.fetchJson).toHaveBeenCalledOnce();
    api.fetchJson.mockResolvedValue({ items: [{ ...snapshot, status: 'completed', summary: '你好！' }] });
    await act(async () => realtime.listeners.forEach(listener => listener.onEvent({ event: 'session.launch.changed', data: { conversationId: targetId } })));
    expect(container.textContent).toContain('已回复 · 你好！');
    await act(async () => window.dispatchEvent(new Event('gateway-realtime-connected')));
    expect(api.fetchJson.mock.calls.length).toBeGreaterThanOrEqual(3);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-product-delivery="session"] button')!.click());
    expect(container.querySelector('output')?.textContent).toBe(`/chat/${targetId}`);
  });

  it('disables a deleted target and renders provenance with a return link after hydration', async () => {
    api.fetchJson.mockResolvedValue({ items: [{ ...snapshot, status: 'unavailable' }] });
    await renderCards();
    expect(container.querySelector<HTMLButtonElement>('[data-product-delivery="session"] button')?.disabled).toBe(true);
    expect(container.textContent).toContain('对话不可用');
    const [message] = normalizeAgentMessages([{ role: 'user', content: 'hello', metadata: { conversationOrigin: origin } }]);
    expect(message?.conversationOrigin).toEqual(origin);
    api.fetchJson.mockResolvedValue({ available: true, title: 'Source' });
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><ConversationOriginLabel conversationId={targetId} origin={message.conversationOrigin!} /><LocationProbe /></MemoryRouter>
    </SWRConfig>));
    expect(container.textContent).toContain('由 main 从另一对话发送');
    await act(async () => container.querySelector<HTMLAnchorElement>('a')!.click());
    expect(container.querySelector('output')?.textContent).toBe(`/chat/${sourceId}`);
    api.fetchJson.mockResolvedValue({ available: false });
    await act(async () => realtime.listeners.forEach(listener => listener.onEvent({ event: 'session.launch.changed', data: { conversationId: sourceId } })));
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('从另一对话发送');
  });

  it('keeps the provenance label when its source is deleted and exposes no broken link', async () => {
    api.fetchJson.mockResolvedValue({ available: false });
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter><ConversationOriginLabel conversationId={targetId} origin={origin} /></MemoryRouter>
    </SWRConfig>));
    expect(container.textContent).toContain('从另一对话发送');
    expect(container.querySelector('a')).toBeNull();
  });
});

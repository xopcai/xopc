// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { expect, it, vi } from 'vitest';

vi.mock('@/features/chat/chat-page', () => ({ ChatPage: ({ conversationId, automationWorkspace }: {
  conversationId: string; automationWorkspace: boolean;
}) => <div data-conversation={conversationId}>{automationWorkspace ? 'Task chat' : 'Chat'}</div> }));
import { automationApi } from '../automation-api';
import { AutomationConversation } from '../automation-conversation';

it('keeps an explicitly opened repair conversation without reopening it and clearing its focused run', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const automation = { id: 'task', name: 'Report', enabled: true,
    trigger: { kind: 'manual' as const }, action: { kind: 'agent' as const, instruction: 'Report' }, conversationMode: 'new_session' as const,
    delivery: { notificationPolicy: 'none' as const, destinations: [] }, state: {}, createdAtMs: 1, updatedAtMs: 1 };
  vi.spyOn(automationApi, 'configuration').mockResolvedValue({ deleted: false, automation });
  const open = vi.spyOn(automationApi, 'openConfiguration');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<SWRConfig value={{ provider: () => new Map() }}>
      <AutomationConversation automation={automation} conversationId="repair-chat" runs={[]} language="en" onSelectRun={vi.fn()} />
    </SWRConfig>); });
    expect(open).not.toHaveBeenCalled();
    expect(container.querySelector('[data-conversation="repair-chat"]')).not.toBeNull();
  } finally { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); }
});

it('opens an unbound setup conversation and reports its created task', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const configured = vi.fn();
  const setup = vi.spyOn(automationApi, 'configuration').mockResolvedValue({ deleted: false, automation: {
    id: 'created-1', name: 'Created task', enabled: false,
    trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' } },
    action: { kind: 'agent', instruction: 'Say hello' }, conversationMode: 'new_session',
    delivery: { notificationPolicy: 'all', destinations: [] }, state: {}, createdAtMs: 1, updatedAtMs: 1,
  } });
  const open = vi.spyOn(automationApi, 'openConfiguration');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AutomationConversation conversationId="setup-1" runs={[]} language="en" onSelectRun={vi.fn()} onConfigured={configured} />
    </SWRConfig>); });
    expect(setup).toHaveBeenCalledWith('setup-1');
    expect(open).not.toHaveBeenCalled();
    expect(configured).toHaveBeenCalledWith('created-1');
    expect(container.querySelector('[data-conversation="setup-1"]')?.textContent).toBe('Task chat');
  } finally { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); }
});

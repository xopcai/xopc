// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasPendingAgentRunForChat,
  setPendingAgentRun,
} from '@/features/chat/messages/message-sender';
import { startChatRunStateBridge } from '@/features/chat/session/chat-run-state-bridge';
import { useChatRunPresenceStore } from '@/features/chat/session/chat-run-presence-store';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { apiFetch } from '@/lib/fetch';

vi.mock('@/lib/fetch', () => ({ apiFetch: vi.fn() }));
vi.mock('@/stores/gateway-store', () => ({
  useGatewayStore: { getState: () => ({ token: 'test', onUnauthorized: () => {} }) },
}));

describe('chat run state bridge', () => {
  const sessionKey = 'agent:main:webchat:default:direct:state-bridge';
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    sessionStorage.clear();
    useChatSessionStore.setState({ focusedSessionKey: sessionKey, sessions: {} });
    useChatRunPresenceStore.setState({ runs: {} });
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: { runs: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('uses sessions.run.completed to clear a lost run-topic terminal', async () => {
    useChatSessionStore.getState().seedSessionIfEmpty(sessionKey, [], true, true);
    const cleanup = startChatRunStateBridge();
    cleanups.push(cleanup);
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled());

    window.dispatchEvent(new CustomEvent('run-started', {
      detail: { sessionKey, runId: 'run-lost-terminal' },
    }));
    expect(hasPendingAgentRunForChat(sessionKey)).toBe(true);

    window.dispatchEvent(new CustomEvent('run-completed', {
      detail: { sessionKey, runId: 'run-lost-terminal', status: 'success' },
    }));

    expect(hasPendingAgentRunForChat(sessionKey)).toBe(false);
    expect(useChatSessionStore.getState().sessions[sessionKey]).toMatchObject({
      sending: false,
      streaming: false,
      streamingMsg: null,
    });
  });

  it('clears stale pending state from an authoritative inactive snapshot', async () => {
    setPendingAgentRun(sessionKey, 'run-stale');
    const cleanup = startChatRunStateBridge();
    cleanups.push(cleanup);

    await vi.waitFor(() => expect(hasPendingAgentRunForChat(sessionKey)).toBe(false));
  });

  it('re-announces active runs discovered after a missed realtime event', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: { runs: [{ sessionKey, runId: 'run-active' }] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const started = vi.fn();
    window.addEventListener('run-started', started);
    const cleanup = startChatRunStateBridge();
    cleanups.push(() => {
      cleanup();
      window.removeEventListener('run-started', started);
    });

    await vi.waitFor(() => expect(hasPendingAgentRunForChat(sessionKey)).toBe(true));
    expect(started).toHaveBeenCalled();
    expect(useChatRunPresenceStore.getState().runs[sessionKey]?.status).toBe('running');
  });
});

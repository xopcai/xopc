import { chatRunManager } from '../session/chat-run-manager';
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
  const conversationId = 'agent:main:webchat:default:direct:state-bridge';
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    chatRunManager.abort(conversationId, false);
    sessionStorage.clear();
    useChatSessionStore.setState({ focusedConversationId: conversationId, sessions: {} });
    useChatRunPresenceStore.setState({ runs: {} });
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: { runs: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
  });

  it('uses sessions.run.completed to clear a lost run-topic terminal', async () => {
    useChatSessionStore.getState().seedSessionIfEmpty(conversationId, [], true, true);
    const cleanup = startChatRunStateBridge();
    cleanups.push(cleanup);
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled());

    window.dispatchEvent(new CustomEvent('run-started', {
      detail: { conversationId, runId: 'run-lost-terminal' },
    }));
    expect(hasPendingAgentRunForChat(conversationId)).toBe(true);

    window.dispatchEvent(new CustomEvent('run-completed', {
      detail: { conversationId, runId: 'run-lost-terminal', status: 'success' },
    }));

    expect(hasPendingAgentRunForChat(conversationId)).toBe(false);
    expect(useChatSessionStore.getState().sessions[conversationId]).toMatchObject({
      sending: false,
      streaming: false,
      streamingMsg: null,
    });
  });

  it('stops the interrupted presentation without clearing a newer run', async () => {
    const cleanup = startChatRunStateBridge();
    cleanups.push(cleanup);
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled());
    window.dispatchEvent(new CustomEvent('run-started', { detail: { conversationId, runId: 'old' } }));
    window.dispatchEvent(new CustomEvent('session-input-interrupt', { detail: { conversationId, runId: 'old' } }));
    expect(hasPendingAgentRunForChat(conversationId)).toBe(false);
    window.dispatchEvent(new CustomEvent('run-started', { detail: { conversationId, runId: 'old' } }));
    expect(hasPendingAgentRunForChat(conversationId)).toBe(false);
    window.dispatchEvent(new CustomEvent('run-started', { detail: { conversationId, runId: 'new' } }));
    window.dispatchEvent(new CustomEvent('session-input-interrupt', { detail: { conversationId, runId: 'old' } }));
    expect(hasPendingAgentRunForChat(conversationId)).toBe(true);
  });

  it('clears stale pending state from an authoritative inactive snapshot', async () => {
    setPendingAgentRun(conversationId, 'run-stale');
    const cleanup = startChatRunStateBridge();
    cleanups.push(cleanup);

    await vi.waitFor(() => expect(hasPendingAgentRunForChat(conversationId)).toBe(false));
  });

  it('re-announces active runs discovered after a missed realtime event', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: { runs: [{ conversationId, runId: 'run-active' }] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const started = vi.fn();
    window.addEventListener('run-started', started);
    const cleanup = startChatRunStateBridge();
    cleanups.push(() => {
      cleanup();
      window.removeEventListener('run-started', started);
    });

    await vi.waitFor(() => expect(hasPendingAgentRunForChat(conversationId)).toBe(true));
    expect(started).toHaveBeenCalled();
    expect(useChatRunPresenceStore.getState().runs[conversationId]?.status).toBe('running');
  });
  it('keeps successor presence when a delayed inactive snapshot finishes after its start event', async () => {
    let reply!: (value: Response) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }))
      .mockImplementation(async () => Response.json({ payload: { runs: [{ conversationId, runId: 'new' }] } }));
    setPendingAgentRun(conversationId, 'old');
    useChatSessionStore.getState().seedSessionIfEmpty(conversationId, [], true, true);
    const reconcile = vi.spyOn(chatRunManager, 'reconcileInactive');
    cleanups.push(startChatRunStateBridge());
    window.dispatchEvent(new CustomEvent('run-started', { detail: { conversationId, runId: 'new' } }));
    reply(Response.json({ payload: { runs: [] } }));
    await vi.waitFor(() => expect(chatRunManager.getResumeRunId(conversationId)).toBe('new'));
    expect(reconcile).not.toHaveBeenCalled();
    expect(useChatRunPresenceStore.getState().runs[conversationId]?.status).toBe('running');
    expect(useChatSessionStore.getState().sessions[conversationId]).toMatchObject({ sending: true, streaming: true });
  });

  it('ignores an old terminal event after a successor has been announced', () => {
    const reconcile = vi.spyOn(chatRunManager, 'reconcileTerminal');
    cleanups.push(startChatRunStateBridge());
    window.dispatchEvent(new CustomEvent('run-started', { detail: { conversationId, runId: 'new' } }));
    window.dispatchEvent(new CustomEvent('run-completed', { detail: { conversationId, runId: 'old', status: 'cancelled' } }));
    expect(reconcile).not.toHaveBeenCalled();
    expect(chatRunManager.getResumeRunId(conversationId)).toBe('new');
    expect(useChatRunPresenceStore.getState().runs[conversationId]?.status).toBe('running');
  });

  it('does not downgrade a REST-discovered successor when an older start event is replayed', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => Response.json({ payload: { runs: [{ conversationId, runId: 'new' }] } }));
    cleanups.push(startChatRunStateBridge());
    await vi.waitFor(() => expect(chatRunManager.getResumeRunId(conversationId)).toBe('new'));
    window.dispatchEvent(new CustomEvent('run-started', { detail: { conversationId, runId: 'old' } }));
    expect(chatRunManager.getResumeRunId(conversationId)).toBe('new');
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(chatRunManager.getResumeRunId(conversationId)).toBe('new');
    expect(useChatRunPresenceStore.getState().runs[conversationId]?.status).toBe('running');
  });

});

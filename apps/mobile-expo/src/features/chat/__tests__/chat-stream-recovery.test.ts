// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEventPayload } from '@xopcai/realtime-protocol';

const state = vi.hoisted(() => ({
  appState: 'active',
  acceptedRunId: 'run',
  reader: { source: null as { conversationId: string } | null, status: 'idle' },
  appListeners: new Set<(value: string) => void>(),
  memory: new Map<string, string>(),
  activeRun: vi.fn(),
  history: vi.fn(),
  apiFetch: vi.fn(),
  reconnect: vi.fn(),
  autoplay: vi.fn(),
  query: { invalidateQueries: vi.fn(async () => {}), setQueryData: vi.fn() },
  subscriptions: [] as Array<{
    topic: string;
    listener: { onEvent: (event: RealtimeEventPayload) => void; onSubscribed?: () => void };
    closed: boolean;
  }>,
}));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return state.appState; },
  addEventListener: (_name: string, listener: (value: string) => void) => {
    state.appListeners.add(listener);
    return { remove: () => state.appListeners.delete(listener) };
  },
} }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => state.query }));
vi.mock('../../../query/sessions', () => ({ fetchSessionActiveRun: state.activeRun, fetchSessionMessagePage: state.history }));
vi.mock('../../../query/workspace-sync', () => ({ invalidateSessionLists: vi.fn() }));
vi.mock('../../../stores/gateway-store', () => {
  const gateway = { activeGatewayId: 'gateway', connectionGeneration: 1 };
  return { useGatewayStore: Object.assign((selector: (value: typeof gateway) => unknown) => selector(gateway), {
    getState: () => gateway,
  }) };
});
vi.mock('../../../stores/preferences-store', () => ({ usePreferencesStore: { getState: () => ({ language: 'en' }) } }));
vi.mock('../../../i18n/messages', () => ({ useMessages: () => ({ chat: { sendFailed: 'Failed' } }) }));
vi.mock('../../gateway/use-gateway-health', () => ({ useGatewayHealth: () => ({ gatewayOnline: true }) }));
vi.mock('../../gateway/session-detail-cache', () => ({ readCachedSessionDetail: () => ({ transcriptId: 'transcript' }) }));
vi.mock('../../gateway/connection-log', () => ({ recordConnectionEvent: vi.fn() }));
vi.mock('../session-history-cache', () => ({ writeCachedSessionHistoryHead: vi.fn() }));
vi.mock('../../voice/read-aloud-store', () => ({ useReadAloudStore: { getState: () => state.reader } }));
vi.mock('../assistant-audio-autoplay', () => ({ queueAssistantAudioAutoplay: state.autoplay }));
vi.mock('../attachment-file-io', () => ({ readUriAsBase64: vi.fn() }));
vi.mock('../../endpoint-tools/turn-claim', () => ({ waitForMobileEndpointTurnClaim: async () => ({ type: 'endpoint' }) }));
vi.mock('../../../api/client', () => ({ apiFetch: state.apiFetch, apiUploadFile: vi.fn(), formatApiHttpError: () => 'Failed' }));
vi.mock('../../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => state.memory.get(key),
    set: (key: string, value: string) => state.memory.set(key, value),
    delete: (key: string) => state.memory.delete(key),
  },
  pendingRunStorageKey: (key: string) => `pending:${key}`,
}));
vi.mock('../../gateway/use-gateway-realtime', () => ({
  requestMobileRealtimeReconnect: state.reconnect,
  subscribeMobileRealtimeTopic: (topic: string, listener: typeof state.subscriptions[number]['listener']) => {
    const subscription = { topic, listener, closed: false };
    state.subscriptions.push(subscription);
    queueMicrotask(() => { if (!subscription.closed) listener.onSubscribed?.(); });
    return () => { subscription.closed = true; };
  },
}));

import { useChatSession, type UseChatSessionReturn } from '../use-chat-session';
import { useLocalMessagesStore } from '../local-messages-store';
import { emitGatewayEvent } from '../../gateway/gateway-event-bus';

const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (element: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
let root: ReturnType<typeof createRoot>;
let chat: UseChatSessionReturn;
function Probe() { chat = useChatSession({ conversationId: 'chat' }); return null; }
async function appState(value: string) {
  await act(async () => {
    state.appState = value;
    for (const listener of state.appListeners) listener(value);
  });
}
async function event(type: string, payload: object, seq: number) {
  await act(async () => {
    const subscription = state.subscriptions.at(-1)!;
    subscription.listener.onEvent({ topic: subscription.topic, event: type, seq,
      data: { type, runId: subscription.topic.slice(4), conversationId: 'chat', payload } });
  });
}
async function startReply() {
  await act(async () => { await chat.send('hello'); });
  await event('run_start', {}, 1);
  await event('assistant_delta', { messageId: 'm1', delta: 'Visible answer' }, 2);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(chat.streaming).toBe(true);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.appState = 'active';
  state.acceptedRunId = 'run';
  state.reader = { source: null, status: 'idle' };
  state.memory.clear();
  state.subscriptions = [];
  useLocalMessagesStore.setState({ sessions: {} });
  state.activeRun.mockReset().mockResolvedValue({ active: false });
  state.history.mockReset().mockResolvedValue(null);
  state.apiFetch.mockImplementation(async (path: string) => new Response(JSON.stringify({ ok: true, payload:
    path.endsWith('/inputs') ? { state: { activeRunId: state.acceptedRunId, inputs: [] } } : { clarification: null },
  })));
  root = createRoot(document.createElement('div'));
  await act(async () => { root.render(createElement(Probe)); });
  state.activeRun.mockClear().mockResolvedValue({ active: true, runId: 'run' });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.useRealTimers();
});

describe('chat stream lifecycle', () => {
  it('reattaches after repeated foreground transitions without an old resume cancelling the new one', async () => {
    await startReply();
    for (let index = 0; index < 3; index++) {
      await appState('background');
      await appState('active');
      expect(state.subscriptions.at(-1)?.closed).toBe(false);
      expect(state.subscriptions.filter(item => !item.closed)).toHaveLength(1);
    }
    expect(state.subscriptions).toHaveLength(4);
    await event('assistant_delta', { messageId: 'm1', delta: ' continued' }, 3);
    await event('run_end', { status: 'success' }, 4);
    expect(chat.streaming).toBe(false);
    expect(chat.finalizedMessages[0]?.content).toContainEqual(expect.objectContaining({ text: 'Visible answer continued' }));
  });

  it('settles a completed background run immediately and keeps the answer when history fails', async () => {
    await startReply();
    await appState('background');
    state.activeRun.mockResolvedValue({ active: false });
    state.history.mockRejectedValue(new Error('Network request failed'));
    const started = Date.now();
    await appState('active');
    expect(Date.now()).toBe(started);
    expect(state.activeRun).toHaveBeenCalledTimes(1);
    expect(chat.streaming).toBe(false);
    expect(chat.runningRef.current).toBe(false);
    expect(chat.finalizedMessages[0]?.content).toContainEqual(expect.objectContaining({ text: 'Visible answer' }));
  });

  it('does not reconnect or time out a subscribed run during a long silent tool call', async () => {
    await startReply();
    await appState('background');
    await appState('active');
    const subscriptions = state.subscriptions.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(chat.streaming).toBe(true);
    expect(state.reconnect).not.toHaveBeenCalled();
    expect(state.subscriptions).toHaveLength(subscriptions);
  });

  it('uses the session completion event when the run terminal event was missed', async () => {
    await startReply();
    state.history.mockImplementation(() => new Promise(() => {}));
    await act(async () => { emitGatewayEvent('run.completed', { conversationId: 'chat', runId: 'older-run' }); });
    expect(chat.streaming).toBe(true);
    await act(async () => { emitGatewayEvent('run.completed', { conversationId: 'chat', runId: 'run' }); });
    expect(chat.streaming).toBe(false);
    expect(chat.finalizedMessages).toHaveLength(1);
    expect(state.subscriptions.at(-1)?.closed).toBe(true);
  });

  it('ignores an obsolete active-run lookup that returns after a newer foreground recovery', async () => {
    await startReply();
    await appState('background');
    let complete!: (value: { active: boolean }) => void;
    state.activeRun.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await appState('active');
    await appState('background');
    await appState('active');
    await act(async () => { complete({ active: false }); });
    expect(chat.streaming).toBe(true);
    expect(state.subscriptions.at(-1)?.closed).toBe(false);
    expect(state.memory.get('pending:chat')).toContain('run');
  });

  it('refreshes late audio without restarting the completed text run', async () => {
    await startReply();
    await event('run_end', { status: 'success' }, 3);
    await act(async () => { emitGatewayEvent('session.audio_ready', {
      conversationId: 'chat', runId: 'run', uri: 'media://tts/reply.mp3', createdAtMs: Date.now(),
    }); });
    expect(chat.streaming).toBe(false);
    expect(state.autoplay).toHaveBeenCalledOnce();
    expect(chat.finalizedMessages).toHaveLength(1);
  });

  it('keeps different runs separate when the next queued run started in the background', async () => {
    await startReply();
    await appState('background');
    state.activeRun.mockResolvedValue({ active: true, runId: 'run-b' });
    await appState('active');
    expect(chat.finalizedMessages[0]?.turnId).toBe('run');
    await event('run_start', {}, 1);
    await event('assistant_delta', { messageId: 'm2', delta: 'Second answer' }, 2);
    await event('run_end', { status: 'success' }, 3);
    expect(chat.finalizedMessages.map(message => message.turnId)).toEqual(['run', 'run-b']);
    expect(chat.finalizedMessages[1]?.content).toContainEqual(expect.objectContaining({ text: 'Second answer' }));
    expect(JSON.stringify(chat.finalizedMessages[1])).not.toContain('Visible answer');
  });

  it('does not clear a newer reply when an older completion history request finishes', async () => {
    await startReply();
    const complete: Array<(value: null) => void> = [];
    state.history.mockImplementation(() => new Promise(resolve => { complete.push(resolve); }));
    await act(async () => { emitGatewayEvent('run.completed', { conversationId: 'chat', runId: 'run' }); });
    state.acceptedRunId = 'run-b';
    await act(async () => { await chat.send('next question'); });
    await event('run_start', {}, 1);
    await event('assistant_delta', { messageId: 'm2', delta: 'New reply' }, 2);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { for (const resolve of complete) resolve(null); });
    expect(chat.streaming).toBe(true);
    expect(chat.streamingMsg?.turnId).toBe('run-b');
    expect(chat.streamingMsg?.content).toContainEqual(expect.objectContaining({ text: 'New reply' }));
  });

  it('treats a server network error as terminal and retains partial output', async () => {
    await startReply();
    await event('error', { message: 'Upstream network connection was lost' }, 3);
    expect(chat.streaming).toBe(false);
    expect(chat.finalizedMessages[0]?.content).toContainEqual(expect.objectContaining({ text: 'Visible answer' }));
    expect(state.subscriptions).toHaveLength(1);
  });


  it('does not interrupt read-aloud when deferred audio arrives for the same conversation', async () => {
    state.reader = { source: { conversationId: 'chat' }, status: 'preparing' };
    await act(async () => { emitGatewayEvent('session.audio_ready', {
      conversationId: 'chat', runId: 'run', uri: 'media://tts/reply.mp3', createdAtMs: Date.now(),
    }); });
    expect(state.autoplay).not.toHaveBeenCalled();
    expect(state.history).toHaveBeenCalled();
  });


  it('keeps an ambiguous submission confirming until durable history acknowledges it', async () => {
    state.apiFetch.mockRejectedValueOnce(new Error('Network request failed'));
    await act(async () => { await chat.send('unsent question'); });
    expect(chat.optimisticMessages[0]?.deliveryState).toBe('confirming');
    state.activeRun.mockResolvedValue({ active: false });
    await appState('background');
    await appState('active');
    expect(chat.optimisticMessages[0]?.deliveryState).toBe('confirming');
  });

});

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TurnOutcome } from '@xopcai/gateway-contract';

import type { Message } from '../messages.types';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayRealtimeStore } from '@/stores/gateway-realtime-store';
import { ChatRealtimeStatus } from '../../agent-selection/chat-realtime-status';

vi.mock('@/features/gateway/gateway-realtime', () => ({ reconnectGatewayRealtime: vi.fn() }));
vi.mock('@/features/chat/messages/message-bubble', async () => {
  const { TurnOutcomeDetails } = await import('../turn-outcome-details');
  return { MessageBubble: ({ message }: { message: Message }) => <div>{message.outcome ? <TurnOutcomeDetails outcome={message.outcome} /> : null}</div> };
});

import { MessageList } from '../message-list';

const outcome: TurnOutcome = { version: 1, outcomeId: 'outcome', turnId: 'run', runId: 'run',
  status: 'failed', summary: 'OAuth refresh failed for openai: fetch failed', deliverables: [], evidence: [], createdAt: '2026-11-08T00:00:00Z' };
const messages: Message[] = [
  { role: 'user', turnId: 'run', content: [{ type: 'text', text: 'Hello' }] },
  { role: 'assistant', turnId: 'run', content: [], outcome },
];
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let originalLanguage: ReturnType<typeof useLocaleStore.getState>['language'];
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  originalLanguage = useLocaleStore.getState().language;
  useLocaleStore.setState({ language: 'zh' });
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  useLocaleStore.setState({ language: originalLanguage });
  useGatewayRealtimeStore.setState({ connectionState: 'idle', error: null });
  vi.useRealTimers();
});

it('shows only lightweight recovery while running, then one actionable failure in the same round', () => {
  const retry = vi.fn();
  const render = (running: boolean) => act(() => root.render(<MemoryRouter><MessageList messages={messages}
    streaming={running} progress={running ? { stage: 'model_retry', message: '', completed: 1, total: 2, timestamp: 1 } : null}
    runError={outcome.summary} reasoningLevel="off" registerListContentRef={() => {}} onRetryUserMessageRound={retry} />
  </MemoryRouter>));
  render(true);
  expect(container.querySelector('[data-run-recovery]')?.textContent).toContain('第 1 / 2 次尝试');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).not.toContain('再次尝试');
  render(false);
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(container.querySelector('[data-run-recovery]')).toBeNull();
  const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '再次尝试');
  act(() => button!.click());
  expect(retry).toHaveBeenCalledWith(0);
  expect(container.querySelector('details')?.open).toBe(false);
});

it('does not offer to replay a round that already executed a tool', () => {
  const rows: Message[] = [messages[0], { ...messages[1], content: [{ type: 'tool_use', name: 'send_message', id: 'tool', status: 'done' }] }];
  act(() => root.render(<MemoryRouter><MessageList messages={rows} streaming={false} progress={null}
    runError={outcome.summary} reasoningLevel="off" registerListContentRef={() => {}} onRetryUserMessageRound={vi.fn()} /></MemoryRouter>));
  expect(container.textContent).not.toContain('再次尝试');
  expect(container.textContent).toContain('模型设置');
});

it('keeps connection retries quiet and hides raw diagnostics until recovery is exhausted', async () => {
  vi.useFakeTimers();
  useGatewayRealtimeStore.setState({ connectionState: 'reconnecting', error: 'WebSocket closed (1006)' });
  act(() => root.render(<ChatRealtimeStatus />));
  expect(container.textContent).toBe('');
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(container.textContent).toContain('正在重新连接');
  expect(container.textContent).not.toContain('1006');
  expect(container.querySelector('button')).toBeNull();
  act(() => useGatewayRealtimeStore.setState({ connectionState: 'error' }));
  expect(container.querySelector('button')?.textContent).toBe('重新连接');
  expect(container.querySelector('details')?.open).toBe(false);
  act(() => useGatewayRealtimeStore.setState({ connectionState: 'connected', error: null }));
  expect(container.textContent).toBe('');
});

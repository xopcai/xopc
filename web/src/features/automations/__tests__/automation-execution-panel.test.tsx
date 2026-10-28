// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/features/chat/chat-page', () => ({ ChatPage: ({ conversationId, automationWorkspace, readOnly, onHistoryReady }: {
  conversationId: string; automationWorkspace?: boolean; readOnly?: boolean; onHistoryReady?: () => void;
}) => {
  const ready = useChatSessionStore(state => Boolean(state.sessions[conversationId]?.messages.length));
  useEffect(() => { if (ready) onHistoryReady?.(); }, [ready, onHistoryReady]);
  return <div data-conversation={conversationId} data-configuration={Boolean(automationWorkspace)} data-read-only={Boolean(readOnly)}>Execution transcript</div>;
} }));
vi.mock('@/components/markdown/markdown-view', () => ({ MarkdownView: ({ content }: { content: string }) => <div>{content}</div> }));
vi.mock('../automation-delivery-status', () => ({ AutomationDeliveryStatus: () => null }));
vi.mock('@/features/sessions/session-api', () => ({ getSessionDetail: vi.fn() }));

import { automationApi, type Automation, type AutomationRun } from '../automation-api';
import { getSessionDetail } from '@/features/sessions/session-api';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { AutomationExecutionPanel } from '../automation-execution-panel';

const task: Automation = { id: 'task', name: 'Report', enabled: true, trigger: { kind: 'manual' },
  action: { kind: 'agent', instruction: 'Report' }, conversationMode: 'new_session',
  delivery: { notificationPolicy: 'none', destinations: [] }, state: {}, createdAtMs: 1, updatedAtMs: 1 };
const run: AutomationRun = { id: 'run', automationId: task.id, automationName: task.name, status: 'succeeded',
  manual: false, createdAtMs: 1, endedAtMs: 2, triggerSnapshot: task.trigger, actionSnapshot: task.action,
  conversationId: 'conversation', summary: 'Selected execution result' };
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let currentRun: AutomationRun;
let currentTask: Automation;
const configure = vi.fn();
const details = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  currentRun = { ...run }; currentTask = { ...task };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.spyOn(automationApi, 'getRun').mockImplementation(async () => ({ run: { ...currentRun } }));
  vi.spyOn(automationApi, 'get').mockImplementation(async () => ({ automation: currentTask }));
  vi.spyOn(automationApi, 'markRunRead').mockImplementation(async () => { currentRun = { ...currentRun, readAtMs: 3 }; return { marked: true as const }; });
  vi.mocked(getSessionDetail).mockResolvedValue({ key: 'conversation', customData: {} } as Awaited<ReturnType<typeof getSessionDetail>>);
  useChatSessionStore.setState({ sessions: {} });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); });

async function render(automationId = 'task') {
  await act(async () => { root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><AutomationExecutionPanel
    runId="run" automationId={automationId} language="en" onConfigure={configure} onDetails={details} onBack={vi.fn()} /></SWRConfig>); });
}

it('opens the execution transcript without configuration semantics and waits for content before acknowledging it', async () => {
  await render();
  expect(container.querySelector('[data-conversation="conversation"]')?.getAttribute('data-configuration')).toBe('false');
  expect(automationApi.markRunRead).not.toHaveBeenCalled();
  await act(async () => useChatSessionStore.getState().setCommittedSnapshot('conversation', { name: 'Report', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Result' }], timestamp: 1 }], hasMore: false }));
  expect(automationApi.markRunRead).toHaveBeenCalledWith('run');
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Run details')!.click());
  expect(details).toHaveBeenCalledWith('run');
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Adjust automation')!.click());
  expect(configure).toHaveBeenCalledWith(expect.objectContaining({ id: 'run' }));
});

it('keeps separate run identity when historical runs share a conversation after changing modes', async () => {
  currentRun.conversationShared = true;
  await render();
  expect(container.textContent).toContain('Selected execution result');
  expect(container.querySelector('[data-conversation]')).toBeNull();
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Open shared conversation')!.click());
  expect(container.querySelector('[data-conversation="conversation"]')).not.toBeNull();
  expect(container.textContent).toContain('Executions may share this conversation');
  expect(container.textContent).not.toContain('Follow-ups become context for future runs');
});

it('keeps active runs unread and disables follow-ups', async () => {
  currentRun.status = 'running'; currentRun.endedAtMs = undefined;
  await render();
  expect(container.querySelector('[data-read-only="true"]')).not.toBeNull();
  expect(automationApi.markRunRead).not.toHaveBeenCalled();
});

it('preserves the result when the conversation is deleted and leaves it unread', async () => {
  vi.mocked(getSessionDetail).mockRejectedValue(Object.assign(new Error('Gone'), { status: 404 }));
  await render();
  expect(container.textContent).toContain('conversation was deleted');
  expect(container.textContent).toContain('Selected execution result');
  expect(automationApi.markRunRead).not.toHaveBeenCalled();
});

it('rejects a mismatched parent and never fetches or acknowledges its conversation', async () => {
  await render('different-task');
  expect(container.textContent).toContain('does not belong');
  expect(getSessionDetail).not.toHaveBeenCalled();
  expect(automationApi.markRunRead).not.toHaveBeenCalled();
});

it('shows terminal non-agent results without creating a conversation', async () => {
  currentRun.conversationId = undefined;
  await render();
  expect(container.textContent).toContain('No conversation is associated');
  expect(container.textContent).toContain('Selected execution result');
  expect(getSessionDetail).not.toHaveBeenCalled();
});

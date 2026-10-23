// @vitest-environment jsdom

import { act, createRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';

vi.mock('@/features/extensions/extension-provider', () => ({ useUiExtensions: () => [] }));
vi.mock('@/features/chat/messages/virtual-message-rows', () => ({
  VirtualMessageRows: ({ rows, renderRow }: { rows: { index: number }[]; renderRow: (index: number) => ReactNode }) =>
    <div data-virtual-rows>{rows.map(row => <div key={row.index}>{renderRow(row.index)}</div>)}</div>,
}));

import { MessageList } from '@/features/chat/messages/message-list';
import { useLocaleStore } from '@/stores/locale-store';

const answer = (text: string, timestamp?: number): Message => ({ role: 'assistant', content: [{ type: 'text', text }], timestamp });
const empty: Message = { role: 'assistant', content: [] };
const tool: Message = { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'read', status: 'done' }] };
const thinking: Message = { role: 'assistant', content: [{ type: 'thinking', text: 'Internal reasoning' }] };
const outcome: NonNullable<Message['outcome']> = { version: 1, outcomeId: 'outcome-1', runId: 'run-1', turnId: 'run-1',
  status: 'failed', summary: 'Provider capacity exhausted', deliverables: [], evidence: [], createdAt: '2026-10-17T00:00:00Z' };

describe('MessageList visible rows', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  function render(list: Message[], options: { streaming?: boolean; sending?: boolean; personal?: boolean;
    showAssistantWorkLog?: boolean; reasoningLevel?: 'off' | 'on'; virtual?: boolean } = {}) {
    act(() => root.render(<MemoryRouter><MessageList messages={list} personal={options.personal ?? true}
      streaming={options.streaming ?? false} sending={options.sending} progress={null}
      reasoningLevel={options.reasoningLevel ?? 'on'} showAssistantWorkLog={options.showAssistantWorkLog ?? false}
      hideAssistantActions conversationId="visibility-test" registerListContentRef={() => {}}
      scrollRef={options.virtual ? createRef<HTMLDivElement>() : undefined} /></MemoryRouter>));
  }
  const rows = () => Array.from(container.querySelectorAll('[data-chat-message-row]'));

  it('removes long runs of invisible historical messages including silent replies and whitespace', () => {
    render([answer('Before'), ...Array.from({ length: 38 }, (_, index) => [empty, tool, thinking][index % 3]),
      answer(' NO_REPLY \n'), { ...tool, content: [...tool.content, { type: 'text', text: 'NO_REPLY' }] }, answer('  \n '), answer('After')]);
    expect(rows()).toHaveLength(2);
    expect(rows().map(row => row.getAttribute('data-chat-message-index'))).toEqual(['0', '42']);
    expect(container.textContent).toContain('Before');
    expect(container.textContent).toContain('After');
  });

  it('passes only visible rows to the virtual list', () => {
    render([answer('Before'), ...Array.from({ length: 300 }, () => tool), answer('After')], { virtual: true });
    expect(container.querySelector('[data-chat-virtualized="true"]')).not.toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it('preserves work logs when enabled and hides reasoning when disabled', () => {
    render([tool, thinking], { personal: false, showAssistantWorkLog: true });
    expect(rows()).toHaveLength(2);
    render([tool, thinking], { personal: false, showAssistantWorkLog: true, reasoningLevel: 'off' });
    expect(rows()).toHaveLength(1);
  });

  it('keeps task prompts and their anchors even when the associated assistant reply is empty or silent', () => {
    const trigger: NonNullable<Message['taskTrigger']> = { entryId: 'entry-1', taskId: 'task-1', taskTitle: 'Research', kind: 'failure' };
    render([{ role: 'task', turnId: 'run-1', content: [], taskTrigger: trigger },
      { ...answer('NO_REPLY'), turnId: 'run-1' }, { role: 'task', content: [], taskTrigger: { ...trigger, entryId: 'entry-2' } }]);
    expect(rows()).toHaveLength(2);
    expect(container.querySelector('#chat-message-0')).not.toBeNull();
    expect(container.querySelectorAll('[data-task-trigger]')).toHaveLength(2);
    expect(container.textContent).toContain('Research');
  });

  it('preserves attachment-only replies and images alongside silent markers', () => {
    render([{ ...empty, attachments: [{ name: 'report.txt', type: 'file' }] },
      { ...answer('NO_REPLY'), content: [{ type: 'text', text: 'NO_REPLY' }, { type: 'image', source: { data: 'data:image/png;base64,AA==' } }] }]);
    expect(rows()).toHaveLength(2);
    expect(container.textContent).toContain('report.txt');
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('keeps final failures but removes tool-only failure rows in Personal', () => {
    render([{ ...empty, outcome }, { role: 'assistant', content: [
      { type: 'tool_use', id: 'failed-tool', name: 'read', status: 'error', result: 'Tool failed' },
    ] }]);
    expect(rows()).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Provider capacity exhausted');
  });

  it('preserves failed tool details outside Personal even with work logs hidden', () => {
    render([{ role: 'assistant', content: [
      { type: 'tool_use', id: 'failed-tool', name: 'read', status: 'error', result: 'Tool failed' },
    ] }], { personal: false });
    expect(rows()).toHaveLength(1);
    expect(container.querySelector('button[aria-expanded]')).not.toBeNull();
  });

  it('keeps task result follow-ups without answer text and drops empty successful outcomes', () => {
    render([{ ...empty, taskResultDelivery: { version: 1, deliveryId: 'delivery-1', taskId: 'task-1',
      taskRunId: 'run-1', taskTitle: 'Research result', conversationId: 'visibility-test', originTranscriptId: 'transcript-1',
      assignmentEpoch: 0, resultRevision: 1, outcome, createdAt: 1 } },
    { ...empty, outcome: { ...outcome, status: 'succeeded' } }], { personal: false });
    expect(rows()).toHaveLength(1);
    expect(container.querySelector('[data-result-follow-up]')?.textContent).toContain('Research result');
  });

  it.each([{ streaming: true }, { sending: true }, {}])('keeps the active placeholder and removes it on completion: %j', options => {
    render([answer('Before'), options.streaming || options.sending ? empty : { ...empty, pendingResponseStatus: 'waiting' }], options);
    expect(rows()).toHaveLength(2);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    render([answer('Before'), empty]);
    expect(rows()).toHaveLength(1);
    render([answer('Before'), answer('Completed')]);
    expect(rows()).toHaveLength(2);
    expect(container.textContent).toContain('Completed');
  });

  it('moves time separators to visible messages and uses visible neighbors for spacing', () => {
    const start = new Date('2026-10-17T00:00:00Z').getTime();
    render([{ role: 'user', content: [{ type: 'text', text: 'Question' }], timestamp: start },
      { ...empty, timestamp: start + 60_000 }, answer('Reply', start + 2 * 60_000),
      { ...empty, timestamp: start + 31 * 60_000 }, answer('Later', start + 32 * 60_000)]);
    expect(rows()).toHaveLength(3);
    expect(rows()[1].classList.contains('-mt-5')).toBe(true);
    expect(container.querySelectorAll('[data-chat-time-separator]')).toHaveLength(2);
    expect(rows()[2].querySelector('time')?.getAttribute('datetime')).toBe(new Date(start + 32 * 60_000).toISOString());
  });
});

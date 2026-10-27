// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/extensions/extension-provider', () => ({ useUiExtensions: () => [] }));

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import { useLocaleStore } from '@/stores/locale-store';
import type { Message, ReasoningLevel } from '../messages.types';

describe('MessageBubble assistant work log', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'zh' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const message = {
    role: 'assistant' as const,
    content: [
      { type: 'tool_use' as const, id: 'task-1', name: 'personal_task', status: 'done' as const },
      { type: 'text' as const, text: '已经安排好了。' },
    ],
  };

  it('keeps the answer while hiding tool activity in Personal AI chat', () => {
    act(() => root.render(<MemoryRouter><MessageBubble message={message} isStreaming={false} progress={null} showAssistantWorkLog={false} responseFeedbackEnabled={false} /></MemoryRouter>));

    expect(container.textContent).toContain('已经安排好了。');
    expect(container.textContent).not.toContain('执行过程');
    expect(container.textContent).not.toContain('personal task');
  });

  it('continues to show the work log in regular chats', () => {
    act(() => root.render(<MemoryRouter><MessageBubble message={message} isStreaming={false} progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));

    expect(container.textContent).toContain('执行过程');
  });

  it.each([true, false].flatMap(personal => (['off', 'on', 'stream'] as ReasoningLevel[])
    .map(level => ({ personal, level }))))('keeps a streaming final table separate: %j', ({ personal, level }) => {
    const content: Message['content'] = [
      { type: 'thinking', text: 'Private reasoning', streaming: false },
      { type: 'text', text: 'Checking the files.', presentation: 'narration' },
      { type: 'tool_use', id: 'read', name: 'read_file', status: 'done' },
      { type: 'text', text: '| Final file | Result |\n| --- | --- |\n| report.md | Verified |', segmentId: 'final', presentation: 'pending' },
    ];
    const show = (streaming: boolean) => act(() => root.render(<MemoryRouter><MessageBubble
      personal={personal} message={{ role: 'assistant', content }} isStreaming={streaming}
      reasoningLevel={level} progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));
    show(true);
    const table = container.querySelector('[data-chat-find-text] table');
    expect(table).not.toBeNull();
    expect(table?.closest('[data-assistant-work-log]')).toBeNull();
    expect(container.querySelector('[data-assistant-work-log]')?.textContent).not.toContain('Final file');
    expect(container.textContent).not.toContain('Private reasoning');
    content[3] = { ...content[3], presentation: 'answer' } as Message['content'][number];
    show(false);
    expect(container.querySelector('[data-chat-find-text] table')).toBe(table);
  });

  it.each([true, false])('hides mixed tool activity in Personal throughout streaming=%s', (isStreaming) => {
    act(() => root.render(<MemoryRouter><MessageBubble personal message={{
      role: 'assistant', timestamp: 1000, completedAt: 24000,
      content: [
        { type: 'tool_use', id: 'failed', name: 'vendor__lookup', status: 'error', result: 'Internal failure' },
        ...Array.from({ length: 3 }, (_, index) => ({
          type: 'tool_use' as const, id: `lookup-${index}`, name: 'vendor__lookup',
          status: isStreaming ? 'running' as const : 'done' as const,
        })),
        { type: 'text', text: '已经安排好了。' },
      ],
    }} isStreaming={isStreaming} progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));

    expect(container.textContent).toContain('已经安排好了。');
    expect(container.textContent).not.toMatch(/执行过程|已完成 · 用时|暂时无法完成这一步|已处理相关信息|Internal failure/);
    expect(container.querySelector('[data-assistant-activity-flow]')).toBeNull();
  });
});

// Exercise a complete live-to-final transition through the real message renderer.
describe('lightweight assistant activity', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'zh' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const tool = { type: 'tool_use' as const, id: 'query', name: 'vendor__customer_export', status: 'running' as const,
    input: { command: 'cat /private/secret' } };
  function render(active: boolean, answer = '', failed = false) {
    act(() => root.render(<MemoryRouter><MessageBubble message={{ role: 'assistant', timestamp: 1000,
      ...(failed ? { outcome: { version: 1, outcomeId: 'o', runId: 'r', turnId: 'r', status: 'failed', deliverables: [], evidence: [], createdAt: '2026-10-17' } as const } : {}),
      content: [{ type: 'text', text: '正在核对相关资料。', presentation: 'narration', segmentId: 'progress' },
        { ...tool, status: active ? 'running' : failed ? 'error' : 'done', result: failed ? 'INTERNAL_ERROR /private/secret' : 'ok' },
        ...(answer ? [{ type: 'text' as const, text: answer, presentation: 'answer' as const, segmentId: 'answer' }] : [])] }}
      isStreaming={active} progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));
  }
  const disclosure = () => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;

  it('opens concise progress by default, hides technical payloads, and collapses when the final result completes', () => {
    render(true);
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-assistant-activity-flow]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/customer.export|private\/secret|cat /);
    expect(container.querySelector('[data-activity-status="running"]')).not.toBeNull();
    render(false, '最终结果保持完整。');
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.assistant-activity-disclosure')?.getAttribute('inert')).not.toBeNull();
    expect(container.textContent).toContain('最终结果保持完整。');
    expect(container.querySelector('.assistant-activity-busy')).toBeNull();
  });

  it('collapses automatically when answer text starts without treating the run as complete', () => {
    render(true);
    render(true, '正在输出答案。');
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('已完成 ·');
    expect(container.textContent).toContain('正在输出答案。');
  });

  it('collapses a manually opened live process on completion and preserves the answer DOM', () => {
    render(true, '保留这段答案。');
    act(() => disclosure().click());
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    const answer = [...container.querySelectorAll('.markdown-body')].find(node => node.textContent?.includes('保留这段答案'));
    render(false, '保留这段答案。');
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    act(() => disclosure().click());
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    expect([...container.querySelectorAll('.markdown-body')].find(node => node.textContent?.includes('保留这段答案'))).toBe(answer);
  });

  it('keeps failures human-readable and stops loading without calling the turn completed', () => {
    render(true);
    render(false, '这部分暂时无法获取。', true);
    expect(container.textContent).toContain('暂时没能完成');
    expect(container.textContent).not.toMatch(/INTERNAL_ERROR|private\/secret|已完成 ·/);
    expect(container.querySelector('.assistant-activity-busy')).toBeNull();
  });

  it('defers completion collapse while the user is selecting progress text', () => {
    render(true);
    const flow = container.querySelector('[data-assistant-activity-flow]')!;
    const selection = window.getSelection()!;
    act(() => {
      selection.selectAllChildren(flow);
      document.dispatchEvent(new Event('selectionchange'));
    });
    render(false, '最终结果。');
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    act(() => {
      selection.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
  });

  it('bounds parallel activity, exposes earlier steps on demand, and respects manual collapse', () => {
    const show = (count: number) => act(() => root.render(<MemoryRouter><MessageBubble message={{ role: 'assistant',
      content: Array.from({ length: count }, (_, index) => ({ ...tool, id: `tool-${index}` })) }}
      isStreaming progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));
    show(5);
    expect(container.textContent).toContain('正在处理 5 项工作');
    expect(container.querySelectorAll('[data-activity-group]').length).toBe(1);
    expect(container.querySelector('[data-activity-group] details')?.hasAttribute('open')).toBe(false);
    expect(container.querySelector('[data-activity-group] summary')?.textContent).toContain('5 次');
    act(() => disclosure().click());
    show(6);
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).toContain('正在处理 6 项工作');
  });
});

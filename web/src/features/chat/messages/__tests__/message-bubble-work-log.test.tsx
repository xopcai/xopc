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

  it('keeps only the final result after a regular chat completes', () => {
    act(() => root.render(<MemoryRouter><MessageBubble message={message} isStreaming={false} progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));

    expect(container.textContent).not.toContain('执行过程');
    expect(container.textContent).toContain('已经安排好了。');
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
  it('shows concrete public progress without tool rows, icons or generic status text', () => {
    render(true);
    expect(container.textContent).toContain('正在核对相关资料。');
    expect(container.textContent).not.toMatch(/customer.export|private\/secret|其他操作|正在处理|cat /);
    expect(container.querySelector('[data-assistant-work-log] svg')).toBeNull();
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
    expect(container.querySelectorAll('[data-assistant-work-log] [role="status"]')).toHaveLength(1);
    const flow = container.querySelector('[data-assistant-activity-flow]')!;
    const status = container.querySelector('[data-assistant-work-log] [role="status"]')!;
    expect(flow.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    render(false, '最终结果保持完整。');
    expect(container.textContent).not.toContain('正在核对相关资料。');
    expect(container.textContent).toContain('最终结果保持完整。');
    expect(container.querySelector('[data-assistant-work-log] [role="status"]')).toBeNull();
  });

  it('keeps one bottom indicator while the final answer streams and preserves the answer DOM', () => {
    render(true, '保留这段答案。');
    expect(container.textContent).not.toContain('正在核对相关资料。');
    const answer = container.querySelector('[data-chat-find-text]')!;
    const status = container.querySelector('[data-assistant-work-log] [role="status"]')!;
    expect(answer.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    render(false, '保留这段答案。');
    expect(container.querySelector('[data-chat-find-text]')).toBe(answer);
    expect(container.querySelector('[data-assistant-work-log] [role="status"]')).toBeNull();
  });

  it('keeps failures human-readable and stops loading without exposing technical errors', () => {
    render(true);
    render(false, '这部分暂时无法获取。', true);
    expect(container.textContent).toContain('暂时没能完成');
    expect(container.textContent).not.toMatch(/INTERNAL_ERROR|private\/secret|已完成 ·/);
    expect(container.querySelector('[data-assistant-work-log] [role="status"]')).toBeNull();
  });

  it('uses only one indicator for unknown parallel tools and generic narration', () => {
    act(() => root.render(<MemoryRouter><MessageBubble message={{ role: 'assistant', content: [
      { type: 'thinking', text: 'Private reasoning', streaming: true },
      { type: 'text', text: '正在处理...', presentation: 'narration' },
      ...Array.from({ length: 6 }, (_, index) => ({ ...tool, id: `tool-${index}` })),
    ] }} isStreaming progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));
    expect(container.textContent).not.toMatch(/正在处理|其他操作|Private reasoning|customer.export/);
    expect(container.querySelectorAll('[data-assistant-work-log] [role="status"]')).toHaveLength(1);
    expect(container.querySelector('[data-activity-group]')).toBeNull();
    expect(container.querySelector('[data-assistant-work-log] svg')).toBeNull();
  });

  it('shows concrete phone operations even when the assistant has not sent narration', () => {
    const show = (active: boolean) => act(() => root.render(<MemoryRouter><MessageBubble message={{ role: 'assistant', content: [
      { ...tool, id: 'connect', name: 'phone_use', input: { op: 'open', deviceId: 'private-device' }, status: 'done' },
      { ...tool, id: 'inspect', name: 'phone_use', input: { op: 'observe' }, status: 'done' },
      { ...tool, id: 'operate', name: 'phone_use', input: { op: 'run', goal: 'private task with credentials' }, status: active ? 'running' : 'done' },
      ...(!active ? [{ type: 'text' as const, text: '手机任务结果。', presentation: 'answer' as const }] : []),
    ] }} isStreaming={active} progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));
    show(true);
    const flow = container.querySelector('[data-assistant-activity-flow]')!;
    expect(flow.textContent).toContain('已检查手机连接');
    expect(flow.textContent).toContain('已查看手机当前画面');
    expect(flow.textContent).toContain('正在执行手机任务');
    expect(container.textContent).not.toMatch(/private|phone_use|正在处理|其他操作/);
    expect(flow.querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('[data-assistant-running]')).toHaveLength(1);
    show(false);
    expect(container.textContent).toContain('手机任务结果。');
    expect(container.textContent).not.toContain('已查看手机当前画面');
  });

  it('deduplicates known parallel operations without hiding the actual activity', () => {
    act(() => root.render(<MemoryRouter><MessageBubble message={{ role: 'assistant', content:
      Array.from({ length: 4 }, (_, index) => ({ ...tool, id: `read-${index}`, name: 'read_file' })),
    }} isStreaming progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));
    const flow = container.querySelector('[data-assistant-activity-flow]')!;
    expect(flow.textContent).toContain('正在读取文件');
    expect(flow.querySelectorAll('.markdown-body')).toHaveLength(1);
    expect(container.querySelectorAll('[data-assistant-running]')).toHaveLength(1);
  });

  it('shows all concrete narration in order and deduplicates replay without folding', () => {
    const progress = Array.from({ length: 7 }, (_, index) => ({ type: 'text' as const,
      text: `已核对资料 ${index + 1}`, presentation: 'narration' as const, segmentId: `stage-${index}` }));
    act(() => root.render(<MemoryRouter><MessageBubble message={{ role: 'assistant', content: [
      ...progress, { ...progress[0], segmentId: 'replay' },
    ] }} isStreaming progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));
    const flow = container.querySelector('[data-assistant-activity-flow]')!;
    expect(flow.textContent).toBe(progress.map(item => item.text).join(''));
    expect(flow.querySelectorAll('.markdown-body')).toHaveLength(7);
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
  });
});

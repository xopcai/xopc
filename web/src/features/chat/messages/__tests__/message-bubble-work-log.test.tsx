// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/extensions/extension-provider', () => ({ useUiExtensions: () => [] }));

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import { useLocaleStore } from '@/stores/locale-store';
import { sessionWireToUiMessages } from '../agent-messages';
import { useDevViewStore } from '@/stores/dev-view-store';
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
    expect(container.querySelector('[data-assistant-work-log]')?.textContent ?? '').not.toContain('Final file');
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

describe('ordered assistant conversation', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useLocaleStore.setState({ language: 'zh' });
    useDevViewStore.setState({ showRawToolData: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); useDevViewStore.setState({ showRawToolData: false }); });
  const content: Message['content'] = [
    { type: 'text', text: '先核对文件。', presentation: 'narration', segmentId: 'opening' },
    { type: 'thinking', text: '分析文件之间的关系。', streaming: true },
    { type: 'tool_use', id: 'read', toolCallId: 'read', name: 'read_file', status: 'running', input: { path: 'report.ts' }, result: 'file contents' },
    { type: 'text', text: '核对结果。', presentation: 'pending', segmentId: 'final' },
  ];
  function render(message: Message, active: boolean, options: { reasoningLevel?: ReasoningLevel; personal?: boolean; showAssistantWorkLog?: boolean } = {}) {
    act(() => root.render(<MemoryRouter><MessageBubble message={message} isStreaming={active} progress={null}
      responseFeedbackEnabled={false} {...options} /></MemoryRouter>));
  }
  function complete(): Message['content'] {
    return content.map(block => block.type === 'tool_use' ? { ...block, status: 'done' }
      : block.type === 'thinking' ? { ...block, streaming: false }
      : block.type === 'text' && block.segmentId === 'final' ? { ...block, presentation: 'answer' } : block);
  }
  function disclosure(): HTMLButtonElement {
    return container.querySelector('[data-assistant-work-log] button[aria-expanded]')!;
  }
  it('preserves public messages around tool items through completion and hydration', () => {
    const check = () => {
      const messages = [...container.querySelectorAll('.assistant-markdown-content')];
      expect(messages.map(node => node.textContent)).toEqual(['先核对文件。', '核对结果。']);
      const activity = container.querySelector('[data-assistant-activity]')!;
      expect(messages[0].compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(activity.compareDocumentPosition(messages[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.querySelector('.xopc-personal-thinking-dots')).toBeNull();
    };
    render({ role: 'assistant', content }, true);
    check();
    const final = container.querySelectorAll('.assistant-markdown-content')[1];
    render({ role: 'assistant', content: complete() }, false);
    check();
    expect(container.querySelectorAll('.assistant-markdown-content')[1]).toBe(final);
    const [history] = sessionWireToUiMessages([
      { role: 'assistant', id: 'opening', content: complete().slice(0, 3) },
      { role: 'toolResult', toolCallId: 'read', content: 'ok' },
      { role: 'assistant', id: 'final', content: complete().slice(3) },
    ]);
    render(history, false);
    check();
  });
  it('keeps lightweight process details collapsed and inspectable', () => {
    render({ role: 'assistant', content: complete() }, false, { reasoningLevel: 'on' });
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-assistant-thinking]')).toBeNull();
    act(() => disclosure().click());
    expect(container.querySelector('[data-assistant-thinking]')?.textContent).toContain('分析文件之间的关系。');
    expect(container.querySelector('[data-activity-status="completed"]')).not.toBeNull();
    expect(container.querySelector('[data-assistant-activity-flow]')?.textContent).not.toContain('先核对文件。');
    expect(container.querySelector('[data-assistant-activity-flow] details')?.hasAttribute('open')).toBe(false);
  });
  it('automatically expands live details only in realtime mode and closes them on completion', () => {
    render({ role: 'assistant', content: content.slice(0, 3) }, true, { reasoningLevel: 'stream' });
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-assistant-thinking]')?.textContent).toContain('分析文件之间的关系。');
    expect(container.querySelector('[data-activity-status="running"]')).not.toBeNull();
    render({ role: 'assistant', content: complete() }, false, { reasoningLevel: 'stream' });
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it('respects a user closing realtime details while tokens continue', () => {
    render({ role: 'assistant', content: content.slice(0, 3) }, true, { reasoningLevel: 'stream' });
    act(() => disclosure().click());
    render({ role: 'assistant', content: [...content.slice(0, 3), { type: 'thinking', text: '继续检查', streaming: true }] }, true, { reasoningLevel: 'stream' });
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
  });
  it.each([{ reasoningLevel: 'off' as const }, { reasoningLevel: 'stream' as const, showAssistantWorkLog: false }])('honors concise configuration: %j', options => {
    render({ role: 'assistant', content: complete() }, false, options);
    expect(container.textContent).toContain('核对结果。');
    expect(container.textContent).not.toMatch(/先核对文件|分析文件|读取文件/);
    expect(container.querySelector('[data-assistant-activity]')).toBeNull();
    render({ role: 'assistant', content: content.slice(0, 3) }, true, options);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('.xopc-personal-thinking-dots')).toBeNull();
  });
  it('keeps failed tools inspectable in concise mode', () => {
    render({ role: 'assistant', content: [
      { type: 'tool_use', id: 'failed', name: 'exec_command', status: 'error', result: 'PRIVATE_INTERNAL_ERROR' },
      { type: 'text', text: '这部分暂时无法获取。', presentation: 'answer' },
    ] }, false, { reasoningLevel: 'off', showAssistantWorkLog: false });
    expect(disclosure()).not.toBeNull();
    expect(container.textContent).toContain('这部分暂时无法获取。');
    expect(container.textContent).not.toContain('PRIVATE_INTERNAL_ERROR');
    act(() => disclosure().click());
    expect(container.querySelector('[data-activity-status="failed"]')).not.toBeNull();
  });
  it('does not replay process as plain tool-title paragraphs for partial outcomes', () => {
    render({ role: 'assistant', content: complete(), outcome: { version: 1, outcomeId: 'o', runId: 'r', turnId: 'r',
      status: 'partial', deliverables: [], evidence: [], createdAt: '2026-10-29' } }, false);
    expect([...container.querySelectorAll('.assistant-markdown-content')].map(node => node.textContent))
      .toEqual(['先核对文件。', '核对结果。']);
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-assistant-activity-flow]')).toBeNull();
    expect(container.textContent).not.toContain('已完成部分内容');
  });
  it('retains distinct repeated narration and each parallel tool identity', () => {
    render({ role: 'assistant', content: [
      { type: 'text', text: '再核对一次。', presentation: 'narration', segmentId: 'one' },
      { type: 'text', text: '再核对一次。', presentation: 'narration', segmentId: 'two' },
      ...Array.from({ length: 4 }, (_, index) => ({ type: 'tool_use' as const, id: `read-${index}`, name: 'read_file', status: 'running' as const })),
    ] }, true, { reasoningLevel: 'stream' });
    expect(container.querySelectorAll('[data-chat-find-text] > .assistant-markdown-content')).toHaveLength(2);
    expect(container.querySelectorAll('[data-activity-status="running"]')).toHaveLength(4);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
  it.each([false, true])('uses only three dots for Personal activity even with developer mode=%s', showRawToolData => {
    useDevViewStore.setState({ showRawToolData });
    render({ role: 'assistant', content: content.slice(0, 3) }, true, { personal: true, reasoningLevel: 'stream' });
    expect(container.querySelectorAll('.xopc-personal-thinking-dots i')).toHaveLength(3);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.textContent).not.toMatch(/先核对文件|分析文件|读取文件/);
    render({ role: 'assistant', content: complete() }, false, { personal: true });
    expect(container.textContent).toContain('核对结果。');
    expect(container.textContent).not.toMatch(/先核对文件|分析文件|读取文件/);
    expect(container.querySelector('.xopc-personal-thinking-dots')).toBeNull();
  });
});

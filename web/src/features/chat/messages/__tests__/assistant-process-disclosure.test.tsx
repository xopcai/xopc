// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/extensions/extension-provider', () => ({ useUiExtensions: () => [] }));
import { MessageBubble } from '../message-bubble';
import { assistantProcessState } from '../assistant-process-disclosure';
import { mergeConsecutiveAssistantMessages, sessionWireToUiMessages } from '../agent-messages';
import { useLocaleStore } from '@/stores/locale-store';
import type { Message, ReasoningLevel } from '../messages.types';

const content: Message['content'] = [
  { type: 'text', text: '先检查授权。', segmentId: 'opening', presentation: 'narration' },
  { type: 'thinking', text: '分析授权切换。', streaming: false },
  { type: 'tool_use', id: 'read', name: 'read_file', status: 'done' },
  { type: 'text', text: '继续验证脱敏。', segmentId: 'progress', presentation: 'narration' },
  { type: 'tool_use', id: 'test', name: 'exec_command', status: 'error' },
  { type: 'text', text: '| 结果 | 状态 |\n| --- | --- |\n| 已检查 | 完成 |', segmentId: 'final', presentation: 'answer' },
];
const completed: Message = { role: 'assistant', turnId: 'run', runStatus: 'success', startedAt: 1000, completedAt: 11000, content };

describe('whole assistant process disclosure', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useLocaleStore.setState({ language: 'zh' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    act(() => root.unmount());
    container.remove();
  });
  function render(message: Message, streaming = false, options: { personal?: boolean; reasoningLevel?: ReasoningLevel } = {}) {
    act(() => root.render(<MemoryRouter><MessageBubble message={message} isStreaming={streaming}
      progress={null} responseFeedbackEnabled={false} {...options} /></MemoryRouter>));
  }
  const toggle = () => container.querySelector<HTMLButtonElement>('[data-assistant-process-toggle]')!;
  const process = () => [...container.querySelectorAll<HTMLElement>('[data-assistant-process-item]')];

  it.each(['on', 'stream'] as const)('folds the whole process after terminal success in %s mode without replacing the final table', reasoningLevel => {
    render({ ...completed, runStatus: undefined }, true, { reasoningLevel });
    const table = container.querySelector('table');
    expect(toggle()).toBeNull();
    expect(process().every(item => !item.hidden)).toBe(true);
    render(completed, false, { reasoningLevel });
    expect(container.querySelector('table')).toBe(table);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('已用时');
    expect(process()).toHaveLength(4);
    expect(process().every(item => item.hidden)).toBe(true);
    expect(table?.closest('[hidden]')).toBeNull();
    expect(container.querySelectorAll('[data-assistant-process-toggle]')).toHaveLength(1);
    act(() => toggle().click());
    expect(process().every(item => !item.hidden)).toBe(true);
    expect(container.querySelector('table')).toBe(table);
    render({ ...completed, usage: { outputTokens: 100 } }, false, { reasoningLevel });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    act(() => toggle().click());
    expect(process().every(item => item.hidden)).toBe(true);
  });
  it('folds history consistently without inventing an elapsed time', () => {
    const [history] = sessionWireToUiMessages([
      { role: 'assistant', id: 'first', content: content.slice(0, 3) },
      { role: 'assistant', id: 'next', content: content.slice(3, 5) },
      { role: 'assistant', id: 'last', content: content.slice(5) },
    ]);
    render(history);
    expect(toggle().textContent).toContain('查看执行过程');
    expect(toggle().textContent).not.toContain('秒');
    expect(process().every(item => item.hidden)).toBe(true);
    act(() => toggle().click());
    expect(process().every(item => !item.hidden)).toBe(true);
  });
  it('keeps process open on failure or cancellation without a confirmed final answer', () => {
    for (const runStatus of ['error', 'cancelled'] as const) {
      render({ ...completed, runStatus, content: content.slice(0, 5) });
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(process().every(item => !item.hidden)).toBe(true);
      expect(toggle().textContent).toContain(runStatus === 'error' ? '执行失败' : '已停止');
    }
  });
  it('does not fold a pending interrupted draft or an unfinished review', () => {
    const pending = { ...completed, runStatus: 'cancelled' as const, content: content.map(block => block.type === 'text'
      && block.segmentId === 'final' ? { ...block, presentation: 'pending' as const } : block) };
    render(pending);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(assistantProcessState({ ...pending, content: [...content.slice(0, 5), {
      type: 'review', target: 'PR', summary: '', findings: [], overallCorrectness: 'unknown', overallExplanation: '', status: 'reviewing',
    }] }, false).defaultCollapsed).toBe(false);
  });
  it.each(['aborted', 'error'] as const)('preserves %s after a history reload including outcome-only rows', stopReason => {
    const [history] = sessionWireToUiMessages([
      { role: 'assistant', id: 'first', content: content.slice(0, 3) },
      { role: 'assistant', id: 'interrupted', stopReason, content: [{ type: 'text', text: 'Interrupted draft' }] },
      { role: 'assistant', content: '', metadata: { turnOutcome: { version: 1, outcomeId: 'o', runId: 'run', turnId: 'run',
        status: 'partial', evidence: [], deliverables: [], createdAt: '2026-10-29' } } },
    ]);
    render(history);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().textContent).toContain(stopReason === 'aborted' ? '已停止' : '执行失败');
    expect(container.textContent).toContain('Interrupted draft');
  });
  it('does not inherit terminal metadata when another run continues the same visible reply', () => {
    const [continued] = mergeConsecutiveAssistantMessages([
      { ...completed, outcome: { version: 1, outcomeId: 'o', runId: 'run', turnId: 'run', status: 'succeeded',
        evidence: [], deliverables: [], createdAt: '2026-10-29' } },
      { role: 'assistant', turnId: 'continuation', content: [{ type: 'text', text: 'Continuing', presentation: 'pending' }] },
    ]);
    expect(continued.runStatus).toBeUndefined();
    expect(continued.outcome).toBeUndefined();
    expect(continued.completedAt).toBeUndefined();
    expect(assistantProcessState(continued, false).settled).toBe(false);
  });
  it('keeps waiting and disconnected streams open', () => {
    for (const runStatus of ['suspended', undefined] as const) {
      render({ ...completed, runStatus });
      expect(toggle()).toBeNull();
      expect(process().every(item => !item.hidden)).toBe(true);
    }
  });
  it('does not misclassify a normal historical stop reason as an interruption', () => {
    const [history] = sessionWireToUiMessages([
      { role: 'assistant', content: content.slice(0, 3), stopReason: 'toolUse' },
      { role: 'assistant', content: content.slice(5), stopReason: 'stop' },
    ]);
    render(history);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('查看执行过程');
  });
  it('keeps a partial-result label outside the folded process', () => {
    render({ ...completed, outcome: { version: 1, outcomeId: 'o', runId: 'run', turnId: 'run', status: 'partial',
      evidence: [], deliverables: [], createdAt: '2026-10-29' } });
    expect(toggle().textContent).toContain('部分完成');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('table')?.closest('[hidden]')).toBeNull();
  });
  it('defers automatic folding until the user releases selected process text', () => {
    render({ ...completed, runStatus: undefined }, true);
    const narration = process()[0].querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(narration);
    act(() => { window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
    render(completed);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    act(() => { window.getSelection()!.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
  it('keeps concise mode and Personal free of whole-process controls', () => {
    render(completed, false, { reasoningLevel: 'off' });
    expect(toggle()).toBeNull();
    expect(container.textContent).not.toContain('先检查授权');
    expect(container.querySelector('table')).not.toBeNull();
    render({ ...completed, content: content.slice(0, 5) }, true, { personal: true, reasoningLevel: 'stream' });
    expect(toggle()).toBeNull();
    expect(container.querySelectorAll('.xopc-personal-thinking-dots i')).toHaveLength(3);
  });
  it('keeps focused tool controls reachable until focus leaves the process', () => {
    render({ ...completed, runStatus: undefined }, true);
    const toolControl = container.querySelector<HTMLButtonElement>('[data-assistant-work-log] button')!;
    act(() => toolControl.focus());
    render(completed);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    act(() => toggle().focus());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
  it('leaves attachments visible outside process nodes', () => {
    render({ ...completed, attachments: [{ name: 'report.txt', type: 'file', content: 'report' }] });
    const attachment = [...container.querySelectorAll('*')].find(node => node.textContent === 'report.txt');
    expect(attachment).toBeDefined();
    expect(attachment?.closest('[hidden]')).toBeNull();
  });
});

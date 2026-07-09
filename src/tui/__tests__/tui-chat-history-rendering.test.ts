import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { appendHistoryToChatLog, historyKeysHaveAppendOnlyPrefix } from '../chat-history.js';
import { ChatLog } from '../components/chat-log.js';

function stripAnsi(text: string): string {
  return text
    .replace(/][^]*/g, '')
    .replace(/[[0-9;]*m/g, '');
}

function assistantMessage(content: unknown, extra: Partial<AgentMessage> = {}): AgentMessage {
  return {
    role: 'assistant',
    content,
    timestamp: 1,
    ...extra,
  } as AgentMessage;
}

describe('history replay rendering', () => {
  it('detects append-only history key updates', () => {
    expect(historyKeysHaveAppendOnlyPrefix(['a', 'b'], ['a', 'b', 'c'])).toBe(true);
    expect(historyKeysHaveAppendOnlyPrefix(['a', 'b'], ['a', 'x', 'c'])).toBe(false);
    expect(historyKeysHaveAppendOnlyPrefix([], ['a'])).toBe(false);
  });

  it('renders assistant error state even when no tokens streamed', () => {
    const chatLog = new ChatLog();
    chatLog.finalizeAssistant(assistantMessage([], {
      stopReason: 'error',
      errorMessage: 'provider unavailable',
    }), 'run-error');

    const rendered = stripAnsi(chatLog.render(100).join('\n'));
    expect(rendered).toContain('Error: provider unavailable');
  });

  it('does not add assistant OSC 133 markers for runs with tool calls', () => {
    const chatLog = new ChatLog();
    chatLog.startAssistant(assistantMessage([{ type: 'text', text: 'calling tool' }]), 'run-1');
    chatLog.startTool('tool-1', 'read_file', { path: 'a.ts' }, 'run-1');
    chatLog.updateToolResult('tool-1', 'done', false);
    chatLog.finalizeAssistant(assistantMessage([{ type: 'text', text: 'done' }]), 'run-1');

    const rendered = chatLog.render(100).join('\n');
    expect(rendered).not.toContain('\x1b]133;A\x07');
    expect(rendered).not.toContain('\x1b]133;B\x07');
    expect(rendered).not.toContain('\x1b]133;C\x07');
  });

  it('updates existing assistant rows when thinking display changes', () => {
    const chatLog = new ChatLog();
    chatLog.finalizeAssistant(
      assistantMessage([
        { type: 'thinking', thinking: 'private plan' },
        { type: 'text', text: 'answer' },
      ]),
      'run-1',
    );

    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('private plan');

    chatLog.setShowThinking(false);
    const hidden = stripAnsi(chatLog.render(100).join('\n'));
    expect(hidden).toContain('Thinking...');
    expect(hidden).toContain('answer');
    expect(hidden).not.toContain('private plan');
  });

  it('replays assistant history with thinking hidden when configured', () => {
    const chatLog = new ChatLog();
    appendHistoryToChatLog(
      chatLog,
      [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'private plan' },
            { type: 'text', text: 'answer' },
          ],
        },
      ],
      false,
      false,
    );

    const rendered = stripAnsi(chatLog.render(100).join('\n'));
    expect(rendered).toContain('Thinking...');
    expect(rendered).toContain('answer');
    expect(rendered).not.toContain('private plan');
  });

  it('can render a window around a selected history display index', () => {
    const chatLog = new ChatLog();
    chatLog.setViewportRowsProvider(() => 8);
    appendHistoryToChatLog(
      chatLog,
      [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'target question' },
        { role: 'assistant', content: 'target answer' },
        { role: 'user', content: 'latest question' },
        { role: 'assistant', content: 'latest answer' },
      ],
      false,
    );

    expect(chatLog.jumpToDisplayIndex(2)).toBe(true);
    const historyView = stripAnsi(chatLog.render(100).join('\n'));
    expect(historyView).toContain('Viewing previous transcript');
    expect(historyView).toContain('target question');
    expect(historyView).not.toContain('latest answer');

    chatLog.jumpToLatest();
    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('latest answer');
  });

  it('replays compaction rows as expandable summary components', () => {
    const chatLog = new ChatLog();
    appendHistoryToChatLog(
      chatLog,
      [
        {
          role: 'system',
          kind: 'compaction',
          content: 'Compacted decisions',
          tokensBefore: 9000,
          tokensAfter: 1200,
        },
      ],
      false,
    );

    const collapsed = stripAnsi(chatLog.render(100).join('\n'));
    expect(collapsed).toContain('[compaction]');
    expect(collapsed).toContain('9,000 -> 1,200');
    expect(collapsed).not.toContain('Compacted decisions');

    chatLog.setToolsExpanded(true);
    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('Compacted decisions');
  });

  it('replays bash execution rows as expandable shell output blocks', () => {
    const chatLog = new ChatLog();
    appendHistoryToChatLog(
      chatLog,
      [
        {
          role: 'system',
          kind: 'bash',
          content: 'line 1\nline 2\nline 3',
          bash: {
            command: 'pnpm test',
            output: Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n'),
            exitCode: 0,
            excludeFromContext: true,
          },
        },
      ],
      false,
    );

    const collapsed = stripAnsi(chatLog.render(100).join('\n'));
    expect(collapsed).toContain('$ pnpm test');
    expect(collapsed).toContain('5 more lines');
    expect(collapsed).toContain('exit 0 · excluded from agent context');
    expect(collapsed).not.toContain('line 0');

    chatLog.setToolsExpanded(true);
    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('line 0');
  });

  it('replays custom message rows with a typed fallback renderer', () => {
    const chatLog = new ChatLog();
    appendHistoryToChatLog(
      chatLog,
      [
        {
          role: 'system',
          kind: 'custom',
          content: 'Loaded **skill**',
          custom: {
            customType: 'skill',
            details: { id: 'skill-a' },
          },
        },
      ],
      false,
    );

    const rendered = stripAnsi(chatLog.render(100).join('\n'));
    expect(rendered).toContain('[skill]');
    expect(rendered).toContain('Loaded skill');
  });

  it('keeps hidden custom messages out of the rendered chat log', () => {
    const chatLog = new ChatLog();
    appendHistoryToChatLog(
      chatLog,
      [
        {
          role: 'system',
          kind: 'custom',
          content: 'secret',
          custom: {
            customType: 'hidden',
            display: false,
          },
        },
      ],
      false,
    );

    expect(stripAnsi(chatLog.render(100).join('\n'))).not.toContain('secret');
  });

  it('replays branch summary rows as expandable summary blocks', () => {
    const chatLog = new ChatLog();
    appendHistoryToChatLog(
      chatLog,
      [
        {
          role: 'system',
          kind: 'branch',
          content: 'Side branch changed the plan',
          branch: {
            summary: 'Side branch changed the plan',
            fromId: 'entry-7',
          },
        },
      ],
      false,
    );

    const collapsed = stripAnsi(chatLog.render(100).join('\n'));
    expect(collapsed).toContain('[branch]');
    expect(collapsed).toContain('entry-7');
    expect(collapsed).not.toContain('Side branch changed the plan');

    chatLog.setToolsExpanded(true);
    const expanded = stripAnsi(chatLog.render(100).join('\n'));
    expect(expanded).toContain('Branch Summary');
    expect(expanded).toContain('Side branch changed the plan');
  });

  it('replays pi-style compaction summary rows as expandable summary blocks', () => {
    const chatLog = new ChatLog();
    appendHistoryToChatLog(
      chatLog,
      [
        {
          role: 'system',
          kind: 'compaction',
          content: 'Earlier context was compacted',
          tokensBefore: 12000,
        },
      ],
      false,
    );

    const collapsed = stripAnsi(chatLog.render(100).join('\n'));
    expect(collapsed).toContain('[compaction]');
    expect(collapsed).toContain('12,000 -> ?');
    expect(collapsed).not.toContain('Earlier context was compacted');

    chatLog.setToolsExpanded(true);
    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('Earlier context was compacted');
  });
});

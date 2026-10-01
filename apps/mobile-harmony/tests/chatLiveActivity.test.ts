import { describe, expect, it } from 'vitest';
import { reduceChatStream } from '../entry/src/main/ets/common/chatStream.ets';
import { chatLiveCompletedCount, chatLiveElapsedSeconds, chatLiveNarration, reduceChatSnapshotActivity } from '../entry/src/main/ets/common/chatLiveActivity.ets';

describe('live chat activity', () => {
  it('tracks real tool stages without retaining private arguments or thinking', () => {
    let row = reduceChatStream(undefined, 'thinking_delta', { delta: 'private reasoning' }, 'run');
    expect(row.activity).toBe('thinking');
    row = reduceChatStream(row, 'tool_start', {
      toolCallId: 'tool-1', toolName: 'read_file', args: { path: '/private/work' },
    }, 'run');
    expect(row.activity).toBe('read');
    expect(JSON.stringify(row)).not.toContain('/private/work');
    expect(JSON.stringify(row)).not.toContain('private reasoning');
    row = reduceChatStream(row, 'tool_end', { toolCallId: 'tool-1', status: 'success' }, 'run');
    expect(chatLiveCompletedCount(row)).toBe(1);
    row = reduceChatStream(row, 'tool_end', { toolCallId: 'tool-1', status: 'success' }, 'run');
    expect(chatLiveCompletedCount(row)).toBe(1);
  });

  it('ignores private progress messages and reports actual elapsed time', () => {
    const row = reduceChatStream(undefined, 'progress', {
      stage: 'unknown', message: 'Testing /private/customer-repo',
    }, 'run');
    expect(row.activity).toBe('working');
    expect(JSON.stringify(row)).not.toContain('/private/customer-repo');
    expect(chatLiveElapsedSeconds(1000, 8999)).toBe(7);
    expect(chatLiveElapsedSeconds(1000, 9000)).toBe(8);
  });

  it('keeps safe tool activity across snapshot refreshes without duplicating answer text', () => {
    let row = reduceChatSnapshotActivity(undefined, 'tool_start', {
      toolCallId: 'search-1', toolName: 'web_search', args: { query: 'private query' },
    }, 'run');
    expect(row.activity).toBe('search');
    row = reduceChatSnapshotActivity(row, 'tool_end', { toolCallId: 'search-1', status: 'success' }, 'run');
    expect(chatLiveCompletedCount(row)).toBe(1);
    row = reduceChatSnapshotActivity(row, 'assistant_delta', { delta: 'private answer' }, 'run');
    expect(row.activity).toBe('responding');
    expect(row.text).toBe('');
    expect(JSON.stringify(row)).not.toContain('private');
  });

  it('surfaces completed public narration without leaking pending answer text', () => {
    let row = reduceChatStream(undefined, 'assistant_delta', {
      messageId: 'narration', delta: 'Checking the project structure', offset: 0,
    }, 'run');
    expect(chatLiveNarration(row)).toBe('');
    row = reduceChatStream(row, 'assistant_message_end', {
      messageId: 'narration', presentation: 'narration',
    }, 'run');
    expect(chatLiveNarration(row)).toBe('Checking the project structure');
    row = reduceChatStream(row, 'assistant_delta', {
      messageId: 'answer', delta: 'Here is the result', offset: 0,
    }, 'run');
    expect(chatLiveNarration(row)).toBe('');
  });

  it('does not replace an active tool status with assistant text', () => {
    let row = reduceChatStream(undefined, 'tool_start', {
      toolCallId: 'read-1', toolName: 'read_file',
    }, 'run');
    row = reduceChatStream(row, 'assistant_delta', {
      messageId: 'narration', delta: 'Reading the relevant files', offset: 0,
    }, 'run');
    expect(row.activity).toBe('read');
  });
});

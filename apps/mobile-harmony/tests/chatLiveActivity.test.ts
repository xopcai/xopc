import { describe, expect, it } from 'vitest';
import { reduceChatStream } from '../entry/src/main/ets/common/chatStream.ets';
import { chatLiveCompletedCount, chatLiveElapsedSeconds, chatLiveNarration, chatLiveStages, chatStageStatus, reduceChatSnapshotActivity } from '../entry/src/main/ets/common/chatLiveActivity.ets';
import { chatPresentationRows } from '../entry/src/main/ets/common/chatPresentation.ets';

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

  it('shows ordered public stages immediately and retains them while the next segment is pending', () => {
    let row;
    for (const [id, text] of [['connect', '确认手机连接'], ['search', '查找京东'], ['install', '安装京东'], ['verify', '检查安装结果']]) {
      row = reduceChatStream(row, 'assistant_delta', { messageId: id, delta: text, offset: 0 }, 'run');
      row = reduceChatStream(row, 'assistant_message_end', { messageId: id, presentation: 'narration' }, 'run');
    }
    row = reduceChatStream(row, 'thinking_delta', { delta: 'private reasoning' }, 'run');
    row = reduceChatStream(row, 'assistant_delta', { messageId: 'final', delta: '未分类的草稿', offset: 0 }, 'run');
    expect(chatLiveStages(row).map(stage => stage.text)).toEqual(['确认手机连接', '查找京东', '安装京东', '检查安装结果']);
    expect(chatLiveStages(row).map(stage => stage.id)).toEqual(['connect:text', 'search:text', 'install:text', 'verify:text']);
    expect(chatLiveNarration(row)).toBe(''); // Personal chat keeps its existing behavior.
    row = reduceChatStream(row, 'assistant_message_end', { messageId: 'final', presentation: 'answer' }, 'run');
    expect(chatLiveStages(row)).toEqual([]);
    expect(row.live).toBe(true);
    row = reduceChatStream(row, 'run_end', { status: 'success' }, 'run');
    expect(chatLiveStages(row)).toEqual([]);
    expect(chatStageStatus(row)).toBe('');
    expect(row.blocks?.filter(block => block.presentation === 'narration')).toHaveLength(4);
  });

  it.each([['error', 'failed'], ['cancelled', 'interrupted'], ['suspended', 'waiting']])(
    'retains public stages and an explicit status after %s without promoting pending drafts', (status, expected) => {
      let row = reduceChatStream(undefined, 'assistant_delta', { messageId: 'stage', delta: '确认设备连接', offset: 0 }, 'run');
      row = reduceChatStream(row, 'assistant_message_end', { messageId: 'stage', presentation: 'narration' }, 'run');
      row = reduceChatStream(row, 'assistant_delta', { messageId: 'draft', delta: 'Unclassified draft', offset: 0 }, 'run');
      row = reduceChatStream(row, 'run_end', { status }, 'run');
      expect(chatStageStatus(row)).toBe(expected);
      expect(chatLiveStages(row).map(stage => stage.text)).toEqual(['确认设备连接']);
      expect(row.blocks?.[1].presentation).toBe('pending');
      expect(chatPresentationRows([], row, '')).toHaveLength(1);
    });

  it('retains an error with no final answer and restores terminal state from history outcomes', () => {
    const error = reduceChatStream(undefined, 'error', { message: 'failed' }, 'run');
    expect(chatStageStatus(error)).toBe('failed');
    expect(chatPresentationRows([], error, '')).toHaveLength(1);
    for (const [status, expected] of [['failed', 'failed'], ['partial', 'interrupted'], ['suspended', 'waiting']]) {
      const row = { id: 'history', role: 'assistant', text: '', outcome: {
        version: 1, outcomeId: 'outcome', runId: 'run', turnId: 'run', status, deliverables: [],
      } };
      expect(chatStageStatus(chatPresentationRows([row], undefined, '')[0])).toBe(expected);
    }
  });

  it('deduplicates public stages when history and realtime use different message IDs', () => {
    const history = { id: 'saved', role: 'assistant', text: '', turnId: 'run', blocks: [
      { id: 'row-1', kind: 'text', text: '正在确认范围', presentation: 'narration' },
      { id: 'row-2', kind: 'text', text: '正在检查消息顺序', presentation: 'narration' },
    ] };
    const live = { id: 'live:run', role: 'assistant', text: '', turnId: 'run', live: true, blocks: [
      { id: 'msg-1', kind: 'text', text: '正在确认范围 ', presentation: 'narration' },
      { id: 'msg-2', kind: 'text', text: '正在检查消息顺序', presentation: 'narration' },
      { id: 'msg-3', kind: 'text', text: '正在验证执行状态', presentation: 'narration' },
    ] };
    const merged = chatPresentationRows([history], live, 'run')[0];
    expect(chatLiveStages(merged).map(stage => stage.text)).toEqual(['正在确认范围', '正在检查消息顺序', '正在验证执行状态']);
    expect(merged.blocks).toHaveLength(5);
  });
});

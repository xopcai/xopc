import { describe, expect, it } from 'vitest';

import { buildMemoryMutationView } from '../memory-activity';
import type { ToolUseContent } from '../messages.types';

const block = (details: Record<string, unknown>): ToolUseContent => ({ type: 'tool_use', id: 'save', name: 'personal_memory',
  status: 'done', result: { details } });
const receipt = { receiptId: 'committed', committedAt: 1, status: 'saved', command: 'remember', available: true,
  usable: true, scope: { type: 'project', id: 'p' } };

describe('chat memory receipts', () => {
  it('only labels committed and currently usable memory as saved', () => {
    expect(buildMemoryMutationView(block(receipt), true)).toEqual({ title: '已记住', purpose: '当前项目 · 从下一轮按需使用。' });
    expect(buildMemoryMutationView(block({ status: 'saved' }), true).title).toBe('记忆修改未确认保存');
    expect(buildMemoryMutationView(block({ ...receipt, usable: false }), true).title).toBe('已保存，暂不使用');
    expect(buildMemoryMutationView(block({ ...receipt, available: false }), true).title).toBe('这条记忆已不再可用');
  });
  it('distinguishes corrections, scope, review, failure and retained originals', () => {
    expect(buildMemoryMutationView(block({ ...receipt, command: 'correct' }), true).title).toBe('已纠正记忆');
    expect(buildMemoryMutationView(block({ ...receipt, command: 'scope' }), true).title).toBe('已调整记忆范围');
    expect(buildMemoryMutationView(block({ ...receipt, status: 'pending' }), true).title).toBe('已保存，暂不使用');
    expect(buildMemoryMutationView(block({ ...receipt, status: 'failed' }), true).title).toBe('记忆修改未确认保存');
    expect(buildMemoryMutationView(block({ ...receipt, status: 'forgotten' }), true).purpose).toContain('原始对话和文件保留');
    expect(buildMemoryMutationView(block({ ...receipt, command: 'correct' }), false).title).toBe('Memory corrected');
  });
});

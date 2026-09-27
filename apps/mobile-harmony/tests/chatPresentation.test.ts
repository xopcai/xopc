import { describe, expect, it } from 'vitest';
import { chatPresentationRows, chatNeedsWideBubble } from '../entry/src/main/ets/common/chatPresentation.ets';
import type { XopcChatRow } from '../entry/src/main/ets/model/chat.ets';

const user: XopcChatRow = { id: 'u', role: 'user', text: 'prepare' };
const steps: XopcChatRow = { id: 'a', role: 'assistant', text: '', turnId: 't', blocks: [
  { id: 'thinking', kind: 'thinking', text: 'plan' },
  { id: 'tool', kind: 'tool', text: '', call: { id: 'call', name: 'read_file', status: 'done' } },
] };

describe('one continuous assistant response', () => {
  it.each([true, false])('keeps narration readable with no final answer (live=%s)', live => {
    const row: XopcChatRow = { id: 'progress', role: 'assistant', text: '', live,
      blocks: [{ id: 'notice', kind: 'text', text: '我来帮你搜集今天的重要 AI 新闻', presentation: 'narration' }] };
    expect(chatNeedsWideBubble(row)).toBe(true);
    expect(chatNeedsWideBubble({ ...row, blocks: [...row.blocks!, { id: 'answer', kind: 'text', text: '好了', presentation: 'answer' }] })).toBe(true);
  });
  it('keeps ordinary short answers and empty running placeholders compact', () => {
    expect(chatNeedsWideBubble({ id: 'a', role: 'assistant', text: '你好', blocks: [{ id: 'a', kind: 'text', text: '你好', presentation: 'answer' }] })).toBe(false);
    expect(chatNeedsWideBubble({ id: 'a', role: 'assistant', text: '', live: true })).toBe(false);
  });
  it('preserves product deliveries through active snapshot presentation and gives them full width', () => {
    const row: XopcChatRow = { id: 'a', role: 'assistant', text: '', deliveries: [
      { version: 2, operation: 'created', primary: { kind: 'note', id: 'n', title: '新闻', capabilities: ['open'] } },
    ] };
    const presented = chatPresentationRows([row], undefined, 'r')[0];
    expect(presented.deliveries).toEqual(row.deliveries);
    expect(chatNeedsWideBubble(presented)).toBe(true);
  });
  it('marks snapshot steps active instead of adding a second running bubble', () => {
    const rows = chatPresentationRows([user, steps], undefined, 'r');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: 'a', live: true });
    expect(steps.live).toBeUndefined();
  });
  it('keeps partial final text in the same active snapshot card', () => {
    const answer = { ...steps, text: 'answer', blocks: [...steps.blocks!, { id: 'text', kind: 'text', text: 'answer' }] };
    expect(chatPresentationRows([user, answer], undefined, 'r')).toHaveLength(2);
  });
  it('joins final streaming text to the preceding process without mutating either source', () => {
    const live: XopcChatRow = { id: 'live:r', role: 'assistant', text: 'answer', live: true,
      blocks: [{ id: 'text', kind: 'text', text: 'answer' }] };
    const rows = chatPresentationRows([user, steps], live, 'r');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: 'a', text: 'answer', live: true });
    expect(rows[1].blocks).toHaveLength(3);
    expect(steps.blocks).toHaveLength(2);
    expect(steps.sourceIds).toBeUndefined();
    expect(live.sourceIds).toBeUndefined();
  });
  it('does not combine explicit different turns or cross a user message', () => {
    const live: XopcChatRow = { id: 'live:r', role: 'assistant', text: '', turnId: 'other', live: true };
    expect(chatPresentationRows([user, steps], live, 'r')).toHaveLength(3);
    expect(chatPresentationRows([steps, user], live, 'r')).toHaveLength(3);
  });
  it('uses one placeholder before the response and no placeholder after completion', () => {
    expect(chatPresentationRows([user], undefined, 'r')[1]).toMatchObject({ id: 'live:r', live: true });
    expect(chatPresentationRows([user, steps], undefined, '')).toEqual([user, steps]);
  });
  it('keeps the response identity and stops the active state on run end', () => {
    const live: XopcChatRow = { id: 'live:r', role: 'assistant', text: 'done', live: false,
      blocks: [{ id: 'text', kind: 'text', text: 'done' }] };
    const result = chatPresentationRows([user, steps], live, '');
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ id: 'a', live: false, text: 'done' });
  });
});

import { describe, expect, it } from 'vitest';
import { chatPresentationRows } from '../entry/src/main/ets/common/chatPresentation.ets';
import type { XopcChatRow } from '../entry/src/main/ets/model/chat.ets';

const user: XopcChatRow = { id: 'u', role: 'user', text: 'prepare' };
const steps: XopcChatRow = { id: 'a', role: 'assistant', text: '', turnId: 't', blocks: [
  { id: 'thinking', kind: 'thinking', text: 'plan' },
  { id: 'tool', kind: 'tool', text: '', call: { id: 'call', name: 'read_file', status: 'done' } },
] };

describe('one continuous assistant response', () => {
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

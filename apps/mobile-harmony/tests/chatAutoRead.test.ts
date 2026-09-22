import { describe, expect, it } from 'vitest';
import { advanceChatAutoRead, latestChatAutoRead } from '../entry/src/main/ets/common/chatAutoRead.ets';
const old = { key: 'c:old', text: 'Old answer' };
const fresh = { key: 'c:new', text: 'New answer' };
describe('continuous read-aloud completion edge', () => {
  it('never speaks on initial history, enabling, paging or switching conversations', () => {
    let next = advanceChatAutoRead(undefined, 'c', false, false, old);
    next = advanceChatAutoRead(next.state, 'c', true, false, old); expect(next.candidate).toBeUndefined();
    next = advanceChatAutoRead(next.state, 'c', true, false, fresh); expect(next.candidate).toBeUndefined();
    next = advanceChatAutoRead(next.state, 'other', true, false, fresh); expect(next.candidate).toBeUndefined();
  });
  it('waits for persisted history after run_end and speaks exactly once', () => {
    let next = advanceChatAutoRead(undefined, 'c', true, false, old);
    next = advanceChatAutoRead(next.state, 'c', true, true, old);
    next = advanceChatAutoRead(next.state, 'c', true, false, old); expect(next.candidate).toBeUndefined();
    next = advanceChatAutoRead(next.state, 'c', true, false, fresh); expect(next.candidate).toEqual(fresh);
    next = advanceChatAutoRead(next.state, 'c', true, false, fresh); expect(next.candidate).toBeUndefined();
  });
  it('disabling during streaming or enabling after completion does not queue stale speech', () => {
    let next = advanceChatAutoRead(undefined, 'c', true, true, old);
    next = advanceChatAutoRead(next.state, 'c', false, true, old);
    next = advanceChatAutoRead(next.state, 'c', false, false, fresh);
    next = advanceChatAutoRead(next.state, 'c', true, false, fresh); expect(next.candidate).toBeUndefined();
  });
  it('consumes audio-only completions without synthesizing or replaying them', () => {
    const candidate = latestChatAutoRead([{ id: 'new', role: 'assistant', text: 'Audio answer', media: [{ id: 'a', name: 'voice', type: 'audio', mimeType: 'audio/mpeg', size: 0, uri: 'media://a' }] }], 'c');
    let next = advanceChatAutoRead(undefined, 'c', true, true, old);
    next = advanceChatAutoRead(next.state, 'c', true, false, candidate);
    expect(next.candidate).toBeUndefined(); expect(next.state.wasStreaming).toBe(false);
    next = advanceChatAutoRead(next.state, 'c', true, false, fresh); expect(next.candidate).toBeUndefined();
  });
  it('selects final answer text rather than narration, code or user content', () => {
    expect(latestChatAutoRead([{ id: 'one', role: 'assistant', text: '', blocks: [
      { id: 'n', kind: 'text', text: 'I will inspect secrets', presentation: 'narration' },
      { id: 'a', kind: 'text', text: 'Done.\n```ts\nsecret()\n```', presentation: 'answer' },
    ] }, { id: 'two', role: 'user', text: 'Do not read me' }], 'c')).toEqual({ key: 'c:one', text: 'Done.' });
  });
});

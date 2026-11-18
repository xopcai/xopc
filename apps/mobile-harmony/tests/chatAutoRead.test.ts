import { describe, expect, it } from 'vitest';
import { chatSpeechReplies } from '../entry/src/main/ets/common/chatAutoRead.ets';

describe('continuous read-aloud replies', () => {
  it('selects final answers in transcript order and skips live, user and audio rows', () => {
    const rows = [
      { id: 'one', role: 'assistant', text: '', blocks: [
        { id: 'n', kind: 'text', text: 'Working', presentation: 'narration' },
        { id: 'a', kind: 'text', text: 'Done.\n```ts\nexample()\n```', presentation: 'answer' },
      ] },
      { id: 'user', role: 'user', text: 'Do not read me' },
      { id: 'audio', role: 'assistant', text: 'Audio answer', media: [
        { id: 'a', name: 'voice', type: 'audio', mimeType: 'audio/mpeg', size: 0, uri: 'media://a' },
      ] },
      { id: 'live', role: 'assistant', text: 'Partial answer', live: true },
      { id: 'two', role: 'assistant', text: 'Second answer', turnId: 'run' },
    ];
    expect(chatSpeechReplies(rows, 'run')).toEqual([{ id: 'one', text: 'Done.' }]);
    expect(chatSpeechReplies(rows, '')).toEqual([{ id: 'one', text: 'Done.' }, { id: 'two', text: 'Second answer' }]);
  });
});

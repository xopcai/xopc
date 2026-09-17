import { describe, expect, it } from 'vitest';
import { chatSpeechChunks } from '../entry/src/main/ets/common/speechText.ets';
describe('speakable chat text', () => {
  it('does not read code, image URLs, markdown markers or link URLs aloud', () => {
    expect(chatSpeechChunks('# Hello **world**\n[Docs](https://example.com)\n![Image](secret)\n```js\nconst x=1;\n```')).toEqual(['Hello world\nDocs']);
  });
  it('keeps Unicode intact and caps requests at 1200 characters', () => {
    const source = '你好吗🙂'.repeat(600); const chunks = chatSpeechChunks(source);
    expect(chunks.join('')).toBe(source); expect(chunks.every(text => text.length <= 1200)).toBe(true);
    expect(chunks.every(text => !/[\uD800-\uDBFF]$/.test(text))).toBe(true);
  });
  it('has no chunks for empty text or code-only answers', () => { expect(chatSpeechChunks('```ts\nfoo()\n```')).toEqual([]); });
});

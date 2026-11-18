import { describe, expect, it } from 'vitest';
import { chatSpeechChunks, chatSpeakableText, chatSpeechLanguage } from '../entry/src/main/ets/common/speechText.ets';
describe('speakable chat text', () => {
  it('does not read code, image URLs, markdown markers or link URLs aloud', () => {
    expect(chatSpeechChunks('# Hello **world**\n[Docs](https://example.com)\n![Image](secret)\n```js\nconst x=1;\n```')).toEqual(['Hello world\nDocs\nImage']);
  });
  it('keeps Unicode intact and bounds each speech request', () => {
    const source = '你好吗🙂'.repeat(600); const chunks = chatSpeechChunks(source);
    expect(chunks.join('')).toBe(source); expect(chunks[0].length).toBeLessThanOrEqual(160); expect(chunks.every(text => text.length <= 420)).toBe(true);
    expect(chunks.every(text => !/[\uD800-\uDBFF]$/.test(text))).toBe(true);
  });
  it('groups short sentences and keeps a heading with the first sentence', () => {
    const text = 'Results. The rate is 3.14. Next sentence.\nA final line.';
    const first = 'Summary\n' + 'Some more context '.repeat(7) + 'ends here.';
    const second = 'This is the next sentence. It can be synthesized in parallel.';
    expect(chatSpeechChunks(text)).toEqual([text]);
    expect(chatSpeechChunks(first + ' ' + second)).toEqual([first, second]);
  });
  it('has no chunks for empty text or code-only answers', () => { expect(chatSpeechChunks('```ts\nfoo()\n```')).toEqual([]); });
  it.each(['# 标题\n你好，世界。This is a test.', 'Read [docs](https://example.com) https://private.test/token xopc-product-delivery:secret', '> quote\n1. List\n```js\nignored()\n```\n**Done**', 'a'.repeat(600) + '. End!'])('keeps speech output bounded and private: %s', text => {
    const speakable = chatSpeakableText(text);
    const chunks = chatSpeechChunks(text);
    expect(chunks.every(chunk => chunk.length <= 420)).toBe(true);
    expect(speakable).not.toMatch(/https?:\/\/|xopc-product-delivery:|```/);
    expect(chatSpeechLanguage(text, 'en')).toMatch(/^(?:en-US|zh-CN)$/);
    expect(chatSpeechLanguage(text, 'zh')).toMatch(/^(?:en-US|zh-CN)$/);
  });
});

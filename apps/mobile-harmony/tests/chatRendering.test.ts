import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined }));
import { XopcChatStreamBuffer } from '../entry/src/main/ets/common/chatStreamBuffer.ets';
import { XopcMarkdownProjection, XopcMarkdownInlineProjection } from '../entry/src/main/ets/common/markdownProjection.ets';
import { XopcMarkdownStreamParser, markdownCodePreview } from '../entry/src/main/ets/common/markdownStreamParser.ets';
import { markdownBlocks } from '../entry/src/main/ets/common/markdown.ets';
import { XopcChatRenderKeys } from '../entry/src/main/ets/common/chatRenderKeys.ets';

describe('mobile chat rendering', () => {
  it('matches full parsing at every streaming boundary and after edits', () => {
    const parser = new XopcMarkdownStreamParser();
    const source = '# 标题\n\n你好 **世界** [docs](https://example.com)\n\n```ts\na\n\n```oops\nb\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- list\n  - child\n\n> quote\n\nEnd';
    for (let end = 0; end <= source.length; end++) expect(parser.parse(source.slice(0, end))).toEqual(markdownBlocks(source.slice(0, end)));
    for (const replacement of ['Edited\n\nnew', 'CRLF\r\n\r\nend', '']) expect(parser.parse(replacement)).toEqual(markdownBlocks(replacement));
  });
  it('keeps closed prefix objects and bounds code presentation without altering the source', () => {
    const parser = new XopcMarkdownStreamParser();
    const first = parser.parse('Title\n\nTail');
    expect(parser.parse('Title\n\nTail grows')[0]).toBe(first[0]);
    const source = Array.from({ length: 100 }, (_, index) => 'line ' + index).join('\n');
    expect(markdownCodePreview(source).split('\n')).toHaveLength(40);
    expect(source).toContain('line 99');
  });
  it('promotes a live response without replacing its row identity and isolates conversations', () => {
    const keys = new XopcChatRenderKeys();
    const live = { id: 'live:r', role: 'assistant', text: 'Answer', blocks: [{ id: 'm:text', kind: 'text', segmentId: 'm', text: 'Answer' }] };
    keys.update('c', [], live);
    const before = keys.key(live);
    const saved = { id: 'm', sourceIds: ['m'], role: 'assistant', text: 'Answer' };
    keys.update('c', [saved], live);
    expect(keys.key(saved)).toBe(before);
    keys.update('other', [saved]);
    expect(keys.key(saved)).not.toBe(before);
  });
  it('validates received UTF-16 offsets before the UI batch is committed', () => {
    const buffer = new XopcChatStreamBuffer();
    expect(buffer.append('m', '', { messageId: 'm', delta: '你😀', offset: 0 })).toBe('accepted');
    expect(buffer.append('m', '', { delta: '你😀', offset: 0 })).toBe('replay');
    expect(buffer.append('m', '', { delta: '好', offset: 3 })).toBe('accepted');
    expect(buffer.append('m', '', { delta: 'missing', offset: 10 })).toBe('gap');
    expect(buffer.drain()).toEqual([{ messageId: 'm', offset: 0, delta: '你😀好' }]);
    expect(buffer.drain()).toEqual([]);
  });
  it('keeps distinct message segments in order', () => {
    const buffer = new XopcChatStreamBuffer();
    buffer.append('a', 'hi', { messageId: 'a', delta: 'A', offset: 2 });
    buffer.append('b', '', { messageId: 'b', delta: 'B', offset: 0 });
    expect(buffer.drain().map(part => part.messageId)).toEqual(['a', 'b']);
  });
  it('retains prefix and tail identities while content and syntax change', () => {
    const projection = new XopcMarkdownProjection();
    projection.update('# Title\n\nPartial');
    const [heading, tail] = projection.blocks;
    projection.update('# Title\n\nPartial **bold**');
    expect(projection.blocks[0]).toBe(heading);
    expect(projection.blocks[1]).toBe(tail);
    expect(tail.text).toBe('Partial **bold**');
    projection.update('# Title\n\n| a | b |\n| --- | --- |');
    expect(projection.blocks[1].id).toBe(tail.id);
    expect(tail.kind).toBe('table');
  });
  it('updates observable spans without changing identity or captured link targets', () => {
    const projection = new XopcMarkdownInlineProjection();
    projection.update('hello');
    const span = projection.spans[0];
    projection.update('hello world');
    expect(projection.spans[0]).toBe(span); expect(span.text).toBe('hello world');
    projection.update('[docs](https://example.com)');
    expect(projection.spans[0]).toBe(span); expect(span.href).toBe('https://example.com');
  });
});

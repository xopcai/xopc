import { describe, expect, it } from 'vitest';
import { compactHistory, productDeliveries } from '../compact-history.js';
import { transcriptRowsToClientHistory } from '../client-history.js';

describe('compact history', () => {
  it('removes private reasoning and tool data without modifying the default response', () => {
    const messages = transcriptRowsToClientHistory([
      { role: 'user', content: 'hello', metadata: { clientMessageId: 'client' } },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'private' },
        { type: 'text', text: 'Checking '.repeat(100) }, { type: 'toolCall', id: 't', name: 'read', arguments: { secret: 'secret' } }] },
      { role: 'toolResult', toolCallId: 't', content: [{ type: 'text', text: 'output'.repeat(10000) }] },
      { role: 'assistant', content: [{ type: 'text', text: 'final'.repeat(5000) }] },
    ] as never);
    const before = JSON.stringify(messages);
    const compact = compactHistory(messages);
    expect(compact[0].metadata?.clientMessageId).toBe('client');
    expect(compact[1].content.length).toBeLessThanOrEqual(160);
    expect(compact[1].rawContent).toMatchObject([{ presentation: 'narration' }]);
    expect(compact[2].content).toBe('final'.repeat(5000));
    expect(JSON.stringify(compact)).not.toMatch(/private|secret|toolCalls|output/);
    expect(JSON.stringify(messages)).toBe(before);
  });
  it('keeps outcomes, media, reviews and typed deliveries', () => {
    const delivery = { version: 2, operation: 'created', primary: { kind: 'note', id: 'n', title: 'Note', capabilities: ['open'] } };
    const result = compactHistory([{ role: 'assistant', content: '',
      rawContent: [{ type: 'review', summary: 'done' }, { type: 'audio', uri: 'media://voice' }],
      toolCalls: [{ name: 'create', result: 'large', details: { delivery, secret: 'hidden' } }],
    }]);
    expect(result[0].deliveries).toEqual([delivery]);
    expect(result[0].rawContent).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(productDeliveries(null)).toEqual([]);
  });
});

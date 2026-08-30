import { describe, expect, it } from 'vitest';

import { injectSourceContextsIntoUserMessage } from '../injector.js';

describe('injectSourceContextsIntoUserMessage', () => {
  it('wraps multiple notes as untrusted data and records visible summaries', () => {
    const message = { role: 'user', content: 'Compare them', timestamp: 1 } as const;
    const result = injectSourceContextsIntoUserMessage(message, [
      { kind: 'note', sourceId: 'a', version: '1', title: 'A', text: 'Alpha' },
      { kind: 'note', sourceId: 'b', version: '2', title: 'B', text: 'Beta', truncated: true },
    ]) as unknown as { content: Array<{ text: string }>; metadata: { sourceContexts: unknown[] } };

    expect(result.content[0]?.text).toContain('<source_contexts>');
    expect(result.content[0]?.text).toContain('Alpha');
    expect(result.content[0]?.text).toContain('<user_message>\nCompare them\n</user_message>');
    expect(result.metadata.sourceContexts).toEqual([
      expect.objectContaining({ sourceId: 'a', title: 'A' }),
      expect.objectContaining({ sourceId: 'b', title: 'B', truncated: true }),
    ]);
  });
});

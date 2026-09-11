import { describe, expect, it } from 'vitest';

import { browserPageContextToAgentContext } from '../browser-page.js';

describe('browserPageContextToAgentContext', () => {
  it('recomputes the digest and preserves sanitized source metadata', () => {
    const context = browserPageContextToAgentContext({
      kind: 'browser_page',
      sourceId: '1748c26c-e28a-48f5-9476-3b92d10ae137',
      version: '0'.repeat(64),
      title: '  Example  ',
      url: 'https://example.com/path?x=1',
      capturedAt: 5,
      documentId: 'doc-1',
      selection: '  chosen text  ',
      truncated: false,
    });
    expect(context).toMatchObject({
      kind: 'browser_page',
      title: 'Example',
      url: 'https://example.com/path?x=1',
      text: expect.stringContaining('Selected text:\nchosen text'),
    });
    expect(context.version).toMatch(/^[a-f0-9]{64}$/);
    expect(context.version).not.toBe('0'.repeat(64));
  });
});

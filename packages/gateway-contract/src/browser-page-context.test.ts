import { describe, expect, it } from 'vitest';

import {
  browserPageContextsInputSchema,
  MAX_BROWSER_SELECTION_BYTES,
} from './browser-page-context.js';

function context(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'browser_page',
    sourceId: '1748c26c-e28a-48f5-9476-3b92d10ae137',
    version: 'a'.repeat(64),
    title: 'Reference',
    url: 'https://example.com/path?query=kept',
    capturedAt: 1,
    documentId: 'doc-1',
    text: 'Page body',
    truncated: false,
    ...overrides,
  };
}

describe('browser page context contract', () => {
  it('accepts bounded sanitized page snapshots', () => {
    expect(browserPageContextsInputSchema.parse([context()])).toHaveLength(1);
  });

  it.each([
    { url: 'chrome://settings' },
    { url: 'https://user:secret@example.com/' },
    { url: 'https://example.com/#private' },
    { selection: 'x'.repeat(MAX_BROWSER_SELECTION_BYTES + 1), text: undefined },
  ])('rejects unsafe or oversized input %#', (override) => {
    expect(browserPageContextsInputSchema.safeParse([context(override)]).success).toBe(false);
  });

  it('requires explicit content and limits context count', () => {
    expect(browserPageContextsInputSchema.safeParse([context({ text: undefined })]).success).toBe(false);
    expect(browserPageContextsInputSchema.safeParse([context(), context(), context()]).success).toBe(false);
  });
});

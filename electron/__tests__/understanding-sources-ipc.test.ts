import { describe, expect, it } from 'vitest';

import { fingerprintUnderstandingItems, normalizeUnderstandingSourceIds } from '../ipc/understanding-sources-ipc.js';

describe('understanding source selection', () => {
  it('requires an explicit source list', () => {
    expect(normalizeUnderstandingSourceIds(undefined, 'darwin')).toEqual([]);
    expect(normalizeUnderstandingSourceIds('apple-calendar', 'darwin')).toEqual([]);
  });

  it('filters source ids by the current platform', () => {
    expect(normalizeUnderstandingSourceIds([
      'apple-calendar', 'unknown', 'apple-calendar', 'apple-notes', 'windows-recent-documents',
      'local-recent-files', 'chromium-bookmarks',
    ], 'darwin')).toEqual(['apple-calendar', 'apple-notes', 'local-recent-files', 'chromium-bookmarks']);
    expect(normalizeUnderstandingSourceIds([
      'apple-calendar', 'windows-recent-documents', 'windows-recent-documents',
    ], 'win32')).toEqual(['windows-recent-documents']);
  });

  it('creates an order-independent fingerprint that changes with metadata', () => {
    const base = {
      sourceId: 'local-recent-files', type: 'document' as const, title: 'Launch plan.pdf',
      ownerAttribution: 'user' as const, sensitivity: 'personal' as const,
    };
    const first = { ...base, id: '1', modifiedAt: 10, evidenceRef: 'local-recent-files://1' };
    const second = { ...base, id: '2', modifiedAt: 20, evidenceRef: 'local-recent-files://2' };
    expect(fingerprintUnderstandingItems([first, second])).toBe(fingerprintUnderstandingItems([second, first]));
    expect(fingerprintUnderstandingItems([{ ...first, modifiedAt: 11 }, second]))
      .not.toBe(fingerprintUnderstandingItems([first, second]));
  });
});

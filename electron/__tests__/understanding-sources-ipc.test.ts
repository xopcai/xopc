import { describe, expect, it } from 'vitest';

import { normalizeUnderstandingSourceIds } from '../ipc/understanding-sources-ipc.js';

describe('understanding source selection', () => {
  it('requires an explicit source list', () => {
    expect(normalizeUnderstandingSourceIds(undefined, 'darwin')).toEqual([]);
    expect(normalizeUnderstandingSourceIds('apple-calendar', 'darwin')).toEqual([]);
  });

  it('filters source ids by the current platform', () => {
    expect(normalizeUnderstandingSourceIds([
      'apple-calendar', 'unknown', 'apple-calendar', 'apple-notes', 'windows-recent-documents',
    ], 'darwin')).toEqual(['apple-calendar', 'apple-notes']);
    expect(normalizeUnderstandingSourceIds([
      'apple-calendar', 'windows-recent-documents', 'windows-recent-documents',
    ], 'win32')).toEqual(['windows-recent-documents']);
  });
});


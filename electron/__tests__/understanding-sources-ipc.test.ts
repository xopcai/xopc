import { describe, expect, it } from 'vitest';

import {
  fingerprintUnderstandingItems,
  normalizeUnderstandingCollectOptions,
  normalizeUnderstandingSourceIds,
} from '../ipc/understanding-sources-ipc.js';

describe('understanding source selection', () => {
  it('requires an explicit source list', () => {
    expect(normalizeUnderstandingSourceIds(undefined, 'darwin')).toEqual([]);
    expect(normalizeUnderstandingSourceIds('apple-calendar', 'darwin')).toEqual([]);
  });

  it('filters source ids by the current platform and excludes removed legacy ids', () => {
    expect(normalizeUnderstandingSourceIds([
      'apple-calendar', 'unknown', 'apple-calendar', 'apple-notes', 'apple-mail', 'windows-recent-documents',
      'local-ai-instructions', 'local-obsidian', 'local-markdown-notes', 'local-recent-files', 'chromium-bookmarks',
    ], 'darwin')).toEqual([
      'apple-calendar', 'apple-notes', 'apple-mail',
      'local-ai-instructions', 'local-obsidian', 'local-markdown-notes', 'local-recent-files', 'chromium-bookmarks',
    ]);
    expect(normalizeUnderstandingSourceIds([
      'apple-calendar', 'windows-recent-documents', 'local-obsidian', 'local-ai-instructions',
    ], 'win32')).toEqual(['local-obsidian', 'local-ai-instructions']);
  });

  it('creates an order-independent fingerprint that changes with metadata', () => {
    const base = {
      sourceId: 'local-recent-files', type: 'document' as const, title: 'Launch plan.md',
      ownerAttribution: 'user' as const, sensitivity: 'personal' as const,
    };
    const first = { ...base, id: '1', modifiedAt: 10, evidenceRef: 'local-recent-files://1' };
    const second = { ...base, id: '2', modifiedAt: 20, evidenceRef: 'local-recent-files://2' };
    expect(fingerprintUnderstandingItems([first, second])).toBe(fingerprintUnderstandingItems([second, first]));
    expect(fingerprintUnderstandingItems([{ ...first, modifiedAt: 11 }, second]))
      .not.toBe(fingerprintUnderstandingItems([first, second]));
  });

  it('normalizes safe hex exclude ids and custom note directories', () => {
    expect(normalizeUnderstandingCollectOptions(undefined)).toEqual({
      excludeIds: [],
      customNoteDirectories: [],
    });
    expect(normalizeUnderstandingCollectOptions({
      excludeIds: ['ABCDEF1234567890', 'abcdef1234567890', 'not-hex', 'short'],
      customNoteDirectories: ['/Users/demo/Notes', '/Users/demo/Notes', '   '],
    })).toEqual({
      excludeIds: ['abcdef1234567890'],
      customNoteDirectories: ['/Users/demo/Notes'],
    });
  });
});

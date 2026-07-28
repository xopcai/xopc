import { describe, expect, it } from 'vitest';

import {
  normalizeEditorLinkUrl,
  resolveEditorLink,
  sanitizeEditorLinkText,
} from '../editor/editor-link';

describe('note editor links', () => {
  it('normalizes bare and www URLs for both editor runtimes', () => {
    expect(normalizeEditorLinkUrl('example.com/path')).toBe('https://example.com/path');
    expect(normalizeEditorLinkUrl(' www.example.com ')).toBe('https://www.example.com');
    expect(normalizeEditorLinkUrl('http://example.com')).toBe('http://example.com');
  });

  it('uses explicit, selected, and URL fallback labels in order', () => {
    expect(resolveEditorLink('Docs', 'example.com', 'selection')).toEqual({
      title: 'Docs',
      url: 'https://example.com',
    });
    expect(resolveEditorLink('', 'example.com', 'selection')).toEqual({
      title: 'selection',
      url: 'https://example.com',
    });
    expect(resolveEditorLink('', 'example.com')).toEqual({
      title: 'https://example.com',
      url: 'https://example.com',
    });
  });

  it('rejects malformed URLs and sanitizes link labels', () => {
    expect(resolveEditorLink('Docs', 'not-a-host')).toBeNull();
    expect(resolveEditorLink('Mail', 'mailto:user@example.com')).toBeNull();
    expect(resolveEditorLink('Unsafe', 'javascript:alert(1)')).toBeNull();
    expect(sanitizeEditorLinkText('A < B & C > D')).toBe('A  B  C  D');
  });
});

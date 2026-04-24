import { describe, expect, it } from 'vitest';

import { extractFilePathsFromToolResult, looksLikeAbsoluteFilePath } from '@/features/chat/tool-result-file-paths';
import { extractWebSearchLinksFromToolResult } from '@/features/chat/web-search-tool-result-links';

describe('looksLikeAbsoluteFilePath', () => {
  it('rejects URL path segments that are not host filesystem roots', () => {
    expect(looksLikeAbsoluteFilePath('/86683.html')).toBe(false);
    expect(looksLikeAbsoluteFilePath('/2270.html')).toBe(false);
    expect(looksLikeAbsoluteFilePath('/cache/page.html')).toBe(false);
  });

  it('accepts common Unix absolute roots', () => {
    expect(looksLikeAbsoluteFilePath('/Users/alice/project/index.html')).toBe(true);
    expect(looksLikeAbsoluteFilePath('/var/log/app.html')).toBe(true);
    expect(looksLikeAbsoluteFilePath('/tmp/x.html')).toBe(true);
  });

  it('rejects fake Windows paths from https URLs', () => {
    expect(looksLikeAbsoluteFilePath('s://news.example.com/86683.html')).toBe(false);
  });
});

describe('extractFilePathsFromToolResult', () => {
  it('does not treat https URL path suffixes as workspace files', () => {
    const text = JSON.stringify(
      {
        content: [{ type: 'text', text: '1. Example\n   https://news.example.com/86683.html\n   snippet' }],
        details: {
          results: [{ title: 'Ex', url: 'https://news.example.com/86683.html', description: '' }],
        },
      },
      null,
      2,
    );
    expect(extractFilePathsFromToolResult(text)).toEqual([]);
  });
});

describe('extractWebSearchLinksFromToolResult', () => {
  it('reads https URLs from details.results', () => {
    const text = JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      details: {
        results: [
          { title: 'A', url: 'https://a.example/page', description: '' },
          { title: 'B', url: 'https://b.example/other', description: '' },
        ],
      },
    });
    expect(extractWebSearchLinksFromToolResult(text)).toEqual([
      { url: 'https://a.example/page', title: 'A' },
      { url: 'https://b.example/other', title: 'B' },
    ]);
  });

  it('skips non-http(s) urls', () => {
    const text = JSON.stringify({
      details: { results: [{ title: 'x', url: '/86683.html' }] },
    });
    expect(extractWebSearchLinksFromToolResult(text)).toEqual([]);
  });
});

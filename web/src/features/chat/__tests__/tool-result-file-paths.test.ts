import { describe, expect, it } from 'vitest';

import {
  extractFilePathsFromToolResult,
  extractWorkspaceRelativeMentionsFromAssistantMarkdown,
  looksLikeAbsoluteFilePath,
} from '@/features/chat/tool-result-file-paths';
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

  it('strips list_dir f/d/? line prefix so paths are not `f <name>` in the API', () => {
    const text = JSON.stringify({
      content: [{ type: 'text', text: 'f test.txt' }],
      details: {},
    });
    expect(extractFilePathsFromToolResult(text)).toEqual([
      expect.objectContaining({
        fileName: 'test.txt',
        workspaceRelativePath: 'test.txt',
        absolutePath: 'rel:test.txt',
      }),
    ]);
  });

  it('does not treat Python/code snippets as Windows paths (avoids false resolve-path 403)', () => {
    const snippet = String.raw`s:\n        result = analyze_stock(code, with_minute=args.minute, realtime_cache=realtime_cache)\n        results.append(result)\n    \n    if args.json`;
    expect(extractFilePathsFromToolResult(snippet)).toEqual([]);
  });

  it('extracts workspace-relative names from assistant markdown (bold, code, links)', () => {
    const md = [
      '两个文件已就绪：',
      '- **`guide.html`** ← 清单',
      '- **`travel-plan-shanghai-hangzhou.html`** ← 标题',
      'Also `docs/readme.md` and [open](subdir/page.html).',
    ].join('\n');
    const paths = extractWorkspaceRelativeMentionsFromAssistantMarkdown(md);
    expect(paths.map((p) => p.workspaceRelativePath).sort()).toEqual(
      ['docs/readme.md', 'guide.html', 'subdir/page.html', 'travel-plan-shanghai-hangzhou.html'].sort(),
    );
  });

  it('strips "File written:" so the line is not used as a workspace relative path (404)', () => {
    const abs = '/Users/micjoyce/.xopc/workspace/abbbbb/markdown-test.md';
    const text = JSON.stringify({
      content: [{ type: 'text', text: `File written: ${abs}` }],
      details: {},
    });
    const paths = extractFilePathsFromToolResult(text);
    expect(paths).toEqual([
      expect.objectContaining({
        fileName: 'markdown-test.md',
        absolutePath: abs,
        mimeType: 'text/markdown',
      }),
    ]);
    expect(paths[0]).not.toHaveProperty('workspaceRelativePath');
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

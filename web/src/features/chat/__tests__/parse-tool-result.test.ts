import { describe, expect, it } from 'vitest';

import { parseToolResult } from '@/features/chat/tool-results/parse-tool-result';

describe('parseToolResult', () => {
  it('returns empty for null/undefined', () => {
    expect(parseToolResult(null)).toEqual({ details: null, text: '', isStructured: false });
    expect(parseToolResult(undefined)).toEqual({ details: null, text: '', isStructured: false });
  });

  it('parses serialized SSE envelope JSON with content and details', () => {
    const raw = JSON.stringify({
      content: [{ type: 'text', text: 'File edited: /tmp/foo.ts' }],
      details: { diff: '--- a\n+++ b\n@@\n+x\n', fuzzyMatchUsed: false },
    });
    const r = parseToolResult(raw);
    expect(r.isStructured).toBe(true);
    expect(r.text).toBe('File edited: /tmp/foo.ts');
    expect(r.details).toEqual({ diff: '--- a\n+++ b\n@@\n+x\n', fuzzyMatchUsed: false });
  });

  it('handles already-parsed object envelopes', () => {
    const r = parseToolResult({
      content: [
        { type: 'text', text: 'line 1' },
        { type: 'text', text: 'line 2' },
      ],
      details: { exitCode: 0 },
    });
    expect(r.isStructured).toBe(true);
    expect(r.text).toBe('line 1\nline 2');
    expect(r.details).toEqual({ exitCode: 0 });
  });

  it('treats a plain string as text only (history-rehydration path)', () => {
    const r = parseToolResult('plain stdout text');
    expect(r.isStructured).toBe(false);
    expect(r.text).toBe('plain stdout text');
    expect(r.details).toBeNull();
  });

  it('treats a JSON-looking string that is not an envelope as plain text', () => {
    const json = '{"unrelated":42}';
    const r = parseToolResult(json);
    // Not an envelope → keep as text
    expect(r.isStructured).toBe(false);
    expect(r.text).toBe(json);
    expect(r.details).toBeNull();
  });

  it('survives malformed JSON without throwing', () => {
    const r = parseToolResult('{ this is { broken');
    expect(r.isStructured).toBe(false);
    expect(r.text).toBe('{ this is { broken');
    expect(r.details).toBeNull();
  });

  it('ignores non-text content blocks when joining text', () => {
    const r = parseToolResult({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', source: { data: 'AAA' } },
        { type: 'text', text: 'world' },
      ],
      details: {},
    });
    expect(r.text).toBe('hello\nworld');
  });
});

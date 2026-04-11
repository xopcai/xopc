import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { complete } from '@mariozechner/pi-ai';

import {
  createWebExtractTool,
  stripHtmlBoilerplate,
  MAX_RAW_HTML_CHARS_FOR_WEB_EXTRACT,
  DEFAULT_WEB_EXTRACT_MAX_LENGTH,
} from '../web-extract.js';

vi.mock('@mariozechner/pi-ai', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mariozechner/pi-ai')>();
  return { ...mod, complete: vi.fn() };
});

function htmlBody(inner: string) {
  return `<html><head></head><body>${inner}</body></html>`;
}

describe('stripHtmlBoilerplate', () => {
  it('removes script, style, svg, noscript, and HTML comments', () => {
    const raw = htmlBody(
      '<script>evil()</script><style>.x{}</style><!--c--><noscript>n</noscript>' +
        '<svg><path /></svg><p>Hello</p>',
    );
    const out = stripHtmlBoilerplate(raw);
    expect(out).toContain('Hello');
    expect(out).not.toContain('evil');
    expect(out).not.toContain('.x{}');
    expect(out).not.toContain('noscript');
  });

  it('truncates at max raw length with marker', () => {
    const huge = 'y'.repeat(MAX_RAW_HTML_CHARS_FOR_WEB_EXTRACT + 50);
    const out = stripHtmlBoilerplate(huge);
    expect(out.endsWith('\n\n[...truncated]')).toBe(true);
    expect(out.length).toBe(MAX_RAW_HTML_CHARS_FOR_WEB_EXTRACT + '\n\n[...truncated]'.length);
  });
});

describe('createWebExtractTool', () => {
  beforeEach(() => {
    vi.mocked(complete).mockResolvedValue({
      content: [{ type: 'text', text: '## Extracted\n\nBody.' }],
    } as Awaited<ReturnType<typeof complete>>);
  });

  afterEach(() => {
    vi.mocked(complete).mockReset();
    vi.unstubAllGlobals();
  });

  it('returns friendly message when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    const tool = createWebExtractTool({ getConfig: () => undefined });
    const r = await tool.execute('1', { url: 'https://example.com/doc' });
    expect((r.content[0] as { text: string }).text).toContain('Failed to extract');
    expect((r.content[0] as { text: string }).text).toContain('network down');
    expect(r.details?.extractedLength).toBe(0);
  });

  it('returns early when cleaned body is too short', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('<html><body>short</body></html>'),
      }),
    );
    const tool = createWebExtractTool({ getConfig: () => undefined });
    const r = await tool.execute('2', { url: 'https://example.com/tiny' });
    expect((r.content[0] as { text: string }).text).toContain('no extractable content');
    expect(vi.mocked(complete)).not.toHaveBeenCalled();
  });

  it('passes instruction into the LLM user message', async () => {
    const longText = '<p>' + 'word '.repeat(80) + '</p>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve(htmlBody(longText)),
      }),
    );
    const tool = createWebExtractTool({ getConfig: () => undefined });
    await tool.execute('3', {
      url: 'https://example.com/p',
      instruction: 'pricing table only',
    });

    expect(complete).toHaveBeenCalledTimes(1);
    const call = vi.mocked(complete).mock.calls[0];
    const messages = (call[1] as { messages: Array<{ content: string }> }).messages;
    expect(messages[0]?.content).toContain('FOCUS: pricing table only');
  });

  it('uses config default maxLength when param omitted', async () => {
    const longText = '<p>' + 'word '.repeat(80) + '</p>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve(htmlBody(longText)),
      }),
    );
    const tool = createWebExtractTool({
      getConfig: () =>
        ({
          agents: {
            defaults: {
              webExtract: { maxLength: 99 },
            },
          },
        }) as import('../../../config/schema.js').Config,
    });
    await tool.execute('4', { url: 'https://example.com/q' });
    expect(complete).toHaveBeenCalled();
    const call = vi.mocked(complete).mock.calls[0];
    expect(call[2]).toMatchObject({ maxTokens: expect.any(Number) });
    const messages = (call[1] as { messages: Array<{ content: string }> }).messages;
    expect(messages[0]?.content).toContain('Keep output under 99 characters');
  });

  it('truncates LLM output to maxLength', async () => {
    const longText = '<p>' + 'word '.repeat(80) + '</p>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve(htmlBody(longText)),
      }),
    );
    const blob = 'Z'.repeat(500);
    vi.mocked(complete).mockResolvedValue({
      content: [{ type: 'text', text: blob }],
    } as Awaited<ReturnType<typeof complete>>);

    const tool = createWebExtractTool({ getConfig: () => undefined });
    const r = await tool.execute('5', {
      url: 'https://example.com/long-out',
      maxLength: 120,
    });
    const text = (r.content[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(120 + '\n\n[...output truncated to maxLength]'.length);
    expect(text).toContain('[...output truncated to maxLength]');
  });

  it('parses JSON responses as formatted text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        text: () => Promise.resolve('unused'),
        json: () => Promise.resolve({ a: 1 }),
      }),
    );
    const tool = createWebExtractTool({ getConfig: () => undefined });
    await tool.execute('6', { url: 'https://example.com/api' });
    expect(complete).toHaveBeenCalled();
    const call = vi.mocked(complete).mock.calls[0];
    const messages = (call[1] as { messages: Array<{ content: string }> }).messages;
    expect(messages[0]?.content).toContain('"a": 1');
  });
});

describe('DEFAULT_WEB_EXTRACT_MAX_LENGTH', () => {
  it('matches design default', () => {
    expect(DEFAULT_WEB_EXTRACT_MAX_LENGTH).toBe(15_000);
  });
});

import { describe, expect, it } from 'vitest';

import { readJsonResponseLimited } from '../provider-http.js';

describe('readJsonResponseLimited', () => {
  it('parses JSON within the byte limit', async () => {
    const response = new Response(JSON.stringify({ ok: true, value: 'small' }));
    await expect(readJsonResponseLimited(response, 1024)).resolves.toEqual({
      ok: true,
      value: 'small',
    });
  });

  it('rejects a declared response larger than the limit before reading it', async () => {
    const response = new Response('{"ok":true}', {
      headers: { 'content-length': '4096' },
    });
    await expect(readJsonResponseLimited(response, 32)).rejects.toThrow(/exceeds 32 bytes/);
  });

  it('rejects a streamed response that crosses the limit', async () => {
    const response = new Response(JSON.stringify({ value: 'x'.repeat(100) }));
    await expect(readJsonResponseLimited(response, 32)).rejects.toThrow(/exceeds 32 bytes/);
  });

  it('returns a clear error for invalid JSON', async () => {
    await expect(readJsonResponseLimited(new Response('not-json'), 1024)).rejects.toThrow(
      'Provider returned invalid JSON',
    );
  });
});

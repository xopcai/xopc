import { describe, expect, it } from 'vitest';

import { ProviderHttpError, assertOk } from '../provider-http-errors.js';

function jsonResponse(body: unknown, status: number, statusText = 'Bad Request'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

describe('assertOk', () => {
  it('returns the response untouched when ok', async () => {
    const res = new Response('ok', { status: 200, statusText: 'OK' });
    await expect(assertOk(res)).resolves.toBe(res);
  });

  it('extracts OpenAI-style error.code + error.message', async () => {
    const res = jsonResponse({ error: { message: 'invalid api key', code: 'invalid_api_key' } }, 401, 'Unauthorized');
    await expect(assertOk(res, 'https://api.openai.com/v1/images/generations')).rejects.toMatchObject({
      name: 'ProviderHttpError',
      status: 401,
      code: 'invalid_api_key',
      url: 'https://api.openai.com/v1/images/generations',
    });
  });

  it('extracts DashScope-style { code, message }', async () => {
    const res = jsonResponse({ code: 'InvalidParameter', message: 'size invalid' }, 400);
    try {
      await assertOk(res);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderHttpError);
      const err = e as ProviderHttpError;
      expect(err.status).toBe(400);
      expect(err.code).toBe('InvalidParameter');
      expect(err.message).toContain('size invalid');
    }
  });

  it('extracts MiniMax base_resp.status_msg', async () => {
    const res = jsonResponse({ base_resp: { status_code: 1004, status_msg: 'authentication failed' } }, 401);
    try {
      await assertOk(res);
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as ProviderHttpError;
      expect(err.code).toBe('1004');
      expect(err.message).toContain('authentication failed');
    }
  });

  it('falls back to body preview when no JSON shape matches', async () => {
    const res = new Response('totally broken upstream', {
      status: 502,
      statusText: 'Bad Gateway',
    });
    try {
      await assertOk(res);
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as ProviderHttpError;
      expect(err.status).toBe(502);
      expect(err.bodyPreview).toContain('totally broken upstream');
    }
  });

  it('handles empty body gracefully', async () => {
    const res = new Response('', { status: 500, statusText: 'Internal' });
    try {
      await assertOk(res);
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as ProviderHttpError;
      expect(err.status).toBe(500);
      expect(err.message).toContain('(empty body)');
    }
  });
});

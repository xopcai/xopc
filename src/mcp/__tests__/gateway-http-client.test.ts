import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('undici', () => ({ fetch: fetchMock }));
import { GatewayHttpClient, GatewayHttpError } from '../gateway-http-client.js';
import { createGatewayCredential } from '../../gateway/credential.js';

afterEach(() => vi.resetAllMocks());
describe('GatewayHttpClient safety', () => {
  it('preserves bounded capability codes without leaking the response body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'OUTCOME_UNKNOWN', operationId: 'op-1', error: 'private detail' }), { status: 409 }));
    const client = new GatewayHttpClient({ baseUrl: 'http://localhost:1234' });
    const error = await client.postJson('/api/test', {}).catch(error => error);
    expect(error).toBeInstanceOf(GatewayHttpError);
    expect(error).toMatchObject({ status: 409, code: 'OUTCOME_UNKNOWN', operationId: 'op-1' });
    expect(error.message).not.toContain('private detail');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects redirects and bounds requests that carry credentials', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ payload: { value: 1 } })));
    const client = new GatewayHttpClient({ baseUrl: 'http://localhost:1234', credential: createGatewayCredential('token', 'fixture-token') });
    expect(await client.getJson('/api/test')).toEqual({ value: 1 });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:1234/api/test', expect.objectContaining({ redirect: 'error',
      signal: expect.any(AbortSignal), headers: expect.objectContaining({ Authorization: 'Bearer fixture-token' }) }));
  });
  it('ignores invalid error fields and non-JSON failures', async () => {
    const client = new GatewayHttpClient({ baseUrl: 'http://localhost:1234' });
    for (const body of ['not JSON', JSON.stringify({ code: 'arbitrary secret', operationId: 'x'.repeat(201) })]) {
      fetchMock.mockResolvedValue(new Response(body, { status: 502 }));
      const error = await client.getJson('/api/test').catch(error => error);
      expect(error).toMatchObject({ status: 502, code: undefined, operationId: undefined });
    }
  });
});

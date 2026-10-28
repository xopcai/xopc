import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { probeMcpConnection } from '../connection-setup.js';
import { classifyMcpConnectionError } from '../connection-errors.js';

const native = vi.hoisted(() => ({ discover: vi.fn(), prepare: vi.fn() }));
vi.mock('../tool-catalog.js', () => ({ discoverMcpTools: native.discover,
  McpAuthenticationRequiredError: class extends Error {}, signInNativeMcp: vi.fn() }));
vi.mock('../native-mcp.js', () => ({ prepareNativeMcpConfig: native.prepare }));
const config = ConfigSchema.parse({ mcp: { servers: { docs: { url: 'https://fixture.example/' } } } });
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', fetcher);
  native.prepare.mockResolvedValue({ servers: [{ name: 'docs', config: { url: 'https://fixture.example/' } }] });
  fetcher.mockImplementation(async () => new Response('', { status: 404 }));
});
afterEach(() => vi.unstubAllGlobals());

it.each(['unreachable', 'invalid'] as const)('keeps %s authentication metadata uncertain instead of requiring a Token', async kind => {
  native.discover.mockRejectedValueOnce(new Error('HTTP 401 Unauthorized'));
  fetcher.mockImplementation(async () => { if (kind === 'unreachable') throw new TypeError('fetch failed'); return new Response('<html>Login</html>'); });
  expect(await probeMcpConnection(config, '/fixture', 'docs')).toMatchObject({ state: 'auth_unknown', auth: { method: 'unknown', metadata: kind }, recovery: { kind: 'choose_auth' } });
});

it('discovers verified OAuth metadata from a 403 challenge', async () => {
  native.discover.mockImplementationOnce(async (_config, _workspace, _server, options) => { options.diagnostics.observe({ method: 'POST', stage: 'initialize', status: 403, contentType: 'application/json', challenge: 'Bearer resource_metadata="https://fixture.example/metadata"' }); throw new Error('HTTP 403'); });
  fetcher.mockResolvedValueOnce(Response.json({ resource: 'https://fixture.example/', authorization_servers: ['https://login.example/'] }));
  expect(await probeMcpConnection(config, '/fixture', 'docs')).toMatchObject({ state: 'oauth_required', auth: { method: 'oauth', metadata: 'valid' }, observation: { status: 403 } });
});

it('recognizes advertised OAuth after a native transport reports a generic HTTP 401', async () => {
  native.discover.mockImplementationOnce(async (_config, _workspace, _server, options) => { options.diagnostics.observe({ method: 'POST', stage: 'initialize', status: 401, contentType: 'application/json', challenge: 'Bearer resource_metadata="https://fixture.example/.well-known/oauth-protected-resource"' }); throw new Error('HTTP 401'); });
  fetcher.mockResolvedValueOnce(Response.json({ resource: 'https://fixture.example/', authorization_servers: ['https://login.example/'] }));
  expect(await probeMcpConnection(config, '/fixture', 'docs')).toMatchObject({ state: 'oauth_required', auth: { metadata: 'valid', method: 'oauth' } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('requires positive metadata evidence before interpreting HTTP 401 as OAuth', async () => {
  native.discover.mockRejectedValueOnce(new Error('HTTP 401 Unauthorized'));
  fetcher.mockImplementation(async () => new Response('', { status: 404 }));
  expect(await probeMcpConnection(config, '/fixture', 'docs')).toMatchObject({ state: 'auth_unknown', auth: { method: 'unknown', metadata: 'absent' } });
});

it('does not start OAuth discovery when a configured bearer credential is rejected', async () => {
  native.discover.mockRejectedValueOnce(new Error('HTTP 401 Unauthorized'));
  const secured = structuredClone(config); secured.mcp!.servers!.docs.headers = { Authorization: 'Bearer fixture-secret' };
  expect(await probeMcpConnection(secured, '/fixture', 'docs')).toMatchObject({ state: 'token_required', auth: { credential: 'rejected' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('preserves an unauthenticated HTTP 403 as an access refusal without inventing OAuth', async () => {
  native.discover.mockRejectedValueOnce(new Error('HTTP 403'));
  expect(await probeMcpConnection(config, '/fixture', 'docs')).toMatchObject({ state: 'auth_unknown', auth: { method: 'unknown', metadata: 'absent' } });
  expect(fetcher).toHaveBeenCalled();
});

it('does not claim a configured credential is invalid solely because of a nested HTTP 403', async () => {
  native.discover.mockRejectedValueOnce(new Error('Native transport failed', { cause: new Error('HTTP 403') }));
  const secured = structuredClone(config); secured.mcp!.servers!.docs.headers = { Authorization: 'Bearer private-test-value' };
  expect(await probeMcpConnection(secured, '/fixture', 'docs')).toMatchObject({ state: 'error', errorCode: 'access_denied', auth: { credential: 'unknown' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('uses structured native transport evidence without repeating a credential-bearing HTTP request', async () => {
  native.discover.mockImplementationOnce(async (_config, _workspace, _server, options) => { options.diagnostics.observe({ method: 'POST', stage: 'initialize', status: 401, contentType: 'application/json' }); throw new Error('Native MCP connection needs attention'); });
  const secured = structuredClone(config); secured.mcp!.servers!.docs.headers = { Authorization: 'Bearer private-test-value' };
  native.prepare.mockResolvedValueOnce({ servers: [{ name: 'docs', config: { url: 'https://fixture.example/', headers: { Authorization: 'Bearer private-test-value' } } }] });
  const result = await probeMcpConnection(secured, '/fixture', 'docs');
  expect(result).toMatchObject({ state: 'token_required', observation: { status: 401 }, auth: { credential: 'rejected' } });
  expect(JSON.stringify(result)).not.toContain('private-test-value');
  expect(fetcher).not.toHaveBeenCalled();
});

it('preserves a safe cause category when the native connection only reports fetch failed', async () => {
  native.discover.mockRejectedValueOnce(new TypeError('fetch failed', { cause: Object.assign(new Error('certificate issue'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) }));
  expect(await probeMcpConnection(config, '/fixture', 'docs')).toMatchObject({ state: 'error', errorCode: 'tls' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('stops OAuth metadata discovery after the draft has been cancelled', async () => {
  native.discover.mockRejectedValueOnce(new Error('HTTP 401 Unauthorized'));
  const controller = new AbortController();
  fetcher.mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason; });
  await expect(probeMcpConnection(config, '/fixture', 'docs', { signal: controller.signal })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  ['ENOENT', 'command_missing'], ['ECONNREFUSED', 'connection_refused'], ['getaddrinfo ENOTFOUND', 'host_not_found'],
  ['ETIMEDOUT', 'timeout'], ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'], ['HTTP 429', 'rate_limited'],
  ['HTTP 403', 'access_denied'], ['HTTP 404', 'not_found'], ['fetch failed', 'network'],
  ['Unexpected token <', 'invalid_response'], ['invalid configuration', 'configuration'], ['unrecognized', 'unknown'],
])('classifies %s without echoing transport error details', (message, expected) => {
  expect(classifyMcpConnectionError(new Error(message))).toBe(expected);
});

it('bounds cyclic error causes', () => {
  const error = new Error('unknown'); Object.assign(error, { cause: error });
  expect(classifyMcpConnectionError(error)).toBe('unknown');
});

it('honors metadata Retry-After and stops discovery instead of probing another endpoint early', async () => {
  native.discover.mockRejectedValueOnce(new Error('HTTP 401 Unauthorized'));
  fetcher.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
  const now = Date.now();
  const result = await probeMcpConnection(config, '/fixture', 'docs');
  expect(result).toMatchObject({ state: 'auth_unknown', auth: { metadata: 'unreachable' }, recovery: { kind: 'wait' } });
  expect(result.recovery!.retryAt).toBeGreaterThanOrEqual(now + 120000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

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
});
afterEach(() => vi.unstubAllGlobals());

it('recognizes advertised OAuth after a native transport reports a generic HTTP 401', async () => {
  native.discover.mockRejectedValueOnce(new Error('Error POSTing to endpoint: HTTP 401 invalid_token'));
  fetcher.mockResolvedValueOnce(new Response('', { status: 401, headers: {
    'WWW-Authenticate': 'Bearer resource_metadata="https://fixture.example/.well-known/oauth-protected-resource"',
  } })).mockResolvedValueOnce(Response.json({ resource: 'https://fixture.example/', authorization_servers: ['https://login.example/'] }));
  expect(await probeMcpConnection(config, '/fixture', 'docs')).toEqual({ state: 'oauth_required' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('requires positive metadata evidence before interpreting HTTP 401 as OAuth', async () => {
  native.discover.mockRejectedValueOnce(new Error('HTTP 401 Unauthorized'));
  fetcher.mockImplementation(async () => new Response('', { status: 404 }));
  expect(await probeMcpConnection(config, '/fixture', 'docs')).toEqual({ state: 'token_required' });
});

it('does not start OAuth discovery when a configured bearer credential is rejected', async () => {
  native.discover.mockRejectedValueOnce(new Error('HTTP 401 Unauthorized'));
  const secured = structuredClone(config); secured.mcp!.servers!.docs.headers = { Authorization: 'Bearer fixture-secret' };
  expect(await probeMcpConnection(secured, '/fixture', 'docs')).toEqual({ state: 'token_required' });
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
  await probeMcpConnection(config, '/fixture', 'docs', { signal: controller.signal });
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

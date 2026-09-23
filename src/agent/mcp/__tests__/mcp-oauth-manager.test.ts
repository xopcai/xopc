import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { XopcMcpOAuthClientProvider } from '../oauth/mcp-oauth-provider.js';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), resolve: vi.fn(), finish: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class { connect = mocks.connect; close = vi.fn(async () => {}); } }));
vi.mock('../mcp-transport.js', () => ({ resolveMcpTransport: mocks.resolve }));
vi.mock('../bundle-mcp-runtime.js', () => ({ disposeAllSessionMcpRuntimes: vi.fn(async () => {}) }));
import { McpOAuthManager } from '../oauth/mcp-oauth-manager.js';
import { McpOAuthStore } from '../oauth/mcp-oauth-store.js';

let state: string | undefined;
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); if (state) rmSync(state, { recursive: true, force: true }); });
it('waits for an in-flight exchange and removes tokens from a cancelled authorization', async () => {
  state = mkdtempSync(join(tmpdir(), 'xopc-oauth-cancel-')); vi.stubEnv('XOPC_STATE_DIR', state);
  const url = 'https://example.com/mcp'; const raw = { type: 'streamable-http', url, auth: { type: 'oauth' } };
  const store = new McpOAuthStore('owner:plugin/cancel/main'); const manager = new McpOAuthManager(store);
  let provider!: XopcMcpOAuthClientProvider;
  let release!: () => void;
  let started!: () => void;
  const exchanging = new Promise<void>(done => { started = done; });
  mocks.finish.mockImplementation(async () => {
    started(); await new Promise<void>(done => { release = done; });
    await provider.saveTokens({ access_token: 'late-token', token_type: 'Bearer' });
  });
  mocks.resolve.mockImplementation(async (_id, _raw, _cfg, options) => {
    provider = options.oauthProvider;
    return { transport: { finishAuth: mocks.finish, close: async () => {} }, transportType: 'streamable-http', connectionTimeoutMs: 1000 };
  });
  mocks.connect.mockImplementation(async () => {
    await provider.redirectToAuthorization(new URL('https://accounts.example/authorize'));
    throw new UnauthorizedError();
  });
  try {
    expect((await manager.start({ serverId: 'main', rawServer: raw })).status).toBe('authorizing');
    const callback = new URL(provider.redirectUrl); callback.searchParams.set('state', provider.state()!); callback.searchParams.set('code', 'fixture');
    await manager.submitCallback('main', raw, callback.toString()); await exchanging;
    const cancelled = manager.cancelPending(); release(); await cancelled;
    expect(await store.load(url)).toBeUndefined();
    expect((await manager.status('main', raw)).status).toBe('disconnected');
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    await expect(manager.submitCallback('main', raw, callback.toString())).rejects.toThrow('not found');
  } finally { release?.(); await manager.cancelPending(); }
});

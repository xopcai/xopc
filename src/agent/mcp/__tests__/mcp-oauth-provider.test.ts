import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { XopcMcpOAuthClientProvider } from '../oauth/mcp-oauth-provider.js';
import { McpOAuthStore } from '../oauth/mcp-oauth-store.js';

describe('XopcMcpOAuthClientProvider', () => {
  let tempDir: string;
  let previousCredentialsDir: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-mcp-provider-'));
    previousCredentialsDir = process.env.XOPC_CREDENTIALS_DIR;
    process.env.XOPC_CREDENTIALS_DIR = join(tempDir, 'credentials');
  });

  afterEach(async () => {
    if (previousCredentialsDir === undefined) delete process.env.XOPC_CREDENTIALS_DIR;
    else process.env.XOPC_CREDENTIALS_DIR = previousCredentialsDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists SDK credentials and honors a configured public client id', async () => {
    const serverUrl = new URL('https://mcp.example.com/api');
    const store = new McpOAuthStore();
    const provider = new XopcMcpOAuthClientProvider({ serverUrl, store });

    await provider.saveClientInformation({ client_id: 'dynamic-client' });
    await provider.saveTokens({ access_token: 'token', token_type: 'Bearer' });

    const restored = new XopcMcpOAuthClientProvider({ serverUrl, store });
    await expect(restored.clientInformation()).resolves.toMatchObject({ client_id: 'dynamic-client' });
    await expect(restored.tokens()).resolves.toMatchObject({ access_token: 'token' });

    const configured = new XopcMcpOAuthClientProvider({
      serverUrl,
      clientId: 'configured-client',
      store,
    });
    await expect(configured.clientInformation()).resolves.toEqual({ client_id: 'configured-client' });
  });

  it('invalidates credentials when the discovered authorization server changes', async () => {
    const serverUrl = new URL('https://mcp.example.com/api');
    const provider = new XopcMcpOAuthClientProvider({ serverUrl });

    await provider.saveClientInformation({ client_id: 'dynamic-client' });
    await provider.saveTokens({ access_token: 'token', token_type: 'Bearer' });
    await provider.saveDiscoveryState({ authorizationServerUrl: 'https://login-one.example.com' });
    await provider.saveDiscoveryState({ authorizationServerUrl: 'https://login-two.example.com' });

    await expect(provider.clientInformation()).resolves.toBeUndefined();
    await expect(provider.tokens()).resolves.toBeUndefined();
  });
});

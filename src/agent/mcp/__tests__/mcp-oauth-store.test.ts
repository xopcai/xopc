import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { McpOAuthStore, canonicalMcpServerUrl } from '../oauth/mcp-oauth-store.js';

describe('McpOAuthStore', () => {
  let tempDir: string;
  let previousCredentialsDir: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-mcp-oauth-'));
    previousCredentialsDir = process.env.XOPC_CREDENTIALS_DIR;
    process.env.XOPC_CREDENTIALS_DIR = join(tempDir, 'credentials');
  });

  afterEach(async () => {
    if (previousCredentialsDir === undefined) delete process.env.XOPC_CREDENTIALS_DIR;
    else process.env.XOPC_CREDENTIALS_DIR = previousCredentialsDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stores one private credential record per canonical endpoint', async () => {
    const store = new McpOAuthStore();
    const serverUrl = new URL('https://mcp.example.com/api#ignored');

    await store.update(serverUrl, () => ({
      version: 1,
      serverUrl: canonicalMcpServerUrl(serverUrl),
      tokens: { access_token: 'secret', token_type: 'Bearer' },
      updatedAt: '',
    }));

    await expect(store.load('https://mcp.example.com/api')).resolves.toMatchObject({
      tokens: { access_token: 'secret', token_type: 'Bearer' },
    });
    expect((await stat(store.pathFor(serverUrl))).mode & 0o777).toBe(0o600);
    expect(await readFile(store.pathFor(serverUrl), 'utf8')).not.toContain('#ignored');
  });

  it('serializes concurrent updates without losing fields', async () => {
    const store = new McpOAuthStore();
    const serverUrl = 'https://mcp.example.com/api';

    await Promise.all([
      store.update(serverUrl, (current) => ({
        ...current,
        version: 1,
        serverUrl,
        clientInformation: { client_id: 'client' },
        updatedAt: '',
      })),
      store.update(serverUrl, (current) => ({
        ...current,
        version: 1,
        serverUrl,
        tokens: { access_token: 'token', token_type: 'Bearer' },
        updatedAt: '',
      })),
    ]);

    await expect(store.load(serverUrl)).resolves.toMatchObject({
      clientInformation: { client_id: 'client' },
      tokens: { access_token: 'token' },
    });
  });
});

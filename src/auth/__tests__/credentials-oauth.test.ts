import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CredentialResolver } from '../credentials.js';

let tempDir: string;
let previousCredentialsDir: string | undefined;

// Environment variables to isolate from the host environment (e.g. GITHUB_TOKEN in CI)
const GITHUB_COPILOT_ENV_VARS = [
  'COPILOT_GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_COPILOT_TOKEN',
];
let previousEnvVars: Record<string, string | undefined> = {};

describe('CredentialResolver OAuth credentials', () => {
  beforeEach(async () => {
    previousCredentialsDir = process.env.XOPC_CREDENTIALS_DIR;
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-credentials-oauth-'));
    process.env.XOPC_CREDENTIALS_DIR = join(tempDir, 'credentials');

    // Isolate from CI host environment
    previousEnvVars = {};
    for (const key of GITHUB_COPILOT_ENV_VARS) {
      previousEnvVars[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    if (previousCredentialsDir === undefined) {
      delete process.env.XOPC_CREDENTIALS_DIR;
    } else {
      process.env.XOPC_CREDENTIALS_DIR = previousCredentialsDir;
    }
    // Restore host environment
    for (const key of GITHUB_COPILOT_ENV_VARS) {
      if (previousEnvVars[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnvVars[key];
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists OAuth token as a first-class credential source', async () => {
    const resolver = new CredentialResolver();

    await resolver.saveOAuthToken('anthropic', {
      access: 'oauth-access-token',
      refresh: 'oauth-refresh-token',
      expiresAt: Date.now() + 60_000,
      scope: ['model:read'],
      createdAt: '2026-06-07T00:00:00.000Z',
    });

    await expect(resolver.resolveApiKey('anthropic')).resolves.toBe('oauth-access-token');
    await expect(resolver.resolveApiKeySource('anthropic')).resolves.toBe('oauth');
    await expect(resolver.loadOAuthTokenRecord('anthropic')).resolves.toMatchObject({
      type: 'oauth',
      provider: 'anthropic',
      access: 'oauth-access-token',
      refresh: 'oauth-refresh-token',
      scope: ['model:read'],
    });
  });

  it('disconnects both default API key profile and OAuth token for a provider', async () => {
    const resolver = new CredentialResolver();

    await resolver.saveApiKey('github-copilot', 'stored-api-key');
    await resolver.saveOAuthToken('github-copilot', {
      access: 'oauth-access-token',
      createdAt: '2026-06-07T00:00:00.000Z',
    });

    await expect(resolver.resolveApiKeySource('github-copilot')).resolves.toBe('global');

    await resolver.deleteProviderCredential('github-copilot');

    await expect(resolver.resolveApiKey('github-copilot')).resolves.toBeNull();
    await expect(resolver.resolveApiKeySource('github-copilot')).resolves.toBeNull();
    await expect(resolver.loadOAuthTokenRecord('github-copilot')).resolves.toBeNull();
  });
});

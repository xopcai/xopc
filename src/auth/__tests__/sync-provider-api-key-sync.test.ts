import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';

const tmpRoot = join(process.cwd(), 'node_modules/.cache/xopc-sync-auth-test');

vi.mock('../../config/loader.js', () => ({
  loadConfig: () => ({}),
}));

vi.mock('../../routing/resolve-route.js', () => ({
  getDefaultAgentId: () => 'main',
}));

vi.mock('../../config/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/paths.js')>();
  return {
    ...actual,
    resolveAgentAuthProfilesPath: (agentId: string) =>
      join(tmpRoot, 'agents', agentId, 'auth-profiles.json'),
    resolveAuthProfilesPath: () => join(tmpRoot, 'global', 'auth-profiles.json'),
    resolveOAuthPath: (p: string) => join(tmpRoot, 'oauth', `${p.toLowerCase()}.json`),
  };
});

const { hasProviderAuthOnDiskSync, resolveProviderApiKeyForAgentSync, resolveProviderApiKeySync } =
  await import('../sync-provider-auth.js');

describe('resolveProviderApiKeySync', () => {
  beforeEach(() => {
    mkdirSync(join(tmpRoot, 'oauth'), { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns OAuth access token when profiles are empty', () => {
    writeFileSync(
      join(tmpRoot, 'oauth', 'anthropic.json'),
      JSON.stringify({
        type: 'oauth',
        provider: 'anthropic',
        access: 'oauth-token',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    expect(resolveProviderApiKeySync('anthropic')).toBe('oauth-token');
  });

  it('prefers global auth profile over OAuth', () => {
    mkdirSync(join(tmpRoot, 'global'), { recursive: true });
    writeFileSync(
      join(tmpRoot, 'global', 'auth-profiles.json'),
      JSON.stringify({
        version: 2,
        profiles: {
          'openai:default': {
            type: 'api_key',
            provider: 'openai',
            key: 'sk-from-profile',
            envVar: null,
          },
        },
      }),
    );
    writeFileSync(
      join(tmpRoot, 'oauth', 'openai.json'),
      JSON.stringify({
        type: 'oauth',
        provider: 'openai',
        access: 'oauth-only',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    expect(resolveProviderApiKeySync('openai')).toBe('sk-from-profile');
  });

  it('resolves only the active agent private credential before the shared credential', () => {
    const config = {} as Config;
    for (const [agentId, key] of [['main', 'sk-main'], ['studio', 'sk-studio']] as const) {
      const dir = join(tmpRoot, 'agents', agentId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'auth-profiles.json'),
        JSON.stringify({
          version: 2,
          profiles: {
            'openai:default': { type: 'api_key', provider: 'openai', key, envVar: null },
          },
        }),
      );
    }
    mkdirSync(join(tmpRoot, 'global'), { recursive: true });
    writeFileSync(
      join(tmpRoot, 'global', 'auth-profiles.json'),
      JSON.stringify({
        version: 2,
        profiles: {
          'openai:default': { type: 'api_key', provider: 'openai', key: 'sk-shared', envVar: null },
        },
      }),
    );

    expect(resolveProviderApiKeyForAgentSync('openai', 'studio', config)).toBe('sk-studio');
    expect(resolveProviderApiKeyForAgentSync('openai', 'main', config)).toBe('sk-main');
    expect(resolveProviderApiKeyForAgentSync('openai', undefined, config)).toBe('sk-shared');
  });

  it('treats an expired OAuth access token as configured when a refresh token is present', () => {
    writeFileSync(
      join(tmpRoot, 'oauth', 'xopc-cloud.json'),
      JSON.stringify({
        type: 'oauth',
        provider: 'xopc-cloud',
        access: 'expired-access-token',
        refresh: 'valid-refresh-token',
        expiresAt: Date.now() - 60_000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    expect(hasProviderAuthOnDiskSync('xopc-cloud')).toBe(true);
    expect(resolveProviderApiKeySync('xopc-cloud')).toBeUndefined();

    writeFileSync(
      join(tmpRoot, 'oauth', 'xopc-cloud.json'),
      JSON.stringify({
        type: 'oauth',
        provider: 'xopc-cloud',
        access: 'expired-access-token',
        expiresAt: Date.now() - 60_000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    expect(hasProviderAuthOnDiskSync('xopc-cloud')).toBe(false);
  });
});

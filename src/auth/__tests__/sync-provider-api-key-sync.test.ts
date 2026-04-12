import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpRoot = join(process.cwd(), 'node_modules/.cache/xopcbot-sync-auth-test');

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
    resolveAgentAuthProfilesPath: () => join(tmpRoot, 'agent', 'auth-profiles.json'),
    resolveAuthProfilesPath: () => join(tmpRoot, 'global', 'auth-profiles.json'),
    resolveOAuthPath: (p: string) => join(tmpRoot, 'oauth', `${p.toLowerCase()}.json`),
  };
});

const { resolveProviderApiKeySync } = await import('../sync-provider-auth.js');

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
});

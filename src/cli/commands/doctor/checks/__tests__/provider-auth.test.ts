import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../../../config/schema.js';
import { resolveOAuthPath } from '../../../../../config/paths.js';
import { PROVIDER_ENV_MAP } from '../../../../../providers/env-keys.js';
import type { DoctorContext } from '../../types.js';
import { checkProviderAuth } from '../provider-auth.js';

vi.mock('../../../../../config/loader.js', () => ({
  loadConfig: () => ConfigSchema.parse({}),
}));

let stateDir: string;
let context: DoctorContext;

beforeEach(() => {
  initializeTestAgentCatalog();
  stateDir = mkdtempSync(join(tmpdir(), 'xopc-doctor-auth-'));
  vi.stubEnv('XOPC_STATE_DIR', stateDir);
  for (const names of Object.values(PROVIDER_ENV_MAP)) {
    for (const name of names) vi.stubEnv(name, '');
  }
  const configPath = join(stateDir, 'xopc.json');
  writeFileSync(configPath, '{}');
  context = {
    configPath, stateDir,
    options: { fix: false, json: false, deep: false, security: false },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(stateDir, { recursive: true, force: true });
});

function writeOAuth(provider: string, expiresAt: number, refresh?: string) {
  mkdirSync(join(stateDir, 'credentials', 'oauth'), { recursive: true });
  writeFileSync(resolveOAuthPath(provider), JSON.stringify({
    type: 'oauth', provider, access: 'test-access', expiresAt, refresh,
  }));
}

describe('checkProviderAuth', () => {
  it('recognizes xopc-cloud login before a default model is selected', async () => {
    writeOAuth('xopc-cloud', Date.now() + 60_000);
    expect((await checkProviderAuth(context)).status).toBe('pass');
  });

  it('recognizes refreshable xopc-cloud login', async () => {
    writeOAuth('xopc-cloud', Date.now() - 60_000, 'test-refresh');
    expect((await checkProviderAuth(context)).status).toBe('pass');
  });

  it('warns when xopc-cloud login expired without a refresh token', async () => {
    writeOAuth('xopc-cloud', Date.now() - 60_000);
    expect((await checkProviderAuth(context)).status).toBe('warn');
  });

  it('recognizes a saved provider API key', async () => {
    mkdirSync(join(stateDir, 'credentials'), { recursive: true });
    writeFileSync(join(stateDir, 'credentials', 'auth-profiles.json'), JSON.stringify({
      version: 1, profiles: { custom: { provider: 'custom-provider', key: 'test-key' } },
    }));
    expect((await checkProviderAuth(context)).status).toBe('pass');
  });

  it('does not count an unrelated environment token as a model credential', async () => {
    vi.stubEnv('UNRELATED_TOKEN', 'test-token');
    expect((await checkProviderAuth(context)).status).toBe('warn');
  });
});

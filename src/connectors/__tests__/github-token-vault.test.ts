import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateCredentialsMasterKey, GitHubTokenVault } from '../github-token-vault.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('GitHubTokenVault', () => {
  it('encrypts GitHub App access and refresh tokens at rest', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'xopc-github-vault-'));
    tempDirs.push(stateDir);
    const vault = new GitHubTokenVault({ stateDir, masterKey: generateCredentialsMasterKey() });
    const token = {
      accessToken: 'ghu_access_secret',
      refreshToken: 'ghr_refresh_secret',
      expiresAt: Date.now() + 10_000,
      refreshTokenExpiresAt: Date.now() + 20_000,
      tokenType: 'bearer',
      scope: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await vault.save(token);

    const persisted = await readFile(join(stateDir, 'credentials', 'github-app-token.enc.json'), 'utf8');
    expect(persisted).not.toContain(token.accessToken);
    expect(persisted).not.toContain(token.refreshToken);
    await expect(vault.load()).resolves.toEqual(token);
  });

  it('refuses to operate without a master key', () => {
    const previous = process.env.XOPC_CREDENTIALS_MASTER_KEY;
    delete process.env.XOPC_CREDENTIALS_MASTER_KEY;
    try {
      expect(() => new GitHubTokenVault().assertAvailable()).toThrow('XOPC_CREDENTIALS_MASTER_KEY is required');
    } finally {
      if (previous === undefined) delete process.env.XOPC_CREDENTIALS_MASTER_KEY;
      else process.env.XOPC_CREDENTIALS_MASTER_KEY = previous;
    }
  });
});

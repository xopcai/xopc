import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveOAuthPath } from '../../config/paths.js';
import { withOAuthProviderLock } from '../oauth-provider-lock.js';

describe('OAuth provider lock', () => {
  let tempDir: string;
  let previousCredentialsDir: string | undefined;

  beforeEach(async () => {
    previousCredentialsDir = process.env.XOPC_CREDENTIALS_DIR;
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-oauth-lock-'));
    process.env.XOPC_CREDENTIALS_DIR = join(tempDir, 'credentials');
  });

  afterEach(async () => {
    if (previousCredentialsDir === undefined) delete process.env.XOPC_CREDENTIALS_DIR;
    else process.env.XOPC_CREDENTIALS_DIR = previousCredentialsDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('immediately recovers a lock owned by a process that no longer exists', async () => {
    const path = `${resolveOAuthPath('xopc-cloud')}.lock`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '99999999:abandoned-owner', 'utf8');

    await expect(withOAuthProviderLock('xopc-cloud', async () => {
      expect(await readFile(path, 'utf8')).not.toBe('99999999:abandoned-owner');
      return 'acquired';
    })).resolves.toBe('acquired');
  });
});

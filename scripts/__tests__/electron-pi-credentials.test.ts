import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from 'esbuild';
import { expect, it } from 'vitest';

import { electronPiCredentialsPlugin } from '../electron-pi-credentials.mjs';

it('uses native MCP credentials outside the checkout without an installed pi package', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-electron-pi-credentials-'));
  try {
    await build({
      entryPoints: [join(process.cwd(), 'src/agent/mcp/credential-store.ts')],
      outfile: join(directory, 'credentials.mjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      define: { PI_BUNDLED_NODE: 'true' },
      plugins: [electronPiCredentialsPlugin()],
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    });
    writeFileSync(join(directory, 'check.mjs'), `
      import assert from 'node:assert/strict';
      import { createNativeMcpCredentials, routeNativeMcpCredentials } from './credentials.mjs';
      assert.throws(() => import.meta.resolve('@earendil-works/pi-coding-agent'), { code: 'ERR_MODULE_NOT_FOUND' });
      const url = 'https://example.com/mcp';
      const state = { serverUrl: url, tokens: { access_token: 'test-token', token_type: 'Bearer' } };
      const memory = await createNativeMcpCredentials(true);
      memory.forServer('docs', url).save(state);
      assert.equal(memory.tokens('docs', url).access_token, 'test-token');
      assert.equal((await createNativeMcpCredentials(true)).tokens('docs', url), undefined);
      const disk = await createNativeMcpCredentials();
      disk.forServer('account', url).save(state);
      const reopened = routeNativeMcpCredentials(await createNativeMcpCredentials(), new Map([['docs', 'account']]));
      assert.equal(reopened.tokens('docs', url).access_token, 'test-token');
      assert.equal(reopened.remove('docs', url), true);
      assert.equal((await createNativeMcpCredentials()).tokens('account', url), undefined);
    `);
    const env = { ...process.env, PI_CODING_AGENT_DIR: join(directory, 'pi') };
    delete env.NODE_PATH;
    delete env.NODE_OPTIONS;
    const result = spawnSync(process.execPath, [join(directory, 'check.mjs')], {
      cwd: directory, env, encoding: 'utf8', timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

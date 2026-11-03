import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { expect, it } from 'vitest';

import { electronPiRuntimePlugin } from '../electron-pi-runtime.mjs';

it('loads OAuth and Bedrock implementations outside the checkout', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-electron-oauth-'));
  try {
    const loader = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-ai'))), 'auth/oauth/load.js');
    await build({
      stdin: { contents: `
        import assert from 'node:assert/strict';
        import * as loaders from ${JSON.stringify(loader)};
        import { bedrockConverseStreamApi } from ${JSON.stringify(join(dirname(loader), '../../api/bedrock-converse-stream.lazy.js'))};
        for (const [name, load] of Object.entries(loaders)) {
          if (!name.startsWith('load')) continue;
          const flow = await load({ gateway: 'https://example.com', name: 'test' });
          assert.equal(typeof flow.login, 'function', name);
          assert.equal(typeof flow.refresh, 'function', name);
          assert.equal(typeof flow.toAuth, 'function', name);
        }
        // Stop at context normalization, after module loading and before any AWS request.
        const context = { get messages() { throw new Error('bedrock-module-loaded'); } };
        const result = await bedrockConverseStreamApi().stream(
          { api: 'bedrock-converse-stream', provider: 'amazon-bedrock', id: 'test' }, context,
        ).result();
        assert.equal(result.errorMessage, 'bedrock-module-loaded');
        const flow = await loaders.loadOpenAIChatGPTOAuth();
        assert.deepEqual(await flow.toAuth({ access: 'test-access-token' }), { apiKey: 'test-access-token' });
      `, resolveDir: process.cwd() },
      outfile: join(directory, 'check.mjs'),
      bundle: true, platform: 'node', target: 'node22', format: 'esm',
      plugins: [electronPiRuntimePlugin()],
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    });
    const env = { ...process.env };
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

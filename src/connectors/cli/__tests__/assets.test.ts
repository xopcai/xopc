import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { prepareCliAssets } from '../assets.js';
import { wps365Adapter } from '../adapters/wps365.js';
import { cliEnvironment, startCliProcess } from '../process.js';

let root: string;
const content = 'pinned';
const asset = { path: 'spec/api.yaml', content, sha256: createHash('sha256').update(content).digest('hex') };
const adapter = { ...wps365Adapter, configAssets: [asset] };
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'cli-assets-')); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

it('installs fixed specs concurrently without replacing credentials and rejects tampering', async () => {
  await writeFile(join(root, 'credentials'), 'private');
  await Promise.all([prepareCliAssets(adapter, root), prepareCliAssets(adapter, root)]);
  expect(await readFile(join(root, 'spec/api.yaml'), 'utf8')).toBe(content);
  expect(await readFile(join(root, 'credentials'), 'utf8')).toBe('private');
  await writeFile(join(root, 'spec/api.yaml'), 'tampered');
  await expect(prepareCliAssets(adapter, root)).rejects.toThrow('integrity');
});
it('rejects traversal, symlinked directories and corrupt packaged content', async () => {
  await expect(prepareCliAssets({ ...adapter, configAssets: [{ ...asset, path: '../outside' }] }, root)).rejects.toThrow();
  await expect(prepareCliAssets({ ...adapter, configAssets: [{ ...asset, content: 'changed' }] }, root)).rejects.toThrow();
  const outside = join(root, 'outside'); await mkdir(outside); await symlink(outside, join(root, 'spec'));
  await expect(prepareCliAssets(adapter, root)).rejects.toThrow('directory');
});
it('publishes large assets atomically and refuses file symlinks', async () => {
  const large = 'x'.repeat(1024 * 1024);
  const fixture = { ...adapter, configAssets: [{ ...asset, content: large, sha256: createHash('sha256').update(large).digest('hex') }] };
  await Promise.all(Array.from({ length: 8 }, () => prepareCliAssets(fixture, root)));
  expect(await readFile(join(root, asset.path), 'utf8')).toBe(large);
  await rm(join(root, asset.path));
  await writeFile(join(root, 'outside'), content);
  await symlink(join(root, 'outside'), join(root, asset.path));
  await expect(prepareCliAssets(adapter, root)).rejects.toThrow('integrity');
  expect(await readFile(join(root, 'outside'), 'utf8')).toBe(content);
});
it('prepares packaged assets before the subprocess and isolates provider environment', async () => {
  vi.stubEnv('XOPC_STATE_DIR', root);
  vi.stubEnv('WPS365_ACCESS_TOKEN', 'unrelated-token');
  const handle = await startCliProcess({ adapter, executable: process.execPath, contextId: 'test', args: ['-e', 'console.log(JSON.stringify({asset:require("fs").readFileSync(process.env.WPS365_CONFIG_DIR+"/spec/api.yaml","utf8"),backend:process.env.WPS365_KEYRING_BACKEND,token:process.env.WPS365_ACCESS_TOKEN}))'] });
  expect(JSON.parse((await handle.completion).stdout)).toEqual({ asset: 'pinned', backend: 'file' });
  expect(() => cliEnvironment({ ...adapter, environment: { HOME: '/escape' } }, root)).toThrow('Reserved');
});

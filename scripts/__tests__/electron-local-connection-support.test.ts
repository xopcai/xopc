import { mkdtemp, mkdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { localConnectionEnvironment, prepareLocalConnectionLayout, withTimeout } from '../electron-local-connection-support.mjs';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xopc-connection-layout-'));
  roots.push(root);
  await mkdir(join(root, 'dist'));
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('excludes inherited product paths, secrets and runtime injection from acceptance', () => {
  const env = localConnectionEnvironment({ PATH: '/usr/bin', DISPLAY: ':1', XOPC_PROFILE: 'daily',
    XOPC_CREDENTIALS_DIR: '/daily/credentials', XOPC_UI_STATIC_ROOT: '/daily/ui',
    PI_CODING_AGENT_DIR: '/daily/pi', ELECTRON_RENDERER_URL: 'https://daily.example',
    NODE_OPTIONS: '--import=/daily/hook.mjs', TELEGRAM_BOT_TOKEN: 'daily-token', OPENAI_API_KEY: 'daily-key',
  }, '/fixture/repo', '/fixture/state', '/fixture/config.json', '/fixture/workspace');
  expect(env.PATH).toBe('/usr/bin');
  expect(env.DISPLAY).toBe(':1');
  expect(env.XOPC_CREDENTIALS_DIR).toBe(join('/fixture/state', 'credentials'));
  expect(env.XOPC_UI_STATIC_ROOT).toBe(join('/fixture/repo', 'dist/gateway/static/root'));
  expect(env.PI_CODING_AGENT_DIR).toBe(join('/fixture/state', 'pi'));
  expect(JSON.stringify(env)).not.toMatch(/daily|NODE_OPTIONS|API_KEY|BOT_TOKEN/);
});

it.skipIf(process.platform === 'win32')('rejects a concurrent runner without removing the first runner layout', async () => {
  const root = await fixture();
  const cleanup = await prepareLocalConnectionLayout(root);
  await expect(prepareLocalConnectionLayout(root)).rejects.toThrow('locked');
  expect(await readlink(join(root, 'out/dist'))).toBe('../dist');
  await cleanup();
  const next = await prepareLocalConnectionLayout(root);
  await next();
});

it.skipIf(process.platform === 'win32')('preserves an existing valid link on cleanup', async () => {
  const root = await fixture();
  await mkdir(join(root, 'out'));
  await symlink('../dist', join(root, 'out/dist'));
  await (await prepareLocalConnectionLayout(root))();
  expect(await readlink(join(root, 'out/dist'))).toBe('../dist');
});

it.skipIf(process.platform === 'win32')('serializes separate artifact roots sharing the same runner and report directory', async () => {
  const baseline = await fixture();
  const candidate = await fixture();
  const cleanup = await prepareLocalConnectionLayout(baseline, candidate);
  await expect(prepareLocalConnectionLayout(candidate, candidate)).rejects.toThrow('locked');
  expect(await readlink(join(baseline, 'out/dist'))).toBe('../dist');
  await cleanup();
  await (await prepareLocalConnectionLayout(candidate, candidate))();
});

it.skipIf(process.platform === 'win32')('rejects a wrong symlink without changing it or retaining the lock', async () => {
  const root = await fixture();
  await mkdir(join(root, 'out'));
  await mkdir(join(root, 'other'));
  await symlink('../other', join(root, 'out/dist'));
  await expect(prepareLocalConnectionLayout(root)).rejects.toThrow('conflicts');
  expect(await readlink(join(root, 'out/dist'))).toBe('../other');
  await rm(join(root, 'out/dist'));
  await (await prepareLocalConnectionLayout(root))();
});

it('does not remove an existing output directory', async () => {
  const root = await fixture();
  await mkdir(join(root, 'out/dist'), { recursive: true });
  await writeFile(join(root, 'out/dist/keep.txt'), 'existing output');
  await expect(prepareLocalConnectionLayout(root)).rejects.toThrow('conflicts');
});

it('bounds a hung operation and preserves successful values and failures', async () => {
  await expect(withTimeout(new Promise(() => {}), 5, 'fixture deadline')).rejects.toThrow('fixture deadline');
  await expect(withTimeout(Promise.resolve(42), 50, 'unexpected timeout')).resolves.toBe(42);
  await expect(withTimeout(Promise.reject(new Error('original')), 50, 'unexpected timeout')).rejects.toThrow('original');
});

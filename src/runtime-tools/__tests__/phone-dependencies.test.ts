import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import AdmZip from 'adm-zip';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ adbHash: '', archive: '' }));
vi.mock('../phone-dependency-catalog.js', async importOriginal => {
  const original = await importOriginal<typeof import('../phone-dependency-catalog.js')>();
  const { createHash } = await import('node:crypto');
  const scrcpyHash = createHash('sha256').update('verified-server').digest('hex');
  return { ...original, SCRCPY_SHA256: scrcpyHash,
    phoneDependencyAsset: (kind: 'adb' | 'scrcpy') => ({ ...original.phoneDependencyAsset(kind)!, sha256: kind === 'scrcpy' ? scrcpyHash : fixture.adbHash }) };
});
vi.mock('../../phone/adb-driver.js', () => ({ resolveAdbPath: (configured: string | undefined, stateDir: string) => configured ?? join(stateDir, 'tools/adb/versions/37.0.1', process.platform === 'win32' ? 'adb.exe' : 'adb') }));
vi.mock('../command.js', () => ({ runRuntimeCommand: vi.fn(async ({ command }: { command: string }) => {
  const value = await readFile(command, 'utf8').catch(() => 'missing');
  return { ok: value === 'valid-adb', stdout: value === 'valid-adb' ? 'Android Debug Bridge version 1.0.41\nVersion 37.0.1-test' : '', stderr: '' };
}) }));
vi.mock('../downloader.js', async importOriginal => ({ ...await importOriginal<typeof import('../downloader.js')>(), downloadVerifiedArchive: vi.fn(async () => fixture.archive) }));

import { RuntimeToolsConfigSchema } from '../../config/schema.js';
import { PhoneDependencyManager } from '../phone-dependencies.js';
import { managedPhoneAdbPath, managedScrcpyServerPath, phoneDependencyAsset } from '../phone-dependency-catalog.js';
import { downloadVerifiedArchive } from '../downloader.js';

let root: string;
beforeEach(async () => {
  vi.clearAllMocks(); root = await mkdtemp(join(tmpdir(), 'xopc-phone-deps-'));
  const zip = new AdmZip(); zip.addFile(`platform-tools/${process.platform === 'win32' ? 'adb.exe' : 'adb'}`, Buffer.from('valid-adb')); zip.addFile('platform-tools/NOTICE.txt', Buffer.from('license'));
  const bytes = zip.toBuffer(); fixture.adbHash = createHash('sha256').update(bytes).digest('hex');
  fixture.archive = join(root, 'adb.zip'); await writeFile(fixture.archive, bytes);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const manager = (config = RuntimeToolsConfigSchema.parse({})) => new PhoneDependencyManager({ stateDir: root, config });

it('checks readiness without downloading and installs a verified ADB package with companion files', async () => {
  const runtime = manager();
  expect(await runtime.status()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'adb', state: 'absent' }), expect.objectContaining({ kind: 'scrcpy', state: 'absent' })]));
  expect(downloadVerifiedArchive).not.toHaveBeenCalled();
  const progress = vi.fn(); runtime.on('progress', progress); await runtime.install('adb');
  expect(await readFile(managedPhoneAdbPath(root), 'utf8')).toBe('valid-adb');
  expect(await readFile(join(dirname(managedPhoneAdbPath(root)), 'NOTICE.txt'), 'utf8')).toBe('license');
  expect(await runtime.status()).toContainEqual(expect.objectContaining({ kind: 'adb', state: 'ready', source: 'managed', version: '37.0.1' }));
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'complete' }));
});
it('imports only the pinned scrcpy file and leaves the good server intact after a bad import', async () => {
  const runtime = manager(); const source = join(root, 'existing-server'); await writeFile(source, 'verified-server');
  await runtime.install('scrcpy', { sourcePath: source });
  expect(downloadVerifiedArchive).not.toHaveBeenCalled(); expect(await readFile(managedScrcpyServerPath(root), 'utf8')).toBe('verified-server');
  await writeFile(source, 'wrong-version');
  await expect(runtime.install('scrcpy', { sourcePath: source })).rejects.toMatchObject({ code: 'RUNTIME_CHECKSUM_MISMATCH' });
  expect(await readFile(managedScrcpyServerPath(root), 'utf8')).toBe('verified-server');
});
it('uses verified offline packages without a network request and fails closed on corruption', async () => {
  const bundleDir = join(root, 'offline'); await mkdir(bundleDir);
  const asset = phoneDependencyAsset('adb')!; const bytes = await readFile(fixture.archive); await writeFile(join(bundleDir, asset.filename), bytes);
  const runtime = manager(RuntimeToolsConfigSchema.parse({ download: { bundleDir } }));
  await runtime.install('adb'); expect(downloadVerifiedArchive).not.toHaveBeenCalled();
  await writeFile(join(bundleDir, asset.filename), 'corrupt');
  await expect(runtime.install('adb', { repair: true })).rejects.toMatchObject({ code: 'RUNTIME_CHECKSUM_MISMATCH' });
  expect(await readFile(managedPhoneAdbPath(root), 'utf8')).toBe('valid-adb');
});
it('does not provision when disabled or bypass the website-only download policy', async () => {
  await expect(manager(RuntimeToolsConfigSchema.parse({ enabled: false })).install('adb')).rejects.toMatchObject({ code: 'RUNTIME_DISABLED' });
  await expect(manager(RuntimeToolsConfigSchema.parse({ download: { source: 'website-only' } })).install('adb')).rejects.toThrow('official downloads');
  expect(downloadVerifiedArchive).not.toHaveBeenCalled();
});

it('does not install downloaded ADB files after cancellation', async () => {
  const controller = new AbortController(); const runtime = manager();
  vi.mocked(downloadVerifiedArchive).mockImplementationOnce(async () => { controller.abort(); return fixture.archive; });
  await expect(runtime.install('adb', { signal: controller.signal })).rejects.toThrow();
  await expect(readFile(managedPhoneAdbPath(root))).rejects.toMatchObject({ code: 'ENOENT' });
});

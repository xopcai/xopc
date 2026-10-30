import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ archives: {} as Record<string, string>, hashes: {} as Record<string, string>, abort: undefined as AbortController | undefined, files: [] as Array<{ targetName: string; filename: string; url: string; sha256: string; sizeBytes: number }>, raw: {} as Record<string, string> }));
vi.mock('../harmony-paths.js', async original => ({ ...await original<object>(), HOSCRCPY_SHA256: createHash('sha256').update('compatible-jar').digest('hex') }));
vi.mock('../phone-dependency-catalog.js', async original => ({ ...await original<object>(), phoneDependencyAsset: (kind: string) => kind === 'hdc' ? { ...fixture.files[0], kind, version: '3.2.0c', archive: false, files: fixture.files } : ({ kind, version: kind === 'java' ? '17.0.21+9' : '6.0.0.47', filename: `${kind}.tar.gz`, url: `https://example.invalid/${kind}`, sha256: fixture.hashes[kind], archive: true }) }));
vi.mock('../downloader.js', async original => ({ ...await original<object>(), downloadVerifiedArchive: vi.fn(async ({ runtime, targetPath }: { runtime: string; targetPath: string }) => { fixture.abort?.abort(); return runtime === 'hdc' ? fixture.raw[basename(targetPath).replace(/\.partial$/, '')] : fixture.archives[runtime]; }) }));
vi.mock('../command.js', async original => {
  const actual = await original<typeof import('../command.js')>();
  return { runRuntimeCommand: vi.fn(async (args: { command: string; args: string[] }) => {
    if (args.command === 'tar') return actual.runRuntimeCommand(args);
    const text = await readFile(args.command, 'utf8').catch(() => '');
    return { ok: text === 'hdc' || text === 'java' || text === 'javac', stdout: text === 'hdc' ? 'Ver: 3.2.0c' : text === 'java' ? 'openjdk version "17.0.21"' : text === 'javac' ? 'javac 17.0.21' : '', stderr: '' };
  }) };
});

import { ConfigSchema } from '../../config/schema.js';
import { resolveHdcVideoTools } from '../../phone/hdc-video-tools.js';
import { HarmonyDependencyManager } from '../harmony-dependencies.js';
import { managedHdcDir, managedHdcPath, managedHosDir, managedHosJar, managedJavaHome } from '../harmony-paths.js';
import { downloadVerifiedArchive } from '../downloader.js';

let root: string;
beforeEach(async () => {
  vi.clearAllMocks(); fixture.abort = undefined;
  root = await mkdtemp(join(tmpdir(), 'xopc-harmony-deps-'));
  const input = join(root, 'input'); await mkdir(input);
  fixture.files = [];
  const names = [process.platform === 'win32' ? 'hdc.exe' : 'hdc', process.platform === 'win32' ? 'libusb_shared.dll' : process.platform === 'darwin' ? 'libusb_shared.dylib' : 'libusb_shared.so'];
  for (const targetName of names) {
    const body = Buffer.from(targetName.startsWith('hdc') ? 'hdc' : 'usb-library');
    const filename = `standalone-${targetName}`;
    const path = join(root, filename); await writeFile(path, body);
    fixture.raw[filename] = path;
    fixture.files.push({ filename, targetName, url: `https://example.invalid/${filename}`, sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.length });
  }
  await mkdir(join(input, 'package', 'resources'), { recursive: true });
  await writeFile(join(input, 'package', 'resources', 'hosScrcpy-1.0.18-beta.jar'), 'compatible-jar');
  await writeFile(join(input, 'package', 'LICENSE'), 'MIT');
  await writeFile(join(input, 'package', 'THIRD_PARTY_NOTICES.md'), 'SDK provenance');
  const java = join(input, 'jdk', ...(process.platform === 'darwin' ? ['Contents', 'Home'] : []), 'bin');
  await mkdir(java, { recursive: true });
  for (const executable of ['java', 'javac']) await writeFile(join(java, executable + (process.platform === 'win32' ? '.exe' : '')), executable);
  for (const [kind, member] of [['hoscrcpy', 'package'], ['java', 'jdk']]) {
    const archive = join(root, `${kind}.tar.gz`);
    execFileSync('tar', ['-czf', archive, '-C', input, member]);
    fixture.archives[kind] = archive;
    fixture.hashes[kind] = createHash('sha256').update(await readFile(archive)).digest('hex');
  }
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function manager() { const config = ConfigSchema.parse({}); return new HarmonyDependencyManager({ stateDir: root, config: config.runtimeTools, phone: config.phone }, vi.fn()); }

it('installs standalone tools with USB companions, a full JDK and preserved SDK notices', async () => {
  const runtime = manager();
  for (const kind of ['hdc', 'java', 'hoscrcpy'] as const) await runtime.install(kind);
  expect(await readFile(managedHdcPath(root), 'utf8')).toBe('hdc');
  expect(await readFile(join(managedHdcDir(root), fixture.files[1]!.targetName), 'utf8')).toBe('usb-library');
  expect(await readFile(join(managedHosDir(root), 'THIRD_PARTY_NOTICES.md'), 'utf8')).toBe('SDK provenance');
  const config = ConfigSchema.parse({ phone: { hdcPath: managedHdcPath(root), hdcVideo: { sdkJar: managedHosJar(root), javaHome: managedJavaHome(root) } } });
  const detector = new HarmonyDependencyManager({ stateDir: root, config: config.runtimeTools, phone: config.phone }, vi.fn());
  for (const kind of ['hdc', 'java', 'hoscrcpy'] as const) expect(await detector.status(kind)).toMatchObject({ state: 'ready', source: 'managed' });
  expect(resolveHdcVideoTools(config.phone, root)).toMatchObject({ jar: managedHosJar(root), classpath: managedHosJar(root) });
  // A second install is idempotent and detection never downloads.
  vi.mocked(downloadVerifiedArchive).mockClear();
  for (const kind of ['hdc', 'java', 'hoscrcpy'] as const) await runtime.install(kind);
  expect(downloadVerifiedArchive).not.toHaveBeenCalled();
});

it('does not commit a cancelled download or replace a good installation with a corrupt archive', async () => {
  const runtime = manager();
  await runtime.install('hdc');
  fixture.files[0]!.sha256 = '0'.repeat(64);
  await expect(runtime.install('hdc', { repair: true })).rejects.toMatchObject({ code: 'RUNTIME_CHECKSUM_MISMATCH' });
  expect(await readFile(managedHdcPath(root), 'utf8')).toBe('hdc');
  fixture.abort = new AbortController();
  await expect(runtime.install('hoscrcpy', { signal: fixture.abort.signal })).rejects.toThrow();
  await expect(readFile(managedHosJar(root))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('does not download on inspection or when installation is disabled', async () => {
  const config = ConfigSchema.parse({ runtimeTools: { enabled: false }, phone: { hdcPath: join(root, 'missing-hdc'), hdcVideo: { javaHome: join(root, 'missing-java'), sdkJar: join(root, 'missing.jar') } } });
  const runtime = new HarmonyDependencyManager({ stateDir: root, config: config.runtimeTools, phone: config.phone }, vi.fn());
  for (const kind of ['hdc', 'java', 'hoscrcpy'] as const) {
    expect(await runtime.status(kind)).toMatchObject({ canInstall: false });
    await expect(runtime.install(kind)).rejects.toMatchObject({ code: 'RUNTIME_DISABLED' });
  }
  expect(downloadVerifiedArchive).not.toHaveBeenCalled();
});

it('accepts verified offline packages and rejects a wrong bundle without touching existing tools', async () => {
  const config = ConfigSchema.parse({ runtimeTools: { download: { bundleDir: root } } });
  const runtime = new HarmonyDependencyManager({ stateDir: root, config: config.runtimeTools, phone: config.phone }, vi.fn());
  await runtime.install('hoscrcpy');
  expect(downloadVerifiedArchive).not.toHaveBeenCalled();
  await writeFile(fixture.archives.hoscrcpy, 'wrong');
  await expect(runtime.install('hoscrcpy', { repair: true })).rejects.toMatchObject({ code: 'RUNTIME_CHECKSUM_MISMATCH' });
  expect(await readFile(managedHosJar(root), 'utf8')).toBe('compatible-jar');
});

it('repairs a damaged managed USB companion even when the HDC executable still reports its version', async () => {
  const runtime = manager(); await runtime.install('hdc');
  await writeFile(join(managedHdcDir(root), fixture.files[1]!.targetName), 'damaged');
  const config = ConfigSchema.parse({ phone: { hdcPath: managedHdcPath(root) } });
  const detector = new HarmonyDependencyManager({ stateDir: root, config: config.runtimeTools, phone: config.phone }, vi.fn());
  expect(await detector.status('hdc')).toMatchObject({ state: 'corrupted' });
  await runtime.install('hdc');
  expect(await detector.status('hdc')).toMatchObject({ state: 'ready' });
});

it('keeps the previous pair intact if the USB download fails after staging the executable', async () => {
  const runtime = manager(); await runtime.install('hdc');
  vi.mocked(downloadVerifiedArchive).mockImplementationOnce(async () => fixture.raw[fixture.files[0]!.filename]!).mockRejectedValueOnce(new Error('USB download failed'));
  await expect(runtime.install('hdc', { repair: true })).rejects.toThrow('USB download failed');
  expect(await readFile(managedHdcPath(root), 'utf8')).toBe('hdc');
  expect(await readFile(join(managedHdcDir(root), fixture.files[1]!.targetName), 'utf8')).toBe('usb-library');
});

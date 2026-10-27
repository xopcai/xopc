/** Explicitly invoked, disposable macOS native benchmark. No personal applications. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'esbuild';
import { COMPUTER_DRIVER_VERSION, computerDriverRelease } from './lib/computer-driver-release.mjs';

assert.equal(process.platform, 'darwin');
const samples = Number(process.argv[2] ?? 30);
assert.ok(Number.isInteger(samples) && samples > 0 && samples <= 50);
const kinds = process.argv[3] ?? 'activate,setValue,typeText,pressKeys';
assert.ok(kinds.split(',').every(kind => ['activate', 'setValue', 'typeText', 'pressKeys', 'program'].includes(kind)));
const repo = resolve(import.meta.dirname, '..');
const root = await mkdtemp(join(tmpdir(), 'xopc-input-baseline-'));
const fixture = join(root, 'XopcInputBenchmark.app/Contents');
await mkdir(join(fixture, 'MacOS'), { recursive: true });
await writeFile(join(fixture, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>ai.xopc.input-benchmark</string>
<key>CFBundleName</key><string>XopcInputBenchmark</string>
<key>CFBundleExecutable</key><string>XopcInputBenchmark</string>
<key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
await copyFile(join(repo, 'scripts/fixtures/ComputerInputBenchmark.swift'), join(root, 'fixture.swift'));
await promisify(execFile)('xcrun', ['swiftc', join(root, 'fixture.swift'), '-o', join(fixture, 'MacOS/XopcInputBenchmark')]);
const output = join(repo, '.cache/computer-input-benchmark');
await mkdir(output, { recursive: true });
await build({ entryPoints: [join(repo, kinds === 'program' ? 'scripts/verify-computer-program-native.mts' : 'scripts/verify-computer-input-baseline.mts')], outfile: join(output, 'verify.mjs'),
  bundle: true, platform: 'node', format: 'esm', external: ['electron', '@trycua/cua-driver', '@earendil-works/*', 'sharp', 'better-sqlite3'],
  banner: { js: 'import { createRequire as __inputCreateRequire } from "node:module"; const require = __inputCreateRequire(import.meta.url);' } });
const release = computerDriverRelease(process.platform, process.arch);
const binary = join(repo, '.cache/computer-driver', COMPUTER_DRIVER_VERSION, release.cacheDirectory, 'cua-driver');
const checksum = createHash('sha256').update(await readFile(binary)).digest('hex');
assert.equal(checksum, release.files['cua-driver']);
const target = spawn(join(fixture, 'MacOS/XopcInputBenchmark'), [], { stdio: 'ignore' });
const resultPath = join(root, 'baseline.json');
try {
  await new Promise(resolveReady => setTimeout(resolveReady, 1000));
  const env: NodeJS.ProcessEnv = { ...process.env, XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_FILE: 'false',
    XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_SQLITE_ASSET_ROOT: join(repo, 'src/storage/sqlite') };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = createRequire(import.meta.url)('electron') as string;
  const child = spawn(electron, [join(output, 'verify.mjs'), binary, resultPath, String(samples), kinds], { env, stdio: 'inherit', timeout: 600_000, killSignal: 'SIGKILL' });
  const exit = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); });
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  console.log(JSON.stringify({ evidence: resultPath, driverVersion: COMPUTER_DRIVER_VERSION, binarySha256: checksum, ...result.summary }, null, 2));
  process.exitCode = exit ?? 1;
} finally { target.kill('SIGTERM'); }

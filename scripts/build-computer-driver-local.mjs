/** Build an opt-in native candidate without changing published driver pins. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync, chmodSync, renameSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPUTER_DRIVER_VERSION } from './lib/computer-driver-release.mjs';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/build-computer-driver-local.mjs /path/to/cua');
if (process.platform !== 'darwin') throw new Error('Local native-batch candidate builds are currently enabled on macOS only');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = resolve(source);
const manifestPath = join(upstream, 'libs/cua-driver/rust/Cargo.toml');
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifestPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const native = metadata.packages.find(pkg => pkg.name === 'cua-driver');
const sdk = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies['@trycua/cua-driver'];
if (native?.version !== COMPUTER_DRIVER_VERSION || sdk !== COMPUTER_DRIVER_VERSION) throw new Error('Candidate driver, installed SDK pin and release baseline must match');
const build = spawnSync('cargo', ['build', '--locked', '--release', '--manifest-path', manifestPath, '-p', 'cua-driver'], { stdio: 'inherit' });
if (build.status !== 0) throw new Error('Native candidate build failed');
const local = join(root, '.cache/computer-driver/local'); mkdirSync(local, { recursive: true });
const staging = mkdtempSync(join(local, '.candidate-'));
const staged = join(staging, 'cua-driver');
copyFileSync(join(metadata.target_directory, 'release/cua-driver'), staged); chmodSync(staged, 0o755);
execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', staged], { stdio: 'inherit' });
const sha256 = createHash('sha256').update(readFileSync(staged)).digest('hex');
const directory = join(local, sha256); mkdirSync(directory, { recursive: true });
const binary = join(directory, 'cua-driver'); renameSync(staged, binary);
rmSync(staging, { recursive: true });
const sourceRevision = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDirty = execFileSync('git', ['-C', upstream, 'status', '--porcelain', '--', 'libs/cua-driver/rust'], { encoding: 'utf8' }).trim().length > 0;
const candidate = { version: 1, sdkVersion: sdk, platform: process.platform, arch: process.arch,
  binary: `${sha256}/cua-driver`, sha256, sourceRevision, sourceDirty };
const temporary = join(local, `current-${randomUUID()}.json`);
writeFileSync(temporary, JSON.stringify(candidate, null, 2), { mode: 0o600 }); renameSync(temporary, join(local, 'current.json'));
console.log(JSON.stringify({ binary, manifest: join(local, 'current.json'), sourceRevision, sourceDirty,
  launch: 'XOPC_COMPUTER_DRIVER_BUILD=local pnpm run electron:dev' }, null, 2));

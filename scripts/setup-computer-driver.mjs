import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { COMPUTER_DRIVER_VERSION, computerDriverRelease } from './lib/computer-driver-release.mjs';

// Upgrade only with reviewed protocol fixtures and a new release digest.
const version = COMPUTER_DRIVER_VERSION;
if (!['darwin', 'win32'].includes(process.platform)) { console.log('Skipping unsupported Computer Use platform.'); process.exit(0); }
const target = computerDriverRelease(process.platform, process.arch);
const downloadUrl = `https://api.github.com/repos/trycua/cua/releases/assets/${target.assetId}`;
const maxDownloadAttempts = 4;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.cache', 'computer-driver', version, target.cacheDirectory);
try {
  for (const [name, digest] of Object.entries(target.files)) {
    const cached = await readFile(join(output, name));
    if (createHash('sha256').update(cached).digest('hex') !== digest) throw new Error(`Cached driver checksum mismatch: ${name}`);
  }
  console.log(`Verified cached Cua Driver ${version}`); process.exit(0);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
// Shared CI runners can exhaust GitHub's anonymous API rate limit.
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const headers = {
  Accept: 'application/octet-stream',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};
let bytes;
for (let attempt = 1; attempt <= maxDownloadAttempts; attempt += 1) {
  try {
    const response = await fetch(downloadUrl, { headers, signal: AbortSignal.timeout(120_000) });
    if (!response.ok) {
      const error = new Error(`Driver download failed: ${response.status}`);
      error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw error;
    }
    bytes = Buffer.from(await response.arrayBuffer());
    break;
  } catch (error) {
    if (error.retryable === false || attempt === maxDownloadAttempts) throw error;
    const delayMs = 1_000 * 2 ** (attempt - 1);
    console.warn(`Driver download attempt ${attempt}/${maxDownloadAttempts} failed; retrying in ${delayMs}ms: ${error.message}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
}
if (createHash('sha256').update(bytes).digest('hex') !== target.sha256) throw new Error('Driver checksum mismatch');
const temp = await mkdtemp(join(tmpdir(), 'xopc-cua-'));
const archive = join(temp, target.archive);
await writeFile(archive, bytes, { mode: 0o600 });
// Git Bash's GNU tar treats drive letters as remote hosts and cannot read ZIPs.
const tar = process.platform === 'win32'
  ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar';
const entries = execFileSync(tar, ['-tf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
const selected = Object.keys(target.files).map(name => {
  const matches = entries.filter(entry => entry === name || entry.endsWith(`/${name}`));
  const entry = matches[0];
  if (matches.length !== 1 || entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..') || entry.includes(':')) throw new Error('Unexpected driver archive');
  return { name, entry };
});
execFileSync(tar, ['-xf', archive, '-C', temp, ...selected.map(file => file.entry)]);
for (const { name, entry } of selected) {
  const extracted = await readFile(join(temp, entry));
  if (createHash('sha256').update(extracted).digest('hex') !== target.files[name]) throw new Error(`Driver binary checksum mismatch: ${name}`);
}
await mkdir(output, { recursive: true, mode: 0o700 });
for (const { name, entry } of selected) {
  await copyFile(join(temp, entry), join(output, name));
  if (process.platform === 'darwin') await chmod(join(output, name), 0o755);
}
console.log(`Verified Cua Driver ${version}: ${output}`);
console.log(`Download retained for inspection: ${temp}`);

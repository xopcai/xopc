import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Upgrade only with reviewed protocol fixtures and a new release digest.
const version = '0.28.2';
if (process.platform !== 'darwin') { console.log('Skipping macOS-only Computer Use driver.'); process.exit(0); }
const sha256 = '386db225a3080714a0f9f935525e61efaf46709587ef8b94dd2df81aeb2f6daa';
const binarySha256 = 'af30d29cf33bd3bbda1330be7225b18881ea4c5af6df374e08627914b5ac334d';
const downloadUrl = 'https://api.github.com/repos/trycua/cua/releases/assets/566587560';
const maxDownloadAttempts = 4;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.cache', 'computer-driver', version);
try {
  const cached = await readFile(join(output, 'cua-driver'));
  if (createHash('sha256').update(cached).digest('hex') !== binarySha256) throw new Error('Cached driver checksum mismatch');
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
if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Driver checksum mismatch');
const temp = await mkdtemp(join(tmpdir(), 'xopc-cua-'));
const archive = join(temp, 'driver.tar.gz');
await writeFile(archive, bytes, { mode: 0o600 });
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
const binary = entries.find((entry) => /(^|\/)cua-driver$/.test(entry));
if (!binary || binary.startsWith('/') || binary.split('/').includes('..')) throw new Error('Unexpected driver archive');
execFileSync('tar', ['-xzf', archive, '-C', temp, binary]);
await mkdir(output, { recursive: true, mode: 0o700 });
await copyFile(join(temp, binary), join(output, 'cua-driver'));
await chmod(join(output, 'cua-driver'), 0o755);
console.log(`Verified Cua Driver ${version}: ${output}/cua-driver`);
console.log(`Download retained for inspection: ${temp}`);

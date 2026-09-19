import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runProcess } from '../../process/run-process.js';
import { cliRoot } from './process.js';
import type { CliAdapter } from './types.js';

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const installs = new Map<string, Promise<string>>();

export function verifyIntegrity(bytes: Buffer, integrity: string): void {
  const match = /^(sha256|sha512)-(.+)$/.exec(integrity);
  if (!match) throw new Error('Unsupported CLI integrity format.');
  const expected = match[2]!;
  const digest = createHash(match[1]!).update(bytes).digest(match[1] === 'sha256' ? 'hex' : 'base64');
  if (digest !== expected) throw new Error('CLI distribution integrity mismatch.');
}

export function cliExecutablePath(adapter: CliAdapter): string {
  return join(cliRoot(), 'runtimes', adapter.id, adapter.binaryVersion, `${process.platform}-${process.arch}`, adapter.executable);
}

export async function verifyInstalledCli(adapter: CliAdapter): Promise<string> {
  const path = cliExecutablePath(adapter);
  const [binary, digest] = await Promise.all([readFile(path), readFile(`${path}.sha256`, 'utf8')]);
  verifyIntegrity(binary, `sha256-${digest.trim()}`);
  return path;
}

async function install(adapter: CliAdapter): Promise<string> {
  const distribution = adapter.distributions[`${process.platform}-${process.arch}`];
  if (!distribution) throw new Error(`Unsupported CLI platform: ${process.platform}-${process.arch}.`);
  const url = new URL(distribution.url);
  if (url.protocol !== 'https:' || !['github.com', 'registry.npmjs.org'].includes(url.hostname)) throw new Error('Untrusted CLI distribution URL.');
  try { return await verifyInstalledCli(adapter); } catch { /* install a verified artifact */ }
  const directory = join(cliRoot(), 'runtimes', adapter.id, adapter.binaryVersion, `${process.platform}-${process.arch}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const staging = join(directory, `.install-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok || !response.body) throw new Error(`CLI download failed (${response.status}).`);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_ARCHIVE_BYTES) throw new Error('CLI distribution exceeds size limit.');
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    verifyIntegrity(bytes, distribution.integrity);
    const archive = join(staging, 'archive.tgz');
    await writeFile(archive, bytes, { mode: 0o600 });
    // Extract one pinned member to stdout; never extract archive paths onto the host.
    const binaryChunks: Buffer[] = [];
    let binaryBytes = 0;
    const extracted = await runProcess({
      program: 'tar', args: ['-xOf', archive, distribution.archiveEntry],
      maxOutputBytes: MAX_ARCHIVE_BYTES, timeoutMs: 30_000, terminationPolicy: 'tree',
      onOutput(stream, chunk) {
        if (stream !== 'stdout') return;
        binaryBytes += chunk.length;
        if (binaryBytes <= MAX_ARCHIVE_BYTES) binaryChunks.push(Buffer.from(chunk));
      },
    });
    if (extracted.exitCode !== 0 || extracted.outputTruncated || binaryBytes > MAX_ARCHIVE_BYTES) {
      throw new Error('CLI archive extraction failed.');
    }
    const binary = Buffer.concat(binaryChunks);
    const executable = cliExecutablePath(adapter);
    const temporary = join(staging, adapter.executable);
    await writeFile(temporary, binary, { mode: 0o700 });
    await chmod(temporary, 0o700);
    const probe = await runProcess({ program: temporary, args: ['--version'], timeoutMs: 10_000 });
    if (probe.exitCode !== 0 || !probe.stdout.includes(adapter.binaryVersion)) throw new Error('CLI version verification failed.');
    await writeFile(`${executable}.sha256`, createHash('sha256').update(binary).digest('hex'), { mode: 0o600 });
    await rename(temporary, executable);
    return executable;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export function installCli(adapter: CliAdapter): Promise<string> {
  const key = cliExecutablePath(adapter);
  const pending = installs.get(key);
  if (pending) return pending;
  const operation = install(adapter).finally(() => installs.delete(key));
  installs.set(key, operation);
  return operation;
}

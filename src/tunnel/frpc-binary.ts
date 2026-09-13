import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { createHash } from 'node:crypto';

import { resolveBinDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import { extractFrpcFromReleaseArchive, frpcReleaseArchiveExtension, nodePlatformForFrpTarget, type FrpcReleasePlatform } from './frpc-extract.js';
import { FRPC_RELEASES, FRPC_VERSION } from './frpc-release.js';
import type { FrpcDownloadProgress } from './tunnel-types.js';

export { FRPC_VERSION };
export type { FrpcDownloadProgress };
const log = createLogger('TunnelFrpc');
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export type EnsureFrpcBinaryOptions = {
  onProgress?: (progress: FrpcDownloadProgress) => void;
  platform?: FrpcReleasePlatform;
  arch?: string;
};

export function buildFrpcReleaseBasename(platform: FrpcReleasePlatform, arch: string, version = FRPC_VERSION): string {
  return `frp_${version}_${platform}_${arch}`;
}

export function frpcDownloadUrlsForTarget(platform: FrpcReleasePlatform, arch: string, version = FRPC_VERSION): string[] {
  const archive = buildFrpcReleaseBasename(platform, arch, version) + frpcReleaseArchiveExtension(platform);
  return [
    `https://frp.xopc.ai/bin/${archive}`,
    `https://github.com/fatedier/frp/releases/download/v${version}/${archive}`,
  ];
}

export async function verifyFrpcDigest(path: string, expected: string): Promise<void> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  if (hash.digest('hex') !== expected) throw new Error('COMPONENT_VERIFY_FAILED: frpc checksum mismatch');
}

async function downloadToFile(url: string, path: string, onProgress?: EnsureFrpcBinaryOptions['onProgress']): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error(`frpc download failed: ${response.status}`);
  const length = Number(response.headers.get('content-length'));
  const totalBytes = length > 0 ? length : null;
  if (totalBytes && totalBytes > MAX_ARCHIVE_BYTES) {
    await response.body.cancel();
    throw new Error('frpc archive exceeds size limit');
  }
  let bytesReceived = 0;
  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_ARCHIVE_BYTES) return callback(new Error('frpc archive exceeds size limit'));
      onProgress?.({ phase: 'downloading', url, bytesReceived, totalBytes, percent: totalBytes ? Math.min(100, Math.round(bytesReceived / totalBytes * 100)) : null });
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), bounded, createWriteStream(path, { mode: 0o600 }));
}

export function publishFrpcPathForProcess(path: string): void { process.env.XOPC_FRPC_PATH = path; }
export function clearFrpcPathForProcess(): void { delete process.env.XOPC_FRPC_PATH; }

export async function ensureFrpcBinary(opts: EnsureFrpcBinaryOptions = {}): Promise<string> {
  const platform = opts.platform ?? (process.platform === 'win32' ? 'windows' : process.platform) as FrpcReleasePlatform;
  const arch = opts.arch ?? (process.arch === 'x64' ? 'amd64' : process.arch);
  const target = `${platform}_${arch}`;
  if (!Object.hasOwn(FRPC_RELEASES, target)) throw new Error(`Unsupported frpc target: ${target}`);
  const release = FRPC_RELEASES[target as keyof typeof FRPC_RELEASES];
  const fromEnv = !opts.platform && !opts.arch ? process.env.XOPC_FRPC_PATH?.trim() : undefined;
  if (fromEnv) {
    await verifyFrpcDigest(fromEnv, release.binary);
    return fromEnv;
  }
  const cacheDir = join(resolveBinDir(), 'frpc', FRPC_VERSION, target);
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  chmodSync(cacheDir, 0o700);
  const binName = platform === 'windows' ? 'frpc.exe' : 'frpc';
  const cachePath = join(cacheDir, binName);
  if (existsSync(cachePath)) {
    try { await verifyFrpcDigest(cachePath, release.binary); return cachePath; }
    catch { log.warn({ target }, 'Discarding unverified frpc cache'); }
  }
  const temporary = mkdtempSync(join(cacheDir, '.download-'));
  const archivePath = join(temporary, 'release' + frpcReleaseArchiveExtension(platform));
  const executablePath = join(temporary, binName);
  let lastError: unknown;
  try {
    for (const url of frpcDownloadUrlsForTarget(platform, arch)) {
      try {
        await downloadToFile(url, archivePath, opts.onProgress);
        await verifyFrpcDigest(archivePath, release.archive);
        opts.onProgress?.({ phase: 'extracting', url });
        await extractFrpcFromReleaseArchive(archivePath, executablePath, buildFrpcReleaseBasename(platform, arch), nodePlatformForFrpTarget(platform));
        await verifyFrpcDigest(executablePath, release.binary);
        if (platform !== 'windows') chmodSync(executablePath, 0o700);
        renameSync(executablePath, cachePath);
        return cachePath;
      } catch (error) {
        lastError = error;
        log.warn({ url, err: error }, 'Verified frpc download failed');
      }
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  throw new Error(`Failed to obtain verified frpc for ${target}`, { cause: lastError });
}

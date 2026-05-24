import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { resolveBinDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import {
  extractFrpcFromReleaseArchive,
  frpcReleaseArchiveExtension,
  nodePlatformForFrpTarget,
  type FrpcReleasePlatform,
} from './frpc-extract.js';
import type { FrpcDownloadProgress } from './tunnel-types.js';

const log = createLogger('TunnelFrpc');

export const FRPC_VERSION = '0.62.1';

export type { FrpcDownloadProgress };

export type EnsureFrpcBinaryOptions = {
  onProgress?: (progress: FrpcDownloadProgress) => void;
};

const PLATFORM_MAP: Record<string, FrpcReleasePlatform> = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
};

const ARCH_MAP: Record<string, string> = {
  x64: 'amd64',
  arm64: 'arm64',
  ia32: '386',
};

export function buildFrpcReleaseBasename(
  frpPlatform: FrpcReleasePlatform,
  arch: string,
  version = FRPC_VERSION,
): string {
  return `frp_${version}_${frpPlatform}_${arch}`;
}

export function frpcDownloadUrlsForTarget(
  frpPlatform: FrpcReleasePlatform,
  arch: string,
  version = FRPC_VERSION,
): string[] {
  const folder = buildFrpcReleaseBasename(frpPlatform, arch, version);
  const ext = frpcReleaseArchiveExtension(frpPlatform);
  return [
    `https://frp.xopc.ai/bin/${folder}${ext}`,
    `https://github.com/fatedier/frp/releases/download/v${version}/${folder}${ext}`,
    `https://ghfast.top/https://github.com/fatedier/frp/releases/download/v${version}/${folder}${ext}`,
  ];
}

function frpcPlatformArch(): { platform: FrpcReleasePlatform; arch: string; folder: string } {
  const platform = PLATFORM_MAP[process.platform] ?? (process.platform as FrpcReleasePlatform);
  const arch = ARCH_MAP[process.arch] ?? process.arch;
  return { platform, arch, folder: buildFrpcReleaseBasename(platform, arch) };
}

function frpcDownloadUrls(): string[] {
  const { platform, arch } = frpcPlatformArch();
  return frpcDownloadUrlsForTarget(platform, arch);
}

async function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (progress: FrpcDownloadProgress) => void,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${url}`);
  }

  const contentLength = res.headers.get('content-length');
  const totalBytes =
    contentLength && Number.isFinite(Number(contentLength)) ? Number(contentLength) : null;
  let bytesReceived = 0;

  const report = () => {
    onProgress?.({
      phase: 'downloading',
      url,
      bytesReceived,
      totalBytes,
      percent:
        totalBytes && totalBytes > 0
          ? Math.min(100, Math.round((bytesReceived / totalBytes) * 100))
          : null,
    });
  };

  report();

  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  nodeStream.on('data', (chunk: Buffer | string) => {
    bytesReceived += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    report();
  });

  await pipeline(nodeStream, createWriteStream(destPath));
  report();
}

/** Set after a successful tunnel start so subprocesses can resolve the same binary. */
export function publishFrpcPathForProcess(binPath: string): void {
  process.env.XOPC_FRPC_PATH = binPath;
}

/** Clear runtime frpc path when the tunnel stops (no bundled Electron binary). */
export function clearFrpcPathForProcess(): void {
  delete process.env.XOPC_FRPC_PATH;
}

export async function ensureFrpcBinary(opts?: EnsureFrpcBinaryOptions): Promise<string> {
  const onProgress = opts?.onProgress;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binName = `frpc${ext}`;

  const fromEnv = process.env.XOPC_FRPC_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  const cacheDir = resolveBinDir();
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, binName);
  if (existsSync(cachePath)) return cachePath;

  const tmpBase = join(tmpdir(), `xopc-frpc-${randomBytes(6).toString('hex')}`);
  mkdirSync(tmpBase, { recursive: true });
  const { platform, arch, folder } = frpcPlatformArch();
  const archiveExt = frpcReleaseArchiveExtension(platform);
  const archivePath = join(tmpBase, `frpc${archiveExt}`);

  const urls = frpcDownloadUrls();
  let lastErr: unknown;
  try {
    for (const url of urls) {
      try {
        log.info({ url }, 'Downloading frpc');
        await downloadToFile(url, archivePath, onProgress);
        onProgress?.({ phase: 'extracting', url, bytesReceived: 0, totalBytes: null, percent: null });
        await extractFrpcFromReleaseArchive(
          archivePath,
          cachePath,
          folder,
          nodePlatformForFrpTarget(platform),
        );
        if (process.platform !== 'win32') chmodSync(cachePath, 0o755);
        return cachePath;
      } catch (err) {
        lastErr = err;
        log.warn({ url, err }, 'frpc download attempt failed');
      }
    }
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }

  throw new Error(
    `Failed to download frpc v${FRPC_VERSION} for ${platform}/${arch}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

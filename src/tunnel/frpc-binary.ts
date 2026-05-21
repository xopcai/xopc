import { chmodSync, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { resolveBinDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TunnelFrpc');

export const FRPC_VERSION = '0.62.1';

const PLATFORM_MAP: Record<string, string> = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
};

const ARCH_MAP: Record<string, string> = {
  x64: 'amd64',
  arm64: 'arm64',
  ia32: '386',
};

function frpcDownloadUrls(): string[] {
  const platform = PLATFORM_MAP[process.platform] ?? process.platform;
  const arch = ARCH_MAP[process.arch] ?? process.arch;
  const base = `frp_${FRPC_VERSION}_${platform}_${arch}`;
  return [
    `https://github.com/fatedier/frp/releases/download/v${FRPC_VERSION}/${base}.tar.gz`,
    `https://ghfast.top/https://github.com/fatedier/frp/releases/download/v${FRPC_VERSION}/${base}.tar.gz`,
    `https://frp.xopc.ai/bin/${base}.tar.gz`,
  ];
}

async function extractFrpcFromTarGz(archivePath: string, destDir: string, binName: string): Promise<void> {
  const platform = PLATFORM_MAP[process.platform] ?? process.platform;
  const arch = ARCH_MAP[process.arch] ?? process.arch;
  const folder = `frp_${FRPC_VERSION}_${platform}_${arch}`;
  const innerPath = `${folder}/${binName}`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['xzf', archivePath, '-C', destDir, innerPath, '--strip-components=1'], {
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${url}`);
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
}

export async function ensureFrpcBinary(): Promise<string> {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binName = `frpc${ext}`;

  const fromEnv = process.env.XOPC_FRPC_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  if (typeof process.resourcesPath === 'string') {
    const electronPath = join(process.resourcesPath, 'bin', binName);
    if (existsSync(electronPath)) return electronPath;
  }

  const cacheDir = resolveBinDir();
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, binName);
  if (existsSync(cachePath)) return cachePath;

  const tmpBase = join(tmpdir(), `xopc-frpc-${randomBytes(6).toString('hex')}`);
  mkdirSync(tmpBase, { recursive: true });
  const archivePath = join(tmpBase, 'frpc.tar.gz');

  const urls = frpcDownloadUrls();
  let lastErr: unknown;
  for (const url of urls) {
    try {
      log.info({ url }, 'Downloading frpc');
      await downloadToFile(url, archivePath);
      await extractFrpcFromTarGz(archivePath, cacheDir, binName);
      if (process.platform !== 'win32') chmodSync(cachePath, 0o755);
      return cachePath;
    } catch (err) {
      lastErr = err;
      log.warn({ url, err }, 'frpc download attempt failed');
    }
  }

  throw new Error(
    `Failed to download frpc v${FRPC_VERSION} for ${process.platform}/${process.arch}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

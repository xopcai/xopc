import type { RuntimeKind } from './types.js';

export const RUNTIME_CATALOG_VERSION = '2026-08-23';
export const DEFAULT_RUNTIME_VERSIONS: Record<RuntimeKind, string> = {
  node: '22.23.2',
  uv: '0.8.12',
  python: '3.12.11',
};

export type RuntimePlatform =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'win32-x64'
  | 'linux-x64-gnu'
  | 'linux-arm64-gnu';

export interface RuntimeAsset {
  runtime: 'node' | 'uv';
  version: string;
  platform: RuntimePlatform;
  archiveFile: string;
  url: string;
  checksumUrl: string;
  archiveType: 'zip' | 'tar.gz';
}

export function detectRuntimePlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): RuntimePlatform | null {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
  if (platform === 'win32' && arch === 'x64') return 'win32-x64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64-gnu';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64-gnu';
  return null;
}

function nodePlatformSuffix(platform: RuntimePlatform): string {
  const suffixes: Record<RuntimePlatform, string> = {
    'darwin-arm64': 'darwin-arm64',
    'darwin-x64': 'darwin-x64',
    'win32-x64': 'win-x64',
    'linux-x64-gnu': 'linux-x64',
    'linux-arm64-gnu': 'linux-arm64',
  };
  return suffixes[platform];
}

function uvPlatformSuffix(platform: RuntimePlatform): string {
  const suffixes: Record<RuntimePlatform, string> = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'win32-x64': 'x86_64-pc-windows-msvc',
    'linux-x64-gnu': 'x86_64-unknown-linux-gnu',
    'linux-arm64-gnu': 'aarch64-unknown-linux-gnu',
  };
  return suffixes[platform];
}

export function resolveRuntimeAsset(params: {
  runtime: 'node' | 'uv';
  version: string;
  platform: RuntimePlatform;
}): RuntimeAsset {
  if (params.runtime === 'node') {
    const ext = params.platform === 'win32-x64' ? 'zip' : 'tar.gz';
    const archiveFile = `node-v${params.version}-${nodePlatformSuffix(params.platform)}.${ext}`;
    const base = 'https://nodejs.org/download/release';
    const releaseBase = `${base}/v${params.version}`;
    return {
      ...params,
      archiveFile,
      url: `${releaseBase}/${archiveFile}`,
      checksumUrl: `${releaseBase}/SHASUMS256.txt`,
      archiveType: ext,
    };
  }

  const ext = params.platform === 'win32-x64' ? 'zip' : 'tar.gz';
  const archiveFile = `uv-${uvPlatformSuffix(params.platform)}.${ext}`;
  const base = `https://github.com/astral-sh/uv/releases/download/${params.version}`;
  return {
    ...params,
    archiveFile,
    url: `${base}/${archiveFile}`,
    checksumUrl: `${base}/${archiveFile}.sha256`,
    archiveType: ext,
  };
}

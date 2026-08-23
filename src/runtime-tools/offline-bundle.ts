import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { RuntimeError } from './errors.js';
import { sha256File } from './downloader.js';
import type { RuntimeKind } from './types.js';

export type OfflineBundleArtifact = {
  archivePath: string;
  archiveFile: string;
  archiveType: 'zip' | 'tar.gz';
  sha256: string;
};

function parseChecksum(text: string, archiveFile: string): string | null {
  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const match = line.match(/^([a-fA-F0-9]{64})(?:\s+[*]?(.+))?$/);
    if (match && (!match[2] || match[2] === archiveFile)) return match[1]!.toLowerCase();
  }
  return null;
}

export function bundledPythonArchiveName(params: {
  version: string;
  platform: string;
}): string {
  const extension = params.platform.startsWith('win32-') ? 'zip' : 'tar.gz';
  return `python-${params.version}-${params.platform}.${extension}`;
}

export async function resolveOfflineBundleArtifact(params: {
  bundleDir: string;
  runtime: RuntimeKind;
  archiveFile: string;
}): Promise<OfflineBundleArtifact> {
  if (!isAbsolute(params.bundleDir)) {
    throw new RuntimeError(
      'runtimeTools.download.bundleDir must be an absolute path',
      'RUNTIME_ARCHIVE_INVALID',
      params.runtime,
      'offline_bundle',
      false,
    );
  }
  const archivePath = join(params.bundleDir, params.archiveFile);
  try {
    await access(archivePath);
  } catch {
    throw new RuntimeError(
      `Offline bundle is missing ${params.archiveFile}`,
      'RUNTIME_NOT_FOUND',
      params.runtime,
      'offline_bundle',
      true,
    );
  }

  const checksumFiles = [
    `${archivePath}.sha256`,
    join(params.bundleDir, 'SHASUMS256.txt'),
  ];
  let expected: string | null = null;
  for (const checksumPath of checksumFiles) {
    try {
      expected = parseChecksum(await readFile(checksumPath, 'utf8'), params.archiveFile);
      if (expected) break;
    } catch {
      // Try the next supported checksum file.
    }
  }
  if (!expected) {
    throw new RuntimeError(
      `Offline bundle has no checksum for ${params.archiveFile}`,
      'RUNTIME_CHECKSUM_MISMATCH',
      params.runtime,
      'offline_bundle',
      false,
    );
  }
  const actual = await sha256File(archivePath);
  if (actual !== expected) {
    throw new RuntimeError(
      `Offline bundle checksum mismatch for ${params.archiveFile}`,
      'RUNTIME_CHECKSUM_MISMATCH',
      params.runtime,
      'offline_bundle',
      true,
    );
  }
  return {
    archivePath,
    archiveFile: params.archiveFile,
    archiveType: params.archiveFile.endsWith('.zip') ? 'zip' : 'tar.gz',
    sha256: expected,
  };
}

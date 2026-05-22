import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { createLogger } from '../utils/logger.js';

const log = createLogger('TunnelFrpcExtract');

export function buildFrpcArchiveMemberPath(folder: string, platform: NodeJS.Platform): string {
  const ext = platform === 'win32' ? '.exe' : '';
  return `${folder}/frpc${ext}`.replace(/\\/g, '/');
}

/** Resolve on-disk path after system tar extracts a POSIX member path. */
export function resolveExtractedMemberPath(extractDir: string, memberPath: string): string {
  return join(extractDir, ...memberPath.replace(/\\/g, '/').split('/'));
}

function readTarField(header: Buffer, offset: number, length: number): string {
  return header.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/, '').trim();
}

function parseTarEntryName(header: Buffer): string {
  let name = readTarField(header, 0, 100);
  const prefix = readTarField(header, 345, 155);
  if (prefix) name = `${prefix}/${name}`;
  return name.replace(/\\/g, '/').replace(/^\.\//, '');
}

function parseTarSize(header: Buffer): number {
  const raw = readTarField(header, 124, 12);
  if (!raw) return 0;
  return parseInt(raw, 8) || 0;
}

/** Pure Node tar.gz member extract — no system `tar` (Windows / minimal Linux). */
export function extractTarGzMemberNode(
  archivePath: string,
  memberPath: string,
  destPath: string,
): void {
  const target = memberPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const tar = gunzipSync(readFileSync(archivePath));

  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    const name = parseTarEntryName(header);
    const size = parseTarSize(header);
    offset += 512;

    if (size < 0 || offset + size > tar.length) {
      throw new Error('Corrupt tar archive');
    }

    const content = tar.subarray(offset, offset + size);
    offset += size;
    offset += (512 - (size % 512)) % 512;

    if (name === target) {
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, content);
      return;
    }
  }

  throw new Error(`Archive missing expected path: ${target}`);
}

async function extractTarGzMemberSystemTar(
  archivePath: string,
  memberPath: string,
  destPath: string,
  extractDir: string,
): Promise<void> {
  mkdirSync(extractDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    let stderr = '';
    const child = spawn('tar', ['xzf', archivePath, '-C', extractDir, memberPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else {
        const detail = stderr.trim();
        reject(
          new Error(`tar exited with code ${code ?? 'unknown'}${detail ? `: ${detail}` : ''}`),
        );
      }
    });
  });

  const extracted = resolveExtractedMemberPath(extractDir, memberPath);
  if (!existsSync(extracted)) {
    throw new Error(`Archive missing expected path: ${memberPath}`);
  }

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, readFileSync(extracted));
}

/**
 * Extract frpc from a release tarball.
 * Tries system `tar` first; falls back to built-in Node parser (macOS BSD tar quirks, Windows without tar, etc.).
 */
export async function extractFrpcFromTarGzArchive(
  archivePath: string,
  destBin: string,
  folder: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const memberPath = buildFrpcArchiveMemberPath(folder, platform);
  const extractDir = join(dirname(destBin), `_frpc-extract-${process.pid}-${Date.now()}`);
  let systemErr: unknown;

  try {
    await extractTarGzMemberSystemTar(archivePath, memberPath, destBin, extractDir);
    log.debug({ memberPath, method: 'system-tar' }, 'Extracted frpc from archive');
    return;
  } catch (err) {
    systemErr = err;
    log.debug(
      { err, memberPath, phase: 'frpc_extract_system_tar' },
      'System tar extract failed — trying Node fallback',
    );
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }

  try {
    extractTarGzMemberNode(archivePath, memberPath, destBin);
    log.debug({ memberPath, method: 'node-tar' }, 'Extracted frpc from archive');
  } catch (nodeErr) {
    const systemEm = systemErr instanceof Error ? systemErr.message : String(systemErr);
    const nodeEm = nodeErr instanceof Error ? nodeErr.message : String(nodeErr);
    throw new Error(`Failed to extract ${memberPath}: ${nodeEm} (system tar: ${systemEm})`);
  }
}

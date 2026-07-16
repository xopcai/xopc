import { createRequire } from 'node:module';
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { resolveStateDir } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';

const require = createRequire(import.meta.url);
const log = createLogger('CodeIntelligenceBinary');

const CBM_VERSION = '0.9.0';
const DOWNLOAD_TIMEOUT_MS = 2 * 60_000;
const RELEASE_BASE_URL = `https://github.com/DeusData/codebase-memory-mcp/releases/download/v${CBM_VERSION}`;
const execFileAsync = promisify(execFile);

type FetchImplementation = typeof fetch;

export interface DownloadCodebaseMemoryBinaryOptions {
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
}

function binaryName(): string {
  return process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
}

function platformName(): string {
  switch (process.platform) {
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      throw new Error(`Code intelligence is not supported on ${process.platform}`);
  }
}

function architectureName(): string {
  switch (process.arch) {
    case 'arm64':
      return 'arm64';
    case 'x64':
      return 'amd64';
    default:
      throw new Error(`Code intelligence is not supported on ${process.arch}`);
  }
}

function releaseUrl(): string {
  return `${RELEASE_BASE_URL}/${archiveName()}`;
}

function archiveName(): string {
  const platform = platformName();
  const extension = platform === 'windows' ? 'zip' : 'tar.gz';
  const linuxPortable = platform === 'linux' ? '-portable' : '';
  return `codebase-memory-mcp-${platform}-${architectureName()}${linuxPortable}.${extension}`;
}

function archiveExtension(): 'zip' | 'tar.gz' {
  return platformName() === 'windows' ? 'zip' : 'tar.gz';
}

function expectedSha256(checksums: string, filename: string): string {
  for (const line of checksums.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match?.[2] === filename) return match[1].toLowerCase();
  }
  throw new Error(`checksums.txt does not contain ${filename}`);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const input = createReadStream(path);
    input.on('data', (chunk: Buffer) => hash.update(chunk));
    input.once('error', reject);
    input.once('end', resolvePromise);
  });
  return hash.digest('hex');
}

function managedBinaryPath(stateDir = resolveStateDir()): string {
  return join(
    stateDir,
    'code-intelligence',
    'bin',
    `v${CBM_VERSION}`,
    `${platformName()}-${architectureName()}`,
    binaryName(),
  );
}

function isUsableBinary(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function packageBinaryPath(): string | undefined {
  try {
    const packageJson = require.resolve('codebase-memory-mcp/package.json');
    return join(dirname(packageJson), 'bin', binaryName());
  } catch {
    return undefined;
  }
}

export function resolveCodebaseMemoryBinary(explicitPath?: string): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    explicitPath,
    process.env.XOPC_CBM_BINARY,
    resourcesPath ? join(resourcesPath, 'bin', binaryName()) : undefined,
    packageBinaryPath(),
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const candidate of candidates) {
    const absolute = resolve(candidate);
    if (isUsableBinary(absolute)) {
      return realpathSync(absolute);
    }
  }

  throw new Error(
    `codebase-memory-mcp binary is unavailable; checked ${candidates.join(', ') || 'no candidate paths'}`,
  );
}

/** Download the CBM executable into its final path atomically. */
export async function downloadCodebaseMemoryBinary(
  destination: string,
  options: DownloadCodebaseMemoryBinaryOptions = {},
): Promise<string> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  const temporaryPath = `${destination}.${process.pid}.part`;
  const abortController = new AbortController();
  const tempDir = mkdtempSync(join(tmpdir(), 'xopc-cbm-'));
  const archivePath = join(tempDir, `cbm.${archiveExtension()}`);
  let timedOut = false;
  let rejectTimeout: ((error: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
    rejectTimeout?.(new Error(`download timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    mkdirSync(dirname(destination), { recursive: true });
    rmSync(temporaryPath, { force: true });
    await Promise.race([
      (async () => {
        const checksumsResponse = await fetchImplementation(`${RELEASE_BASE_URL}/checksums.txt`, {
          redirect: 'follow',
          signal: abortController.signal,
        });
        if (!checksumsResponse.ok) {
          throw new Error(`GitHub Releases returned HTTP ${checksumsResponse.status} for checksums.txt`);
        }
        const expectedChecksum = expectedSha256(await checksumsResponse.text(), archiveName());
        const response = await fetchImplementation(releaseUrl(), {
          redirect: 'follow',
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`GitHub Releases returned HTTP ${response.status}`);
        }
        if (!response.body) {
          throw new Error('GitHub Releases returned an empty response body');
        }

        await pipeline(
          Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
          createWriteStream(archivePath, { mode: 0o600 }),
        );
        const actualChecksum = await sha256(archivePath);
        if (actualChecksum !== expectedChecksum) {
          throw new Error(
            `checksum mismatch for ${archiveName()}: expected ${expectedChecksum}, got ${actualChecksum}`,
          );
        }
        if (archiveExtension() === 'tar.gz') {
          await execFileAsync('tar', ['-xzf', archivePath, '-C', tempDir, '--no-same-owner']);
        } else {
          await execFileAsync('powershell', [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path '${archivePath}' -DestinationPath '${tempDir}' -Force`,
          ]);
        }

        const extracted = join(tempDir, binaryName());
        if (!isUsableBinary(extracted)) {
          throw new Error(`binary was not present after extracting ${archiveExtension()} archive`);
        }
        copyFileSync(extracted, temporaryPath);
      })(),
      timeoutPromise,
    ]);
    if (timedOut) throw new Error(`download timed out after ${timeoutMs}ms`);
    if (process.platform !== 'win32') chmodSync(temporaryPath, 0o755);
    renameSync(temporaryPath, destination);
    return realpathSync(destination);
  } catch (error) {
    const reason = timedOut
      ? `download timed out after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    throw new Error(
      `Unable to download codebase-memory-mcp from GitHub Releases: ${reason}. ` +
      'Check network access or set XOPC_CBM_BINARY to a trusted executable.',
    );
  } finally {
    clearTimeout(timer);
    rmSync(temporaryPath, { force: true });
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Resolve a bundled or explicit binary first, then lazily download one for npm installs.
 * This deliberately keeps large GitHub Release downloads out of npm lifecycle scripts.
 */
export async function ensureCodebaseMemoryBinary(explicitPath?: string): Promise<string> {
  try {
    return resolveCodebaseMemoryBinary(explicitPath);
  } catch {
    const destination = managedBinaryPath();
    if (isUsableBinary(destination)) return realpathSync(destination);

    log.info(
      { destination, version: CBM_VERSION, timeoutMs: DOWNLOAD_TIMEOUT_MS },
      'Downloading code intelligence binary on demand',
    );
    return downloadCodebaseMemoryBinary(destination);
  }
}

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
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
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import lockfile from 'proper-lockfile';

import { resolveBinDir, resolveStateDir } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';

const require = createRequire(import.meta.url);
const log = createLogger('CodeIntelligenceBinary');

const CBM_VERSION = '0.9.0';
const CACHE_SCHEMA_VERSION = 1;
const DOWNLOAD_TIMEOUT_MS = 2 * 60_000;
const RELEASE_BASE_URL = `https://github.com/DeusData/codebase-memory-mcp/releases/download/v${CBM_VERSION}`;
const execFileAsync = promisify(execFile);

type FetchImplementation = typeof fetch;
type ManagedBinarySource = 'github-release' | 'electron-bundle' | 'package-bundle' | 'legacy-cache';

interface ManagedBinaryManifest {
  schemaVersion: number;
  component: 'codebase-memory-mcp';
  cbmVersion: string;
  platform: string;
  arch: string;
  binaryName: string;
  binarySha256: string;
  binarySize: number;
  source: ManagedBinarySource;
  installedAt: string;
}

interface BundledBinaryManifest {
  cbmVersion: string;
  platform: string;
  arch: string;
  binarySha256: string;
}

interface BinarySourceCandidate {
  path: string;
  source: Exclude<ManagedBinarySource, 'github-release'>;
  manifestPath?: string;
}

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

function platformKey(): string {
  return `${platformName()}-${architectureName()}`;
}

function archiveName(): string {
  const platform = platformName();
  const extension = platform === 'windows' ? 'zip' : 'tar.gz';
  const linuxPortable = platform === 'linux' ? '-portable' : '';
  return `codebase-memory-mcp-${platform}-${architectureName()}${linuxPortable}.${extension}`;
}

function releaseUrl(): string {
  return `${RELEASE_BASE_URL}/${archiveName()}`;
}

function archiveExtension(): 'zip' | 'tar.gz' {
  return platformName() === 'windows' ? 'zip' : 'tar.gz';
}

function cacheVersionRoot(): string {
  return join(resolveBinDir(), 'codebase-memory-mcp', `v${CBM_VERSION}`);
}

function cacheDir(): string {
  return join(cacheVersionRoot(), platformKey());
}

function cacheBinaryPath(): string {
  return join(cacheDir(), binaryName());
}

function cacheManifestPath(dir = cacheDir()): string {
  return join(dir, 'manifest.json');
}

function legacyManagedBinaryPath(): string {
  return join(
    resolveStateDir(),
    'code-intelligence',
    'bin',
    `v${CBM_VERSION}`,
    platformKey(),
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

function readManagedManifest(dir = cacheDir()): ManagedBinaryManifest | undefined {
  try {
    const parsed = JSON.parse(readFileSync(cacheManifestPath(dir), 'utf8')) as Partial<ManagedBinaryManifest>;
    if (
      parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
      parsed.component !== 'codebase-memory-mcp' ||
      parsed.cbmVersion !== CBM_VERSION ||
      parsed.platform !== platformName() ||
      parsed.arch !== architectureName() ||
      parsed.binaryName !== binaryName() ||
      typeof parsed.binarySha256 !== 'string' ||
      typeof parsed.binarySize !== 'number'
    ) {
      return undefined;
    }
    return parsed as ManagedBinaryManifest;
  } catch {
    return undefined;
  }
}

function resolveSharedCachedBinary(): string | undefined {
  const binary = cacheBinaryPath();
  const manifest = readManagedManifest();
  if (!manifest || !isUsableBinary(binary)) return undefined;
  try {
    return statSync(binary).size === manifest.binarySize ? realpathSync(binary) : undefined;
  } catch {
    return undefined;
  }
}

async function verifySharedCachedBinary(): Promise<string | undefined> {
  const binary = resolveSharedCachedBinary();
  const manifest = readManagedManifest();
  if (!binary || !manifest) return undefined;
  try {
    return (await sha256(binary)) === manifest.binarySha256 ? binary : undefined;
  } catch {
    return undefined;
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

function overrideBinaryPath(explicitPath?: string): string | undefined {
  for (const candidate of [explicitPath, process.env.XOPC_CBM_BINARY]) {
    if (!candidate?.trim()) continue;
    const absolute = resolve(candidate);
    if (isUsableBinary(absolute)) return realpathSync(absolute);
  }
  return undefined;
}

function bundledBinaryCandidates(): BinarySourceCandidate[] {
  const bundledPath = process.env.XOPC_CBM_BUNDLED_PATH?.trim();
  const bundledManifestPath = process.env.XOPC_CBM_BUNDLED_MANIFEST_PATH?.trim();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const resourcePath = resourcesPath ? join(resourcesPath, 'bin', binaryName()) : undefined;
  const packagePath = packageBinaryPath();
  const candidates: BinarySourceCandidate[] = [];

  if (bundledPath) {
    candidates.push({
      path: bundledPath,
      source: 'electron-bundle',
      manifestPath: bundledManifestPath || join(dirname(bundledPath), 'codebase-memory-mcp.manifest.json'),
    });
  }
  if (resourcePath && resourcePath !== bundledPath) {
    candidates.push({
      path: resourcePath,
      source: 'electron-bundle',
      manifestPath: join(dirname(resourcePath), 'codebase-memory-mcp.manifest.json'),
    });
  }
  if (packagePath) candidates.push({ path: packagePath, source: 'package-bundle' });
  candidates.push({ path: legacyManagedBinaryPath(), source: 'legacy-cache' });
  return candidates;
}

async function verifyBundledSource(candidate: BinarySourceCandidate): Promise<void> {
  if (!isUsableBinary(candidate.path)) {
    throw new Error(`source binary is unavailable at ${candidate.path}`);
  }
  if (candidate.source !== 'electron-bundle') return;
  if (!candidate.manifestPath) throw new Error('Electron CBM manifest path is missing');

  let manifest: BundledBinaryManifest;
  try {
    manifest = JSON.parse(readFileSync(candidate.manifestPath, 'utf8')) as BundledBinaryManifest;
  } catch (error) {
    throw new Error(
      `Electron CBM manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    manifest.cbmVersion !== CBM_VERSION ||
    manifest.platform !== platformName() ||
    manifest.arch !== architectureName() ||
    !/^[a-f0-9]{64}$/i.test(manifest.binarySha256)
  ) {
    throw new Error('Electron CBM manifest does not match this runtime');
  }
  const actual = await sha256(candidate.path);
  if (actual !== manifest.binarySha256.toLowerCase()) {
    throw new Error(`Electron CBM checksum mismatch: expected ${manifest.binarySha256}, got ${actual}`);
  }
}

async function withCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  const versionRoot = cacheVersionRoot();
  mkdirSync(versionRoot, { recursive: true });
  const release = await lockfile.lock(versionRoot, {
    realpath: false,
    lockfilePath: join(versionRoot, `.${platformKey()}.install.lock`),
    stale: 10 * 60_000,
    retries: { retries: 30, factor: 1.2, minTimeout: 100, maxTimeout: 1_000 },
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

function cleanupStaleStaging(versionRoot: string): void {
  const prefix = `.${platformKey()}.staging-`;
  const cutoff = Date.now() - 60 * 60_000;
  try {
    for (const entry of readdirSync(versionRoot)) {
      if (!entry.startsWith(prefix)) continue;
      const path = join(versionRoot, entry);
      if (statSync(path).mtimeMs < cutoff) rmSync(path, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup; installation remains safe under the cache lock.
  }
}

async function installInSharedCache(
  source: ManagedBinarySource,
  populate: (destination: string) => Promise<void>,
): Promise<string> {
  const versionRoot = cacheVersionRoot();
  const targetDir = cacheDir();
  const stagingDir = join(versionRoot, `.${platformKey()}.staging-${process.pid}-${randomBytes(6).toString('hex')}`);
  const stagingBinary = join(stagingDir, binaryName());
  mkdirSync(stagingDir, { recursive: true });

  try {
    await populate(stagingBinary);
    if (!isUsableBinary(stagingBinary)) {
      throw new Error('staged codebase-memory-mcp binary is not executable');
    }
    if (process.platform !== 'win32') chmodSync(stagingBinary, 0o755);
    const binarySha256 = await sha256(stagingBinary);
    const manifest: ManagedBinaryManifest = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      component: 'codebase-memory-mcp',
      cbmVersion: CBM_VERSION,
      platform: platformName(),
      arch: architectureName(),
      binaryName: binaryName(),
      binarySha256,
      binarySize: statSync(stagingBinary).size,
      source,
      installedAt: new Date().toISOString(),
    };
    writeFileSync(cacheManifestPath(stagingDir), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    rmSync(targetDir, { recursive: true, force: true });
    renameSync(stagingDir, targetDir);
    return realpathSync(cacheBinaryPath());
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

/** Resolve an explicit, shared, or bundled binary synchronously when already present. */
export function resolveCodebaseMemoryBinary(explicitPath?: string): string {
  const overridden = overrideBinaryPath(explicitPath);
  if (overridden) return overridden;

  const shared = resolveSharedCachedBinary();
  if (shared) return shared;

  for (const candidate of bundledBinaryCandidates()) {
    const absolute = resolve(candidate.path);
    if (isUsableBinary(absolute)) return realpathSync(absolute);
  }

  throw new Error('codebase-memory-mcp binary is unavailable');
}

/** Download and checksum-verify the CBM executable into a caller-provided path. */
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
        if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`);
        if (!response.body) throw new Error('GitHub Releases returned an empty response body');

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
 * Resolve a shared, versioned user cache. Electron seeds it from its bundled binary;
 * CLI seeds it from a verified release download. This keeps both surfaces on one binary.
 */
export async function ensureCodebaseMemoryBinary(explicitPath?: string): Promise<string> {
  const overridden = overrideBinaryPath(explicitPath);
  if (overridden) return overridden;

  const cached = await verifySharedCachedBinary();
  if (cached) return cached;

  return withCacheLock(async () => {
    cleanupStaleStaging(cacheVersionRoot());
    const afterLock = await verifySharedCachedBinary();
    if (afterLock) return afterLock;

    for (const candidate of bundledBinaryCandidates()) {
      try {
        await verifyBundledSource(candidate);
        return await installInSharedCache(candidate.source, async (destination) => {
          copyFileSync(candidate.path, destination);
        });
      } catch (error) {
        log.warn(
          { err: error, source: candidate.source, path: candidate.path },
          'Code intelligence binary source was not usable',
        );
      }
    }

    log.info(
      { destination: cacheBinaryPath(), version: CBM_VERSION, timeoutMs: DOWNLOAD_TIMEOUT_MS },
      'Downloading code intelligence binary into shared cache',
    );
    return installInSharedCache('github-release', async (destination) => {
      await downloadCodebaseMemoryBinary(destination);
    });
  });
}

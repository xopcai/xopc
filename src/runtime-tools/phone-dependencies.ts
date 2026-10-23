import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import type { RuntimeToolsConfig } from '../config/schema.js';
import { resolveAdbPath } from '../phone/adb-driver.js';
import { extractRuntimeArchive } from './archive.js';
import { runRuntimeCommand } from './command.js';
import { downloadVerifiedArchive, sha256File } from './downloader.js';
import { RuntimeError } from './errors.js';
import { withInstallLock } from './install-lock.js';
import { ADB_VERSION, managedPhoneAdbDir, managedPhoneAdbPath, managedScrcpyServerPath, phoneDependencyAsset, SCRCPY_SHA256, SCRCPY_VERSION, type PhoneDependencyKind } from './phone-dependency-catalog.js';
import { runtimeDownloadPath } from './paths.js';

export type PhoneDependencyStatus = {
  kind: PhoneDependencyKind; state: 'ready' | 'absent' | 'corrupted' | 'unsupported' | 'installing';
  version?: string; requestedVersion: string; path?: string; source?: 'managed' | 'system' | 'custom';
  canInstall: boolean; error?: string;
};
export type PhoneDependencyProgress = { kind: PhoneDependencyKind; phase: 'download' | 'verify' | 'extract' | 'install' | 'probe' | 'complete'; downloadedBytes?: number; totalBytes?: number };
const operations = new Set<string>();

export async function probePhoneAdb(path: string): Promise<{ path: string; version: string }> {
  const result = await runRuntimeCommand({ command: path, args: ['version'] });
  const version = /^Version\s+(\d+\.\d+\.\d+)/m.exec(result.stdout)?.[1];
  if (!result.ok || !/^Android Debug Bridge version 1\./m.test(result.stdout) || !version || Number(version.split('.')[0]) < 31)
    throw new RuntimeError('A compatible Android ADB executable (Platform Tools 31 or newer) was not found', 'RUNTIME_PROBE_FAILED', 'adb', 'probe', true);
  return { path, version };
}

export class PhoneDependencyManager extends EventEmitter {
  constructor(private options: { stateDir: string; config: RuntimeToolsConfig; adbPath?: string }) { super(); }
  private operationKey(kind: PhoneDependencyKind) { return `${this.options.stateDir}:${kind}`; }
  async status(): Promise<PhoneDependencyStatus[]> {
    return Promise.all((['adb', 'scrcpy'] as const).map(async (kind): Promise<PhoneDependencyStatus> => {
      const canInstall = this.options.config.enabled && Boolean(phoneDependencyAsset(kind));
      const requestedVersion = kind === 'adb' ? ADB_VERSION : SCRCPY_VERSION;
      if (operations.has(this.operationKey(kind))) return { kind, state: 'installing', requestedVersion, canInstall };
      const path = kind === 'adb' ? resolveAdbPath(this.options.adbPath, this.options.stateDir) : managedScrcpyServerPath(this.options.stateDir);
      try {
        const version = kind === 'adb' ? (await probePhoneAdb(path)).version : (await this.verifyServer(path), SCRCPY_VERSION);
        return { kind, state: 'ready', requestedVersion, version, path, canInstall,
          source: kind === 'scrcpy' || path === managedPhoneAdbPath(this.options.stateDir) ? 'managed' : this.options.adbPath ? 'custom' : 'system' };
      } catch (error) {
        const exists = await stat(path).then(() => true, () => false);
        return { kind, state: exists || this.options.adbPath && kind === 'adb' ? 'corrupted' : !canInstall && !phoneDependencyAsset(kind) ? 'unsupported' : 'absent',
          requestedVersion, path: exists || kind === 'adb' && Boolean(this.options.adbPath) ? path : undefined, canInstall,
          error: error instanceof RuntimeError ? error.code : 'RUNTIME_NOT_FOUND' };
      }
    }));
  }
  private progress(kind: PhoneDependencyKind, phase: PhoneDependencyProgress['phase'], bytes?: { downloadedBytes: number; totalBytes?: number }) {
    this.emit('progress', { kind, phase, ...bytes } satisfies PhoneDependencyProgress);
  }
  private async verifyServer(path: string): Promise<void> {
    const info = await stat(path);
    if (!info.isFile() || info.size > 10 * 1024 * 1024 || await sha256File(path) !== SCRCPY_SHA256)
      throw new RuntimeError(`scrcpy server must match the pinned ${SCRCPY_VERSION} checksum`, 'RUNTIME_CHECKSUM_MISMATCH', 'scrcpy', 'verify', true);
  }
  /** Installation is explicit; readiness checks and phone viewing never provision tools. */
  async install(kind: PhoneDependencyKind, options: { repair?: boolean; sourcePath?: string } = {}): Promise<void> {
    const asset = phoneDependencyAsset(kind);
    if (!this.options.config.enabled) throw new RuntimeError('Managed runtime installation is disabled', 'RUNTIME_DISABLED', kind, 'install', false);
    if (!asset) throw new RuntimeError('Managed ADB is unavailable on this platform. Configure an existing compatible ADB executable.', 'RUNTIME_UNSUPPORTED', kind, 'install', false);
    if (options.sourcePath && (kind !== 'scrcpy' || !isAbsolute(options.sourcePath))) throw new Error('Select an absolute scrcpy server path on the Gateway host');
    const key = this.operationKey(kind);
    if (operations.has(key)) throw new Error('This dependency is already being installed');
    operations.add(key);
    try {
      await withInstallLock(join(this.options.stateDir, 'tools', 'locks', `phone-${kind}.lock`), { kind }, async () => {
        if (!options.repair && !options.sourcePath) {
          if (kind === 'scrcpy' && await this.verifyServer(managedScrcpyServerPath(this.options.stateDir)).then(() => true, () => false)) return;
          if (kind === 'adb' && await probePhoneAdb(managedPhoneAdbPath(this.options.stateDir)).then(() => true, () => false)) return;
        }
        let source: string;
        if (options.sourcePath) {
          await this.verifyServer(options.sourcePath); source = options.sourcePath;
        } else if (this.options.config.download.bundleDir) {
          if (!isAbsolute(this.options.config.download.bundleDir)) throw new Error('Offline package directory must be an absolute path on the Gateway host');
          source = join(this.options.config.download.bundleDir, asset.filename);
          this.progress(kind, 'verify');
          if (await sha256File(source) !== asset.sha256) throw new RuntimeError('Offline package does not match the pinned official checksum', 'RUNTIME_CHECKSUM_MISMATCH', kind, 'verify', true);
        } else {
          if (this.options.config.download.source === 'website-only') throw new Error('Phone dependencies require official downloads or a configured offline package directory. Select Auto or Direct in runtime download settings.');
          this.progress(kind, 'download');
          source = await downloadVerifiedArchive({ runtime: kind, url: asset.url, expectedSha256: asset.sha256,
            targetPath: runtimeDownloadPath(this.options.stateDir, asset.filename), timeoutMs: this.options.config.download.timeoutMs,
            proxy: this.options.config.download.proxy,
            onProgress: (downloadedBytes, totalBytes) => this.progress(kind, 'download', { downloadedBytes, totalBytes }) });
        }
        this.progress(kind, 'verify');
        if (await sha256File(source) !== asset.sha256) throw new RuntimeError('Dependency checksum mismatch', 'RUNTIME_CHECKSUM_MISMATCH', kind, 'verify', true);
        if (kind === 'scrcpy') {
          const target = managedScrcpyServerPath(this.options.stateDir); const temporary = `${target}.${randomUUID()}.tmp`;
          await mkdir(dirname(target), { recursive: true });
          try { await copyFile(source, temporary); await chmod(temporary, 0o600); await this.verifyServer(temporary); this.progress(kind, 'install'); await rename(temporary, target); }
          finally { await rm(temporary, { force: true }); }
        } else {
          const stagingDir = join(this.options.stateDir, 'tools', 'staging', `phone-adb-${randomUUID()}`);
          const target = managedPhoneAdbDir(this.options.stateDir); const backup = `${target}.${randomUUID()}.backup`;
          let backedUp = false;
          try {
            this.progress(kind, 'extract');
            const root = await extractRuntimeArchive({ runtime: kind, archivePath: source, archiveType: 'zip', stagingDir });
            const executable = join(root, process.platform === 'win32' ? 'adb.exe' : 'adb');
            if (process.platform !== 'win32') await chmod(executable, 0o755);
            this.progress(kind, 'probe');
            if ((await probePhoneAdb(executable)).version !== ADB_VERSION) throw new Error('ADB package version does not match the catalog');
            await mkdir(dirname(target), { recursive: true });
            try { await rename(target, backup); backedUp = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            this.progress(kind, 'install');
            try { await rename(root, target); } catch (error) { if (backedUp) { await rename(backup, target); backedUp = false; } throw error; }
          } finally { await rm(stagingDir, { recursive: true, force: true }); if (backedUp) await rm(backup, { recursive: true, force: true }); }
        }
      });
      this.progress(kind, 'complete');
    } finally { operations.delete(key); }
  }
}

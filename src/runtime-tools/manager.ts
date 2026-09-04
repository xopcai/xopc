import { EventEmitter } from 'node:events';
import { access, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createLogger } from '../utils/logger.js';
import { applyPathPrepend } from '../infra/path-prepend.js';
import { atomicInstallRuntime, extractRuntimeArchive } from './archive.js';
import { runRuntimeCommand, type RuntimeCommandResult } from './command.js';
import {
  DEFAULT_RUNTIME_VERSIONS,
  detectRuntimePlatform,
  resolveRuntimeAsset,
  RUNTIME_CATALOG_VERSION,
} from './catalog.js';
import { canFallbackRuntimeDownload, downloadVerifiedArchive } from './downloader.js';
import {
  canFallbackPythonInstall,
  resolveRuntimeDownloadSource,
  runtimeGatewayPythonMirror,
} from './download-source.js';
import { RuntimeError } from './errors.js';
import { withInstallLock } from './install-lock.js';
import { readRuntimeManifests, writeRuntimeManifest } from './manifest-store.js';
import {
  bundledPythonArchiveName,
  resolveOfflineBundleArtifact,
} from './offline-bundle.js';
import {
  runtimeDownloadPath,
  runtimeLockPath,
  runtimeStagingDir,
  runtimeToolsRoot,
  runtimeVersionDir,
} from './paths.js';
import {
  normalizeRuntimeVersionRequest,
  parseRuntimeVersion,
  probeSystemRuntime,
  resolveInstallVersion,
  versionSatisfies,
} from './probe.js';
import type {
  InstalledRuntimeManifest,
  ResolvedRuntime,
  RuntimeExecutables,
  RuntimeKind,
  RuntimeManagerOptions,
  RuntimeProgressEvent,
  RuntimeRequest,
  RuntimeStatus,
} from './types.js';

const log = createLogger('RuntimeManager');

function executableName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function nodeExecutables(installDir: string): RuntimeExecutables {
  if (process.platform === 'win32') {
    return {
      primary: join(installDir, 'node.exe'),
      node: join(installDir, 'node.exe'),
      npm: join(installDir, 'npm.cmd'),
      npx: join(installDir, 'npx.cmd'),
      corepack: join(installDir, 'corepack.cmd'),
    };
  }
  const bin = join(installDir, 'bin');
  return {
    primary: join(bin, 'node'),
    node: join(bin, 'node'),
    npm: join(bin, 'npm'),
    npx: join(bin, 'npx'),
    corepack: join(bin, 'corepack'),
  };
}

function uvExecutables(installDir: string): RuntimeExecutables {
  const uv = join(installDir, executableName('uv'));
  const uvx = join(installDir, executableName('uvx'));
  return { primary: uv, uv, uvx };
}

function isPathWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`);
}

async function validateManagedExecutables(
  installDir: string,
  executables: RuntimeExecutables,
): Promise<boolean> {
  for (const executable of Object.values(executables)) {
    if (!executable) continue;
    const executablePath = await realpath(executable);
    if (!isPathWithin(installDir, executablePath)) return false;
  }
  return true;
}

function managedNodeProbeEnvironment(executables: RuntimeExecutables): NodeJS.ProcessEnv {
  const env = { ...process.env };
  applyPathPrepend(
    env as Record<string, string>,
    [dirname(executables.node ?? executables.primary)],
  );
  return env;
}

async function probeNodePackageManagers(executables: RuntimeExecutables) {
  if (!executables.npm || !executables.npx) return null;
  const env = managedNodeProbeEnvironment(executables);
  const [npm, npx] = await Promise.all([
    runRuntimeCommand({ command: executables.npm, args: ['--version'], env }),
    runRuntimeCommand({ command: executables.npx, args: ['--version'], env }),
  ]);
  return { npm, npx };
}

function packageManagerProbeFailure(
  name: 'npm' | 'npx',
  result: RuntimeCommandResult,
): string | null {
  if (result.ok) return null;
  const output = result.stderr || result.stdout;
  if (output) return `${name}: ${output}`;
  if (result.timedOut) return `${name}: timed out`;
  if (result.aborted) return `${name}: aborted`;
  return `${name}: exited with code ${result.exitCode ?? 'unknown'}`;
}

function packageManagerProbeFailureMessage(
  results: Awaited<ReturnType<typeof probeNodePackageManagers>>,
): string {
  if (!results) return 'npm or npx executable is missing';
  return ([
    packageManagerProbeFailure('npm', results.npm),
    packageManagerProbeFailure('npx', results.npx),
  ].filter((message): message is string => message !== null)).join('; ');
}

function runtimeConfig(options: RuntimeManagerOptions, runtime: RuntimeKind) {
  if (runtime === 'node') return options.config.node;
  if (runtime === 'python') return options.config.python;
  return {
    enabled: options.config.uv.enabled,
    version: options.config.uv.version,
    preference: 'managed-only' as const,
    provision: 'eager' as const,
  };
}

export class ManagedRuntimeManager extends EventEmitter {
  private readonly inFlight = new Map<string, Promise<ResolvedRuntime>>();

  constructor(private readonly options: RuntimeManagerOptions) {
    super();
  }

  defaultVersion(runtime: RuntimeKind): string {
    return runtimeConfig(this.options, runtime).version ?? DEFAULT_RUNTIME_VERSIONS[runtime];
  }

  async resolve(request: RuntimeRequest): Promise<ResolvedRuntime> {
    const config = runtimeConfig(this.options, request.runtime);
    const rawVersion = request.version ?? this.defaultVersion(request.runtime);
    const requestedVersion = normalizeRuntimeVersionRequest(rawVersion);
    if (!requestedVersion) {
      throw new RuntimeError(
        `Invalid ${request.runtime} runtime version: ${rawVersion}`,
        'RUNTIME_VERSION_MISMATCH',
        request.runtime,
        'validate_version',
        false,
      );
    }
    if (!this.options.config.enabled || !config.enabled) {
      throw new RuntimeError(
        `${request.runtime} runtime is disabled`,
        'RUNTIME_DISABLED',
        request.runtime,
        'resolve',
        false,
      );
    }

    const key = `${request.runtime}:${requestedVersion}:${request.allowProvision === true}`;
    const existing = this.inFlight.get(key);
    if (existing) return await existing;
    const operation = this.resolveUncached(request.runtime, requestedVersion, request);
    this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async resolveUncached(
    runtime: RuntimeKind,
    requestedVersion: string,
    request: RuntimeRequest,
  ): Promise<ResolvedRuntime> {
    const config = runtimeConfig(this.options, runtime);
    const order = config.preference.startsWith('system') ? ['system', 'managed'] : ['managed', 'system'];
    const allowed = config.preference.endsWith('only') ? order.slice(0, 1) : order;

    for (const source of allowed) {
      if (source === 'managed') {
        const managed = await this.probeManaged(runtime, requestedVersion);
        if (managed) return managed;
        if (request.allowProvision && config.provision !== 'disabled') {
          try {
            return await this.install(runtime, requestedVersion, request.signal);
          } catch (error) {
            if (allowed.length === 1) throw error;
            log.warn(
              { err: error, runtime, requestedVersion, phase: 'managed_install' },
              `Managed ${runtime} installation failed; checking the system runtime`,
            );
          }
        }
      } else {
        const system = await probeSystemRuntime(runtime, requestedVersion);
        if (system) {
          return {
            runtime,
            version: system.version,
            source: 'system',
            executable: system.executables.primary,
            executables: system.executables,
          };
        }
      }
    }

    throw new RuntimeError(
      `${runtime} ${requestedVersion} is not available`,
      'RUNTIME_NOT_FOUND',
      runtime,
      'resolve',
      true,
      [`Run xopc runtime install ${runtime}`],
    );
  }

  async probeManaged(runtime: RuntimeKind, requestedVersion: string): Promise<ResolvedRuntime | null> {
    const manifests = (await readRuntimeManifests(this.options.stateDir, runtime))
      .filter((manifest) => versionSatisfies(manifest.version, requestedVersion));
    for (const manifest of manifests) {
      try {
        const toolsRoot = await realpath(runtimeToolsRoot(this.options.stateDir));
        const installDir = await realpath(manifest.installDir);
        if (!isPathWithin(toolsRoot, installDir)) continue;
        if (!await validateManagedExecutables(installDir, manifest.executables)) continue;
        const result = await runRuntimeCommand({ command: manifest.executables.primary, args: ['--version'] });
        const version = parseRuntimeVersion(`${result.stdout}\n${result.stderr}`);
        if (!result.ok || !version || !versionSatisfies(version, requestedVersion)) continue;
        if (runtime === 'node') {
          const packageManagers = await probeNodePackageManagers(manifest.executables);
          if (!packageManagers?.npm.ok || !packageManagers.npx.ok) continue;
        }
        return {
          runtime,
          version,
          source: 'managed',
          executable: manifest.executables.primary,
          executables: manifest.executables,
          installDir: manifest.installDir,
        };
      } catch {
        // Try another retained version satisfying the same request.
      }
    }
    return null;
  }

  async install(runtime: RuntimeKind, version = this.defaultVersion(runtime), signal?: AbortSignal): Promise<ResolvedRuntime> {
    const config = runtimeConfig(this.options, runtime);
    if (!this.options.config.enabled || !config.enabled) {
      throw new RuntimeError(
        `${runtime} runtime is disabled`,
        'RUNTIME_DISABLED',
        runtime,
        'install',
        false,
      );
    }
    const installVersion = resolveInstallVersion(version, DEFAULT_RUNTIME_VERSIONS[runtime]);
    if (!installVersion) {
      throw new RuntimeError(
        `Managed ${runtime} installation requires an exact version or a range containing catalog version ${DEFAULT_RUNTIME_VERSIONS[runtime]}`,
        'RUNTIME_VERSION_MISMATCH',
        runtime,
        'validate_version',
        false,
      );
    }
    if (runtime === 'python') return await this.installPython(installVersion, signal);
    return await this.installDistribution(runtime, installVersion, signal);
  }

  private async installDistribution(
    runtime: 'node' | 'uv',
    version: string,
    signal?: AbortSignal,
    alreadyLocked = false,
  ): Promise<ResolvedRuntime> {
    const platform = detectRuntimePlatform();
    if (!platform) {
      throw new RuntimeError(
        `Managed ${runtime} is not supported on ${process.platform}-${process.arch}`,
        'RUNTIME_UNSUPPORTED',
        runtime,
        'resolve_asset',
        false,
      );
    }
    const operationId = randomUUID();
    const asset = resolveRuntimeAsset({
      runtime,
      version,
      platform,
    });
    const installDir = runtimeVersionDir(this.options.stateDir, runtime, version);
    const lockPath = runtimeLockPath(this.options.stateDir, runtime, version);

    const performInstall = async (): Promise<ResolvedRuntime> => {
      const ready = await this.probeManaged(runtime, version);
      if (ready) return ready;
      this.progress({ operationId, runtime, phase: 'resolve', message: `Preparing ${runtime} ${version}` });
      const offline = this.options.config.download.bundleDir
        ? await resolveOfflineBundleArtifact({
            bundleDir: this.options.config.download.bundleDir,
            runtime,
            archiveFile: asset.archiveFile,
          })
        : null;
      const online = offline ? null : await resolveRuntimeDownloadSource({
        asset,
        platform,
        config: this.options.config.download,
        signal,
        onFallback: (message) => this.progress({
          operationId,
          runtime,
          phase: 'resolve',
          message,
        }),
      });
      let selectedDownload = online;
      let expectedSha256 = offline?.sha256 ?? selectedDownload!.sha256;
      let archivePath: string;
      if (offline) {
        archivePath = offline.archivePath;
      } else {
        let lastDownloadProgressAt = 0;
        const download = async () => await downloadVerifiedArchive({
          runtime,
          url: selectedDownload!.url,
          targetPath: runtimeDownloadPath(this.options.stateDir, `${version}-${asset.archiveFile}`),
          expectedSha256,
          timeoutMs: this.options.config.download.timeoutMs,
          proxy: this.options.config.download.proxy,
          signal,
          onProgress: (downloadedBytes, totalBytes) => {
            const now = Date.now();
            if (downloadedBytes !== totalBytes && now - lastDownloadProgressAt < 100) return;
            lastDownloadProgressAt = now;
            this.progress({
              operationId,
              runtime,
              phase: 'download',
              message: `Downloading ${runtime} ${version}`,
              downloadedBytes,
              totalBytes,
            });
          },
        });
        try {
          archivePath = await download();
        } catch (error) {
          if (
            signal?.aborted
            || this.options.config.download.source !== 'auto'
            || selectedDownload!.source !== 'website'
            || !canFallbackRuntimeDownload(error)
          ) throw error;
          this.progress({
            operationId,
            runtime,
            phase: 'resolve',
            message: `Runtime gateway download failed; downloading ${runtime} directly`,
          });
          selectedDownload = await resolveRuntimeDownloadSource({
            asset,
            platform,
            config: { ...this.options.config.download, source: 'direct-only' },
            signal,
          });
          expectedSha256 = selectedDownload.sha256;
          archivePath = await download();
        }
      }
      const stagingDir = runtimeStagingDir(this.options.stateDir, runtime, version, operationId);
      this.progress({ operationId, runtime, phase: 'extract', message: `Extracting ${runtime} ${version}` });
      const extractedRoot = await extractRuntimeArchive({
        runtime,
        archivePath,
        archiveType: asset.archiveType,
        stagingDir,
      });
      await atomicInstallRuntime(extractedRoot, installDir);
      await rm(stagingDir, { recursive: true, force: true });
      const executables = runtime === 'node' ? nodeExecutables(installDir) : uvExecutables(installDir);
      const probe = await runRuntimeCommand({ command: executables.primary, args: ['--version'] });
      const actualVersion = parseRuntimeVersion(`${probe.stdout}\n${probe.stderr}`);
      if (!probe.ok || !actualVersion || !versionSatisfies(actualVersion, version)) {
        await rm(installDir, { recursive: true, force: true });
        throw new RuntimeError(
          `${runtime} ${version} failed its installation probe`,
          'RUNTIME_PROBE_FAILED',
          runtime,
          'probe',
          true,
        );
      }
      let packageManagerVersion: string | undefined;
      if (runtime === 'node') {
        const packageManagers = await probeNodePackageManagers(executables);
        if (!packageManagers?.npm.ok || !packageManagers.npx.ok) {
          await rm(installDir, { recursive: true, force: true });
          throw new RuntimeError(
            `Node ${version} failed its npm or npx installation probe: ${packageManagerProbeFailureMessage(packageManagers)}`,
            'RUNTIME_PROBE_FAILED',
            runtime,
            'probe_package_manager',
            true,
          );
        }
        packageManagerVersion = packageManagers.npm.stdout;
      }
      const now = new Date().toISOString();
      const manifest: InstalledRuntimeManifest = {
        schemaVersion: 1,
        runtime,
        version: actualVersion,
        source: 'managed',
        platform: process.platform,
        arch: process.arch,
        installDir,
        executables,
        installedAt: now,
        verifiedAt: now,
        distribution: {
          url: offline ? `offline:${asset.archiveFile}` : selectedDownload!.url,
          sha256: expectedSha256,
          archiveFile: asset.archiveFile,
          catalogVersion: RUNTIME_CATALOG_VERSION,
        },
        probe: { versionOutput: probe.stdout || probe.stderr, packageManagerVersion },
      };
      await writeRuntimeManifest(this.options.stateDir, manifest);
      this.progress({ operationId, runtime, phase: 'complete', message: `${runtime} ${actualVersion} is ready` });
      return {
        runtime,
        version: actualVersion,
        source: 'managed',
        executable: executables.primary,
        executables,
        installDir,
      };
    };
    return alreadyLocked
      ? await performInstall()
      : await withInstallLock(lockPath, { operationId, runtime, version }, performInstall, signal);
  }

  private async installPython(
    version: string,
    signal?: AbortSignal,
    alreadyLocked = false,
  ): Promise<ResolvedRuntime> {
    const operationId = randomUUID();
    const installDir = runtimeVersionDir(this.options.stateDir, 'python', version);
    const lockPath = runtimeLockPath(this.options.stateDir, 'python', version);
    const ready = await this.probeManaged('python', version);
    if (ready) return ready;
    const uv = this.options.config.download.bundleDir
      ? null
      : await this.resolve({ runtime: 'uv', allowProvision: true, signal });
    const performInstall = async (): Promise<ResolvedRuntime> => {
      const ready = await this.probeManaged('python', version);
      if (ready) return ready;
      if (this.options.config.download.bundleDir) {
        return await this.installBundledPython({
          version,
          operationId,
          installDir,
          bundleDir: this.options.config.download.bundleDir,
        });
      }
      if (!uv) throw new Error('uv runtime was not resolved');
      await mkdir(dirname(installDir), { recursive: true });
      const uvEnv = this.uvEnvironment(installDir);
      this.progress({ operationId, runtime: 'python', phase: 'install', message: `Installing Python ${version}` });
      const installArgs = ['python', 'install', version, '--install-dir', installDir, '--no-config'];
      const runInstall = async (env: NodeJS.ProcessEnv) => await runRuntimeCommand({
        command: uv.executable,
        args: installArgs,
        env,
        timeoutMs: this.options.config.download.timeoutMs,
        signal,
      });
      let installProbe = this.options.config.download.source === 'direct-only'
        ? await runInstall(uvEnv)
        : await runInstall({
            ...uvEnv,
            UV_PYTHON_INSTALL_MIRROR: runtimeGatewayPythonMirror(
              this.options.config.download.gatewayBaseUrl,
            ),
          });
      if (
        !installProbe.ok
        && !installProbe.aborted
        && this.options.config.download.source === 'auto'
        && canFallbackPythonInstall(
          `${installProbe.stdout}\n${installProbe.stderr}`,
          installProbe.timedOut,
        )
      ) {
        this.progress({
          operationId,
          runtime: 'python',
          phase: 'install',
          message: `Runtime gateway unavailable; installing Python ${version} directly`,
        });
        installProbe = await runInstall(uvEnv);
      }
      if (!installProbe.ok) {
        throw new RuntimeError(
          `Python ${version} installation failed: ${installProbe.stderr || installProbe.stdout}`,
          'RUNTIME_PROBE_FAILED',
          'python',
          'install',
          true,
        );
      }
      const findProbe = await runRuntimeCommand({
        command: uv.executable,
        args: ['python', 'find', version, '--managed-python', '--no-config'],
        env: uvEnv,
      });
      const python = findProbe.stdout.split(/\r?\n/).find(Boolean)?.trim();
      if (!findProbe.ok || !python) {
        throw new RuntimeError(
          `Python ${version} executable was not found after installation`,
          'RUNTIME_PROBE_FAILED',
          'python',
          'find',
          true,
        );
      }
      const versionProbe = await runRuntimeCommand({ command: python, args: ['-I', '--version'], env: uvEnv });
      const actualVersion = parseRuntimeVersion(`${versionProbe.stdout}\n${versionProbe.stderr}`);
      if (!versionProbe.ok || !actualVersion || !versionSatisfies(actualVersion, version)) {
        throw new RuntimeError(
          `Python ${version} failed its installation probe`,
          'RUNTIME_PROBE_FAILED',
          'python',
          'probe',
          true,
        );
      }
      const executables: RuntimeExecutables = { primary: python, python };
      const now = new Date().toISOString();
      await writeRuntimeManifest(this.options.stateDir, {
        schemaVersion: 1,
        runtime: 'python',
        version: actualVersion,
        source: 'managed',
        platform: process.platform,
        arch: process.arch,
        installDir,
        executables,
        installedAt: now,
        verifiedAt: now,
        probe: { versionOutput: versionProbe.stdout || versionProbe.stderr },
      });
      this.progress({ operationId, runtime: 'python', phase: 'complete', message: `Python ${actualVersion} is ready` });
      return {
        runtime: 'python',
        version: actualVersion,
        source: 'managed',
        executable: python,
        executables,
        installDir,
      };
    };
    return alreadyLocked
      ? await performInstall()
      : await withInstallLock(lockPath, { operationId, runtime: 'python', version }, performInstall, signal);
  }

  private async installBundledPython(params: {
    version: string;
    operationId: string;
    installDir: string;
    bundleDir: string;
  }): Promise<ResolvedRuntime> {
    const platform = detectRuntimePlatform();
    if (!platform) {
      throw new RuntimeError(
        `Managed python is not supported on ${process.platform}-${process.arch}`,
        'RUNTIME_UNSUPPORTED',
        'python',
        'offline_bundle',
        false,
      );
    }
    const archiveFile = bundledPythonArchiveName({ version: params.version, platform });
    const artifact = await resolveOfflineBundleArtifact({
      bundleDir: params.bundleDir,
      runtime: 'python',
      archiveFile,
    });
    const stagingDir = runtimeStagingDir(
      this.options.stateDir,
      'python',
      params.version,
      params.operationId,
    );
    this.progress({
      operationId: params.operationId,
      runtime: 'python',
      phase: 'extract',
      message: `Extracting Python ${params.version} from offline bundle`,
    });
    const root = await extractRuntimeArchive({
      runtime: 'python',
      archivePath: artifact.archivePath,
      archiveType: artifact.archiveType,
      stagingDir,
    });
    await atomicInstallRuntime(root, params.installDir);
    await rm(stagingDir, { recursive: true, force: true });
    const candidates = process.platform === 'win32'
      ? [join(params.installDir, 'python.exe')]
      : [
          join(params.installDir, 'bin', 'python3'),
          join(params.installDir, 'bin', 'python'),
        ];
    let python: string | undefined;
    for (const candidate of candidates) {
      try {
        await access(candidate);
        python = candidate;
        break;
      } catch {
        // Check the next conventional executable path.
      }
    }
    if (!python) {
      await rm(params.installDir, { recursive: true, force: true });
      throw new RuntimeError(
        `Offline Python ${params.version} has no Python executable`,
        'RUNTIME_PROBE_FAILED',
        'python',
        'probe',
        true,
      );
    }
    const probe = await runRuntimeCommand({ command: python, args: ['-I', '--version'] });
    const actualVersion = parseRuntimeVersion(`${probe.stdout}\n${probe.stderr}`);
    if (!probe.ok || !actualVersion || !versionSatisfies(actualVersion, params.version)) {
      await rm(params.installDir, { recursive: true, force: true });
      throw new RuntimeError(
        `Offline Python ${params.version} failed its installation probe`,
        'RUNTIME_PROBE_FAILED',
        'python',
        'probe',
        true,
      );
    }
    const executables: RuntimeExecutables = { primary: python, python };
    const now = new Date().toISOString();
    await writeRuntimeManifest(this.options.stateDir, {
      schemaVersion: 1,
      runtime: 'python',
      version: actualVersion,
      source: 'managed',
      platform: process.platform,
      arch: process.arch,
      installDir: params.installDir,
      executables,
      installedAt: now,
      verifiedAt: now,
      distribution: {
        url: `offline:${artifact.archiveFile}`,
        sha256: artifact.sha256,
        archiveFile: artifact.archiveFile,
        catalogVersion: RUNTIME_CATALOG_VERSION,
      },
      probe: { versionOutput: probe.stdout || probe.stderr },
    });
    this.progress({
      operationId: params.operationId,
      runtime: 'python',
      phase: 'complete',
      message: `Python ${actualVersion} is ready`,
    });
    return {
      runtime: 'python',
      version: actualVersion,
      source: 'managed',
      executable: python,
      executables,
      installDir: params.installDir,
    };
  }

  private uvEnvironment(pythonInstallDir: string): NodeJS.ProcessEnv {
    const toolsRoot = runtimeToolsRoot(this.options.stateDir);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      UV_PYTHON_INSTALL_DIR: pythonInstallDir,
      UV_PYTHON_BIN_DIR: join(toolsRoot, 'python', 'bin'),
      UV_CACHE_DIR: join(toolsRoot, 'cache', 'uv'),
      UV_MANAGED_PYTHON: '1',
      UV_NO_CONFIG: '1',
      UV_HTTP_TIMEOUT: String(Math.ceil(this.options.config.download.timeoutMs / 1000)),
    };
    delete env.UV_PYTHON_INSTALL_MIRROR;
    if (this.options.config.download.proxy) {
      env.HTTP_PROXY = this.options.config.download.proxy;
      env.HTTPS_PROXY = this.options.config.download.proxy;
    }
    return env;
  }

  async status(runtime: RuntimeKind): Promise<RuntimeStatus> {
    const config = runtimeConfig(this.options, runtime);
    const requestedVersion = this.defaultVersion(runtime);
    if (!this.options.config.enabled || !config.enabled) {
      return { runtime, state: 'disabled', requestedVersion, message: 'Runtime is disabled', repairable: false };
    }
    try {
      const resolved = await this.resolve({ runtime, version: requestedVersion, allowProvision: false });
      return {
        runtime,
        state: 'ready',
        requestedVersion,
        resolved,
        message: `${runtime} ${resolved.version} is ready (${resolved.source})`,
        repairable: false,
      };
    } catch {
      // Inspect persisted managed state below so corruption is distinct from absence.
    }
    const matchingManifests = (await readRuntimeManifests(this.options.stateDir, runtime))
      .filter((manifest) => versionSatisfies(manifest.version, requestedVersion));
    if (matchingManifests.length > 0) {
      return {
        runtime,
        state: 'corrupted',
        requestedVersion,
        message: `${runtime} managed installation is incomplete or invalid`,
        repairable: true,
      };
    }
    return {
      runtime,
      state: 'absent',
      requestedVersion,
      message: `${runtime} ${requestedVersion} is not installed`,
      repairable: true,
    };
  }

  async statusAll(): Promise<RuntimeStatus[]> {
    return await Promise.all((['node', 'uv', 'python'] as const).map((runtime) => this.status(runtime)));
  }

  async repair(runtime: RuntimeKind, requestedVersion = this.defaultVersion(runtime)): Promise<ResolvedRuntime> {
    const config = runtimeConfig(this.options, runtime);
    if (!this.options.config.enabled || !config.enabled) {
      throw new RuntimeError(
        `${runtime} runtime is disabled`,
        'RUNTIME_DISABLED',
        runtime,
        'repair',
        false,
      );
    }
    const version = resolveInstallVersion(requestedVersion, DEFAULT_RUNTIME_VERSIONS[runtime]);
    if (!version) {
      throw new RuntimeError(
        `Managed ${runtime} repair requires an exact version or a range containing catalog version ${DEFAULT_RUNTIME_VERSIONS[runtime]}`,
        'RUNTIME_VERSION_MISMATCH',
        runtime,
        'validate_version',
        false,
      );
    }
    const installDir = runtimeVersionDir(this.options.stateDir, runtime, version);
    const backupDir = `${installDir}.repair-backup-${randomUUID()}`;
    const lockPath = runtimeLockPath(this.options.stateDir, runtime, version);
    return await withInstallLock(lockPath, {
      operationId: randomUUID(),
      runtime,
      version,
      action: 'repair',
    }, async () => {
      let hasBackup = false;
      try {
        await rename(installDir, backupDir);
        hasBackup = true;
      } catch {
        // Missing or incomplete targets can be installed directly.
      }
      try {
        const resolved = runtime === 'python'
          ? await this.installPython(version, undefined, true)
          : await this.installDistribution(runtime, version, undefined, true);
        if (hasBackup) await rm(backupDir, { recursive: true, force: true });
        return resolved;
      } catch (error) {
        if (hasBackup) {
          await rm(installDir, { recursive: true, force: true });
          await rename(backupDir, installDir);
        }
        throw error;
      }
    });
  }

  private progress(event: RuntimeProgressEvent): void {
    this.emit('progress', event);
    log.info(
      {
        operationId: event.operationId,
        runtime: event.runtime,
        phase: event.phase,
        downloadedBytes: event.downloadedBytes,
        totalBytes: event.totalBytes,
      },
      event.message,
    );
  }
}

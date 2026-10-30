import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { PhoneConfig } from '../phone/contracts.js';
import { resolveHdcPath } from '../phone/hdc-driver.js';
import { compileHdcVideoBridge, resolveHdcJavaHome, resolveHdcVideoTools } from '../phone/hdc-video-tools.js';
import { extractRuntimeArchive } from './archive.js';
import { runRuntimeCommand } from './command.js';
import { downloadVerifiedArchive, sha256File } from './downloader.js';
import { RuntimeError } from './errors.js';
import { stageHdcFiles, verifyHdcFiles } from './hdc-files.js';
import { withInstallLock } from './install-lock.js';
import { PHONE_JAVA_VERSION, type HarmonyDependencyKind } from './harmony-dependency-catalog.js';
import { HDC_VERSION, HOSCRCPY_SHA256, HOSCRCPY_VERSION, managedHdcDir, managedHdcPath, managedHosDir, managedHosJar, managedJavaDir, managedJavaHome } from './harmony-paths.js';
import { phoneDependencyAsset } from './phone-dependency-catalog.js';
import type { PhoneDependencyProgress, PhoneDependencyStatus } from './phone-dependencies.js';
import type { RuntimeToolsConfig } from '../config/schema.js';
import { runtimeDownloadPath } from './paths.js';

export interface HarmonyInstallOptions { repair?: boolean; signal?: AbortSignal; beforeCommit?: () => void }
const operations = new Set<string>();
const versions = { hdc: HDC_VERSION, hoscrcpy: HOSCRCPY_VERSION, java: PHONE_JAVA_VERSION };

export async function probePhoneHdc(path: string, signal?: AbortSignal): Promise<string> {
  const result = await runRuntimeCommand({ command: path, args: ['-v'], signal });
  const version = /(?:Ver:\s*|version\s*)(\d+\.\d+(?:\.\d+)?[\w.-]*)/i.exec(result.stdout)?.[1];
  if (!result.ok || !version) throw new Error('A compatible HDC executable was not found');
  return version;
}

export async function probePhoneJava(home: string, signal?: AbortSignal): Promise<string> {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const java = await runRuntimeCommand({ command: join(home, 'bin', `java${suffix}`), args: ['-version'], signal });
  const javac = await runRuntimeCommand({ command: join(home, 'bin', `javac${suffix}`), args: ['-version'], signal });
  const version = /(?:openjdk|java) version "([^\"]+)"/.exec(`${java.stdout}\n${java.stderr}`)?.[1];
  const compiler = /javac (\d+)/.exec(`${javac.stdout}\n${javac.stderr}`)?.[1];
  if (!java.ok || !javac.ok || !version || Number(version.split('.')[0]) < 17 || Number(compiler) < 17) throw new Error('A full JDK 17+ with java and javac is required');
  return version;
}

async function verifyHosJar(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 64 * 1024 * 1024 || await sha256File(path) !== HOSCRCPY_SHA256) throw new Error('HOScrcpy does not match the verified compatible library');
}

/** Device-free bridge validation: never starts HDC, captures a screen or installs device helpers. */
async function probePhoneHosUncached(config: PhoneConfig, stateDir: string, signal: AbortSignal = new AbortController().signal): Promise<string> {
  const tools = resolveHdcVideoTools(config, stateDir);
  const path = tools?.jar ?? config.hdcVideo?.sdkJar ?? managedHosJar(stateDir);
  if (await verifyHosJar(path).then(() => true, () => false)) return HOSCRCPY_VERSION;
  if (!tools) throw new Error('HOScrcpy validation requires a compatible library and a JDK');
  const bridge = await compileHdcVideoBridge(tools, signal);
  try {
    const result = await runRuntimeCommand({ command: bridge.program, args: [...bridge.args, '--probe', '', tools.jar], timeoutMs: 15_000, signal });
    if (!result.ok) throw new Error('HOScrcpy failed the device-free bridge compatibility check');
    return 'compatible';
  } finally { await bridge.cleanup(); }
}

const hosProbes = new Map<string, { expires: number; result: Promise<string> }>();
export async function probePhoneHos(config: PhoneConfig, stateDir: string, signal?: AbortSignal): Promise<string> {
  const tools = resolveHdcVideoTools(config, stateDir);
  const path = tools?.jar ?? config.hdcVideo?.sdkJar ?? managedHosJar(stateDir);
  const identity = await Promise.all([path, tools?.java, tools?.javac].map(async file => file ? stat(file).then(info => [file, info.size, info.mtimeMs], () => [file]) : undefined));
  const key = JSON.stringify([identity, tools?.classpath]);
  const cached = hosProbes.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  if (hosProbes.size >= 32) hosProbes.clear();
  const result = probePhoneHosUncached(config, stateDir, signal);
  // Share device-free work across status requests, including failed probes, for a short window.
  hosProbes.set(key, { result, expires: Date.now() + 10_000 });
  return result;
}

export class HarmonyDependencyManager {
  constructor(private options: { stateDir: string; config: RuntimeToolsConfig; phone: PhoneConfig }, private emit: (event: PhoneDependencyProgress) => void) {}
  private key(kind: HarmonyDependencyKind) { return `${this.options.stateDir}:${kind}`; }
  async status(kind: HarmonyDependencyKind): Promise<PhoneDependencyStatus> {
    const { stateDir, phone } = this.options;
    const asset = phoneDependencyAsset(kind);
    const canInstall = this.options.config.enabled && Boolean(asset);
    const requestedVersion = asset?.version ?? versions[kind];
    const distribution = kind === 'hoscrcpy' ? 'HOScrcpy 1.0.18-beta via @nszzj/dsh-hos-scrcpy 3.0.2 (third-party distribution)'
      : kind === 'hdc' ? `HDC ${HDC_VERSION} via hdw2 2.3.10 (third-party distribution; ${((asset?.files?.reduce((sum, file) => sum + file.sizeBytes, 0) ?? 0) / 1024 ** 2).toFixed(1)} MiB for this host)` : 'Amazon Corretto JDK 17';
    const base = { kind, requestedVersion, canInstall, distribution, downloadUrl: asset?.url };
    if (operations.has(this.key(kind))) return { ...base, state: 'installing' };
    const path = kind === 'hdc' ? resolveHdcPath(phone.hdcPath, stateDir)
      : kind === 'java' ? resolveHdcJavaHome(phone, stateDir) : resolveHdcVideoTools(phone, stateDir)?.jar ?? phone.hdcVideo?.sdkJar ?? managedHosJar(stateDir);
    const custom = kind === 'hdc' ? phone.hdcPath : kind === 'java' ? phone.hdcVideo?.javaHome : phone.hdcVideo?.sdkJar;
    const managed = kind === 'hdc' ? managedHdcPath(stateDir) : kind === 'java' ? managedJavaHome(stateDir) : managedHosJar(stateDir);
    try {
      if (!path) throw new Error('Dependency not found');
      if (kind === 'hdc' && path === managed && asset) await verifyHdcFiles(dirname(path), asset);
      const version = kind === 'hdc' ? await probePhoneHdc(path) : kind === 'java' ? await probePhoneJava(path) : await probePhoneHos(phone, stateDir);
      return { ...base, state: 'ready', version, path, source: path === managed ? 'managed' : custom ? 'custom' : 'system' };
    } catch {
      const exists = path && await stat(path).then(() => true, () => false);
      return { ...base, state: exists || custom ? 'corrupted' : !asset ? 'unsupported' : 'absent', path: exists || custom ? path : undefined, error: 'RUNTIME_PROBE_FAILED' };
    }
  }
  async install(kind: HarmonyDependencyKind, options: HarmonyInstallOptions = {}) {
    const check = () => { options.signal?.throwIfAborted(); options.beforeCommit?.(); };
    check();
    const asset = phoneDependencyAsset(kind);
    if (!this.options.config.enabled) throw new RuntimeError('Managed runtime installation is disabled', 'RUNTIME_DISABLED', kind, 'install', false);
    if (!asset) throw new RuntimeError('No verified managed dependency is available for this platform', 'RUNTIME_UNSUPPORTED', kind, 'install', false);
    if (operations.has(this.key(kind))) throw new Error('This dependency is already being installed');
    operations.add(this.key(kind));
    const progress = (phase: PhoneDependencyProgress['phase']) => this.emit({ kind, phase });
    try {
      await withInstallLock(join(this.options.stateDir, 'tools', 'locks', `phone-${kind}.lock`), { kind }, async () => {
        check();
        const target = kind === 'hdc' ? managedHdcDir(this.options.stateDir) : kind === 'java' ? managedJavaDir(this.options.stateDir) : managedHosDir(this.options.stateDir);
        const probe = async (root: string) => {
          if (kind === 'hdc') {
            await verifyHdcFiles(root, asset);
            if (await probePhoneHdc(join(root, process.platform === 'win32' ? 'hdc.exe' : 'hdc'), options.signal) !== asset.version) throw new Error('HDC version does not match the catalog');
          }
          else if (kind === 'java') await probePhoneJava(process.platform === 'darwin' ? join(root, 'Contents', 'Home') : root, options.signal);
          else await verifyHosJar(join(root, `hosScrcpy-${HOSCRCPY_VERSION}.jar`));
        };
        if (!options.repair && await probe(target).then(() => true, () => false)) return;
        let source: string | undefined;
        if (kind !== 'hdc') {
          if (this.options.config.download.bundleDir) {
            if (!isAbsolute(this.options.config.download.bundleDir)) throw new Error('Offline bundle directory must be an absolute path on the Gateway host');
            source = join(this.options.config.download.bundleDir, asset.filename);
          } else {
            if (this.options.config.download.source === 'website-only') throw new Error('Select Auto or Direct downloads, or configure an offline bundle directory');
            progress('download');
            source = await downloadVerifiedArchive({ runtime: kind, url: asset.url, expectedSha256: asset.sha256,
              targetPath: runtimeDownloadPath(this.options.stateDir, asset.filename),
              timeoutMs: this.options.config.download.timeoutMs, proxy: this.options.config.download.proxy, signal: options.signal,
              onProgress: (downloadedBytes, totalBytes) => this.emit({ kind, phase: 'download', downloadedBytes, totalBytes }) });
          }
          check(); progress('verify');
          if (await sha256File(source) !== asset.sha256) throw new RuntimeError('Dependency checksum mismatch', 'RUNTIME_CHECKSUM_MISMATCH', kind, 'verify', true);
        }
        const staging = join(this.options.stateDir, 'tools', 'staging', `phone-${kind}-${randomUUID()}`);
        const backup = `${target}.${randomUUID()}.backup`;
        let backedUp = false;
        try {
          if (kind !== 'hdc') progress('extract');
          let root: string;
          if (kind === 'hdc') root = await stageHdcFiles({ asset, stateDir: this.options.stateDir, config: this.options.config, root: join(staging, 'hdc'), signal: options.signal, check, progress: this.emit });
          else {
            if (!source) throw new Error('Dependency archive is unavailable');
            const unpacked = await extractRuntimeArchive({ runtime: kind, archivePath: source, archiveType: asset.filename.endsWith('.zip') ? 'zip' : 'tar.gz', stagingDir: staging });
            if (kind === 'hoscrcpy') {
              root = join(staging, 'library'); await mkdir(root);
              await copyFile(join(unpacked, 'resources', `hosScrcpy-${HOSCRCPY_VERSION}.jar`), join(root, `hosScrcpy-${HOSCRCPY_VERSION}.jar`));
              // Keep the distributor's provenance and license alongside the unmodified SDK.
              for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(join(unpacked, name), join(root, name));
            } else root = unpacked;
          }
          progress('probe'); await probe(root); check();
          await mkdir(dirname(target), { recursive: true });
          check();
          progress('install');
          try { await rename(target, backup); backedUp = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          try { await rename(root, target); } catch (error) { if (backedUp) { await rename(backup, target); backedUp = false; } throw error; }
        } finally { await rm(staging, { recursive: true, force: true }); if (backedUp) await rm(backup, { recursive: true, force: true }); }
      });
      progress('complete');
    } finally { operations.delete(this.key(kind)); }
  }
}

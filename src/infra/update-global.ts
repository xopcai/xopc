// src/infra/update-global.ts — global npm/pnpm install detection and commands (OpenClaw-aligned)

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyPathPrepend } from './path-prepend.js';
import { resolveExecPathBinPrepend } from './path-env.js';
import { readPackageVersion } from './package-json.js';
import { createDefaultCommandRunner, type CommandRunner } from './run-command.js';

export const XOPC_PACKAGE_NAME = '@xopcai/xopc';

export type GlobalInstallManager = 'npm' | 'pnpm';

export type ResolvedGlobalInstallCommand = {
  manager: GlobalInstallManager;
  command: string;
};

export type ResolvedGlobalInstallTarget = ResolvedGlobalInstallCommand & {
  globalRoot: string | null;
  packageRoot: string | null;
};

export type NpmGlobalPrefixLayout = {
  prefix: string;
  globalRoot: string;
  binDir: string;
};

const GLOBAL_RENAME_PREFIX = '.';
const COREPACK_ENABLE_DOWNLOAD_PROMPT_DEFAULT = '0';
const NPM_GLOBAL_INSTALL_QUIET_FLAGS = ['--no-fund', '--no-audit', '--loglevel=error'] as const;
const NPM_GLOBAL_INSTALL_OMIT_OPTIONAL_FLAGS = [
  '--omit=optional',
  ...NPM_GLOBAL_INSTALL_QUIET_FLAGS,
] as const;

const GLOBAL_DETECT_TIMEOUT_MS = 15_000;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function tryRealpath(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

export function joinGlobalPackagePath(globalRoot: string): string {
  return path.join(globalRoot, XOPC_PACKAGE_NAME);
}

function inferNpmPrefixFromPackageRoot(pkgRoot?: string | null): string | null {
  const trimmed = pkgRoot?.trim();
  if (!trimmed) return null;
  const normalized = path.resolve(trimmed);
  const nodeModulesDir = path.dirname(normalized);
  if (path.basename(nodeModulesDir) !== 'node_modules') return null;
  const parentDir = path.dirname(nodeModulesDir);
  if (path.basename(parentDir) === 'lib') {
    return path.dirname(parentDir);
  }
  if (process.platform === 'win32' && path.basename(parentDir).toLowerCase() === 'npm') {
    return parentDir;
  }
  return null;
}

function resolvePreferredNpmCommand(pkgRoot?: string | null): string | null {
  const prefix = inferNpmPrefixFromPackageRoot(pkgRoot);
  if (!prefix) return null;
  const candidate =
    process.platform === 'win32' ? path.join(prefix, 'npm.cmd') : path.join(prefix, 'bin', 'npm');
  return fsSync.existsSync(candidate) ? candidate : null;
}

function resolveNpmFromExecPath(): string | null {
  const execPath = process.execPath?.trim();
  if (!execPath) return null;
  const binDir = path.dirname(execPath);
  const candidate =
    process.platform === 'win32' ? path.join(binDir, 'npm.cmd') : path.join(binDir, 'npm');
  return fsSync.existsSync(candidate) ? candidate : null;
}

function resolvePreferredGlobalManagerCommand(
  manager: GlobalInstallManager,
  pkgRoot?: string | null,
): string {
  if (manager !== 'npm') return manager;
  return resolvePreferredNpmCommand(pkgRoot) ?? resolveNpmFromExecPath() ?? manager;
}

export function resolveGlobalInstallCommand(
  manager: GlobalInstallManager,
  pkgRoot?: string | null,
): ResolvedGlobalInstallCommand {
  return {
    manager,
    command: resolvePreferredGlobalManagerCommand(manager, pkgRoot),
  };
}

function normalizeGlobalInstallCommand(
  managerOrCommand: GlobalInstallManager | ResolvedGlobalInstallCommand,
  pkgRoot?: string | null,
): ResolvedGlobalInstallCommand {
  return typeof managerOrCommand === 'string'
    ? resolveGlobalInstallCommand(managerOrCommand, pkgRoot)
    : managerOrCommand;
}

export function resolveNpmGlobalPrefixLayoutFromGlobalRoot(
  globalRoot?: string | null,
): NpmGlobalPrefixLayout | null {
  const trimmed = globalRoot?.trim();
  if (!trimmed) return null;
  const normalized = path.resolve(trimmed);
  if (path.basename(normalized) !== 'node_modules') return null;
  const parentDir = path.dirname(normalized);
  if (path.basename(parentDir) === 'lib') {
    const prefix = path.dirname(parentDir);
    return {
      prefix,
      globalRoot: normalized,
      binDir: path.join(prefix, 'bin'),
    };
  }
  if (process.platform === 'win32') {
    return {
      prefix: parentDir,
      globalRoot: normalized,
      binDir: parentDir,
    };
  }
  return null;
}

export function resolveNpmGlobalPrefixLayoutFromPrefix(prefix: string): NpmGlobalPrefixLayout {
  const resolvedPrefix = path.resolve(prefix);
  if (process.platform === 'win32') {
    return {
      prefix: resolvedPrefix,
      globalRoot: path.join(resolvedPrefix, 'node_modules'),
      binDir: resolvedPrefix,
    };
  }
  return {
    prefix: resolvedPrefix,
    globalRoot: path.join(resolvedPrefix, 'lib', 'node_modules'),
    binDir: path.join(resolvedPrefix, 'bin'),
  };
}

function applyWindowsPackageInstallEnv(env: Record<string, string>): void {
  if (process.platform !== 'win32') return;
  env.NPM_CONFIG_UPDATE_NOTIFIER = 'false';
  env.NPM_CONFIG_FUND = 'false';
  env.NPM_CONFIG_AUDIT = 'false';
}

function applyCorepackDownloadPromptEnv(env: Record<string, string>): void {
  if (!env.COREPACK_ENABLE_DOWNLOAD_PROMPT?.trim()) {
    env.COREPACK_ENABLE_DOWNLOAD_PROMPT = COREPACK_ENABLE_DOWNLOAD_PROMPT_DEFAULT;
  }
}

export async function createGlobalInstallEnv(
  env?: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv | undefined> {
  const pathPrepend = resolveExecPathBinPrepend();
  const sourceEnv = env ?? process.env;
  const hasCorepack = Boolean(sourceEnv.COREPACK_ENABLE_DOWNLOAD_PROMPT?.trim());
  if (process.platform !== 'win32' && hasCorepack && pathPrepend.length === 0) {
    return env;
  }
  const merged = Object.fromEntries(
    Object.entries(sourceEnv)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, String(value)]),
  ) as Record<string, string>;
  applyPathPrepend(merged, pathPrepend);
  applyWindowsPackageInstallEnv(merged);
  applyCorepackDownloadPromptEnv(merged);
  return merged;
}

export function resolveGlobalInstallSpec(params: {
  version: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const override =
    params.env?.XOPC_UPDATE_PACKAGE_SPEC?.trim() || process.env.XOPC_UPDATE_PACKAGE_SPEC?.trim();
  if (override) return override;
  return `${XOPC_PACKAGE_NAME}@${params.version}`;
}

export function resolveExpectedInstalledVersionFromSpec(spec: string): string | null {
  const normalized = spec.trim();
  if (!normalized.startsWith(`${XOPC_PACKAGE_NAME}@`)) return null;
  const rawVersion = normalized.slice(XOPC_PACKAGE_NAME.length + 1).trim();
  if (
    !rawVersion ||
    rawVersion.includes('/') ||
    rawVersion.includes(':') ||
    rawVersion.includes('#') ||
    /^(latest|beta|next|dev)$/i.test(rawVersion)
  ) {
    return null;
  }
  return rawVersion;
}

export async function collectInstalledGlobalPackageErrors(params: {
  packageRoot: string;
  expectedVersion?: string | null;
}): Promise<string[]> {
  const errors: string[] = [];
  const installedVersion = await readPackageVersion(params.packageRoot);
  if (params.expectedVersion && installedVersion !== params.expectedVersion) {
    errors.push(
      `expected installed version ${params.expectedVersion}, found ${installedVersion ?? '<missing>'}`,
    );
  }
  if (!installedVersion) {
    errors.push('missing package.json version');
  }
  return errors;
}

export async function resolveGlobalRoot(
  managerOrCommand: GlobalInstallManager | ResolvedGlobalInstallCommand,
  runCommand: CommandRunner,
  timeoutMs: number,
  pkgRoot?: string | null,
): Promise<string | null> {
  const resolved = normalizeGlobalInstallCommand(managerOrCommand, pkgRoot);
  const argv = [resolved.command, 'root', '-g'];
  const res = await runCommand(argv, { timeoutMs }).catch(() => null);
  if (!res || res.code !== 0) return null;
  const root = res.stdout.trim();
  return root || null;
}

export async function resolveGlobalPackageRoot(
  managerOrCommand: GlobalInstallManager | ResolvedGlobalInstallCommand,
  runCommand: CommandRunner,
  timeoutMs: number,
  pkgRoot?: string | null,
): Promise<string | null> {
  const root = await resolveGlobalRoot(managerOrCommand, runCommand, timeoutMs, pkgRoot);
  if (!root) return null;
  return joinGlobalPackagePath(root);
}

export async function resolveGlobalInstallTarget(params: {
  manager: GlobalInstallManager | ResolvedGlobalInstallCommand;
  runCommand: CommandRunner;
  timeoutMs: number;
  pkgRoot?: string | null;
}): Promise<ResolvedGlobalInstallTarget> {
  const command = normalizeGlobalInstallCommand(params.manager, params.pkgRoot);
  const globalRoot = await resolveGlobalRoot(
    command,
    params.runCommand,
    params.timeoutMs,
    params.pkgRoot,
  );
  return {
    ...command,
    globalRoot,
    packageRoot: globalRoot ? joinGlobalPackagePath(globalRoot) : null,
  };
}

export function globalInstallArgs(
  managerOrCommand: GlobalInstallManager | ResolvedGlobalInstallCommand,
  spec: string,
  pkgRoot?: string | null,
  installPrefix?: string | null,
): string[] {
  const resolved = normalizeGlobalInstallCommand(managerOrCommand, pkgRoot);
  if (resolved.manager === 'pnpm') {
    return [resolved.command, 'add', '-g', spec];
  }
  return [
    resolved.command,
    'install',
    '-g',
    ...(installPrefix ? ['--prefix', installPrefix] : []),
    spec,
    ...NPM_GLOBAL_INSTALL_QUIET_FLAGS,
  ];
}

export function globalInstallFallbackArgs(
  managerOrCommand: GlobalInstallManager | ResolvedGlobalInstallCommand,
  spec: string,
  pkgRoot?: string | null,
  installPrefix?: string | null,
): string[] | null {
  const resolved = normalizeGlobalInstallCommand(managerOrCommand, pkgRoot);
  if (resolved.manager !== 'npm') return null;
  return [
    resolved.command,
    'install',
    '-g',
    ...(installPrefix ? ['--prefix', installPrefix] : []),
    spec,
    ...NPM_GLOBAL_INSTALL_OMIT_OPTIONAL_FLAGS,
  ];
}

export async function cleanupGlobalRenameDirs(params: {
  globalRoot: string;
  packageName: string;
}): Promise<{ removed: string[] }> {
  const removed: string[] = [];
  const root = params.globalRoot.trim();
  const name = params.packageName.trim();
  if (!root || !name) return { removed };
  const prefix = `${GLOBAL_RENAME_PREFIX}${name}-`;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return { removed };
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const target = path.join(root, entry);
    try {
      const stat = await fs.lstat(target);
      if (!stat.isDirectory()) continue;
      await fs.rm(target, { recursive: true, force: true });
      removed.push(entry);
    } catch {
      // ignore
    }
  }
  return { removed };
}

export async function detectGlobalInstallManagerForRoot(
  runCommand: CommandRunner,
  pkgRoot: string,
  timeoutMs: number,
): Promise<GlobalInstallManager | null> {
  const pkgReal = await tryRealpath(pkgRoot);
  const npmCommand = resolvePreferredGlobalManagerCommand('npm', pkgRoot);
  const candidates: Array<{ manager: GlobalInstallManager; argv: string[] }> = [
    { manager: 'npm', argv: [npmCommand, 'root', '-g'] },
    { manager: 'pnpm', argv: ['pnpm', 'root', '-g'] },
  ];

  for (const { manager, argv } of candidates) {
    const res = await runCommand(argv, { timeoutMs }).catch(() => null);
    if (!res || res.code !== 0) continue;
    const globalRoot = res.stdout.trim();
    if (!globalRoot) continue;
    const globalReal = await tryRealpath(globalRoot);
    const expected = joinGlobalPackagePath(globalReal);
    const expectedReal = await tryRealpath(expected);
    if (path.resolve(expectedReal) === path.resolve(pkgReal)) {
      return manager;
    }
  }

  if (resolvePreferredNpmCommand(pkgRoot) || resolveNpmFromExecPath()) {
    return 'npm';
  }

  return null;
}

export async function detectGlobalInstallManagerByPresence(
  runCommand: CommandRunner,
  timeoutMs: number,
): Promise<GlobalInstallManager | null> {
  for (const manager of ['npm', 'pnpm'] as const) {
    const root = await resolveGlobalRoot(manager, runCommand, timeoutMs);
    if (!root) continue;
    if (await pathExists(joinGlobalPackagePath(root))) {
      return manager;
    }
  }
  return null;
}

export async function resolveGlobalManager(params: {
  root: string | null;
  timeoutMs?: number;
}): Promise<GlobalInstallManager> {
  const runCommand = createDefaultCommandRunner();
  const timeoutMs = params.timeoutMs ?? GLOBAL_DETECT_TIMEOUT_MS;

  if (params.root) {
    const detected = await detectGlobalInstallManagerForRoot(runCommand, params.root, timeoutMs);
    if (detected) return detected;
  }

  const byPresence = await detectGlobalInstallManagerByPresence(runCommand, timeoutMs);
  return byPresence ?? 'npm';
}

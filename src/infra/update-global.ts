// src/infra/update-global.ts — global npm/pnpm install detection and commands (OpenClaw-aligned)

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createDefaultCommandRunner,
  type CommandRunner,
  type CommandRunResult,
} from './run-command.js';

export const XOPC_PACKAGE_NAME = '@xopcai/xopc';

export type GlobalInstallManager = 'npm' | 'pnpm';

export type ResolvedGlobalInstallCommand = {
  manager: GlobalInstallManager;
  command: string;
};

const COREPACK_ENABLE_DOWNLOAD_PROMPT_DEFAULT = '0';
const NPM_GLOBAL_INSTALL_QUIET_FLAGS = ['--no-fund', '--no-audit', '--loglevel=error'] as const;
const NPM_GLOBAL_INSTALL_OMIT_OPTIONAL_FLAGS = [
  '--omit=optional',
  ...NPM_GLOBAL_INSTALL_QUIET_FLAGS,
] as const;

const GLOBAL_DETECT_TIMEOUT_MS = 15_000;
const GLOBAL_INSTALL_TIMEOUT_MS = 45 * 60 * 1000;

export type GlobalInstallRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  packageManager: GlobalInstallManager;
  usedFallback: boolean;
};

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

function resolvePreferredGlobalManagerCommand(
  manager: GlobalInstallManager,
  pkgRoot?: string | null,
): string {
  if (manager !== 'npm') return manager;
  return resolvePreferredNpmCommand(pkgRoot) ?? manager;
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
  const sourceEnv = env ?? process.env;
  const hasCorepack = Boolean(sourceEnv.COREPACK_ENABLE_DOWNLOAD_PROMPT?.trim());
  if (process.platform !== 'win32' && hasCorepack) {
    return env;
  }
  const merged = Object.fromEntries(
    Object.entries(sourceEnv)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, String(value)]),
  ) as Record<string, string>;
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

export function globalInstallArgs(
  managerOrCommand: GlobalInstallManager | ResolvedGlobalInstallCommand,
  spec: string,
  pkgRoot?: string | null,
): string[] {
  const resolved = normalizeGlobalInstallCommand(managerOrCommand, pkgRoot);
  if (resolved.manager === 'pnpm') {
    return [resolved.command, 'add', '-g', spec];
  }
  return [resolved.command, 'install', '-g', spec, ...NPM_GLOBAL_INSTALL_QUIET_FLAGS];
}

export function globalInstallFallbackArgs(
  managerOrCommand: GlobalInstallManager | ResolvedGlobalInstallCommand,
  spec: string,
  pkgRoot?: string | null,
): string[] | null {
  const resolved = normalizeGlobalInstallCommand(managerOrCommand, pkgRoot);
  if (resolved.manager !== 'npm') return null;
  return [resolved.command, 'install', '-g', spec, ...NPM_GLOBAL_INSTALL_OMIT_OPTIONAL_FLAGS];
}

export async function detectGlobalInstallManagerForRoot(
  runCommand: CommandRunner,
  pkgRoot: string,
  timeoutMs: number,
): Promise<GlobalInstallManager | null> {
  const pkgReal = await tryRealpath(pkgRoot);

  const candidates: Array<{ manager: GlobalInstallManager; argv: string[] }> = [
    { manager: 'npm', argv: ['npm', 'root', '-g'] },
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

  if (resolvePreferredNpmCommand(pkgRoot)) {
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

function tailOutput(text: string, max = 4000): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(-max);
}

export async function runGlobalPackageInstall(params: {
  manager: GlobalInstallManager;
  spec: string;
  pkgRoot: string | null;
  timeoutMs?: number;
  /** Echo install output to the parent process (CLI interactive). */
  echoToTerminal?: boolean;
}): Promise<GlobalInstallRunResult> {
  const timeoutMs = params.timeoutMs ?? GLOBAL_INSTALL_TIMEOUT_MS;
  const runCommand = createDefaultCommandRunner();
  const installEnv = await createGlobalInstallEnv();

  const runStep = async (argv: string[]): Promise<CommandRunResult> => {
    const result = await runCommand(argv, { timeoutMs, env: installEnv });
    if (params.echoToTerminal) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    return result;
  };

  const primaryArgv = globalInstallArgs(params.manager, params.spec, params.pkgRoot);
  const primary = await runStep(primaryArgv);
  if (primary.code === 0) {
    return {
      exitCode: 0,
      stdout: primary.stdout,
      stderr: primary.stderr,
      packageManager: params.manager,
      usedFallback: false,
    };
  }

  const fallbackArgv = globalInstallFallbackArgs(params.manager, params.spec, params.pkgRoot);
  if (!fallbackArgv) {
    return {
      exitCode: primary.code ?? 1,
      stdout: primary.stdout,
      stderr: primary.stderr,
      packageManager: params.manager,
      usedFallback: false,
    };
  }

  const fallback = await runStep(fallbackArgv);
  return {
    exitCode: fallback.code ?? 1,
    stdout: [primary.stdout, fallback.stdout].filter(Boolean).join('\n'),
    stderr: [primary.stderr, fallback.stderr].filter(Boolean).join('\n'),
    packageManager: params.manager,
    usedFallback: true,
  };
}

export function formatGlobalInstallFailure(params: {
  packageManager: GlobalInstallManager;
  spec: string;
  exitCode: number;
  stderr: string;
  usedFallback: boolean;
}): string {
  const tail = tailOutput(params.stderr);
  const parts = [
    `Global install via ${params.packageManager} failed (exit ${params.exitCode}).`,
    params.usedFallback ? 'Retried with --omit=optional.' : null,
    `Try manually: ${params.packageManager} install -g ${params.spec}`,
    tail ? `Install output:\n${tail}` : null,
  ].filter(Boolean);
  return parts.join('\n');
}

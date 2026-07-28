// src/infra/update-runner.ts — unified gateway/CLI update runner (OpenClaw-aligned)

import fs from 'node:fs/promises';
import path from 'node:path';

import { readPackageName, readPackageVersion } from './package-json.js';
import { runGlobalPackageUpdateSteps, type PackageUpdateStepResult } from './package-update-steps.js';
import { createDefaultCommandRunner, runCommandWithTimeout } from './run-command.js';
import { resolveStableNodePath } from './stable-node-path.js';
import { trimLogTail } from './update-log.js';
import { DEFAULT_PACKAGE_CHANNEL, type UpdateChannel } from './update-channels.js';
import { compareSemver, resolveNpmChannelTag } from './update-check.js';
import { runPostUpdateExtensionSync, type ExtensionPostUpdateResult } from '../extensions/update.js';
import {
  cleanupGlobalRenameDirs,
  createGlobalInstallEnv,
  detectGlobalInstallManagerForRoot,
  resolveGlobalInstallSpec,
  resolveGlobalInstallTarget,
  XOPC_PACKAGE_NAME,
  type GlobalInstallManager,
} from './update-global.js';
import {
  maybeRestartGatewayAfterUpdate,
  type InProcessRestartTrigger,
  type UpdateRestartResult,
} from './update-restart.js';

const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const MAX_LOG_CHARS = 8000;
const CORE_PACKAGE_NAMES = new Set([XOPC_PACKAGE_NAME]);

export type UpdateStepResult = {
  name: string;
  command: string;
  cwd: string;
  durationMs: number;
  exitCode: number | null;
  stdoutTail?: string | null;
  stderrTail?: string | null;
};

export type UpdatePostUpdateResult = {
  extensions?: ExtensionPostUpdateResult;
  restart?: UpdateRestartResult;
};

export type UpdateRunResult = {
  status: 'ok' | 'error' | 'skipped';
  mode: 'git' | 'pnpm' | 'npm' | 'unknown';
  root?: string;
  reason?: string;
  before?: { sha?: string | null; version?: string | null };
  after?: { sha?: string | null; version?: string | null };
  steps: UpdateStepResult[];
  durationMs: number;
  postUpdate?: UpdatePostUpdateResult;
};

export type UpdateStepInfo = {
  name: string;
  command: string;
  index: number;
  total: number;
};

export type UpdateStepCompletion = UpdateStepInfo & {
  durationMs: number;
  exitCode: number | null;
  stderrTail?: string | null;
};

export type UpdateStepProgress = {
  onStepStart?: (step: UpdateStepInfo) => void;
  onStepComplete?: (step: UpdateStepCompletion) => void;
};

export type UpdateInstallSurface =
  | { kind: 'git'; mode: 'git'; root: string; packageRoot: string }
  | { kind: 'global'; mode: GlobalInstallManager; root: string; packageRoot: string }
  | { kind: 'package-root'; mode: 'unknown'; root: string; packageRoot: string }
  | { kind: 'missing'; mode: 'unknown'; root?: string; packageRoot?: undefined };

type UpdateRunnerOptions = {
  cwd?: string;
  argv1?: string;
  channel?: UpdateChannel;
  timeoutMs?: number;
  progress?: UpdateStepProgress;
  skipExtensionSync?: boolean;
  shouldRestart?: boolean;
  triggerInProcessRestart?: InProcessRestartTrigger;
};

type CommandRunner = (
  argv: string[],
  options: { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

function normalizeDir(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function resolveNodeModulesBinPackageRoot(argv1: string): string | null {
  const normalized = path.resolve(argv1);
  const parts = normalized.split(path.sep);
  const binIndex = parts.lastIndexOf('.bin');
  if (binIndex <= 0 || parts[binIndex - 1] !== 'node_modules') return null;
  return path.join(parts.slice(0, binIndex).join(path.sep), path.basename(normalized));
}

function buildStartDirs(opts: UpdateRunnerOptions): string[] {
  const dirs: string[] = [];
  const cwd = normalizeDir(opts.cwd);
  if (cwd) dirs.push(cwd);
  const argv1 = normalizeDir(opts.argv1);
  if (argv1) {
    dirs.push(path.dirname(argv1));
    const packageRoot = resolveNodeModulesBinPackageRoot(argv1);
    if (packageRoot) dirs.push(packageRoot);
  }
  const proc = normalizeDir(process.cwd());
  if (proc) dirs.push(proc);
  return Array.from(new Set(dirs));
}

async function resolveComparablePath(target: string): Promise<string> {
  return fs.realpath(target).catch(() => path.resolve(target));
}

async function pathsReferToSameLocation(left: string, right: string): Promise<boolean> {
  return (await resolveComparablePath(left)) === (await resolveComparablePath(right));
}

async function looksLikeGitCheckout(root: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function resolveGitRoot(
  runCommand: CommandRunner,
  candidates: string[],
  timeoutMs: number,
): Promise<string | null> {
  for (const dir of candidates) {
    const res = await runCommand(['git', '-C', dir, 'rev-parse', '--show-toplevel'], {
      timeoutMs,
    }).catch(() => null);
    if (!res || res.code !== 0) continue;
    const root = res.stdout.trim();
    if (root) return root;
  }
  return null;
}

async function findPackageRoot(candidates: string[]): Promise<string | null> {
  for (const dir of candidates) {
    let current = dir;
    for (let i = 0; i < 12; i += 1) {
      const pkgPath = path.join(current, 'package.json');
      try {
        const raw = await fs.readFile(pkgPath, 'utf-8');
        const parsed = JSON.parse(raw) as { name?: string };
        const name = parsed?.name?.trim();
        if (name && CORE_PACKAGE_NAMES.has(name)) return current;
      } catch {
        // ignore
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}

function mergeCommandEnvironments(
  baseEnv: NodeJS.ProcessEnv | undefined,
  overrideEnv: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv | undefined {
  if (!baseEnv) return overrideEnv;
  if (!overrideEnv) return baseEnv;
  return { ...baseEnv, ...overrideEnv };
}

async function buildUpdateCommandRunner(): Promise<{
  defaultCommandEnv: NodeJS.ProcessEnv | undefined;
  runCommand: CommandRunner;
}> {
  const defaultCommandEnv = await createGlobalInstallEnv();
  return {
    defaultCommandEnv,
    runCommand: async (argv, options) => {
      const res = await runCommandWithTimeout(argv, {
        ...options,
        env: mergeCommandEnvironments(defaultCommandEnv, options.env),
      });
      return { stdout: res.stdout, stderr: res.stderr, code: res.code };
    },
  };
}

type RunStepOptions = {
  runCommand: CommandRunner;
  name: string;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  progress?: UpdateStepProgress;
  stepIndex: number;
  totalSteps: number;
};

async function runStep(opts: RunStepOptions): Promise<UpdateStepResult> {
  const { runCommand, name, argv, cwd, timeoutMs, env, progress, stepIndex, totalSteps } = opts;
  const command = argv.join(' ');
  const stepInfo: UpdateStepInfo = { name, command, index: stepIndex, total: totalSteps };
  progress?.onStepStart?.(stepInfo);
  const started = Date.now();
  const result = await runCommand(argv, { cwd, timeoutMs, env });
  const durationMs = Date.now() - started;
  const stderrTail = trimLogTail(result.stderr, MAX_LOG_CHARS);
  progress?.onStepComplete?.({ ...stepInfo, durationMs, exitCode: result.code, stderrTail });
  return {
    name,
    command,
    cwd,
    durationMs,
    exitCode: result.code,
    stdoutTail: trimLogTail(result.stdout, MAX_LOG_CHARS),
    stderrTail,
  };
}

function toUpdateStepResult(step: PackageUpdateStepResult): UpdateStepResult {
  return {
    name: step.name,
    command: step.command,
    cwd: step.cwd,
    durationMs: step.durationMs,
    exitCode: step.exitCode,
    stdoutTail: step.stdoutTail,
    stderrTail: step.stderrTail,
  };
}

export async function resolveUpdateInstallSurface(
  opts: Pick<UpdateRunnerOptions, 'cwd' | 'argv1' | 'timeoutMs'> = {},
): Promise<UpdateInstallSurface> {
  const { runCommand } = await buildUpdateCommandRunner();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const candidates = buildStartDirs(opts);
  const pkgRoot = await findPackageRoot(candidates);

  let gitRoot = await resolveGitRoot(runCommand, candidates, timeoutMs);
  if (gitRoot && pkgRoot && !(await pathsReferToSameLocation(gitRoot, pkgRoot))) {
    gitRoot = null;
  }
  if (gitRoot && !pkgRoot) {
    return { kind: 'missing', mode: 'unknown', root: gitRoot };
  }
  if (gitRoot && pkgRoot && (await pathsReferToSameLocation(gitRoot, pkgRoot))) {
    return { kind: 'git', mode: 'git', root: gitRoot, packageRoot: pkgRoot };
  }
  if (!pkgRoot) {
    return { kind: 'missing', mode: 'unknown' };
  }

  const globalManager = await detectGlobalInstallManagerForRoot(runCommand, pkgRoot, timeoutMs);
  if (globalManager) {
    return { kind: 'global', mode: globalManager, root: pkgRoot, packageRoot: pkgRoot };
  }

  return { kind: 'package-root', mode: 'unknown', root: pkgRoot, packageRoot: pkgRoot };
}

async function runGitUpdate(params: {
  gitRoot: string;
  runCommand: CommandRunner;
  timeoutMs: number;
  progress?: UpdateStepProgress;
  defaultCommandEnv?: NodeJS.ProcessEnv;
}): Promise<UpdateRunResult> {
  const startedAt = Date.now();
  const steps: UpdateStepResult[] = [];
  const { gitRoot, runCommand, timeoutMs, progress, defaultCommandEnv } = params;
  const totalSteps = 7;
  let stepIndex = 0;
  const step = (name: string, argv: string[], cwd: string, env?: NodeJS.ProcessEnv) =>
    runStep({
      runCommand,
      name,
      argv,
      cwd,
      timeoutMs,
      env,
      progress,
      stepIndex: stepIndex++,
      totalSteps,
    });

  const beforeShaResult = await runCommand(['git', '-C', gitRoot, 'rev-parse', 'HEAD'], {
    cwd: gitRoot,
    timeoutMs,
  });
  const beforeSha = beforeShaResult.stdout.trim() || null;
  const beforeVersion = await readPackageVersion(gitRoot);

  const statusCheck = await step(
    'clean check',
    ['git', '-C', gitRoot, 'status', '--porcelain'],
    gitRoot,
  );
  steps.push(statusCheck);
  if (statusCheck.stdoutTail?.trim()) {
    return {
      status: 'skipped',
      mode: 'git',
      root: gitRoot,
      reason: 'dirty',
      before: { sha: beforeSha, version: beforeVersion },
      steps,
      durationMs: Date.now() - startedAt,
    };
  }

  const fetchStep = await step(
    'git fetch',
    ['git', '-C', gitRoot, 'fetch', '--all', '--prune', '--tags'],
    gitRoot,
  );
  steps.push(fetchStep);
  if (fetchStep.exitCode !== 0) {
    return {
      status: 'error',
      mode: 'git',
      root: gitRoot,
      reason: 'fetch-failed',
      before: { sha: beforeSha, version: beforeVersion },
      steps,
      durationMs: Date.now() - startedAt,
    };
  }

  const upstreamStep = await step(
    'upstream check',
    ['git', '-C', gitRoot, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    gitRoot,
  );
  steps.push(upstreamStep);
  if (upstreamStep.exitCode !== 0) {
    return {
      status: 'skipped',
      mode: 'git',
      root: gitRoot,
      reason: 'no-upstream',
      before: { sha: beforeSha, version: beforeVersion },
      steps,
      durationMs: Date.now() - startedAt,
    };
  }

  const rebaseStep = await step(
    'git rebase',
    ['git', '-C', gitRoot, 'rebase', '@{upstream}'],
    gitRoot,
  );
  steps.push(rebaseStep);
  if (rebaseStep.exitCode !== 0) {
    return {
      status: 'error',
      mode: 'git',
      root: gitRoot,
      reason: 'rebase-failed',
      before: { sha: beforeSha, version: beforeVersion },
      steps,
      durationMs: Date.now() - startedAt,
    };
  }

  const depsStep = await step('deps install', ['pnpm', 'install'], gitRoot, defaultCommandEnv);
  steps.push(depsStep);
  if (depsStep.exitCode !== 0) {
    return {
      status: 'error',
      mode: 'git',
      root: gitRoot,
      reason: 'deps-install-failed',
      before: { sha: beforeSha, version: beforeVersion },
      steps,
      durationMs: Date.now() - startedAt,
    };
  }

  const buildStep = await step('build', ['pnpm', 'run', 'build'], gitRoot, defaultCommandEnv);
  steps.push(buildStep);
  if (buildStep.exitCode !== 0) {
    return {
      status: 'error',
      mode: 'git',
      root: gitRoot,
      reason: 'build-failed',
      before: { sha: beforeSha, version: beforeVersion },
      steps,
      durationMs: Date.now() - startedAt,
    };
  }

  const doctorEntry = path.join(gitRoot, 'dist/src/cli/bin.js');
  const doctorEntryExists = await fs.stat(doctorEntry).then(() => true).catch(() => false);
  if (doctorEntryExists) {
    const doctorNodePath = await resolveStableNodePath(process.execPath);
    const doctorStep = await step(
      'xopc doctor',
      [doctorNodePath, doctorEntry, 'doctor', '--fix'],
      gitRoot,
      { ...defaultCommandEnv, XOPC_UPDATE_IN_PROGRESS: '1' },
    );
    steps.push(doctorStep);
    if (doctorStep.exitCode !== 0) {
      return {
        status: 'error',
        mode: 'git',
        root: gitRoot,
        reason: 'doctor-failed',
        before: { sha: beforeSha, version: beforeVersion },
        steps,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  const afterShaStep = await step(
    'git rev-parse HEAD (after)',
    ['git', '-C', gitRoot, 'rev-parse', 'HEAD'],
    gitRoot,
  );
  steps.push(afterShaStep);
  const afterVersion = await readPackageVersion(gitRoot);

  return {
    status: 'ok',
    mode: 'git',
    root: gitRoot,
    before: { sha: beforeSha, version: beforeVersion },
    after: { sha: afterShaStep.stdoutTail?.trim() ?? null, version: afterVersion },
    steps,
    durationMs: Date.now() - startedAt,
  };
}

async function runGlobalUpdate(params: {
  pkgRoot: string;
  globalManager: GlobalInstallManager;
  channel: UpdateChannel;
  runCommand: CommandRunner;
  timeoutMs: number;
  defaultCommandEnv?: NodeJS.ProcessEnv;
  progress?: UpdateStepProgress;
}): Promise<UpdateRunResult> {
  const startedAt = Date.now();
  const beforeVersion = await readPackageVersion(params.pkgRoot);
  const resolved = await resolveNpmChannelTag({ channel: params.channel, timeoutMs: 10_000 });
  if (!resolved.version) {
    return {
      status: 'error',
      mode: params.globalManager,
      root: params.pkgRoot,
      reason: 'registry-unreachable',
      before: { version: beforeVersion },
      steps: [],
      durationMs: Date.now() - startedAt,
    };
  }

  const comparison = compareSemver(beforeVersion ?? '0.0.0', resolved.version);
  if (comparison !== null && comparison >= 0) {
    return {
      status: 'skipped',
      mode: params.globalManager,
      root: params.pkgRoot,
      reason: 'up-to-date',
      before: { version: beforeVersion },
      after: { version: beforeVersion },
      steps: [],
      durationMs: Date.now() - startedAt,
    };
  }

  const installTarget = await resolveGlobalInstallTarget({
    manager: params.globalManager,
    runCommand: params.runCommand,
    timeoutMs: params.timeoutMs,
    pkgRoot: params.pkgRoot,
  });
  const packageName = (await readPackageName(params.pkgRoot)) ?? XOPC_PACKAGE_NAME;
  if (installTarget.globalRoot) {
    await cleanupGlobalRenameDirs({ globalRoot: installTarget.globalRoot, packageName });
  }

  const spec = resolveGlobalInstallSpec({
    version: resolved.version,
    env: params.defaultCommandEnv,
  });

  let stepIndex = 0;
  const packageUpdate = await runGlobalPackageUpdateSteps({
    installTarget,
    installSpec: spec,
    packageName,
    packageRoot: params.pkgRoot,
    runCommand: params.runCommand,
    timeoutMs: params.timeoutMs,
    ...(params.defaultCommandEnv === undefined ? {} : { env: params.defaultCommandEnv }),
    installCwd: params.pkgRoot,
    runStep: async (stepParams) => {
      const result = await runStep({
        runCommand: params.runCommand,
        name: stepParams.name,
        argv: stepParams.argv,
        cwd: stepParams.cwd ?? params.pkgRoot,
        timeoutMs: stepParams.timeoutMs,
        env: stepParams.env,
        progress: params.progress,
        stepIndex: stepIndex++,
        totalSteps: 3,
      });
      return {
        name: result.name,
        command: result.command,
        cwd: result.cwd,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        stdoutTail: result.stdoutTail,
        stderrTail: result.stderrTail,
      };
    },
  });

  const steps = packageUpdate.steps.map(toUpdateStepResult);
  return {
    status: packageUpdate.failedStep ? 'error' : 'ok',
    mode: params.globalManager,
    root: packageUpdate.verifiedPackageRoot ?? params.pkgRoot,
    reason: packageUpdate.failedStep ? 'global-install-failed' : undefined,
    before: { version: beforeVersion },
    after: { version: packageUpdate.afterVersion },
    steps,
    durationMs: Date.now() - startedAt,
  };
}

export async function runGatewayUpdate(opts: UpdateRunnerOptions = {}): Promise<UpdateRunResult> {
  const startedAt = Date.now();
  const { defaultCommandEnv, runCommand } = await buildUpdateCommandRunner();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const channel = opts.channel ?? DEFAULT_PACKAGE_CHANNEL;
  const candidates = buildStartDirs(opts);
  const pkgRoot = await findPackageRoot(candidates);

  let gitRoot = await resolveGitRoot(runCommand, candidates, timeoutMs);
  if (!gitRoot && pkgRoot) {
    const cwdRoot = normalizeDir(opts.cwd);
    if (
      cwdRoot &&
      (await pathsReferToSameLocation(cwdRoot, pkgRoot)) &&
      (await looksLikeGitCheckout(cwdRoot))
    ) {
      gitRoot = await resolveComparablePath(cwdRoot);
    }
  }
  if (gitRoot && pkgRoot && !(await pathsReferToSameLocation(gitRoot, pkgRoot))) {
    gitRoot = null;
  }

  if (gitRoot && pkgRoot && (await pathsReferToSameLocation(gitRoot, pkgRoot))) {
    return runGitUpdate({
      gitRoot,
      runCommand,
      timeoutMs,
      progress: opts.progress,
      defaultCommandEnv,
    });
  }

  if (!pkgRoot) {
    return {
      status: 'error',
      mode: 'unknown',
      reason: 'not-xopc-root',
      steps: [],
      durationMs: Date.now() - startedAt,
    };
  }

  const globalManager = await detectGlobalInstallManagerForRoot(runCommand, pkgRoot, timeoutMs);
  if (globalManager) {
    return runGlobalUpdate({
      pkgRoot,
      globalManager,
      channel,
      runCommand,
      timeoutMs,
      defaultCommandEnv,
      progress: opts.progress,
    });
  }

  return {
    status: 'skipped',
    mode: 'unknown',
    root: pkgRoot,
    reason: 'not-global-install',
    before: { version: await readPackageVersion(pkgRoot) },
    steps: [],
    durationMs: Date.now() - startedAt,
  };
}

export async function runGatewayUpdateWithPostSteps(
  opts: UpdateRunnerOptions = {},
): Promise<UpdateRunResult> {
  const channel = opts.channel ?? DEFAULT_PACKAGE_CHANNEL;
  const result = await runGatewayUpdate(opts);

  if (result.status !== 'ok') {
    return result;
  }

  const postUpdate: UpdatePostUpdateResult = {};

  if (!opts.skipExtensionSync) {
    const extensions = await runPostUpdateExtensionSync({
      channel,
      timeoutMs: opts.timeoutMs,
    });
    postUpdate.extensions = extensions;
    if (extensions.status === 'error') {
      return {
        ...result,
        status: 'error',
        reason: 'post-update-extensions',
        postUpdate,
      };
    }
  }

  const restart = await maybeRestartGatewayAfterUpdate({
    shouldRestart: opts.shouldRestart,
    expectedVersion: result.after?.version ?? undefined,
    updatedPackageRoot:
      result.mode === 'npm' || result.mode === 'pnpm' ? result.root : undefined,
    triggerInProcessRestart: opts.triggerInProcessRestart,
  });
  postUpdate.restart = restart;

  return { ...result, postUpdate };
}

export function formatUpdateApiResult(result: UpdateRunResult, channel: UpdateChannel): Record<string, unknown> {
  if (result.status === 'skipped' && result.reason === 'up-to-date') {
    return {
      status: 'up-to-date',
      currentVersion: result.before?.version ?? null,
      latestVersion: result.before?.version ?? null,
      channel,
      mode: result.mode,
    };
  }
  if (result.status === 'ok') {
    return {
      status: 'ok',
      previousVersion: result.before?.version ?? null,
      installedVersion: result.after?.version ?? null,
      channel,
      mode: result.mode,
      steps: result.steps.length,
      postUpdate: result.postUpdate ?? undefined,
    };
  }
  const failed = result.steps.find((step) => step.exitCode !== 0);
  return {
    status: 'error',
    reason: result.reason ?? 'update-failed',
    mode: result.mode,
    message: failed?.stderrTail ?? failed?.stdoutTail ?? result.reason,
    stderrTail: failed?.stderrTail ?? undefined,
  };
}

export type AutoUpdateResult = {
  ok: boolean;
  exitCode: number | null;
  reason?: string;
  stdout?: string;
  stderr?: string;
  result?: UpdateRunResult;
};

export async function runAutoUpdateCommand(params: {
  channel: UpdateChannel;
  root?: string | null;
  timeoutMs?: number;
  triggerInProcessRestart?: InProcessRestartTrigger;
}): Promise<AutoUpdateResult> {
  const result = await runGatewayUpdateWithPostSteps({
    channel: params.channel,
    cwd: params.root ?? undefined,
    argv1: process.argv[1],
    timeoutMs: params.timeoutMs,
    triggerInProcessRestart: params.triggerInProcessRestart,
  });
  const payload = formatUpdateApiResult(result, params.channel);
  const stdout = JSON.stringify(payload);
  return {
    ok: result.status === 'ok' || (result.status === 'skipped' && result.reason === 'up-to-date'),
    exitCode: result.status === 'error' ? 1 : 0,
    reason: result.reason,
    stdout,
    stderr: result.steps.find((s) => s.exitCode !== 0)?.stderrTail ?? undefined,
    result,
  };
}

export async function runAutoUpdateCommandWithProgress(params: {
  channel: UpdateChannel;
  root?: string | null;
  timeoutMs?: number;
  triggerInProcessRestart?: InProcessRestartTrigger;
  onProgress?: (line: string, source: 'stdout' | 'stderr') => void | Promise<void>;
}): Promise<AutoUpdateResult> {
  const result = await runGatewayUpdateWithPostSteps({
    channel: params.channel,
    cwd: params.root ?? undefined,
    argv1: process.argv[1],
    timeoutMs: params.timeoutMs,
    triggerInProcessRestart: params.triggerInProcessRestart,
    progress: {
      onStepStart: (step) => void params.onProgress?.(`[${step.index + 1}/${step.total}] ${step.name}`, 'stdout'),
      onStepComplete: (step) => {
        if (step.exitCode !== 0 && step.stderrTail) {
          void params.onProgress?.(step.stderrTail, 'stderr');
        }
      },
    },
  });
  const payload = formatUpdateApiResult(result, params.channel);
  return {
    ok: result.status === 'ok' || (result.status === 'skipped' && result.reason === 'up-to-date'),
    exitCode: result.status === 'error' ? 1 : 0,
    reason: result.reason,
    stdout: JSON.stringify(payload),
    stderr: result.steps.find((s) => s.exitCode !== 0)?.stderrTail ?? undefined,
    result,
  };
}

// Legacy export for tests that import createDefaultCommandRunner path
export { createDefaultCommandRunner };

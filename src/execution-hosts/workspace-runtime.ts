import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ExecutionCommand } from '@xopcai/realtime-protocol';
import lockfile from 'proper-lockfile';

import {
  createApplyPatchTool,
  createExecCommandTool,
  createFindTool,
  createGrepTool,
  createListDirTool,
  createManagedJobTool,
  createReadFileTool,
  createWriteFileTool,
} from '../agent/tools/index.js';
import {
  LocalWorkspaceExecutionBackend,
  type WorkspaceExecutionToolName,
} from '../agent/tools/workspace-execution-backend.js';
import { runExec } from '../infra/exec.js';
import { SnapshotArtifactStore } from '../execution-artifacts/snapshot-artifact-store.js';
import {
  provisionEnvironmentPayloadSchema,
  snapshotPayloadSchema,
  workspaceToolPayloadSchema,
} from './command-payloads.js';
import { ExecutionHostOperationJournal } from './operation-journal.js';
import { boundWorkspaceToolResultForTransport } from './tool-result-transport.js';

const GIT_TIMEOUT_MS = 2 * 60_000;
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

type HostEnvironmentRecord = {
  environmentId: string;
  repositoryUrl: string;
  mirrorPath: string;
  rootPath: string;
  baseSha: string;
  highestBindingEpoch: number;
  createdAt: number;
  updatedAt: number;
};

export type HostWorktreeInspection = {
  healthy: boolean;
  rootExists: boolean;
  dirty: boolean;
  headSha?: string;
  rootPath?: string;
  repositoryRoot?: string;
  gitCommonDir?: string;
  baseSha?: string;
  problems: string[];
};

function safeSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || !SAFE_SEGMENT.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error(`${label} contains unsupported path characters`);
  }
  return normalized;
}

export function validateRemoteRepositoryUrl(value: string): string {
  const repositoryUrl = value.trim();
  if (!repositoryUrl || repositoryUrl.startsWith('-') || /[\r\n\0]/.test(repositoryUrl)) {
    throw new Error('Repository URL is invalid');
  }
  if (/^[^/:\s]+@[^/:\s]+:.+/.test(repositoryUrl)) return repositoryUrl;
  let parsed: URL;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    throw new Error('Repository URL must be an absolute URL or SCP-style SSH address');
  }
  if (!['https:', 'ssh:', 'git:', 'file:'].includes(parsed.protocol)) {
    throw new Error(`Repository URL protocol is not supported: ${parsed.protocol}`);
  }
  if (parsed.protocol === 'https:' && (parsed.username || parsed.password)) {
    throw new Error('Repository URL must not contain HTTP credentials');
  }
  if (parsed.password) throw new Error('Repository URL must not contain a password');
  return repositoryUrl;
}

function repositoryKey(repositoryUrl: string): string {
  return crypto.createHash('sha256').update(repositoryUrl).digest('hex');
}

function errorOutput(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const candidate = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
  return [candidate.stderr, candidate.stdout, candidate.message]
    .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
    .join('\n')
    .slice(-2_000);
}

async function runGit(args: string[], options: { cwd?: string; signal?: AbortSignal } = {}): Promise<string> {
  try {
    return (await runExec('git', args, {
      cwd: options.cwd,
      signal: options.signal,
      timeoutMs: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })).stdout;
  } catch (error) {
    throw new Error(`git ${args[0] ?? 'command'} failed: ${errorOutput(error)}`, { cause: error });
  }
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then((value) => value.isDirectory()).catch(() => false);
}

async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

export class ExecutionHostWorkspaceRuntime {
  private readonly environmentsRoot: string;
  private readonly locksRoot: string;
  private readonly repositoriesRoot: string;
  private readonly worktreesRoot: string;
  private readonly journal: ExecutionHostOperationJournal;
  private readonly snapshots: SnapshotArtifactStore;

  constructor(private readonly stateDir: string) {
    this.environmentsRoot = join(stateDir, 'environments');
    this.locksRoot = join(stateDir, 'locks');
    this.repositoriesRoot = join(stateDir, 'repositories');
    this.worktreesRoot = join(stateDir, 'worktrees');
    this.journal = new ExecutionHostOperationJournal(stateDir);
    this.snapshots = new SnapshotArtifactStore(stateDir);
  }

  execute(
    command: ExecutionCommand,
    signal: AbortSignal,
    onProgress: (payload: unknown) => void,
  ): Promise<unknown> {
    if (command.command === 'environment.inspect' || command.command === 'environment.snapshot') {
      return this.executeCommand(command, signal, onProgress);
    }
    const recoverAfterCrash = command.command !== 'workspace.execute_tool';
    return this.journal.run(command, () => this.executeCommand(command, signal, onProgress), {
      recoverAfterCrash,
    });
  }

  private executeCommand(
    command: ExecutionCommand,
    signal: AbortSignal,
    onProgress: (payload: unknown) => void,
  ): Promise<unknown> {
    if (signal.aborted) return Promise.reject(signal.reason);
    switch (command.command) {
      case 'environment.provision':
        return this.provision(command.environmentId, command.payload, signal);
      case 'environment.inspect':
        return this.inspect(command.environmentId, signal);
      case 'environment.remove':
        return this.remove(command.environmentId, signal);
      case 'workspace.execute_tool':
        return this.executeTool(command, signal, onProgress);
      case 'environment.snapshot':
        return this.snapshot(command.environmentId, command.payload, signal);
    }
  }

  private async provision(environmentId: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    const id = safeSegment(environmentId, 'environmentId');
    const input = provisionEnvironmentPayloadSchema.parse(payload);
    const repositoryUrl = validateRemoteRepositoryUrl(input.repositoryUrl);
    const mirrorPath = join(this.repositoriesRoot, `${repositoryKey(repositoryUrl)}.git`);
    const rootPath = join(this.worktreesRoot, id);
    this.assertManagedPath(rootPath, this.worktreesRoot);

    return this.withRepositoryLock(repositoryUrl, async () => {
      const existing = await this.readEnvironment(id);
      if (existing) {
        if (existing.repositoryUrl !== repositoryUrl || existing.baseSha !== input.baseSha) {
          throw new Error(`Execution environment ${id} already refers to a different repository revision`);
        }
        const inspection = await this.inspectRecord(existing, signal);
        if (!inspection.healthy || inspection.headSha !== input.baseSha) {
          throw new Error(`Execution environment ${id} exists but is unhealthy: ${inspection.problems.join('; ')}`);
        }
        return this.provisionResult(existing);
      }

      await mkdir(this.repositoriesRoot, { recursive: true, mode: 0o700 });
      await mkdir(this.worktreesRoot, { recursive: true, mode: 0o700 });
      if (await isDirectory(mirrorPath)) {
        await runGit([`--git-dir=${mirrorPath}`, 'remote', 'set-url', 'origin', repositoryUrl], { signal });
        await runGit([`--git-dir=${mirrorPath}`, 'fetch', '--prune', 'origin'], { signal });
      } else {
        await runGit(['clone', '--mirror', '--', repositoryUrl, mirrorPath], { signal });
      }
      await runGit([`--git-dir=${mirrorPath}`, 'cat-file', '-e', `${input.baseSha}^{commit}`], { signal });

      if (existsSync(rootPath)) {
        const recovered = await this.inspectPaths(rootPath, signal, mirrorPath);
        if (!recovered.healthy || recovered.headSha !== input.baseSha) {
          throw new Error(`Refusing to replace unexpected worktree path: ${rootPath}`);
        }
      } else {
        await runGit([`--git-dir=${mirrorPath}`, 'worktree', 'add', '--detach', '--lock', rootPath, input.baseSha], { signal });
      }

      const now = Date.now();
      const record: HostEnvironmentRecord = {
        environmentId: id,
        repositoryUrl,
        mirrorPath,
        rootPath,
        baseSha: input.baseSha,
        highestBindingEpoch: 0,
        createdAt: now,
        updatedAt: now,
      };
      await this.writeEnvironment(record);
      return this.provisionResult(record);
    });
  }

  private async inspect(environmentId: string, signal: AbortSignal): Promise<HostWorktreeInspection> {
    const record = await this.readEnvironment(safeSegment(environmentId, 'environmentId'));
    if (!record) {
      return { healthy: false, rootExists: false, dirty: false, problems: ['environment record is missing'] };
    }
    return {
      ...await this.inspectRecord(record, signal),
      ...this.provisionResult(record),
    };
  }

  private async remove(environmentId: string, signal: AbortSignal): Promise<{ removed: boolean }> {
    const id = safeSegment(environmentId, 'environmentId');
    const record = await this.readEnvironment(id);
    if (!record) return { removed: false };
    this.assertManagedPath(record.rootPath, this.worktreesRoot);
    this.assertManagedPath(record.mirrorPath, this.repositoriesRoot);
    await this.withRepositoryLock(record.repositoryUrl, async () => {
      if (await isDirectory(record.mirrorPath)) {
        await runGit([`--git-dir=${record.mirrorPath}`, 'worktree', 'unlock', record.rootPath], { signal }).catch(() => '');
        await runGit([`--git-dir=${record.mirrorPath}`, 'worktree', 'remove', '--force', record.rootPath], { signal }).catch(async (error) => {
          if (existsSync(record.rootPath)) throw error;
          return '';
        });
        await runGit([`--git-dir=${record.mirrorPath}`, 'worktree', 'prune', '--expire', 'now'], { signal });
      }
      if (existsSync(record.rootPath)) await rm(record.rootPath, { recursive: true, force: true });
      await rm(this.environmentPath(id), { force: true });
    });
    return { removed: true };
  }

  private async executeTool(
    command: ExecutionCommand,
    signal: AbortSignal,
    onProgress: (payload: unknown) => void,
  ): Promise<AgentToolResult<unknown>> {
    const input = workspaceToolPayloadSchema.parse(command.payload);
    const record = await this.readEnvironment(safeSegment(command.environmentId, 'environmentId'));
    if (!record) throw new Error(`Execution environment is not provisioned: ${command.environmentId}`);
    const inspection = await this.inspectRecord(record, signal);
    if (!inspection.healthy) {
      throw new Error(`Execution environment is unhealthy: ${inspection.problems.join('; ')}`);
    }
    if (command.bindingEpoch < record.highestBindingEpoch) {
      throw Object.assign(new Error('Execution command uses a stale environment binding epoch'), {
        code: 'STALE_BINDING',
      });
    }
    if (command.bindingEpoch > record.highestBindingEpoch) {
      await this.writeEnvironment({
        ...record,
        highestBindingEpoch: command.bindingEpoch,
        updatedAt: Date.now(),
      });
    }
    const backend = new LocalWorkspaceExecutionBackend(this.createWorkspaceTools(record));
    return backend.execute({
      toolCallId: input.toolCallId,
      toolName: input.toolName as WorkspaceExecutionToolName,
      params: input.params,
      signal,
      onUpdate: (update) => onProgress(boundWorkspaceToolResultForTransport(update)),
    }).then(boundWorkspaceToolResultForTransport);
  }

  private async snapshot(environmentId: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    const input = snapshotPayloadSchema.parse(payload);
    if (signal.aborted) throw signal.reason;
    if (input.action === 'read') {
      const chunk = await this.snapshots.readChunk(input.artifactId, input.offset, input.length);
      return { ...chunk, data: chunk.data.toString('base64') };
    }
    if (input.action === 'write_import') {
      await this.snapshots.writeChunk(input.artifactId, input.offset, Buffer.from(input.data, 'base64'));
      return { written: true };
    }
    if (input.action === 'remove') {
      await this.snapshots.remove(input.artifactId);
      return { removed: true };
    }
    const record = await this.readEnvironment(safeSegment(environmentId, 'environmentId'));
    if (!record) throw new Error(`Execution environment is not provisioned: ${environmentId}`);
    if (input.action === 'create') {
      const inspection = await this.inspectRecord(record, signal);
      if (!inspection.healthy || !inspection.headSha) {
        throw new Error(`Execution environment is unhealthy: ${inspection.problems.join('; ')}`);
      }
      return this.snapshots.create({
        artifactId: input.artifactId,
        rootPath: record.rootPath,
        baseSha: inspection.headSha,
      });
    }
    if (input.action === 'begin_import') {
      const complete = await this.snapshots.beginReceive({
        artifactId: input.artifactId,
        baseSha: input.baseSha,
        size: input.size,
        sha256: input.sha256,
      });
      return { complete };
    }
    if (input.action === 'finalize_import') {
      return this.snapshots.finalizeReceive(input.artifactId);
    }
    await this.snapshots.apply({
      artifactId: input.artifactId,
      rootPath: record.rootPath,
      baseSha: record.baseSha,
    });
    return { applied: true };
  }

  private createWorkspaceTools(record: HostEnvironmentRecord): AgentTool<any, any>[] {
    const workspace = record.rootPath;
    return [
      createReadFileTool(workspace),
      createWriteFileTool(workspace),
      createApplyPatchTool(workspace),
      createListDirTool(workspace),
      createGrepTool(workspace),
      createFindTool(workspace),
      createExecCommandTool(workspace),
      createManagedJobTool(workspace, () => record.environmentId),
    ];
  }

  private async inspectRecord(record: HostEnvironmentRecord, signal: AbortSignal): Promise<HostWorktreeInspection> {
    this.assertManagedPath(record.rootPath, this.worktreesRoot);
    this.assertManagedPath(record.mirrorPath, this.repositoriesRoot);
    return this.inspectPaths(record.rootPath, signal, record.mirrorPath);
  }

  private async inspectPaths(
    rootPath: string,
    signal: AbortSignal,
    expectedGitCommonDir: string,
  ): Promise<HostWorktreeInspection> {
    const rootExists = await isDirectory(rootPath);
    if (!rootExists) {
      return { healthy: false, rootExists: false, dirty: false, problems: ['worktree root is missing'] };
    }
    const problems: string[] = [];
    const rawCommonDir = (await runGit(['-C', rootPath, 'rev-parse', '--git-common-dir'], { signal }).catch((error) => {
      if (signal.aborted) throw signal.reason;
      problems.push(error instanceof Error ? error.message : String(error));
      return '';
    })).trim();
    if (rawCommonDir) {
      const commonDir = await canonicalPath(isAbsolute(rawCommonDir) ? rawCommonDir : resolve(rootPath, rawCommonDir));
      if (commonDir !== await canonicalPath(expectedGitCommonDir)) {
        problems.push('worktree belongs to an unexpected Git repository');
      }
    }
    const headSha = (await runGit(['-C', rootPath, 'rev-parse', '--verify', 'HEAD^{commit}'], { signal }).catch((error) => {
      if (signal.aborted) throw signal.reason;
      problems.push(error instanceof Error ? error.message : String(error));
      return '';
    })).trim();
    const dirty = Boolean(await runGit(['-C', rootPath, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { signal }).catch((error) => {
      if (signal.aborted) throw signal.reason;
      problems.push(error instanceof Error ? error.message : String(error));
      return '';
    }));
    return {
      healthy: problems.length === 0,
      rootExists,
      dirty,
      ...(headSha ? { headSha } : {}),
      problems,
    };
  }

  private provisionResult(record: HostEnvironmentRecord): Record<string, unknown> {
    return {
      rootPath: record.rootPath,
      repositoryRoot: record.mirrorPath,
      gitCommonDir: record.mirrorPath,
      baseSha: record.baseSha,
    };
  }

  private environmentPath(environmentId: string): string {
    return join(this.environmentsRoot, `${safeSegment(environmentId, 'environmentId')}.json`);
  }

  private async readEnvironment(environmentId: string): Promise<HostEnvironmentRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.environmentPath(environmentId), 'utf8')) as HostEnvironmentRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async writeEnvironment(record: HostEnvironmentRecord): Promise<void> {
    await mkdir(this.environmentsRoot, { recursive: true, mode: 0o700 });
    const path = this.environmentPath(record.environmentId);
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  }

  private assertManagedPath(path: string, managedRoot: string): void {
    const candidate = resolve(path);
    const root = resolve(managedRoot);
    const child = relative(root, candidate);
    if (!child || child.startsWith('..') || resolve(root, child) !== candidate) {
      throw new Error(`Refusing to manage path outside ${root}`);
    }
  }

  private async withRepositoryLock<T>(repositoryUrl: string, run: () => Promise<T>): Promise<T> {
    const lockRoot = join(this.locksRoot, repositoryKey(repositoryUrl));
    await mkdir(lockRoot, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(lockRoot, {
      realpath: false,
      retries: { retries: 20, factor: 1.2, minTimeout: 25, maxTimeout: 250 },
    });
    try {
      return await run();
    } finally {
      await release();
    }
  }
}

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import { evaluateExecPolicy } from '../sandbox/exec-policy.js';
import { resolveGlobalSingleton } from '../../utils/global-singleton.js';

const MANAGED_JOB_REGISTRY_KEY = Symbol.for('xopc.managedJobRegistry');
const DEFAULT_MAX_RUNTIME_MS = 60 * 60_000;
const MAX_RUNTIME_MS = 24 * 60 * 60_000;
const MAX_CAPTURE_CHARS = 200_000;

type ManagedJobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

type ManagedJob = {
  id: string;
  owner: string;
  command: string;
  cwd: string;
  status: ManagedJobStatus;
  process: ChildProcess;
  pid?: number;
  createdAtMs: number;
  endedAtMs?: number;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  timeout: ReturnType<typeof setTimeout>;
};

type ManagedJobView = Omit<ManagedJob, 'process' | 'timeout' | 'owner'> & {
  durationMs: number;
  outputTruncated: boolean;
};

class ManagedJobRegistry {
  private readonly jobs = new Map<string, ManagedJob>();

  start(owner: string, command: string, cwd: string, env: NodeJS.ProcessEnv, maxRuntimeMs: number): ManagedJobView {
    this.prune();
    const id = randomUUID();
    const child = spawn(command, [], { shell: true, cwd, env, detached: process.platform !== 'win32' });
    const job: ManagedJob = {
      id,
      owner,
      command,
      cwd,
      status: 'running',
      process: child,
      pid: child.pid,
      createdAtMs: Date.now(),
      stdout: '',
      stderr: '',
      timeout: setTimeout(() => this.stop(job, 'timed_out'), maxRuntimeMs),
    };
    job.timeout.unref?.();
    const append = (stream: 'stdout' | 'stderr', value: Buffer | string) => {
      const next = `${job[stream]}${String(value)}`;
      job[stream] = next.length > MAX_CAPTURE_CHARS ? next.slice(-MAX_CAPTURE_CHARS) : next;
    };
    child.stdout?.on('data', (value) => append('stdout', value));
    child.stderr?.on('data', (value) => append('stderr', value));
    child.on('error', (error) => append('stderr', `\n${error.message}`));
    child.on('close', (exitCode) => {
      if (job.status === 'running') job.status = exitCode === 0 ? 'succeeded' : 'failed';
      job.exitCode = exitCode;
      job.endedAtMs = Date.now();
      clearTimeout(job.timeout);
    });
    this.jobs.set(id, job);
    return this.view(job);
  }

  get(owner: string, id: string): ManagedJobView | undefined {
    const job = this.jobs.get(id);
    return job?.owner === owner ? this.view(job) : undefined;
  }

  list(owner: string): ManagedJobView[] {
    return [...this.jobs.values()]
      .filter((job) => job.owner === owner)
      .toSorted((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, 50)
      .map((job) => this.view(job));
  }

  cancel(owner: string, id: string): ManagedJobView | undefined {
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner) return undefined;
    if (job.status === 'running') this.stop(job, 'cancelled');
    return this.view(job);
  }

  private stop(job: ManagedJob, status: 'cancelled' | 'timed_out'): void {
    if (job.status !== 'running') return;
    job.status = status;
    job.endedAtMs = Date.now();
    clearTimeout(job.timeout);
    if (job.pid && process.platform !== 'win32') {
      try {
        process.kill(-job.pid, 'SIGTERM');
        return;
      } catch {
        // Fall back to the direct child handle.
      }
    }
    job.process.kill('SIGTERM');
  }

  private view(job: ManagedJob): ManagedJobView {
    const outputLength = job.stdout.length + job.stderr.length;
    return {
      id: job.id,
      command: job.command,
      cwd: job.cwd,
      status: job.status,
      pid: job.pid,
      createdAtMs: job.createdAtMs,
      endedAtMs: job.endedAtMs,
      exitCode: job.exitCode,
      stdout: job.stdout,
      stderr: job.stderr,
      durationMs: (job.endedAtMs ?? Date.now()) - job.createdAtMs,
      outputTruncated: outputLength >= MAX_CAPTURE_CHARS,
    };
  }

  private prune(): void {
    if (this.jobs.size < 500) return;
    const removable = [...this.jobs.values()]
      .filter((job) => job.status !== 'running')
      .toSorted((a, b) => a.createdAtMs - b.createdAtMs)
      .slice(0, Math.max(1, this.jobs.size - 400));
    for (const job of removable) this.jobs.delete(job.id);
  }
}

const ManagedJobSchema = Type.Union([
  Type.Object({
    action: Type.Literal('start'),
    command: Type.String(),
    cwd: Type.Optional(Type.String()),
    maxRuntimeMs: Type.Optional(Type.Number()),
  }),
  Type.Object({ action: Type.Literal('status'), jobId: Type.String() }),
  Type.Object({ action: Type.Literal('list') }),
  Type.Object({ action: Type.Literal('cancel'), jobId: Type.String() }),
], { type: 'object' });

function registry(): ManagedJobRegistry {
  return resolveGlobalSingleton(MANAGED_JOB_REGISTRY_KEY, () => new ManagedJobRegistry());
}

function result(value: unknown): AgentToolResult<Record<string, never>> {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    details: {},
  };
}

export function createManagedJobTool(
  workspace: string,
  getSessionKey: () => string | undefined,
  getSkillPassthroughEnvVarNames?: () => string[],
): AgentTool {
  return {
    name: 'managed_job',
    label: 'Managed Job',
    description: 'Start and manage commands expected to outlive a single tool call. Start returns a jobId immediately; use status/list/cancel to observe or stop it.',
    parameters: ManagedJobSchema,
    supportsParallel: true,
    idempotent: false,
    async execute(_toolCallId, input: any) {
      const owner = getSessionKey() ?? 'default';
      if (input.action === 'list') return result(registry().list(owner));
      if (input.action === 'status') {
        const job = registry().get(owner, input.jobId);
        return result(job ?? { error: 'Managed job not found' });
      }
      if (input.action === 'cancel') {
        const job = registry().cancel(owner, input.jobId);
        return result(job ?? { error: 'Managed job not found' });
      }

      const command = String(input.command ?? '').trim();
      if (!command) return result({ error: 'command is required' });
      const requestedCwd = input.cwd?.trim() ? resolve(workspace, input.cwd.trim()) : workspace;
      const policy = evaluateExecPolicy({
        command,
        cwd: requestedCwd,
        allowedEnvVars: getSkillPassthroughEnvVarNames?.() ?? [],
      });
      if (!policy.allowed) return result({ error: `Sandbox blocked command: ${policy.reason}` });
      const rawMax = Number(input.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS);
      const requestedMax = Number.isFinite(rawMax) ? rawMax : DEFAULT_MAX_RUNTIME_MS;
      const maxRuntimeMs = Math.min(MAX_RUNTIME_MS, Math.max(1_000, requestedMax));
      return result(registry().start(owner, command, policy.effectiveCwd, {
        ...policy.sanitizedEnv,
        COLUMNS: '200',
      }, maxRuntimeMs));
    },
  } as AgentTool;
}

import { Type } from '@sinclair/typebox';
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core';
import { resolve } from 'node:path';
import type { TurnOutcomeDeliverable } from '@xopcai/gateway-contract';

import type { CommandIsolation } from '../commands/command-isolation.js';
import { commandRegistry, commandTimeout, type CommandStatus } from '../commands/command-registry.js';
import { evaluateExecPolicy } from '../sandbox/exec-policy.js';
import { publishArtifactPaths } from './publish-artifacts.js';
import { formatSize, truncateTail } from './truncate.js';

const DEFAULT_MAX_OUTPUT_CHARS = 50_000;

const ExecCommandSchema = Type.Object({
  cmd: Type.String({ description: 'Shell command to execute.' }),
  cwd: Type.Optional(
    Type.String({
      description: 'Working directory. Relative paths are resolved under the agent workspace.',
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      description: 'Command timeout in milliseconds. Defaults to 1800000 (30m) and is capped at 14400000 (4h).',
    }),
  ),
  maxOutputChars: Type.Optional(
    Type.Number({
      description: 'Maximum characters returned to the model. UI streaming still receives output deltas.',
    }),
  ),
  yieldTimeMs: Type.Optional(Type.Number({ minimum: 0, maximum: 60000, description: 'Return a running job after this wait; manage it with managed_job. Omit to wait for completion. Cannot be combined with outputs.' })),
  outputs: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 50,
      description: 'Final user-facing files created by this command. Relative paths resolve under the effective cwd and are persisted as chat deliverables after a successful command.',
    }),
  ),
});

export interface ExecCommandDetails {
  command: string;
  cwd: string;
  status: CommandStatus | 'blocked';
  id?: string;
  logPath?: string;
  logTruncated?: boolean;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  truncatedBy?: 'lines' | 'bytes' | null;
  outputBytes: number;
  totalOutputBytes: number;
  captureTruncated: boolean;
  stdout: string;
  stderr: string;
  aggregatedOutput: string;
  failureHint?: string;
  artifacts?: TurnOutcomeDeliverable[];
}

export interface ExecCommandUpdateDetails {
  kind: 'command_output_delta';
  command: string;
  cwd: string;
  stream: 'stdout' | 'stderr';
  delta: string;
}

export interface CreateExecCommandToolOptions {
  /** Env var names allowed through prepareSafeToolEnv even if they match secret heuristics. */
  getCommandIsolation?: () => CommandIsolation | undefined;
  getSessionKey?: () => string | undefined;
  getSkillPassthroughEnvVarNames?: () => string[];
  prepareEnv?: (baseEnv: Record<string, string>, cwd: string) => Promise<Record<string, string>>;
}

type ExecCommandParams = {
  cmd?: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
  outputs?: string[];
  yieldTimeMs?: number;
};

function clampMaxOutputChars(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_MAX_OUTPUT_CHARS;
  return Math.max(1_000, Math.min(500_000, Math.floor(n)));
}

function commandFailureHint(details: Pick<ExecCommandDetails, 'status' | 'exitCode' | 'timedOut' | 'stderr' | 'stdout'>): string | undefined {
  if (details.status === 'success' || details.status === 'running') return undefined;
  if (details.status === 'cancelled') return 'The command was cancelled. Inspect its partial output before deciding whether to restart.';
  if (details.status === 'timed_out') {
    return 'The command timed out. Re-run a narrower command, increase timeoutMs if the long run is expected, or inspect partial output before retrying.';
  }
  if (details.exitCode !== 0 && details.stderr.trim()) {
    return 'The command failed. Inspect stderr first, fix the underlying issue, then re-run the narrowest relevant verification command.';
  }
  if (details.exitCode !== 0 && details.stdout.trim()) {
    return 'The command failed. Inspect stdout for the failure location, then re-run the narrowest relevant verification command.';
  }
  return 'The command failed without output. Verify the command, cwd, and required dependencies before retrying.';
}

function formatOutputForModel(
  details: ExecCommandDetails,
  maxOutputChars: number,
): { text: string; truncated: boolean; truncatedBy?: 'lines' | 'bytes' | null; outputBytes: number } {
  let prefix = '';
  if (details.timedOut) {
    prefix += `Command timed out after ${Math.round(details.durationMs / 1000)}s\n`;
  }
  if (details.exitCode !== 0 && details.exitCode != null) {
    prefix += `Command exited with code ${details.exitCode}\n`;
  }
  if (details.captureTruncated) {
    prefix += `Earlier command output was discarded from model context after ${formatSize(details.totalOutputBytes)}; showing the latest captured output.\n`;
  }

  const truncation = truncateTail(details.aggregatedOutput, {
    maxBytes: Math.min(maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS),
  });
  let text = `${prefix}${truncation.content}`.trimEnd();
  if (!text) text = '(no output)';
  if (truncation.truncated) {
    text += `\n\n[Output truncated: ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}]`;
  }
  if (details.failureHint) {
    text += `\n\nNext action: ${details.failureHint}`;
  }
  return {
    text,
    truncated: truncation.truncated,
    truncatedBy: truncation.truncatedBy,
    outputBytes: truncation.outputBytes,
  };
}

export function createExecCommandTool(
  workspaceCwd: string,
  options?: CreateExecCommandToolOptions,
): AgentTool {
  return {
    name: 'exec_command',
    description: [
      'Run shell commands for code inspection, builds, tests, type checks, and verification.',
      'Use apply_patch for file edits; do not edit files by shell redirection unless explicitly necessary.',
      'Relative cwd values resolve under the current agent workspace.',
      'When the command creates final user-facing files, declare all final paths in outputs so they are persisted with this command.',
    ].join(' '),
    parameters: ExecCommandSchema,
    label: 'Run Command',
    mutationScope: 'unknown',
    supportsParallel: false,
    idempotent: false,
    finalGuardRelevant: true,

    async execute(
      toolCallId: string,
      params: ExecCommandParams,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<ExecCommandUpdateDetails>,
    ): Promise<AgentToolResult<ExecCommandDetails>> {
      const command = (params.cmd ?? '').trim();
      if (params.yieldTimeMs !== undefined && params.outputs?.length) throw new Error('yieldTimeMs cannot be combined with outputs; publish files after the job completes.');
      if (!command) {
        return {
          content: [{ type: 'text', text: 'Error: cmd is required' }],
          details: {
            command,
            cwd: workspaceCwd,
            status: 'failed',
            exitCode: null,
            durationMs: 0,
            timedOut: false,
            truncated: false,
            outputBytes: 0,
            totalOutputBytes: 0,
            captureTruncated: false,
            stdout: '',
            stderr: 'cmd is required',
            aggregatedOutput: 'cmd is required',
            failureHint: 'Provide a non-empty cmd value.',
          },
        };
      }

      const requestedCwd = params.cwd?.trim()
        ? resolve(workspaceCwd, params.cwd.trim())
        : workspaceCwd;
      const passthroughNames = options?.getSkillPassthroughEnvVarNames?.() ?? [];
      const policy = evaluateExecPolicy({
        command,
        cwd: requestedCwd,
        allowedEnvVars: passthroughNames,
      });
      if (!policy.allowed) {
        const text = `Sandbox blocked command: ${policy.reason}`;
        return {
          content: [{ type: 'text', text }],
          details: {
            command,
            cwd: requestedCwd,
            status: 'blocked',
            exitCode: null,
            durationMs: 0,
            timedOut: false,
            truncated: false,
            outputBytes: Buffer.byteLength(text),
            totalOutputBytes: Buffer.byteLength(text),
            captureTruncated: false,
            stdout: '',
            stderr: text,
            aggregatedOutput: text,
            failureHint: 'Use a narrower workspace-safe command or inspect files with read/search tools instead.',
          },
        };
      }

      const timeoutMs = commandTimeout(params.timeoutMs, policy.timeoutMs);
      const maxOutputChars = clampMaxOutputChars(params.maxOutputChars);
      const runtimeEnv = options?.prepareEnv
        ? await options.prepareEnv(policy.sanitizedEnv, policy.effectiveCwd)
        : policy.sanitizedEnv;
      const owner = options?.getSessionKey?.() ?? workspaceCwd;
      const registry = commandRegistry();
      let commandResult = await registry.start({
        workspace: workspaceCwd, isolation: options?.getCommandIsolation?.(),
        owner, command, cwd: policy.effectiveCwd, env: { ...runtimeEnv, COLUMNS: '200' },
        timeoutMs, maxOutputChars, signal,
        snapshot: true,
        onOutput: (stream, delta) => onUpdate?.({ content: [],
          details: { kind: 'command_output_delta', command, cwd: policy.effectiveCwd, stream, delta } }),
      });
      try {
        do {
          commandResult = (await registry.wait(owner, commandResult.id, params.yieldTimeMs ?? 60_000, signal))!;
        } while (params.yieldTimeMs === undefined && commandResult.status === 'running');
      } catch (error) {
        if (!signal?.aborted) throw error;
        commandResult = (await registry.cancel(owner, commandResult.id))!;
      }
      const baseDetails: ExecCommandDetails = {
        ...commandResult, truncated: false, outputBytes: Buffer.byteLength(commandResult.aggregatedOutput),
      };
      baseDetails.failureHint = commandFailureHint(baseDetails);
      const formatted = formatOutputForModel(baseDetails, maxOutputChars);
      const details = { ...baseDetails, truncated: formatted.truncated, truncatedBy: formatted.truncatedBy, outputBytes: formatted.outputBytes };
      let resultText = formatted.text;
      if (details.status === 'running') resultText += `\n\nCommand is running (jobId: ${details.id}). Use managed_job wait/status/stdin/cancel.`;
      if (details.logPath) resultText += `\n\nLog: ${details.logPath}${details.logTruncated ? ' (truncated)' : ''}`;
      if (details.status === 'success' && params.outputs?.length) {
        details.artifacts = await publishArtifactPaths({ paths: params.outputs, baseDir: policy.effectiveCwd, workspaceRoot: workspaceCwd, toolCallId });
        const published = details.artifacts.filter(item => item.availability === 'available').length;
        const failed = details.artifacts.length - published;
        resultText += `\n\nArtifacts: ${published} published${failed > 0 ? `, ${failed} failed` : ''}.`;
      }
      return { content: [{ type: 'text', text: resultText }], details };
    },
  } as any;
}

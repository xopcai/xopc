import { Type } from '@sinclair/typebox';
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { evaluateExecPolicy } from '../sandbox/exec-policy.js';
import { formatSize, truncateTail } from './truncate.js';
import type { GoalEvidenceRecordInput } from './goal-evidence-recorder.js';

const MAX_COMMAND_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;
const STREAM_DELTA_MAX_CHARS = 16_000;

const ExecCommandSchema = Type.Object({
  cmd: Type.String({ description: 'Shell command to execute.' }),
  cwd: Type.Optional(
    Type.String({
      description: 'Working directory. Relative paths are resolved under the agent workspace.',
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      description: 'Command timeout in milliseconds. Defaults to 120000 and is capped at 300000.',
    }),
  ),
  maxOutputChars: Type.Optional(
    Type.Number({
      description: 'Maximum characters returned to the model. UI streaming still receives output deltas.',
    }),
  ),
});

export interface ExecCommandDetails {
  command: string;
  cwd: string;
  status: 'success' | 'failed' | 'timed_out' | 'blocked';
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  truncatedBy?: 'lines' | 'bytes' | null;
  outputBytes: number;
  stdout: string;
  stderr: string;
  aggregatedOutput: string;
  failureHint?: string;
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
  getSkillPassthroughEnvVarNames?: () => string[];
  recordGoalEvidence?: (input: GoalEvidenceRecordInput) => Promise<void> | void;
}

type ExecCommandParams = {
  cmd?: string;
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
};

function clampTimeoutMs(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_COMMAND_TIMEOUT_MS, Math.max(1_000, Math.floor(n)));
}

function clampMaxOutputChars(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_MAX_OUTPUT_CHARS;
  return Math.max(1_000, Math.min(500_000, Math.floor(n)));
}

function isLikelyTestCommand(command: string): boolean {
  return /\b(test|vitest|jest|pytest|go test|cargo test|npm test|pnpm test|yarn test|typecheck|type-check|lint)\b/i.test(command);
}

function commandStatus(exitCode: number | null, timedOut: boolean): ExecCommandDetails['status'] {
  if (timedOut) return 'timed_out';
  if (exitCode === 0) return 'success';
  return 'failed';
}

function commandFailureHint(details: Pick<ExecCommandDetails, 'status' | 'exitCode' | 'timedOut' | 'stderr' | 'stdout'>): string | undefined {
  if (details.status === 'success') return undefined;
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
    ].join(' '),
    parameters: ExecCommandSchema,
    label: 'Run Command',
    mutationScope: 'unknown',
    supportsParallel: false,
    idempotent: false,
    finalGuardRelevant: true,

    async execute(
      _toolCallId: string,
      params: ExecCommandParams,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<ExecCommandUpdateDetails>,
    ): Promise<AgentToolResult<ExecCommandDetails>> {
      const command = (params.cmd ?? params.command ?? '').trim();
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
            stdout: '',
            stderr: text,
            aggregatedOutput: text,
            failureHint: 'Use a narrower workspace-safe command or inspect files with read/search tools instead.',
          },
        };
      }

      const timeoutMs = Math.min(clampTimeoutMs(params.timeoutMs), policy.timeoutMs);
      const maxOutputChars = clampMaxOutputChars(params.maxOutputChars);
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let aggregatedOutput = '';
      let timedOut = false;
      let settled = false;

      return new Promise((resolveTool) => {
        const proc = spawn(command, [], {
          shell: true,
          cwd: policy.effectiveCwd,
          env: {
            ...policy.sanitizedEnv,
            COLUMNS: '200',
          },
        });

        const publishDelta = (stream: 'stdout' | 'stderr', raw: Buffer | string) => {
          const text = raw.toString();
          if (!text) return;
          if (stream === 'stdout') stdout += text;
          else stderr += text;
          aggregatedOutput += text;

          const delta = text.length > STREAM_DELTA_MAX_CHARS
            ? `${text.slice(0, STREAM_DELTA_MAX_CHARS)}\n[stream delta truncated]`
            : text;
          onUpdate?.({
            content: [],
            details: {
              kind: 'command_output_delta',
              command,
              cwd: policy.effectiveCwd,
              stream,
              delta,
            },
          });
        };

        const finish = (
          exitCode: number | null,
          errorText?: string,
        ) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
          if (errorText) {
            stderr += errorText;
            aggregatedOutput += errorText;
          }

          const durationMs = Date.now() - startTime;
          const baseDetails: ExecCommandDetails = {
            command,
            cwd: policy.effectiveCwd,
            status: commandStatus(exitCode, timedOut),
            exitCode,
            durationMs,
            timedOut,
            truncated: false,
            outputBytes: Buffer.byteLength(aggregatedOutput),
            stdout,
            stderr,
            aggregatedOutput,
          };
          baseDetails.failureHint = commandFailureHint(baseDetails);
          const formatted = formatOutputForModel(baseDetails, maxOutputChars);
          const details: ExecCommandDetails = {
            ...baseDetails,
            truncated: formatted.truncated,
            truncatedBy: formatted.truncatedBy,
            outputBytes: formatted.outputBytes,
          };

          const result: AgentToolResult<ExecCommandDetails> = {
            content: [{ type: 'text', text: formatted.text }],
            details,
          };

          void Promise.resolve(options?.recordGoalEvidence?.({
            kind: timedOut || exitCode !== 0 ? 'command' : isLikelyTestCommand(command) ? 'test' : 'command',
            title: `Command: ${command.slice(0, 120)}`,
            summary: formatted.text.slice(0, 2000),
            data: {
              command,
              cwd: policy.effectiveCwd,
              exitCode,
              durationMs,
              timedOut,
              truncated: details.truncated,
              outputBytes: details.outputBytes,
            },
          })).finally(() => resolveTool(result));
        };

        const abort = () => {
          timedOut = true;
          proc.kill('SIGKILL');
        };

        const timeout = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGKILL');
        }, timeoutMs);

        if (signal?.aborted) {
          abort();
        } else {
          signal?.addEventListener('abort', abort, { once: true });
        }

        proc.stdout?.on('data', (data) => publishDelta('stdout', data));
        proc.stderr?.on('data', (data) => publishDelta('stderr', data));
        proc.on('error', (err) => finish(null, `Error: ${err.message}`));
        proc.on('close', (code) => finish(code));
      });
    },
  } as any;
}

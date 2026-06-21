// Shell tool - executes commands with output truncation
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { spawn } from 'child_process';
import { evaluateExecPolicy } from '../sandbox/exec-policy.js';
import { createWriteStream } from 'fs';
import type { GoalEvidenceRecordInput } from './goal-evidence-recorder.js';

const MAX_SHELL_TIMEOUT = 300;
const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_MAX_LINES = 2000;

const ShellSchema = Type.Object({
  command: Type.String({ description: 'Shell command to execute' }),
});

export interface ShellDetails {
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  truncatedBy?: 'lines' | 'bytes';
  outputBytes?: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isLikelyTestCommand(command: string): boolean {
  return /\b(test|vitest|jest|pytest|go test|cargo test|npm test|pnpm test|yarn test)\b/i.test(command);
}

function truncateTail(content: string, maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES) {
  const totalBytes = Buffer.byteLength(content, 'utf-8');
  const lines = content.split('\n');
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return { content, truncated: false, truncatedBy: null, totalLines, totalBytes, outputLines: totalLines, outputBytes: totalBytes };
  }

  const outputLinesArr: string[] = [];
  let outputBytesCount = 0;
  let truncatedBy: 'lines' | 'bytes' = 'lines';

  for (let i = lines.length - 1; i >= 0 && outputLinesArr.length < maxLines; i--) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, 'utf-8') + (outputLinesArr.length > 0 ? 1 : 0);

    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = 'bytes';
      break;
    }

    outputLinesArr.unshift(line);
    outputBytesCount += lineBytes;
  }

  return { content: outputLinesArr.join('\n'), truncated: true, truncatedBy, totalLines, totalBytes, outputLines: outputLinesArr.length, outputBytes: outputBytesCount };
}

export interface CreateShellToolOptions {
  /** Env var names allowed through {@link prepareSafeToolEnv} even if they match secret heuristics (skill passthrough). */
  getSkillPassthroughEnvVarNames?: () => string[];
  recordGoalEvidence?: (input: GoalEvidenceRecordInput) => Promise<void> | void;
}

export function createShellTool(
  cwd: string,
  options?: CreateShellToolOptions,
): AgentTool {
  return {
    name: 'shell',
    description: 'Execute shell command.',
    parameters: ShellSchema,
    label: '💻 Shell',

    async execute(
      toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<ShellDetails>> {
      const p = params as { command: string };

      // Sandbox exec-policy check (path + command injection + env sanitization)
      const passthroughNames = options?.getSkillPassthroughEnvVarNames?.() ?? [];
      const policy = evaluateExecPolicy({
        command: p.command,
        cwd,
        allowedEnvVars: passthroughNames,
      });
      if (!policy.allowed) {
        return {
          content: [{ type: 'text', text: `🚫 Sandbox: ${policy.reason}` }],
          details: { exitCode: null, timedOut: false, truncated: false },
        };
      }

      return new Promise((resolve) => {
        const _startTime = Date.now();
        let output = '';
        let errorOutput = '';
        let timedOut = false;
        let _tempFile: string | null = null;
        let tempStream: ReturnType<typeof createWriteStream> | null = null;
        const useTempFile = false; // Disabled - stream directly

        const effectiveTimeoutSec = Math.min(
          MAX_SHELL_TIMEOUT,
          Math.ceil(policy.timeoutMs / 1000),
        );
        const timeout = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGKILL');
        }, effectiveTimeoutSec * 1000);

        const proc = spawn(p.command, [], {
          shell: true,
          cwd: policy.effectiveCwd,
          env: {
            ...policy.sanitizedEnv,
            COLUMNS: '200',
          },
        });

        proc.stdout?.on('data', (data) => {
          const text = data.toString();
          if (!useTempFile) output += text;
        });

        proc.stderr?.on('data', (data) => {
          const text = data.toString();
          errorOutput += text;
        });

        proc.on('close', (code) => {
          clearTimeout(timeout);
          tempStream?.end();

          const fullOutput = errorOutput + output;
          const truncation = truncateTail(fullOutput);

          let resultText = truncation.content;
          if (timedOut) {
            resultText = `⏱️ Command timed out after ${MAX_SHELL_TIMEOUT}s\n` + resultText;
          }
          if (truncation.truncated) {
            resultText += `\n\n[Output truncated: ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}]`;
          }

          const result: AgentToolResult<ShellDetails> = {
            content: [{ type: 'text', text: resultText }],
            details: {
              exitCode: code,
              timedOut,
              truncated: truncation.truncated,
              truncatedBy: truncation.truncatedBy,
              outputBytes: truncation.outputBytes,
            },
          };
          void Promise.resolve(options?.recordGoalEvidence?.({
            kind: timedOut || code !== 0 ? 'command' : isLikelyTestCommand(p.command) ? 'test' : 'command',
            title: `Command: ${p.command.slice(0, 120)}`,
            summary: resultText.slice(0, 2000),
            data: {
              command: p.command,
              exitCode: code,
              timedOut,
              truncated: truncation.truncated,
              outputBytes: truncation.outputBytes,
            },
          })).finally(() => resolve(result));
        });

        proc.on('error', (err) => {
          clearTimeout(timeout);
          resolve({
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            details: { exitCode: null, timedOut: false, truncated: false },
          });
        });
      });
    },
  } as any;
}

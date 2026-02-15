// Shell tool - executes commands with output truncation
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { spawn } from 'child_process';
import { checkShellSafety } from '../prompt/safety.js';
import { randomBytes } from 'crypto';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

export function createShellTool(cwd: string): AgentTool<typeof ShellSchema, ShellDetails> {
  return {
    name: 'shell',
    description: 'Execute shell command.',
    parameters: ShellSchema,
    label: '💻 Shell',

    async execute(
      toolCallId: string,
      params: Static<typeof ShellSchema>,
      signal?: AbortSignal
    ): Promise<AgentToolResult<ShellDetails>> {
      const safety = checkShellSafety(params.command);
      if (!safety.allowed) {
        return {
          content: [{ type: 'text', text: `🚫 ${safety.message}` }],
          details: { exitCode: null, timedOut: false, truncated: false },
        };
      }

      return new Promise((resolve) => {
        const startTime = Date.now();
        let output = '';
        let errorOutput = '';
        let timedOut = false;
        let tempFile: string | null = null;
        let tempStream: ReturnType<typeof createWriteStream> | null = null;
        const useTempFile = false; // Disabled - stream directly

        const timeout = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGKILL');
        }, MAX_SHELL_TIMEOUT * 1000);

        const proc = spawn(params.command, [], {
          shell: true,
          cwd,
          env: { ...process.env, COLUMNS: '200' },
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

          resolve({
            content: [{ type: 'text', text: resultText }],
            details: {
              exitCode: code,
              timedOut,
              truncated: truncation.truncated,
              truncatedBy: truncation.truncatedBy,
              outputBytes: truncation.outputBytes,
            },
          });
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
  };
}

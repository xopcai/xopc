// Shell Tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { spawn } from 'child_process';

const ShellSchema = Type.Object({
  command: Type.String({ description: 'The shell command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (default: 60)' })),
  workdir: Type.Optional(Type.String({ description: 'Working directory' })),
});

export function createShellTool(defaultWorkdir?: string): AgentTool<typeof ShellSchema, {} > {
  return {
    name: 'shell',
    description: 'Execute a shell command and return the output.',
    parameters: ShellSchema,
    label: '💻 Shell',

    async execute(
      toolCallId: string,
      params: Static<typeof ShellSchema>,
      signal?: AbortSignal,
      onUpdate?: (partial: AgentToolResult<{}>) => void
    ): Promise<AgentToolResult<{}>> {
      const command = params.command;
      const timeout = params.timeout || 60;
      const workdir = params.workdir || defaultWorkdir || process.cwd();

      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        const startTime = Date.now();

        const proc = spawn(command, {
          shell: '/bin/bash',
          cwd: workdir,
          env: process.env,
        });

        proc.stdout.on('data', (d: Buffer) => {
          chunks.push(d);
          if (onUpdate) {
            onUpdate({
              content: [{ type: 'text', text: Buffer.concat(chunks).toString('utf-8') }],
              details: {},
            });
          }
        });

        proc.stderr.on('data', (d: Buffer) => chunks.push(d));

        proc.on('close', (code) => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
          const output = Buffer.concat(chunks).toString('utf-8').trim();

          if (code === 0) {
            resolve({
              content: [
                {
                  type: 'text',
                  text: output
                    ? `Command executed in ${elapsed}s:\n${output}`
                    : `Success (${elapsed}s)`,
                },
              ],
              details: {},
            });
          } else {
            resolve({
              content: [
                {
                  type: 'text',
                  text: `Command failed (exit code ${code}) after ${elapsed}s:\n${output || 'no output'}`,
                },
              ],
              details: {},
            });
          }
        });

        proc.on('error', (error) => {
          resolve({
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            details: {},
          });
        });

        signal?.addEventListener('abort', () => {
          proc.kill('SIGTERM');
          resolve({
            content: [{ type: 'text', text: 'Command aborted' }],
            details: {},
          });
        });

        setTimeout(() => {
          proc.kill('SIGTERM');
          resolve({
            content: [{ type: 'text', text: `Timeout after ${timeout}s` }],
            details: {},
          });
        }, timeout * 1000);
      });
    },
  };
}

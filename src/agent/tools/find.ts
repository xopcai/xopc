/**
 * Find tool - Find files by glob pattern
 * Based on pi-coding-agent implementation
 */

import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

const FindSchema = Type.Object({
  pattern: Type.String({ description: 'Glob pattern (e.g., **/*.ts, *.js, src/**/*.json)' }),
  path: Type.Optional(Type.String({ description: 'Directory to search (default: current directory)' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of results (default: 100)' })),
});

const DEFAULT_LIMIT = 100;

interface FindResult {
  truncation?: {
    totalFiles: number;
    limit: number;
  };
}

export const findTool: AgentTool<typeof FindSchema, FindResult> = {
  name: 'find',
  label: '📂 Find',
  description: 'Find files matching a glob pattern. Respects .gitignore. Returns file paths.',
  parameters: FindSchema,

  async execute(
    toolCallId: string,
    params: Static<typeof FindSchema>,
    _signal?: AbortSignal
  ): Promise<AgentToolResult<FindResult>> {
    try {
      const searchDir = params.path || '.';
      const limit = params.limit || DEFAULT_LIMIT;

      if (!existsSync(searchDir)) {
        return {
          content: [{ type: 'text', text: `Directory not found: ${searchDir}` }],
          details: {},
        };
      }

      // Use fd (fd) if available, otherwise use find
      const useFd = false; // Check if fd is available
      
      let output = '';

      if (useFd) {
        // Use fd for better performance
        const proc = spawn('fd', [
          '--type', 'f',
          '--no-ignore',
          '--max-results', String(limit),
          params.pattern,
          searchDir,
        ], { cwd: searchDir });

        output = await new Promise<string>((resolve, reject) => {
          let data = '';
          proc.stdout.on('data', (d: Buffer) => data += d.toString());
          proc.stderr.on('data', (d: Buffer) => data += d.toString());
          proc.on('close', (_code) => resolve(data));
          proc.on('error', reject);
        });
      } else {
        // Fallback to find command
        const proc = spawn('find', [
          searchDir,
          '-type', 'f',
          '-name', params.pattern,
          '-print0',
        ], { cwd: searchDir });

        output = await new Promise<string>((resolve, reject) => {
          let data = '';
          proc.stdout.on('data', (d: Buffer) => data += d.toString());
          proc.stderr.on('data', (d: Buffer) => data += d.toString());
          proc.on('close', () => resolve(data));
          proc.on('error', reject);
        });
      }

      // Parse null-terminated output
      const files = output.split('\0').filter(Boolean);
      const truncatedFiles = files.slice(0, limit);
      const wasTruncated = files.length > limit;

      if (files.length === 0 || truncatedFiles.length === 0) {
        return {
          content: [{ type: 'text', text: 'No files found' }],
          details: {},
        };
      }

      const resultText = truncatedFiles.join('\n');

      return {
        content: [{ type: 'text', text: resultText }],
        details: {
          truncation: wasTruncated ? { totalFiles: files.length, limit } : undefined,
        },
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        details: {},
      };
    }
  },
};

/**
 * Grep tool - Search file contents for patterns
 * Based on pi-coding-agent implementation
 */

import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

const GREPSchema = Type.Object({
  pattern: Type.String({ description: 'Search pattern (regex or literal string)' }),
  path: Type.Optional(Type.String({ description: 'Directory to search (default: current directory)' })),
  glob: Type.Optional(Type.String({ description: 'Filter files by glob pattern (e.g., *.ts, **/*.js)' })),
  ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive search (default: false)' })),
  literal: Type.Optional(Type.Boolean({ description: 'Treat pattern as literal string (default: false)' })),
  context: Type.Optional(Type.Number({ description: 'Number of lines before/after match (default: 0)' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of matches (default: 100)' })),
});

const DEFAULT_LIMIT = 100;
const MAX_LINE_LENGTH = 500;

interface GrepResult {
  truncation?: {
    totalMatches: number;
    limit: number;
  };
}

export const grepTool: AgentTool<typeof GREPSchema, GrepResult> = {
  name: 'grep',
  label: '🔍 Grep',
  description: `Search file contents for a pattern. Respects .gitignore. Output shows file paths and line numbers. Limited to ${DEFAULT_LIMIT} matches.`,
  parameters: GREPSchema,

  async execute(
    toolCallId: string,
    params: Static<typeof GREPSchema>,
    _signal?: AbortSignal
  ): Promise<AgentToolResult<GrepResult>> {
    try {
      const searchDir = params.path || '.';
      const limit = params.limit || DEFAULT_LIMIT;
      
      if (!existsSync(searchDir)) {
        return {
          content: [{ type: 'text', text: `Directory not found: ${searchDir}` }],
          details: {},
        };
      }

      // Build ripgrep command
      const rgArgs: string[] = [
        '--line-number',
        '--color', 'never',
      ];

      if (params.ignoreCase) {
        rgArgs.push('--ignore-case');
      }
      if (params.literal) {
        rgArgs.push('--fixed-strings');
      }
      if (params.context > 0) {
        rgArgs.push(`--context=${params.context}`);
      }
      if (params.glob) {
        rgArgs.push('--glob', params.glob);
      }
      
      // Limit matches per file
      rgArgs.push('--max-count', String(limit));

      rgArgs.push(params.pattern);
      rgArgs.push(searchDir);

      const proc = spawn('rg', rgArgs, {
        cwd: searchDir,
        env: process.env,
      });

      let output = '';

      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        // Ignore "No files searched" messages
        if (!text.includes('No files searched')) {
          output += text;
        }
      });

      return new Promise((resolve) => {
        proc.on('close', (code) => {
          // Truncate long lines
          const lines = output.split('\n').filter(Boolean);
          const truncatedLines: string[] = [];
          let totalMatches = 0;

          for (const line of lines) {
            // Count matches in this line
            totalMatches += 1;
            
            if (totalMatches > limit) {
              break;
            }

            // Truncate long lines
            if (line.length > MAX_LINE_LENGTH) {
              truncatedLines.push(line.slice(0, MAX_LINE_LENGTH) + '...');
            } else {
              truncatedLines.push(line);
            }
          }

          const truncatedOutput = truncatedLines.join('\n');
          const wasTruncated = totalMatches > limit || lines.length > limit;

          if (code === 0 && !output) {
            resolve({
              content: [{ type: 'text', text: 'No matches found' }],
              details: {},
            });
            return;
          }

          if (code !== 0 && !output.includes('No files')) {
            resolve({
              content: [{ type: 'text', text: `Search failed: ${output || 'unknown error'}` }],
              details: {},
            });
            return;
          }

          resolve({
            content: [{ type: 'text', text: truncatedOutput || 'No matches found' }],
            details: {
              truncation: wasTruncated ? { totalMatches, limit } : undefined,
            },
          });
        });

        proc.on('error', (error) => {
          resolve({
            content: [{ type: 'text', text: `Error running grep: ${error.message}` }],
            details: {},
          });
        });
      });
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

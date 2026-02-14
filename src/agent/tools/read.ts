// Read File Tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { readFile, stat } from 'fs/promises';
import { normalize } from 'path';
import { checkFileSafety } from '../prompt/safety.js';

// Max file size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ReadFileSchema = Type.Object({
  path: Type.String({ description: 'The file path to read' }),
});

export const readFileTool: AgentTool<typeof ReadFileSchema, {} > = {
  name: 'read_file',
  description: 'Read the contents of a file at the given path.',
  parameters: ReadFileSchema,
  label: '📄 Read File',

  async execute(
    toolCallId: string,
    params: Static<typeof ReadFileSchema>,
    _signal?: AbortSignal
  ): Promise<AgentToolResult<{}>> {
    try {
      // Safety check - block sensitive paths
      const safety = checkFileSafety('read', params.path);
      if (!safety.allowed) {
        return {
          content: [{ type: 'text', text: `🚫 ${safety.message}` }],
          details: { blocked: true, reason: safety.message },
        };
      }

      // Path normalization to prevent traversal
      const normalized = normalize(params.path);

      // Check file size before reading
      const stats = await stat(normalized);
      if (stats.size > MAX_FILE_SIZE) {
        return {
          content: [{ type: 'text', text: `🚫 File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})` }],
          details: { blocked: true, reason: 'File size exceeded' },
        };
      }

      const content = await readFile(normalized, 'utf-8');
      return {
        content: [{ type: 'text', text: content }],
        details: { size: stats.size },
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        details: {},
      };
    }
  },
};

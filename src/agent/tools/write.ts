// Write File Tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

const WriteFileSchema = Type.Object({
  path: Type.String({ description: 'The file path to write' }),
  content: Type.String({ description: 'The content to write' }),
});

export const writeFileTool: AgentTool<typeof WriteFileSchema, {} > = {
  name: 'write_file',
  description: 'Write content to a file. Creates parent directories if needed.',
  parameters: WriteFileSchema,
  label: '📝 Write File',

  async execute(
    toolCallId: string,
    params: Static<typeof WriteFileSchema>,
    _signal?: AbortSignal
  ): Promise<AgentToolResult<{}>> {
    try {
      const dir = dirname(params.path);
      await mkdir(dir, { recursive: true });
      await writeFile(params.path, params.content, 'utf-8');
      return {
        content: [{ type: 'text', text: `File written: ${params.path}` }],
        details: {},
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        details: {},
      };
    }
  },
};

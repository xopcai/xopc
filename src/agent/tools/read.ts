// Read File Tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { readFile } from 'fs/promises';

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
      const content = await readFile(params.path, 'utf-8');
      return {
        content: [{ type: 'text', text: content }],
        details: {},
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

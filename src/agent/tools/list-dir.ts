// List Directory Tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { readdir } from 'fs/promises';

const ListDirSchema = Type.Object({
  path: Type.String({ description: 'The directory path to list' }),
});

export const listDirTool: AgentTool<typeof ListDirSchema, {} > = {
  name: 'list_dir',
  description: 'List the contents of a directory.',
  parameters: ListDirSchema,
  label: '📁 List Directory',

  async execute(
    toolCallId: string,
    params: Static<typeof ListDirSchema>,
    _signal?: AbortSignal
  ): Promise<AgentToolResult<{}>> {
    try {
      const entries = await readdir(params.path, { withFileTypes: true });
      const lines = entries.map((e) => {
        const type = e.isDirectory() ? 'd' : e.isFile() ? 'f' : '?';
        return `${type} ${e.name}`;
      });
      return {
        content: [{ type: 'text', text: lines.join('\n') || '(empty)' }],
        details: {},
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        details: {},
      };
    }
  },
};

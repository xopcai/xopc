// List Directory Tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { readdir } from 'fs/promises';
import { resolvePathUnderWorkspace } from './tool-paths.js';

const ListDirSchema = Type.Object({
  path: Type.String({ description: 'The directory path to list' }),
});

export function createListDirTool(workspace: string): AgentTool<typeof ListDirSchema, {}> {
  return {
    name: 'list_dir',
    description: 'List the contents of a directory. Relative paths are under the current agent workspace.',
    parameters: ListDirSchema,
    label: '📁 List Directory',

    async execute(
      _toolCallId: string,
      params: Static<typeof ListDirSchema>,
      _signal?: AbortSignal
    ): Promise<AgentToolResult<{}>> {
      try {
        const target = resolvePathUnderWorkspace(params.path, workspace);
        const entries = await readdir(target, { withFileTypes: true });
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
}

export const listDirTool: AgentTool<typeof ListDirSchema, {}> = createListDirTool(process.cwd());

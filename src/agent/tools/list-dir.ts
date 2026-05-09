// List Directory Tool
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { readdir } from 'fs/promises';
import { resolvePathUnderWorkspace } from './tool-paths.js';

const ListDirSchema = Type.Object({
  path: Type.String({ description: 'The directory path to list' }),
});

type ListDirParams = { path: string };

export function createListDirTool(workspace: string): AgentTool {
  return {
    name: 'list_dir',
    description: 'List the contents of a directory. Relative paths are under the current agent workspace.',
    parameters: ListDirSchema,
    label: '📁 List Directory',

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      try {
        const p = params as ListDirParams;
        const target = resolvePathUnderWorkspace(p.path, workspace);
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
  } as any;
}

export const listDirTool: AgentTool = createListDirTool(process.cwd());

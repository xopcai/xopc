// Write file tool
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { checkFileSafety } from '../prompt/safety.js';
import { resolvePathUnderWorkspace } from './tool-paths.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const WriteFileSchema = Type.Object({
  path: Type.String({ description: 'File path to write' }),
  content: Type.String({ description: 'Content to write' }),
});

type WriteFileParams = { path: string; content: string };

export function createWriteFileTool(workspace: string): AgentTool {
  return {
    name: 'write_file',
    description: 'Create or overwrite a file. Relative paths are under the current agent workspace.',
    parameters: WriteFileSchema,
    label: '📝 Write',

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      try {
        const p = params as WriteFileParams;
        const safety = checkFileSafety('write', p.path);
        if (!safety.allowed) {
          return { content: [{ type: 'text', text: `🚫 ${safety.message}` }], details: {} };
        }

        const contentBytes = Buffer.byteLength(p.content, 'utf-8');
        if (contentBytes > MAX_FILE_SIZE) {
          return { content: [{ type: 'text', text: `🚫 File too large: ${contentBytes} bytes` }], details: {} };
        }

        const target = resolvePathUnderWorkspace(p.path, workspace);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, p.content, 'utf-8');
        return { content: [{ type: 'text', text: `File written: ${target}` }], details: { size: contentBytes } };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], details: {} };
      }
    },
  } as any;
}

export const writeFileTool: AgentTool = createWriteFileTool(process.cwd());

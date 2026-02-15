// Read file tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { readFile, stat } from 'fs/promises';
import { normalize } from 'path';
import { checkFileSafety } from '../prompt/safety.js';
import { truncateHead, formatSize, DEFAULT_MAX_BYTES } from './truncate.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_LINES = 500;

const ReadFileSchema = Type.Object({
  path: Type.String({ description: 'File path to read' }),
  limit: Type.Optional(Type.Number({ description: 'Max lines (default: 500)' })),
});

export const readFileTool: AgentTool<typeof ReadFileSchema, {}> = {
  name: 'read_file',
  description: 'Read file contents.',
  parameters: ReadFileSchema,
  label: '📄 Read',

  async execute(
    toolCallId: string,
    params: Static<typeof ReadFileSchema>,
    _signal?: AbortSignal
  ): Promise<AgentToolResult<{}>> {
    try {
      const safety = checkFileSafety('read', params.path);
      if (!safety.allowed) {
        return { content: [{ type: 'text', text: `🚫 ${safety.message}` }], details: {} };
      }

      const normalized = normalize(params.path);
      const stats = await stat(normalized);

      if (stats.size > MAX_FILE_SIZE) {
        return { content: [{ type: 'text', text: `🚫 File too large: ${formatSize(stats.size)}` }], details: {} };
      }

      const content = await readFile(normalized, 'utf-8');
      const truncation = truncateHead(content, { maxLines: params.limit || DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });

      let outputText = truncation.content;
      if (truncation.truncated) {
        if (truncation.firstLineExceedsLimit) {
          outputText = `(Line exceeds ${formatSize(DEFAULT_MAX_BYTES)})`;
        } else {
          outputText += `\n\n[${truncation.outputLines}/${truncation.totalLines} lines]`;
        }
      }

      return { content: [{ type: 'text', text: outputText }], details: {} };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], details: {} };
    }
  },
};

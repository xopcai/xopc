// Read file tool
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { readFile, stat } from 'fs/promises';
import { checkFileSafety } from '../prompt/safety.js';
import { truncateHead, formatSize, DEFAULT_MAX_BYTES } from './truncate.js';
import {
  isBareProfileMarkdownFileName,
  resolveProfileMarkdownPathIfBareName,
  resolvePathUnderWorkspace,
} from './tool-paths.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_LINES = 500;

const ReadFileSchema = Type.Object({
  path: Type.String({ description: 'File path to read' }),
  offset: Type.Optional(Type.Integer({ minimum: 1, description: 'First line to read, one-based (default: 1)' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000, description: 'Max lines (default: 500)' })),
});

export interface CreateReadFileToolOptions {
  /** When set and the path is a bare profile filename (e.g. SOUL.md), try this root if not in workspace. */
  profileMarkdownRoot?: string;
}

type ReadFileParams = {
  path: string;
  offset?: number;
  limit?: number;
};

export function createReadFileTool(
  workspace: string,
  options?: CreateReadFileToolOptions,
): AgentTool {
  return {
    name: 'read_file',
    description:
      'Read file contents. Relative paths are from the current agent workspace; profile Markdown (SOUL.md, etc.) is found automatically when given by filename.',
    parameters: ReadFileSchema,
    label: '📄 Read',
    supportsParallel: true,
    idempotent: true,

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      return executeReadFile(workspace, options?.profileMarkdownRoot, params as ReadFileParams);
    },
  } as any;
}

async function executeReadFile(
  workspace: string,
  profileMarkdownRoot: string | undefined,
  params: ReadFileParams,
): Promise<AgentToolResult<{}>> {
  try {
    const safety = checkFileSafety('read', params.path);
    if (!safety.allowed) {
      return { content: [{ type: 'text', text: `🚫 ${safety.message}` }], details: { status: 'failed' } };
    }

    let normalized = resolvePathUnderWorkspace(params.path, workspace);
    let stats;
    try {
      stats = await stat(normalized);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (
        code === 'ENOENT' &&
        profileMarkdownRoot &&
        isBareProfileMarkdownFileName(params.path)
      ) {
        const alt = resolveProfileMarkdownPathIfBareName(params.path, profileMarkdownRoot);
        try {
          stats = await stat(alt);
          normalized = alt;
        } catch {
          throw e;
        }
      } else {
        throw e;
      }
    }

    if (stats.size > MAX_FILE_SIZE) {
      return { content: [{ type: 'text', text: `🚫 File too large: ${formatSize(stats.size)}` }], details: { status: 'failed' } };
    }

    const content = await readFile(normalized, 'utf-8');
    const offset = Math.max(1, params.offset ?? 1);
    const lines = content.split('\n');
    if (offset > lines.length) throw new Error(`Offset ${offset} exceeds ${lines.length} lines`);
    const selected = lines.slice(offset - 1).join('\n');
    const truncation = truncateHead(selected, { maxLines: params.limit || DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });

    let outputText = truncation.content;
    if (truncation.truncated) {
      if (truncation.firstLineExceedsLimit) {
        outputText = `(Line exceeds ${formatSize(DEFAULT_MAX_BYTES)})`;
      } else {
        outputText += `\n\n[Lines ${offset}-${offset + truncation.outputLines - 1} of ${lines.length}; continue with offset=${offset + truncation.outputLines}]`;
      }
    }

    return { content: [{ type: 'text', text: outputText }], details: { path: normalized, offset, totalLines: lines.length, truncated: truncation.truncated } };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], details: { status: 'failed' } };
  }
}

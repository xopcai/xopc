// Read file tool
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { readFile, stat } from 'fs/promises';
import { checkFileSafety } from '../prompt/safety.js';
import { truncateHead, formatSize, DEFAULT_MAX_BYTES } from './truncate.js';
import {
  isBareBootstrapFileName,
  resolveBootstrapPathIfBareName,
  resolvePathUnderWorkspace,
} from './tool-paths.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_LINES = 500;

const ReadFileSchema = Type.Object({
  path: Type.String({ description: 'File path to read' }),
  limit: Type.Optional(Type.Number({ description: 'Max lines (default: 500)' })),
});

export interface CreateReadFileToolOptions {
  /** When set and the path is a bare bootstrap name (e.g. SOUL.md), try this dir if not in workspace. */
  bootstrapDir?: string;
}

type ReadFileParams = {
  path: string;
  limit?: number;
};

export function createReadFileTool(
  workspace: string,
  options?: CreateReadFileToolOptions,
): AgentTool {
  return {
    name: 'read_file',
    description:
      'Read file contents. Relative paths are from the current agent workspace; persona files (SOUL.md, etc.) may live in agent bootstrap and are found automatically when given by filename.',
    parameters: ReadFileSchema,
    label: '📄 Read',

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      return executeReadFile(workspace, options?.bootstrapDir, params as ReadFileParams);
    },
  } as any;
}

async function executeReadFile(
  workspace: string,
  bootstrapDir: string | undefined,
  params: ReadFileParams,
): Promise<AgentToolResult<{}>> {
  try {
    const safety = checkFileSafety('read', params.path);
    if (!safety.allowed) {
      return { content: [{ type: 'text', text: `🚫 ${safety.message}` }], details: {} };
    }

    let normalized = resolvePathUnderWorkspace(params.path, workspace);
    let stats;
    try {
      stats = await stat(normalized);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (
        code === 'ENOENT' &&
        bootstrapDir &&
        isBareBootstrapFileName(params.path)
      ) {
        const alt = resolveBootstrapPathIfBareName(params.path, bootstrapDir);
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
}

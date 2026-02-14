// Write File Tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, resolve, normalize } from 'path';
import { checkFileSafety } from '../prompt/safety.js';

// Max file size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Resolve and validate file path
 */
function validatePath(filePath: string, allowedDir?: string): { valid: boolean; resolved?: string; error?: string } {
  // Normalize path to prevent directory traversal
  const normalized = normalize(filePath);
  const resolved = allowedDir ? resolve(allowedDir, normalized) : resolve(normalized);
  
  // If allowedDir specified, ensure resolved path is within it
  if (allowedDir && !resolved.startsWith(allowedDir + '/')) {
    return { valid: false, error: 'Path escapes allowed directory' };
  }
  
  return { valid: true, resolved };
}

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
      // Safety check - block sensitive paths
      const safety = checkFileSafety('write', params.path);
      if (!safety.allowed) {
        return {
          content: [{ type: 'text', text: `🚫 ${safety.message}` }],
          details: { blocked: true, reason: safety.message },
        };
      }

      // Path validation
      const pathValidation = validatePath(params.path);
      if (!pathValidation.valid) {
        return {
          content: [{ type: 'text', text: `🚫 Invalid path: ${pathValidation.error}` }],
          details: { blocked: true, reason: pathValidation.error },
        };
      }

      // Check file size
      const contentBytes = Buffer.byteLength(params.content, 'utf-8');
      if (contentBytes > MAX_FILE_SIZE) {
        return {
          content: [{ type: 'text', text: `🚫 File too large: ${contentBytes} bytes (max: ${MAX_FILE_SIZE})` }],
          details: { blocked: true, reason: 'File size exceeded' },
        };
      }

      const dir = dirname(params.path);
      await mkdir(dir, { recursive: true });
      await writeFile(params.path, params.content, 'utf-8');
      return {
        content: [{ type: 'text', text: `File written: ${params.path}` }],
        details: { size: contentBytes },
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

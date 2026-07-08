// Write file tool
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { checkFileSafety } from '../prompt/safety.js';
import {
  isBareProfileMarkdownFileName,
  resolveProfileMarkdownPathIfBareName,
  resolvePathUnderWorkspace,
} from './tool-paths.js';
import { evaluateFilePolicy } from '../sandbox/exec-policy.js';
import type { GoalEvidenceRecordInput } from './goal-evidence-recorder.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const WriteFileSchema = Type.Object({
  path: Type.String({ description: 'File path to write' }),
  content: Type.String({ description: 'Content to write' }),
});

type WriteFileParams = { path: string; content: string };

export interface CreateWriteFileToolOptions {
  /** When set and the path is a bare profile filename (e.g. SOUL.md), write to this root. */
  profileMarkdownRoot?: string;
  recordGoalEvidence?: (input: GoalEvidenceRecordInput) => Promise<void> | void;
}

export function createWriteFileTool(
  workspace: string,
  options?: CreateWriteFileToolOptions,
): AgentTool {
  return {
    name: 'write_file',
    description:
      'Create or overwrite a file. Relative paths are under the current agent workspace; profile Markdown (SOUL.md, etc.) is written automatically when given by filename.',
    parameters: WriteFileSchema,
    label: '📝 Write',
    mutatesWorkspace: true,
    mutationScope: 'workspace',
    supportsParallel: false,
    idempotent: false,
    requiresExclusiveWorkspaceLock: true,
    finalGuardRelevant: true,

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

        const writesProfileFile = Boolean(
          options?.profileMarkdownRoot && isBareProfileMarkdownFileName(p.path),
        );
        const workspaceRoot = writesProfileFile ? options!.profileMarkdownRoot! : workspace;

        // Sandbox path-policy check (blocked dirs, symlink escape, config protection)
        const pathPolicy = evaluateFilePolicy({
          operation: 'write',
          path: p.path,
          workspaceRoot,
        });
        if (!pathPolicy.allowed) {
          return { content: [{ type: 'text', text: `🚫 Sandbox: ${pathPolicy.reason}` }], details: {} };
        }

        const contentBytes = Buffer.byteLength(p.content, 'utf-8');
        if (contentBytes > MAX_FILE_SIZE) {
          return { content: [{ type: 'text', text: `🚫 File too large: ${contentBytes} bytes` }], details: {} };
        }

        const target = writesProfileFile
          ? resolveProfileMarkdownPathIfBareName(p.path, options!.profileMarkdownRoot!)
          : resolvePathUnderWorkspace(p.path, workspace);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, p.content, 'utf-8');
        await options?.recordGoalEvidence?.({
          kind: 'file',
          title: `File written: ${target}`,
          summary: `${contentBytes} bytes written`,
          uri: target,
          data: { path: target, size: contentBytes, operation: 'write' },
        });
        return { content: [{ type: 'text', text: `File written: ${target}` }], details: { size: contentBytes } };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], details: {} };
      }
    },
  } as any;
}

export const writeFileTool: AgentTool = createWriteFileTool(process.cwd());

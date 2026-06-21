// Edit file tool
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { readFile, writeFile, stat } from 'fs/promises';
import { checkFileSafety } from '../prompt/safety.js';
import {
  isBareProfileMarkdownFileName,
  resolveProfileMarkdownPathIfBareName,
  resolvePathUnderWorkspace,
} from './tool-paths.js';
import { evaluateFilePolicy } from '../sandbox/exec-policy.js';
import { normalizeToLF, restoreLineEndings, normalizeForFuzzyMatch, fuzzyFindText, stripBom, generateDiffString } from './edit-diff.js';
import type { GoalEvidenceRecordInput } from './goal-evidence-recorder.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const EditFileSchema = Type.Object({
  path: Type.String({ description: 'File path to edit' }),
  oldText: Type.String({ description: 'Text to replace' }),
  newText: Type.String({ description: 'Replacement text' }),
});

export interface EditToolDetails {
  diff?: string;
  firstChangedLine?: number;
  fuzzyMatchUsed?: boolean;
}

type EditFileParams = { path: string; oldText: string; newText: string };

export interface CreateEditFileToolOptions {
  /** When set and the path is a bare profile filename (e.g. SOUL.md), edit under this root. */
  profileMarkdownRoot?: string;
  recordGoalEvidence?: (input: GoalEvidenceRecordInput) => Promise<void> | void;
}

export function createEditFileTool(
  workspace: string,
  options?: CreateEditFileToolOptions,
): AgentTool {
  return {
    name: 'edit_file',
    description:
      'Edit file by replacing text. Relative paths are under the current agent workspace; profile Markdown (SOUL.md, etc.) is edited automatically when given by filename.',
    parameters: EditFileSchema,
    label: '✏️ Edit',

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<EditToolDetails>> {
      try {
        const p = params as EditFileParams;
        const safety = checkFileSafety('write', p.path);
        if (!safety.allowed) return { content: [{ type: 'text', text: `🚫 ${safety.message}` }], details: {} };

        const editsProfileFile = Boolean(
          options?.profileMarkdownRoot && isBareProfileMarkdownFileName(p.path),
        );
        const workspaceRoot = editsProfileFile ? options!.profileMarkdownRoot! : workspace;

        // Sandbox path-policy check (blocked dirs, symlink escape, config protection)
        const pathPolicy = evaluateFilePolicy({
          operation: 'edit',
          path: p.path,
          workspaceRoot,
        });
        if (!pathPolicy.allowed) {
          return { content: [{ type: 'text', text: `🚫 Sandbox: ${pathPolicy.reason}` }], details: {} };
        }

        const normalized = editsProfileFile
          ? resolveProfileMarkdownPathIfBareName(p.path, options!.profileMarkdownRoot!)
          : resolvePathUnderWorkspace(p.path, workspace);
        const stats = await stat(normalized);
        if (stats.size > MAX_FILE_SIZE) return { content: [{ type: 'text', text: `🚫 File too large` }], details: {} };

        const rawContent = await readFile(normalized, 'utf-8');
        const content = stripBom(rawContent);
        const lineEnding = detectLineEnding(rawContent);

        const normalizedContent = normalizeToLF(content);
        const normalizedOldText = normalizeToLF(p.oldText);
        const normalizedNewText = normalizeToLF(p.newText);

        const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);
        if (!matchResult.found) return { content: [{ type: 'text', text: `Error: oldText not found` }], details: {} };

        const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
        const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
        const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;
        if (occurrences > 1)
          return { content: [{ type: 'text', text: `Error: ${occurrences} occurrences found, text must be unique` }], details: {} };

        const baseContent = matchResult.contentForReplacement;
        const newContent =
          baseContent.substring(0, matchResult.index) +
          normalizedNewText +
          baseContent.substring(matchResult.index + matchResult.matchLength);
        const finalContent = restoreLineEndings(newContent, lineEnding);
        const originalWithReplacement = restoreLineEndings(baseContent, lineEnding);

        if (originalWithReplacement === finalContent)
          return { content: [{ type: 'text', text: `Error: No changes` }], details: {} };

        const diffResult = generateDiffString(originalWithReplacement, finalContent, normalized);
        await writeFile(normalized, finalContent, 'utf-8');
        await options?.recordGoalEvidence?.({
          kind: 'diff',
          title: `File edited: ${normalized}`,
          summary: diffResult.slice(0, 4000),
          uri: normalized,
          data: {
            path: normalized,
            fuzzyMatchUsed: matchResult.usedFuzzyMatch,
          },
        });

        return {
          content: [{ type: 'text', text: `File edited: ${normalized}` }],
          details: { diff: diffResult, fuzzyMatchUsed: matchResult.usedFuzzyMatch },
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          details: {},
        };
      }
    },
  } as any;
}

export const editFileTool: AgentTool = createEditFileTool(process.cwd());

function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfIdx = content.indexOf('\r\n');
  const lfIdx = content.indexOf('\n');
  if (lfIdx === -1) return '\n';
  if (crlfIdx === -1) return '\n';
  return crlfIdx < lfIdx ? '\r\n' : '\n';
}

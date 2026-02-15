// Edit file tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { readFile, writeFile, stat } from 'fs/promises';
import { normalize } from 'path';
import { checkFileSafety } from '../prompt/safety.js';
import { normalizeToLF, restoreLineEndings, normalizeForFuzzyMatch, fuzzyFindText, stripBom, generateDiffString } from './edit-diff.js';

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

export const editFileTool: AgentTool<typeof EditFileSchema, EditToolDetails> = {
  name: 'edit_file',
  description: 'Edit file by replacing text.',
  parameters: EditFileSchema,
  label: '✏️ Edit',

  async execute(toolCallId: string, params: Static<typeof EditFileSchema>, _signal?: AbortSignal): Promise<AgentToolResult<EditToolDetails>> {
    try {
      const safety = checkFileSafety('write', params.path);
      if (!safety.allowed) return { content: [{ type: 'text', text: `🚫 ${safety.message}` }], details: {} };

      const normalized = normalize(params.path);
      const stats = await stat(normalized);
      if (stats.size > MAX_FILE_SIZE) return { content: [{ type: 'text', text: `🚫 File too large` }], details: {} };

      const rawContent = await readFile(normalized, 'utf-8');
      const content = stripBom(rawContent);
      const lineEnding = detectLineEnding(rawContent);

      const normalizedContent = normalizeToLF(content);
      const normalizedOldText = normalizeToLF(params.oldText);
      const normalizedNewText = normalizeToLF(params.newText);

      const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);
      if (!matchResult.found) return { content: [{ type: 'text', text: `Error: oldText not found` }], details: {} };

      const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
      const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
      const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;
      if (occurrences > 1) return { content: [{ type: 'text', text: `Error: ${occurrences} occurrences found, text must be unique` }], details: {} };

      const baseContent = matchResult.contentForReplacement;
      const newContent = baseContent.substring(0, matchResult.index) + normalizedNewText + baseContent.substring(matchResult.index + matchResult.matchLength);
      const finalContent = restoreLineEndings(newContent, lineEnding);
      const originalWithReplacement = restoreLineEndings(baseContent, lineEnding);

      if (originalWithReplacement === finalContent) return { content: [{ type: 'text', text: `Error: No changes` }], details: {} };

      const diffResult = generateDiffString(originalWithReplacement, finalContent, params.path);
      await writeFile(params.path, finalContent, 'utf-8');

      return { content: [{ type: 'text', text: `File edited: ${params.path}` }], details: { diff: diffResult, fuzzyMatchUsed: matchResult.usedFuzzyMatch } };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], details: {} };
    }
  },
};

function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfIdx = content.indexOf('\r\n');
  const lfIdx = content.indexOf('\n');
  if (lfIdx === -1) return '\n';
  if (crlfIdx === -1) return '\n';
  return crlfIdx < lfIdx ? '\r\n' : '\n';
}

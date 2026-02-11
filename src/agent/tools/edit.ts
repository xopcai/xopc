// Edit File Tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { readFile, writeFile } from 'fs/promises';
import {
  normalizeToLF,
  restoreLineEndings,
  normalizeForFuzzyMatch,
  fuzzyFindText,
  stripBom,
  generateDiffString,
} from './edit-diff.js';

const EditFileSchema = Type.Object({
  path: Type.String({ description: 'The file path to edit' }),
  oldText: Type.String({ description: 'The text to replace (supports fuzzy matching for minor whitespace/formatting differences)' }),
  newText: Type.String({ description: 'The replacement text' }),
});

export interface EditToolDetails {
  diff?: string;
  firstChangedLine?: number;
  fuzzyMatchUsed?: boolean;
}

function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfIdx = content.indexOf('\r\n');
  const lfIdx = content.indexOf('\n');
  if (lfIdx === -1) return '\n';
  if (crlfIdx === -1) return '\n';
  return crlfIdx < lfIdx ? '\r\n' : '\n';
}

export const editFileTool: AgentTool<typeof EditFileSchema, EditToolDetails> = {
  name: 'edit_file',
  description: 'Replace oldText with newText in a file. Uses fuzzy matching for minor whitespace/formatting differences.',
  parameters: EditFileSchema,
  label: '✏️ Edit File',

  async execute(
    toolCallId: string,
    params: Static<typeof EditFileSchema>,
    _signal?: AbortSignal
  ): Promise<AgentToolResult<EditToolDetails>> {
    try {
      const rawContent = await readFile(params.path, 'utf-8');
      const { text: content } = stripBom(rawContent);
      const lineEnding = detectLineEnding(rawContent);

      const normalizedContent = normalizeToLF(content);
      const normalizedOldText = normalizeToLF(params.oldText);
      const normalizedNewText = normalizeToLF(params.newText);

      const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);

      if (!matchResult.found) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: oldText not found in file. The text must match exactly (with minor fuzzy matching for whitespace/formatting).`,
            },
          ],
          details: {},
        };
      }

      const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
      const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
      const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;

      if (occurrences > 1) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Found ${occurrences} occurrences of the text. The text must be unique. Please provide more context to make it unique.`,
            },
          ],
          details: {},
        };
      }

      const baseContent = matchResult.contentForReplacement;
      const newContent =
        baseContent.substring(0, matchResult.index) +
        normalizedNewText +
        baseContent.substring(matchResult.index + matchResult.matchLength);

      const finalContent = restoreLineEndings(newContent, lineEnding);
      const originalWithReplacement = restoreLineEndings(baseContent, lineEnding);

      if (originalWithReplacement === finalContent) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: No changes would be made. The replacement produces identical content.`,
            },
          ],
          details: {},
        };
      }

      const { diff, firstChangedLine } = generateDiffString(originalWithReplacement, finalContent);
      await writeFile(params.path, finalContent, 'utf-8');

      return {
        content: [{ type: 'text', text: `File edited: ${params.path}` }],
        details: {
          diff,
          firstChangedLine,
          fuzzyMatchUsed: matchResult.usedFuzzyMatch,
        },
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error editing file: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        details: {},
      };
    }
  },
};

// Edit File Tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { readFile, writeFile, stat } from 'fs/promises';
import { normalize } from 'path';
import { checkFileSafety } from '../prompt/safety.js';
import {
  normalizeToLF,
  restoreLineEndings,
  normalizeForFuzzyMatch,
  fuzzyFindText,
  stripBom,
  generateDiffString,
} from './edit-diff.js';

// Max file size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
      // Safety check - block sensitive paths
      const safety = checkFileSafety('write', params.path);
      if (!safety.allowed) {
        return {
          content: [{ type: 'text', text: `🚫 ${safety.message}` }],
          details: {},
        };
      }

      // Path normalization to prevent traversal
      const normalized = normalize(params.path);

      // Check file size before reading
      const stats = await stat(normalized);
      if (stats.size > MAX_FILE_SIZE) {
        return {
          content: [{ type: 'text', text: `🚫 File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})` }],
          details: {},
        };
      }

      const rawContent = await readFile(normalized, 'utf-8');
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

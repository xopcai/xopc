/**
 * /agent-edit — open the current chat as an agent profile editing session.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CommandContext, CommandDefinition } from './types.js';
import { commandRegistry } from './registry.js';
import { resolveAgentIdFromSessionKey } from '../routing/agent-session-key.js';
import { normalizeAgentId, resolveAgentProfileDir } from '../agent/agent-scope.js';
import { WORKSPACE_FILES } from '../config/paths.js';

const PROFILE_FILE_NAMES = [
  WORKSPACE_FILES.SOUL,
  WORKSPACE_FILES.IDENTITY,
  WORKSPACE_FILES.TOOLS,
  WORKSPACE_FILES.AGENTS,
  WORKSPACE_FILES.HEARTBEAT,
  WORKSPACE_FILES.MEMORY,
] as const;

const DEFAULT_PREVIEW_CHARS = 900;
const MAX_PREVIEW_CHARS = 4_000;

function parseArgs(args: string): { fileName?: string; previewChars: number } {
  const trimmed = args.trim();
  if (!trimmed) {
    return { previewChars: DEFAULT_PREVIEW_CHARS };
  }

  const parts = trimmed.split(/\s+/);
  let fileName: string | undefined;
  let previewChars = DEFAULT_PREVIEW_CHARS;

  for (const part of parts) {
    const limitMatch = /^--limit=(\d+)$/.exec(part);
    if (limitMatch) {
      previewChars = Math.min(Number(limitMatch[1]), MAX_PREVIEW_CHARS);
      continue;
    }
    if (!fileName) {
      fileName = part;
    }
  }

  return { fileName, previewChars };
}

function normalizeProfileFileName(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const basename = input.trim().replace(/\\/g, '/').split('/').pop();
  const matched = PROFILE_FILE_NAMES.find((name) => name.toLowerCase() === basename?.toLowerCase());
  return matched;
}

async function readPreview(path: string, limit: number): Promise<{ content: string; missing: boolean }> {
  try {
    const content = await readFile(path, 'utf-8');
    const trimmed = content.trimEnd();
    if (trimmed.length <= limit) {
      return { content: trimmed, missing: false };
    }
    return {
      content: `${trimmed.slice(0, limit)}\n\n… truncated, ask me to read the full file before editing …`,
      missing: false,
    };
  } catch {
    return { content: '', missing: true };
  }
}

function buildEditInstructions(agentId: string, fileNames: readonly string[]): string {
  const files = fileNames.map((name) => `\`${name}\``).join(', ');
  return [
    `You are editing agent \`${agentId}\`.`,
    '',
    'Tell me what to change, or say things like:',
    '- “Refine `SOUL.md` to sound warmer and more concise.”',
    '- “Update `IDENTITY.md` so this agent is focused on data analysis.”',
    '- “Read `SOUL.md` first, propose changes, then write them back.”',
    '',
    `Editable profile files: ${files}.`,
    'I can read and update these by bare filename with `read_file`, `apply_patch`, and `write_file`.',
  ].join('\n');
}

const agentEditCommand: CommandDefinition = {
  id: 'agent.edit',
  name: 'agent-edit',
  aliases: ['agentedit'],
  description: 'Show editable profile files for the current agent and prepare this chat for profile edits.',
  category: 'system',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/agent-edit', '/agent-edit SOUL.md', '/agent-edit IDENTITY.md --limit=2000'],
  handler: async (ctx: CommandContext, args: string) => {
    await ctx.setTyping(true);

    const { fileName: rawFileName, previewChars } = parseArgs(args);
    const fileName = normalizeProfileFileName(rawFileName);
    if (rawFileName && !fileName) {
      return {
        content: `⚠️ Unsupported profile file: \`${rawFileName}\`. Use one of: ${PROFILE_FILE_NAMES.map((name) => `\`${name}\``).join(', ')}.`,
        success: false,
      };
    }

    const agentId = normalizeAgentId(resolveAgentIdFromSessionKey(ctx.sessionKey));
    const profileDir = resolveAgentProfileDir(ctx.config, agentId);
    const namesToShow = fileName ? [fileName] : [WORKSPACE_FILES.SOUL, WORKSPACE_FILES.IDENTITY];

    const sections: string[] = [];
    for (const name of namesToShow) {
      const preview = await readPreview(join(profileDir, name), previewChars);
      if (preview.missing) {
        sections.push(`## ${name}\n_missing_`);
      } else {
        sections.push(`## ${name}\n\`\`\`markdown\n${preview.content}\n\`\`\``);
      }
    }

    return {
      content: [
        '🛠️ Agent editor mode',
        '',
        buildEditInstructions(agentId, PROFILE_FILE_NAMES),
        '',
        `Profile directory: \`${profileDir}\``,
        '',
        ...sections,
      ].join('\n'),
      success: true,
    };
  },
};

export function registerAgentEditCommand(): void {
  commandRegistry.register(agentEditCommand);
}

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { stripFrontMatter, DEFAULT_AGENTS_FILENAME } from '../context/workspace.js';
import type { EmbeddedContextFile } from './types.js';

const PROJECT_AGENTS_MAX_CHARS = 20_000;

function truncateProjectAgentsContent(content: string): string {
  if (content.length <= PROJECT_AGENTS_MAX_CHARS) {
    return content;
  }
  const suffix = `\n\n[Project AGENTS.md truncated to ${PROJECT_AGENTS_MAX_CHARS} characters]`;
  return `${content.slice(0, Math.max(0, PROJECT_AGENTS_MAX_CHARS - suffix.length)).trimEnd()}${suffix}`;
}

export function loadProjectAgentsContextFile(workspaceDir: string): EmbeddedContextFile | null {
  const agentsPath = resolve(join(workspaceDir, DEFAULT_AGENTS_FILENAME));
  if (!existsSync(agentsPath)) {
    return null;
  }

  try {
    const content = truncateProjectAgentsContent(stripFrontMatter(readFileSync(agentsPath, 'utf-8')).trim());
    if (!content) {
      return null;
    }
    return {
      path: agentsPath,
      content: [
        'Workspace AGENTS.md contains project-local instructions. Follow it for this workspace\'s coding conventions, commands, tests, and repository-specific workflows. If it conflicts with higher-priority system instructions, tool safety, or the user\'s explicit request, follow the higher-priority instruction.',
        '',
        content,
      ].join('\n'),
    };
  } catch {
    return null;
  }
}

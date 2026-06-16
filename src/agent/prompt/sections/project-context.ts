import type { EmbeddedContextFile } from '../../bootstrap/types.js';
import { DEFAULT_HEARTBEAT_FILENAME } from '../../context/workspace.js';

export const CONTEXT_FILE_ORDER = new Map<string, number>([
  ['agents.md', 10],
  ['soul.md', 20],
  ['identity.md', 30],
  ['user.md', 40],
  ['tools.md', 50],
  ['bootstrap.md', 60],
  ['memory.md', 70],
]);

export const DYNAMIC_CONTEXT_FILE_BASENAMES = new Set(['heartbeat.md']);

export const DEFAULT_HEARTBEAT_PROMPT_CONTEXT_BLOCK =
  'Default heartbeat prompt:\n`Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.`';

export function normalizeContextFilePath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/');
}

export function getContextFileBasename(pathValue: string): string {
  const normalizedPath = normalizeContextFilePath(pathValue);
  return (normalizedPath.split('/').pop() ?? normalizedPath).toLowerCase();
}

export function isDynamicContextFile(pathValue: string): boolean {
  return DYNAMIC_CONTEXT_FILE_BASENAMES.has(getContextFileBasename(pathValue));
}

export function sanitizeContextFileContentForPrompt(content: string): string {
  return content.replaceAll(DEFAULT_HEARTBEAT_PROMPT_CONTEXT_BLOCK, '').replace(/\n{3,}/g, '\n\n');
}

export function sortContextFilesForPrompt(contextFiles: EmbeddedContextFile[]): EmbeddedContextFile[] {
  return [...contextFiles].sort((a, b) => {
    const aBase = getContextFileBasename(a.path);
    const bBase = getContextFileBasename(b.path);
    const aOrder = CONTEXT_FILE_ORDER.get(aBase) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = CONTEXT_FILE_ORDER.get(bBase) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if (aBase !== bBase) {
      return aBase.localeCompare(bBase);
    }
    return normalizeContextFilePath(a.path).localeCompare(normalizeContextFilePath(b.path));
  });
}

export function buildProjectContextSection(params: {
  files: EmbeddedContextFile[];
  heading: string;
  dynamic: boolean;
}): string[] {
  if (params.files.length === 0) {
    return [];
  }
  const lines: string[] = [params.heading, ''];
  if (params.dynamic) {
    lines.push(
      'The following frequently-changing project context files are kept below the cache boundary when possible:',
      '',
    );
  } else {
    const hasSoulFile = params.files.some((file) => getContextFileBasename(file.path) === 'soul.md');
    lines.push('The following project context files have been loaded:');
    if (hasSoulFile) {
      lines.push(
        'If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.',
      );
    }
    lines.push('');
  }
  for (const file of params.files) {
    lines.push(`## ${file.path}`, '', sanitizeContextFileContentForPrompt(file.content), '');
  }
  return lines;
}

/** Whether HEARTBEAT.md is injected as dynamic context (vs behavior-only section). */
export function isHeartbeatContextFile(pathValue: string): boolean {
  return getContextFileBasename(pathValue) === DEFAULT_HEARTBEAT_FILENAME.toLowerCase();
}

/**
 * Workspace bootstrap files (names, load order, system prompt assembly) and
 * small helpers for message content extraction.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import { parseFrontmatter } from '../../markdown/frontmatter.js';

const log = createLogger('Workspace');

// =============================================================================
// Bootstrap filenames & types
// =============================================================================

export const DEFAULT_AGENTS_FILENAME = 'AGENTS.md';
export const DEFAULT_SOUL_FILENAME = 'SOUL.md';
export const DEFAULT_TOOLS_FILENAME = 'TOOLS.md';
export const DEFAULT_IDENTITY_FILENAME = 'IDENTITY.md';
export const DEFAULT_USER_FILENAME = 'USER.md';
export const DEFAULT_HEARTBEAT_FILENAME = 'HEARTBEAT.md';
export const DEFAULT_MEMORY_FILENAME = 'MEMORY.md';

export type WorkspaceBootstrapFileName =
  | typeof DEFAULT_AGENTS_FILENAME
  | typeof DEFAULT_SOUL_FILENAME
  | typeof DEFAULT_TOOLS_FILENAME
  | typeof DEFAULT_IDENTITY_FILENAME
  | typeof DEFAULT_USER_FILENAME
  | typeof DEFAULT_HEARTBEAT_FILENAME
  | typeof DEFAULT_MEMORY_FILENAME;

/**
 * Order for loading bootstrap files into the system prompt (persona / user before repo guide, etc.).
 */
export const BOOTSTRAP_FILES: readonly WorkspaceBootstrapFileName[] = [
  DEFAULT_SOUL_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
];

export interface WorkspaceBootstrapFile {
  name: WorkspaceBootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
}

/**
 * Strip YAML front matter from markdown content.
 */
export function stripFrontMatter(content: string): string {
  return parseFrontmatter(content).content;
}

// =============================================================================
// Load & truncate bootstrap files for system prompt
// =============================================================================

/** Maximum characters to inject from workspace files into system prompt */
export const BOOTSTRAP_MAX_CHARS = 20_000;

/** Bootstrap truncation: fraction of `maxChars` kept from the start of the file */
const HEAD_TRUNCATION_RATIO = 0.7;
/** Bootstrap truncation: fraction of `maxChars` kept from the end of the file */
const TAIL_TRUNCATION_RATIO = 0.2;

export interface TruncateResult {
  content: string;
  truncated: boolean;
  originalLength: number;
}

/**
 * Truncate workspace file content to prevent token overflow.
 * Keeps head (HEAD_TRUNCATION_RATIO, 70%) and tail (TAIL_TRUNCATION_RATIO, 20%) with a
 * truncation marker in between; the remainder is reserved for the marker.
 */
export function truncateBootstrapContent(content: string, maxChars: number): TruncateResult {
  const trimmed = content.trimEnd();
  if (trimmed.length <= maxChars) {
    return {
      content: trimmed,
      truncated: false,
      originalLength: trimmed.length,
    };
  }

  const headChars = Math.floor(maxChars * HEAD_TRUNCATION_RATIO);
  const tailChars = Math.floor(maxChars * TAIL_TRUNCATION_RATIO);
  const head = trimmed.slice(0, headChars);
  const tail = trimmed.slice(-tailChars);

  const marker = [
    '',
    '[...content truncated, read the full file for complete content...]',
    `...(truncated: kept ${headChars}+${tailChars} chars of ${trimmed.length})...`,
    '',
  ].join('\n');

  return {
    content: head + marker + tail,
    truncated: true,
    originalLength: trimmed.length,
  };
}

export interface BootstrapFile {
  name: WorkspaceBootstrapFileName;
  path?: string;
  content: string;
  missing?: boolean;
}

/**
 * Convert BootstrapFile to WorkspaceBootstrapFile format (adds required path field).
 */
export function toWorkspaceBootstrapFile(file: BootstrapFile, workspace: string): {
  name: WorkspaceBootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
} {
  return {
    name: file.name,
    path: file.path || join(workspace, file.name),
    content: file.missing ? undefined : file.content,
    missing: file.missing ?? false,
  };
}

/**
 * Load bootstrap files from workspace directory
 */
export function loadBootstrapFiles(bootstrapDir: string): BootstrapFile[] {
  const files: BootstrapFile[] = [];
  let loadedCount = 0;
  let missingCount = 0;

  for (const filename of BOOTSTRAP_FILES) {
    const filePath = join(bootstrapDir, filename);
    if (existsSync(filePath)) {
      try {
        let content = readFileSync(filePath, 'utf-8');

        content = stripFrontMatter(content);

        const result = truncateBootstrapContent(content, BOOTSTRAP_MAX_CHARS);

        if (result.content) {
          files.push({ name: filename, content: result.content });
          loadedCount++;

          if (result.truncated) {
            log.warn(
              {
                file: filename,
                originalLength: result.originalLength,
                keptLength: result.content.length,
              },
              'Bootstrap file truncated in system prompt (too long)',
            );
          } else {
            log.debug({ file: filename, path: filePath }, 'Bootstrap file loaded');
          }
        }
      } catch (err) {
        log.warn({ file: filename, err }, 'Failed to load bootstrap file');
      }
    } else {
      files.push({
        name: filename,
        content: `[MISSING] Create this file at: ${filePath}`,
        missing: true,
      });
      missingCount++;
      log.debug({ file: filename }, 'Bootstrap file missing');
    }
  }

  log.debug({ loaded: loadedCount, missing: missingCount, dir: bootstrapDir }, 'Workspace bootstrap files loaded');

  return files;
}

// =============================================================================
// Message content helpers
// =============================================================================

/**
 * Extract text content from agent message content array
 */
export function extractTextContent(
  content: Array<{ type: string; text?: string }>
): string {
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('');
}

const THINKING_BLOCK_TYPES = new Set(['thinking', 'thinking_delta', 'redacted_thinking']);

/**
 * Concatenate thinking / reasoning content blocks from assistant message.content.
 * pi-ai may use `thinking` or `text` on `type: "thinking"` blocks.
 */
export function extractThinkingContent(
  content: Array<{ type: string; thinking?: string; text?: string }> | undefined
): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => THINKING_BLOCK_TYPES.has(c.type))
    .map((c) => (typeof c.thinking === 'string' ? c.thinking : c.text) || '')
    .join('');
}

/**
 * Extended thinking on the assistant message (e.g. Anthropic reasoning / pi-ai reasoning_details).
 */
export function extractThinkingFromAssistantMessage(
  message: { role?: string; reasoning_details?: { thinking?: string } } | undefined
): string {
  if (!message || message.role !== 'assistant') return '';
  const t = message.reasoning_details?.thinking;
  return typeof t === 'string' ? t : '';
}

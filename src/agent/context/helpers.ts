/**
 * Agent service helper functions
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import { parseFrontmatter } from '../../markdown/frontmatter.js';
import type { WorkspaceBootstrapFileName } from './workspace.js';

const log = createLogger('AgentHelpers');

const BOOTSTRAP_FILES: WorkspaceBootstrapFileName[] = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'TOOLS.md',
  'AGENTS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
];

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
 * Strip YAML front matter from markdown content.
 * Uses parseFrontmatter from markdown/frontmatter for consistent handling.
 */
function stripFrontMatter(content: string): string {
  return parseFrontmatter(content).content;
}

/**
 * Truncate workspace file content to prevent token overflow.
 * Keeps head (HEAD_TRUNCATION_RATIO, 70%) and tail (TAIL_TRUNCATION_RATIO, 20%) with a
 * truncation marker in between; the remainder is reserved for the marker.
 *
 * @param content - Raw file content
 * @param maxChars - Maximum characters allowed
 * @returns Truncated content with metadata
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
 * Convert BootstrapFile to WorkspaceBootstrapFile format
 * Adds required path field
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
        
        // Strip YAML front matter (template metadata)
        content = stripFrontMatter(content);
        
        // Truncate if too long to prevent token overflow
        const result = truncateBootstrapContent(content, BOOTSTRAP_MAX_CHARS);
        
        if (result.content) {
          files.push({ name: filename, content: result.content });
          loadedCount++;
          
          if (result.truncated) {
            log.warn(
              { 
                file: filename, 
                originalLength: result.originalLength,
                keptLength: result.content.length 
              }, 
              'Bootstrap file truncated in system prompt (too long)'
            );
          } else {
            log.debug({ file: filename, path: filePath }, 'Bootstrap file loaded');
          }
        }
      } catch (err) {
        log.warn({ file: filename, err }, 'Failed to load bootstrap file');
      }
    } else {
      // Mark file as missing - will be shown in system prompt
      files.push({ 
        name: filename, 
        content: `[MISSING] Create this file at: ${filePath}`,
        missing: true 
      });
      missingCount++;
      log.debug({ file: filename }, 'Bootstrap file missing');
    }
  }

  log.debug(
    { loaded: loadedCount, missing: missingCount, dir: bootstrapDir }, 
    'Workspace bootstrap files loaded'
  );
  
  return files;
}

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

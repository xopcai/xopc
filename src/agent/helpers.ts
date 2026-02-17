/**
 * Agent service helper functions
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AgentHelpers');

const BOOTSTRAP_FILES = [
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

export interface TruncateResult {
  content: string;
  truncated: boolean;
  originalLength: number;
}

/**
 * Strip YAML front matter from markdown content.
 * Removes the ---
 * key: value
 * --- header if present.
 */
export function stripFrontMatter(content: string): string {
  if (!content.startsWith('---')) {
    return content;
  }
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return content;
  }
  return content.slice(endIndex + 4).replace(/^\s+/, '');
}

/**
 * Truncate workspace file content to prevent token overflow.
 * Keeps head (70%) and tail (20%) with a truncation marker in between.
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

  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = Math.floor(maxChars * 0.2);
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
  name: string;
  content: string;
  missing?: boolean;
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

  log.info(
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

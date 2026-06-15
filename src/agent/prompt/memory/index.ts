// Memory Search - FTS-backed recall with markdown file reads for snippets
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { createLogger } from '../../../utils/logger.js';
import {
  isXopcDatabaseOpen,
  openXopcDatabase,
  resolveAgentIdFromMemoriesDir,
  searchMemoryIndex,
  syncMemoryIndex,
} from '../../../storage/sqlite/index.js';

const log = createLogger('MemorySearch');

// =============================================================================
// Types (Internal)
// =============================================================================

interface MemoryMatch {
  file: string;
  lines: string;
  score: number;
  lineNumbers: number[];
}

export interface MemorySearchOptions {
  maxResults?: number;
  minScore?: number;
  /** Absolute path to agent-scoped curated memories dir (MEMORY.md + USER.md). */
  memoriesDir?: string;
  agentId?: string;
}

const CURATED_MEMORY_FILENAMES = new Set(['MEMORY.md', 'USER.md']);

function ensureMemoryDatabase(): void {
  if (!isXopcDatabaseOpen()) {
    openXopcDatabase();
  }
}

// =============================================================================
// Main Search Function (Exported)
// =============================================================================

export async function memorySearch(
  baseDir: string,
  query: string,
  options: MemorySearchOptions = {},
): Promise<MemoryMatch[]> {
  const { maxResults = 5, minScore = 0.3, memoriesDir, agentId } = options;
  const resolvedAgentId = agentId ?? resolveAgentIdFromMemoriesDir(memoriesDir);

  try {
    ensureMemoryDatabase();
    syncMemoryIndex({ agentId: resolvedAgentId, workspaceDir: baseDir, memoriesDir });
    const hits = searchMemoryIndex({
      agentId: resolvedAgentId,
      query,
      maxResults,
      minScore,
    });
    return hits.map((hit) => ({
      file: hit.path,
      lines: hit.lines,
      score: hit.score,
      lineNumbers: hit.lineNumbers,
    }));
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.warn({ err, errorMessage: em, agentId: resolvedAgentId }, `Memory FTS search failed: ${em}`);
    return [];
  }
}

// =============================================================================
// Memory Get (Read Snippet) (Exported)
// =============================================================================

export function memoryGet(
  baseDir: string,
  path: string,
  from?: number,
  lines?: number,
  memoriesDir?: string,
): { content: string; lineNumbers: { start: number; end: number } } | null {
  let fullPath = path.startsWith('/') ? path : join(baseDir, path);

  if (!existsSync(fullPath) && memoriesDir) {
    const segments = path.split(/[/\\]/);
    const filename = segments.pop() ?? path;
    if (CURATED_MEMORY_FILENAMES.has(filename)) {
      const candidatePath = join(memoriesDir, filename);
      if (existsSync(candidatePath)) {
        fullPath = candidatePath;
      }
    }
  }

  if (!existsSync(fullPath)) {
    return null;
  }

  const content = readFileSync(fullPath, 'utf-8');
  const allLines = content.split('\n');

  const start = from || 1;
  const count = lines || 10;
  const end = Math.min(start + count - 1, allLines.length);

  const snippet = allLines.slice(start - 1, end).join('\n');

  return {
    content: snippet,
    lineNumbers: { start, end },
  };
}

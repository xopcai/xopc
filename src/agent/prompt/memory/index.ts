// Memory Search - FTS-backed recall with markdown file reads for snippets
import { readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

import { createLogger } from '../../../utils/logger.js';
import {
  requireXopcDatabase,
  searchMemoryIndex,
  syncMemoryIndex,
} from '../../../storage/sqlite/index.js';
import { LOCAL_USER_ID } from '../../../user-context/owner.js';

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
  /** Absolute path to the shared curated memories dir (MEMORY.md). */
  memoriesDir?: string;
  /** Absolute path to global user memory (`~/.xopc/user/MEMORY.md`). */
  userMemoryPath?: string;
}

const AGENT_MEMORY_FILENAME = 'MEMORY.md';
const USER_MEMORY_DISPLAY_PATH = 'user/MEMORY.md';

function ensureMemoryDatabase(): void {
  requireXopcDatabase();
}

function fallbackMemorySearch(
  baseDir: string,
  query: string,
  options: Required<Pick<MemorySearchOptions, 'maxResults' | 'minScore'>> &
    Pick<MemorySearchOptions, 'memoriesDir' | 'userMemoryPath'>,
): MemoryMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const memoriesDir = options.memoriesDir;
  const curatedPaths = [
    ...(memoriesDir ? [join(memoriesDir, AGENT_MEMORY_FILENAME)].filter((path) => existsSync(path)) : []),
    ...(options.userMemoryPath && existsSync(options.userMemoryPath) ? [options.userMemoryPath] : []),
  ];
  const candidatePaths = [...curatedPaths, join(baseDir, 'MEMORY.md')].filter((path) => existsSync(path));

  const matches: MemoryMatch[] = [];
  for (const path of candidatePaths) {
    const content = readFileSync(path, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.toLowerCase().includes(normalizedQuery)) continue;
      const score = 1;
      if (score < options.minScore) continue;
      const file =
        options.userMemoryPath && path === options.userMemoryPath
          ? USER_MEMORY_DISPLAY_PATH
          : memoriesDir && path.startsWith(memoriesDir)
            ? path.slice(memoriesDir.length).replace(/^[/\\]/, '')
            : relative(baseDir, path).replace(/\\/g, '/');
      matches.push({ file, lines: line, score, lineNumbers: [i + 1] });
    }
  }

  return matches.slice(0, options.maxResults);
}

// =============================================================================
// Main Search Function (Exported)
// =============================================================================

export async function memorySearch(
  baseDir: string,
  query: string,
  options: MemorySearchOptions = {},
): Promise<MemoryMatch[]> {
  const { maxResults = 5, minScore = 0.3, memoriesDir, userMemoryPath } = options;

  try {
    ensureMemoryDatabase();
    syncMemoryIndex({ userId: LOCAL_USER_ID, workspaceDir: baseDir, memoriesDir, userMemoryPath });
    const hits = searchMemoryIndex({
      userId: LOCAL_USER_ID,
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
    log.warn({ err, errorMessage: em }, `Memory FTS search failed: ${em}`);
    return fallbackMemorySearch(baseDir, query, { maxResults, minScore, memoriesDir, userMemoryPath });
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
  userMemoryPath?: string,
): { content: string; lineNumbers: { start: number; end: number } } | null {
  let fullPath = path.startsWith('/') ? path : join(baseDir, path);

  if (!existsSync(fullPath)) {
    const normalized = path.replace(/\\/g, '/');
    if (normalized === USER_MEMORY_DISPLAY_PATH && userMemoryPath && existsSync(userMemoryPath)) {
      fullPath = userMemoryPath;
    } else if (memoriesDir) {
      const segments = normalized.split('/');
      const filename = segments.pop() ?? normalized;
      if (filename === AGENT_MEMORY_FILENAME) {
        const candidatePath = join(memoriesDir, AGENT_MEMORY_FILENAME);
        if (existsSync(candidatePath)) {
          fullPath = candidatePath;
        }
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

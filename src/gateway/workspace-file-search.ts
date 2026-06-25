import { basename } from 'node:path';

import { createLogger } from '../utils/logger.js';
import { listWorkspaceRelativeFilesFsFallback } from './workspace-fs-file-list.js';
import { runRipgrepListFiles } from './workspace-ripgrep.js';

const log = createLogger('WorkspaceFileSearch');

export const FILE_SEARCH_MAX_LIMIT = 50;

export interface WorkspaceFileSearchEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** Subsequence fuzzy match: all query chars appear in order in `candidate` (case-insensitive). */
export function fuzzySubsequenceScore(query: string, candidate: string): number | null {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (q.length === 0) return 0;
  let qi = 0;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) qi++;
  }
  if (qi < q.length) return null;
  const base = c.split('/').pop() ?? c;
  let score = 10;
  if (c.startsWith(q)) score += 40;
  if (base.startsWith(q)) score += 35;
  else if (base.includes(q)) score += 20;
  else if (c.includes(q)) score += 10;
  score -= c.length * 0.0001;
  return score;
}

export async function fuzzySearchWorkspaceFiles(
  workspaceRoot: string,
  query: string,
  limit: number,
): Promise<WorkspaceFileSearchEntry[]> {
  let files = await runRipgrepListFiles(workspaceRoot);
  if (files.length === 0) {
    files = await listWorkspaceRelativeFilesFsFallback(workspaceRoot, 120_000);
    if (files.length > 0) {
      log.debug(
        { workspaceRoot, fileCount: files.length },
        'workspace files/search: file list from fs walk (ripgrep unavailable or returned empty)',
      );
    }
  }
  const q = query.trim();
  const capped = Math.min(Math.max(limit, 1), FILE_SEARCH_MAX_LIMIT);

  type Row = WorkspaceFileSearchEntry & { score: number };
  const rows: Row[] = [];

  if (!q) {
    const sorted = [...files].sort((a, b) => a.localeCompare(b));
    for (const rel of sorted.slice(0, capped)) {
      rows.push({ name: basename(rel), path: rel, isDirectory: false, score: 0 });
    }
    return rows.map(({ name, path, isDirectory }) => ({ name, path, isDirectory }));
  }

  for (const rel of files) {
    const name = basename(rel);
    const scorePath = fuzzySubsequenceScore(q, rel);
    const scoreName = fuzzySubsequenceScore(q, name);
    const score = Math.max(scorePath ?? -Infinity, scoreName ?? -Infinity);
    if (score === -Infinity) continue;
    rows.push({ name, path: rel, isDirectory: false, score });
  }

  rows.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return rows.slice(0, capped).map(({ name, path, isDirectory }) => ({ name, path, isDirectory }));
}

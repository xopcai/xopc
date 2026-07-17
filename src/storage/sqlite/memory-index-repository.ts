import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { buildFts5SearchQuery, fts5RankToScore, memoryLexicalSimilarity } from './fts.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type MemorySearchHit = {
  path: string;
  lines: string;
  score: number;
  lineNumbers: number[];
};

const AGENT_MEMORY_FILENAME = 'MEMORY.md';
const USER_MEMORY_DISPLAY_PATH = 'user/MEMORY.md';
const MEMORY_SYNC_CACHE_TTL_MS = 30_000;

type MemorySyncCache = {
  timestamp: number;
  paths: string[];
};

const memorySyncCache = new Map<string, MemorySyncCache>();

export function resolveAgentIdFromMemoriesDir(memoriesDir: string | undefined): string {
  if (!memoriesDir) return 'main';
  const normalized = memoriesDir.replace(/\\/g, '/');
  const match = normalized.match(/\/agents\/([^/]+)\/memories\/?$/);
  return match?.[1] ?? 'main';
}

function getDailyMemoryPath(baseDir: string, date?: Date): string {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return join(baseDir, 'memory', `${year}-${month}-${day}.md`);
}

function getCuratedMemoryPaths(memoriesDir: string | undefined, userMemoryPath: string | undefined): string[] {
  return [
    ...(memoriesDir ? [join(memoriesDir, AGENT_MEMORY_FILENAME)] : []),
    ...(userMemoryPath ? [userMemoryPath] : []),
  ].filter((p) => existsSync(p));
}

function collectMemoryPaths(baseDir: string, memoriesDir?: string, userMemoryPath?: string): string[] {
  const paths: string[] = [];
  paths.push(...getCuratedMemoryPaths(memoriesDir, userMemoryPath));

  const longTermPath = join(baseDir, 'MEMORY.md');
  if (existsSync(longTermPath)) {
    paths.push(longTermPath);
  }

  const memoryDir = join(baseDir, 'memory');
  if (existsSync(memoryDir)) {
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const path = getDailyMemoryPath(baseDir, date);
      if (existsSync(path)) {
        paths.push(path);
      }
    }
  }

  return paths;
}

function displayPath(
  baseDir: string,
  memoriesDir: string | undefined,
  userMemoryPath: string | undefined,
  absPath: string,
): string {
  const normalized = absPath.replace(/\\/g, '/');
  if (userMemoryPath && normalized === userMemoryPath.replace(/\\/g, '/')) {
    return USER_MEMORY_DISPLAY_PATH;
  }
  if (memoriesDir) {
    const memoriesRoot = memoriesDir.replace(/\\/g, '/');
    if (normalized.startsWith(memoriesRoot)) {
      const filename = normalized.slice(memoriesRoot.length).replace(/^\//, '');
      if (filename === AGENT_MEMORY_FILENAME) {
        return filename;
      }
    }
  }
  return relative(baseDir, absPath).replace(/\\/g, '/');
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function indexFile(
  db: ReturnType<typeof getSqliteDatabase>,
  agentId: string,
  baseDir: string,
  memoriesDir: string | undefined,
  userMemoryPath: string | undefined,
  absPath: string,
): void {
  const content = readFileSync(absPath, 'utf-8');
  const mtimeMs = statSync(absPath).mtimeMs;
  const hash = contentHash(content);
  const relPath = displayPath(baseDir, memoriesDir, userMemoryPath, absPath);
  const fileId = `${agentId}:${relPath}`;

  const existing = db
    .prepare(`SELECT content_hash, mtime_ms FROM memory_files WHERE file_id = ?`)
    .get(fileId) as { content_hash: string; mtime_ms: number } | undefined;
  if (existing && existing.content_hash === hash && existing.mtime_ms === mtimeMs) {
    return;
  }

  db.prepare(`DELETE FROM memory_fts WHERE chunk_id IN (SELECT chunk_id FROM memory_chunks WHERE file_id = ?)`).run(
    fileId,
  );
  db.prepare(`DELETE FROM memory_chunks WHERE file_id = ?`).run(fileId);
  db.prepare(`DELETE FROM memory_files WHERE file_id = ?`).run(fileId);

  db.prepare(
    `INSERT INTO memory_files (file_id, agent_id, path, mtime_ms, content_hash)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(fileId, agentId, relPath, mtimeMs, hash);

  const lines = content.split('\n');
  const insertChunk = db.prepare(
    `INSERT INTO memory_chunks (chunk_id, file_id, start_line, end_line, content)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertFts = db.prepare(
    `INSERT INTO memory_fts (content, chunk_id, agent_id, path, start_line, end_line)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const lineNo = i + 1;
    const chunkId = `${fileId}:${lineNo}`;
    insertChunk.run(chunkId, fileId, lineNo, lineNo, line);
    insertFts.run(line, chunkId, agentId, relPath, lineNo, lineNo);
  }
}

export function syncMemoryIndex(params: {
  agentId: string;
  workspaceDir: string;
  memoriesDir?: string;
  userMemoryPath?: string;
}): void {
  const cacheKey = `${params.agentId}:${params.workspaceDir}:${params.memoriesDir ?? ''}:${params.userMemoryPath ?? ''}`;
  const now = Date.now();
  const cached = memorySyncCache.get(cacheKey);
  if (cached && now - cached.timestamp < MEMORY_SYNC_CACHE_TTL_MS) {
    return;
  }

  const paths = collectMemoryPaths(params.workspaceDir, params.memoriesDir, params.userMemoryPath);
  memorySyncCache.set(cacheKey, { timestamp: now, paths });
  runSqliteWriteTransaction((db) => {
    const seen = new Set<string>();
    for (const absPath of paths) {
      seen.add(`${params.agentId}:${displayPath(params.workspaceDir, params.memoriesDir, params.userMemoryPath, absPath)}`);
      indexFile(db, params.agentId, params.workspaceDir, params.memoriesDir, params.userMemoryPath, absPath);
    }

    const stale = db
      .prepare(`SELECT file_id FROM memory_files WHERE agent_id = ?`)
      .all(params.agentId) as Array<{ file_id: string }>;
    for (const row of stale) {
      if (!seen.has(row.file_id)) {
        db.prepare(
          `DELETE FROM memory_fts WHERE chunk_id IN (SELECT chunk_id FROM memory_chunks WHERE file_id = ?)`,
        ).run(row.file_id);
        db.prepare(`DELETE FROM memory_chunks WHERE file_id = ?`).run(row.file_id);
        db.prepare(`DELETE FROM memory_files WHERE file_id = ?`).run(row.file_id);
      }
    }
  });
}

export function searchMemoryIndex(params: {
  agentId: string;
  query: string;
  maxResults?: number;
  minScore?: number;
}): MemorySearchHit[] {
  const { agentId, query, maxResults = 5, minScore = 0.3 } = params;
  const ftsQuery = buildFts5SearchQuery(query);
  if (!ftsQuery) {
    return [];
  }

  const db = getSqliteDatabase();
  const rows = db
    .prepare(
      `SELECT chunk_id, path, start_line, end_line, content, bm25(memory_fts) AS rank
       FROM memory_fts
       WHERE memory_fts MATCH ? AND agent_id = ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(ftsQuery, agentId, maxResults * 3) as Array<{
    chunk_id: string;
    path: string;
    start_line: number;
    end_line: number;
    content: string;
    rank: number;
  }>;

  if (rows.length === 0) {
    const fallbackRows = db.prepare(
      `SELECT chunk_id, path, start_line, end_line, content
       FROM memory_fts
       WHERE agent_id = ?
       LIMIT 500`,
    ).all(agentId) as Array<{
      chunk_id: string;
      path: string;
      start_line: number;
      end_line: number;
      content: string;
    }>;
    return fallbackRows
      .map((row) => ({
        path: row.path,
        lines: row.content,
        score: memoryLexicalSimilarity(query, row.content),
        lineNumbers: [row.start_line],
      }))
      .filter((result) => result.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  const bestRank = Math.min(...rows.map((row) => row.rank));
  const worstRank = Math.max(...rows.map((row) => row.rank));
  const results: MemorySearchHit[] = [];
  for (const row of rows) {
    const score = fts5RankToScore(row.rank, bestRank, worstRank);
    if (score < minScore) continue;
    results.push({
      path: row.path,
      lines: row.content,
      score,
      lineNumbers: [row.start_line],
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

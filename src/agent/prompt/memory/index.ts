// Memory Search - Semantic memory recall system
import { readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

// =============================================================================
// Types (Internal)
// =============================================================================

interface MemoryMatch {
  file: string;
  lines: string;
  score: number;
  lineNumbers: number[];
}

interface MemorySearchOptions {
  maxResults?: number;
  minScore?: number;
}

interface MemoryFile {
  path: string;
  content: string;
  modified: Date;
}

// =============================================================================
// Memory Path Utilities (Internal)
// =============================================================================

function getDailyMemoryPath(baseDir: string, date?: Date): string {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return join(baseDir, `memory`, `${year}-${month}-${day}.md`);
}

function getLongTermMemoryPath(baseDir: string): string {
  return join(baseDir, 'MEMORY.md');
}

function getAllMemoryPaths(baseDir: string): string[] {
  const paths: string[] = [];
  
  // Long-term memory
  const longTermPath = getLongTermMemoryPath(baseDir);
  if (existsSync(longTermPath)) {
    paths.push(longTermPath);
  }
  
  // Daily memories (last 30 days)
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

// =============================================================================
// Content Parsing (Internal)
// =============================================================================

function parseMemoryFile(path: string): MemoryFile {
  const content = readFileSync(path, 'utf-8');
  const stats = existsSync(path) ? { mtime: new Date() } : { mtime: new Date() };
  
  return {
    path,
    content,
    modified: stats.mtime,
  };
}

// =============================================================================
// Simple Fuzzy Search (Internal)
// =============================================================================

function fuzzyMatch(query: string, text: string): number {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  
  // Exact match
  if (textLower.includes(queryLower)) {
    return 1.0;
  }
  
  // Word-by-word match
  const queryWords = queryLower.split(/\s+/);
  const textWords = textLower.split(/\s+/);
  
  let matchedWords = 0;
  for (const qWord of queryWords) {
    if (textWords.some(tWord => tWord.includes(qWord) || qWord.includes(tWord))) {
      matchedWords++;
    }
  }
  
  return matchedWords / queryWords.length;
}

function searchInContent(query: string, content: string, options: MemorySearchOptions = {}): MemoryMatch | null {
  const { maxResults = 5, minScore = 0.3 } = options;
  
  const lines = content.split('\n');
  const matches: Array<{ line: string; index: number; score: number }> = [];
  
  for (let i = 0; i < lines.length; i++) {
    const score = fuzzyMatch(query, lines[i]);
    if (score >= minScore) {
      matches.push({ line: lines[i], index: i, score });
    }
  }
  
  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);
  
  if (matches.length === 0) {
    return null;
  }
  
  // Take top matches
  const topMatches = matches.slice(0, maxResults);
  const lineNumbers = topMatches.map(m => m.index + 1);
  const linesContent = topMatches.map(m => m.line).join('\n');
  
  return {
    file: '', // Will be set by caller
    lines: linesContent,
    score: topMatches[0].score,
    lineNumbers,
  };
}

// =============================================================================
// Main Search Function (Exported)
// =============================================================================

export async function memorySearch(
  baseDir: string,
  query: string,
  options: MemorySearchOptions = {}
): Promise<MemoryMatch[]> {
  const { maxResults = 5, minScore = 0.3 } = options;
  
  const paths = getAllMemoryPaths(baseDir);
  const results: MemoryMatch[] = [];
  
  for (const path of paths) {
    try {
      const memoryFile = parseMemoryFile(path);
      const match = searchInContent(query, memoryFile.content, options);
      
      if (match) {
        match.file = relative(baseDir, path);
        if (match.score >= minScore) {
          results.push(match);
        }
      }
    } catch {
      // Skip files that can't be read
      console.warn(`Could not read memory file: ${path}`);
    }
  }
  
  // Sort all results by score
  results.sort((a, b) => b.score - a.score);
  
  // Return top results per file or overall
  return results.slice(0, maxResults * 3); // Return more to allow grouping
}

// =============================================================================
// Memory Get (Read Snippet) (Exported)
// =============================================================================

export function memoryGet(
  baseDir: string,
  path: string,
  from?: number,
  lines?: number
): { content: string; lineNumbers: { start: number; end: number } } | null {
  const fullPath = path.startsWith('/') ? path : join(baseDir, path);
  
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

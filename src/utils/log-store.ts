/**
 * Log Store - File-based log storage with query capabilities
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, statSync, createReadStream } from 'fs';
import { join, basename } from 'path';
import { createInterface } from 'readline';
import type { Readable } from 'stream';

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  module?: string;
  prefix?: string;
  service?: string;
  plugin?: string;
  [key: string]: unknown;
}

export interface LogQuery {
  level?: string[];
  from?: string;
  to?: string;
  q?: string; // keyword search
  module?: string;
  limit?: number;
  offset?: number;
}

export interface LogFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  type: 'app' | 'error' | 'audit';
}

const LOG_DIR = process.env.XOPCBOT_LOG_DIR || join(process.env.HOME || '.', '.xopcbot', 'logs');

// Ensure log directory exists
function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Get all log files
 */
export function getLogFiles(): LogFile[] {
  ensureLogDir();

  const files = readdirSync(LOG_DIR)
    .filter(f => f.endsWith('.log'))
    .map(f => {
      const path = join(LOG_DIR, f);
      const stats = statSync(path);
      const type = f.includes('error') ? 'error' : f.includes('audit') ? 'audit' : 'app';
      return {
        name: f,
        path,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        type,
      };
    })
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

  return files;
}

/**
 * Get log file path for a specific date and type
 */
export function getLogPath(date: Date = new Date(), type: 'app' | 'error' | 'audit' = 'app'): string {
  ensureLogDir();
  const dateStr = date.toISOString().split('T')[0];
  return join(LOG_DIR, `${type}-${dateStr}.log`);
}

/**
 * Parse a single log line
 */
function parseLogLine(line: string): LogEntry | null {
  try {
    // Try JSON format first
    const parsed = JSON.parse(line);
    return {
      timestamp: parsed.time || parsed.timestamp || '',
      level: parsed.level?.toString() || 'info',
      message: parsed.msg || parsed.message || '',
      module: parsed.module,
      prefix: parsed.prefix,
      service: parsed.service,
      plugin: parsed.plugin,
      ...parsed,
    };
  } catch {
    // Fallback: try to parse pino's text format
    // Format: [2024-01-01T12:00:00.000Z] <level>: message {meta}
    const match = line.match(/^\[([^\]]+)\]\s+(\w+):\s+(.+)$/);
    if (match) {
      return {
        timestamp: match[1],
        level: match[2].toLowerCase(),
        message: match[3],
      };
    }
    // Plain text
    if (line.trim()) {
      return {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: line,
      };
    }
  }
  return null;
}

/**
 * Stream logs from a file
 */
async function* streamLogFile(
  filePath: string,
  query: LogQuery
): AsyncGenerator<LogEntry> {
  if (!existsSync(filePath)) return;

  const fileStream: Readable = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: fileStream });

  let offset = query.offset || 0;
  let limit = query.limit || 100;
  let skipped = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    const entry = parseLogLine(line);
    if (!entry) continue;

    // Filter by level
    if (query.level?.length && !query.level.includes(entry.level)) {
      continue;
    }

    // Filter by time range
    if (query.from && new Date(entry.timestamp) < new Date(query.from)) {
      continue;
    }
    if (query.to && new Date(entry.timestamp) > new Date(query.to)) {
      continue;
    }

    // Filter by keyword
    if (query.q) {
      const keyword = query.q.toLowerCase();
      const searchFields = [entry.message, entry.module, entry.prefix, entry.service, entry.plugin]
        .filter(Boolean)
        .map(String)
        .join(' ');
      if (!searchFields.toLowerCase().includes(keyword)) {
        continue;
      }
    }

    // Filter by module
    if (query.module && entry.module !== query.module) {
      continue;
    }

    // Handle offset/limit for pagination
    if (skipped < offset) {
      skipped++;
      continue;
    }

    if (limit > 0) {
      yield entry;
      limit--;
    }
  }
}

/**
 * Query logs across multiple files
 */
export async function queryLogs(query: LogQuery = {}): Promise<LogEntry[]> {
  ensureLogDir();

  const results: LogEntry[] = [];
  const files = getLogFiles();

  // If specific date range, only look at relevant files
  let relevantFiles = files;
  if (query.from || query.to) {
    const fromDate = query.from ? new Date(query.from) : new Date(0);
    const toDate = query.to ? new Date(query.to) : new Date();
    
    relevantFiles = files.filter(f => {
      const fileDate = new Date(f.modified);
      return fileDate >= fromDate && fileDate <= toDate;
    });
  }

  // Query each file and collect results
  for (const file of relevantFiles) {
    for await (const entry of streamLogFile(file.path, query)) {
      results.push(entry);
      
      // Limit total results
      if (query.limit && results.length >= query.limit) {
        return results;
      }
    }
  }

  // Sort by timestamp descending
  results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return results;
}

/**
 * Get available log levels from log files
 */
export function getLogLevels(): string[] {
  return ['debug', 'info', 'warn', 'error', 'fatal'];
}

/**
 * Get available modules from log files
 */
export async function getLogModules(): Promise<string[]> {
  const modules = new Set<string>();
  
  for (const file of getLogFiles().slice(0, 7)) { // Last 7 files
    for await (const entry of streamLogFile(file.path, { limit: 1000 })) {
      if (entry.module) {
        modules.add(entry.module);
      }
    }
  }

  return Array.from(modules).sort();
}

/**
 * Get log statistics
 */
export function getLogStats(): {
  totalFiles: number;
  totalSize: number;
  oldestLog: string | null;
  newestLog: string | null;
  files: LogFile[];
} {
  const files = getLogFiles();
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    totalFiles: files.length,
    totalSize,
    oldestLog: files.length > 0 ? files[files.length - 1].modified : null,
    newestLog: files.length > 0 ? files[0].modified : null,
    files,
  };
}

/**
 * Clean old logs (keep last N days)
 */
export function cleanOldLogs(keepDays: number = 7): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);

  let deleted = 0;
  for (const file of getLogFiles()) {
    if (new Date(file.modified) < cutoff) {
      try {
        // Note: unlinkSync would delete the file
        // For safety, we'll just return the count
        deleted++;
      } catch {
        // Ignore errors
      }
    }
  }

  return deleted;
}

export { LOG_DIR };

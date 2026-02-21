/**
 * Log Store - Enhanced File-based Log Storage
 * 
 * Features:
 * - Query logs across multiple files with filtering
 * - Support for compressed (.gz) log files
 * - Pagination and sorting
 * - Statistics and analytics
 * - Safe log cleanup with actual deletion
 */

import { 
  existsSync, 
  mkdirSync, 
  readdirSync, 
  statSync, 
  createReadStream,
  unlinkSync,
  readFileSync,
} from 'fs';
import { readFile } from 'fs/promises';
import { join, basename } from 'path';
import { createInterface } from 'readline';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import { Readable } from 'stream';
import type { LogLevel, LogFileMeta, LogQuery, LogStats, LogEntry } from './logger.types.js';

const gunzipAsync = promisify(gunzip);

// ============================================
// Types
// ============================================

interface ParsedLogEntry extends LogEntry {
  _source?: string;
  _lineNumber?: number;
}

// ============================================
// Configuration
// ============================================

const LOG_DIR = process.env.XOPCBOT_LOG_DIR || join(process.env.HOME || '.', '.xopcbot', 'logs');

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

// ============================================
// File Management
// ============================================

/**
 * Get all log files (including compressed)
 */
export function getLogFiles(): LogFileMeta[] {
  ensureLogDir();

  const files = readdirSync(LOG_DIR)
    .filter(f => f.endsWith('.log') || f.endsWith('.log.gz'))
    .map(f => {
      const filePath = join(LOG_DIR, f);
      const stats = statSync(filePath);
      
      let type: LogFileMeta['type'] = 'app';
      if (f.includes('error')) type = 'error';
      else if (f.includes('audit')) type = 'audit';
      else if (f.includes('access')) type = 'access';

      return {
        name: f,
        path: filePath,
        size: stats.size,
        created: stats.birthtime.toISOString(),
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
export function getLogPath(
  date: Date = new Date(), 
  type: 'app' | 'error' | 'audit' | 'access' = 'app'
): string {
  ensureLogDir();
  const dateStr = date.toISOString().split('T')[0];
  return join(LOG_DIR, `${type}-${dateStr}.log`);
}

/**
 * Get available log files for a date range
 */
export function getLogFilesForRange(from: Date, to: Date): LogFileMeta[] {
  const allFiles = getLogFiles();
  
  return allFiles.filter(f => {
    // Extract date from filename (e.g., app-2024-01-01.log)
    const match = f.name.match(/(\d{4}-\d{2}-\d{2})/);
    if (!match) return false;
    
    const fileDate = new Date(match[1]);
    return fileDate >= from && fileDate <= to;
  });
}

// ============================================
// Log Parsing
// ============================================

/**
 * Parse a single log line (JSON format from pino)
 */
function parseLogLine(line: string, source?: string, lineNumber?: number): ParsedLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    // Try JSON format (pino default)
    const parsed = JSON.parse(trimmed);
    
    // Convert pino numeric level to string (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal)
    const levelNum = typeof parsed.level === 'number' ? parsed.level : 30;
    const levelMap: Record<number, string> = {
      10: 'trace',
      20: 'debug',
      30: 'info',
      40: 'warn',
      50: 'error',
      60: 'fatal',
    };

    return {
      timestamp: parsed.time || parsed.timestamp || '',
      level: levelMap[levelNum] || (parsed.level?.toString() || 'info').toLowerCase(),
      message: parsed.msg || parsed.message || '',
      module: parsed.module,
      prefix: parsed.prefix,
      service: parsed.service,
      plugin: parsed.plugin,
      requestId: parsed.requestId,
      sessionId: parsed.sessionId,
      _source: source,
      _lineNumber: lineNumber,
      ...parsed,
    };
  } catch {
    // Fallback: try to parse pino's text format
    const match = trimmed.match(/^\[([^\]]+)\]\s+(\w+):\s+(.+)$/);
    if (match) {
      return {
        timestamp: match[1],
        level: match[2].toLowerCase(),
        message: match[3],
        _source: source,
        _lineNumber: lineNumber,
      };
    }
    
    // Plain text fallback
    return {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: trimmed,
      _source: source,
      _lineNumber: lineNumber,
    };
  }
}

// ============================================
// Streaming
// ============================================

/**
 * Create a readable stream for a log file (handles .gz files)
 */
async function createLogFileStream(filePath: string): Promise<Readable> {
  if (filePath.endsWith('.gz')) {
    const compressed = await readFile(filePath);
    const decompressed = await gunzipAsync(compressed);
    return Readable.from(decompressed.toString('utf-8').split('\n'));
  }
  
  return createReadStream(filePath, { encoding: 'utf-8' });
}

/**
 * Stream and filter log entries from a file
 */
async function* streamLogFile(
  filePath: string,
  query: LogQuery = {}
): AsyncGenerator<ParsedLogEntry> {
  if (!existsSync(filePath)) return;

  const fileName = basename(filePath);
  let stream: Readable;
  
  try {
    stream = await createLogFileStream(filePath);
  } catch {
    return;
  }

  const rl = createInterface({ 
    input: stream,
    crlfDelay: Infinity 
  });

  let lineNumber = 0;

  try {
    for await (const line of rl) {
      lineNumber++;
      const entry = parseLogLine(line, fileName, lineNumber);
      if (!entry) continue;

      // Apply filters
      if (!matchesQuery(entry, query)) continue;

      yield entry;
    }
  } finally {
    rl.close();
  }
}

/**
 * Check if a log entry matches the query filters
 */
function matchesQuery(entry: ParsedLogEntry, query: LogQuery): boolean {
  // Filter by levels
  if (query.levels?.length && !query.levels.includes(entry.level as LogLevel)) {
    return false;
  }

  // Filter by time range
  if (query.from) {
    const fromDate = new Date(query.from);
    const entryDate = new Date(entry.timestamp);
    if (entryDate < fromDate) return false;
  }
  if (query.to) {
    const toDate = new Date(query.to);
    const entryDate = new Date(entry.timestamp);
    if (entryDate > toDate) return false;
  }

  // Filter by keyword (search in message and context fields)
  if (query.q) {
    const keyword = query.q.toLowerCase();
    const searchable = [
      entry.message,
      entry.module,
      entry.prefix,
      entry.service,
      entry.plugin,
      entry.requestId,
      entry.sessionId,
    ]
      .filter(Boolean)
      .map(String)
      .join(' ')
      .toLowerCase();
    
    if (!searchable.includes(keyword)) return false;
  }

  // Filter by specific fields
  if (query.module && entry.module !== query.module) return false;
  if (query.plugin && entry.plugin !== query.plugin) return false;
  if (query.service && entry.service !== query.service) return false;
  if (query.requestId && entry.requestId !== query.requestId) return false;
  if (query.sessionId && entry.sessionId !== query.sessionId) return false;

  return true;
}

// ============================================
// Query API
// ============================================

/**
 * Query logs across multiple files
 */
export async function queryLogs(query: LogQuery = {}): Promise<LogEntry[]> {
  ensureLogDir();

  const results: ParsedLogEntry[] = [];
  const files = getLogFiles();

  // Filter files by date range if specified
  let relevantFiles = files;
  if (query.from || query.to) {
    const fromDate = query.from ? new Date(query.from) : new Date(0);
    const toDate = query.to ? new Date(query.to) : new Date();
    relevantFiles = getLogFilesForRange(fromDate, toDate);
  }

  // Query each file
  for (const file of relevantFiles) {
    for await (const entry of streamLogFile(file.path, query)) {
      results.push(entry);

      // Early exit if limit reached
      const limit = query.limit || 100;
      if (results.length >= limit) {
        break;
      }
    }

    if (query.limit && results.length >= query.limit) {
      break;
    }
  }

  // Sort by timestamp
  const order = query.order || 'desc';
  results.sort((a, b) => {
    const diff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    return order === 'desc' ? diff : -diff;
  });

  // Apply offset/limit
  const offset = query.offset || 0;
  const limit = query.limit || 100;
  return results.slice(offset, offset + limit).map(({ _source, _lineNumber, ...rest }) => rest);
}

/**
 * Get recent logs (convenience method)
 */
export async function getRecentLogs(options?: {
  level?: LogLevel;
  limit?: number;
  module?: string;
}): Promise<LogEntry[]> {
  return queryLogs({
    levels: options?.level ? [options.level] : undefined,
    limit: options?.limit || 50,
    module: options?.module,
    order: 'desc',
  });
}

/**
 * Search logs by keyword
 */
export async function searchLogs(
  keyword: string,
  options?: {
    from?: string;
    to?: string;
    limit?: number;
  }
): Promise<LogEntry[]> {
  return queryLogs({
    q: keyword,
    ...options,
    limit: options?.limit || 100,
  });
}

/**
 * Get logs for a specific request/session
 */
export async function getLogsByContext(
  contextType: 'requestId' | 'sessionId',
  contextValue: string,
  limit: number = 100
): Promise<LogEntry[]> {
  return queryLogs({
    [contextType]: contextValue,
    limit,
    order: 'asc',
  });
}

// ============================================
// Statistics
// ============================================

/**
 * Get available log levels from actual log data
 */
export async function getLogLevels(): Promise<LogLevel[]> {
  const levels = new Set<LogLevel>();
  const files = getLogFiles().slice(0, 3); // Check last 3 files

  for (const file of files) {
    for await (const entry of streamLogFile(file.path, { limit: 500 })) {
      levels.add(entry.level as LogLevel);
    }
  }

  return Array.from(levels).sort();
}

/**
 * Get available modules from log data
 */
export async function getLogModules(): Promise<string[]> {
  const modules = new Set<string>();
  const files = getLogFiles().slice(0, 7);

  for (const file of files) {
    for await (const entry of streamLogFile(file.path, { limit: 1000 })) {
      if (entry.module) modules.add(entry.module);
      if (entry.prefix) modules.add(entry.prefix);
    }
  }

  return Array.from(modules).filter(Boolean).sort();
}

/**
 * Get log statistics by level (sampled from recent files)
 */
export async function getLogStats(): Promise<LogStats> {
  const files = getLogFiles();

  // Count by level (sample from recent files)
  const byLevel: Record<LogLevel, number> = {
    trace: 0,
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
    fatal: 0,
    silent: 0,
  };

  for (const file of files.slice(0, 7)) {
    for await (const entry of streamLogFile(file.path, { limit: 1000 })) {
      if (entry.level in byLevel) {
        byLevel[entry.level as LogLevel]++;
      }
    }
  }

  return { byLevel };
}

// ============================================
// Cleanup
// ============================================

/**
 * Clean old logs (actually deletes files)
 */
export function cleanOldLogs(keepDays: number = 7): {
  deleted: number;
  freedBytes: number;
  errors: string[];
} {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);

  let deleted = 0;
  let freedBytes = 0;
  const errors: string[] = [];

  const files = getLogFiles();
  for (const file of files) {
    const fileDate = new Date(file.modified);
    if (fileDate < cutoff) {
      try {
        const size = file.size;
        unlinkSync(file.path);
        deleted++;
        freedBytes += size;
      } catch (err) {
        errors.push(`Failed to delete ${file.name}: ${err}`);
      }
    }
  }

  return { deleted, freedBytes, errors };
}

/**
 * Clean logs by size (keep total under limit)
 */
export function cleanBySize(maxTotalMB: number = 500): {
  deleted: number;
  freedBytes: number;
  errors: string[];
} {
  const maxBytes = maxTotalMB * 1024 * 1024;
  const files = getLogFiles();
  
  let totalSize = files.reduce((sum, f) => sum + f.size, 0);
  let deleted = 0;
  let freedBytes = 0;
  const errors: string[] = [];

  // Delete oldest files until under limit
  for (const file of files.slice().reverse()) {
    if (totalSize <= maxBytes) break;

    try {
      unlinkSync(file.path);
      freedBytes += file.size;
      totalSize -= file.size;
      deleted++;
    } catch (err) {
      errors.push(`Failed to delete ${file.name}: ${err}`);
    }
  }

  return { deleted, freedBytes, errors };
}

// ============================================
// Exports
// ============================================

export { LOG_DIR };
export type { LogEntry, LogQuery, LogFileMeta, LogStats } from './logger.types.js';

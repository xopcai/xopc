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
} from 'fs';
import { readFile } from 'fs/promises';
import { join, basename } from 'path';
import { createInterface } from 'readline';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import { Readable } from 'stream';
import type { LogLevel, LogFileMeta, LogQuery, LogStats, LogEntry } from './types.js';
import { logEntrySearchText, pinoRecordToLogEntry } from './pino-record.js';

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

const LOG_DIR = process.env.XOPC_LOG_DIR || join(process.env.HOME || '.', '.xopc', 'logs');

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
function getLogFilesForRange(from: Date, to: Date): LogFileMeta[] {
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
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const entry = pinoRecordToLogEntry(parsed) as ParsedLogEntry;
    entry._source = source;
    entry._lineNumber = lineNumber;
    return entry;
  } catch {
    return null;
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

  // Filter by keyword (search message, module, phase, err, structured fields)
  if (query.q) {
    const keyword = query.q.toLowerCase();
    if (!logEntrySearchText(entry).includes(keyword)) return false;
  }

  if (query.module && entry.module !== query.module) return false;
  if (query.extension && entry.extension !== query.extension) return false;
  if (query.service && entry.service !== query.service) return false;
  if (query.requestId && entry.requestId !== query.requestId) return false;
  if (query.sessionKey && entry.sessionKey !== query.sessionKey) return false;
  if (query.sessionId && entry.sessionId !== query.sessionId) return false;

  return true;
}

// ============================================
// Query API
// ============================================

/** Cap matched rows before sort/slice so query stays bounded on huge log dirs. */
const QUERY_LOGS_MAX_MATCHED = 25_000;

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

  // Collect all matches (files are newest-first; lines in each file are time-asc).
  // Do not stop at `limit` while streaming — that only captured the oldest tail of
  // early files and made "newest first" wrong after sort.
  for (const file of relevantFiles) {
    if (results.length >= QUERY_LOGS_MAX_MATCHED) break;
    for await (const entry of streamLogFile(file.path, query)) {
      results.push(entry);
      if (results.length >= QUERY_LOGS_MAX_MATCHED) break;
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

// ============================================
// Statistics
// ============================================
export async function getLogModules(): Promise<string[]> {
  const modules = new Set<string>();
  const files = getLogFiles().slice(0, 7);

  for (const file of files) {
    for await (const entry of streamLogFile(file.path, { limit: 1000 })) {
      if (entry.module) modules.add(entry.module);
    }
  }

  return Array.from(modules).filter(Boolean).sort();
}

/**
 * Get log statistics by level (sampled from recent files)
 */
export async function getFileLogStats(): Promise<LogStats> {
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
// Error aggregation
// ============================================

export interface LogErrorSummaryItem {
  key: string;
  errName: string;
  phase?: string;
  module?: string;
  count: number;
  lastSeen: string;
  sampleMessage: string;
}

function entryMeta(entry: ParsedLogEntry): Record<string, unknown> | undefined {
  if (!entry.meta || typeof entry.meta !== 'object') return undefined;
  return entry.meta as Record<string, unknown>;
}

function extractErrName(entry: ParsedLogEntry): string {
  const meta = entryMeta(entry);
  const raw = entry.err ?? meta?.err;
  if (raw && typeof raw === 'object' && raw !== null) {
    const name = (raw as Record<string, unknown>).name;
    if (typeof name === 'string' && name.trim()) return name;
    const message = (raw as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message.slice(0, 120);
  }
  if (typeof entry.errorMessage === 'string' && entry.errorMessage.trim()) {
    return entry.errorMessage.slice(0, 120);
  }
  return entry.message?.slice(0, 120) || 'Error';
}

function summaryKey(entry: ParsedLogEntry): string {
  const errName = extractErrName(entry);
  const meta = entryMeta(entry);
  const phase =
    typeof entry.phase === 'string'
      ? entry.phase
      : typeof meta?.phase === 'string'
        ? meta.phase
        : '';
  const module = entry.module || '';
  return `${errName}::${phase}::${module}`;
}

/**
 * Aggregate recent error/fatal logs by err name + phase + module.
 */
export async function getLogErrorSummary(options?: {
  from?: string;
  to?: string;
  limit?: number;
}): Promise<LogErrorSummaryItem[]> {
  const limit = options?.limit ?? 20;
  const groups = new Map<string, LogErrorSummaryItem>();

  const entries = await queryLogs({
    levels: ['error', 'fatal'],
    from: options?.from,
    to: options?.to,
    limit: 5000,
    order: 'desc',
  });

  for (const entry of entries) {
    const key = summaryKey(entry as ParsedLogEntry);
    const parsed = entry as ParsedLogEntry;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (entry.timestamp > existing.lastSeen) {
        existing.lastSeen = entry.timestamp;
        existing.sampleMessage = entry.message;
      }
      continue;
    }
    groups.set(key, {
      key,
      errName: extractErrName(parsed),
      phase:
        typeof parsed.phase === 'string'
          ? parsed.phase
          : typeof entryMeta(parsed)?.phase === 'string'
            ? String(entryMeta(parsed)?.phase)
            : undefined,
      module: parsed.module,
      count: 1,
      lastSeen: entry.timestamp,
      sampleMessage: entry.message,
    });
  }

  return Array.from(groups.values())
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, limit);
}

// ============================================
// Log Levels
// ============================================

const LOG_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/**
 * Get available log levels
 */
export function getLogLevels(): LogLevel[] {
  return [...LOG_LEVELS];
}

// ============================================
// Exports
// ============================================

export { LOG_DIR };
export type { LogEntry, LogQuery, LogFileMeta, LogStats } from './types.js';

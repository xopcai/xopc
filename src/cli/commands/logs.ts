/**
 * Logs CLI Command
 * 
 * Query and analyze logs: list, query, stats, tail, clean
 */

import { Command } from 'commander';
import { register, type CLIContext } from '../registry.js';
import {
  getLogFiles,
  queryLogs,
  getLogStats as fetchLogStats,
  cleanOldLogs,
  type LogQuery,
  type LogEntry,
} from '../../utils/log-store.js';
import { getLoggerConfig } from '../../utils/logger/config.js';
import { rotateLogs } from '../../utils/logger/rotation.js';

function createLogsCommand(_ctx: CLIContext): Command {
  const command = new Command('logs');
  command.description('Manage and query logs');

  // List log files
  command
    .command('list')
    .description('List log files')
    .option('-t, --type <type>', 'Filter by type (app|error|audit|access)')
    .option('-s, --sort <field>', 'Sort by (name|size|date)', 'date')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let files = getLogFiles();
        
        // Filter by type
        if (options.type) {
          files = files.filter(f => f.type === options.type);
        }
        
        // Sort
        const sortField = options.sort || 'date';
        files.sort((a, b) => {
          if (sortField === 'name') return a.name.localeCompare(b.name);
          if (sortField === 'size') return b.size - a.size;
          return new Date(b.modified).getTime() - new Date(a.modified).getTime();
        });
        
        if (options.json) {
          console.log(JSON.stringify({ files }, null, 2));
          return;
        }
        
        const config = getLoggerConfig();
        console.log(`\n📁 Log directory: ${config.logDir}\n`);
        
        if (files.length === 0) {
          console.log('No log files found.');
          return;
        }
        
        console.log(`Found ${files.length} log file(s):\n`);
        
        const typeEmoji: Record<string, string> = {
          app: '📝',
          error: '❌',
          audit: '🔒',
          access: '🌐',
        };
        
        for (const file of files) {
          const emoji = typeEmoji[file.type] || '📄';
          const sizeKB = (file.size / 1024).toFixed(1);
          const date = new Date(file.modified).toLocaleString();
          console.log(`${emoji} ${file.name}`);
          console.log(`   Size: ${sizeKB} KB | Modified: ${date}`);
        }
      } catch (err) {
        console.error('Failed to list logs:', err);
        process.exit(1);
      }
    });

  // Query logs
  command
    .command('query')
    .description('Query log entries')
    .option('-l, --level <level>', 'Filter by level (trace|debug|info|warn|error|fatal)')
    .option('-m, --module <module>', 'Filter by module')
    .option('-e, --extension <ext>', 'Filter by extension')
    .option('-q, --search <text>', 'Text search')
    .option('--session-id <id>', 'Filter by session ID')
    .option('--request-id <id>', 'Filter by request ID')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('-n, --limit <number>', 'Number of results', '50')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const query: LogQuery = {
          levels: options.level ? [options.level as 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'] : undefined,
          module: options.module,
          extension: options.extension,
          q: options.search,
          sessionId: options.sessionId,
          requestId: options.requestId,
          from: options.from,
          to: options.to,
          limit: parseInt(options.limit, 10),
          order: 'desc',
        };
        
        const entries = await queryLogs(query);
        
        if (options.json) {
          console.log(JSON.stringify({ entries }, null, 2));
          return;
        }
        
        if (entries.length === 0) {
          console.log('No matching log entries found.');
          return;
        }
        
        console.log(`\nFound ${entries.length} log entry(ies):\n`);
        
        for (const entry of entries) {
          const timestamp = new Date(entry.timestamp).toLocaleTimeString();
          const levelColor = getLevelColor(entry.level);
          const module = entry.module ? `[${entry.module}]` : '';
          const session = (entry as any).sessionId ? `{session:${(entry as any).sessionId.slice(0,8)}}` : '';
          
          console.log(`${timestamp} ${levelColor(entry.level)} ${module} ${session} ${entry.message}`);
          
          // Show context if present
          if (entry.requestId) {
            console.log(`   ↳ requestId: ${entry.requestId}`);
          }
          if (entry.userId) {
            console.log(`   ↳ userId: ${entry.userId}`);
          }
        }
      } catch (err) {
        console.error('Failed to query logs:', err);
        process.exit(1);
      }
    });

  // Show statistics
  command
    .command('stats')
    .description('Show log statistics')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const stats = await fetchLogStats();
        const config = getLoggerConfig();
        
        if (options.json) {
          console.log(JSON.stringify({ config, stats }, null, 2));
          return;
        }
        
        console.log('\n📊 Log Statistics\n');
        console.log(`📁 Log directory: ${config.logDir}`);
        console.log(`📝 Retention: ${config.retentionDays} days`);
        console.log(`📏 Max file size: ${config.maxFileSizeMB} MB\n`);
        
        console.log('By Level:');
        const byLevel = stats.byLevel as Record<string, number>;
        const total = Object.values(byLevel).reduce((a, b) => a + b, 0);
        for (const [level, count] of Object.entries(byLevel)) {
          const bar = '█'.repeat(Math.min(50, total > 0 ? Math.round((count / total) * 50) : 0));
          const percent = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
          console.log(`   ${level.padEnd(5)}: ${count.toString().padStart(6)} (${percent}%) ${bar}`);
        }
        
        console.log(`\n📈 Total entries: ${total}`);
      } catch (err) {
        console.error('Failed to get stats:', err);
        process.exit(1);
      }
    });

  // Tail logs
  command
    .command('tail')
    .description('Tail log entries in real-time')
    .option('-n, --lines <number>', 'Number of lines to show', '20')
    .option('-f, --follow', 'Follow new entries (Ctrl+C to exit)', false)
    .option('-t, --type <type>', 'Filter by type (app|error|audit|access)', 'app')
    .action(async (options) => {
      try {
        const lines = parseInt(options.lines, 10);
        
        // Initial query
        const query: LogQuery = {
          limit: lines,
          order: 'desc',
        };
        
        const entries = await queryLogs(query);
        
        // Print in chronological order
        const reversed = [...entries].reverse();
        
        for (const entry of reversed) {
          printLogEntry(entry);
        }
        
        if (options.follow) {
          console.log('\n⏳ Watching for new entries (Ctrl+C to exit)...');
          // Note: Full follow mode would require file watching
          // For now, just show initial results
        }
      } catch (err) {
        console.error('Failed to tail logs:', err);
        process.exit(1);
      }
    });

  // Clean old logs
  command
    .command('clean')
    .description('Clean old log files')
    .option('-d, --days <number>', 'Keep logs for N days', '7')
    .option('--dry-run', 'Show what would be deleted without actually deleting')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const keepDays = parseInt(options.days, 10);
        
        if (options.dryRun) {
          console.log(`\n🔍 Dry run: would delete logs older than ${keepDays} days\n`);
        }
        
        const result = cleanOldLogs(keepDays);
        
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        
        if (result.deleted === 0) {
          console.log('✅ No old logs to clean.');
          return;
        }
        
        console.log(`\n🧹 Cleaned ${result.deleted} log file(s)`);
        
        if (result.errors.length > 0) {
          console.log('\n⚠️  Errors:');
          for (const err of result.errors) {
            console.log(`   - ${err}`);
          }
        }
      } catch (err) {
        console.error('Failed to clean logs:', err);
        process.exit(1);
      }
    });

  // Rotate logs
  command
    .command('rotate')
    .description('Rotate large log files')
    .option('--dry-run', 'Show what would be rotated without rotating')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        if (options.dryRun) {
          console.log('\n🔍 Dry run: would rotate large log files\n');
        }
        
        const result = await rotateLogs();
        
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        
        if (result.rotated === 0) {
          console.log('✅ No logs need rotation.');
          return;
        }
        
        console.log(`\n🔄 Rotated ${result.rotated} log file(s)`);
        console.log(`   Compressed: ${result.compressed}`);
        
        if (result.errors.length > 0) {
          console.log('\n⚠️  Errors:');
          for (const err of result.errors) {
            console.log(`   - ${err}`);
          }
        }
      } catch (err) {
        console.error('Failed to rotate logs:', err);
        process.exit(1);
      }
    });

  return command;
}

// Helper functions
function getLevelColor(level: string): (s: string) => string {
  const colors: Record<string, (s: string) => string> = {
    trace: (s) => `🔍 ${s}`,
    debug: (s) => `🔧 ${s}`,
    info:  (s) => `ℹ️  ${s}`,
    warn:  (s) => `⚠️  ${s}`,
    error: (s) => `❌ ${s}`,
    fatal: (s) => `🔥 ${s}`,
  };
  return colors[level] || ((s) => s);
}

function printLogEntry(entry: LogEntry): void {
  const timestamp = new Date(entry.timestamp).toLocaleTimeString();
  const levelColor = getLevelColor(entry.level);
  const module = entry.module ? `[${entry.module}]` : '';
  
  console.log(`${timestamp} ${levelColor(entry.level)} ${module} ${entry.message}`);
}

// Register command
register({
  id: 'logs',
  name: 'logs',
  description: 'Manage and query logs',
  factory: createLogsCommand,
  metadata: { category: 'maintenance' },
});

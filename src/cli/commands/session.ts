// Session management CLI commands

import { Command } from 'commander';
import { SessionManager } from '../../session/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';
import type { SessionListQuery, ExportFormat, SessionStatus } from '../../types/index.js';

const log = createLogger('SessionCommand');

function createSessionCommand(_ctx: CLIContext): Command {
  const sessionCmd = new Command('session')
    .description('Session management commands')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot session list                    # List all sessions',
        'xopcbot session info <key>              # Show session details',
        'xopcbot session delete <key>            # Delete a session',
        'xopcbot session rename <key> <name>     # Rename a session',
        'xopcbot session tag <key> <tag1> <tag2>  # Add tags',
        'xopcbot session archive <key>           # Archive session',
        'xopcbot session search <query>          # Search sessions',
        'xopcbot session export <key>            # Export session',
        'xopcbot session stats                   # Show statistics',
      ])
    );

  async function getManager(): Promise<SessionManager> {
    const ctx = getContextWithOpts();
    const manager = new SessionManager({ workspace: ctx.workspacePath });
    await manager.initialize();
    return manager;
  }

  // List sessions
  sessionCmd
    .command('list')
    .description('List all sessions')
    .option('-c, --channel <channel>', 'Filter by channel (telegram, whatsapp, gateway, cli)')
    .option('-s, --status <status>', 'Filter by status (active, idle, archived, pinned)')
    .option('-t, --tag <tag>', 'Filter by tag (can be used multiple times)', collect, [])
    .option('-q, --query <query>', 'Search query')
    .option('--sort <field>', 'Sort by field (updatedAt, createdAt, messageCount, lastAccessedAt)', 'updatedAt')
    .option('--order <order>', 'Sort order (asc, desc)', 'desc')
    .option('-l, --limit <n>', 'Limit results', '20')
    .option('-o, --offset <n>', 'Offset for pagination', '0')
    .action(async (options) => {
      try {
        const manager = await getManager();

        const query: SessionListQuery = {
          channel: options.channel,
          status: options.status as SessionStatus,
          tags: options.tag.length > 0 ? options.tag : undefined,
          search: options.query,
          sortBy: options.sort as any,
          sortOrder: options.order as any,
          limit: parseInt(options.limit),
          offset: parseInt(options.offset),
        };

        const result = await manager.listSessions(query);

        console.log(`\n📋 Sessions (${result.items.length} of ${result.total}):\n`);

        if (result.items.length === 0) {
          console.log('No sessions found.');
          return;
        }

        // Table header
        console.log('Key'.padEnd(30) + 'Name'.padEnd(20) + 'Status'.padEnd(10) + 'Messages'.padEnd(10) + 'Updated');
        console.log('─'.repeat(90));

        for (const session of result.items) {
          const name = (session.name || '-').slice(0, 18).padEnd(20);
          const status = session.status.padEnd(10);
          const messages = String(session.messageCount).padEnd(10);
          const updated = new Date(session.updatedAt).toLocaleDateString();
          console.log(`${session.key.slice(0, 28).padEnd(30)}${name}${status}${messages}${updated}`);
        }

        if (result.hasMore) {
          console.log(`\n... and ${result.total - result.offset - result.limit} more`);
        }

        console.log();
      } catch (error) {
        log.error({ err: error }, 'Failed to list sessions');
        process.exit(1);
      }
    });

  // Get session info
  sessionCmd
    .command('info <key>')
    .description('Get detailed information about a session')
    .action(async (key) => {
      try {
        const manager = await getManager();
        const session = await manager.getSession(key);

        if (!session) {
          console.error(`❌ Session not found: ${key}`);
          process.exit(1);
        }

        console.log(`\n📁 Session: ${session.key}\n`);
        console.log(`  Name:        ${session.name || '-'}`);
        console.log(`  Status:      ${session.status}`);
        console.log(`  Tags:        ${session.tags.join(', ') || '-'}`);
        console.log(`  Channel:     ${session.sourceChannel}`);
        console.log(`  Chat ID:     ${session.sourceChatId}`);
        console.log(`  Messages:    ${session.messageCount}`);
        console.log(`  Est. Tokens: ${session.estimatedTokens.toLocaleString()}`);
        console.log(`  Compacted:   ${session.compactedCount} times`);
        console.log(`  Created:     ${new Date(session.createdAt).toLocaleString()}`);
        console.log(`  Updated:     ${new Date(session.updatedAt).toLocaleString()}`);
        console.log(`  Last Access: ${new Date(session.lastAccessedAt).toLocaleString()}`);

        if (session.messages.length > 0) {
          console.log(`\n  Recent Messages:`);
          const recent = session.messages.slice(-5);
          for (const msg of recent) {
            const role = msg.role.padEnd(10);
            const preview = msg.content.slice(0, 60).replace(/\n/g, ' ');
            console.log(`    ${role}: ${preview}${msg.content.length > 60 ? '...' : ''}`);
          }
        }

        console.log();
      } catch (error) {
        log.error({ err: error }, 'Failed to get session info');
        process.exit(1);
      }
    });

  // Delete session
  sessionCmd
    .command('delete <key>')
    .description('Delete a session')
    .option('-f, --force', 'Skip confirmation', false)
    .action(async (key, options) => {
      try {
        if (!options.force) {
          const { confirm } = await import('@inquirer/prompts');
          const confirmed = await confirm({
            message: `Are you sure you want to delete session "${key}"?`,
            default: false,
          });
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const manager = await getManager();
        await manager.deleteSession(key);
        console.log(`✅ Session deleted: ${key}`);
      } catch (error) {
        log.error({ err: error }, 'Failed to delete session');
        process.exit(1);
      }
    });

  // Delete multiple sessions
  sessionCmd
    .command('delete-many')
    .description('Delete multiple sessions by status or channel')
    .option('-s, --status <status>', 'Delete all sessions with this status')
    .option('-c, --channel <channel>', 'Delete all sessions from this channel')
    .option('-f, --force', 'Skip confirmation', false)
    .action(async (options) => {
      try {
        const manager = await getManager();

        const query: SessionListQuery = {
          status: options.status as SessionStatus,
          channel: options.channel,
          limit: 1000,
        };

        const result = await manager.listSessions(query);

        if (result.items.length === 0) {
          console.log('No sessions match the criteria.');
          return;
        }

        const keys = result.items.map((s) => s.key);
        console.log(`Found ${keys.length} sessions to delete.`);

        if (!options.force) {
          const { confirm } = await import('@inquirer/prompts');
          const confirmed = await confirm({
            message: `Delete ${keys.length} sessions?`,
            default: false,
          });
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const deleteResult = await manager.deleteSessions(keys);
        console.log(`✅ Deleted ${deleteResult.success.length} sessions`);
        if (deleteResult.failed.length > 0) {
          console.log(`❌ Failed to delete ${deleteResult.failed.length} sessions`);
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to delete sessions');
        process.exit(1);
      }
    });

  // Rename session
  sessionCmd
    .command('rename <key> <name>')
    .description('Rename a session')
    .action(async (key, name) => {
      try {
        const manager = await getManager();
        await manager.renameSession(key, name);
        console.log(`✅ Session renamed to: ${name}`);
      } catch (error) {
        log.error({ err: error }, 'Failed to rename session');
        process.exit(1);
      }
    });

  // Tag session
  sessionCmd
    .command('tag <key> <tags...>')
    .description('Add tags to a session')
    .action(async (key, tags) => {
      try {
        const manager = await getManager();
        await manager.tagSession(key, tags);
        console.log(`✅ Tags added: ${tags.join(', ')}`);
      } catch (error) {
        log.error({ err: error }, 'Failed to tag session');
        process.exit(1);
      }
    });

  // Untag session
  sessionCmd
    .command('untag <key> <tags...>')
    .description('Remove tags from a session')
    .action(async (key, tags) => {
      try {
        const manager = await getManager();
        await manager.untagSession(key, tags);
        console.log(`✅ Tags removed: ${tags.join(', ')}`);
      } catch (error) {
        log.error({ err: error }, 'Failed to untag session');
        process.exit(1);
      }
    });

  // Archive session
  sessionCmd
    .command('archive <key>')
    .description('Archive a session')
    .action(async (key) => {
      try {
        const manager = await getManager();
        await manager.archiveSession(key);
        console.log(`✅ Session archived: ${key}`);
      } catch (error) {
        log.error({ err: error }, 'Failed to archive session');
        process.exit(1);
      }
    });

  // Unarchive session
  sessionCmd
    .command('unarchive <key>')
    .description('Unarchive a session')
    .action(async (key) => {
      try {
        const manager = await getManager();
        await manager.unarchiveSession(key);
        console.log(`✅ Session unarchived: ${key}`);
      } catch (error) {
        log.error({ err: error }, 'Failed to unarchive session');
        process.exit(1);
      }
    });

  // Pin session
  sessionCmd
    .command('pin <key>')
    .description('Pin a session')
    .action(async (key) => {
      try {
        const manager = await getManager();
        await manager.pinSession(key);
        console.log(`✅ Session pinned: ${key}`);
      } catch (error) {
        log.error({ err: error }, 'Failed to pin session');
        process.exit(1);
      }
    });

  // Unpin session
  sessionCmd
    .command('unpin <key>')
    .description('Unpin a session')
    .action(async (key) => {
      try {
        const manager = await getManager();
        await manager.unpinSession(key);
        console.log(`✅ Session unpinned: ${key}`);
      } catch (error) {
        log.error({ err: error }, 'Failed to unpin session');
        process.exit(1);
      }
    });

  // Search sessions
  sessionCmd
    .command('search <query>')
    .description('Search sessions by name, key, or tags')
    .action(async (query) => {
      try {
        const manager = await getManager();
        const sessions = await manager.searchSessions(query);

        console.log(`\n🔍 Search results for "${query}" (${sessions.length} found):\n`);

        if (sessions.length === 0) {
          console.log('No sessions found.');
          return;
        }

        for (const session of sessions) {
          console.log(`  ${session.key}`);
          if (session.name) console.log(`    Name: ${session.name}`);
          console.log(`    Status: ${session.status} | Messages: ${session.messageCount}`);
          console.log(`    Tags: ${session.tags.join(', ') || '-'}`);
          console.log();
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to search sessions');
        process.exit(1);
      }
    });

  // Search within session
  sessionCmd
    .command('grep <key> <keyword>')
    .description('Search for a keyword within a session')
    .action(async (key, keyword) => {
      try {
        const manager = await getManager();
        const messages = await manager.searchInSession(key, keyword);

        console.log(`\n🔍 Found ${messages.length} messages containing "${keyword}":\n`);

        for (const msg of messages) {
          const role = msg.role.padEnd(10);
          const highlighted = msg.content.replace(
            new RegExp(keyword, 'gi'),
            (match) => `\x1b[33m${match}\x1b[0m`
          );
          console.log(`  ${role}: ${highlighted.slice(0, 200)}${msg.content.length > 200 ? '...' : ''}\n`);
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to search in session');
        process.exit(1);
      }
    });

  // Export session
  sessionCmd
    .command('export <key>')
    .description('Export a session')
    .option('-f, --format <format>', 'Export format (json, markdown)', 'json')
    .option('-o, --output <path>', 'Output file path')
    .action(async (key, options) => {
      try {
        const manager = await getManager();
        const format = options.format as ExportFormat;
        const content = await manager.exportSession(key, format);

        if (options.output) {
          const { writeFile } = await import('fs/promises');
          await writeFile(options.output, content);
          console.log(`✅ Exported to: ${options.output}`);
        } else {
          console.log(content);
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to export session');
        process.exit(1);
      }
    });

  // Stats
  sessionCmd
    .command('stats')
    .description('Show session statistics')
    .action(async () => {
      try {
        const manager = await getManager();
        const stats = await manager.getStats();

        console.log('\n📊 Session Statistics\n');
        console.log(`  Total Sessions:     ${stats.totalSessions}`);
        console.log(`  Active:             ${stats.activeSessions}`);
        console.log(`  Archived:           ${stats.archivedSessions}`);
        console.log(`  Pinned:             ${stats.pinnedSessions}`);
        console.log(`  Total Messages:     ${stats.totalMessages.toLocaleString()}`);
        console.log(`  Total Tokens:       ${stats.totalTokens.toLocaleString()}`);

        if (stats.oldestSession) {
          console.log(`  Oldest Session:     ${new Date(stats.oldestSession).toLocaleDateString()}`);
        }
        if (stats.newestSession) {
          console.log(`  Newest Session:     ${new Date(stats.newestSession).toLocaleDateString()}`);
        }

        if (Object.keys(stats.byChannel).length > 0) {
          console.log('\n  By Channel:');
          for (const [channel, count] of Object.entries(stats.byChannel)) {
            console.log(`    ${channel}: ${count}`);
          }
        }

        console.log();
      } catch (error) {
        log.error({ err: error }, 'Failed to get stats');
        process.exit(1);
      }
    });

  // Archive old sessions
  sessionCmd
    .command('cleanup')
    .description('Archive sessions older than N days')
    .option('-d, --days <n>', 'Days of inactivity before archiving', '30')
    .option('-f, --force', 'Skip confirmation', false)
    .action(async (options) => {
      try {
        const days = parseInt(options.days);

        if (!options.force) {
          const { confirm } = await import('@inquirer/prompts');
          const confirmed = await confirm({
            message: `Archive all sessions inactive for more than ${days} days?`,
            default: false,
          });
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const manager = await getManager();
        const count = await manager.archiveOldSessions(days);
        console.log(`✅ Archived ${count} sessions`);
      } catch (error) {
        log.error({ err: error }, 'Failed to cleanup sessions');
        process.exit(1);
      }
    });

  return sessionCmd;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

register({
  id: 'session',
  name: 'session',
  description: 'Session management commands',
  factory: createSessionCommand,
  metadata: {
    category: 'maintenance',
    examples: [
      'xopcbot session list',
      'xopcbot session info telegram:123456',
      'xopcbot session delete telegram:123456',
      'xopcbot session export telegram:123456 --format markdown',
    ],
  },
});

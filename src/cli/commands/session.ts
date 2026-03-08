// Session management CLI commands

import { Command } from 'commander';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { collect } from './session/utils.js';
import * as actions from './session/actions.js';

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

  // List sessions
  sessionCmd
    .command('list')
    .description('List all sessions')
    .option('-c, --channel <channel>', 'Filter by channel (telegram, gateway, cli)')
    .option('-s, --status <status>', 'Filter by status (active, idle, archived, pinned)')
    .option('-t, --tag <tag>', 'Filter by tag (can be used multiple times)', collect, [])
    .option('-q, --query <query>', 'Search query')
    .option('--sort <field>', 'Sort by field (updatedAt, createdAt, messageCount, lastAccessedAt)', 'updatedAt')
    .option('--order <order>', 'Sort order (asc, desc)', 'desc')
    .option('-l, --limit <n>', 'Limit results', '20')
    .option('-o, --offset <n>', 'Offset for pagination', '0')
    .action(async (options) => {
      try {
        await actions.listSessions(options);
      } catch (error) {
        actions.handleError(error, 'Failed to list sessions');
      }
    });

  // Get session info
  sessionCmd
    .command('info <key>')
    .description('Get detailed information about a session')
    .action(async (key) => {
      try {
        await actions.getSessionInfo(key);
      } catch (error) {
        actions.handleError(error, 'Failed to get session info');
      }
    });

  // Delete session
  sessionCmd
    .command('delete <key>')
    .description('Delete a session')
    .option('-f, --force', 'Skip confirmation', false)
    .action(async (key, options) => {
      try {
        await actions.deleteSession(key, options);
      } catch (error) {
        actions.handleError(error, 'Failed to delete session');
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
        await actions.deleteMany(options);
      } catch (error) {
        actions.handleError(error, 'Failed to delete sessions');
      }
    });

  // Rename session
  sessionCmd
    .command('rename <key> <name>')
    .description('Rename a session')
    .action(async (key, name) => {
      try {
        await actions.renameSession(key, name);
      } catch (error) {
        actions.handleError(error, 'Failed to rename session');
      }
    });

  // Tag session
  sessionCmd
    .command('tag <key> <tags...>')
    .description('Add tags to a session')
    .action(async (key, tags) => {
      try {
        await actions.tagSession(key, tags);
      } catch (error) {
        actions.handleError(error, 'Failed to tag session');
      }
    });

  // Untag session
  sessionCmd
    .command('untag <key> <tags...>')
    .description('Remove tags from a session')
    .action(async (key, tags) => {
      try {
        await actions.untagSession(key, tags);
      } catch (error) {
        actions.handleError(error, 'Failed to untag session');
      }
    });

  // Archive session
  sessionCmd
    .command('archive <key>')
    .description('Archive a session')
    .action(async (key) => {
      try {
        await actions.archiveSession(key);
      } catch (error) {
        actions.handleError(error, 'Failed to archive session');
      }
    });

  // Unarchive session
  sessionCmd
    .command('unarchive <key>')
    .description('Unarchive a session')
    .action(async (key) => {
      try {
        await actions.unarchiveSession(key);
      } catch (error) {
        actions.handleError(error, 'Failed to unarchive session');
      }
    });

  // Pin session
  sessionCmd
    .command('pin <key>')
    .description('Pin a session')
    .action(async (key) => {
      try {
        await actions.pinSession(key);
      } catch (error) {
        actions.handleError(error, 'Failed to pin session');
      }
    });

  // Unpin session
  sessionCmd
    .command('unpin <key>')
    .description('Unpin a session')
    .action(async (key) => {
      try {
        await actions.unpinSession(key);
      } catch (error) {
        actions.handleError(error, 'Failed to unpin session');
      }
    });

  // Search sessions
  sessionCmd
    .command('search <query>')
    .description('Search sessions by name, key, or tags')
    .action(async (query) => {
      try {
        await actions.searchSessions(query);
      } catch (error) {
        actions.handleError(error, 'Failed to search sessions');
      }
    });

  // Search within session
  sessionCmd
    .command('grep <key> <keyword>')
    .description('Search for a keyword within a session')
    .action(async (key, keyword) => {
      try {
        await actions.grepSession(key, keyword);
      } catch (error) {
        actions.handleError(error, 'Failed to search in session');
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
        await actions.exportSession(key, options);
      } catch (error) {
        actions.handleError(error, 'Failed to export session');
      }
    });

  // Stats
  sessionCmd
    .command('stats')
    .description('Show session statistics')
    .action(async () => {
      try {
        await actions.showStats();
      } catch (error) {
        actions.handleError(error, 'Failed to get stats');
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
        await actions.cleanup(options);
      } catch (error) {
        actions.handleError(error, 'Failed to cleanup sessions');
      }
    });

  return sessionCmd;
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
      'xopcbot session info telegram:dm:123456',
      'xopcbot session delete telegram:g:-100123456',
      'xopcbot session export telegram:dm:123456 --format markdown',
    ],
  },
});

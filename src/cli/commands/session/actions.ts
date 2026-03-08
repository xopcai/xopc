/**
 * Session command action handlers
 */

import { createLogger } from '../../../utils/logger.js';
import type { SessionListQuery, ExportFormat, SessionStatus } from '../../../types/index.js';
import { getManager } from './utils.js';

const log = createLogger('SessionCommand');

// List sessions
export async function listSessions(options: {
  channel?: string;
  status?: string;
  tag: string[];
  query?: string;
  sort: string;
  order: string;
  limit: string;
  offset: string;
}): Promise<void> {
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
}

// Get session info
export async function getSessionInfo(key: string): Promise<void> {
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
}

// Delete session
export async function deleteSession(key: string, options: { force: boolean }): Promise<void> {
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
}

// Delete multiple sessions
export async function deleteMany(options: {
  status?: string;
  channel?: string;
  force: boolean;
}): Promise<void> {
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
}

// Rename session
export async function renameSession(key: string, name: string): Promise<void> {
  const manager = await getManager();
  await manager.renameSession(key, name);
  console.log(`✅ Session renamed to: ${name}`);
}

// Tag session
export async function tagSession(key: string, tags: string[]): Promise<void> {
  const manager = await getManager();
  await manager.tagSession(key, tags);
  console.log(`✅ Tags added: ${tags.join(', ')}`);
}

// Untag session
export async function untagSession(key: string, tags: string[]): Promise<void> {
  const manager = await getManager();
  await manager.untagSession(key, tags);
  console.log(`✅ Tags removed: ${tags.join(', ')}`);
}

// Archive session
export async function archiveSession(key: string): Promise<void> {
  const manager = await getManager();
  await manager.archiveSession(key);
  console.log(`✅ Session archived: ${key}`);
}

// Unarchive session
export async function unarchiveSession(key: string): Promise<void> {
  const manager = await getManager();
  await manager.unarchiveSession(key);
  console.log(`✅ Session unarchived: ${key}`);
}

// Pin session
export async function pinSession(key: string): Promise<void> {
  const manager = await getManager();
  await manager.pinSession(key);
  console.log(`✅ Session pinned: ${key}`);
}

// Unpin session
export async function unpinSession(key: string): Promise<void> {
  const manager = await getManager();
  await manager.unpinSession(key);
  console.log(`✅ Session unpinned: ${key}`);
}

// Search sessions
export async function searchSessions(query: string): Promise<void> {
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
}

// Search within session
export async function grepSession(key: string, keyword: string): Promise<void> {
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
}

// Export session
export async function exportSession(
  key: string,
  options: { format: string; output?: string }
): Promise<void> {
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
}

// Show stats
export async function showStats(): Promise<void> {
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
}

// Cleanup old sessions
export async function cleanup(options: { days: string; force: boolean }): Promise<void> {
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
}

// Error handler wrapper
export function handleError(error: unknown, message: string): never {
  log.error({ err: error }, message);
  process.exit(1);
}

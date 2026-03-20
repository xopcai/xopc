import { readFile, writeFile, readdir, rename, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { watch, type FSWatcher } from 'fs';
import { createLogger } from '../../utils/logger.js';
import {
  resolveInboxPendingDir,
  resolveInboxProcessedDir,
  resolveInboxDir,
} from '../../config/paths.js';
import type { AgentIPCMessage } from './types.js';

const log = createLogger('AgentInbox');

// ============================================
// Agent Inbox (File-based IPC)
// ============================================

export class AgentInbox {
  private readonly pendingDir: string;
  private readonly processedDir: string;
  private watcher?: FSWatcher;

  constructor(agentDir: string) {
    this.pendingDir = join(agentDir, 'inbox', 'pending');
    this.processedDir = join(agentDir, 'inbox', 'processed');
  }

  /**
   * Static factory using agent ID
   */
  static forAgent(agentId: string): AgentInbox {
    const inboxDir = resolveInboxDir(agentId);
    return new AgentInbox(dirname(inboxDir));
  }

  /**
   * Enqueue a message
   */
  async enqueue(message: AgentIPCMessage): Promise<void> {
    await mkdir(this.pendingDir, { recursive: true });

    const filePath = join(this.pendingDir, `${message.id}.json`);
    await writeFile(filePath, JSON.stringify(message, null, 2), 'utf-8');

    log.debug({ messageId: message.id, to: message.to }, 'Enqueued message');
  }

  /**
   * Dequeue the oldest pending message
   */
  async dequeue(): Promise<AgentIPCMessage | null> {
    await mkdir(this.pendingDir, { recursive: true });
    await mkdir(this.processedDir, { recursive: true });

    const files = await readdir(this.pendingDir).catch(() => [] as string[]);
    if (files.length === 0) return null;

    // Sort by filename (timestamp-based IDs)
    const sorted = files.filter((f) => f.endsWith('.json')).sort();
    if (sorted.length === 0) return null;

    const fileName = sorted[0];
    const filePath = join(this.pendingDir, fileName);

    try {
      const content = await readFile(filePath, 'utf-8');
      const message = JSON.parse(content) as AgentIPCMessage;

      // Move to processed
      const processedPath = join(this.processedDir, fileName);
      await rename(filePath, processedPath);

      log.debug({ messageId: message.id, from: message.from }, 'Dequeued message');
      return message;
    } catch (error) {
      log.warn({ fileName, error }, 'Failed to dequeue message');
      return null;
    }
  }

  /**
   * Peek at pending messages without removing them
   */
  async peek(limit: number = 10): Promise<AgentIPCMessage[]> {
    await mkdir(this.pendingDir, { recursive: true });

    const files = await readdir(this.pendingDir).catch(() => [] as string[]);
    const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();

    const messages: AgentIPCMessage[] = [];

    for (const fileName of jsonFiles.slice(0, limit)) {
      try {
        const filePath = join(this.pendingDir, fileName);
        const content = await readFile(filePath, 'utf-8');
        const message = JSON.parse(content) as AgentIPCMessage;
        messages.push(message);
      } catch (error) {
        log.warn({ fileName, error }, 'Failed to read message');
      }
    }

    return messages;
  }

  /**
   * Count pending messages
   */
  async count(): Promise<number> {
    if (!existsSync(this.pendingDir)) return 0;

    const files = await readdir(this.pendingDir).catch(() => [] as string[]);
    return files.filter((f) => f.endsWith('.json')).length;
  }

  /**
   * Watch for new messages
   */
  async watch(handler: (msg: AgentIPCMessage) => Promise<void>): Promise<() => void> {
    await mkdir(this.pendingDir, { recursive: true });

    // Initial processing of any existing messages
    await this.processPending(handler);

    // Set up watcher
    this.watcher = watch(this.pendingDir, async (eventType, filename) => {
      if (eventType === 'rename' &> filename?.endsWith('.json')) {
        await this.processPending(handler);
      }
    });

    // Return cleanup function
    return () => {
      this.watcher?.close();
      this.watcher = undefined;
    };
  }

  /**
   * Stop watching
   */
  stopWatching(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  /**
   * Clear all processed messages
   */
  async clearProcessed(olderThanMs?: number): Promise<number> {
    if (!existsSync(this.processedDir)) return 0;

    const files = await readdir(this.processedDir).catch(() => [] as string[]);
    const cutoff = olderThanMs ? Date.now() - olderThanMs : 0;

    let cleared = 0;

    for (const fileName of files) {
      if (!fileName.endsWith('.json')) continue;

      const filePath = join(this.processedDir, fileName);

      try {
        if (olderThanMs) {
          const stats = await import('fs/promises').then((fs) => fs.stat(filePath));
          if (stats.mtimeMs < cutoff) {
            await import('fs/promises').then((fs) => fs.unlink(filePath));
            cleared++;
          }
        } else {
          await import('fs/promises').then((fs) => fs.unlink(filePath));
          cleared++;
        }
      } catch (error) {
        log.warn({ fileName, error }, 'Failed to clear processed message');
      }
    }

    return cleared;
  }

  // ============================================
  // Private Methods
  // ============================================

  private async processPending(
    handler: (msg: AgentIPCMessage) => Promise<void>
  ): Promise<void> {
    while (true) {
      const msg = await this.dequeue();
      if (!msg) break;

      try {
        await handler(msg);
      } catch (error) {
        log.error({ messageId: msg.id, error }, 'Error processing message');
      }
    }
  }
}

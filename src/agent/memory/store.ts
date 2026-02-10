// Session memory store - persists agent messages to disk with compaction support
import { type AgentMessage } from '@mariozechner/pi-agent-core';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import { SlidingWindow, type WindowConfig } from './window.js';
import { SessionCompactor, type CompactionConfig, type CompactionResult } from './compaction.js';

const log = createLogger('MemoryStore');

interface SessionMetadata {
  compactionStats: {
    compactionCount: number;
    totalTokensBefore: number;
    totalTokensAfter: number;
    lastCompactionAt?: Date;
  };
  lastAccessedAt: string;
}

export class MemoryStore {
  private sessionsDir: string;
  private window: SlidingWindow;
  private compactor: SessionCompactor;
  private sessionMetadata = new Map<string, SessionMetadata>();

  constructor(
    workspace: string,
    windowConfig?: Partial<WindowConfig>,
    compactionConfig?: Partial<CompactionConfig>
  ) {
    this.sessionsDir = join(workspace, '.sessions');
    this.window = new SlidingWindow(windowConfig);
    this.compactor = new SessionCompactor(compactionConfig);
  }

  async load(sessionKey: string): Promise<AgentMessage[]> {
    const path = this.getPath(sessionKey);
    
    try {
      const data = await readFile(path, 'utf-8');
      const messages = JSON.parse(data) as AgentMessage[];
      await this.loadMetadata(sessionKey);
      log.debug({ sessionKey, messageCount: messages.length }, 'Session loaded');
      return messages;
    } catch {
      return [];
    }
  }

  async save(sessionKey: string, messages: AgentMessage[]): Promise<void> {
    const trimmed = this.window.trim(messages);
    
    const path = this.getPath(sessionKey);
    await mkdir(this.sessionsDir, { recursive: true });
    await writeFile(path, JSON.stringify(trimmed, null, 2));
    
    this.updateMetadata(sessionKey, { lastAccessedAt: new Date().toISOString() });
    await this.saveMetadata(sessionKey);
    
    log.debug({ sessionKey, originalCount: messages.length, savedCount: trimmed.length }, 'Session saved');
  }

  /**
   * Check if session needs compaction
   */
  needsCompaction(sessionKey: string, messages: AgentMessage[], contextWindow: number) {
    return this.compactor.needsCompaction(messages, contextWindow);
  }

  /**
   * Prepare compaction (check if needed)
   */
  prepareCompaction(
    sessionKey: string,
    messages: AgentMessage[],
    contextWindow: number
  ): { needsCompaction: boolean; messages: AgentMessage[]; stats?: ReturnType<typeof this.compactor.needsCompaction> } {
    const result = this.compactor.needsCompaction(messages, contextWindow);
    return {
      needsCompaction: result.needed,
      messages,
      stats: result,
    };
  }

  /**
   * Apply compaction to session
   */
  async applyCompaction(
    sessionKey: string,
    messages: AgentMessage[],
    result: CompactionResult
  ): Promise<AgentMessage[]> {
    const compacted = this.compactor.applyCompaction(messages, result);
    
    const metadata = this.sessionMetadata.get(sessionKey);
    if (metadata) {
      metadata.compactionStats.compactionCount++;
      metadata.compactionStats.totalTokensBefore += result.tokensBefore;
      metadata.compactionStats.totalTokensAfter += result.tokensAfter;
      metadata.compactionStats.lastCompactionAt = new Date();
      await this.saveMetadata(sessionKey);
    }
    
    log.info({
      sessionKey,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      keptMessages: compacted.length,
    }, 'Session compacted');
    
    return compacted;
  }

  /**
   * Compact session with LLM summary
   */
  async compact(
    sessionKey: string,
    messages: AgentMessage[],
    contextWindow: number,
    instructions?: string
  ): Promise<CompactionResult> {
    const result = await this.compactor.compact(messages, instructions);
    
    if (result.compacted) {
      await this.applyCompaction(sessionKey, messages, result);
    }
    
    return result;
  }

  /**
   * Estimate token usage for a session
   */
  async estimateTokenUsage(sessionKey: string, messages: AgentMessage[]): Promise<number> {
    return this.compactor.estimateTotalTokens(messages);
  }

  /**
   * Get compaction stats for a session
   */
  getCompactionStats(sessionKey: string) {
    return this.sessionMetadata.get(sessionKey)?.compactionStats;
  }

  /**
   * Get window stats for a session
   */
  getWindowStats(messages: AgentMessage[]) {
    return this.window.getStats(messages);
  }

  private getPath(sessionKey: string): string {
    const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.sessionsDir, `${safeKey}.json`);
  }

  private getMetadataPath(sessionKey: string): string {
    const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.sessionsDir, `${safeKey}.meta.json`);
  }

  private async loadMetadata(sessionKey: string): Promise<void> {
    try {
      const path = this.getMetadataPath(sessionKey);
      const data = await readFile(path, 'utf-8');
      const metadata = JSON.parse(data) as SessionMetadata;
      this.sessionMetadata.set(sessionKey, metadata);
    } catch {
      this.sessionMetadata.set(sessionKey, {
        compactionStats: {
          compactionCount: 0,
          totalTokensBefore: 0,
          totalTokensAfter: 0,
        },
        lastAccessedAt: new Date().toISOString(),
      });
    }
  }

  private async saveMetadata(sessionKey: string): Promise<void> {
    const metadata = this.sessionMetadata.get(sessionKey);
    if (!metadata) return;
    
    const path = this.getMetadataPath(sessionKey);
    await writeFile(path, JSON.stringify(metadata, null, 2));
  }

  private updateMetadata(sessionKey: string, updates: Partial<SessionMetadata>): void {
    const existing = this.sessionMetadata.get(sessionKey);
    if (existing) {
      Object.assign(existing, updates);
    } else {
      this.sessionMetadata.set(sessionKey, {
        compactionStats: {
          compactionCount: 0,
          totalTokensBefore: 0,
          totalTokensAfter: 0,
        },
        lastAccessedAt: new Date().toISOString(),
        ...updates,
      });
    }
  }
}

// Export types
export type { CompactionConfig, CompactionResult, WindowConfig };

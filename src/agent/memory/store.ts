// Session memory store - persists agent messages to disk with compaction support
import { type AgentMessage } from '@mariozechner/pi-agent-core';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import {
  type CompactionConfig,
  type CompactionResult,
  type PruningConfig,
  type CompactionStats,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_PRUNING_CONFIG,
  slidingWindowTrim,
  estimateTokens,
  shouldCompact,
  buildSummaryPrompt,
  pruneToolResults,
  createCompactionStats,
} from './compaction.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('MemoryStore');

interface SessionMetadata {
  compactionStats: CompactionStats;
  lastAccessedAt: string;
}

export class MemoryStore {
  private sessionsDir: string;
  private compactionConfig: CompactionConfig;
  private pruningConfig: PruningConfig;
  private sessionMetadata = new Map<string, SessionMetadata>();

  constructor(
    workspace: string,
    compactionConfig?: Partial<CompactionConfig>,
    pruningConfig?: Partial<PruningConfig>
  ) {
    this.sessionsDir = join(workspace, '.sessions');
    this.compactionConfig = { ...DEFAULT_COMPACTION_CONFIG, ...compactionConfig };
    this.pruningConfig = { ...DEFAULT_PRUNING_CONFIG, ...pruningConfig };
  }

  async load(sessionKey: string): Promise<AgentMessage[]> {
    const path = this.getPath(sessionKey);
    
    try {
      const data = await readFile(path, 'utf-8');
      const messages = JSON.parse(data) as AgentMessage[];
      
      // Load metadata
      await this.loadMetadata(sessionKey);
      
      // Apply pruning to tool results
      const pruned = pruneToolResults(messages, this.pruningConfig);
      
      log.debug({ sessionKey, messageCount: pruned.length }, 'Session loaded');
      return pruned;
    } catch {
      return [];
    }
  }

  async save(sessionKey: string, messages: AgentMessage[]): Promise<void> {
    const path = this.getPath(sessionKey);
    await mkdir(this.sessionsDir, { recursive: true });
    await writeFile(path, JSON.stringify(messages, null, 2));
    
    // Update metadata
    this.updateMetadata(sessionKey, { lastAccessedAt: new Date().toISOString() });
    await this.saveMetadata(sessionKey);
    
    log.debug({ sessionKey, messageCount: messages.length }, 'Session saved');
  }

  /**
   * Check if compaction is needed and return compacted messages
   * This is a preparation step - actual compaction requires LLM call
   */
  async prepareCompaction(
    sessionKey: string,
    contextWindow: number
  ): Promise<{ needsCompaction: boolean; messages: AgentMessage[]; stats?: CompactionStats }> {
    const messages = await this.load(sessionKey);
    const metadata = this.sessionMetadata.get(sessionKey) || {
      compactionStats: createCompactionStats(),
      lastAccessedAt: new Date().toISOString(),
    };

    if (!shouldCompact(messages, contextWindow, this.compactionConfig)) {
      return { needsCompaction: false, messages, stats: metadata.compactionStats };
    }

    return { needsCompaction: true, messages, stats: metadata.compactionStats };
  }

  /**
   * Apply compaction with provided summary
   */
  async applyCompaction(
    sessionKey: string,
    result: CompactionResult
  ): Promise<void> {
    const messages = await this.load(sessionKey);
    
    // Build compacted message list
    // Use 'user' role for summary since pi-agent-core doesn't have 'system'
    const summaryMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: `[Previous conversation summary]: ${result.summary}` }],
      timestamp: Date.now(),
    };
    
    const keptMessages = messages.slice(result.firstKeptIndex);
    const compactedMessages = [summaryMessage, ...keptMessages];
    
    // Save compacted messages
    await this.save(sessionKey, compactedMessages);
    
    // Update stats
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
      keptMessages: keptMessages.length,
    }, 'Session compacted');
  }

  /**
   * Force sliding window trim (emergency measure)
   */
  async emergencyTrim(sessionKey: string, maxMessages: number): Promise<void> {
    const messages = await this.load(sessionKey);
    const trimmed = slidingWindowTrim(messages, maxMessages, true);
    await this.save(sessionKey, trimmed);
    
    log.warn({ sessionKey, before: messages.length, after: trimmed.length }, 'Emergency trim applied');
  }

  /**
   * Get compaction stats for a session
   */
  getCompactionStats(sessionKey: string): CompactionStats | undefined {
    return this.sessionMetadata.get(sessionKey)?.compactionStats;
  }

  /**
   * Estimate current token usage
   */
  async estimateTokenUsage(sessionKey: string): Promise<number> {
    const messages = await this.load(sessionKey);
    return estimateTokens(messages);
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
      // No metadata yet
      this.sessionMetadata.set(sessionKey, {
        compactionStats: createCompactionStats(),
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
        compactionStats: createCompactionStats(),
        lastAccessedAt: new Date().toISOString(),
        ...updates,
      });
    }
  }
}

// Re-export types
export type { CompactionConfig, CompactionResult, PruningConfig, CompactionStats };
export {
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_PRUNING_CONFIG,
  slidingWindowTrim,
  estimateTokens,
  shouldCompact,
  buildSummaryPrompt,
  pruneToolResults,
  createCompactionStats,
};

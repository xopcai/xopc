// Session memory store - persists agent messages to disk
import { type AgentMessage } from '@mariozechner/pi-agent-core';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('MemoryStore');

interface SessionMetadata {
  lastAccessedAt: string;
}

export class MemoryStore {
  private sessionsDir: string;
  private sessionMetadata = new Map<string, SessionMetadata>();

  constructor(workspace: string) {
    this.sessionsDir = join(workspace, '.sessions');
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
    const path = this.getPath(sessionKey);
    await mkdir(this.sessionsDir, { recursive: true });
    await writeFile(path, JSON.stringify(messages, null, 2));
    
    this.updateMetadata(sessionKey, { lastAccessedAt: new Date().toISOString() });
    await this.saveMetadata(sessionKey);
    
    log.debug({ sessionKey, messageCount: messages.length }, 'Session saved');
  }

  async estimateTokenUsage(_sessionKey: string): Promise<number> {
    // Placeholder: actual implementation would count tokens
    return 0;
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
        lastAccessedAt: new Date().toISOString(),
        ...updates,
      });
    }
  }
}

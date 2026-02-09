// Session memory store - persists agent messages to disk
import { type AgentMessage } from '@mariozechner/pi-agent-core';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export class MemoryStore {
  private sessionsDir: string;

  constructor(workspace: string) {
    this.sessionsDir = join(workspace, '.sessions');
  }

  async load(sessionKey: string): Promise<AgentMessage[]> {
    const path = this.getPath(sessionKey);
    try {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data) as AgentMessage[];
    } catch {
      return [];
    }
  }

  async save(sessionKey: string, messages: AgentMessage[]): Promise<void> {
    const path = this.getPath(sessionKey);
    await mkdir(this.sessionsDir, { recursive: true });
    await writeFile(path, JSON.stringify(messages, null, 2));
  }

  private getPath(sessionKey: string): string {
    // Sanitize session key for filesystem
    const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.sessionsDir, `${safeKey}.json`);
  }
}

/**
 * ACP Session Store
 * 
 * Simple in-memory session store for ACP sessions.
 */

import type { SessionAcpMeta } from "./runtime/types.js";

export interface SessionEntry {
  sessionKey: string;
  acp?: SessionAcpMeta;
}

/**
 * Default in-memory ACP session store
 */
export class DefaultAcpSessionStore {
  private sessions = new Map<string, SessionEntry>();

  async get(sessionKey: string): Promise<SessionEntry | null> {
    return this.sessions.get(sessionKey) || null;
  }

  async set(sessionKey: string, entry: SessionEntry): Promise<void> {
    this.sessions.set(sessionKey, entry);
  }

  async delete(sessionKey: string): Promise<void> {
    this.sessions.delete(sessionKey);
  }

  async list(): Promise<SessionEntry[]> {
    return Array.from(this.sessions.values());
  }

  async clear(): Promise<void> {
    this.sessions.clear();
  }
}

/**
 * Default session store instance
 */
export const defaultAcpSessionStore = new DefaultAcpSessionStore();

/**
 * AcpSessionStore interface
 */
export type AcpSessionStore = DefaultAcpSessionStore;

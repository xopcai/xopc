/**
 * ACP Session Store
 *
 * File-based persistence for ACP session metadata under the agent home `sessions/` tree.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { createLogger } from '../../utils/logger.js';
import type { Config } from '../../config/schema.js';
import { loadConfig } from '../../config/loader.js';
import { resolveAgentHomeDir, resolveDefaultAgentId } from '../../agent/agent-scope.js';
import type { SessionEntry } from './manager.types.js';

const log = createLogger('AcpSessionStore');

const ACP_SESSIONS_INDEX_FILE = 'acp-sessions.json';

/** ACP Session Store */
export class AcpSessionStore {
  private indexFile: string;
  private sessionsDir: string;
  private indexCache: Map<string, SessionEntry> | null = null;
  private indexDirty = false;

  constructor(agentHomeDir: string) {
    this.sessionsDir = join(agentHomeDir, 'sessions');
    this.indexFile = join(this.sessionsDir, ACP_SESSIONS_INDEX_FILE);
  }

  /** Initialize the store */
  async initialize(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    log.info({ dir: this.sessionsDir }, 'ACP session store initialized');
  }

  /** Load session entry from store */
  async load(sessionKey: string): Promise<SessionEntry | null> {
    const key = this.normalizeSessionKey(sessionKey);
    if (!key) {
      return null;
    }

    // Load index if not cached
    if (!this.indexCache) {
      await this.loadIndex();
    }

    // Try exact match first
    let entry = this.indexCache?.get(key) ?? null;

    // Try case-insensitive match
    if (!entry && this.indexCache) {
      for (const [cachedKey, cachedEntry] of this.indexCache) {
        if (cachedKey.toLowerCase() === key.toLowerCase()) {
          entry = cachedEntry;
          break;
        }
      }
    }

    return entry ?? null;
  }

  /** Save session entry to store */
  async save(sessionKey: string, entry: SessionEntry): Promise<void> {
    const key = this.normalizeSessionKey(sessionKey);
    if (!key) {
      log.warn({ sessionKey }, 'Invalid session key, skipping save');
      return;
    }

    // Load index if not cached
    if (!this.indexCache) {
      await this.loadIndex();
    }

    // Update cache
    this.indexCache!.set(key, {
      ...entry,
      sessionKey: key,
    });
    this.indexDirty = true;

    // Persist to disk
    await this.saveIndex();
  }

  /** List all session entries */
  async list(): Promise<SessionEntry[]> {
    // Load index if not cached
    if (!this.indexCache) {
      await this.loadIndex();
    }

    return Array.from(this.indexCache?.values() ?? []);
  }

  /** List all ACP session entries (filter by acp metadata) */
  async listAcpSessions(): Promise<SessionEntry[]> {
    const all = await this.list();
    return all.filter((entry) => entry.acp != null);
  }

  /** Delete session entry */
  async delete(sessionKey: string): Promise<void> {
    const key = this.normalizeSessionKey(sessionKey);
    if (!key) {
      return;
    }

    // Load index if not cached
    if (!this.indexCache) {
      await this.loadIndex();
    }

    // Find and remove the entry (case-insensitive)
    let foundKey: string | null = null;
    for (const cachedKey of this.indexCache?.keys() ?? []) {
      if (cachedKey.toLowerCase() === key.toLowerCase()) {
        foundKey = cachedKey;
        break;
      }
    }

    if (foundKey) {
      this.indexCache!.delete(foundKey);
      this.indexDirty = true;
      await this.saveIndex();
    }
  }

  /** Clear all ACP sessions */
  async clear(): Promise<void> {
    this.indexCache = new Map();
    this.indexDirty = true;
    await this.saveIndex();
  }

  // ========== Private Methods ==========

  /** Normalize session key */
  private normalizeSessionKey(sessionKey: string): string {
    return sessionKey.trim().toLowerCase();
  }

  /** Load index from disk */
  private async loadIndex(): Promise<void> {
    try {
      if (!existsSync(this.indexFile)) {
        this.indexCache = new Map();
        return;
      }

      const data = await readFile(this.indexFile, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, SessionEntry>;

      this.indexCache = new Map();
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry.acp) {
          this.indexCache.set(key, entry);
        }
      }
    } catch (error) {
      const em = error instanceof Error ? error.message : String(error);
      log.warn(
        { err: error, path: this.indexFile, errorMessage: em },
        `ACP session index load failed (starting empty): ${em}`,
      );
      this.indexCache = new Map();
    }
  }

  /** Save index to disk */
  private async saveIndex(): Promise<void> {
    if (!this.indexDirty || !this.indexCache) {
      return;
    }

    try {
      const obj: Record<string, SessionEntry> = {};
      for (const [key, entry] of this.indexCache) {
        obj[key] = entry;
      }
      await writeFile(this.indexFile, JSON.stringify(obj, null, 2), 'utf-8');
      this.indexDirty = false;
    } catch (error) {
      const em = error instanceof Error ? error.message : String(error);
      log.error({ err: error, path: this.indexFile, errorMessage: em }, `Failed to save ACP session index: ${em}`);
      throw error;
    }
  }
}

/** Default agent home for ACP persistence (matches main session store agent id). */
export function resolveAcpAgentHome(cfg: Config): string {
  return resolveAgentHomeDir(cfg, resolveDefaultAgentId(cfg));
}

/** Construct store using loaded config (singleton-friendly). */
export function createDefaultAcpSessionStore(): AcpSessionStore {
  const c = loadConfig();
  const home = resolveAcpAgentHome(c);
  return new AcpSessionStore(home);
}

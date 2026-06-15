import { createLogger } from '../utils/logger.js';
import type { ThinkLevel, ReasoningLevel, VerboseLevel, ElevatedMode } from '../agent/transcript/thinking-types.js';
import {
  deleteSessionConfig as deleteSqliteSessionConfig,
  getSessionConfig as getSqliteSessionConfig,
  hasSessionConfig,
  isXopcDatabaseOpen,
  openXopcDatabase,
  setSessionConfig as setSqliteSessionConfig,
  updateSessionConfig as updateSqliteSessionConfig,
} from '../storage/sqlite/index.js';

const log = createLogger('SessionConfigStore');

/**
 * Session-level agent configuration.
 * These settings override agent defaults for a specific session.
 */
export interface SessionAgentConfig {
  thinkingLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  verboseLevel?: VerboseLevel;
  elevatedMode?: ElevatedMode;
  modelOverride?: string;
  providerOverride?: string;
  workingDirectoryOverride?: string;
  updatedAt?: number;
}

export class SessionConfigStore {
  private cwd: string;

  constructor(_agentHomeDir: string, cwd = process.cwd()) {
    this.cwd = cwd;
  }

  private ensureDatabase(): void {
    if (!isXopcDatabaseOpen()) {
      openXopcDatabase();
    }
  }

  async initialize(): Promise<void> {
    this.ensureDatabase();
    log.debug('Session config store initialized (SQLite)');
  }

  async get(sessionKey: string): Promise<SessionAgentConfig | null> {
    this.ensureDatabase();
    return getSqliteSessionConfig(sessionKey);
  }

  async set(sessionKey: string, config: SessionAgentConfig): Promise<void> {
    this.ensureDatabase();
    setSqliteSessionConfig(sessionKey, config, this.cwd);
    log.debug({ sessionKey }, 'Session config saved');
  }

  async update(sessionKey: string, partial: Partial<SessionAgentConfig>): Promise<SessionAgentConfig> {
    this.ensureDatabase();
    const updated = updateSqliteSessionConfig(sessionKey, partial, this.cwd);
    log.debug({ sessionKey }, 'Session config updated');
    return updated;
  }

  async delete(sessionKey: string): Promise<void> {
    this.ensureDatabase();
    deleteSqliteSessionConfig(sessionKey);
    log.debug({ sessionKey }, 'Session config deleted');
  }

  async has(sessionKey: string): Promise<boolean> {
    this.ensureDatabase();
    return hasSessionConfig(sessionKey);
  }

  async getAll(): Promise<Map<string, SessionAgentConfig>> {
    this.ensureDatabase();
    const configs = new Map<string, SessionAgentConfig>();
    const { listSessionMetadata } = await import('../storage/sqlite/index.js');
    const { items } = listSessionMetadata({ limit: 100_000 });
    for (const item of items) {
      const config = getSqliteSessionConfig(item.key);
      if (config) {
        configs.set(item.key, config);
      }
    }
    return configs;
  }

  async clear(): Promise<void> {
    this.ensureDatabase();
    const { listSessionMetadata } = await import('../storage/sqlite/index.js');
    const { items } = listSessionMetadata({ limit: 100_000 });
    for (const item of items) {
      deleteSqliteSessionConfig(item.key);
    }
    log.debug('All session configs cleared');
  }
}

export async function resolveThinkingLevel(
  sessionConfigStore: SessionConfigStore,
  sessionKey: string,
  agentDefault?: ThinkLevel,
): Promise<ThinkLevel | undefined> {
  const config = await sessionConfigStore.get(sessionKey);
  return config?.thinkingLevel ?? agentDefault;
}

export async function resolveReasoningLevel(
  sessionConfigStore: SessionConfigStore,
  sessionKey: string,
  agentDefault?: ReasoningLevel,
): Promise<ReasoningLevel | undefined> {
  const config = await sessionConfigStore.get(sessionKey);
  return config?.reasoningLevel ?? agentDefault;
}

export async function resolveVerboseLevel(
  sessionConfigStore: SessionConfigStore,
  sessionKey: string,
  agentDefault?: VerboseLevel,
): Promise<VerboseLevel | undefined> {
  const config = await sessionConfigStore.get(sessionKey);
  return config?.verboseLevel ?? agentDefault;
}

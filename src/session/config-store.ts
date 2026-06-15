import type { ReasoningLevel, ThinkLevel, VerboseLevel } from '../agent/transcript/thinking-types.js';
import {
  deleteSessionConfig as deleteSqliteSessionConfig,
  getSessionConfig as getSqliteSessionConfig,
  hasSessionConfig,
  requireXopcDatabase,
  setSessionConfig as setSqliteSessionConfig,
  updateSessionConfig as updateSqliteSessionConfig,
} from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import type { SessionAgentConfig } from './config-types.js';

export type { SessionAgentConfig } from './config-types.js';

const log = createLogger('SessionConfigStore');

export class SessionConfigStore {
  private cwd: string;

  constructor(_agentHomeDir: string, cwd = process.cwd()) {
    this.cwd = cwd;
  }

  private requireDatabase(): void {
    requireXopcDatabase();
  }

  async initialize(): Promise<void> {
    this.requireDatabase();
    log.debug('Session config store initialized (SQLite)');
  }

  async get(sessionKey: string): Promise<SessionAgentConfig | null> {
    this.requireDatabase();
    return getSqliteSessionConfig(sessionKey);
  }

  async set(sessionKey: string, config: SessionAgentConfig): Promise<void> {
    this.requireDatabase();
    setSqliteSessionConfig(sessionKey, config, this.cwd);
    log.debug({ sessionKey }, 'Session config saved');
  }

  async update(sessionKey: string, partial: Partial<SessionAgentConfig>): Promise<SessionAgentConfig> {
    this.requireDatabase();
    const updated = updateSqliteSessionConfig(sessionKey, partial, this.cwd);
    log.debug({ sessionKey }, 'Session config updated');
    return updated;
  }

  async delete(sessionKey: string): Promise<void> {
    this.requireDatabase();
    deleteSqliteSessionConfig(sessionKey);
    log.debug({ sessionKey }, 'Session config deleted');
  }

  async has(sessionKey: string): Promise<boolean> {
    this.requireDatabase();
    return hasSessionConfig(sessionKey);
  }

  async getAll(): Promise<Map<string, SessionAgentConfig>> {
    this.requireDatabase();
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
    this.requireDatabase();
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

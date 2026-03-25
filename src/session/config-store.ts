/**
 * Session Config Store
 * 
 * Manages session-level configuration persistence.
 * Stores thinking level, reasoning visibility, verbose mode, and other
 * session-specific settings that can be overridden via commands.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { createLogger } from '../utils/logger.js';
import type { ThinkLevel, ReasoningLevel, VerboseLevel, ElevatedMode } from '../agent/transcript/thinking-types.js';

const log = createLogger('SessionConfigStore');

/**
 * Session-level agent configuration.
 * These settings override agent defaults for a specific session.
 */
export interface SessionAgentConfig {
  /** Thinking level for this session */
  thinkingLevel?: ThinkLevel;
  /** Reasoning visibility for this session */
  reasoningLevel?: ReasoningLevel;
  /** Verbose level for this session */
  verboseLevel?: VerboseLevel;
  /** Elevated mode for this session */
  elevatedMode?: ElevatedMode;
  /** Model override for this session */
  modelOverride?: string;
  /** Provider override for this session */
  providerOverride?: string;
  /** Last updated timestamp */
  updatedAt?: number;
}

/**
 * Session config store manager.
 * Each session can have its own configuration that overrides agent defaults.
 */
export class SessionConfigStore {
  private baseDir: string;
  private configDir: string;

  constructor(workspace: string) {
    this.baseDir = workspace;
    this.configDir = join(workspace, '.sessions', 'config');
  }

  /**
   * Initialize the config store
   */
  async initialize(): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    log.debug('Session config store initialized');
  }

  /**
   * Get the config file path for a session
   */
  private getConfigPath(sessionKey: string): string {
    // Sanitize session key to be a valid filename
    const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.configDir, `${safeKey}.json`);
  }

  /**
   * Get config for a session
   */
  async get(sessionKey: string): Promise<SessionAgentConfig | null> {
    const configPath = this.getConfigPath(sessionKey);
    
    if (!existsSync(configPath)) {
      return null;
    }

    try {
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content) as SessionAgentConfig;
      return config;
    } catch (error) {
      log.error({ sessionKey, error }, 'Failed to read session config');
      return null;
    }
  }

  /**
   * Set config for a session (full replacement)
   */
  async set(sessionKey: string, config: SessionAgentConfig): Promise<void> {
    const configPath = this.getConfigPath(sessionKey);
    const configWithTimestamp = {
      ...config,
      updatedAt: Date.now(),
    };

    try {
      await writeFile(configPath, JSON.stringify(configWithTimestamp, null, 2), 'utf-8');
      log.debug({ sessionKey }, 'Session config saved');
    } catch (error) {
      log.error({ sessionKey, error }, 'Failed to save session config');
      throw error;
    }
  }

  /**
   * Update config for a session (partial update)
   */
  async update(sessionKey: string, partial: Partial<SessionAgentConfig>): Promise<SessionAgentConfig> {
    const existing = await this.get(sessionKey);
    const updated = {
      ...existing,
      ...partial,
      updatedAt: Date.now(),
    };
    
    await this.set(sessionKey, updated);
    return updated;
  }

  /**
   * Delete config for a session
   */
  async delete(sessionKey: string): Promise<void> {
    const configPath = this.getConfigPath(sessionKey);
    
    if (existsSync(configPath)) {
      try {
        const { unlink } = await import('fs/promises');
        await unlink(configPath);
        log.debug({ sessionKey }, 'Session config deleted');
      } catch (error) {
        log.error({ sessionKey, error }, 'Failed to delete session config');
        throw error;
      }
    }
  }

  /**
   * Check if config exists for a session
   */
  async has(sessionKey: string): Promise<boolean> {
    const configPath = this.getConfigPath(sessionKey);
    return existsSync(configPath);
  }

  /**
   * Get all session configs
   */
  async getAll(): Promise<Map<string, SessionAgentConfig>> {
    const { readdir } = await import('fs/promises');
    const configs = new Map<string, SessionAgentConfig>();

    try {
      const files = await readdir(this.configDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const sessionKey = file.replace('.json', '').replace(/_/g, '-');
        const config = await this.get(sessionKey);
        
        if (config) {
          configs.set(sessionKey, config);
        }
      }
    } catch (error) {
      log.error({ error }, 'Failed to list session configs');
    }

    return configs;
  }

  /**
   * Clear all session configs
   */
  async clear(): Promise<void> {
    const { readdir, rm } = await import('fs/promises');
    
    try {
      const files = await readdir(this.configDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          await rm(join(this.configDir, file), { force: true });
        }
      }
      
      log.debug('All session configs cleared');
    } catch (error) {
      log.error({ error }, 'Failed to clear session configs');
      throw error;
    }
  }
}

// ========== Helper Functions ==========

/**
 * Resolve thinking level for a session.
 * Returns session config if set, otherwise falls back to agent defaults.
 */
export async function resolveThinkingLevel(
  sessionConfigStore: SessionConfigStore,
  sessionKey: string,
  agentDefault?: ThinkLevel
): Promise<ThinkLevel | undefined> {
  const config = await sessionConfigStore.get(sessionKey);
  
  if (config?.thinkingLevel) {
    return config.thinkingLevel;
  }
  
  return agentDefault;
}

/**
 * Resolve reasoning level for a session.
 */
export async function resolveReasoningLevel(
  sessionConfigStore: SessionConfigStore,
  sessionKey: string,
  agentDefault?: ReasoningLevel
): Promise<ReasoningLevel | undefined> {
  const config = await sessionConfigStore.get(sessionKey);
  
  if (config?.reasoningLevel) {
    return config.reasoningLevel;
  }
  
  return agentDefault;
}

/**
 * Resolve verbose level for a session.
 */
export async function resolveVerboseLevel(
  sessionConfigStore: SessionConfigStore,
  sessionKey: string,
  agentDefault?: VerboseLevel
): Promise<VerboseLevel | undefined> {
  const config = await sessionConfigStore.get(sessionKey);
  
  if (config?.verboseLevel) {
    return config.verboseLevel;
  }
  
  return agentDefault;
}

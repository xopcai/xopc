/**
 * SessionHydrator — read persisted per-session config and push it into the
 * in-memory runtime (AgentManager + ModelManager).
 *
 * These three operations were three sibling private methods on `AgentService`
 * with subtly different signatures. They are the mirror image of
 * {@link SessionConfigService} — the latter writes user choices into the
 * config store, this hydrator reads them back out before a turn runs.
 *
 *   - `workspace()`  — apply persisted `workingDirectoryOverride` to AgentManager
 *                       and ensure the directory exists on disk
 *   - `model()`      — apply persisted `modelOverride` via ModelManager
 *   - `thinking()`   — resolve effective thinking level (request override >
 *                       per-session override > agent default) and apply
 */

import { mkdir } from 'node:fs/promises';

import type { Config } from '../../config/schema.js';
import {
  effectiveWorkspacePathForSession,
  normalizeWorkingDirectoryInput,
  resolveEffectiveThinkingLevel,
  type SessionConfigStore,
} from '../../session/index.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { ModelManager } from '../models/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SessionHydrator');

export interface SessionHydratorOptions {
  sessionConfigStore: SessionConfigStore;
  agentManager: AgentInstanceGateway;
  modelManager: ModelManager;
  /** Effective config snapshot accessor (honours runtime overrides). */
  getConfig: () => Config | undefined;
}

export class SessionHydrator {
  private readonly opts: SessionHydratorOptions;

  constructor(opts: SessionHydratorOptions) {
    this.opts = opts;
  }

  /**
   * Load persisted workingDirectory override into AgentManager and `mkdir -p`
   * the effective workspace path. Safe to call before `getOrCreateAgent`.
   */
  async workspace(sessionKey: string): Promise<void> {
    const cfg = this.opts.getConfig();
    if (!cfg) {
      return;
    }
    const loaded = await this.opts.sessionConfigStore.get(sessionKey);
    if (loaded?.workingDirectoryOverride?.trim()) {
      const wdStored = normalizeWorkingDirectoryInput(loaded.workingDirectoryOverride);
      if (wdStored.ok) {
        this.opts.agentManager.setSessionWorkspaceOverride(sessionKey, wdStored.path);
      } else {
        log.warn({ sessionKey }, 'Invalid stored workingDirectoryOverride; ignoring');
        this.opts.agentManager.setSessionWorkspaceOverride(sessionKey, null);
      }
    } else {
      this.opts.agentManager.setSessionWorkspaceOverride(sessionKey, null);
    }
    const effective = effectiveWorkspacePathForSession(cfg, sessionKey, loaded);
    await mkdir(effective, { recursive: true });
  }

  /** Apply persisted `modelOverride` to ModelManager (no-op when none stored). */
  async model(sessionKey: string): Promise<void> {
    const cfg = await this.opts.sessionConfigStore.get(sessionKey);
    if (cfg?.modelOverride) {
      await this.opts.modelManager.switchModelForSession(sessionKey, cfg.modelOverride);
    }
  }

  /**
   * Resolve the effective thinking level (request override > per-session
   * override > agent default) and apply it to the live agent instance.
   */
  async thinking(sessionKey: string, requestOverride?: string | null): Promise<void> {
    const def = this.opts.getConfig()?.agents?.defaults?.thinkingDefault;
    const level = await resolveEffectiveThinkingLevel(
      this.opts.sessionConfigStore,
      sessionKey,
      requestOverride,
      def,
    );
    this.opts.agentManager.setThinkingLevel(sessionKey, level);
  }
}

/**
 * SessionHydrator — read persisted per-session config and push it into the
 * in-memory runtime (AgentManager + ModelManager).
 *
 * These three operations were three sibling private methods on `AgentService`
 * with subtly different signatures. They are the mirror image of
 * {@link SessionConfigService} — the latter writes user choices into the
 * config store, this hydrator reads them back out before a turn runs.
 *
 *   - `workspace()`  — resolve the execution workspace and apply it to AgentManager
 *   - `model()`      — apply persisted `modelOverride` via ModelManager
 *   - `thinking()`   — resolve effective thinking level (request override >
 *                       per-session override > agent default) and apply
 */

import { mkdir, stat } from 'node:fs/promises';

import type { Config } from '../../config/schema.js';
import { getModelThinking } from '../../providers/model-thinking.js';
import {
  effectiveWorkspacePathForSession,
  normalizeWorkingDirectoryInput,
  projectWorkspacePath,
  resolveEffectiveThinkingLevel,
  type SessionConfigStore,
} from '../../session/index.js';
import { getProjectForSession } from '../../projects/workspace.js';
import { getExecutionEnvironmentForSession } from '../../execution-environments/subject.js';
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
   * Load the effective workspace into AgentManager. Managed environment roots
   * must already exist; ordinary project and agent workspaces may be created.
   */
  async workspace(sessionKey: string): Promise<void> {
    const cfg = this.opts.getConfig();
    if (!cfg) {
      return;
    }
    const loaded = await this.opts.sessionConfigStore.get(sessionKey);
    const project = getProjectForSession(sessionKey);
    const environment = getExecutionEnvironmentForSession(sessionKey);
    const projectWorkspace = projectWorkspacePath(project);
    if (environment) {
      if (environment.status !== 'ready') {
        throw new Error(`Execution environment ${environment.id} is ${environment.status}`);
      }
      const rootIsDirectory = await stat(environment.rootPath).then((value) => value.isDirectory()).catch(() => false);
      if (!rootIsDirectory) {
        throw new Error(`Execution environment root is unavailable: ${environment.rootPath}`);
      }
      this.opts.agentManager.setSessionWorkspaceOverride(sessionKey, environment.rootPath);
    } else if (projectWorkspace) {
      this.opts.agentManager.setSessionWorkspaceOverride(sessionKey, projectWorkspace);
    } else if (loaded?.workingDirectoryOverride?.trim()) {
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
    const effective = effectiveWorkspacePathForSession(cfg, sessionKey, loaded, project);
    if (!environment) await mkdir(effective, { recursive: true });
  }

  /** Apply persisted `modelOverride` to ModelManager (no-op when none stored). */
  async model(sessionKey: string): Promise<void> {
    const cfg = await this.opts.sessionConfigStore.get(sessionKey);
    if (cfg?.modelOverride) {
      this.opts.modelManager.restoreSessionModel(sessionKey, cfg.modelOverride, cfg.fixedModel === true);
    }
  }

  /**
   * Resolve the effective thinking level (request override > per-session
   * override > agent default) and apply it to the live agent instance.
   */
  async thinking(sessionKey: string, requestOverride?: string | null): Promise<void> {
    const level = await resolveEffectiveThinkingLevel(
      this.opts.sessionConfigStore,
      sessionKey,
      requestOverride,
      undefined,
    );
    const stored = await this.opts.sessionConfigStore.get(sessionKey);
    if (stored?.fixedModel) {
      const model = this.opts.modelManager.getResolvedModelForSession(sessionKey);
      if (!getModelThinking(model).options.includes(level)) {
        throw new Error(`Thinking level ${level} is not supported by ${model.provider}/${model.id}`);
      }
    }
    this.opts.agentManager.setThinkingLevel(sessionKey, level);
  }
}

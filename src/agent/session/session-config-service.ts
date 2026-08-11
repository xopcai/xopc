/**
 * SessionConfigService — owns the "write side" of per-session agent settings
 * (model override, thinking level, reasoning level, working directory).
 *
 * Previously these lived as four sibling methods on `AgentService`:
 *   - `patchSessionAgentConfig` (96 lines of validation + persistence)
 *   - `applyAutomationWorkingDirectory` (automation working dir update)
 *   - `applyAutomationModelOverride` (automation model update before session creation)
 *   - `clearAutomationWorkingDirectoryOverride` (private helper)
 *   - `clearSessionModelOverride` (private helper)
 *
 * Extracted so `AgentService` no longer mixes "session bag" concerns with
 * "session config write" concerns, and so future additions to the patch API
 * (e.g. new per-session overrides) only touch this file.
 */

import { mkdir } from 'node:fs/promises';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { normalizeWorkingDirectoryInput } from '../../session/index.js';
import type { SessionConfigStore, SessionStore } from '../../session/index.js';
import {
  normalizeThinkLevel,
  normalizeReasoningLevel,
  normalizeVerboseLevel,
} from '../transcript/thinking-types.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { ModelManager } from '../models/index.js';
import { createLogger } from '../../utils/logger.js';
import { getProjectWorkspacePathForSession } from '../../projects/workspace.js';

const log = createLogger('SessionConfigService');

export interface SessionConfigServiceOptions {
  sessionStore: SessionStore;
  sessionConfigStore: SessionConfigStore;
  modelManager: ModelManager;
  agentManager: AgentInstanceGateway;
  /** Effective config snapshot accessor. */
  getConfig: () => Config | undefined;
}

export interface PatchSessionAgentConfigInput {
  thinkingLevel?: string;
  model?: string | null;
  /** Preferred activity-detail field. `null` clears the session override. */
  activityDetailLevel?: string | null;
  /** @deprecated Use activityDetailLevel. */
  reasoningLevel?: string | null;
  verboseLevel?: string;
  workingDirectory?: string;
}

export interface PatchSessionAgentConfigResult {
  ok: boolean;
  error?: string;
}

export class SessionConfigService {
  private readonly opts: SessionConfigServiceOptions;

  constructor(opts: SessionConfigServiceOptions) {
    this.opts = opts;
  }

  /**
   * Apply a partial patch (model / thinking / reasoning / working directory) to
   * a session's persisted config. Returns `{ ok: false, error }` on the first
   * invalid field — earlier fields that succeeded are NOT rolled back, matching
   * the previous behaviour.
   */
  async patch(
    sessionKey: string,
    partial: PatchSessionAgentConfigInput,
  ): Promise<PatchSessionAgentConfigResult> {
    if (partial.model !== undefined) {
      if (partial.model === null || partial.model === '') {
        await this.clearModelOverride(sessionKey);
      } else {
        const ok = await this.opts.modelManager.switchModelForSession(sessionKey, partial.model);
        if (!ok) {
          return { ok: false, error: 'Invalid model' };
        }
        await this.opts.sessionConfigStore.update(sessionKey, { modelOverride: partial.model });
        this.opts.agentManager.setModelForSession(sessionKey, partial.model);
      }
    }

    if (partial.thinkingLevel !== undefined) {
      const normalized = normalizeThinkLevel(partial.thinkingLevel);
      if (!normalized) {
        return { ok: false, error: 'Invalid thinking level' };
      }
      await this.opts.sessionConfigStore.update(sessionKey, { thinkingLevel: normalized });
      this.opts.agentManager.setThinkingLevel(sessionKey, normalized as ThinkingLevel);
    }

    const activityDetailLevel = partial.activityDetailLevel !== undefined
      ? partial.activityDetailLevel
      : partial.reasoningLevel;
    if (activityDetailLevel !== undefined) {
      if (activityDetailLevel === null) {
        await this.opts.sessionConfigStore.update(sessionKey, { reasoningLevel: undefined });
      } else {
        const normalized = normalizeReasoningLevel(activityDetailLevel);
        if (!normalized) {
          return { ok: false, error: 'Invalid activity detail level' };
        }
        await this.opts.sessionConfigStore.update(sessionKey, { reasoningLevel: normalized });
      }
    }

    if (partial.verboseLevel !== undefined) {
      const normalized = normalizeVerboseLevel(partial.verboseLevel);
      if (!normalized) {
        return { ok: false, error: 'Invalid verbose level' };
      }
      await this.opts.sessionConfigStore.update(sessionKey, { verboseLevel: normalized });
    }

    if (partial.workingDirectory !== undefined) {
      const cfg = this.opts.getConfig();
      if (!cfg) {
        return { ok: false, error: 'Config not loaded' };
      }
      if (getProjectWorkspacePathForSession(sessionKey)) {
        return {
          ok: false,
          error: 'Project sessions use the project workspace and cannot change working directory',
        };
      }
      const result = await this.patchWorkingDirectory(sessionKey, partial.workingDirectory);
      if (!result.ok) return result;
    }

    return { ok: true };
  }

  /**
   * Sync persisted session working directory for an automation run. Runs may
   * change when the automation is edited; an empty/missing input clears the
   * override so the session uses the effective agent default.
   */
  async applyAutomationWorkingDirectory(
    sessionKey: string,
    workingDirectory: string | undefined,
  ): Promise<void> {
    const raw = workingDirectory?.trim();
    if (raw) {
      const wdNorm = normalizeWorkingDirectoryInput(raw);
      if (wdNorm.ok === false) {
        log.warn(
          { sessionKey, error: wdNorm.error },
          'Automation working directory invalid; using agent default',
        );
        await this.clearAutomationWorkingDirectoryOverride(sessionKey);
        return;
      }
      await mkdir(wdNorm.path, { recursive: true });
      await this.opts.sessionConfigStore.update(sessionKey, { workingDirectoryOverride: wdNorm.path });
      this.opts.agentManager.setSessionWorkspaceOverride(sessionKey, wdNorm.path);
      return;
    }
    await this.clearAutomationWorkingDirectoryOverride(sessionKey);
  }

  /**
   * Persist an automation model override before the direct turn creates/hydrates
   * the AgentSession. Unlike the user-facing patch path, this must not call
   * `agentManager.setModelForSession`, because the automation session usually
   * does not exist yet.
   */
  async applyAutomationModelOverride(
    sessionKey: string,
    model: string | undefined,
  ): Promise<boolean> {
    const raw = model?.trim();
    if (!raw) {
      await this.clearModelOverride(sessionKey);
      return true;
    }
    const ok = await this.opts.modelManager.switchModelForSession(sessionKey, raw);
    if (!ok) {
      await this.clearModelOverride(sessionKey);
      return false;
    }
    await this.opts.sessionConfigStore.update(sessionKey, { modelOverride: raw });
    return true;
  }

  /**
   * Clear the session's model override (back to agent default). Used both by
   * {@link patch} and by `AgentService.resetSessionModelToAgentDefault`.
   */
  async clearModelOverride(sessionKey: string): Promise<void> {
    this.opts.modelManager.clearSessionModelOverride(sessionKey);
    await this.opts.sessionConfigStore.update(sessionKey, { modelOverride: undefined });
    const agent = this.opts.agentManager.getAgent(sessionKey);
    if (agent) {
      await this.opts.modelManager.applyModelForSession(agent, sessionKey);
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  private async clearAutomationWorkingDirectoryOverride(sessionKey: string): Promise<void> {
    const existing = await this.opts.sessionConfigStore.get(sessionKey);
    if (existing?.workingDirectoryOverride) {
      const { workingDirectoryOverride: _removed, ...rest } = existing;
      await this.opts.sessionConfigStore.set(sessionKey, rest);
    }
    this.opts.agentManager.setSessionWorkspaceOverride(sessionKey, null);
  }

  /**
   * Apply the workingDirectory branch of `patch`. Returns the next-step result
   * (`ok: true` to keep going, `ok: false, error` to short-circuit the patch).
   *
   * Working directory has the strictest semantics: once a session has any
   * messages, it cannot move to a different directory — only re-setting the
   * same path is idempotent.
   */
  private async patchWorkingDirectory(
    sessionKey: string,
    workingDirectory: string,
  ): Promise<PatchSessionAgentConfigResult> {
    const existing = await this.opts.sessionConfigStore.get(sessionKey);
    const existingRaw = existing?.workingDirectoryOverride?.trim();
    const incoming = workingDirectory.trim();

    const priorMessages = await this.opts.sessionStore.load(sessionKey);

    if (priorMessages.length > 0) {
      if (!incoming) {
        return { ok: false, error: 'workingDirectory is empty' };
      }
      if (!existingRaw) {
        return {
          ok: false,
          error: 'Working directory can only be set before the first message in this conversation',
        };
      }
      const prev = normalizeWorkingDirectoryInput(existingRaw);
      const next = normalizeWorkingDirectoryInput(incoming);
      if (prev.ok && next.ok && prev.path === next.path) {
        // idempotent
        return { ok: true };
      }
      return { ok: false, error: 'Working directory is already set for this session' };
    }

    if (!incoming) {
      return { ok: false, error: 'workingDirectory is empty' };
    }
    const wdNorm = normalizeWorkingDirectoryInput(incoming);
    switch (wdNorm.ok) {
      case true: {
        if (existingRaw) {
          const prev = normalizeWorkingDirectoryInput(existingRaw);
          if (prev.ok && prev.path === wdNorm.path) {
            return { ok: true };
          }
        }
        await mkdir(wdNorm.path, { recursive: true });
        await this.opts.sessionConfigStore.update(sessionKey, {
          workingDirectoryOverride: wdNorm.path,
        });
        this.opts.agentManager.setSessionWorkspaceOverride(sessionKey, wdNorm.path);
        this.opts.agentManager.removeAgent(sessionKey);
        return { ok: true };
      }
      case false:
        return { ok: false, error: wdNorm.error };
      default:
        return { ok: false, error: 'Invalid working directory' };
    }
  }
}

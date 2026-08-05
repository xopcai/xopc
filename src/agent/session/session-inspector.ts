/**
 * SessionInspector — read-only / introspection-oriented operations on a session.
 *
 * Owns the five methods previously scattered across `AgentService` that all
 * compute a "summary view" of one session:
 *   - `compact` (manual user-triggered compaction)
 *   - `btwQuery` (one-shot LLM answer with transcript as background)
 *   - `report` (Markdown / JSON `/context` summary)
 *   - `agentConfig` (resolved thinking + model + workspace for the Web UI)
 *   - `contextUsage` (rough token budget vs estimated transcript)
 *
 * The shared helper `computeStats` keeps the three callsites that need
 * `getWindowStats` / `getCompactionStats` / `estimateTokenUsage` in lockstep.
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { BtwQueryOptions } from '../../chat-commands/index.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { resolveDefaultAgentWorkspaceDir } from '../../config/workspace-defaults.js';
import {
  effectiveWorkspacePathForSession,
  projectWorkspacePath,
  resolveEffectiveReasoningLevel,
  resolveEffectiveThinkingLevel,
  resolveVerboseLevel,
  type SessionConfigStore,
} from '../../session/index.js';
import { getProjectForSession } from '../../projects/workspace.js';
import type { SessionStore } from '../../session/store.js';
import type { CompactionResult } from '../memory/compaction.js';
import type { ModelManager } from '../models/index.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import { runBtwQuery } from '../service/btw-query.js';
import { formatSessionContextReport } from '../service/session-context-report.js';
import type { ReasoningLevel, VerboseLevel } from '../transcript/thinking-types.js';
import { createLogger } from '../../utils/logger.js';
import type { SessionHydrator } from './session-hydrator.js';

const log = createLogger('SessionInspector');

export interface SessionInspectorOptions {
  sessionStore: SessionStore;
  sessionConfigStore: SessionConfigStore;
  modelManager: ModelManager;
  agentManager: AgentInstanceGateway;
  sessionHydrator: SessionHydrator;
  /** Effective config snapshot accessor (honours runtime overrides). */
  getConfig: () => Config | undefined;
  /**
   * Nominal context window the session is budgeted against. Derived from the
   * effective session model metadata, defaulting to 128k.
   */
  getContextWindow: (sessionKey: string) => number;
}

export interface SessionContextUsage {
  estimatedTokens: number;
  contextWindow: number;
  usagePercent: number | null;
}

export interface SessionAgentConfigView {
  thinkingLevel: ThinkingLevel;
  model: string;
  reasoningLevel: ReasoningLevel;
  verboseLevel: VerboseLevel;
  effectiveWorkspacePath: string;
  workingDirectoryLocked: boolean;
  workspaceSource: 'project' | 'session_override' | 'agent_default_root' | 'agent_workspace';
}

export class SessionInspector {
  private readonly opts: SessionInspectorOptions;

  constructor(opts: SessionInspectorOptions) {
    this.opts = opts;
  }

  private async ensureEffectiveSessionModel(sessionKey: string): Promise<void> {
    await this.opts.sessionHydrator.model(sessionKey);
    const cfg = this.opts.getConfig();
    if (!cfg) return;

    const profile = resolveEffectiveAgentProfileForSession(cfg, sessionKey);
    const profileModelRef = profile.primaryModelRef?.trim();
    if (profileModelRef) {
      this.opts.modelManager.setSessionProfileDefault(sessionKey, profileModelRef, profile.fallbacks);
    }
  }

  private async contextWindowForSession(sessionKey: string): Promise<number> {
    await this.ensureEffectiveSessionModel(sessionKey);
    return this.opts.getContextWindow(sessionKey);
  }

  /**
   * Manual compaction triggered by a user / API. Always forces a compaction
   * pass (`force: true` by default) and evicts the in-memory agent so the
   * next turn reloads from the compacted transcript.
   */
  async compact(
    sessionKey: string,
    options?: { instructions?: string; force?: boolean },
  ): Promise<CompactionResult> {
    const messages = await this.opts.sessionStore.load(sessionKey);
    await this.ensureEffectiveSessionModel(sessionKey);
    const model = this.opts.modelManager.getResolvedModelForSession(sessionKey);
    const result = await this.opts.sessionStore.compact(
      sessionKey,
      messages,
      model,
      options?.instructions,
      options?.force ?? true,
    );
    if (result.compacted) {
      this.opts.agentManager.removeAgent(sessionKey);
    }
    log.info({ sessionKey, result }, 'Manual compaction complete');
    return result;
  }

  /** One-shot LLM answer for `/btw`: transcript as background, not persisted. */
  btwQuery(
    sessionKey: string,
    question: string,
    options?: BtwQueryOptions,
  ): Promise<{ text: string; error?: string }> {
    const config = this.opts.getConfig();
    const profile = config ? resolveEffectiveAgentProfileForSession(config, sessionKey) : undefined;
    return runBtwQuery({
      sessionKey,
      question,
      sessionStore: this.opts.sessionStore,
      modelForSession: options?.modelRef?.trim() || this.opts.modelManager.getModelForSession(sessionKey),
      log,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      includeSessionContext: options?.includeSessionContext,
      onTextDelta: options?.onTextDelta,
      credentialOptions: profile && config
        ? { agentId: profile.agentId, appConfig: config }
        : undefined,
    });
  }

  /** Cheap stats used by both the report and other callers. */
  stats(sessionKey: string, messages: AgentMessage[]): {
    windowStats: ReturnType<SessionStore['getWindowStats']>;
    compactionStats: ReturnType<SessionStore['getCompactionStats']>;
    tokenEstimate: ReturnType<SessionStore['estimateTokenUsage']>;
  } {
    return {
      windowStats: this.opts.sessionStore.getWindowStats(messages),
      compactionStats: this.opts.sessionStore.getCompactionStats(sessionKey),
      tokenEstimate: this.opts.sessionStore.estimateTokenUsage(sessionKey, messages),
    };
  }

  /** Rough context usage for TUI footer (estimated tokens vs nominal budget). */
  async contextUsage(sessionKey: string): Promise<SessionContextUsage> {
    const messages = await this.opts.sessionStore.load(sessionKey);
    const contextWindow = await this.contextWindowForSession(sessionKey);
    const estimatedTokens = await this.opts.sessionStore.estimateTokenUsage(sessionKey, messages);
    const usagePercent =
      contextWindow > 0 ? Math.min(100, Math.round((estimatedTokens / contextWindow) * 100)) : null;
    return { estimatedTokens, contextWindow, usagePercent };
  }

  /** Markdown or JSON summary for `/context`. */
  async report(sessionKey: string, mode: 'list' | 'detail' | 'json'): Promise<string> {
    const cfg = this.opts.getConfig();
    if (!cfg) {
      throw new Error('SessionInspector requires a config snapshot to render report');
    }
    const messages = await this.opts.sessionStore.load(sessionKey);
    const cw = await this.contextWindowForSession(sessionKey);
    const computed = this.stats(sessionKey, messages);
    const model = this.opts.modelManager.getModelForSession(sessionKey);
    const sc = await this.opts.sessionConfigStore.get(sessionKey);
    const project = getProjectForSession(sessionKey);
    const workspace = effectiveWorkspacePathForSession(cfg, sessionKey, sc, project);
    const estTokens = await this.opts.sessionStore.estimateTokenUsage(sessionKey, messages);
    const profile = resolveEffectiveAgentProfileForSession(cfg, sessionKey);
    const deniedTools = [...profile.tools.denied].sort((a, b) => a.localeCompare(b));
    const toolsSummary = deniedTools.length > 0 ? `denied: ${deniedTools.join(', ')}` : '(no denied tools)';

    return formatSessionContextReport({
      sessionKey,
      mode,
      model,
      workspacePath: workspace,
      agentId: profile.agentId,
      messageCount: messages.length,
      contextWindowNominal: cw,
      estimatedTranscriptTokens: estTokens,
      thinkingDefault: undefined,
      reasoningDefault: undefined,
      verboseDefault: undefined,
      compaction: undefined,
      toolsFlagsSummary: toolsSummary,
      windowStats: computed.windowStats,
      compactionRunStats: computed.compactionStats,
    });
  }

  /** Resolved thinking / model / workspace for the Web UI. */
  async agentConfig(sessionKey: string): Promise<SessionAgentConfigView> {
    await this.ensureEffectiveSessionModel(sessionKey);
    const cfg = this.opts.getConfig();
    if (!cfg) {
      throw new Error('SessionInspector requires a config snapshot to resolve agent config');
    }
    const sc = await this.opts.sessionConfigStore.get(sessionKey);

    const defThink = 'medium';
    const level = await resolveEffectiveThinkingLevel(this.opts.sessionConfigStore, sessionKey, null, defThink);
    const defReason = 'stream' as ReasoningLevel;
    const reasoningLevel = await resolveEffectiveReasoningLevel(this.opts.sessionConfigStore, sessionKey, defReason);
    const defVerbose = 'full' as VerboseLevel;
    const verboseLevel = await resolveVerboseLevel(this.opts.sessionConfigStore, sessionKey, defVerbose);
    const model = this.opts.modelManager.getModelForSession(sessionKey);
    const project = getProjectForSession(sessionKey);
    const projectWorkspace = projectWorkspacePath(project);
    const hasSessionWorkspaceOverride = Boolean(sc?.workingDirectoryOverride?.trim());
    const effectiveWorkspacePath = effectiveWorkspacePathForSession(cfg, sessionKey, sc, project);
    const isDefaultWorkspaceRoot = effectiveWorkspacePath === resolveDefaultAgentWorkspaceDir();
    return {
      thinkingLevel: level,
      model,
      reasoningLevel,
      verboseLevel,
      effectiveWorkspacePath,
      workingDirectoryLocked: Boolean(projectWorkspace || hasSessionWorkspaceOverride),
      workspaceSource: projectWorkspace
        ? 'project'
        : hasSessionWorkspaceOverride
          ? 'session_override'
          : isDefaultWorkspaceRoot
            ? 'agent_default_root'
            : 'agent_workspace',
    };
  }
}

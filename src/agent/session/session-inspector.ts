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
import { resolveEffectiveAgentProfile, resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { resolveDefaultAgentWorkspaceDir } from '../../config/workspace-defaults.js';
import {
  effectiveWorkspacePathForSession,
  projectWorkspacePath,
  resolveConfiguredActivityDetailDefault,
  resolveEffectiveReasoningLevel,
  resolveEffectiveThinkingLevel,
  resolveVerboseLevel,
  type SessionConfigStore,
} from '../../session/index.js';
import { getProjectForSession } from '../../projects/workspace.js';
import { getExecutionEnvironmentForSession } from '../../execution-environments/subject.js';
import type { SessionStore } from '../../session/store.js';
import type { CompactionResult } from '../memory/compaction.js';
import { resolveCompactionPolicy } from '../memory/compaction-policy.js';
import type { ModelManager } from '../models/index.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import { runBtwQuery } from '../service/btw-query.js';
import { formatSessionContextReport } from '../service/session-context-report.js';
import type { ReasoningLevel, VerboseLevel } from '../transcript/thinking-types.js';
import { createLogger } from '../../utils/logger.js';
import {
  compactExternalSession,
  getExternalAgentDriver,
  getExternalConversationAgent,
  resolveExternalContextWindow,
  resolveValidExternalSessionModel,
} from '../external/index.js';
import { getSessionInteractionPolicy } from './interaction-policy.js';
import type { SessionHydrator } from './session-hydrator.js';
import { resolveModel } from '../../providers/index.js';

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
  getContextWindow: (conversationId: string) => number;
}

export interface SessionContextUsage {
  estimatedTokens: number;
  contextWindow: number;
  usagePercent: number | null;
}

export interface SessionAgentConfigView {
  thinkingLevel: ThinkingLevel;
  model: string;
  serviceTier?: string;
  configVersion: number;
  fixedModel: boolean;
  activityDetail: {
    default: ReasoningLevel;
    override: ReasoningLevel | null;
    effective: ReasoningLevel;
    source: 'session' | 'default';
  };
  verboseLevel: VerboseLevel;
  effectiveWorkspacePath: string;
  workingDirectoryLocked: boolean;
  workspaceSource: 'execution_environment' | 'project' | 'session_override' | 'agent_default_root' | 'agent_workspace';
  userContextMode: 'enabled' | 'off' | 'temporary';
  interactionMode: 'default' | 'plan';
}

export class SessionInspector {
  private readonly opts: SessionInspectorOptions;

  constructor(opts: SessionInspectorOptions) {
    this.opts = opts;
  }

  private async ensureEffectiveSessionModel(conversationId: string): Promise<void> {
    await this.opts.sessionHydrator.model(conversationId);
    const cfg = this.opts.getConfig();
    if (!cfg) return;

    const profile = resolveEffectiveAgentProfileForSession(conversationId);
    const profileModelRef = profile.primaryModelRef?.trim();
    if (profileModelRef) {
      this.opts.modelManager.setSessionProfileDefault(conversationId, profileModelRef, profile.fallbacks);
    }
  }

  private async contextWindowForSession(conversationId: string): Promise<number> {
    const externalAgent = getExternalConversationAgent(conversationId);
    if (externalAgent) {
      const sc = await this.opts.sessionConfigStore.get(conversationId);
      return resolveExternalContextWindow(externalAgent.execution, sc.modelOverride ?? externalAgent.execution.model);
    }
    await this.ensureEffectiveSessionModel(conversationId);
    return this.opts.getContextWindow(conversationId);
  }

  /**
   * Manual compaction triggered by a user / API. Always forces a compaction
   * pass (`force: true` by default) and evicts the in-memory agent so the
   * next turn reloads from the compacted transcript.
   */
  async compact(
    conversationId: string,
    options?: { instructions?: string; force?: boolean },
  ): Promise<CompactionResult> {
    if (getExternalConversationAgent(conversationId)) {
      const result = await compactExternalSession(conversationId);
      log.info({ conversationId, result }, 'External runtime compaction complete');
      return result;
    }
    const messages = await this.opts.sessionStore.load(conversationId);
    await this.ensureEffectiveSessionModel(conversationId);
    const policy = resolveCompactionPolicy(this.opts.getConfig());
    const sessionModel = this.opts.modelManager.getResolvedModelForSession(conversationId);
    const model = policy.model ? resolveModel(policy.model) : sessionModel;
    const primaryRef = `${model.provider}/${model.id}`;
    const fallbackModels = this.opts.modelManager
      .getFallbackCandidatesForSession(conversationId)
      .map((candidate) => resolveModel(`${candidate.provider}/${candidate.model}`))
      .filter((candidate) => `${candidate.provider}/${candidate.id}` !== primaryRef);
    const result = await this.opts.sessionStore.compact(
      conversationId,
      messages,
      model,
      options?.instructions,
      options?.force ?? true,
      { fallbackModels },
    );
    if (result.compacted) {
      this.opts.agentManager.removeAgent(conversationId);
    }
    log.info({ conversationId, result }, 'Manual compaction complete');
    return result;
  }

  /** One-shot LLM answer for `/btw`: transcript as background, not persisted. */
  btwQuery(
    conversationId: string,
    question: string,
    options?: BtwQueryOptions,
  ): Promise<{ text: string; error?: string }> {
    const config = this.opts.getConfig();
    const profile = config ? options?.agentId ? resolveEffectiveAgentProfile(options.agentId) : resolveEffectiveAgentProfileForSession(conversationId) : undefined;
    return runBtwQuery({
      conversationId,
      question,
      sessionStore: this.opts.sessionStore,
      modelForSession: options?.modelRef?.trim() || this.opts.modelManager.getModelForSession(conversationId),
      log,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      includeSessionContext: options?.includeSessionContext,
      onTextDelta: options?.onTextDelta,
      signal: options?.signal,
      credentialOptions: profile && config
        ? { agentId: profile.agentId, appConfig: config }
        : undefined,
    });
  }

  /** Cheap stats used by both the report and other callers. */
  stats(conversationId: string, messages: AgentMessage[]): {
    windowStats: ReturnType<SessionStore['getWindowStats']>;
    compactionStats: ReturnType<SessionStore['getCompactionStats']>;
    tokenEstimate: ReturnType<SessionStore['estimateTokenUsage']>;
  } {
    return {
      windowStats: this.opts.sessionStore.getWindowStats(messages),
      compactionStats: this.opts.sessionStore.getCompactionStats(conversationId),
      tokenEstimate: this.opts.sessionStore.estimateTokenUsage(conversationId, messages),
    };
  }

  /** Rough context usage for TUI/Web footer (prefers provider-reported input tokens when available). */
  async contextUsage(conversationId: string): Promise<SessionContextUsage> {
    const messages = await this.opts.sessionStore.load(conversationId);
    const contextWindow = await this.contextWindowForSession(conversationId);
    let reportedTokens = 0;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i] as { role?: string; usage?: { input?: number; cacheRead?: number; totalTokens?: number } } | undefined;
      if (msg?.role === 'assistant' && msg.usage) {
        const input = typeof msg.usage.input === 'number' && Number.isFinite(msg.usage.input) ? msg.usage.input : 0;
        const cacheRead = typeof msg.usage.cacheRead === 'number' && Number.isFinite(msg.usage.cacheRead) ? msg.usage.cacheRead : 0;
        const combined = input + cacheRead;
        if (combined > 0) {
          reportedTokens = combined;
          break;
        }
      }
    }
    const estimatedTokens = reportedTokens > 0
      ? reportedTokens
      : await this.opts.sessionStore.estimateTokenUsage(conversationId, messages);
    const usagePercent =
      contextWindow > 0 ? Math.min(100, Math.round((estimatedTokens / contextWindow) * 100)) : null;
    return { estimatedTokens, contextWindow, usagePercent };
  }

  /** Markdown or JSON summary for `/context`. */
  async report(conversationId: string, mode: 'list' | 'detail' | 'json'): Promise<string> {
    const cfg = this.opts.getConfig();
    if (!cfg) {
      throw new Error('SessionInspector requires a config snapshot to render report');
    }
    const messages = await this.opts.sessionStore.load(conversationId);
    const cw = await this.contextWindowForSession(conversationId);
    const computed = this.stats(conversationId, messages);
    const model = this.opts.modelManager.getModelForSession(conversationId);
    const sc = await this.opts.sessionConfigStore.get(conversationId);
    const project = getProjectForSession(conversationId);
    const workspace = effectiveWorkspacePathForSession(cfg, conversationId, sc, project);
    const estTokens = await this.opts.sessionStore.estimateTokenUsage(conversationId, messages);
    const profile = resolveEffectiveAgentProfileForSession(conversationId);
    const deniedTools = [...profile.tools.denied].sort((a, b) => a.localeCompare(b));
    const toolsSummary = deniedTools.length > 0 ? `denied: ${deniedTools.join(', ')}` : '(no denied tools)';

    return formatSessionContextReport({
      conversationId,
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
  async agentConfig(conversationId: string): Promise<SessionAgentConfigView> {
    await this.ensureEffectiveSessionModel(conversationId);
    const cfg = this.opts.getConfig();
    if (!cfg) {
      throw new Error('SessionInspector requires a config snapshot to resolve agent config');
    }
    const sc = await this.opts.sessionConfigStore.get(conversationId);

    const defThink = 'medium';
    const level = await resolveEffectiveThinkingLevel(this.opts.sessionConfigStore, conversationId, null, defThink);
    const defReason = resolveConfiguredActivityDetailDefault(cfg);
    const reasoningLevel = await resolveEffectiveReasoningLevel(this.opts.sessionConfigStore, conversationId, defReason);
    const defVerbose = 'full' as VerboseLevel;
    const verboseLevel = await resolveVerboseLevel(this.opts.sessionConfigStore, conversationId, defVerbose);
    const externalAgent = getExternalConversationAgent(conversationId);
    const externalDriver = externalAgent ? getExternalAgentDriver(externalAgent.execution.kind) : undefined;
    const model = externalAgent && externalDriver
      ? resolveValidExternalSessionModel(externalAgent.execution, sc?.modelOverride)
      : (sc?.modelOverride ?? this.opts.modelManager.getModelForSession(conversationId));
    const project = getProjectForSession(conversationId);
    const environment = getExecutionEnvironmentForSession(conversationId);
    const projectWorkspace = projectWorkspacePath(project);
    const hasSessionWorkspaceOverride = Boolean(sc?.workingDirectoryOverride?.trim());
    const effectiveWorkspacePath = effectiveWorkspacePathForSession(cfg, conversationId, sc, project);
    const isDefaultWorkspaceRoot = effectiveWorkspacePath === resolveDefaultAgentWorkspaceDir();
    const defaultExternalServiceTier =
      externalAgent?.execution.kind === 'codex' ? externalAgent.execution.serviceTier?.trim() : undefined;
    const serviceTier = sc?.serviceTierOverride?.trim() || defaultExternalServiceTier || undefined;
    return {
      thinkingLevel: level,
      model,
      ...(serviceTier ? { serviceTier } : {}),
      configVersion: sc?.updatedAt ?? 0,
      fixedModel: externalAgent ? true : sc?.fixedModel === true,
      activityDetail: {
        default: defReason,
        override: sc?.reasoningLevel ?? null,
        effective: reasoningLevel,
        source: sc?.reasoningLevel ? 'session' : 'default',
      },
      verboseLevel,
      effectiveWorkspacePath,
      workingDirectoryLocked: Boolean(environment || projectWorkspace || hasSessionWorkspaceOverride),
      userContextMode: sc?.userContextMode ?? 'enabled',
      interactionMode: getSessionInteractionPolicy(conversationId).mode,
      workspaceSource: environment
        ? 'execution_environment'
        : projectWorkspace
          ? 'project'
        : hasSessionWorkspaceOverride
          ? 'session_override'
          : isDefaultWorkspaceRoot
            ? 'agent_default_root'
            : 'agent_workspace',
    };
  }
}

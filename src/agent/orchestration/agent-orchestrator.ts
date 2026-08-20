/**
 * Agent Orchestrator - Coordinates Agent execution flow
 *
 * Manages the complete agent execution pipeline from message processing
 * to response generation.
 */

import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import type { InboundMessage } from '../../infra/bus/index.js';
import type { SessionConfigStore, SessionStore } from '../../session/index.js';
import type { SessionHydrator } from '../session/index.js';
import { resolveEffectiveThinkingLevel } from '../../session/thinking-resolve.js';
import type { ThinkLevel } from '../transcript/thinking-types.js';
import type { ModelManager } from '../models/index.js';
import type { SessionContext } from '../session/session-context.js';
import type { AgentEventHandler } from './agent-event-handler.js';
import type { FeedbackCoordinator } from '../feedback/feedback-coordinator.js';
import type { AgentManager } from '../agent-manager.js';
import { createLogger } from '../../utils/logger.js';
import { extractAgentUserPlainText } from '../memory/user-message-text.js';
import { abortEmbeddedRun } from '../embedded/runs.js';
import { runEmbeddedTurnForSession } from '../embedded/run-for-session.js';
import type { EmbeddedStreamEvent } from '../embedded/types.js';
import { persistInboundAttachments } from '../../channels/attachments/inbound-persist.js';
import {
  buildTranscriptUserMessage,
  clearPendingTranscriptUserMessage,
  hydrateUserTurnForLlm,
  setPendingTranscriptUserMessage,
} from '../inbound/attachment-pipeline.js';
import {
  DREAMING_SWEEP_TOKEN,
  DREAMING_LIGHT_SWEEP_TOKEN,
  DREAMING_REM_SWEEP_TOKEN,
} from '../memory/dreaming/constants.js';
import { runDreamingDeepPromotion } from '../memory/dreaming/deep-promotion.js';
import { appendDreamingEvent, type DreamingEvent } from '../memory/dreaming/events.js';
import { runLightSweep } from '../memory/dreaming/light-sweep.js';
import { runRemPatterns } from '../memory/dreaming/rem-patterns.js';
import { resolveDreamingAgentScope } from '../memory/dreaming/scope.js';

const log = createLogger('AgentOrchestrator');

export interface AgentOrchestratorConfig {
  agentManager: AgentManager;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  eventHandler: AgentEventHandler;
  feedbackCoordinator: FeedbackCoordinator;
  sessionConfigStore: SessionConfigStore;
  /** Per-session hydration (workspace override + model override) before the agent runs. */
  sessionHydrator: SessionHydrator;
  getThinkingDefault: () => ThinkLevel | undefined;
  /** Per-session default from merged `agents.list` / defaults (optional). */
  getThinkingDefaultForSession?: (sessionKey: string) => ThinkLevel | undefined;
  /** Default workspace root when no per-session resolver is set. */
  workspaceRoot: string;
  /** Per-agent workspace root for attachments (optional; defaults to `workspaceRoot`). */
  getWorkspaceRootForSession?: (sessionKey: string) => string;
  /** Agent home (`…/agents/<id>/`) for inbound/TTS files — keeps internal state out of the markdown workspace. */
  getAgentInternalStorageRootForSession?: (sessionKey: string) => string;
  /** Fire-and-forget after full session persist (e.g. LLM session title); not called from mid-turn snapshots. */
  enqueueAutoTitle?: (sessionKey: string) => void;
  /** For per-turn timeout. */
  getConfig?: () => Config | undefined;
  /** Channel streaming: token/tool events from pi embedded session. */
  onEmbeddedStreamEvent?: (sessionKey: string, event: EmbeddedStreamEvent) => void;
  /** Called after a successful embedded turn with assistant plain text. */
  onEmbeddedTurnComplete?: (sessionKey: string, lastAssistantText?: string) => void;
}

export class AgentOrchestrator {
  private agentManager: AgentManager;
  private sessionStore: SessionStore;
  private modelManager: ModelManager;
  private feedbackCoordinator: FeedbackCoordinator;
  private sessionConfigStore: SessionConfigStore;
  private sessionHydrator: SessionHydrator;
  private getThinkingDefault: () => ThinkLevel | undefined;
  private getThinkingDefaultForSession?: (sessionKey: string) => ThinkLevel | undefined;
  private enqueueAutoTitle?: (sessionKey: string) => void;
  private getConfig?: () => Config | undefined;
  private onEmbeddedStreamEvent?: (sessionKey: string, event: EmbeddedStreamEvent) => void;
  private onEmbeddedTurnComplete?: (sessionKey: string, lastAssistantText?: string) => void;

  constructor(config: AgentOrchestratorConfig) {
    this.agentManager = config.agentManager;
    this.sessionStore = config.sessionStore;
    this.modelManager = config.modelManager;
    this.feedbackCoordinator = config.feedbackCoordinator;
    this.sessionConfigStore = config.sessionConfigStore;
    this.sessionHydrator = config.sessionHydrator;
    this.getThinkingDefault = config.getThinkingDefault;
    this.getThinkingDefaultForSession = config.getThinkingDefaultForSession;
    this.enqueueAutoTitle = config.enqueueAutoTitle;
    this.getConfig = config.getConfig;
    this.onEmbeddedStreamEvent = config.onEmbeddedStreamEvent;
    this.onEmbeddedTurnComplete = config.onEmbeddedTurnComplete;
  }

  /**
   * Process a message through the agent orchestration pipeline
   */
  async process(msg: InboundMessage, context: SessionContext): Promise<void> {
    const { sessionKey } = context;

    log.debug({ sessionKey }, 'Processing message through agent orchestrator');

    await this.sessionHydrator.workspace(sessionKey);

    // Dreaming: short-circuit scheduled maintenance tokens into local runs.
    // This avoids spending LLM tokens for scheduled memory consolidation.
    if (
      typeof msg.content === 'string' &&
      (
        sessionKey.startsWith('cron:') ||
        sessionKey.includes(':cron:') ||
        sessionKey.includes(':automation:') ||
        context.channel === 'cron' ||
        context.channel === 'automation'
      )
    ) {
      const content = msg.content;
      const isDreamingSweep =
        content.includes(DREAMING_SWEEP_TOKEN) ||
        content.includes(DREAMING_LIGHT_SWEEP_TOKEN) ||
        content.includes(DREAMING_REM_SWEEP_TOKEN);

      if (isDreamingSweep) {
        const cfg = this.getConfig?.();
        if (!cfg) {
          log.warn({ sessionKey }, 'Dreaming sweep skipped: config unavailable');
          return;
        }
        const profile = resolveEffectiveAgentProfileForSession(cfg, sessionKey);
        const scope = resolveDreamingAgentScope(cfg, profile.agentId);
        const resolved = scope.config;
        const t0 = Date.now();

        if (content.includes(DREAMING_LIGHT_SWEEP_TOKEN)) {
          const result = await runLightSweep({
            workspaceDir: scope.workspaceDir,
            config: resolved.phases.light,
          });
          const event: DreamingEvent = {
            timestamp: new Date().toISOString(), phase: 'light',
            ok: result.ok, reason: result.reason, durationMs: Date.now() - t0,
            scannedEntries: result.scannedEntries, newSignals: result.newSignals, deduped: result.deduped,
          };
          await appendDreamingEvent(scope.dreamingRoot, event);
        } else if (content.includes(DREAMING_REM_SWEEP_TOKEN)) {
          const result = await runRemPatterns({
            agentId: scope.agentId,
            workspaceDir: scope.workspaceDir,
            config: resolved.phases.rem,
            sensitiveWritePolicy: cfg.userContext.privacy.sensitiveWritePolicy,
            promotionWritePolicy: resolved.promotionWritePolicy.decision,
          });
          const event: DreamingEvent = {
            timestamp: new Date().toISOString(), phase: 'rem',
            ok: result.ok, reason: result.reason, durationMs: Date.now() - t0,
            patternsDiscovered: result.patternsDiscovered, entriesAnalyzed: result.entriesAnalyzed,
          };
          await appendDreamingEvent(scope.dreamingRoot, event);
        } else {
          const result = await runDreamingDeepPromotion({
            agentId: scope.agentId,
            workspaceDir: scope.workspaceDir,
            config: resolved.phases.deep,
            sensitiveWritePolicy: cfg.userContext.privacy.sensitiveWritePolicy,
            promotionWritePolicy: resolved.promotionWritePolicy.decision,
          });
          const event: DreamingEvent = {
            timestamp: new Date().toISOString(), phase: 'deep',
            ok: result.ok, reason: result.reason, durationMs: Date.now() - t0,
            candidates: result.candidates, applied: result.applied,
          };
          await appendDreamingEvent(scope.dreamingRoot, event);
        }
        return;
      }
    }

    try {
      await this.sessionHydrator.model(sessionKey);

      const channelSystemPrompt =
        typeof context.metadata?.channelSystemPrompt === 'string'
          ? context.metadata.channelSystemPrompt.trim()
          : '';
      if (channelSystemPrompt) {
        this.agentManager.getOrCreateAgent(sessionKey);
        this.agentManager.applyTurnChannelSystemPrompt(sessionKey, channelSystemPrompt);
      }

      const thinkingDefault =
        this.getThinkingDefaultForSession?.(sessionKey) ?? this.getThinkingDefault();
      const thinkingLevel = await resolveEffectiveThinkingLevel(
        this.sessionConfigStore,
        sessionKey,
        null,
        thinkingDefault,
      );
      this.agentManager.setThinkingLevel(sessionKey, thinkingLevel);

      const persistedAttachments = await persistInboundAttachments(msg.attachments);
      const modelRef = this.modelManager.getModelForSession(sessionKey);
      const userMessage = await buildTranscriptUserMessage({
        text: msg.content,
        prepared: persistedAttachments,
        sessionKey,
        modelRef,
        config: this.getConfig?.(),
        agentManager: this.agentManager,
      });
      setPendingTranscriptUserMessage(sessionKey, userMessage);

      const userPlainForMemory = extractAgentUserPlainText(userMessage);
      const userContext = await this.agentManager.prepareUserTurnContext(
        userMessage,
        sessionKey,
      );
      const userMessageForModel = userContext.modelMessage;

      const llmTurn = await hydrateUserTurnForLlm({
        message: userMessage,
        modelRef,
      });

      this.feedbackCoordinator.startTask();

      const turnResult = await (async () => {
        try {
          return await runEmbeddedTurnForSession({
            sessionKey,
            userMessage: userMessageForModel,
            llmImages: llmTurn.images,
            sessionStore: this.sessionStore,
            agentManager: this.agentManager,
            modelManager: this.modelManager,
            thinkingOverride: thinkingLevel,
            getConfig: this.getConfig,
            beforeTurn: () => this.agentManager.beginBackgroundReviewUserTurn(sessionKey),
            onEvent: (event) => this.onEmbeddedStreamEvent?.(sessionKey, event),
          });
        } finally {
          clearPendingTranscriptUserMessage(sessionKey, userMessage);
        }
      })();

      await this.agentManager.afterAgentTurn(sessionKey, userPlainForMemory);
      this.agentManager.scheduleBackgroundReviewAfterUserTurn(sessionKey);

      if (turnResult.ok) {
        this.onEmbeddedTurnComplete?.(sessionKey, turnResult.lastAssistantText);
        this.enqueueAutoTitle?.(sessionKey);
      } else if (turnResult.errorMessage) {
        log.warn({ sessionKey, errorMessage: turnResult.errorMessage }, 'Embedded inbound turn failed');
      }

      this.feedbackCoordinator.endTask();

    } catch (error) {
      log.error({ err: error, sessionKey }, 'Error in agent orchestration');
      this.feedbackCoordinator.endTask();
      throw error;
    }
  }

  /**
   * Get the current agent model ID
   */
  getCurrentModel(): string {
    return this.modelManager.getCurrentModel();
  }

  /**
   * Check if agent is currently processing for a session
   */
  isProcessing(sessionKey: string): boolean {
    const agent = this.agentManager.getAgent(sessionKey);
    if (!agent) {
      return false;
    }
    return agent.state.messages.length > 0;
  }

  /**
   * Abort current agent execution for a session
   */
  abort(sessionKey: string): void {
    void abortEmbeddedRun(sessionKey);
    const agent = this.agentManager.getAgent(sessionKey);
    agent?.abort();
  }
}

/**
 * Agent Orchestrator - Coordinates Agent execution flow
 *
 * Manages the complete agent execution pipeline from message processing
 * to response generation.
 */

import { randomUUID } from 'node:crypto';

import type { Config } from '../../config/schema.js';
import type { InboundMessage } from '../../infra/bus/index.js';
import type { SessionConfigStore, SessionStore } from '../../session/index.js';
import type { SessionHydrator } from '../session/index.js';
import { resolveEffectiveThinkingLevel } from '../../session/thinking-resolve.js';
import type { ThinkLevel } from '../transcript/thinking-types.js';
import type { ModelManager } from '../models/index.js';
import type { SessionContext } from '../session/session-context.js';
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
  runContextConsolidation,
  USER_CONTEXT_CONSOLIDATION_TOKEN,
} from '../../user-context/consolidation.js';

const log = createLogger('AgentOrchestrator');

export interface AgentOrchestratorConfig {
  agentManager: AgentManager;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  sessionConfigStore: SessionConfigStore;
  /** Per-session hydration (workspace override + model override) before the agent runs. */
  sessionHydrator: SessionHydrator;
  getThinkingDefault: () => ThinkLevel | undefined;
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
  private sessionConfigStore: SessionConfigStore;
  private sessionHydrator: SessionHydrator;
  private getThinkingDefault: () => ThinkLevel | undefined;
  private enqueueAutoTitle?: (sessionKey: string) => void;
  private getConfig?: () => Config | undefined;
  private onEmbeddedStreamEvent?: (sessionKey: string, event: EmbeddedStreamEvent) => void;
  private onEmbeddedTurnComplete?: (sessionKey: string, lastAssistantText?: string) => void;

  constructor(config: AgentOrchestratorConfig) {
    this.agentManager = config.agentManager;
    this.sessionStore = config.sessionStore;
    this.modelManager = config.modelManager;
    this.sessionConfigStore = config.sessionConfigStore;
    this.sessionHydrator = config.sessionHydrator;
    this.getThinkingDefault = config.getThinkingDefault;
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

    // Run deterministic user-context maintenance without spending LLM tokens.
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
      if (msg.content.includes(USER_CONTEXT_CONSOLIDATION_TOKEN)) {
        const cfg = this.getConfig?.();
        if (!cfg) {
          log.warn({ sessionKey }, 'User context review skipped: config unavailable');
          return;
        }
        await runContextConsolidation({ config: cfg, triggerKind: 'schedule' });
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

      const thinkingDefault = this.getThinkingDefault();
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
      const turnId = randomUUID();
      const userContext = await this.agentManager.prepareUserTurnContext(
        userMessage,
        sessionKey,
        turnId,
      );
      const userMessageForModel = userContext.modelMessage;

      const llmTurn = await hydrateUserTurnForLlm({
        message: userMessage,
        modelRef,
      });

      const turnResult = await (async () => {
        try {
          return await runEmbeddedTurnForSession({
            sessionKey,
            runId: turnId,
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

      const understandingReview = await this.agentManager.afterAgentTurn(sessionKey, userPlainForMemory, turnId);
      if (understandingReview?.createdRecords.length) {
        const captured = understandingReview.createdRecords.filter((record) => record.status === 'active');
        const candidates = understandingReview.createdRecords.filter((record) => record.status === 'candidate');
        if (captured.length) this.onEmbeddedStreamEvent?.(sessionKey, { type: 'memory_captured', runId: turnId, records: captured });
        if (candidates.length) this.onEmbeddedStreamEvent?.(sessionKey, { type: 'memory_candidate', runId: turnId, records: candidates });
      }
      this.agentManager.scheduleBackgroundReviewAfterUserTurn(sessionKey);

      if (turnResult.ok) {
        this.onEmbeddedTurnComplete?.(sessionKey, turnResult.lastAssistantText);
        this.enqueueAutoTitle?.(sessionKey);
      } else if (turnResult.errorMessage) {
        log.warn({ sessionKey, errorMessage: turnResult.errorMessage }, 'Embedded inbound turn failed');
      }

    } catch (error) {
      log.error({ err: error, sessionKey }, 'Error in agent orchestration');
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

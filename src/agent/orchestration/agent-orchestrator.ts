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
import { parseMaintenanceInstruction, runMemoryMaintenance } from '../../memory-maintenance/index.js';

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
  getWorkspaceRootForSession?: (conversationId: string) => string;
  /** Agent home (`…/agents/<id>/`) for inbound/TTS files — keeps internal state out of the markdown workspace. */
  getAgentInternalStorageRootForSession?: (conversationId: string) => string;
  /** Fire-and-forget after full session persist (e.g. LLM session title); not called from mid-turn snapshots. */
  enqueueAutoTitle?: (conversationId: string) => void;
  /** For per-turn timeout. */
  getConfig?: () => Config | undefined;
  /** Channel streaming: token/tool events from pi embedded session. */
  onEmbeddedStreamEvent?: (conversationId: string, event: EmbeddedStreamEvent) => void;
  /** Called after a successful embedded turn with assistant plain text. */
  onEmbeddedTurnComplete?: (conversationId: string, lastAssistantText?: string) => void;
}

export class AgentOrchestrator {
  private agentManager: AgentManager;
  private sessionStore: SessionStore;
  private modelManager: ModelManager;
  private sessionConfigStore: SessionConfigStore;
  private sessionHydrator: SessionHydrator;
  private getThinkingDefault: () => ThinkLevel | undefined;
  private enqueueAutoTitle?: (conversationId: string) => void;
  private getConfig?: () => Config | undefined;
  private onEmbeddedStreamEvent?: (conversationId: string, event: EmbeddedStreamEvent) => void;
  private onEmbeddedTurnComplete?: (conversationId: string, lastAssistantText?: string) => void;

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
    const { conversationId } = context;

    log.debug({ conversationId }, 'Processing message through agent orchestrator');

    await this.sessionHydrator.workspace(conversationId);

    // Run deterministic user-context maintenance without spending LLM tokens.
    if (
      typeof msg.content === 'string' &&
      (
        context.channel === 'cron' ||
        context.channel === 'automation'
      )
    ) {
      const maintenanceJob = parseMaintenanceInstruction(msg.content);
      if (maintenanceJob) {
        const cfg = this.getConfig?.();
        if (!cfg) {
          log.warn({ conversationId }, 'Memory maintenance skipped: config unavailable');
          return;
        }
        const maintenance = cfg.userContext.userModel.maintenance;
        runMemoryMaintenance({
          jobType: maintenanceJob,
          limit: maintenance.limit,
          staleRetentionDays: maintenance.staleRetentionDays,
          evidenceThreshold: maintenance.evidenceThreshold,
        });
        return;
      }
    }

    try {
      await this.sessionHydrator.model(conversationId);

      const channelSystemPrompt =
        typeof context.metadata?.channelSystemPrompt === 'string'
          ? context.metadata.channelSystemPrompt.trim()
          : '';
      if (channelSystemPrompt) {
        this.agentManager.getOrCreateAgent(conversationId);
        this.agentManager.applyTurnChannelSystemPrompt(conversationId, channelSystemPrompt);
      }

      const thinkingDefault = this.getThinkingDefault();
      const thinkingLevel = await resolveEffectiveThinkingLevel(
        this.sessionConfigStore,
        conversationId,
        null,
        thinkingDefault,
      );
      this.agentManager.setThinkingLevel(conversationId, thinkingLevel);

      const persistedAttachments = await persistInboundAttachments(msg.attachments);
      const modelRef = this.modelManager.getModelForSession(conversationId);
      const userMessage = await buildTranscriptUserMessage({
        text: msg.content,
        prepared: persistedAttachments,
        conversationId,
        modelRef,
        config: this.getConfig?.(),
        agentManager: this.agentManager,
      });
      setPendingTranscriptUserMessage(conversationId, userMessage);

      const userPlainForMemory = extractAgentUserPlainText(userMessage);
      const turnId = randomUUID();
      const userContext = await this.agentManager.prepareUserTurnContext(
        userMessage,
        conversationId,
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
            conversationId,
            runId: turnId,
            userMessage: userMessageForModel,
            llmImages: llmTurn.images,
            sessionStore: this.sessionStore,
            agentManager: this.agentManager,
            modelManager: this.modelManager,
            thinkingOverride: thinkingLevel,
            getConfig: this.getConfig,
            beforeTurn: () => this.agentManager.beginBackgroundReviewUserTurn(conversationId),
            onEvent: (event) => this.onEmbeddedStreamEvent?.(conversationId, event),
          });
        } finally {
          clearPendingTranscriptUserMessage(conversationId, userMessage);
        }
      })();

      const understandingReview = await this.agentManager.afterAgentTurn(conversationId, userPlainForMemory, turnId);
      void understandingReview;
      this.agentManager.scheduleBackgroundReviewAfterUserTurn(conversationId);

      if (turnResult.ok) {
        this.onEmbeddedTurnComplete?.(conversationId, turnResult.lastAssistantText);
        this.enqueueAutoTitle?.(conversationId);
      } else if (turnResult.errorMessage) {
        log.warn({ conversationId, errorMessage: turnResult.errorMessage }, 'Embedded inbound turn failed');
      }

    } catch (error) {
      log.error({ err: error, conversationId }, 'Error in agent orchestration');
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
  isProcessing(conversationId: string): boolean {
    const agent = this.agentManager.getAgent(conversationId);
    if (!agent) {
      return false;
    }
    return agent.state.messages.length > 0;
  }

  /**
   * Abort current agent execution for a session
   */
  abort(conversationId: string): void {
    void abortEmbeddedRun(conversationId);
    const agent = this.agentManager.getAgent(conversationId);
    agent?.abort();
  }
}

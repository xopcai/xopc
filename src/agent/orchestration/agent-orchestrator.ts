/**
 * Agent Orchestrator - Coordinates Agent execution flow
 *
 * Manages the complete agent execution pipeline from message processing
 * to response generation.
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Config } from '../../config/schema.js';
import type { InboundMessage } from '../../infra/bus/index.js';
import type { SessionConfigStore, SessionStore } from '../../session/index.js';
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
import {
  persistInboundAttachmentsToWorkspace,
  formatInboundFileTextBlock,
} from '../../channels/attachments/inbound-persist.js';
import { expandAtFileMentionsInPlainText } from '../context/expand-at-file-mentions.js';
import { resolveInboundImageContentParts } from '../image/inbound-image-handling.js';
import {
  DREAMING_SWEEP_TOKEN,
  DREAMING_LIGHT_SWEEP_TOKEN,
  DREAMING_REM_SWEEP_TOKEN,
} from '../memory/dreaming/constants.js';
import { resolveDreamingConfig } from '../memory/dreaming/config.js';
import { runDreamingDeepPromotion } from '../memory/dreaming/deep-promotion.js';
import { appendDreamingEvent, type DreamingEvent } from '../memory/dreaming/events.js';
import { runLightSweep } from '../memory/dreaming/light-sweep.js';
import { runRemPatterns } from '../memory/dreaming/rem-patterns.js';

const log = createLogger('AgentOrchestrator');

export interface AgentOrchestratorConfig {
  agentManager: AgentManager;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  eventHandler: AgentEventHandler;
  feedbackCoordinator: FeedbackCoordinator;
  sessionConfigStore: SessionConfigStore;
  /** Load per-session workspace override and mkdir before creating the agent. */
  hydrateSessionWorkspaceFromStore?: (sessionKey: string) => Promise<void>;
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
  /** For per-turn timeout via `agents.defaults.maxTaskDurationMs`. */
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
  private eventHandler: AgentEventHandler;
  private feedbackCoordinator: FeedbackCoordinator;
  private sessionConfigStore: SessionConfigStore;
  private hydrateSessionWorkspaceFromStore?: (sessionKey: string) => Promise<void>;
  private getThinkingDefault: () => ThinkLevel | undefined;
  private getThinkingDefaultForSession?: (sessionKey: string) => ThinkLevel | undefined;
  private workspaceRoot: string;
  private getWorkspaceRootForSession?: (sessionKey: string) => string;
  private getAgentInternalStorageRootForSession: (sessionKey: string) => string;
  private enqueueAutoTitle?: (sessionKey: string) => void;
  private getConfig?: () => Config | undefined;
  private onEmbeddedStreamEvent?: (sessionKey: string, event: EmbeddedStreamEvent) => void;
  private onEmbeddedTurnComplete?: (sessionKey: string, lastAssistantText?: string) => void;

  constructor(config: AgentOrchestratorConfig) {
    this.agentManager = config.agentManager;
    this.sessionStore = config.sessionStore;
    this.modelManager = config.modelManager;
    this.eventHandler = config.eventHandler;
    this.feedbackCoordinator = config.feedbackCoordinator;
    this.sessionConfigStore = config.sessionConfigStore;
    this.hydrateSessionWorkspaceFromStore = config.hydrateSessionWorkspaceFromStore;
    this.getThinkingDefault = config.getThinkingDefault;
    this.getThinkingDefaultForSession = config.getThinkingDefaultForSession;
    this.workspaceRoot = config.workspaceRoot;
    this.getWorkspaceRootForSession = config.getWorkspaceRootForSession;
    this.getAgentInternalStorageRootForSession =
      config.getAgentInternalStorageRootForSession ??
      ((sk) => this.getWorkspaceRootForSession?.(sk) ?? this.workspaceRoot);
    this.enqueueAutoTitle = config.enqueueAutoTitle;
    this.getConfig = config.getConfig;
    this.onEmbeddedStreamEvent = config.onEmbeddedStreamEvent;
    this.onEmbeddedTurnComplete = config.onEmbeddedTurnComplete;
  }

  private async hydrateSessionModelFromStore(sessionKey: string): Promise<void> {
    const cfg = await this.sessionConfigStore.get(sessionKey);
    if (cfg?.modelOverride) {
      await this.modelManager.switchModelForSession(sessionKey, cfg.modelOverride);
    }
  }

  /**
   * Process a message through the agent orchestration pipeline
   */
  async process(msg: InboundMessage, context: SessionContext): Promise<void> {
    const { sessionKey } = context;

    log.debug({ sessionKey }, 'Processing message through agent orchestrator');

    await this.hydrateSessionWorkspaceFromStore?.(sessionKey);

    // Dreaming: short-circuit cron-triggered sweep tokens into maintenance runs.
    // This avoids spending LLM tokens for scheduled memory consolidation.
    if (
      typeof msg.content === 'string' &&
      (sessionKey.startsWith('cron:') || context.channel === 'cron')
    ) {
      const content = msg.content;
      const isDreamingSweep =
        content.includes(DREAMING_SWEEP_TOKEN) ||
        content.includes(DREAMING_LIGHT_SWEEP_TOKEN) ||
        content.includes(DREAMING_REM_SWEEP_TOKEN);

      if (isDreamingSweep) {
        const workspaceDir = this.agentManager.getResolvedWorkspaceForSession(sessionKey);
        const resolved = resolveDreamingConfig(this.getConfig?.());
        const t0 = Date.now();

        if (content.includes(DREAMING_LIGHT_SWEEP_TOKEN)) {
          const result = await runLightSweep({ workspaceDir, config: resolved.phases.light });
          const event: DreamingEvent = {
            timestamp: new Date().toISOString(), phase: 'light',
            ok: result.ok, reason: result.reason, durationMs: Date.now() - t0,
            scannedEntries: result.scannedEntries, newSignals: result.newSignals, deduped: result.deduped,
          };
          await appendDreamingEvent(workspaceDir, event);
        } else if (content.includes(DREAMING_REM_SWEEP_TOKEN)) {
          const result = await runRemPatterns({ workspaceDir, config: resolved.phases.rem });
          const event: DreamingEvent = {
            timestamp: new Date().toISOString(), phase: 'rem',
            ok: result.ok, reason: result.reason, durationMs: Date.now() - t0,
            patternsDiscovered: result.patternsDiscovered, entriesAnalyzed: result.entriesAnalyzed,
          };
          await appendDreamingEvent(workspaceDir, event);
        } else {
          const result = await runDreamingDeepPromotion({ workspaceDir, config: resolved.phases.deep });
          const event: DreamingEvent = {
            timestamp: new Date().toISOString(), phase: 'deep',
            ok: result.ok, reason: result.reason, durationMs: Date.now() - t0,
            candidates: result.candidates, applied: result.applied,
          };
          await appendDreamingEvent(workspaceDir, event);
        }
        return;
      }
    }

    try {
      await this.hydrateSessionModelFromStore(sessionKey);

      const thinkingDefault =
        this.getThinkingDefaultForSession?.(sessionKey) ?? this.getThinkingDefault();
      const thinkingLevel = await resolveEffectiveThinkingLevel(
        this.sessionConfigStore,
        sessionKey,
        null,
        thinkingDefault,
      );
      this.agentManager.setThinkingLevel(sessionKey, thinkingLevel);

      // Persist inbound files (Telegram, etc.) under agent home, then build user message
      const storageRoot = this.getAgentInternalStorageRootForSession(sessionKey);
      const persistedAttachments = await persistInboundAttachmentsToWorkspace(
        storageRoot,
        sessionKey,
        msg.attachments,
      );
      const userMessage = await this.buildUserMessage(
        {
          ...msg,
          attachments: persistedAttachments ?? msg.attachments,
        },
        sessionKey,
      );
      const userPlainForMemory = extractAgentUserPlainText(userMessage);
      const userMessageForModel = await this.agentManager.applyMemoryPrefetchToUserMessage(
        userMessage,
        sessionKey,
      );

      this.feedbackCoordinator.startTask();

      const turnResult = await runEmbeddedTurnForSession({
        sessionKey,
        userMessage: userMessageForModel,
        sessionStore: this.sessionStore,
        agentManager: this.agentManager,
        modelManager: this.modelManager,
        thinkingOverride: thinkingLevel,
        getConfig: this.getConfig,
        beforeTurn: () => this.agentManager.beginBackgroundReviewUserTurn(sessionKey),
        onEvent: (event) => this.onEmbeddedStreamEvent?.(sessionKey, event),
      });

      this.agentManager.afterAgentTurn(sessionKey, userPlainForMemory);
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
   * Build an agent message from an inbound message
   */
  private async buildUserMessage(msg: InboundMessage, sessionKey: string): Promise<AgentMessage> {
    const storageRootAbs = this.getAgentInternalStorageRootForSession(sessionKey);
    let textBody = msg.content.trimStart().startsWith('/skill:')
      ? this.agentManager.expandSkillUserText(msg.content)
      : msg.content;

    if (/@file:/.test(textBody)) {
      const root = this.agentManager.getResolvedWorkspaceForSession(sessionKey);
      textBody = await expandAtFileMentionsInPlainText(textBody, root);
    }

    if (!msg.attachments || msg.attachments.length === 0) {
      return {
        role: 'user',
        content: textBody,
        timestamp: Date.now(),
      };
    }

    const modelRef = this.modelManager.getModelForSession(sessionKey);
    const cfg = this.getConfig?.();

    const messageContent: Array<
      { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    > = [];

    if (msg.content.trim()) {
      messageContent.push({ type: 'text', text: textBody });
    }

    const attachments = msg.attachments;
    let i = 0;
    while (i < attachments.length) {
      const att = attachments[i]!;
      const isImage =
        att.type === 'image' || att.type === 'photo' || Boolean(att.mimeType?.startsWith('image/'));

      if (isImage) {
        const group: Array<{ data: string; mimeType: string }> = [];
        while (i < attachments.length) {
          const a = attachments[i]!;
          const img =
            a.type === 'image' || a.type === 'photo' || Boolean(a.mimeType?.startsWith('image/'));
          if (!img) {
            break;
          }
          if (!a.data || a.data.length === 0) {
            log.warn({ type: a.type, name: a.name }, 'Empty image data, skipping');
            i += 1;
            continue;
          }
          group.push({ data: a.data, mimeType: a.mimeType || 'image/jpeg' });
          i += 1;
        }
        if (group.length > 0) {
          const parts = await resolveInboundImageContentParts({
            modelRef,
            cfg,
            userTextForContext: msg.content.trim() ? textBody : '',
            images: group,
          });
          messageContent.push(...parts);
        }
      } else {
        const fileBlock = formatInboundFileTextBlock(
          {
            type: att.type,
            mimeType: att.mimeType,
            name: att.name,
            size: att.size,
            workspaceRelativePath: att.workspaceRelativePath,
          },
          storageRootAbs,
        );
        messageContent.push({ type: 'text', text: fileBlock });
        i += 1;
      }
    }

    const hasText = messageContent.some((item) => item.type === 'text');
    const hasImage = messageContent.some((item) => item.type === 'image');
    if (hasImage && !hasText) {
      messageContent.unshift({ type: 'text', text: 'Please analyze the image(s) I sent.' });
    }

    if (messageContent.length === 0) {
      log.warn(
        { attachmentCount: msg.attachments.length },
        'All attachments were skipped, falling back to text message',
      );
      return {
        role: 'user',
        content: textBody || '[Image attachment could not be processed]',
        timestamp: Date.now(),
      };
    }

    return {
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
    };
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

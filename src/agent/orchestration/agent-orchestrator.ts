/**
 * Agent Orchestrator - Coordinates Agent execution flow
 *
 * Manages the complete agent execution pipeline from message processing
 * to response generation.
 */

import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';
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
import { sanitizeMessages, cleanTrailingErrors } from '../memory/message-sanitizer.js';
import {
  tryApplySessionTranscriptHygiene,
  tryApplySessionTranscriptHygieneForPersistence,
} from '../transcript/transcript-hygiene.js';
import { createLogger } from '../../utils/logger.js';
import { extractAgentUserPlainText } from '../memory/user-message-text.js';
import { runAgentTurnWithModelFallbacks } from './run-agent-turn-with-fallbacks.js';
import {
  persistInboundAttachmentsToWorkspace,
  formatInboundFileTextBlock,
} from '../../channels/attachments/inbound-persist.js';
import { expandAtFileMentionsInPlainText } from '../context/expand-at-file-mentions.js';
import { resolveInboundImageContentParts } from '../image/inbound-image-handling.js';

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

    // Get or create agent for this session
    const agent = this.agentManager.getOrCreateAgent(sessionKey);

    try {
      await this.hydrateSessionModelFromStore(sessionKey);

      // 1. Load session history
      let messages = await this.sessionStore.load(sessionKey);

      // Clean any trailing errors from previous sessions (defensive)
      messages = cleanTrailingErrors(messages);

      try {
        const model = this.modelManager.getResolvedModelForSession(sessionKey);
        messages = tryApplySessionTranscriptHygiene(messages, model);
      } catch (err) {
        log.warn({ err, sessionKey }, 'Transcript hygiene skipped (model resolve failed)');
      }

      agent.state.messages = messages;

      // 2. Apply model configuration for session
      await this.modelManager.applyModelForSession(agent, sessionKey);

      const thinkingDefault =
        this.getThinkingDefaultForSession?.(sessionKey) ?? this.getThinkingDefault();
      const thinkingLevel = await resolveEffectiveThinkingLevel(
        this.sessionConfigStore,
        sessionKey,
        null,
        thinkingDefault,
      );
      this.agentManager.setThinkingLevel(sessionKey, thinkingLevel);

      // 3. Persist inbound files (Telegram, etc.) under agent home, then build user message
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

      // 4. Start task feedback
      this.feedbackCoordinator.startTask();

      // 5. Execute agent
      await this.executeAgent(agent, userMessageForModel, context);

      this.agentManager.afterAgentTurn(sessionKey, userPlainForMemory);
      this.agentManager.scheduleBackgroundReviewAfterUserTurn(sessionKey);

      // 6. Sanitize messages before saving (remove error messages, empty content)
      const rawMessages = agent.state.messages;
      const { messages: sanitizedMessages, removed } = sanitizeMessages(rawMessages);

      if (removed > 0) {
        log.info({ sessionKey, removed }, 'Removed problematic messages before saving');
      }

      // 7. Save session messages (transcript hygiene)
      await this.saveSessionSnapshot(sessionKey, sanitizedMessages);

      this.enqueueAutoTitle?.(sessionKey);

      // 8. End task feedback
      this.feedbackCoordinator.endTask();

    } catch (error) {
      log.error({ err: error, sessionKey }, 'Error in agent orchestration');
      this.feedbackCoordinator.endTask();
      throw error;
    }
  }

  /**
   * Transcript hygiene + persist. Expects messages already passed through {@link sanitizeMessages}.
   * Keeps thinking blocks on disk for UI; agent load path applies full hygiene including dropThinking.
   */
  private async saveSessionSnapshot(sessionKey: string, messages: AgentMessage[]): Promise<void> {
    let toPersist = messages;
    try {
      const model = this.modelManager.getResolvedModelForSession(sessionKey);
      toPersist = tryApplySessionTranscriptHygieneForPersistence(messages, model);
    } catch (err) {
      log.warn({ err, sessionKey }, 'Transcript hygiene on save skipped');
    }
    await this.sessionStore.save(sessionKey, toPersist);
  }

  /**
   * Execute the agent with a user message (primary model, then `agents.defaults.model.fallbacks` on failure).
   */
  private async executeAgent(
    agent: Agent,
    userMessage: AgentMessage,
    context: SessionContext
  ): Promise<void> {
    const sessionKey = context.sessionKey;
    await runAgentTurnWithModelFallbacks({
      agent,
      sessionKey,
      modelManager: this.modelManager,
      userMessage,
      log,
      getConfig: this.getConfig,
      beforeUserPrompt: () => this.agentManager.beginBackgroundReviewUserTurn(sessionKey),
      afterUserPrompt: async () => {
        try {
          const { messages: sanitizedTurn } = sanitizeMessages(agent.state.messages);
          await this.saveSessionSnapshot(sessionKey, sanitizedTurn);
          log.debug({ sessionKey }, 'User message saved immediately after prompt');
        } catch (err) {
          log.warn({ err, sessionKey }, 'Failed to save user message immediately');
        }
      },
    });
  }

  /**
   * Build an agent message from an inbound message
   */
  private async buildUserMessage(msg: InboundMessage, sessionKey: string): Promise<AgentMessage> {
    const storageRootAbs = this.getAgentInternalStorageRootForSession(sessionKey);
    let textBody = msg.content.trimStart().startsWith('/skill:')
      ? this.agentManager.expandSkillUserText(msg.content)
      : msg.content;

    if (textBody.includes('@file:')) {
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
    const agent = this.agentManager.getAgent(sessionKey);
    if (agent) {
      agent.abort();
    }
  }
}

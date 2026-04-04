/**
 * Agent Orchestrator - Coordinates Agent execution flow
 *
 * Manages the complete agent execution pipeline from message processing
 * to response generation.
 */

import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';
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
import { runAgentTurnWithModelFallbacks } from './run-agent-turn-with-fallbacks.js';
import {
  persistInboundAttachmentsToWorkspace,
  formatInboundFileTextBlock,
} from '../../channels/attachments/inbound-persist.js';

const log = createLogger('AgentOrchestrator');

export interface AgentOrchestratorConfig {
  agentManager: AgentManager;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  eventHandler: AgentEventHandler;
  feedbackCoordinator: FeedbackCoordinator;
  sessionConfigStore: SessionConfigStore;
  getThinkingDefault: () => ThinkLevel | undefined;
  /** `agents.defaults.workspace` (resolved); used to persist inbound files per session. */
  workspaceRoot: string;
  /** Fire-and-forget after full session persist (e.g. LLM session title); not called from mid-turn snapshots. */
  enqueueAutoTitle?: (sessionKey: string) => void;
}

export class AgentOrchestrator {
  private agentManager: AgentManager;
  private sessionStore: SessionStore;
  private modelManager: ModelManager;
  private eventHandler: AgentEventHandler;
  private feedbackCoordinator: FeedbackCoordinator;
  private sessionConfigStore: SessionConfigStore;
  private getThinkingDefault: () => ThinkLevel | undefined;
  private workspaceRoot: string;
  private enqueueAutoTitle?: (sessionKey: string) => void;

  constructor(config: AgentOrchestratorConfig) {
    this.agentManager = config.agentManager;
    this.sessionStore = config.sessionStore;
    this.modelManager = config.modelManager;
    this.eventHandler = config.eventHandler;
    this.feedbackCoordinator = config.feedbackCoordinator;
    this.sessionConfigStore = config.sessionConfigStore;
    this.getThinkingDefault = config.getThinkingDefault;
    this.workspaceRoot = config.workspaceRoot;
    this.enqueueAutoTitle = config.enqueueAutoTitle;
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

      agent.replaceMessages(messages);

      // 2. Apply model configuration for session
      await this.modelManager.applyModelForSession(agent, sessionKey);

      const thinkingLevel = await resolveEffectiveThinkingLevel(
        this.sessionConfigStore,
        sessionKey,
        null,
        this.getThinkingDefault(),
      );
      this.agentManager.setThinkingLevel(sessionKey, thinkingLevel);

      // 3. Persist inbound files (Telegram, etc.) under workspace, then build user message
      const persistedAttachments = await persistInboundAttachmentsToWorkspace(
        this.workspaceRoot,
        sessionKey,
        msg.attachments,
      );
      const userMessage = this.buildUserMessage({
        ...msg,
        attachments: persistedAttachments ?? msg.attachments,
      });

      // 4. Start task feedback
      this.feedbackCoordinator.startTask();

      // 5. Execute agent
      await this.executeAgent(agent, userMessage, context);

      // 6. Sanitize messages before saving (remove error messages, empty content)
      const rawMessages = agent.state.messages;
      const { messages: sanitizedMessages, removed } = sanitizeMessages(rawMessages);

      if (removed > 0) {
        log.info({ sessionKey, removed }, 'Removed problematic messages before saving');
      }

      // 7. Save session messages (transcript hygiene aligned with OpenClaw)
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
   * Transcript hygiene (OpenClaw-style) + persist. Expects messages already passed through {@link sanitizeMessages}.
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
  private buildUserMessage(msg: InboundMessage): AgentMessage {
    // If there are attachments, build array content with text and images
    if (msg.attachments && msg.attachments.length > 0) {
      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];

      // Add text content if present
      if (msg.content.trim()) {
        messageContent.push({ type: 'text', text: msg.content });
      }

      // Add image attachments
      for (const att of msg.attachments) {
        if (att.type === 'image' || att.type === 'photo' || att.mimeType?.startsWith('image/')) {
          // Skip empty image data
          if (!att.data || att.data.length === 0) {
            log.warn({ type: att.type, name: att.name }, 'Empty image data, skipping');
            continue;
          }
          const mimeType = att.mimeType || 'image/jpeg';  // Fixed: JPEG is Telegram's default
          messageContent.push({ type: 'image', data: att.data, mimeType });
        } else {
          const fileBlock = formatInboundFileTextBlock(
            {
              type: att.type,
              mimeType: att.mimeType,
              name: att.name,
              size: att.size,
              workspaceRelativePath: att.workspaceRelativePath,
            },
            this.workspaceRoot,
          );
          messageContent.push({ type: 'text', text: fileBlock });
        }
      }

      // If only images were added with no text, add a default prompt so the LLM
      // knows it should describe or analyze the image(s).
      const hasText = messageContent.some((item) => item.type === 'text');
      const hasImage = messageContent.some((item) => item.type === 'image');
      if (hasImage && !hasText) {
        messageContent.unshift({ type: 'text', text: 'Please analyze the image(s) I sent.' });
      }

      // If messageContent is still empty (all attachments were skipped), fall back to text
      if (messageContent.length === 0) {
        log.warn({ attachmentCount: msg.attachments.length }, 'All attachments were skipped, falling back to text message');
        return {
          role: 'user',
          content: msg.content || '[Image attachment could not be processed]',
          timestamp: Date.now(),
        };
      }

      return {
        role: 'user',
        content: messageContent,
        timestamp: Date.now(),
      };
    }

    // No attachments - use simple string format (backward compatible)
    return {
      role: 'user',
      content: msg.content,
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

/**
 * Agent Orchestrator - Coordinates Agent execution flow
 *
 * Manages the complete agent execution pipeline from message processing
 * to response generation.
 */

import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';
import type { InboundMessage } from '../../bus/index.js';
import type { SessionStore } from '../../session/index.js';
import type { ModelManager } from '../models/index.js';
import type { SessionContext } from '../session/session-context.js';
import type { AgentEventHandler } from './agent-event-handler.js';
import type { FeedbackCoordinator } from '../feedback/feedback-coordinator.js';
import type { AgentManager } from '../agent-manager.js';
import { sanitizeMessages, cleanTrailingErrors } from '../memory/message-sanitizer.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('AgentOrchestrator');

export interface AgentOrchestratorConfig {
  agentManager: AgentManager;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  eventHandler: AgentEventHandler;
  feedbackCoordinator: FeedbackCoordinator;
}

export class AgentOrchestrator {
  private agentManager: AgentManager;
  private sessionStore: SessionStore;
  private modelManager: ModelManager;
  private eventHandler: AgentEventHandler;
  private feedbackCoordinator: FeedbackCoordinator;

  constructor(config: AgentOrchestratorConfig) {
    this.agentManager = config.agentManager;
    this.sessionStore = config.sessionStore;
    this.modelManager = config.modelManager;
    this.eventHandler = config.eventHandler;
    this.feedbackCoordinator = config.feedbackCoordinator;
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
      // 1. Load session history
      const messages = await this.sessionStore.load(sessionKey);

      // Clean any trailing errors from previous sessions (defensive)
      const cleanedHistory = cleanTrailingErrors(messages);
      agent.replaceMessages(cleanedHistory);

      // 2. Apply model configuration for session
      await this.modelManager.applyModelForSession(agent, sessionKey);

      // 3. Build user message
      const userMessage = this.buildUserMessage(msg);

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

      // 7. Save session messages
      await this.sessionStore.save(sessionKey, sanitizedMessages);

      // 8. End task feedback
      this.feedbackCoordinator.endTask();

    } catch (error) {
      log.error({ err: error, sessionKey }, 'Error in agent orchestration');
      this.feedbackCoordinator.endTask();
      throw error;
    }
  }

  /**
   * Execute the agent with a user message
   */
  private async executeAgent(
    agent: Agent,
    userMessage: AgentMessage,
    _context: SessionContext
  ): Promise<void> {
    // Prompt agent with user message
    await agent.prompt(userMessage);

    // Wait for agent to become idle
    await agent.waitForIdle();
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
          // Non-image attachments: include as text description
          const fileInfo = `[File: ${att.name || 'unknown'} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
          messageContent.push({ type: 'text', text: fileInfo });
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

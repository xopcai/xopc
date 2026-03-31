import { createLogger } from '../../utils/logger.js';
import { resolveAgentId } from '../../config/paths.js';
import { AgentInbox } from './inbox.js';
import type {
  AgentIPCMessage,
  AgentResponseMessage,
  AgentSignal,
  IPCPriority,
} from './types.js';
import {
  createTaskMessage,
  createResponseMessage,
  createSignalMessage,
} from './types.js';

const log = createLogger('AgentBus');

// ============================================
// Task Options
// ============================================

export interface TaskOptions {
  context?: string;
  priority?: IPCPriority;
  sessionKey?: string;
  callbackAgentId?: string;
  timeoutMs?: number;
}

// ============================================
// Agent Bus
// ============================================

export class AgentBus {
  private readonly stateDir: string;
  private readonly agentId: string;
  private readonly inbox: AgentInbox;
  private responseHandlers: Map<
    string,
    { resolve: (value: AgentIPCMessage) => void; reject: (reason?: Error) => void; timeout: NodeJS.Timeout }
  > = new Map();
  private unsubscribe?: () => void;

  constructor(stateDir: string, agentId?: string) {
    this.stateDir = stateDir;
    this.agentId = agentId || resolveAgentId();
    this.inbox = AgentInbox.forAgent(this.agentId);
  }

  /**
   * Start listening for messages
   */
  async startListening(
    handler: (msg: AgentIPCMessage) => Promise<void>
  ): Promise<void> {
    this.unsubscribe = await this.inbox.watch(async (msg) => {
      // Check if this is a response we're waiting for
      if (msg.replyTo && this.responseHandlers.has(msg.replyTo)) {
        const handler = this.responseHandlers.get(msg.replyTo)!;
        clearTimeout(handler.timeout);
        this.responseHandlers.delete(msg.replyTo);
        handler.resolve(msg);
        return;
      }

      // Otherwise, pass to general handler
      await handler(msg);
    });

    log.info({ agentId: this.agentId }, 'AgentBus started listening');
  }

  /**
   * Stop listening for messages
   */
  stopListening(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;

    // Reject all pending response handlers
    for (const [_id, handler] of this.responseHandlers) {
      clearTimeout(handler.timeout);
      handler.reject(new Error('AgentBus stopped listening'));
    }
    this.responseHandlers.clear();

    this.inbox.stopWatching();

    log.info({ agentId: this.agentId }, 'AgentBus stopped listening');
  }

  /**
   * Send a task to another agent
   */
  async sendTask(targetAgentId: string, task: string, options: TaskOptions = {}): Promise<string> {
    const message = createTaskMessage(
      this.agentId,
      targetAgentId,
      task,
      {
        ...options,
        callbackAgentId: options.callbackAgentId || this.agentId,
      }
    );

    await this.deliverMessage(targetAgentId, message);

    log.debug(
      { messageId: message.id, from: this.agentId, to: targetAgentId },
      'Task sent'
    );

    return message.id;
  }

  /**
   * Send a task and wait for response
   */
  async sendTaskAndWait(
    targetAgentId: string,
    task: string,
    options: TaskOptions = {}
  ): Promise<AgentResponseMessage> {
    const messageId = await this.sendTask(targetAgentId, task, options);

    return this.waitForResponse(messageId, options.timeoutMs);
  }

  /**
   * Send a signal to another agent
   */
  async sendSignal(targetAgentId: string, signal: AgentSignal, data?: unknown): Promise<void> {
    const message = createSignalMessage(this.agentId, targetAgentId, signal, data);
    await this.deliverMessage(targetAgentId, message);

    log.debug(
      { messageId: message.id, from: this.agentId, to: targetAgentId, signal },
      'Signal sent'
    );
  }

  /**
   * Wait for a response to a specific message
   */
  async waitForResponse(messageId: string, timeoutMs: number = 300000): Promise<AgentResponseMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(messageId);
        reject(new Error(`Timeout waiting for response to ${messageId}`));
      }, timeoutMs);

      this.responseHandlers.set(messageId, {
        resolve: (msg) => {
          if (msg.type === 'response') {
            resolve(msg as AgentResponseMessage);
          } else {
            reject(new Error(`Expected response, got ${msg.type}`));
          }
        },
        reject,
        timeout,
      });
    });
  }

  /**
   * Send a response to a message
   */
  async respond(
    toMessageId: string,
    toAgentId: string,
    success: boolean,
    data?: unknown,
    error?: string
  ): Promise<void> {
    const message = createResponseMessage(
      this.agentId,
      toAgentId,
      toMessageId,
      success,
      data,
      error
    );

    await this.deliverMessage(toAgentId, message);

    log.debug(
      { messageId: message.id, to: toAgentId, success },
      'Response sent'
    );
  }

  /**
   * Get pending message count
   */
  async getPendingCount(): Promise<number> {
    return this.inbox.count();
  }

  /**
   * Peek at pending messages
   */
  async peekPending(limit: number = 10): Promise<AgentIPCMessage[]> {
    return this.inbox.peek(limit);
  }

  // ============================================
  // Private Methods
  // ============================================

  private async deliverMessage(targetAgentId: string, message: AgentIPCMessage): Promise<void> {
    const targetInbox = AgentInbox.forAgent(targetAgentId);
    await targetInbox.enqueue(message);
  }
}

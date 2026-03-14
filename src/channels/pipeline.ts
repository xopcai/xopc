/**
 * Message Processing Pipeline
 * 
 * Three-stage pipeline:
 * - Preflight: Filter empty messages, self-messages, detect commands
 * - Process: Transform format, extract metadata
 * - Delivery: Send to Agent
 */

import { createLogger } from '../utils/logger.js';
import type { ChannelPluginInitOptions, ChannelOutboundContext, AgentResponse } from './plugin-types.js';

// Re-export for convenience
export type { AgentResponse } from './plugin-types.js';

const log = createLogger('Pipeline');

// ============================================
// Types
// ============================================

export interface PipelineMessageContext {
  /** Channel identifier */
  channel: string;
  /** Account ID */
  accountId: string;
  /** Chat ID */
  chatId: string;
  /** Sender ID */
  senderId: string;
  /** Message content */
  content: string;
  /** Original message metadata */
  metadata: Record<string, unknown>;
  /** Is group chat */
  isGroup: boolean;
  /** Is direct message */
  isDm: boolean;
  /** Thread ID (optional) */
  threadId?: string;
  /** Message ID (optional) */
  messageId?: string;
}

export interface PipelineMediaRef {
  type: 'photo' | 'video' | 'audio' | 'document' | 'voice';
  fileId: string;
  mimeType?: string;
  fileName?: string;
  url?: string;
}

// ============================================
// Handler Interfaces
// ============================================

export interface PreflightHandler {
  /** Handler name */
  name: string;
  /** Preflight - return null to skip message */
  preflight?(ctx: PipelineMessageContext): Promise<PipelineMessageContext | null>;
}

export interface ProcessHandler {
  /** Handler name */
  name: string;
  /** Process message - transform and extract */
  process(ctx: PipelineMessageContext): Promise<PipelineMessageContext>;
}

export interface DeliveryHandler {
  /** Handler name */
  name: string;
  /** Deliver message to Agent */
  deliver(ctx: PipelineMessageContext, response: AgentResponse): Promise<void>;
}

// ============================================
// Pipeline Options
// ============================================

export interface PipelineOptions {
  /** Channel name */
  channel: string;
  /** Preflight handlers */
  preflightHandlers?: PreflightHandler[];
  /** Process handlers */
  processHandlers?: ProcessHandler[];
  /** Delivery handlers */
  deliveryHandlers?: DeliveryHandler[];
  /** Agent callback */
  agentInvoke?: (ctx: PipelineMessageContext) => Promise<AgentResponse>;
  /** Error handler */
  onError?: (err: unknown, ctx: PipelineMessageContext) => void;
}

// ============================================
// Pipeline Implementation
// ============================================

export class MessagePipeline {
  private channel: string;
  private preflightHandlers: PreflightHandler[];
  private processHandlers: ProcessHandler[];
  private deliveryHandlers: DeliveryHandler[];
  private agentInvoke?: PipelineOptions['agentInvoke'];
  private onError?: PipelineOptions['onError'];

  constructor(options: PipelineOptions) {
    this.channel = options.channel;
    this.preflightHandlers = options.preflightHandlers ?? [];
    this.processHandlers = options.processHandlers ?? [];
    this.deliveryHandlers = options.deliveryHandlers ?? [];
    this.agentInvoke = options.agentInvoke;
    this.onError = options.onError;
  }

  /**
   * Handle inbound message
   */
  async handleMessage(ctx: PipelineMessageContext): Promise<void> {
    const channel = this.channel;
    
    // 1. Preflight stage
    let processedCtx = await this.runPreflight(ctx);
    if (!processedCtx) {
      log.debug({ channel, chatId: ctx.chatId }, 'Message filtered in preflight');
      return;
    }

    // 2. Process stage
    try {
      processedCtx = await this.runProcess(processedCtx);
    } catch (err) {
      log.error({ channel, err }, 'Process handler error');
      this.onError?.(err, processedCtx);
      return;
    }

    // 3. Deliver to Agent
    if (!this.agentInvoke) {
      log.warn({ channel }, 'No agentInvoke configured');
      return;
    }

    let response: AgentResponse;
    try {
      response = await this.agentInvoke(processedCtx);
    } catch (err) {
      log.error({ channel, err }, 'Agent invocation error');
      this.onError?.(err, processedCtx);
      return;
    }

    // 4. Delivery stage
    try {
      await this.runDelivery(processedCtx, response);
    } catch (err) {
      log.error({ channel, err }, 'Delivery handler error');
      this.onError?.(err, processedCtx);
    }
  }

  private async runPreflight(ctx: PipelineMessageContext): Promise<PipelineMessageContext | null> {
    for (const handler of this.preflightHandlers) {
      try {
        const result = await handler.preflight?.(ctx);
        if (!result) {
          log.debug({ channel: this.channel, handler: handler.name }, 'Preflight filtered message');
          return null;
        }
        ctx = result;
      } catch (err) {
        log.error({ channel: this.channel, handler: handler.name, err }, 'Preflight handler error');
        return null;
      }
    }
    return ctx;
  }

  private async runProcess(ctx: PipelineMessageContext): Promise<PipelineMessageContext> {
    for (const handler of this.processHandlers) {
      try {
        ctx = await handler.process(ctx);
      } catch (err) {
        log.error({ channel: this.channel, handler: handler.name, err }, 'Process handler error');
        throw err;
      }
    }
    return ctx;
  }

  private async runDelivery(ctx: PipelineMessageContext, response: AgentResponse): Promise<void> {
    for (const handler of this.deliveryHandlers) {
      try {
        await handler.deliver(ctx, response);
      } catch (err) {
        log.error({ channel: this.channel, handler: handler.name, err }, 'Delivery handler error');
        throw err;
      }
    }
  }
}

// ============================================
// Standard Handlers
// ============================================

/**
 * Create filter-self handler
 */
export function createFilterSelfHandler(currentBotId: string): PreflightHandler {
  return {
    name: 'filterSelf',
    preflight: async (ctx) => {
      if (ctx.senderId === currentBotId) {
        return null;
      }
      return ctx;
    },
  };
}

/**
 * Create filter-empty handler
 */
export function createFilterEmptyHandler(): PreflightHandler {
  return {
    name: 'filterEmpty',
    preflight: async (ctx) => {
      const content = ctx.content?.trim() ?? '';
      if (!content && (!ctx.metadata.media || (ctx.metadata.media as PipelineMediaRef[]).length === 0)) {
        return null;
      }
      return ctx;
    },
  };
}

/**
 * Create filter-commands handler
 */
export function createFilterCommandsHandler(commands: string[]): PreflightHandler {
  const commandSet = new Set(commands.map(c => c.toLowerCase()));
  return {
    name: 'filterCommands',
    preflight: async (ctx) => {
      const firstWord = ctx.content?.split(/\s/)[0]?.toLowerCase() ?? '';
      if (firstWord.startsWith('/') && commandSet.has(firstWord.slice(1))) {
        ctx.metadata.isCommand = true;
        ctx.metadata.command = firstWord.slice(1);
      }
      return ctx;
    },
  };
}

/**
 * Create standard preflight handlers
 */
export function standardPreflightHandlers(botId: string): PreflightHandler[] {
  return [
    createFilterSelfHandler(botId),
    createFilterEmptyHandler(),
    createFilterCommandsHandler(['start', 'help', 'status', 'stop']),
  ];
}

/**
 * Create standard process handlers
 */
export function standardProcessHandlers(): ProcessHandler[] {
  return [];
}

// ============================================
// Factory
// ============================================

export interface CreatePipelineParams {
  channel: string;
  botId: string;
  agentInvoke: PipelineOptions['agentInvoke'];
  onError?: PipelineOptions['onError'];
}

/**
 * Create message processing pipeline
 */
export function createPipeline(params: CreatePipelineParams): MessagePipeline {
  return new MessagePipeline({
    channel: params.channel,
    preflightHandlers: standardPreflightHandlers(params.botId),
    processHandlers: standardProcessHandlers(),
    agentInvoke: params.agentInvoke,
    onError: params.onError,
  });
}

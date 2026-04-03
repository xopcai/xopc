/**
 * Agent Event Handler - Handles all Agent lifecycle events
 *
 * Processes agent events and coordinates related actions like
 * progress updates, error tracking, and lifecycle events.
 */

import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { SessionContext } from '../session/session-context.js';
import type { ProgressFeedbackManager } from '../lifecycle/progress.js';
import type { ToolErrorTracker } from '../tools/error-tracker.js';
import type { RequestLimiter } from '../models/request-limiter.js';
import type { LifecycleManager } from '../lifecycle/index.js';
import type { ToolChainTracker } from '../tools/chain-tracker.js';
import type { SelfVerifyMiddleware } from '../middleware/index.js';
import type { SystemReminder } from '../prompt/system-reminder.js';
import type { ToolUsageAnalyzer } from '../tools/usage-analyzer.js';
import type { ErrorPatternMatcher } from '../tools/error-pattern-matcher.js';
import type { ModelManager } from '../models/index.js';
import { extractTextContent } from '../context/workspace.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('AgentEventHandler');

export interface AgentEventHandlerConfig {
  progressManager: ProgressFeedbackManager;
  errorTracker: ToolErrorTracker;
  requestLimiter: RequestLimiter;
  lifecycleManager: LifecycleManager;
  toolChainTracker: ToolChainTracker;
  selfVerifyMiddleware: SelfVerifyMiddleware;
  systemReminder: SystemReminder;
  toolUsageAnalyzer: ToolUsageAnalyzer;
  errorPatternMatcher: ErrorPatternMatcher;
  modelManager: ModelManager;
}

export class AgentEventHandler {
  private progressManager: ProgressFeedbackManager;
  private errorTracker: ToolErrorTracker;
  private requestLimiter: RequestLimiter;
  private lifecycleManager: LifecycleManager;
  private toolChainTracker: ToolChainTracker;
  private selfVerifyMiddleware: SelfVerifyMiddleware;
  private systemReminder: SystemReminder;
  private toolUsageAnalyzer: ToolUsageAnalyzer;
  private errorPatternMatcher: ErrorPatternMatcher;
  private modelManager: ModelManager;
  private taskStartTime: number = 0;

  constructor(config: AgentEventHandlerConfig) {
    this.progressManager = config.progressManager;
    this.errorTracker = config.errorTracker;
    this.requestLimiter = config.requestLimiter;
    this.lifecycleManager = config.lifecycleManager;
    this.toolChainTracker = config.toolChainTracker;
    this.selfVerifyMiddleware = config.selfVerifyMiddleware;
    this.systemReminder = config.systemReminder;
    this.toolUsageAnalyzer = config.toolUsageAnalyzer;
    this.errorPatternMatcher = config.errorPatternMatcher;
    this.modelManager = config.modelManager;
  }

  /**
   * Handle an agent event
   */
  handle(event: AgentEvent, context: SessionContext | null): void {
    if (!context) {
      if (event.type !== 'message_update') {
        log.warn({ eventType: event.type }, 'No context available for event');
      }
      return;
    }

    switch (event.type) {
      case 'agent_start':
        this.handleAgentStart(event, context);
        break;
      case 'turn_start':
        this.handleTurnStart(event, context);
        break;
      case 'message_start':
        this.handleMessageStart(event, context);
        break;
      case 'message_end':
        this.handleMessageEnd(event, context);
        break;
      case 'tool_execution_start':
        this.handleToolExecutionStart(event, context);
        break;
      case 'tool_execution_update':
        this.handleToolExecutionUpdate(event, context);
        break;
      case 'tool_execution_end':
        this.handleToolExecutionEnd(event, context);
        break;
      case 'message_update':
        // Handled by AgentService for streaming, but we acknowledge it here
        break;
      case 'turn_end':
        this.handleTurnEnd(event, context);
        break;
      case 'agent_end':
        this.handleAgentEnd(event, context);
        break;
      default:
        log.debug({ eventType: (event as AgentEvent).type }, 'Unhandled event type');
    }
  }

  private handleAgentStart(_event: AgentEvent, context: SessionContext): void {
    log.debug('Agent turn started');
    this.taskStartTime = Date.now();
    this.progressManager.startTask();

    const result = this.requestLimiter.recordRequest();

    this.lifecycleManager.emit('llm_request', context.sessionKey, {
      requestNumber: result.count,
      maxRequests: result.limit,
    }, context).catch((err) => {
      log.warn({ err }, 'Failed to emit llm_request lifecycle event');
    });

    this.progressManager.onRequestLimitStatus(
      result.count,
      result.limit,
      result.remaining,
      result.isWarning,
      result.shouldStop
    );

    if (result.shouldStop) {
      log.error({ count: result.count, limit: result.limit }, 'Request limit reached');
    }
  }

  private handleTurnStart(_event: AgentEvent, context: SessionContext): void {
    log.debug('Turn started');
    this.progressManager.onTurnStart();
    // One chain per LLM turn (pi-agent emits turn_start each round; turn_end clears the chain)
    this.toolChainTracker.startChain(context.sessionKey);
  }

  private handleMessageStart(event: AgentEvent, _context: SessionContext): void {
    const msgEvent = event as Extract<AgentEvent, { type: 'message_start' }>;
    if (msgEvent.message?.role === 'assistant') {
      log.debug('Assistant response starting');
    }
  }

  private handleMessageEnd(event: AgentEvent, context: SessionContext): void {
    const msgEvent = event as Extract<AgentEvent, { type: 'message_end' }>;
    if (msgEvent.message?.role === 'assistant') {
      const content = msgEvent.message.content;
      const text = Array.isArray(content)
        ? extractTextContent(content as Array<{ type: string; text?: string }>)
        : String(content);
      log.debug({ contentLength: text.length }, 'Assistant response complete');

      this.lifecycleManager.emit('llm_response', context.sessionKey, {
        response: text,
        usage: (msgEvent.message as any).usage,
      }, context).catch((err) => {
        log.warn({ err }, 'Failed to emit llm_response lifecycle event');
      });
    }
  }

  private handleToolExecutionStart(event: AgentEvent, context: SessionContext): void {
    const toolEvent = event as Extract<AgentEvent, { type: 'tool_execution_start' }>;
    log.debug({ tool: toolEvent.toolName, args: toolEvent.args }, 'Tool execution started');
    this.progressManager.onToolStart(toolEvent.toolName, toolEvent.args || {});

    this.lifecycleManager.emit('tool_call_start', context.sessionKey, {
      toolName: toolEvent.toolName,
      arguments: toolEvent.args || {},
      attemptNumber: 1,
      maxAttempts: 3,
    }, context).catch((err) => {
      log.warn({ err }, 'Failed to emit tool_call_start lifecycle event');
    });

    this.toolChainTracker.recordCall(
      context.sessionKey,
      toolEvent.toolName,
      toolEvent.args || {},
      0
    );

    // Track file edits for self-verify
    this.trackFileEdit(toolEvent.toolName, toolEvent.args);
  }

  private handleToolExecutionUpdate(event: AgentEvent, _context: SessionContext): void {
    const toolEvent = event as Extract<AgentEvent, { type: 'tool_execution_update' }>;
    this.progressManager.onToolUpdate(toolEvent.toolName, toolEvent.partialResult);
  }

  private handleToolExecutionEnd(event: AgentEvent, context: SessionContext): void {
    const toolEvent = event as Extract<AgentEvent, { type: 'tool_execution_end' }>;
    log.debug({ tool: toolEvent.toolName, isError: toolEvent.isError }, 'Tool execution complete');
    this.progressManager.onToolEnd(toolEvent.toolName, toolEvent.result, toolEvent.isError);

    const durationMs = (toolEvent as any).durationMs || 0;

    this.lifecycleManager.emit('tool_call_end', context.sessionKey, {
      toolName: toolEvent.toolName,
      success: !toolEvent.isError,
      result: toolEvent.result,
      error: toolEvent.isError ? String(toolEvent.result) : undefined,
      durationMs,
    }, context).catch((err) => {
      log.warn({ err }, 'Failed to emit tool_call_end lifecycle event');
    });

    // System reminder
    (toolEvent as any).result = this.systemReminder.appendToResult(toolEvent.result);

    // Record tool usage
    this.toolUsageAnalyzer.recordUsage(toolEvent.toolName, !toolEvent.isError, durationMs);

    // Record tool result in chain
    this.recordToolResult(context.sessionKey, toolEvent.toolName, toolEvent.result, toolEvent.isError, durationMs);

    // Track errors
    if (toolEvent.isError) {
      const errorText = this.extractError(toolEvent.result);
      this.errorTracker.recordFailure(toolEvent.toolName, errorText);

      // Match error pattern
      const errorMatch = this.errorPatternMatcher.matchError(errorText);
      if (errorMatch.matched && errorMatch.pattern) {
        log.warn(
          { tool: toolEvent.toolName, pattern: errorMatch.pattern.name },
          'Matched error pattern'
        );
      }
    }
  }

  private handleTurnEnd(_event: AgentEvent, context: SessionContext): void {
    // Reset trackers
    this.errorTracker.reset();
    this.requestLimiter.reset();
    this.selfVerifyMiddleware.onTurnStart();
    this.toolChainTracker.endChain(context.sessionKey);
  }

  private handleAgentEnd(_event: AgentEvent, _context: SessionContext): void {
    this.progressManager.endTask();
  }

  private trackFileEdit(toolName: string | undefined, args: Record<string, unknown> | undefined): void {
    if (!toolName || !args) return;
    
    const name = toolName.toLowerCase();
    if (name.includes('write') && args.path) {
      this.selfVerifyMiddleware.recordEdit(String(args.path), 'write');
    } else if (name.includes('edit') && args.path) {
      this.selfVerifyMiddleware.recordEdit(String(args.path), 'edit');
    }
  }

  private recordToolResult(
    sessionKey: string,
    toolName: string,
    result: unknown,
    isError: boolean,
    durationMs: number
  ): void {
    const chain = this.toolChainTracker.getCurrentChain(sessionKey);
    if (chain) {
      const lastNode = chain.nodes[chain.nodes.length - 1];
      if (lastNode && lastNode.toolName === toolName) {
        this.toolChainTracker.recordResult(
          sessionKey,
          lastNode.id,
          result,
          isError ? 'Tool execution failed' : undefined,
          durationMs
        );
      }
    }
  }

  private extractError(result: unknown): string {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      if (obj.error && typeof obj.error === 'string') return obj.error;
      if (obj.message && typeof obj.message === 'string') return obj.message;
      return JSON.stringify(result);
    }
    return String(result);
  }

  /**
   * Get task duration in milliseconds
   */
  getTaskDuration(): number {
    if (!this.taskStartTime) return 0;
    return Date.now() - this.taskStartTime;
  }
}

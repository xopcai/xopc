/**
 * Agent Event Handler — coordinates listeners on pi-agent events.
 *
 * Previously a single god-handler with ten manager fields and one `switch`. Now a
 * thin façade around {@link SessionEventBus}: each concern (progress, lifecycle
 * hooks, tool-chain recording, error tracking, self-verify, etc.) registers its
 * own listener at construction time, and external code can add new listeners via
 * {@link AgentEventHandler.registerListener} without modifying this file (OCP).
 *
 * Ordering note: a few listeners are order-sensitive (notably the
 * `tool_execution_end` chain — `SystemReminder` mutates `event.result` in place
 * and downstream listeners read the mutated value). The `installX` calls below
 * preserve the exact order from the previous implementation.
 */

import type { AgentEvent } from '@earendil-works/pi-agent-core';
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
import { extractTextContent } from '../context/workspace.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('AgentEventHandler');

// ── Event bus ──────────────────────────────────────────────────────────────

export type SessionEventListener = (event: AgentEvent, context: SessionContext) => void;
export type SessionEventTypeFilter = AgentEvent['type'] | 'all';

/**
 * Typed pub/sub for agent events. Listeners run in registration order; the bus
 * itself is synchronous — listeners that need async work must dispatch their own
 * promises (typically by awaiting and logging on error, like the lifecycle hooks).
 */
export class SessionEventBus {
  private readonly listeners = new Map<SessionEventTypeFilter, SessionEventListener[]>();

  on(type: SessionEventTypeFilter, listener: SessionEventListener): () => void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
    return () => {
      const current = this.listeners.get(type);
      if (!current) return;
      const idx = current.indexOf(listener);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  dispatch(event: AgentEvent, context: SessionContext | null): void {
    if (!context) {
      if (event.type !== 'message_update') {
        log.warn(
          { eventType: event.type },
          `Agent event ignored (no SessionContext): ${event.type}`,
        );
      }
      return;
    }
    const exact = this.listeners.get(event.type);
    if (exact) {
      for (const listener of exact) {
        listener(event, context);
      }
    }
    const all = this.listeners.get('all');
    if (all) {
      for (const listener of all) {
        listener(event, context);
      }
    }
  }
}

// ── Built-in listener installers ───────────────────────────────────────────

function installProgressListener(bus: SessionEventBus, progressManager: ProgressFeedbackManager): void {
  bus.on('agent_start', () => {
    log.debug('Agent turn started');
    progressManager.startTask();
  });
  bus.on('turn_start', () => {
    log.debug('Turn started');
    progressManager.onTurnStart();
  });
  bus.on('tool_execution_start', (event) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_start' }>;
    log.debug({ tool: e.toolName, args: e.args }, 'Tool execution started');
    progressManager.onToolStart(e.toolName, e.args || {});
  });
  bus.on('tool_execution_update', (event) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_update' }>;
    progressManager.onToolUpdate(e.toolName, e.partialResult);
  });
  bus.on('tool_execution_end', (event) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_end' }>;
    log.debug({ tool: e.toolName, isError: e.isError }, 'Tool execution complete');
    progressManager.onToolEnd(e.toolName, e.result, e.isError);
  });
  bus.on('agent_end', () => {
    progressManager.endTask();
  });
}

function installRequestLimitListener(
  bus: SessionEventBus,
  deps: {
    requestLimiter: RequestLimiter;
    progressManager: ProgressFeedbackManager;
    lifecycleManager: LifecycleManager;
  },
): void {
  bus.on('agent_start', (_event, context) => {
    const result = deps.requestLimiter.recordRequest();

    deps.lifecycleManager
      .emit(
        'llm_request',
        context.sessionKey,
        { requestNumber: result.count, maxRequests: result.limit },
        context,
      )
      .catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.warn(
          {
            err,
            errorMessage: em,
            sessionKey: context.sessionKey,
            requestNumber: result.count,
            maxRequests: result.limit,
          },
          `Lifecycle emit llm_request failed: ${em}`,
        );
      });

    deps.progressManager.onRequestLimitStatus(
      result.count,
      result.limit,
      result.remaining,
      result.isWarning,
      result.shouldStop,
    );

    if (result.shouldStop) {
      log.error(
        { count: result.count, limit: result.limit, sessionKey: context.sessionKey },
        `Request limit reached (${result.count}/${result.limit}) for session`,
      );
    }
  });

  bus.on('turn_end', () => {
    deps.requestLimiter.reset();
  });
}

function installLifecycleHookListener(bus: SessionEventBus, lifecycleManager: LifecycleManager): void {
  bus.on('message_end', (event, context) => {
    const e = event as Extract<AgentEvent, { type: 'message_end' }>;
    if (e.message?.role !== 'assistant') return;
    const content = e.message.content;
    const text = Array.isArray(content)
      ? extractTextContent(content as Array<{ type: string; text?: string }>)
      : String(content);
    log.debug({ contentLength: text.length }, 'Assistant response complete');

    lifecycleManager
      .emit(
        'llm_response',
        context.sessionKey,
        { response: text, usage: (e.message as { usage?: unknown }).usage },
        context,
      )
      .catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, errorMessage: em, sessionKey: context.sessionKey, responseChars: text.length },
          `Lifecycle emit llm_response failed: ${em}`,
        );
      });
  });

  bus.on('tool_execution_start', (event, context) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_start' }>;
    lifecycleManager
      .emit(
        'tool_call_start',
        context.sessionKey,
        {
          toolName: e.toolName,
          arguments: e.args || {},
          attemptNumber: 1,
          maxAttempts: 3,
        },
        context,
      )
      .catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, errorMessage: em, sessionKey: context.sessionKey, tool: e.toolName },
          `Lifecycle emit tool_call_start failed: ${em}`,
        );
      });
  });

  bus.on('tool_execution_end', (event, context) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_end' }>;
    const durationMs = (e as { durationMs?: number }).durationMs || 0;
    lifecycleManager
      .emit(
        'tool_call_end',
        context.sessionKey,
        {
          toolName: e.toolName,
          success: !e.isError,
          result: e.result,
          error: e.isError ? String(e.result) : undefined,
          durationMs,
        },
        context,
      )
      .catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, errorMessage: em, sessionKey: context.sessionKey, tool: e.toolName },
          `Lifecycle hook tool_call_end failed: ${em}`,
        );
      });
  });
}

function installSystemReminderListener(bus: SessionEventBus, systemReminder: SystemReminder): void {
  // MUTATES `event.result` so downstream listeners (tool-chain, error-tracking) see
  // the decorated text. Must run AFTER progress + lifecycle hooks (they consume the
  // original) and BEFORE tool-chain + error-tracking.
  bus.on('tool_execution_end', (event) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_end' }> & { result: unknown };
    e.result = systemReminder.appendToResult(e.result, e.toolName);
  });
}

function appendTextToToolResult(result: unknown, text: string): unknown {
  if (!text.trim()) {
    return result;
  }
  if (result && typeof result === 'object') {
    const res = result as Record<string, unknown>;
    if (Array.isArray(res.content)) {
      res.content = [
        ...res.content,
        { type: 'text', text: `\n${text}` },
      ];
      return res;
    }
    if (typeof res.content === 'string') {
      res.content = `${res.content}\n${text}`;
      return res;
    }
  }
  return result;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readToolResultDetails(result: unknown): Record<string, unknown> | null {
  const rec = readRecord(result);
  if (!rec) return null;
  return readRecord(rec.details);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readChangedPathsFromToolEnd(toolName: string, args: unknown, result: unknown): string[] {
  const name = toolName.toLowerCase();
  const details = readToolResultDetails(result);

  if (name === 'apply_patch') {
    const files = readStringArray(details?.files);
    if (files.length > 0) return files;

    const changes = Array.isArray(details?.changes) ? details.changes : [];
    return changes.flatMap((change) => {
      const rec = readRecord(change);
      if (!rec) return [];
      return readStringArray([rec.moveTo, rec.path]);
    });
  }

  if (name === 'write_file') {
    if (typeof details?.size !== 'number') return [];
    const rec = readRecord(args);
    return typeof rec?.path === 'string' ? [rec.path] : [];
  }

  if (name.includes('write') || name.includes('edit')) {
    const rec = readRecord(args);
    return typeof rec?.path === 'string' ? [rec.path] : [];
  }

  return [];
}

function installToolChainListener(bus: SessionEventBus, toolChainTracker: ToolChainTracker): void {
  bus.on('turn_start', (_event, context) => {
    // One chain per LLM turn (pi-agent emits turn_start each round; turn_end clears the chain).
    toolChainTracker.startChain(context.sessionKey);
  });
  bus.on('tool_execution_start', (event, context) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_start' }>;
    toolChainTracker.recordCall(context.sessionKey, e.toolName, e.args || {}, 0);
  });
  bus.on('tool_execution_end', (event, context) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_end' }>;
    const durationMs = (e as { durationMs?: number }).durationMs || 0;
    const chain = toolChainTracker.getCurrentChain(context.sessionKey);
    if (!chain) return;
    const lastNode = chain.nodes[chain.nodes.length - 1];
    if (lastNode && lastNode.toolName === e.toolName) {
      toolChainTracker.recordResult(
        context.sessionKey,
        lastNode.id,
        e.result,
        e.isError ? 'Tool execution failed' : undefined,
        durationMs,
      );
    }
  });
  bus.on('turn_end', (_event, context) => {
    toolChainTracker.endChain(context.sessionKey);
  });
}

function installToolUsageListener(bus: SessionEventBus, toolUsageAnalyzer: ToolUsageAnalyzer): void {
  bus.on('tool_execution_end', (event) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_end' }>;
    const durationMs = (e as { durationMs?: number }).durationMs || 0;
    toolUsageAnalyzer.recordUsage(e.toolName, !e.isError, durationMs);
  });
}

function extractErrorText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.message === 'string') return obj.message;
    return JSON.stringify(result);
  }
  return String(result);
}

function installErrorTrackingListener(
  bus: SessionEventBus,
  deps: { errorTracker: ToolErrorTracker; errorPatternMatcher: ErrorPatternMatcher },
): void {
  bus.on('tool_execution_end', (event) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_end' }>;
    if (!e.isError) return;
    const errorText = extractErrorText(e.result);
    deps.errorTracker.recordFailure(e.toolName, errorText);

    const errorMatch = deps.errorPatternMatcher.matchError(errorText);
    if (errorMatch.matched && errorMatch.pattern) {
      const preview = errorText.length > 120 ? `${errorText.slice(0, 120)}…` : errorText;
      log.warn(
        { tool: e.toolName, pattern: errorMatch.pattern.name, errorPreview: preview },
        `Tool error matched pattern "${errorMatch.pattern.name}" (${e.toolName}): ${preview}`,
      );
    }
  });
  bus.on('turn_end', () => {
    deps.errorTracker.reset();
  });
}

function installSelfVerifyListener(bus: SessionEventBus, selfVerifyMiddleware: SelfVerifyMiddleware): void {
  bus.on('tool_execution_end', (event, context) => {
    const e = event as Extract<AgentEvent, { type: 'tool_execution_end' }> & { result: unknown };
    const name = e.toolName?.toLowerCase() ?? '';
    const args = (e as { args?: unknown }).args;

    if (name === 'exec_command') {
      selfVerifyMiddleware.recordVerification(e.toolName, args, {
        isError: e.isError,
        result: e.result,
      }, context.sessionKey);
      return;
    }

    if (!e.isError) {
      const changedPaths = readChangedPathsFromToolEnd(e.toolName, args, e.result);
      for (const path of changedPaths) {
        selfVerifyMiddleware.recordEdit(
          path,
          name.includes('write') ? 'write' : 'edit',
          context.sessionKey,
        );
      }
      if (changedPaths.length > 0) {
        e.result = appendTextToToolResult(
          e.result,
          selfVerifyMiddleware.consumePostEditReminder(context.sessionKey),
        );
        return;
      }
      selfVerifyMiddleware.recordVerification(e.toolName, args, {
        isError: e.isError,
        result: e.result,
      }, context.sessionKey);
    }
  });
  bus.on('turn_start', (_event, context) => {
    selfVerifyMiddleware.onTurnStart(context.sessionKey);
  });
}

// ── Public façade ───────────────────────────────────────────────────────────

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
}

/**
 * Thin façade over {@link SessionEventBus} that pre-registers all built-in
 * listeners in their required order. `handle(event, ctx)` is the entry point
 * used by `AgentService.handleSessionEvent`; extensions can hook in via
 * {@link registerListener} without touching this class.
 */
export class AgentEventHandler {
  private readonly bus: SessionEventBus;

  constructor(config: AgentEventHandlerConfig) {
    this.bus = new SessionEventBus();

    // Order matters for `tool_execution_end`: SystemReminder mutates `event.result`
    // and ToolChain + ErrorTracking depend on the mutated value. Keep these in this
    // exact sequence.
    installProgressListener(this.bus, config.progressManager);
    installRequestLimitListener(this.bus, {
      requestLimiter: config.requestLimiter,
      progressManager: config.progressManager,
      lifecycleManager: config.lifecycleManager,
    });
    installLifecycleHookListener(this.bus, config.lifecycleManager);
    installSystemReminderListener(this.bus, config.systemReminder);
    installSelfVerifyListener(this.bus, config.selfVerifyMiddleware);
    installToolUsageListener(this.bus, config.toolUsageAnalyzer);
    installToolChainListener(this.bus, config.toolChainTracker);
    installErrorTrackingListener(this.bus, {
      errorTracker: config.errorTracker,
      errorPatternMatcher: config.errorPatternMatcher,
    });
  }

  /** Dispatch a pi-agent event to all registered listeners. */
  handle(event: AgentEvent, context: SessionContext | null): void {
    this.bus.dispatch(event, context);
  }

  /**
   * Register an additional listener (e.g. from an extension). Returns an
   * unsubscribe function. Listeners run after the built-ins in registration
   * order; if you need to run before a built-in, you must create your own
   * {@link SessionEventBus} instance.
   */
  registerListener(type: SessionEventTypeFilter, listener: SessionEventListener): () => void {
    return this.bus.on(type, listener);
  }
}

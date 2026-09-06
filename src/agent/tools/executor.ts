/**
 * Tool Executor - Unified tool execution wrapper.
 *
 * Adds:
 * - Timeout protection (tools that hang would otherwise stall the turn).
 * - Optional retry for tools explicitly marked `idempotent`.
 *
 * Pi-agent contract (from `AgentTool.execute` docstring): "Throw on failure
 * instead of encoding errors in `content`." Pi-agent turns thrown errors into
 * `tool_execution_end` events with `isError=true`, which feeds the loop guard,
 * error tracker, and error-pattern matcher. This wrapper therefore re-throws
 * instead of synthesising fake-success results.
 */

import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core';
import { commandTimeout } from '../commands/command-registry.js';
import { createLogger } from '../../utils/logger.js';
import {
  DEFAULT_TOOL_EXECUTION_TIMEOUT_MS,
  executeWithTimeout,
  TimeoutError,
} from '../lifecycle/timeout-wrapper.js';
import { withRetry } from '../../infra/retry.js';
import type { XopcToolMetadata } from './metadata.js';
import { ToolConcurrencyController, resolveToolLockMode } from './concurrency.js';
import type { ToolConcurrencyController as ToolConcurrencyControllerType } from './concurrency.js';

const log = createLogger('ToolExecutor');

export interface ToolExecutorConfig {
  /** Default per-tool timeout when the tool does not declare its own `timeoutMs`. */
  defaultTimeoutMs: number;

  /** Per-session policy resolved from global defaults and agent overrides. */
  resolveTimeoutMs?: (toolName: string) => number | undefined;

  /** Max retry attempts for tools opted into retry via `idempotent: true`. */
  maxRetries: number;
  /** Initial backoff between retries (passed straight to `withRetry`). */
  retryDelayMs: number;

  /** Master switches; default both on so the wrapper is still effective. */
  enableTimeout: boolean;
  enableRetry: boolean;
}

const DEFAULT_CONFIG: ToolExecutorConfig = {
  defaultTimeoutMs: DEFAULT_TOOL_EXECUTION_TIMEOUT_MS,
  maxRetries: 2,
  retryDelayMs: 1000,
  enableTimeout: true,
  enableRetry: true,
};

/**
 * Optional xopc-side hints that any tool may attach. They are not part of the
 * pi-agent `AgentTool` contract; the wrapper reads them via structural typing.
 *
 * - `timeoutMs`: per-tool override of the default execution timeout.
 * - `idempotent`: marks a tool as safe to retry. The wrapper retries only
 *   tools that opt in — write/edit-like tools must leave this `false`.
 */
export interface XopcToolHints extends XopcToolMetadata {
  timeoutMs?: number;
}

function readToolHints(tool: AgentTool<any, any>): XopcToolHints {
  const t = tool as AgentTool<any, any> & XopcToolHints;
  return {
    timeoutMs: typeof t.timeoutMs === 'number' && t.timeoutMs > 0 ? t.timeoutMs : undefined,
    idempotent: t.idempotent === true,
  };
}

function resolveTimeoutMs(tool: AgentTool<any, any>, config: ToolExecutorConfig): number {
  const hints = readToolHints(tool);
  const policyTimeoutMs = config.resolveTimeoutMs?.(tool.name);
  return policyTimeoutMs && policyTimeoutMs > 0
    ? policyTimeoutMs
    : hints.timeoutMs ?? config.defaultTimeoutMs;
}

/**
 * Execute tool with timeout (always) and retry (only for idempotent tools).
 * Re-throws on failure so pi-agent records `isError=true`.
 */
export async function executeToolWithProtection<TDetails>(
  tool: AgentTool<any, TDetails>,
  toolCallId: string,
  params: any,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<TDetails>,
  config: Partial<ToolExecutorConfig> = {},
): Promise<AgentToolResult<TDetails>> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const toolName = tool.name;
  const hints = readToolHints(tool);

  const runOnce = (): Promise<AgentToolResult<TDetails>> => {
    const controller = new AbortController();
    const onParentAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onParentAbort();
    else signal?.addEventListener('abort', onParentAbort, { once: true });

    const policyDeadline = fullConfig.resolveTimeoutMs?.(toolName);
    const commandDeadlineField = toolName === 'exec_command' ? 'timeoutMs'
      : toolName === 'managed_job' && params.action === 'start' ? 'maxRuntimeMs' : undefined;
    const executionParams = commandDeadlineField && policyDeadline
      ? { ...params, [commandDeadlineField]: Math.min(commandTimeout(params[commandDeadlineField]), policyDeadline) }
      : params;
    const execute = () => tool.execute(toolCallId, executionParams, controller.signal, onUpdate);
    // The command registry owns its deadline and waits for the process tree to exit.
    const result = fullConfig.enableTimeout && toolName !== 'exec_command'
      ? executeWithTimeout(execute, {
          toolName,
          timeoutMs: resolveTimeoutMs(tool, fullConfig),
          description: `Executing ${toolName}`,
          signal,
          onTimeout: (error) => controller.abort(error),
        })
      : execute();
    return result.finally(() => signal?.removeEventListener('abort', onParentAbort));
  };

  let operation: () => Promise<AgentToolResult<TDetails>> = runOnce;

  const shouldRetry = fullConfig.enableRetry && fullConfig.maxRetries > 0 && hints.idempotent;
  if (shouldRetry) {
    const inner = operation;
    operation = () =>
      withRetry(inner, {
        attempts: fullConfig.maxRetries + 1,
        minDelayMs: fullConfig.retryDelayMs,
        shouldRetry: (error) => !signal?.aborted && (error as { name?: unknown })?.name !== 'AbortError',
        onRetry: (info) => {
          log.warn(
            { tool: toolName, attempt: info.attempt, delayMs: info.delayMs, error: info.error },
            'Tool execution failed, retrying (idempotent)',
          );
        },
      });
  }

  const startTime = Date.now();
  try {
    const result = await operation();
    log.debug(
      { tool: toolName, durationMs: Date.now() - startTime, success: true },
      'Tool execution completed',
    );
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (error instanceof TimeoutError) {
      log.error(
        { tool: toolName, timeoutMs: error.timeoutMs, durationMs },
        'Tool execution timed out',
      );
      throw new Error(`Tool '${toolName}' timed out after ${error.timeoutMs}ms`, { cause: error });
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(
      { tool: toolName, error: errorMessage, durationMs },
      'Tool execution failed',
    );
    throw error instanceof Error ? error : new Error(errorMessage);
  }
}

/**
 * Wrap a single tool with the protection pipeline. Preserves the original
 * `execute` signature so streaming `signal` / `onUpdate` reach the tool.
 */
export function wrapToolWithProtection<TDetails>(
  tool: AgentTool<any, TDetails>,
  config?: Partial<ToolExecutorConfig>,
  concurrency?: ToolConcurrencyControllerType,
): AgentTool<any, TDetails> {
  const lockMode = resolveToolLockMode(tool);
  return {
    ...tool,
    async execute(
      toolCallId: string,
      params: any,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<TDetails>,
    ): Promise<AgentToolResult<TDetails>> {
      const run = () => executeToolWithProtection(tool, toolCallId, params, signal, onUpdate, config);
      return concurrency ? concurrency.run(lockMode, run) : run();
    },
  } as AgentTool<any, TDetails>;
}

/**
 * Wrap a batch of tools with protection.
 */
export function wrapToolsWithProtection(
  tools: AgentTool<any, any>[],
  config?: Partial<ToolExecutorConfig>,
  concurrency = new ToolConcurrencyController(),
): AgentTool<any, any>[] {
  return tools.map((tool) => wrapToolWithProtection(tool, config, concurrency));
}

// Export configuration
export { DEFAULT_CONFIG as DEFAULT_TOOL_EXECUTOR_CONFIG };

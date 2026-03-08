/**
 * Timeout Wrapper - Protects tool execution from hanging
 *
 * Wraps tool execution with timeout protection to prevent:
 * - Infinite loops in shell commands
 * - Network requests hanging forever
 * - Resource exhaustion
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('TimeoutWrapper');

export interface TimeoutConfig {
  defaultTimeoutMs: number;      // Default timeout in ms (default: 300000 = 5 min)
  shellTimeoutMs: number;        // Shell command timeout (default: 300000 = 5 min)
  readTimeoutMs: number;         // File read timeout (default: 30000 = 30 sec)
  writeTimeoutMs: number;        // File write timeout (default: 60000 = 1 min)
  networkTimeoutMs: number;      // Network request timeout (default: 60000 = 1 min)
  gracefulShutdownMs: number;    // Time to wait for graceful shutdown (default: 5000)
}

const DEFAULT_CONFIG: TimeoutConfig = {
  defaultTimeoutMs: 5 * 60 * 1000,      // 5 minutes
  shellTimeoutMs: 5 * 60 * 1000,        // 5 minutes
  readTimeoutMs: 30 * 1000,             // 30 seconds
  writeTimeoutMs: 60 * 1000,            // 1 minute
  networkTimeoutMs: 60 * 1000,          // 1 minute
  gracefulShutdownMs: 5000,             // 5 seconds
};

export interface TimeoutResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  timedOut: boolean;
  executionTimeMs: number;
}

export interface ToolTimeoutConfig {
  toolName: string;
  timeoutMs?: number;
  description?: string;
}

/**
 * Get timeout for specific tool type
 */
function getTimeoutForTool(toolName: string, config: TimeoutConfig): number {
  const toolLower = toolName.toLowerCase();

  if (toolLower.includes('shell') || toolLower.includes('exec')) {
    return config.shellTimeoutMs;
  }
  if (toolLower.includes('read') || toolLower.includes('view')) {
    return config.readTimeoutMs;
  }
  if (toolLower.includes('write') || toolLower.includes('edit')) {
    return config.writeTimeoutMs;
  }
  if (toolLower.includes('web') || toolLower.includes('http') || toolLower.includes('fetch')) {
    return config.networkTimeoutMs;
  }

  return config.defaultTimeoutMs;
}

/**
 * Execute function with timeout protection
 *
 * @example
 * ```typescript
 * const result = await executeWithTimeout(
 *   () => shell.exec('long-running-command'),
 *   { toolName: 'shell', timeoutMs: 60000 }
 * );
 * ```
 */
export async function executeWithTimeout<T>(
  operation: () => Promise<T>,
  config: ToolTimeoutConfig
): Promise<T> {
  const fullConfig = { ...DEFAULT_CONFIG };
  const timeoutMs = config.timeoutMs || getTimeoutForTool(config.toolName, fullConfig);

  const startTime = Date.now();
  let timeoutId: NodeJS.Timeout | null = null;
  let isSettled = false;

  return new Promise((resolve, reject) => {
    // Set up timeout
    timeoutId = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      
      const executionTime = Date.now() - startTime;
      log.error(
        {
          toolName: config.toolName,
          timeoutMs,
          executionTimeMs: executionTime,
          description: config.description,
        },
        'Tool execution timed out'
      );

      reject(
        new TimeoutError(
          config.toolName,
          timeoutMs,
          config.description,
          executionTime
        )
      );
    }, timeoutMs);

    // Execute operation
    operation()
      .then(result => {
        if (isSettled) return;
        isSettled = true;
        
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        const executionTime = Date.now() - startTime;

        log.debug(
          {
            toolName: config.toolName,
            executionTimeMs: executionTime,
          },
          'Tool execution completed within timeout'
        );

        resolve(result);
      })
      .catch(error => {
        if (isSettled) return;
        isSettled = true;
        
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        reject(error);
      });
  });
}

/**
 * Execute with timeout and return detailed result
 */
export async function executeWithTimeoutResult<T>(
  operation: () => Promise<T>,
  config: ToolTimeoutConfig
): Promise<TimeoutResult<T>> {
  const startTime = Date.now();

  try {
    const result = await executeWithTimeout(operation, config);
    return {
      success: true,
      result,
      timedOut: false,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const isTimeout = error instanceof TimeoutError;
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      timedOut: isTimeout,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Custom timeout error
 */
export class TimeoutError extends Error {
  public readonly toolName: string;
  public readonly timeoutMs: number;
  public readonly executionTimeMs: number;
  public readonly description?: string;

  constructor(
    toolName: string,
    timeoutMs: number,
    description?: string,
    executionTimeMs: number = timeoutMs
  ) {
    const timeoutSec = Math.round(timeoutMs / 1000);
    const message = description
      ? `Tool '${toolName}' timed out after ${timeoutSec}s: ${description}`
      : `Tool '${toolName}' timed out after ${timeoutSec}s. Consider breaking the operation into smaller steps.`;

    super(message);
    this.name = 'TimeoutError';
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
    this.description = description;
    this.executionTimeMs = executionTimeMs;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimeoutError);
    }
  }

  /**
   * Get user-friendly error message with suggestions
   */
  getUserMessage(): string {
    const suggestions: string[] = [];

    if (this.toolName.toLowerCase().includes('shell')) {
      suggestions.push('Break the command into smaller steps');
      suggestions.push('Add timeouts to individual commands');
      suggestions.push('Check for infinite loops or waiting for input');
    } else if (this.toolName.toLowerCase().includes('read')) {
      suggestions.push('Read the file in smaller chunks');
      suggestions.push('Use grep to find specific content first');
    } else if (this.toolName.toLowerCase().includes('write')) {
      suggestions.push('Write content in smaller batches');
    } else if (this.toolName.toLowerCase().includes('web')) {
      suggestions.push('Check network connectivity');
      suggestions.push('Try again later');
    }

    let message = `⚠️ ${this.message}`;
    if (suggestions.length > 0) {
      message += '\n\nSuggestions:\n' + suggestions.map(s => `• ${s}`).join('\n');
    }

    return message;
  }
}

/**
 * Wrap a function with timeout protection
 */
export function withTimeout<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: Omit<ToolTimeoutConfig, 'description'> & { description?: string | ((...args: Parameters<T>) => string) }
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const description = typeof config.description === 'function'
      ? config.description(...args)
      : config.description;

    return executeWithTimeout(() => fn(...args), {
      toolName: config.toolName,
      timeoutMs: config.timeoutMs,
      description,
    });
  };
}

/**
 * Timeout manager for tracking execution statistics
 */
export class TimeoutManager {
  private config: TimeoutConfig;
  private executions: Array<{
    toolName: string;
    executionTimeMs: number;
    timedOut: boolean;
    timestamp: number;
  }> = [];

  constructor(config: Partial<TimeoutConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute with timeout and track statistics
   */
  async execute<T>(
    operation: () => Promise<T>,
    toolConfig: ToolTimeoutConfig
  ): Promise<T> {
    const startTime = Date.now();
    let timedOut = false;

    try {
      const result = await executeWithTimeout(operation, toolConfig);
      this.executions.push({
        toolName: toolConfig.toolName,
        executionTimeMs: Date.now() - startTime,
        timedOut: false,
        timestamp: Date.now(),
      });
      return result;
    } catch (error) {
      if (error instanceof TimeoutError) {
        timedOut = true;
      }
      this.executions.push({
        toolName: toolConfig.toolName,
        executionTimeMs: Date.now() - startTime,
        timedOut,
        timestamp: Date.now(),
      });
      throw error;
    }
  }

  /**
   * Get execution statistics
   */
  getStats(): {
    totalExecutions: number;
    timeoutCount: number;
    timeoutRate: number;
    averageExecutionTimeMs: number;
    byTool: Record<string, {
      count: number;
      timeouts: number;
      avgExecutionTimeMs: number;
    }>;
  } {
    const byTool: Record<string, { count: number; timeouts: number; totalTime: number }> = {};

    for (const exec of this.executions) {
      if (!byTool[exec.toolName]) {
        byTool[exec.toolName] = { count: 0, timeouts: 0, totalTime: 0 };
      }
      byTool[exec.toolName].count++;
      if (exec.timedOut) {
        byTool[exec.toolName].timeouts++;
      }
      byTool[exec.toolName].totalTime += exec.executionTimeMs;
    }

    const totalExecutions = this.executions.length;
    const timeoutCount = this.executions.filter(e => e.timedOut).length;
    const totalTime = this.executions.reduce((sum, e) => sum + e.executionTimeMs, 0);

    return {
      totalExecutions,
      timeoutCount,
      timeoutRate: totalExecutions > 0 ? timeoutCount / totalExecutions : 0,
      averageExecutionTimeMs: totalExecutions > 0 ? totalTime / totalExecutions : 0,
      byTool: Object.fromEntries(
        Object.entries(byTool).map(([name, stats]) => [
          name,
          {
            count: stats.count,
            timeouts: stats.timeouts,
            avgExecutionTimeMs: stats.count > 0 ? stats.totalTime / stats.count : 0,
          },
        ])
      ),
    };
  }

  /**
   * Clean up old execution records
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    this.executions = this.executions.filter(e => e.timestamp > cutoff);
  }
}

// Convenience exports
export { DEFAULT_CONFIG as DEFAULT_TIMEOUT_CONFIG };

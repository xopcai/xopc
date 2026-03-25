/**
 * Tool Executor - Unified tool execution with timeout and retry
 *
 * Wraps tool execution with:
 * - Timeout protection (prevents hanging)
 * - Retry mechanism (for transient failures)
 * - Error tracking (for reliability)
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { createLogger } from '../../utils/logger.js';
import { executeWithTimeout, TimeoutError } from '../lifecycle/timeout-wrapper.js';
import { withRetry } from '../../infra/retry.js';

const log = createLogger('ToolExecutor');

export interface ToolExecutorConfig {
  // Timeout configuration
  defaultTimeoutMs: number;
  shellTimeoutMs: number;
  readTimeoutMs: number;
  writeTimeoutMs: number;
  networkTimeoutMs: number;
  
  // Retry configuration
  maxRetries: number;
  retryDelayMs: number;
  
  // Enable/disable features
  enableTimeout: boolean;
  enableRetry: boolean;
}

const DEFAULT_CONFIG: ToolExecutorConfig = {
  defaultTimeoutMs: 5 * 60 * 1000,  // 5 minutes
  shellTimeoutMs: 5 * 60 * 1000,    // 5 minutes
  readTimeoutMs: 30 * 1000,         // 30 seconds
  writeTimeoutMs: 60 * 1000,        // 1 minute
  networkTimeoutMs: 60 * 1000,      // 1 minute
  
  maxRetries: 2,
  retryDelayMs: 1000,
  
  enableTimeout: true,
  enableRetry: true,
};

/**
 * Get timeout for specific tool type
 */
function getTimeoutForTool(toolName: string, config: ToolExecutorConfig): number {
  const name = toolName.toLowerCase();
  
  if (name.includes('shell') || name.includes('exec') || name.includes('bash')) {
    return config.shellTimeoutMs;
  }
  if (name.includes('read') || name.includes('view') || name.includes('cat')) {
    return config.readTimeoutMs;
  }
  if (name.includes('write') || name.includes('edit') || name.includes('create')) {
    return config.writeTimeoutMs;
  }
  if (name.includes('web') || name.includes('http') || name.includes('fetch') || name.includes('search')) {
    return config.networkTimeoutMs;
  }
  
  return config.defaultTimeoutMs;
}

/**
 * Execute tool with timeout and retry protection
 */
export async function executeToolWithProtection(
  tool: AgentTool<any, any>,
  toolCallId: string,
  params: any,
  config: Partial<ToolExecutorConfig> = {}
): Promise<AgentToolResult<any>> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const toolName = tool.name;
  
  // Build execution function
  const execute = async (): Promise<AgentToolResult<any>> => {
    try {
      const result = await tool.execute(toolCallId, params);
      return result;
    } catch (error) {
      // Wrap non-error throws
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  };
  
  // Apply timeout if enabled
  let operation = execute;
  if (fullConfig.enableTimeout) {
    const timeoutMs = getTimeoutForTool(toolName, fullConfig);
    const originalExecute = execute;
    
    operation = async () => {
      return executeWithTimeout(
        originalExecute,
        {
          toolName,
          timeoutMs,
          description: `Executing ${toolName}`,
        }
      );
    };
  }
  
  // Apply retry if enabled
  if (fullConfig.enableRetry && fullConfig.maxRetries > 0) {
    const originalOperation = operation;
    
    operation = async () => {
      return withRetry(
        originalOperation,
        {
          attempts: fullConfig.maxRetries + 1,
          minDelayMs: fullConfig.retryDelayMs,
          onRetry: (info) => {
            log.warn(
              { tool: toolName, attempt: info.attempt, delayMs: info.delayMs, error: info.error },
              'Tool execution failed, retrying'
            );
          },
        }
      );
    };
  }
  
  // Execute with error handling
  const startTime = Date.now();
  try {
    const result = await operation();
    const durationMs = Date.now() - startTime;
    
    log.debug(
      { tool: toolName, durationMs, success: true },
      'Tool execution completed'
    );
    
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    
    // Handle timeout error
    if (error instanceof TimeoutError) {
      log.error(
        { tool: toolName, timeoutMs: error.timeoutMs, durationMs },
        'Tool execution timed out'
      );
      
      return {
        content: [
          {
            type: 'text',
            text: error.getUserMessage(),
          },
        ],
        details: {
          exitCode: null,
          timedOut: true,
          truncated: false,
        },
      };
    }
    
    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(
      { tool: toolName, error: errorMessage, durationMs },
      'Tool execution failed'
    );
    
    return {
      content: [
        {
          type: 'text',
          text: `❌ Tool '${toolName}' failed: ${errorMessage}`,
        },
      ],
      details: {
        exitCode: null,
        timedOut: false,
        truncated: false,
        error: errorMessage,
      },
    };
  }
}

/**
 * Create wrapped tool with protection
 */
export function wrapToolWithProtection(
  tool: AgentTool<any, any>,
  config?: Partial<ToolExecutorConfig>
): AgentTool<any, any> {
  return {
    ...tool,
    async execute(toolCallId: string, params: any): Promise<AgentToolResult<any>> {
      return executeToolWithProtection(tool, toolCallId, params, config);
    },
  };
}

/**
 * Wrap all tools with protection
 */
export function wrapToolsWithProtection(
  tools: AgentTool<any, any>[],
  config?: Partial<ToolExecutorConfig>
): AgentTool<any, any>[] {
  return tools.map(tool => wrapToolWithProtection(tool, config));
}

// Export configuration
export { DEFAULT_CONFIG as DEFAULT_TOOL_EXECUTOR_CONFIG };

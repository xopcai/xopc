/**
 * Progress Tracker Plugin - Phase 2 Enhanced Tool Example
 *
 * Demonstrates: EnhancedTool with streaming updates (onUpdate callback)
 *
 * Usage: xopcbot plugin install ./examples/plugins/progress-tracker
 */

import type { PluginApi, EnhancedTool } from 'xopcbot/plugin-sdk';

export default function(api: PluginApi) {
  api.logger.info('Progress Tracker plugin registered!');

  // Enhanced Tool with streaming updates
  const longTaskTool: EnhancedTool<{ steps?: number }> = {
    name: 'long_task',
    description: 'Execute a long-running task with progress updates',
    parameters: {
      type: 'object',
      properties: {
        steps: { type: 'number', description: 'Number of steps (1-10)', default: 5 },
      },
    },
    async execute(toolCallId, params, signal, onUpdate) {
      const stepCount = Math.min(Math.max(params.steps || 5, 1), 10);

      for (let i = 1; i <= stepCount; i++) {
        // Check for cancellation
        if (signal?.aborted) {
          return {
            content: [{ type: 'text', text: `❌ Task cancelled at step ${i}/${stepCount}` }],
            isError: true,
          };
        }

        // Send progress update
        onUpdate?.({
          content: [{ type: 'text', text: `⏳ Step ${i}/${stepCount}...` }],
        });

        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return {
        content: [{ type: 'text', text: `✅ Completed ${stepCount} steps` }],
        details: { completed: true, totalSteps: stepCount }, // Persisted to session
      };
    },
  };

  api.registerTool(longTaskTool as any);

  // Log tool execution lifecycle
  api.registerHook('tool_execution_start', (event) => {
    if ((event as any).toolName === 'long_task') {
      api.logger.info('Long task started');
    }
  });

  api.registerHook('tool_execution_end', (event) => {
    if ((event as any).toolName === 'long_task') {
      api.logger.info(`Long task completed in ${(event as any).durationMs}ms`);
    }
  });
}

// Subagent tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { AgentService } from '../service.js';

const SubagentSchema = Type.Object({
  subagent_name: Type.Optional(Type.String({ description: 'Optional name/identifier for this subagent (for tracking)' })),
  task: Type.String({ description: 'Task description for the subagent to execute (detailed as possible)' }),
});

// Schema for parallel subagents call
const ParallelSubagentSchema = Type.Object({
  tasks: Type.Array(Type.String({ description: 'List of tasks to execute in parallel' })),
  timeout_ms: Type.Optional(Type.Number({ description: 'Timeout per subagent in milliseconds (default: 60000)' })),
});

export function createSubagentTool(agentService: AgentService): AgentTool<typeof SubagentSchema, {}> {
  return {
    name: 'call_subagent',
    description:
      'Invoke a subagent to handle a specific task. ' +
      'The subagent creates a new isolated session and returns the result. ' +
      'Use cases: parallel processing of independent tasks, specialized agents for specific domains, complex task decomposition.',
    parameters: SubagentSchema,
    label: '🤖 Call Subagent',

    async execute(
      toolCallId: string,
      params: Static<typeof SubagentSchema>,
      _signal?: AbortSignal
    ): Promise<AgentToolResult<{}>> {
      const subagentName = params.subagent_name || 'subagent';
      const task = params.task;

      if (!task || task.trim().length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: task parameter cannot be empty' }],
          details: {},
        };
      }

      // Generate unique session key for subagent
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const sessionKey = `subagent:${subagentName}:${timestamp}:${randomId}`;

      try {
        // Execute subagent with new session
        const result = await agentService.processDirect(task, sessionKey);

        return {
          content: [{ type: 'text', text: result }],
          details: {
            sessionKey,
            subagentName,
            timestamp,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Subagent execution failed: ${errorMessage}` }],
          details: {
            sessionKey,
            error: true,
            errorMessage,
          },
        };
      }
    },
  };
}

/**
 * Create a parallel subagents call tool.
 * Executes multiple subagents concurrently and returns all results.
 */
export function createParallelSubagentTool(agentService: AgentService): AgentTool<typeof ParallelSubagentSchema, {}> {
  return {
    name: 'call_subagents',
    description:
      'Invoke multiple subagents in parallel to handle different tasks simultaneously. ' +
      'All tasks execute concurrently for improved efficiency. ' +
      'Use cases: parallel search across multiple data sources, simultaneous content analysis, independent task processing.',
    parameters: ParallelSubagentSchema,
    label: '🚀 Parallel Subagents',

    async execute(
      toolCallId: string,
      params: Static<typeof ParallelSubagentSchema>,
      _signal?: AbortSignal
    ): Promise<AgentToolResult<{}>> {
      const tasks = params.tasks;
      const timeoutMs = params.timeout_ms || 60000;

      if (!tasks || tasks.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: tasks array cannot be empty' }],
          details: {},
        };
      }

      const timestamp = Date.now();
      const results: Array<{ index: number; sessionKey: string; result: string; error?: string }> = [];

      // Execute all subagents concurrently
      const promises = tasks.map(async (task, index) => {
        const randomId = Math.random().toString(36).substring(2, 8);
        const sessionKey = `subagent:parallel:${timestamp}:${index}:${randomId}`;

        try {
          const result = await Promise.race([
            agentService.processDirect(task, sessionKey),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), timeoutMs)
            ),
          ]) as string;

          results.push({
            index,
            sessionKey,
            result,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          results.push({
            index,
            sessionKey,
            result: '',
            error: errorMessage,
          });
        }
      });

      await Promise.all(promises);

      // Sort results by original index
      results.sort((a, b) => a.index - b.index);

      // Format output
      const successful = results.filter(r => !r.error);
      const failed = results.filter(r => r.error);

      let summary = `Parallel execution complete: ${successful.length}/${tasks.length} successful`;
      if (failed.length > 0) {
        summary += `, ${failed.length} failed`;
      }

      const formattedResults = results.map((r, i) => {
        const status = r.error ? '❌' : '✅';
        const label = `Task ${i + 1}`;
        return `${status} ${label}:\n${r.error ? `Error: ${r.error}` : r.result}`;
      }).join('\n\n');

      return {
        content: [{ type: 'text', text: `${summary}\n\n${formattedResults}` }],
        details: {
          total: tasks.length,
          successful: successful.length,
          failed: failed.length,
          results: results,
        },
      };
    },
  };
}

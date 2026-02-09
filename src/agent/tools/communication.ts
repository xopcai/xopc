// Message and spawn tools
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { MessageBus, OutboundMessage } from '../../bus/index.js';

// =============================================================================
// Message Send Tool
// =============================================================================
const MessageSendSchema = Type.Object({
  content: Type.String({ description: 'The message content to send' }),
});

// Context that gets set per message
interface MessageContext {
  channel: string;
  chatId: string;
}

export function createMessageTool(
  bus: MessageBus,
  getContext: () => MessageContext | null
): AgentTool<typeof MessageSendSchema, {} > {
  return {
    name: 'message_send',
    description: 'Send a message to the current conversation.',
    parameters: MessageSendSchema,
    label: '💬 Send Message',

    async execute(
      toolCallId: string,
      params: Static<typeof MessageSendSchema>,
      signal?: AbortSignal
    ): Promise<AgentToolResult<{}>> {
      const ctx = getContext();
      if (!ctx) {
        return {
          content: [{ type: 'text', text: 'Error: No active conversation context' }],
          details: {},
        };
      }

      try {
        const msg: OutboundMessage = {
          channel: ctx.channel,
          chat_id: ctx.chatId,
          content: params.content,
        };

        await bus.publishOutbound(msg);

        return {
          content: [{ type: 'text', text: 'Message sent successfully' }],
          details: {},
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Send error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}

// =============================================================================
// Sessions Spawn Tool
// =============================================================================
const SpawnSchema = Type.Object({
  task: Type.String({ description: 'The task description for the sub-agent' }),
  label: Type.Optional(Type.String({ description: 'Optional label for tracking' })),
});

export interface SubagentResult {
  taskId: string;
  label: string;
  task: string;
  result: string;
  status: 'ok' | 'error';
}

export function createSpawnTool(
  spawnFn: (task: string, label?: string) => Promise<SubagentResult>
): AgentTool<typeof SpawnSchema, SubagentResult > {
  return {
    name: 'sessions_spawn',
    description: 'Spawn a background sub-agent to complete a task. Returns when complete.',
    parameters: SpawnSchema,
    label: '🚀 Spawn Sub-agent',

    async execute(
      toolCallId: string,
      params: Static<typeof SpawnSchema>,
      signal?: AbortSignal
    ): Promise<AgentToolResult<SubagentResult>> {
      try {
        const result = await spawnFn(params.task, params.label);

        const text =
          result.status === 'ok'
            ? `Sub-agent completed successfully:\n${result.result}`
            : `Sub-agent failed:\n${result.result}`;

        return {
          content: [{ type: 'text', text }],
          details: result,
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Spawn error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: {
            taskId: '',
            label: params.label || 'unnamed',
            task: params.task,
            result: String(error),
            status: 'error' as const,
          },
        };
      }
    },
  };
}

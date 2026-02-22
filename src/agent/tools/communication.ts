// Message tool
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { MessageBus, OutboundMessage } from '../../bus/index.js';

const MessageSendSchema = Type.Object({
  content: Type.String({ description: 'The message content to send' }),
  mediaUrl: Type.Optional(Type.String({ description: 'URL of the media to send (photo, video, audio, document)' })),
  mediaType: Type.Optional(Type.Enum({
    photo: 'photo',
    video: 'video',
    audio: 'audio',
    document: 'document',
  }, { description: 'Type of media to send' })),
});

interface MessageContext {
  channel: string;
  chatId: string;
}

export function createMessageTool(
  bus: MessageBus,
  getContext: () => MessageContext | null
): AgentTool<typeof MessageSendSchema, {}> {
  return {
    name: 'send_message',
    description: 'Send a message to the current conversation.',
    parameters: MessageSendSchema,
    label: '💬 Send Message',

    async execute(
      toolCallId: string,
      params: Static<typeof MessageSendSchema>,
      _signal?: AbortSignal
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
          mediaUrl: params.mediaUrl,
          mediaType: params.mediaType as 'photo' | 'video' | 'audio' | 'document' | undefined,
        };

        await bus.publishOutbound(msg);

        const mediaInfo = params.mediaUrl ? ` (with ${params.mediaType || 'media'})` : '';
        return {
          content: [{ type: 'text', text: `Message sent successfully${mediaInfo}` }],
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

import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { MessageBus, OutboundMessage } from '../../bus/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('MessageTool');

const MessageSendSchema = Type.Object({
  content: Type.String({ description: 'The message content to send' }),
  mediaUrl: Type.Optional(Type.String({ description: 'URL of the media to send' })),
  mediaType: Type.Optional(Type.Enum({
    photo: 'photo',
    video: 'video',
    audio: 'audio',
    document: 'document',
  }, { description: 'Type of media to send' })),
  replyTo: Type.Optional(Type.String({ description: 'Message ID to reply to' })),
  quoteText: Type.Optional(Type.String({ description: 'Quote text for reply' })),
  buffer: Type.Optional(Type.String({ description: 'Base64 encoded file content' })),
  filename: Type.Optional(Type.String({ description: 'Filename for buffer attachment' })),
  contentType: Type.Optional(Type.String({ description: 'MIME type for buffer attachment' })),
  silent: Type.Optional(Type.Boolean({ description: 'Send message silently' })),
  spoiler: Type.Optional(Type.Boolean({ description: 'Mark media as spoiler' })),
  buttons: Type.Optional(Type.Array(
    Type.Array(Type.Object({
      text: Type.String(),
      callback_data: Type.String(),
    })),
    { description: 'Telegram inline keyboard buttons' }
  )),
});

interface MessageContext {
  channel: string;
  chatId: string;
}

/**
 * Create the send_message tool.
 *
 * NOTE: TTS (Text-to-Speech) is NOT handled by this tool.
 * TTS is applied at the dispatch layer via maybeApplyTtsToPayload(), not at the tool layer.
 *
 * This prevents duplicate messages (text + voice) being sent.
 */
export function createMessageTool(
  bus: MessageBus,
  getContext: () => MessageContext | null,
): AgentTool<typeof MessageSendSchema, {}> {
  return {
    name: 'send_message',
    description: `Send a message to the user.

TTS (Text-to-Speech) is handled automatically by the system based on configuration:
- trigger=off: Never use voice
- trigger=always: Always use voice
- trigger=inbound: Only reply to voice messages with voice
- trigger=tagged: Only use voice when [[tts]] directive is present

You do NOT need to manage TTS - just send the message normally.`,

    parameters: MessageSendSchema,
    label: '💬 Send Message',

    async execute(
      _toolCallId: string,
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
          replyToMessageId: params.replyTo,
          quoteText: params.quoteText,
          silent: params.silent,
          spoiler: params.spoiler,
          buttons: params.buttons,
        };

        await bus.publishOutbound(msg);

        const mediaInfo = params.mediaUrl ? ` + ${params.mediaType || 'media'}` : '';
        const replyInfo = params.replyTo ? ' (as reply)' : '';

        return {
          content: [{ type: 'text', text: `✅ Message sent${mediaInfo}${replyInfo}` }],
          details: {},
        };
      } catch (error) {
        log.error({ error }, 'Error sending message');
        return {
          content: [{ type: 'text', text: `❌ Send error: ${error instanceof Error ? error.message : String(error)}` }],
          details: {},
        };
      }
    },
  };
}

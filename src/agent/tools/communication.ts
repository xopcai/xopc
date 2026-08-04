import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { MessageBus, OutboundMessage } from '../../infra/bus/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('MessageTool');

const MessageSendSchema = Type.Object({
  content: Type.String({ description: 'The message content to send' }),
  channel: Type.Optional(Type.String({
    description: 'Configured destination channel (for example weixin or telegram). Defaults to the current channel.',
  })),
  chat_id: Type.Optional(Type.String({
    description: 'Destination chat/peer id. Required when channel is provided.',
  })),
  accountId: Type.Optional(Type.String({
    description: 'Optional account id for a multi-account destination channel.',
  })),
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

type MessageSendParams = {
  content: string;
  channel?: string;
  chat_id?: string;
  accountId?: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video' | 'audio' | 'document';
  replyTo?: string;
  quoteText?: string;
  buffer?: string;
  filename?: string;
  contentType?: string;
  silent?: boolean;
  spoiler?: boolean;
  buttons?: Array<Array<{ text: string; callback_data: string }>>;
};

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
): AgentTool {
  return {
    name: 'send_message',
    description: `Send a message to the current conversation or an explicit configured channel.

For a proactive cross-channel send, provide both \`channel\` and \`chat_id\` (for example \`channel: "weixin"\`). Use \`accountId\` when the destination has multiple configured accounts. Omit destination fields to reply to the current conversation.

TTS (Text-to-Speech) is handled automatically by the system based on configuration:
- trigger=off: Never use voice
- trigger=always: Always use voice
- trigger=inbound: Only reply to voice messages with voice
- trigger=tagged: Only use voice when [[tts]] directive is present

When TTS is enabled, you may also use the \`text_to_speech\` tool to send a standalone voice message (e.g. read-aloud). Prefer \`send_message\` for normal replies; use \`text_to_speech\` only when voice is explicitly appropriate.`,

    parameters: MessageSendSchema,
    label: '💬 Send Message',

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const p = params as MessageSendParams;
      const ctx = getContext();
      const requestedChannel = p.channel?.trim();
      const requestedChatId = p.chat_id?.trim();
      if (Boolean(requestedChannel) !== Boolean(requestedChatId)) {
        return {
          content: [{ type: 'text', text: 'Error: channel and chat_id must be provided together' }],
          details: {},
        };
      }
      if (!ctx && (!requestedChannel || !requestedChatId)) {
        return {
          content: [{ type: 'text', text: 'Error: No active conversation context' }],
          details: {},
        };
      }

      const channel = requestedChannel || ctx!.channel;
      const chatId = requestedChatId || ctx!.chatId;
      const accountId = p.accountId?.trim();

      try {
        const msg: OutboundMessage = {
          channel,
          chat_id: chatId,
          content: p.content,
          ...(accountId ? { metadata: { accountId } } : {}),
          mediaUrl: p.mediaUrl,
          mediaType: p.mediaType,
          replyToMessageId: p.replyTo,
          quoteText: p.quoteText,
          silent: p.silent,
          spoiler: p.spoiler,
          buttons: p.buttons,
        };

        await bus.publishOutbound(msg);

        const mediaInfo = p.mediaUrl ? ` + ${p.mediaType || 'media'}` : '';
        const replyInfo = p.replyTo ? ' (as reply)' : '';

        return {
          content: [{ type: 'text', text: `✅ Message sent${mediaInfo}${replyInfo}` }],
          details: {},
        };
      } catch (error) {
        const em = error instanceof Error ? error.message : String(error);
        log.error(
          {
            err: error,
            errorMessage: em,
            channel,
            chatId,
            contentPreview: String(p.content ?? '').slice(0, 100),
          },
          `send_message: outbound publish failed (${channel}/${chatId}): ${em}`,
        );
        return {
          content: [{ type: 'text', text: `❌ Send error: ${error instanceof Error ? error.message : String(error)}` }],
          details: {},
        };
      }
    },
  } as any;
}

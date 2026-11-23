import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { MessageBus, OutboundMessage } from '../../infra/bus/index.js';
import { isExternalMessagingChannel } from '../../channels/internal-outbound.js';
import type { CrossChannelTargetResolution } from '../../channels/outbound-targets.js';
import { createLogger } from '../../utils/logger.js';
import { buildOutboundMediaMetadata } from './tool-media.js';

const log = createLogger('MessageTool');

const MessageSendSchema = Type.Object({
  content: Type.String({ description: 'The message content to send' }),
  channel: Type.Optional(Type.String({
    description: 'Configured destination channel (for example weixin or telegram). Defaults to the current channel.',
  })),
  chat_id: Type.Optional(Type.String({
    description: 'Destination chat/peer id. Optional in an authorized owner conversation when the destination channel has a single deliverable recipient (such as your paired Weixin chat); required when multiple recipients exist or outside owner conversations.',
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
  metadata?: Record<string, unknown>;
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

export interface MessageToolOptions {
  /** Resolve an unambiguous default recipient when `channel` is given without `chat_id`. */
  resolveDefaultTarget?: (params: {
    channel: string;
    accountId?: string;
  }) => Promise<CrossChannelTargetResolution>;
  /** Authorizes default recipient lookup (authenticated owner endpoint or local CLI). */
  canResolveDefaultTarget?: () => boolean;
  /** Direct verified delivery for proactive external-channel sends (surfaces channel errors). */
  deliverOutbound?: (msg: OutboundMessage) => Promise<void>;
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
  options?: MessageToolOptions,
): AgentTool {
  return {
    name: 'send_message',
    description: `Send a message to the current conversation or an explicit configured channel.

For a proactive cross-channel send, provide \`channel\` (for example \`channel: "weixin"\`). Provide \`chat_id\` when targeting a specific peer, or omit \`chat_id\` in an authorized owner conversation to automatically target the channel's single deliverable recipient (such as your paired Weixin chat). Use \`accountId\` when the destination has multiple configured accounts. Omit all destination fields to reply to the current conversation.

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
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      const p = params as MessageSendParams;
      const ctx = getContext();
      const requestedChannel = p.channel?.trim();
      const requestedChatId = p.chat_id?.trim();
      const requestedAccountId = p.accountId?.trim();

      if (!requestedChannel && requestedChatId) {
        return {
          content: [{ type: 'text', text: 'Error: channel and chat_id must be provided together' }],
          details: {},
        };
      }

      let resolvedChannel = requestedChannel;
      let resolvedChatId = requestedChatId;
      let resolvedAccountId = requestedAccountId;

      if (requestedChannel && !requestedChatId) {
        if (!options?.resolveDefaultTarget) {
          return {
            content: [{ type: 'text', text: 'Error: channel and chat_id must be provided together' }],
            details: {},
          };
        }
        if (options.canResolveDefaultTarget && options.canResolveDefaultTarget() !== true) {
          return {
            content: [{
              type: 'text',
              text: 'Error: channel and chat_id must be provided together (automatic default recipient lookup requires an authorized owner conversation)',
            }],
            details: { ok: false, reason: 'unauthorized' },
          };
        }
        const target = await options.resolveDefaultTarget({
          channel: requestedChannel,
          accountId: requestedAccountId,
        });
        if (target.ok === false) {
          return {
            content: [{ type: 'text', text: `Error: ${target.message}` }],
            details: {
              ok: false,
              reason: target.reason,
              ...(target.candidates ? { candidates: target.candidates } : {}),
            },
          };
        }
        resolvedChannel = target.channel;
        resolvedChatId = target.chatId;
        resolvedAccountId = requestedAccountId || target.accountId;
      }

      if (!ctx && (!resolvedChannel || !resolvedChatId)) {
        return {
          content: [{ type: 'text', text: 'Error: No active conversation context' }],
          details: {},
        };
      }

      const channel = resolvedChannel || ctx!.channel;
      const chatId = resolvedChatId || ctx!.chatId;
      const accountId = resolvedAccountId;
      const mediaUrl = p.mediaUrl?.trim()
        || (p.buffer ? `data:${p.contentType?.trim() || 'application/octet-stream'};base64,${p.buffer}` : undefined);
      const baseMeta = !requestedChannel ? ctx?.metadata : undefined;
      const metadata = buildOutboundMediaMetadata(
        accountId ? { ...baseMeta, accountId } : baseMeta,
        p.filename?.trim() || undefined,
      );

      try {
        const msg: OutboundMessage = {
          channel,
          chat_id: chatId,
          content: p.content,
          ...(metadata ? { metadata } : {}),
          mediaUrl,
          mediaType: p.mediaType,
          replyToMessageId: p.replyTo,
          quoteText: p.quoteText,
          silent: p.silent,
          spoiler: p.spoiler,
          buttons: p.buttons,
        };

        if (requestedChannel && isExternalMessagingChannel(channel) && options?.deliverOutbound) {
          await options.deliverOutbound(msg);
        } else {
          await bus.publishOutbound(msg);
        }

        const mediaInfo = mediaUrl ? ` + ${p.mediaType || 'media'}` : '';
        const replyInfo = p.replyTo ? ' (as reply)' : '';
        const targetInfo = requestedChannel ? ` to ${channel} (${chatId})` : '';

        return {
          content: [{ type: 'text', text: `✅ Message sent${targetInfo}${mediaInfo}${replyInfo}` }],
          details: requestedChannel
            ? { ok: true, channel, chatId, ...(accountId ? { accountId } : {}) }
            : {},
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
          `send_message: outbound delivery failed (${channel}/${chatId}): ${em}`,
        );
        return {
          content: [{ type: 'text', text: `❌ Send error: ${em}` }],
          details: { ok: false, error: em },
        };
      }
    },
  } as any;
}

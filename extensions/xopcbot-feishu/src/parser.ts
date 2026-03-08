/**
 * Feishu Message Parser
 */

import { parsePostContent } from './media.js';
import type { FeishuMessageEvent, FeishuMessageContext } from './types.js';

/**
 * Parse message content based on type
 */
export function parseMessageContent(content: string, messageType: string): string {
  try {
    const parsed = JSON.parse(content);

    if (messageType === 'text') {
      return parsed.text || '';
    }

    if (messageType === 'post') {
      const { textContent } = parsePostContent(content);
      return textContent;
    }

    if (messageType === 'image') {
      return '[图片]';
    }

    if (messageType === 'file') {
      return `[文件: ${parsed.file_name || '未知'}]`;
    }

    if (messageType === 'audio') {
      return '[语音]';
    }

    if (messageType === 'video') {
      return '[视频]';
    }

    if (messageType === 'sticker') {
      return '[表情]';
    }

    return content;
  } catch {
    return content;
  }
}

/**
 * Check if bot is mentioned in message
 */
export function checkBotMentioned(
  event: FeishuMessageEvent,
  botOpenId?: string
): boolean {
  const mentions = event.message.mentions ?? [];
  if (mentions.length === 0) return false;
  if (!botOpenId) return mentions.length > 0;

  return mentions.some((m) => m.id.open_id === botOpenId);
}

/**
 * Strip bot mention from text
 */
export function stripBotMention(
  text: string,
  mentions?: FeishuMessageEvent['message']['mentions']
): string {
  if (!mentions || mentions.length === 0) return text;

  let result = text;
  for (const mention of mentions) {
    // Remove @name
    result = result.replace(new RegExp(`@${mention.name}\\s*`, 'g'), '').trim();
    // Remove mention key
    result = result.replace(new RegExp(mention.key, 'g'), '').trim();
  }

  return result;
}

/**
 * Parse Feishu message event into internal context
 */
export function parseMessageEvent(
  event: FeishuMessageEvent,
  botOpenId?: string
): FeishuMessageContext {
  const rawContent = parseMessageContent(
    event.message.content,
    event.message.message_type
  );
  const mentionedBot = checkBotMentioned(event, botOpenId);
  const content = stripBotMention(rawContent, event.message.mentions);

  return {
    chatId: event.message.chat_id,
    messageId: event.message.message_id,
    senderId: event.sender.sender_id.user_id || event.sender.sender_id.open_id || '',
    senderOpenId: event.sender.sender_id.open_id || '',
    chatType: event.message.chat_type,
    mentionedBot,
    rootId: event.message.root_id || undefined,
    parentId: event.message.parent_id || undefined,
    content,
    contentType: event.message.message_type,
  };
}

/**
 * Build session key for routing
 */
export function buildSessionKey(params: {
  chatType: 'p2p' | 'group';
  chatId: string;
  senderOpenId: string;
  rootId?: string;
  useTopicSession?: boolean;
}): string {
  const { chatType, chatId, senderOpenId, rootId, useTopicSession } = params;

  if (chatType === 'p2p') {
    // DM: session per user
    return `feishu:dm:${senderOpenId}`;
  }

  // Group chat
  if (useTopicSession && rootId) {
    // Topic/thread session
    return `feishu:group:${chatId}:topic:${rootId}`;
  }

  // Default group session
  return `feishu:group:${chatId}`;
}

/**
 * Build agent ID for routing
 */
export function buildAgentId(params: {
  chatType: 'p2p' | 'group';
  senderOpenId: string;
  defaultAgentId: string;
}): string {
  const { chatType, senderOpenId, defaultAgentId } = params;

  if (chatType === 'p2p') {
    // Can create per-user agents here if needed
    return defaultAgentId;
  }

  return defaultAgentId;
}

/**
 * Feishu Plugin Types
 */

export type FeishuDomain = 'feishu' | 'lark';

export type FeishuMessageType = 'text' | 'image' | 'file' | 'post' | 'audio' | 'video' | 'sticker';

export interface FeishuConfig {
  enabled?: boolean;
  appId: string;
  appSecret: string;
  domain?: FeishuDomain;
  dmPolicy?: 'open' | 'pairing' | 'allowlist';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  groupAllowFrom?: string[];
  requireMention?: boolean;
  mediaMaxMb?: number;
}

export interface FeishuMessageEvent {
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    chat_id: string;
    chat_type: 'p2p' | 'group';
    message_type: FeishuMessageType;
    content: string;
    mentions?: Array<{
      key: string;
      id: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
      name: string;
      tenant_key?: string;
    }>;
  };
}

export interface FeishuMessageContext {
  chatId: string;
  messageId: string;
  senderId: string;
  senderOpenId: string;
  senderName?: string;
  chatType: 'p2p' | 'group';
  mentionedBot: boolean;
  rootId?: string;
  parentId?: string;
  content: string;
  contentType: FeishuMessageType;
}

export interface FeishuMediaInfo {
  path: string;
  contentType?: string;
  placeholder: string;
}

export interface FeishuSessionRoute {
  sessionKey: string;
  agentId: string;
  accountId: string;
}

// Message deduplication
const processedMessageIds = new Map<string, number>();
const DEDUP_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEDUP_MAX_SIZE = 1000;
let lastCleanupTime = Date.now();

export function tryRecordMessage(accountId: string, messageId: string): boolean {
  const now = Date.now();
  const dedupKey = `${accountId}:${messageId}`;

  // Cleanup expired entries every 5 minutes
  if (now - lastCleanupTime > 5 * 60 * 1000) {
    for (const [id, ts] of processedMessageIds) {
      if (now - ts > DEDUP_TTL_MS) processedMessageIds.delete(id);
    }
    lastCleanupTime = now;
  }

  if (processedMessageIds.has(dedupKey)) return false;

  // Evict oldest if cache is full
  if (processedMessageIds.size >= DEDUP_MAX_SIZE) {
    const first = processedMessageIds.keys().next().value!;
    processedMessageIds.delete(first);
  }

  processedMessageIds.set(dedupKey, now);
  return true;
}

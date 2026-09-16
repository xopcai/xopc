import { existsSync, readFileSync } from 'node:fs';

import { decodeStoredConversationKey } from '../storage/sqlite/migrations/conversation-key-decoder.js';
import type { Migration, MigrationContext, MigrationPlanItem } from './types.js';

const id = 'conversation-uuid-delivery-config';

function convertedConfig(ctx: MigrationContext): Record<string, unknown> | null {
  if (!existsSync(ctx.configPath)) return null;
  const config = JSON.parse(readFileSync(ctx.configPath, 'utf8'));
  const heartbeat = config.gateway?.heartbeat;
  const target = heartbeat?.targetChatId;
  if (typeof target !== 'string' || !target.trim().startsWith('agent:')) return null;
  const key = target.trim();
  const route = decodeStoredConversationKey(key, key.split(':')[1]!);
  if (!['telegram', 'weixin'].includes(route.channel) || route.channel !== heartbeat.target) {
    throw new Error('Cannot migrate heartbeat delivery: channel and stored conversation route disagree');
  }
  // Native channel addresses work before and after the database cutover, so a
  // database rollback never leaves the configuration pointing at an uncommitted UUID.
  heartbeat.targetChatId = route.channel === 'weixin'
    ? `${route.accountId || 'default'}:direct:${route.peerId}` : route.peerId;
  return config;
}

function item(status: MigrationPlanItem['status']): MigrationPlanItem {
  return { id, title: 'Conversation UUID delivery configuration', kind: 'config', safety: 'auto', status,
    message: 'Store the native channel delivery address independently of conversation identity.' };
}

export const conversationRoutingConfigMigration: Migration = {
  id, kind: 'config', safety: 'auto',
  detect: ctx => convertedConfig(ctx) ? item('planned') : null,
  apply: ctx => {
    const config = convertedConfig(ctx);
    return config ? { ...item('applied'), details: { config } } : item('not_needed');
  },
};

import { randomUUID } from 'node:crypto';

import { validateConversationId } from '@xopcai/gateway-contract';

import { conversationRouteKey, resolveConversationRoute, type ConversationRouteInput } from '../../routing/conversation-route.js';
import type { SessionMetadata, SessionRoutingMeta } from '../../session/types.js';
import { requireXopcDatabase } from './connection.js';
import { ensureSessionInTransaction, getSessionMetadata } from './session-repository.js';
import type { SessionMetadataSeed } from './session-metadata.js';
import { runSqliteWriteTransaction } from './transaction.js';

export class ConversationAlreadyExistsError extends Error {}

export function createConversation(input: SessionMetadataSeed & { agentId: string }, cwd = '', conversationId: string = randomUUID()): SessionMetadata {
  requireXopcDatabase();
  return runSqliteWriteTransaction(db => {
    const id = validateConversationId(conversationId);
    if (getSessionMetadata(id)) throw new ConversationAlreadyExistsError(`Conversation already exists: ${id}`);
    return ensureSessionInTransaction(db, id, cwd, input);
  });
}

export function requireConversation(conversationId: string): SessionMetadata {
  const id = validateConversationId(conversationId);
  requireXopcDatabase();
  const metadata = getSessionMetadata(id);
  if (!metadata) throw new Error(`Conversation not found: ${id}`);
  return metadata;
}

export function getConversationRouting(conversationId: string | null | undefined): SessionRoutingMeta | null {
  if (!conversationId) return null;
  const conversation = requireConversation(conversationId);
  return {
    source: conversation.sourceChannel,
    accountId: 'default',
    peerKind: 'direct',
    peerId: conversation.sourceChatId,
    ...conversation.routing,
    agentId: conversation.agentId,
  };
}

/** Resolves an external route and creates its conversation atomically when absent. */
export function resolveRoutedConversation(input: ConversationRouteInput, seed: SessionMetadataSeed = {}): string {
  const route = resolveConversationRoute(input);
  const lookup = conversationRouteKey(route);
  requireXopcDatabase();
  return runSqliteWriteTransaction(db => {
    const existing = db.prepare('SELECT conversation_id FROM conversation_routes WHERE route_key=?').get(lookup) as { conversation_id: string } | undefined;
    if (existing) return existing.conversation_id;
    const id = randomUUID();
    ensureSessionInTransaction(db, id, '', {
      ...seed,
      agentId: route.agentId,
      sourceChannel: input.source,
      sourceChatId: input.peerId,
      routing: {
        agentId: route.agentId, source: input.source, accountId: input.accountId ?? 'default',
        peerKind: input.peerKind === 'dm' ? 'direct' : input.peerKind, peerId: input.peerId,
        threadId: input.threadId ?? undefined, scopeId: input.scopeId ?? undefined,
      },
    });
    db.prepare('INSERT INTO conversation_routes(route_key,conversation_id) VALUES (?,?)').run(lookup, id);
    return id;
  });
}

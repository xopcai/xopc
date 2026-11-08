import type { Config } from '../config/schema.js';
import type { CaptureScopeContext } from '../user-model/capture/executor.js';
import { canonicalWorkspacePath } from '../projects/workspace-project.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { getSessionConfig } from '../storage/sqlite/config-repository.js';
import { getConversationRouting } from '../routing/session-key.js';
import { resolveUserContextSessionAccess } from '../user-context/access-policy.js';
import { isOwnerIdentity } from '../user-context/identity-bindings.js';
import { OWNER_LEARNING_SESSION_SQL } from '../memory-learning/transcript-source.js';

/** History tools and automatic recall share the same host-owned source boundary. */
export function canRecallConversation(config: Config | undefined, context: CaptureScopeContext, conversationId: string): boolean {
  if (!config || !resolveUserContextSessionAccess(config, context.conversationId).crossSessionHistory) return false;
  const row = getSqliteDatabase().prepare(`SELECT s.agent_id, s.project_id, t.cwd FROM sessions s
    JOIN transcripts t ON t.transcript_id = s.active_transcript_id
    WHERE s.conversation_id = ? AND ${OWNER_LEARNING_SESSION_SQL}`).get(conversationId) as { agent_id: string; project_id: string | null; cwd: string } | undefined;
  if (!row || row.agent_id !== context.agentId || (row.project_id ?? '') !== (context.projectId ?? '')) return false;
  if (canonicalWorkspacePath(row.cwd) !== canonicalWorkspacePath(context.workspaceId)) return false;
  const cwd = getSessionConfig(conversationId)?.workingDirectoryOverride;
  if (cwd && canonicalWorkspacePath(cwd) !== canonicalWorkspacePath(context.workspaceId)) return false;
  if (conversationId !== context.conversationId) {
    // Withhold mixed-scope originals as a whole: titles and assistant echoes have no field lineage.
    if (!canRecallHistoryEntry(context, conversationId, null, '')) return false;
    const narrow = getSqliteDatabase().prepare(`SELECT 1 FROM transcript_fts f JOIN transcript_entries e ON e.entry_id = f.entry_id
      WHERE f.conversation_id = ? AND e.role = 'user' AND
        (f.content LIKE '%仅%当前会话%' OR f.content LIKE '%只%当前会话%' OR f.content LIKE '%仅%本次会话%'
         OR lower(f.content) LIKE '%only%this%chat%' OR lower(f.content) LIKE '%only%this%session%') LIMIT 1`).get(conversationId);
    if (narrow) return false;
  }
  const route = getConversationRouting(conversationId);
  return route?.peerKind === 'direct' && isOwnerIdentity(route)
    && resolveUserContextSessionAccess(config, conversationId).crossSessionHistory;
}

/** Reading raw evidence cannot widen the scope of its associated saved fact. */
export function canRecallHistoryEntry(context: CaptureScopeContext, conversationId: string, entryId: string | null, text: string): boolean {
  if (conversationId !== context.conversationId && /仅.{0,8}(?:当前|本次|这个)(?:会话|对话)|只.{0,8}(?:当前|本次|这个)(?:会话|对话)/u.test(text)) return false;
  const scopes = getSqliteDatabase().prepare(`SELECT s.scope_type, s.scope_id FROM context_evidence e
    JOIN user_assertion_evidence l ON l.evidence_id = e.evidence_id
    JOIN user_assertions a ON a.assertion_id = l.assertion_id JOIN user_assertion_slots s ON s.slot_id = a.slot_id
    WHERE e.conversation_id = ? AND (? IS NULL OR e.message_id = ?)
    UNION ALL SELECT k.scope_type, k.scope_id FROM context_evidence e
    JOIN knowledge_evidence_links l ON l.evidence_id = e.evidence_id JOIN knowledge_items k ON k.knowledge_id = l.knowledge_id
    WHERE e.conversation_id = ? AND (? IS NULL OR e.message_id = ?)`).all(conversationId, entryId, entryId, conversationId, entryId, entryId) as Array<{ scope_type: string; scope_id: string | null }>;
  return scopes.every(scope => scope.scope_type === 'global' || (scope.scope_type === 'workspace' && scope.scope_id
    ? canonicalWorkspacePath(scope.scope_id) === canonicalWorkspacePath(context.workspaceId)
    : Boolean(scope.scope_id && scope.scope_id === ({ agent: context.agentId, project: context.projectId, session: context.conversationId } as Record<string, string | undefined>)[scope.scope_type])));
}

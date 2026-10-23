import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import { listCollaborationRules } from '../storage/sqlite/collaboration-rule-repository.js';
import { memoryFingerprint, isMemorySuppressed } from '../user-context/memory-suppression.js';
import { USER_MODEL_PRINCIPAL_ID } from '../user-model/domain.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import type { CaptureScopeContext } from '../user-model/capture/executor.js';

/** A later source-specific read request does not authorize saving forgotten facts again. */
export function explicitlyReadsOriginalHistory(text: string): boolean {
  if (/(?:引文|引用|改写|措辞|不是要|quoted|rephrase)/iu.test(text)) return false;
  if (/(?:不要|别|不必|禁止)\s*(?:再|去|从[^。；;，,！？\n]{0,40})?(?:恢复|查阅|查出|读取|找回|查)|(?:do not|don't)\s+(?:read|look|recover|retrieve|restore)/iu.test(text)) return false;
  const source = /(?:原始|旧|先前|过去).{0,8}(?:记录|对话|原文)|(?:original|old|previous|past).{0,20}(?:record|conversation|transcript|history)/iu;
  const request = /(?:^|\n)\s*(?:(?:请|麻烦|本次|这次|现在|please|this time)[，,\s]*){0,3}[^。\n！？]{0,150}(?:恢复|查阅|查出|读取|找回|read|look up|retrieve|recover|restore)/iu;
  return source.test(text) && request.test(text);
}

function matchesOriginalRead(rule: ReturnType<typeof listCollaborationRules>[number], userText: string): boolean {
  const binding = rule.conditions.reread as { subject?: unknown; property?: unknown } | undefined;
  const property = binding?.property === 'date_time' ? /日期|时间|哪天|哪日|几点|日程|\b(?:date|time|when|schedule)\b/iu
      : binding?.property === 'price' ? /票价|报价|价格|总价|金额|费用|花费|价钱|\b(?:price|cost|amount)\b/iu : undefined;
  // Bind permission to the actual requested clause; unrelated reads and negative clauses cannot reveal it.
  return Boolean(typeof binding?.subject === 'string' && binding.subject.length > 0 && property
      && explicitlyReadsOriginalHistory(userText)
      && userText.split(/[。；;，,!?！？\n]/u).some(clause => explicitlyReadsOriginalHistory(clause)
        && clause.normalize('NFKC').toLowerCase().includes((binding.subject as string).normalize('NFKC').toLowerCase())
        && property.test(clause)));
}

function ruleVisible(rule: ReturnType<typeof listCollaborationRules>[number], context: CaptureScopeContext): boolean {
  return rule.status === 'active' && rule.category === 'boundary' && Array.isArray(rule.conditions.forgottenHistoryEntries)
    && (rule.scope.type === 'global' || rule.scope.id === ({ agent: context.agentId,
      workspace: context.workspaceId, project: context.projectId, session: context.conversationId } as Record<string, string | undefined>)[rule.scope.type]);
}

/** A value-free, per-request notice makes legitimate original reads distinguishable from automatic recall. */
export function originalReadAuthorizationNotice(context: CaptureScopeContext, userText = ''): string {
  if (!isXopcDatabaseOpen()) return '';
  const grants = listCollaborationRules().filter(rule => ruleVisible(rule, context) && matchesOriginalRead(rule, userText))
    .map(rule => {
      const { subject, property } = rule.conditions.reread as { subject: string; property: string };
      return { subject, property };
    });
  return grants.length ? 'The current author request matches a scoped original-record re-read exception for ONLY the following subject and field: '
    + JSON.stringify(grants) + '. The derived fact remains forgotten. Use session_search for original records in other conversations, or session_recall for this conversation. '
    + 'Missing active memory does not establish that authorized originals are unavailable. All source access checks still apply. '
    + 'Read only for this turn; do not infer missing values or save the recalled fact again.' : '';
}

export function forgottenHistoryEntries(context: CaptureScopeContext, userText = ''): Set<string> {
  if (!isXopcDatabaseOpen()) return new Set();
  const entries = new Set<string>();
  for (const rule of listCollaborationRules()) {
    const originalEntries = rule.conditions.forgottenHistoryEntries;
    if (!ruleVisible(rule, context) || !Array.isArray(originalEntries)) continue;
    const authorized = matchesOriginalRead(rule, userText);
    const db = getSqliteDatabase();
    if (authorized) {
      // Persist disclosure lineage, not recalled values. Later turns do not inherit this grant.
      if (context.conversationId) db.prepare(`UPDATE sessions SET custom_data_json = json_set(
        CASE WHEN json_valid(custom_data_json) THEN custom_data_json ELSE '{}' END,
        '$._forgottenReadRules', json_insert(COALESCE(json_extract(custom_data_json, '$._forgottenReadRules'), '[]'), '$[#]', ?))
        WHERE conversation_id = ? AND NOT EXISTS (
          SELECT 1 FROM json_each(COALESCE(json_extract(custom_data_json, '$._forgottenReadRules'), '[]')) WHERE value = ?)`)
        .run(rule.id, context.conversationId, rule.id);
      continue;
    }
    for (const entry of originalEntries) {
      if (typeof entry === 'string') entries.add(entry);
    }
    const copies = db.prepare(`SELECT conversation_id FROM sessions, json_each(
      CASE WHEN json_valid(custom_data_json) THEN COALESCE(json_extract(custom_data_json, '$._forgottenReadRules'), '[]') ELSE '[]' END)
      WHERE value = ?`).all(rule.id) as Array<{ conversation_id: string }>;
    for (const copy of copies) entries.add(`${copy.conversation_id}:*`);
  }
  return entries;
}

/** Project provenance for model consumption without changing the retained audit source. */
export function projectForgottenEvidence<T>(source: T, context: CaptureScopeContext, userText = '', provenanceRefs: string[] = []): T {
  const protectedEntries = forgottenHistoryEntries(context, userText);
  if (!protectedEntries.size || source === undefined || source === null) return source;
  const blocked = new Set<string>();
  const db = getSqliteDatabase();
  for (const key of protectedEntries) {
    const split = key.indexOf(':');
    const conversation = key.slice(0, split), entry = key.slice(split + 1);
    blocked.add(conversation);
    if (entry !== '*') blocked.add(entry);
    const rows = db.prepare(`SELECT evidence_id, message_id FROM context_evidence WHERE conversation_id = ?
      AND (? = '*' OR message_id = ?)`).all(conversation, entry, entry) as Array<{ evidence_id: string; message_id: string | null }>;
    for (const row of rows) { blocked.add(row.evidence_id); if (row.message_id) blocked.add(row.message_id); }
  }
  const encoded = JSON.stringify([source, provenanceRefs]);
  return encoded && [...blocked].some(ref => encoded.includes(ref))
    ? { withheld: true, scope: 'source_excerpt_only',
      reason: 'The original evidence excerpt is withheld because it also contains a forgotten field. This redacts provenance text only; it does not retract the separately returned active fact or change its status or scope. Do not reconstruct the hidden values.' } as T : source;
}

/** Remove earlier materialized reads from active history, retaining this turn and system context. */
export function projectForgottenHistoryMessages<T extends { role: string }>(messages: T[], context: CaptureScopeContext, userText = ''): T[] {
  const blocked = forgottenHistoryEntries(context, userText);
  if (!blocked.has(`${context.conversationId}:*`)) return messages;
  const latestUser = messages.findLastIndex(message => message.role === 'user');
  return latestUser < 0 ? messages.filter(message => message.role === 'system')
    : messages.filter((message, index) => message.role === 'system' || index >= latestUser);
}

export const FORGOTTEN_HISTORY_EXCERPT = '[This entry supported information the user asked to forget. Automatic recall is withheld. A later explicit request to re-read original records is required; do not infer the hidden values.]';

/** Recheck rendered memory snapshots at dispatch; deleted facts cannot survive in a cached prompt. */
export function projectSuppressedMemoryBlocks(text: string, context: CaptureScopeContext): string {
  if (!isXopcDatabaseOpen() || !text.includes('<user-context>')) return text;
  const db = getSqliteDatabase();
  const scopes = [{ type: 'global', id: '' }, { type: 'agent', id: context.agentId },
    { type: 'workspace', id: context.workspaceId }, { type: 'project', id: context.projectId },
    { type: 'session', id: context.conversationId }].filter(scope => scope.id !== undefined);
  return text.replace(/<user-context>[\s\S]*?<\/user-context>/gu, block => block.replace(
    /^- (.+(?:\n(?!- |\s*$).+)*)/gmu, (item, content: string) => {
      const claim = content.replace(/ \[source report [^\]]+\]$/u, '').replace(/ \(confidence [\d.]+\)$/u, '');
      const keys = scopes.flatMap(scope => ['knowledge-content', 'assertion-content'].map(kind =>
        memoryFingerprint([kind, USER_MODEL_PRINCIPAL_ID, scope.type, scope.id, claim])));
      return isMemorySuppressed(db, keys) ? '' : item;
    }));
}

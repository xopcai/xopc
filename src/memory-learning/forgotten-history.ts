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

const registeredSourceFunctions = new WeakSet<object>();

/** Discover source identities, including unadmitted/archived records, without returning source text. */
function matchingRawSources(rule: ReturnType<typeof listCollaborationRules>[number]): string[] {
  const binding = rule.conditions.reread as { subject?: unknown } | undefined;
  if (typeof binding?.subject !== 'string' || !binding.subject.trim()) return [];
  const db = getSqliteDatabase();
  if (!registeredSourceFunctions.has(db)) {
    db.function('xopc_forget_source_contains', { deterministic: true }, (text, subject) =>
      typeof text === 'string' && typeof subject === 'string'
        && text.normalize('NFKC').toLowerCase().includes(subject.normalize('NFKC').toLowerCase()) ? 1 : 0);
    registeredSourceFunctions.add(db);
  }
  const scopeColumn = { workspace: 't.cwd', project: 's.project_id', session: 's.conversation_id', agent: 's.agent_id' };
  const column = rule.scope.type === 'global' ? undefined : scopeColumn[rule.scope.type];
  const rows = db.prepare(`SELECT DISTINCT t.conversation_id FROM transcript_fts f
    JOIN transcripts t ON t.transcript_id = f.transcript_id
    JOIN sessions s ON s.conversation_id = t.conversation_id
    WHERE ${column ? `${column} = ? AND` : ''}
      (xopc_forget_source_contains(f.content, ?) OR xopc_forget_source_contains(s.name, ?))`)
    .all(...(column ? [rule.scope.id ?? ''] : []), binding.subject, binding.subject) as Array<{ conversation_id: string }>;
  return rows.map(row => `${row.conversation_id}:*`);
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
    for (const entry of [...originalEntries, ...matchingRawSources(rule)]) {
      if (typeof entry === 'string') entries.add(entry);
    }
    const copies = db.prepare(`SELECT conversation_id FROM sessions, json_each(
      CASE WHEN json_valid(custom_data_json) THEN COALESCE(json_extract(custom_data_json, '$._forgottenReadRules'), '[]') ELSE '[]' END)
      WHERE value = ?`).all(rule.id) as Array<{ conversation_id: string }>;
    for (const copy of copies) entries.add(`${copy.conversation_id}:*`);
  }
  return entries;
}

/** Apply value-free scoped field boundaries even when a source fact was never admitted.
 * Ambiguous mixed sentences are conservative: all values of that field are withheld.
 */
export function projectUnadmittedForgottenFields<T>(value: T, context: CaptureScopeContext, userText = ''): T {
  if (!isXopcDatabaseOpen()) return value;
  const rules = listCollaborationRules().filter(rule => ruleVisible(rule, context)
    && typeof (rule.conditions.reread as { subject?: unknown } | undefined)?.subject === 'string'
    && ['price', 'date_time'].includes((rule.conditions.reread as { property: string }).property) && !matchesOriginalRead(rule, userText));
  if (!rules.length) return value;
  const price = /(?:[¥￥$]\s*[\d,.]+|[〇零一二两三四五六七八九十百千万亿点\d,.]+\s*(?:元|块|人民币|RMB|CNY|USD|dollars?)|(?:报价|价格|总价|金额|费用|原价|现价|price|cost)\s*(?:为|是|[:：=]|was|is)?\s*[\d,.]+)/giu;
  const date = /(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]?|\d{1,2}(?:[:：]\d{2}|点(?:\d{1,2}分)?)|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/giu;
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') {
      let result = item;
      for (const rule of rules) {
        const binding = rule.conditions.reread as { subject: string; property: string };
        if (!binding || typeof binding.subject !== 'string' || !binding.subject.trim()) continue;
        result = result.replace(/[^。；;\n]+/gu, sentence => {
          const normalized = sentence.normalize('NFKC');
          const subject = binding.subject.normalize('NFKC');
          let ownerText = normalized;
          if (binding.property === 'date_time') {
            const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // A shared team does not make the other event's attendance date this event's date.
            const relation = new RegExp(`参加${escaped}的(?:同一|同一个)?团队(?=[^。；;\\n]{0,120}(?:参加|出席)([\\p{L}\\p{N} ]{2,80}))`, 'gu');
            ownerText = ownerText.replace(relation, (span, otherEvent: string) => otherEvent.toLowerCase().includes(subject.toLowerCase()) ? span : '[other-event team]');
          }
          if (!ownerText.toLowerCase().includes(subject.toLowerCase())) return sentence;
          const field = binding.property === 'price' ? price : date;
          const entity = '[\\p{L}\\p{N} _-]{1,80}(?:合同|项目|活动|论坛|讲座|会议|研讨会|审稿会|说明会|发布会|沙龙|展览|forum|seminar|workshop|contract|project|event)';
          const assignment = binding.property === 'price' ? '(?:的)?(?:报价|价格|总价|price|cost)\\s*(?:为|是|[:：=]|is)?\\s*'
            : '(?:的)?(?:参会日期为|日期为|日期是|原定于|原定|定于|将于|于|on|date is)\\s*';
          const otherFields = [...normalized.matchAll(new RegExp(`(${entity})${assignment}(?:${field.source})`, 'giu'))]
            .filter(match => !match[1].toLowerCase().includes(subject.toLowerCase()))
            .map(match => [match.index!, match.index! + match[0].length]);
          const projected = normalized.replace(field, (value: string, ...args: unknown[]) => {
            const offset = args.at(-2) as number;
            return otherFields.some(([start, end]) => offset >= start && offset + value.length <= end) ? value : '[forgotten field withheld]';
          });
          return projected === normalized ? sentence : projected;
        });
      }
      return result;
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(item))) return Object.fromEntries(Object.entries(item).map(([key, part]) => [key, walk(part)]));
    return item;
  };
  return walk(value) as T;
}

/** Project provenance for model consumption without changing the retained audit source. */
export function projectForgottenEvidence<T>(source: T, context: CaptureScopeContext, userText = '', provenanceRefs: string[] = []): T {
  const protectedEntries = forgottenHistoryEntries(context, userText);
  if (source === undefined || source === null) return source;
  if (!protectedEntries.size) return projectUnadmittedForgottenFields(source, context, userText);
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
      reason: 'The original evidence excerpt is withheld because it also contains a forgotten field. This redacts provenance text only; it does not retract the separately returned active fact or change its status or scope. Do not reconstruct the hidden values.' } as T : projectUnadmittedForgottenFields(source, context, userText);
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

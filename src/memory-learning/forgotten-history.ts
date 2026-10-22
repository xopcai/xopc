import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import { listCollaborationRules } from '../storage/sqlite/collaboration-rule-repository.js';
import type { CaptureScopeContext } from '../user-model/capture/executor.js';

/** A later source-specific read request does not authorize saving forgotten facts again. */
export function explicitlyReadsOriginalHistory(text: string): boolean {
  if (/(?:引文|引用|改写|措辞|不是要|quoted|rephrase)/iu.test(text)) return false;
  if (/(?:不要|别|不必|禁止)\s*(?:再|去)?(?:恢复|查阅|查出|读取|找回|查)|(?:do not|don't)\s+(?:read|look|recover|retrieve|restore)/iu.test(text)) return false;
  const source = /(?:原始|旧|先前|过去).{0,8}(?:记录|对话|原文)|(?:original|old|previous|past).{0,20}(?:record|conversation|transcript|history)/iu;
  const request = /(?:^|\n)\s*(?:(?:请|麻烦|本次|这次|现在|please|this time)[，,\s]*){0,3}[^。\n！？]{0,150}(?:恢复|查阅|查出|读取|找回|read|look up|retrieve|recover|restore)/iu;
  return source.test(text) && request.test(text);
}

export function forgottenHistoryEntries(context: CaptureScopeContext, userText = ''): Set<string> {
  if (!isXopcDatabaseOpen()) return new Set();
  const entries = new Set<string>();
  for (const rule of listCollaborationRules()) {
    if (rule.status !== 'active' || rule.category !== 'boundary') continue;
    const visible = rule.scope.type === 'global' || rule.scope.id === ({ agent: context.agentId,
      workspace: context.workspaceId, project: context.projectId, session: context.conversationId } as Record<string, string | undefined>)[rule.scope.type];
    if (!visible || !Array.isArray(rule.conditions.forgottenHistoryEntries)) continue;
    const binding = rule.conditions.reread as { subject?: unknown; property?: unknown } | undefined;
    const property = binding?.property === 'date_time' ? /日期|时间|哪天|哪日|几点|日程|\b(?:date|time|when|schedule)\b/iu
      : binding?.property === 'price' ? /票价|报价|价格|总价|金额|费用|花费|价钱|\b(?:price|cost|amount)\b/iu : undefined;
    // Bind permission to the actual requested clause; unrelated reads and negative clauses cannot reveal it.
    const authorized = typeof binding?.subject === 'string' && binding.subject.length > 0 && property
      && userText.split(/[。；;，,!?！？\n]/u).some(clause => explicitlyReadsOriginalHistory(clause)
        && clause.normalize('NFKC').toLowerCase().includes((binding.subject as string).normalize('NFKC').toLowerCase())
        && property.test(clause));
    if (authorized) continue;
    for (const entry of rule.conditions.forgottenHistoryEntries) {
      if (typeof entry === 'string') entries.add(entry);
    }
  }
  return entries;
}

export const FORGOTTEN_HISTORY_EXCERPT = '[This entry supported information the user asked to forget. Automatic recall is withheld. A later explicit request to re-read original records is required; do not infer the hidden values.]';

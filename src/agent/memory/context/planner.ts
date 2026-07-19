import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { appendMemoryTraceEvent } from '../../../storage/sqlite/index.js';
import { createLogger } from '../../../utils/logger.js';
import { readAgentMessageContent } from '../agent-message-access.js';
import { buildUserContextBlock } from '../context-fence.js';
import type { MemoryManager } from '../manager.js';
import { resolveMemoryStability } from '../lifecycle.js';
import { classifyMemoryContextOrigin } from '../source-origin.js';
import type { MemoryRecord, MemorySearchResult } from '../types.js';
import type {
  PlannedUserContextItem,
  UserContextPlan,
  UserContextRejectionReason,
} from './types.js';

const MAX_CONTEXT_CHARS = 6_000;
const MAX_RESULTS = 8;
const BASELINE_KINDS = [
  'boundary',
  'preference',
  'tool_preference',
  'routine',
  'user_profile',
  'personal_logistics',
] as const;
const log = createLogger('UserContextPlanner');

function sectionFor(record: MemoryRecord): PlannedUserContextItem['section'] {
  if (record.kind === 'boundary') return 'safety';
  if (
    record.kind === 'preference' ||
    record.kind === 'user_profile' ||
    record.kind === 'relationship' ||
    record.kind === 'routine' ||
    record.kind === 'personal_logistics' ||
    record.kind === 'tool_preference'
  ) return 'interaction';
  return 'task';
}

function rejectReason(record: MemoryRecord, now: number): UserContextRejectionReason | undefined {
  if (record.validFrom && Date.parse(record.validFrom) > now) return 'not_yet_valid';
  if (
    (record.validTo && Date.parse(record.validTo) < now) ||
    (record.expiresAt && Date.parse(record.expiresAt) < now)
  ) return 'expired';
  if (record.sensitivity === 'secret' || record.sensitivity === 'regulated') return 'sensitive';
  if (record.disclosurePolicy === 'ask_before_reference') return 'requires_consent';
  if (record.status === 'needs_review' || record.status === 'stale' || resolveMemoryStability(record, now).reviewDue) return 'needs_review';
  return undefined;
}

function scoreResult(result: MemorySearchResult, now: number): number {
  const confidence = result.record.confidence ?? 0.5;
  const explicitness = result.record.explicitness === 'explicit'
    ? 1
    : result.record.explicitness === 'observed' ? 0.65 : 0.4;
  const stability = resolveMemoryStability(result.record, now).score;
  return Math.max(0, Math.min(1,
    result.score * 0.45 + confidence * 0.1 + result.record.importance * 0.2 + explicitness * 0.1 + stability * 0.15,
  ));
}

function citationFor(result: MemorySearchResult, requesterAgentId: string): string {
  const base = result.citation.path ?? `${result.citation.providerId}:${result.citation.recordId}`;
  const ownerPrefix = result.record.scope.agentId !== requesterAgentId
    ? `shared-from-agent:${result.record.scope.agentId} `
    : '';
  if (result.citation.lineStart == null) return `${ownerPrefix}${base}`;
  const end = result.citation.lineEnd && result.citation.lineEnd !== result.citation.lineStart
    ? `-L${result.citation.lineEnd}`
    : '';
  return `${ownerPrefix}${base}#L${result.citation.lineStart}${end}`;
}

function evidenceLabel(item: PlannedUserContextItem): string {
  if (item.origin === 'told_by_user') return 'The user explicitly shared this';
  if (item.origin === 'observed') return 'Observed across prior work';
  if (item.origin === 'connected_source') return 'A connected source provided this';
  return 'An inference that may be wrong';
}

function prependContext(message: AgentMessage, block: string): AgentMessage {
  if (!block) return message;
  const prefix = `${block}\n\n`;
  const content = readAgentMessageContent(message);
  if (typeof content === 'string') return { ...message, content: prefix + content } as AgentMessage;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as { type?: string; text?: string };
    if (first.type === 'text' && typeof first.text === 'string') {
      const copy = [...content];
      copy[0] = { type: 'text', text: prefix + first.text };
      return { ...message, content: copy } as AgentMessage;
    }
    return { ...message, content: [{ type: 'text' as const, text: prefix }, ...content] } as AgentMessage;
  }
  return message;
}

export class UserContextPlanner {
  async plan(params: {
    memoryManager: MemoryManager;
    agentId: string;
    sessionKey: string;
    query: string;
    userMessage: AgentMessage;
    excludedRecordIds?: string[];
  }): Promise<UserContextPlan> {
    const traceId = randomUUID();
    const query = params.query.trim();
    if (!query) {
      return { traceId, modelMessage: params.userMessage, items: [], rejected: [], estimatedTokens: 0 };
    }
    const started = Date.now();
    const scope = { agentId: params.agentId, sessionKey: params.sessionKey };
    const [taskResults, baselineLists] = await Promise.all([
      params.memoryManager.search({
        query,
        scope,
        maxResults: MAX_RESULTS,
        minScore: 0.15,
      }).catch(() => []),
      Promise.all(BASELINE_KINDS.map((kind) => (
        params.memoryManager.list({ kind, status: 'active', scope }).catch(() => [])
      ))),
    ]);
    const taskIds = new Set(taskResults.map((result) => result.record.id));
    const baselineResults: MemorySearchResult[] = baselineLists
      .flat()
      .filter((record) => !taskIds.has(record.id))
      .filter((record) => record.kind === 'boundary' || record.explicitness === 'explicit' || record.importance >= 0.7)
      .map((record) => ({
        record,
        score: record.kind === 'boundary' ? 0.7 : 0.42,
        snippet: record.content,
        citation: {
          providerId: record.source.provider ?? 'local',
          recordId: record.id,
          path: record.source.path,
          lineStart: record.source.lineStart,
          lineEnd: record.source.lineEnd,
          createdAt: record.createdAt,
        },
      }));
    const results = [...taskResults, ...baselineResults];
    const now = Date.now();
    const excluded = new Set(params.excludedRecordIds ?? []);
    const rejected: UserContextPlan['rejected'] = [];
    const ranked = results
      .filter((result) => !excluded.has(result.record.id))
      .map((result) => ({ result, score: scoreResult(result, now) }))
      .sort((a, b) => b.score - a.score)
      .filter((entry, index, all) => all.findIndex((candidate) => candidate.result.record.id === entry.result.record.id) === index)
      .slice(0, MAX_RESULTS);
    const items: PlannedUserContextItem[] = [];
    let usedChars = 0;
    for (const { result, score } of ranked) {
      const reason = rejectReason(result.record, now) ?? (score < 0.25 ? 'low_score' : undefined);
      if (reason) {
        rejected.push({ recordId: result.record.id, reason });
        continue;
      }
      const content = result.snippet.trim();
      if (usedChars + content.length > MAX_CONTEXT_CHARS) {
        rejected.push({ recordId: result.record.id, reason: 'budget' });
        continue;
      }
      usedChars += content.length;
      items.push({
        recordId: result.record.id,
        content,
        score,
        section: sectionFor(result.record),
        citation: citationFor(result, params.agentId),
        origin: classifyMemoryContextOrigin(result.record),
        stability: resolveMemoryStability(result.record, now).score,
      });
    }
    const sections: string[] = [];
    for (const [section, title] of [['safety', 'Boundaries'], ['task', 'Relevant facts'], ['interaction', 'Interaction preferences']] as const) {
      const sectionItems = items.filter((item) => item.section === section);
      if (sectionItems.length > 0) {
        sections.push(`${title}:\n${sectionItems.map((item) => `- ${item.content}\n  Evidence: ${evidenceLabel(item)}`).join('\n')}`);
      }
    }
    const block = buildUserContextBlock(sections.join('\n\n'));
    try {
      appendMemoryTraceEvent({
        traceId,
        phase: 'inject',
        providerId: 'user-understanding',
        sessionKey: params.sessionKey,
        request: {
          query,
          rejected,
          contextItems: items.map((item) => ({
            recordId: item.recordId,
            section: item.section,
            origin: item.origin,
            stability: item.stability,
            citation: item.citation,
          })),
        },
        resultCount: items.length,
        selectedRecordIds: items.map((item) => item.recordId),
        durationMs: Date.now() - started,
      });
    } catch (err) {
      log.debug({ err, traceId, sessionKey: params.sessionKey }, 'Context plan trace was not persisted');
    }
    return {
      traceId,
      modelMessage: prependContext(params.userMessage, block),
      items,
      rejected,
      estimatedTokens: Math.ceil(block.length / 4),
    };
  }
}

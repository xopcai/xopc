import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import {
  appendMemorySignal,
  appendMemoryTraceEvent,
  consumeMemoryReferenceConsent,
  ensureMemoryReferenceConsentRequest,
  hasMemoryReferenceConsent,
  hasUnresolvedMemoryConflict,
} from '../../../storage/sqlite/index.js';
import { isUserContextRecord, USER_CONTEXT_MEMORY_KINDS } from '../../../user-context/projection.js';
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

const DEFAULT_MAX_CONTEXT_CHARS = 12_000;
const DEFAULT_MAX_RESULTS = 12;
const BASELINE_KINDS = [
  'boundary',
  'preference',
  'tool_preference',
  'routine',
  'user_profile',
  'personal_logistics',
] as const;
const SELF_SUMMARY_PATTERNS = [
  /(?:介绍|说说|描述|总结)(?:一下|下)?你?(?:所)?(?:了解|知道|认知)(?:到)?的?我/u,
  /你眼中的我/u,
  /(?:关于我你|你(?:对我|关于我))(?:有)?(?:哪些|什么)?(?:了解|认知|知道|记得|印象)/u,
  /(?:what (?:do|can) you|what you) (?:know|understand|remember) about me/i,
  /(?:describe|summari[sz]e|introduce) me/i,
  /(?:how do you see|your impression of) me/i,
];
const log = createLogger('UserContextPlanner');

export function isUserSelfSummaryQuery(query: string): boolean {
  return SELF_SUMMARY_PATTERNS.some((pattern) => pattern.test(query));
}

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

function rejectReason(record: MemoryRecord, now: number, hasReferenceConsent: boolean): UserContextRejectionReason | undefined {
  if (record.tags?.includes('playbook:disabled')) return 'disabled';
  if (record.conflictGroupId && hasUnresolvedMemoryConflict(record.conflictGroupId)) return 'conflict';
  if (record.validFrom && Date.parse(record.validFrom) > now) return 'not_yet_valid';
  if (
    (record.validTo && Date.parse(record.validTo) < now) ||
    (record.expiresAt && Date.parse(record.expiresAt) < now)
  ) return 'expired';
  if (record.sensitivity === 'secret' || record.sensitivity === 'regulated') return 'sensitive';
  if (record.disclosurePolicy === 'ask_before_reference' && !hasReferenceConsent) return 'requires_consent';
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
  void requesterAgentId;
  const base = result.citation.path ?? `${result.citation.providerId}:${result.citation.recordId}`;
  if (result.citation.lineStart == null) return base;
  const end = result.citation.lineEnd && result.citation.lineEnd !== result.citation.lineStart
    ? `-L${result.citation.lineEnd}`
    : '';
  return `${base}#L${result.citation.lineStart}${end}`;
}

function evidenceLabel(item: PlannedUserContextItem): string {
  if (item.origin === 'told_by_user') return 'The user explicitly shared this';
  if (item.origin === 'observed') return 'Observed across prior work';
  if (item.origin === 'connected_source') return 'A connected source provided this';
  return 'An inference that may be wrong';
}

export function prependAgentContext(message: AgentMessage, block: string): AgentMessage {
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
    workspaceId: string;
    taskId?: string;
    turnId: string;
    query: string;
    userMessage: AgentMessage;
    excludedRecordIds?: string[];
    allocation?: UserContextPlan['allocation'];
  }): Promise<UserContextPlan> {
    const traceId = randomUUID();
    const query = params.query.trim();
    if (!query) {
      return {
        traceId,
        modelMessage: params.userMessage,
        items: [],
        rejected: [],
        consentRequests: [],
        estimatedTokens: 0,
        allocation: params.allocation,
      };
    }
    const maxResults = params.allocation?.maxResults ?? DEFAULT_MAX_RESULTS;
    const maxContextChars = params.allocation?.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    const started = Date.now();
    const scope = { userId: 'local-owner', workspaceId: params.workspaceId, sessionKey: params.sessionKey };
    const selfSummary = isUserSelfSummaryQuery(query);
    const baselineKinds = selfSummary ? USER_CONTEXT_MEMORY_KINDS : BASELINE_KINDS;
    const [searchedResults, baselineLists] = await Promise.all([
      params.memoryManager.search({
        query,
        scope,
        maxResults,
        minScore: 0.15,
      }).catch(() => []),
      Promise.all(baselineKinds.map((kind) => (
        params.memoryManager.list({ kind, status: 'active', scope }).catch(() => [])
      ))),
    ]);
    const taskResults = selfSummary
      ? searchedResults.filter((result) => isUserContextRecord(result.record))
      : searchedResults;
    const taskIds = new Set(taskResults.map((result) => result.record.id));
    const baselineResults: MemorySearchResult[] = baselineLists
      .flat()
      .filter((record) => !taskIds.has(record.id))
      .filter((record) => isUserContextRecord(record))
      .filter((record) => selfSummary
        || record.kind === 'boundary'
        || ((record.kind === 'preference' || record.kind === 'tool_preference')
          ? !record.scope.workspaceId && !record.scope.projectId && !record.scope.sessionKey && record.explicitness === 'explicit'
          : record.explicitness === 'explicit' || record.importance >= 0.7))
      .map((record) => ({
        record,
        score: record.kind === 'boundary' ? 0.7 : selfSummary ? 0.6 : 0.42,
        snippet: record.content,
        citation: {
          providerId: record.providerId,
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
    const consentRequests: UserContextPlan['consentRequests'] = [];
    const ranked = results
      .filter((result) => !excluded.has(result.record.id))
      .map((result) => ({ result, score: scoreResult(result, now) }))
      .sort((a, b) => b.score - a.score)
      .filter((entry, index, all) => all.findIndex((candidate) => candidate.result.record.id === entry.result.record.id) === index)
      .slice(0, maxResults);
    const items: PlannedUserContextItem[] = [];
    let usedChars = 0;
    for (const { result, score } of ranked) {
      const needsConsent = result.record.disclosurePolicy === 'ask_before_reference'
        && result.record.sensitivity !== 'secret'
        && result.record.sensitivity !== 'regulated';
      const hasReferenceConsent = needsConsent
        ? hasMemoryReferenceConsent(result.record.id, params.sessionKey)
        : false;
      const reason = rejectReason(result.record, now, hasReferenceConsent) ?? (score < 0.25 ? 'low_score' : undefined);
      if (reason) {
        rejected.push({ recordId: result.record.id, reason });
        if (reason === 'requires_consent') {
          const request = ensureMemoryReferenceConsentRequest({
            recordId: result.record.id,
            sessionKey: params.sessionKey,
            purpose: query,
          });
          consentRequests.push({ id: request.id, recordId: request.recordId, statement: result.record.content, purpose: request.purpose });
        }
        continue;
      }
      const content = result.snippet.trim();
      if (usedChars + content.length > maxContextChars) {
        rejected.push({ recordId: result.record.id, reason: 'budget' });
        continue;
      }
      if (needsConsent && !consumeMemoryReferenceConsent(result.record.id, params.sessionKey)) {
        rejected.push({ recordId: result.record.id, reason: 'requires_consent' });
        const request = ensureMemoryReferenceConsentRequest({
          recordId: result.record.id,
          sessionKey: params.sessionKey,
          purpose: query,
        });
        consentRequests.push({ id: request.id, recordId: request.recordId, statement: result.record.content, purpose: request.purpose });
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
    const consentNotice = consentRequests.length > 0
      ? 'A relevant saved understanding requires the user’s explicit permission before it can be referenced. Do not infer or reveal its contents. Briefly ask the user to approve the pending item in You > Understanding, then continue without it.'
      : '';
    const block = [buildUserContextBlock(sections.join('\n\n')), consentNotice].filter(Boolean).join('\n\n');
    try {
      for (const item of items) {
        appendMemorySignal({
          signal: {
            source: 'context_injection',
            recordId: item.recordId,
            score: item.score,
            content: item.content,
            metadata: {
              traceId,
              turnId: params.turnId,
              query,
              ...(params.taskId ? { taskId: params.taskId } : {}),
            },
          },
          providerId: 'local',
          sourceAgentId: params.agentId,
          sessionKey: params.sessionKey,
          workspaceId: params.workspaceId,
        });
      }
      appendMemoryTraceEvent({
        traceId,
        phase: 'inject',
        providerId: 'user-understanding',
        sessionKey: params.sessionKey,
        turnId: params.turnId,
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
      modelMessage: prependAgentContext(params.userMessage, block),
      items,
      rejected,
      consentRequests,
      estimatedTokens: Math.ceil(block.length / 4),
      allocation: params.allocation,
    };
  }
}

import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { UserContextPlan, PlannedUserContextItem, UserContextRejectionReason } from '../agent/memory/context/types.js';
import { readAgentMessageContent } from '../agent/memory/agent-message-access.js';
import { buildUserContextBlock } from '../agent/memory/context-fence.js';
import {
  ensureContextConsent,
  getUserProfile,
  consumeContextConsent,
  listCollaborationRules,
  listUnderstandings,
  recordContextRun,
} from '../storage/sqlite/index.js';
import type { CollaborationRule, PersonalizationItem, UserContextScope, UserUnderstanding } from './domain.js';
import { listUserFocuses } from './sources/repository.js';

const DEFAULT_MAX_CONTEXT_CHARS = 6_000;
const DEFAULT_MAX_RESULTS = 12;

export function prependAgentContext(message: AgentMessage, block: string): AgentMessage {
  if (!block) return message;
  const prefix = `${block}\n\n`;
  const content = readAgentMessageContent(message);
  if (typeof content === 'string') return { ...message, content: prefix + content } as AgentMessage;
  if (Array.isArray(content)) {
    const copy = [...content];
    const first = copy[0] as { type?: string; text?: string } | undefined;
    if (first?.type === 'text' && typeof first.text === 'string') {
      copy[0] = { type: 'text', text: prefix + first.text };
    } else {
      copy.unshift({ type: 'text', text: prefix });
    }
    return { ...message, content: copy } as AgentMessage;
  }
  return message;
}

function scopeMatches(scope: UserContextScope, input: { sessionKey: string; workspaceId: string; projectId?: string }): boolean {
  if (scope.type === 'global') return true;
  if (scope.type === 'session') return scope.id === input.sessionKey;
  if (scope.type === 'workspace') return scope.id === input.workspaceId;
  return Boolean(input.projectId && scope.id === input.projectId);
}

function terms(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = normalized.split(/\s+/).filter((word) => word.length > 1);
  const cjk = [...normalized.replace(/[^\p{Script=Han}]/gu, '')];
  for (let index = 0; index < cjk.length - 1; index += 1) words.push(`${cjk[index]}${cjk[index + 1]}`);
  return new Set(words);
}

function relevance(query: string, item: UserUnderstanding): number {
  const queryTerms = terms(query);
  const itemTerms = terms(item.statement);
  const shared = [...queryTerms].filter((term) => itemTerms.has(term)).length;
  const lexical = queryTerms.size ? shared / queryTerms.size : 0;
  const baseline = item.kind === 'boundary' && item.explicitness === 'explicit'
    ? 0.8
    : item.kind === 'preference' && item.explicitness === 'explicit' ? 0.35 : 0;
  const explicitness = item.explicitness === 'explicit' ? 0.1 : item.explicitness === 'observed' ? 0.05 : 0;
  return Math.min(1, Math.max(baseline, lexical * 0.75 + item.confidence * 0.15 + explicitness));
}

function sectionFor(item: UserUnderstanding): PlannedUserContextItem['section'] {
  if (item.kind === 'boundary') return 'safety';
  if (['preference', 'relationship', 'routine'].includes(item.kind)) return 'interaction';
  return 'task';
}

function originFor(item: UserUnderstanding): PlannedUserContextItem['origin'] {
  if (item.explicitness === 'explicit') return 'told_by_user';
  if (item.explicitness === 'observed') return 'observed';
  return 'inferred';
}

function sourceLabel(item: UserUnderstanding): string {
  if (item.explicitness === 'explicit') return 'You told xopc';
  if (item.explicitness === 'observed') return 'Observed across prior work';
  return 'An inference that may be wrong';
}

function rejectionReason(
  item: UserUnderstanding,
  input: { sessionKey: string; workspaceId: string; projectId?: string },
  now: number,
): UserContextRejectionReason | undefined {
  if (item.status === 'needs_review' || item.status === 'stale' || item.status === 'candidate') return 'needs_review';
  if (item.status === 'archived' || item.status === 'rejected') return 'disabled';
  if (!scopeMatches(item.scope, input)) return 'scope_mismatch';
  if (item.validFrom && item.validFrom > now) return 'not_yet_valid';
  if ((item.validTo && item.validTo < now) || (item.expiresAt && item.expiresAt < now)) return 'expired';
  if (item.sensitivity === 'secret' || item.sensitivity === 'regulated') return 'sensitive';
  if (item.conflictGroupId) return 'conflict';
  return undefined;
}

function ruleMatches(rule: CollaborationRule, input: { sessionKey: string; workspaceId: string; projectId?: string; channel?: string }): boolean {
  if (rule.status !== 'active' || !scopeMatches(rule.scope, input)) return false;
  const channel = typeof rule.conditions.channel === 'string' ? rule.conditions.channel : undefined;
  return !channel || channel === input.channel;
}

export class UserContextPlanner {
  plan(params: {
    sessionKey: string;
    workspaceId: string;
    projectId?: string;
    channel?: string;
    turnId: string;
    query: string;
    userMessage: AgentMessage;
    excludedRecordIds?: string[];
    allocation?: UserContextPlan['allocation'];
  }): UserContextPlan {
    const traceId = randomUUID();
    const query = params.query.trim();
    if (!query) return { traceId, modelMessage: params.userMessage, items: [], rejected: [], consentRequests: [], estimatedTokens: 0, allocation: params.allocation };

    const started = Date.now();
    const now = Date.now();
    const maxResults = params.allocation?.maxResults ?? DEFAULT_MAX_RESULTS;
    const maxChars = params.allocation?.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    const scopeInput = {
      sessionKey: params.sessionKey,
      workspaceId: params.workspaceId,
      ...(params.projectId ? { projectId: params.projectId } : {}),
    };
    const excluded = new Set(params.excludedRecordIds ?? []);
    const rejected: UserContextPlan['rejected'] = [];
    const consentRequests: UserContextPlan['consentRequests'] = [];
    const traceItems: PersonalizationItem[] = [];
    const items: PlannedUserContextItem[] = [];
    let usedChars = 0;

    const profile = getUserProfile();
    const profileLines = [
      profile.callName ? `Preferred name: ${profile.callName}` : '',
      profile.role ? `Primary role: ${profile.role}` : '',
      profile.primaryGoal ? `Primary goal for xopc: ${profile.primaryGoal}` : '',
      profile.pronouns ? `Pronouns: ${profile.pronouns}` : '',
      profile.timezone ? `Timezone: ${profile.timezone}` : '',
      profile.locale ? `Language/locale: ${profile.locale}` : '',
    ].filter(Boolean);
    if (profileLines.length) {
      const content = profileLines.join('\n');
      traceItems.push({ objectType: 'profile', objectId: 'profile', decision: 'selected', reason: 'User-provided profile', content, sourceLabel: 'You provided this directly', rank: 0, score: 1, injectedChars: content.length });
      usedChars += content.length;
    }

    const activeFocusLines = listUserFocuses(['active']).slice(0, 5).map((focus) => (
      `- ${focus.title}: ${focus.summary} (${focus.horizon})`
    ));
    if (activeFocusLines.length) usedChars += activeFocusLines.join('\n').length;

    const rules = listCollaborationRules().filter((rule) => ruleMatches(rule, { ...scopeInput, channel: params.channel }));
    const selectedRules: CollaborationRule[] = [];
    for (const [index, rule] of rules.entries()) {
      if (usedChars + rule.statement.length > maxChars) {
        traceItems.push({ objectType: 'rule', objectId: rule.id, versionId: rule.revisionId, decision: 'budget_exceeded', reason: 'Context budget reached', content: rule.statement, sourceLabel: 'Your collaboration rule', injectedChars: 0 });
        continue;
      }
      usedChars += rule.statement.length;
      selectedRules.push(rule);
      traceItems.push({ objectType: 'rule', objectId: rule.id, versionId: rule.revisionId, decision: 'selected', reason: 'Active collaboration rule', content: rule.statement, sourceLabel: 'Your collaboration rule', rank: index + 1, score: 1, injectedChars: rule.statement.length });
    }

    const ranked = listUnderstandings(['active'])
      .filter((item) => !excluded.has(item.id))
      .map((item) => ({ item, score: relevance(query, item) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(maxResults * 5, 50));
    for (const { item, score } of ranked) {
      if (items.length >= maxResults) {
        rejected.push({ recordId: item.id, reason: 'budget' });
        traceItems.push({ objectType: 'understanding', objectId: item.id, versionId: item.versionId,
          decision: 'budget_exceeded', reason: 'Maximum result count reached', content: item.statement,
          sourceLabel: sourceLabel(item), score, injectedChars: 0 });
        continue;
      }
      let reason = rejectionReason(item, scopeInput, now);
      if (!reason && score < 0.25) reason = 'low_score';
      if (!reason && item.disclosurePolicy === 'ask_before_reference') {
        const consentStatus = consumeContextConsent(item.id, params.sessionKey);
        if (consentStatus !== 'granted') {
          reason = consentStatus === 'denied' ? 'disabled' : 'requires_consent';
          if (consentStatus === 'missing') {
            const consent = ensureContextConsent(item.id, params.sessionKey, query);
            consentRequests.push({ id: consent.id, recordId: item.id, statement: item.statement, purpose: consent.purpose });
          }
        }
      }
      if (reason) {
        rejected.push({ recordId: item.id, reason });
        traceItems.push({ objectType: 'understanding', objectId: item.id, versionId: item.versionId,
          decision: reason === 'budget' ? 'budget_exceeded' : reason === 'requires_consent' ? 'needs_consent'
            : reason === 'conflict' ? 'conflicted' : reason === 'expired' ? 'expired'
              : reason === 'sensitive' ? 'sensitive'
                : reason === 'scope_mismatch' ? 'scope_mismatch'
                  : reason === 'disabled' ? 'disabled' : 'irrelevant',
          reason, content: item.statement, sourceLabel: sourceLabel(item), score, injectedChars: 0 });
        continue;
      }
      if (usedChars + item.statement.length > maxChars) {
        rejected.push({ recordId: item.id, reason: 'budget' });
        traceItems.push({ objectType: 'understanding', objectId: item.id, versionId: item.versionId, decision: 'budget_exceeded', reason: 'Context budget reached', content: item.statement, sourceLabel: sourceLabel(item), score, injectedChars: 0 });
        continue;
      }
      usedChars += item.statement.length;
      items.push({ recordId: item.id, objectType: 'understanding', versionId: item.versionId, content: item.statement,
        score, section: sectionFor(item), citation: `user-context://${item.id}`, origin: originFor(item), stability: item.confidence });
      traceItems.push({ objectType: 'understanding', objectId: item.id, versionId: item.versionId, decision: 'selected', reason: 'Relevant to this request', content: item.statement, sourceLabel: sourceLabel(item), rank: items.length, score, injectedChars: item.statement.length });
    }

    const sections = [
      profileLines.length ? `<user-profile>\n${profileLines.join('\n')}\n</user-profile>` : '',
      activeFocusLines.length ? `<active-focuses>\n${activeFocusLines.join('\n')}\n</active-focuses>` : '',
      selectedRules.length ? `<collaboration-contract>\n${selectedRules.map((rule) => `- ${rule.statement}`).join('\n')}\n</collaboration-contract>` : '',
      items.length ? buildUserContextBlock(items.map((item) => `- ${item.content}\n  Evidence: ${traceItems.find((trace) => trace.objectId === item.recordId)?.sourceLabel}`).join('\n')) : '',
    ].filter(Boolean);
    const block = sections.join('\n\n');
    recordContextRun({ turnId: params.turnId, sessionKey: params.sessionKey, query, budget: maxChars,
      durationMs: Date.now() - started, items: traceItems });
    return { traceId, modelMessage: prependAgentContext(params.userMessage, block), items, rejected, consentRequests,
      estimatedTokens: Math.ceil(block.length / 4), allocation: params.allocation };
  }
}

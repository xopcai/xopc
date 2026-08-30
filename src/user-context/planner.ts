import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { parseSessionKey } from '../routing/session-key.js';

import type { UserContextPlan, PlannedUserContextItem, UserContextRejectionReason } from '../agent/memory/context/types.js';
import { readAgentMessageContent } from '../agent/memory/agent-message-access.js';
import { buildUserContextBlock } from '../agent/memory/context-fence.js';
import { buildRetrievalQueryProfile } from '../retrieval/queryProfile.js';
import { retrievalLexicalSimilarity } from '../retrieval/textFeatures.js';
import {
  ensureContextConsent,
  getUserProfile,
  consumeContextConsent,
  listCollaborationRules,
  listUnderstandings,
  listUnderstandingEvidence,
  recordContextRun,
} from '../storage/sqlite/index.js';
import { ProjectStore } from '../projects/project-store.js';
import type { CollaborationRule, PersonalizationItem, UserUnderstanding } from './domain.js';
import {
  getUnderstandingSourceGrant,
  getUnderstandingSourceRun,
  listUserFocuses,
} from './sources/repository.js';
import type { UserFocus } from './sources/types.js';
import { UserUnderstandingRetriever } from './retriever.js';
import { matchesUserContextScope } from './scope.js';

const DEFAULT_MAX_CONTEXT_CHARS = 6_000;
const DEFAULT_MAX_RESULTS = 12;
const SELF_REVIEW_MAX_CONTEXT_CHARS = 16_000;
const SELF_REVIEW_MAX_RESULTS = 50;
const MAX_FOCUS_RESULTS = 3;
const MIN_RELEVANCE_SCORE = 0.25;

function selfReviewScore(item: UserUnderstanding): number {
  const authority = item.explicitness === 'explicit' ? 0.2 : item.explicitness === 'observed' ? 0.1 : 0;
  const durable = item.durability === 'durable' ? 0.1 : item.durability === 'recurring' ? 0.05 : 0;
  return Math.min(1, item.confidence * 0.7 + authority + durable);
}

function scopeLabel(scope: UserUnderstanding['scope'], projects: ProjectStore): string {
  if (scope.type === 'global') return 'Global';
  if (scope.type === 'project') return `Project: ${scope.id ? projects.get(scope.id)?.name ?? scope.id : 'unknown'}`;
  if (scope.type === 'workspace') return `Workspace: ${scope.id ?? 'unknown'}`;
  return 'This conversation';
}

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

function sectionFor(item: UserUnderstanding): PlannedUserContextItem['section'] {
  if (item.kind === 'boundary') return 'safety';
  if (['preference', 'relationship', 'routine'].includes(item.kind)) return 'interaction';
  return 'task';
}

function sourceDescription(item: UserUnderstanding): {
  origin: PlannedUserContextItem['origin'];
  label: string;
} {
  if (item.explicitness === 'explicit') return { origin: 'told_by_user', label: 'You told xopc' };
  const connected = listUnderstandingEvidence(item.id).find((evidence) => evidence.sourceType === 'connector');
  if (connected) {
    return { origin: 'connected_source', label: connected.sourceInstanceId ?? 'Connected source' };
  }
  if (item.explicitness === 'observed') return { origin: 'observed', label: 'Observed across prior work' };
  return { origin: 'inferred', label: 'An inference that may be wrong' };
}

function focusSourceDescription(focus: UserFocus): {
  origin: PersonalizationItem['origin'];
  label: string;
} {
  if (focus.explicitness === 'explicit') return { origin: 'told_by_user', label: 'You set this focus' };
  const sourceRun = focus.sourceRunId ? getUnderstandingSourceRun(focus.sourceRunId) : null;
  const grant = sourceRun ? getUnderstandingSourceGrant(sourceRun.grantId) : null;
  if (grant?.adapterId.startsWith('connector:')) {
    return { origin: 'connected_source', label: grant.displayName };
  }
  if (focus.explicitness === 'observed') return { origin: 'observed', label: 'Observed across prior work' };
  return { origin: 'inferred', label: 'Suggested from prior work' };
}

function rejectionReason(
  item: UserUnderstanding,
  input: { sessionKey: string; workspaceId: string; projectId?: string },
  now: number,
  timeHints: string[],
): UserContextRejectionReason | undefined {
  const historical = timeHints.includes('historical') && item.validTo !== undefined;
  if (item.status === 'needs_review' || item.status === 'candidate' || (item.status === 'stale' && !historical)) return 'needs_review';
  if (item.status === 'rejected' || (item.status === 'archived' && !historical)) return 'disabled';
  if (!matchesUserContextScope(item.scope, input)) return 'scope_mismatch';
  if (item.validFrom && item.validFrom > now && !timeHints.includes('future')) return 'not_yet_valid';
  if (((item.validTo && item.validTo < now) || (item.expiresAt && item.expiresAt < now)) && !historical) return 'expired';
  if (item.sensitivity === 'secret' || item.sensitivity === 'regulated') return 'sensitive';
  if (item.conflictGroupId) return 'conflict';
  return undefined;
}

function ruleMatches(rule: CollaborationRule, input: { sessionKey: string; workspaceId: string; projectId?: string; channel?: string; agentId?: string }): boolean {
  if (rule.status !== 'active' || !matchesUserContextScope(rule.scope, input)) return false;
  const channel = typeof rule.conditions.channel === 'string' ? rule.conditions.channel : undefined;
  const agentId = typeof rule.conditions.agentId === 'string' ? rule.conditions.agentId : undefined;
  return (!channel || channel === input.channel) && (!agentId || agentId === input.agentId);
}

function focusRejectionReason(
  focus: UserFocus,
  input: { sessionKey: string; workspaceId: string; projectId?: string },
  now: number,
): UserContextRejectionReason | undefined {
  if (focus.status !== 'active') return 'disabled';
  if (!matchesUserContextScope(focus.scope, input)) return 'scope_mismatch';
  if (focus.validFrom && focus.validFrom > now) return 'not_yet_valid';
  if (focus.validTo && focus.validTo < now) return 'expired';
  if (focus.sensitivity === 'secret' || focus.sensitivity === 'regulated') return 'sensitive';
  if (focus.disclosurePolicy === 'ask_before_reference') return 'requires_consent';
  return undefined;
}

function focusScore(focus: UserFocus, query: string, scopeInput: {
  sessionKey: string;
  workspaceId: string;
  projectId?: string;
}): number {
  const profile = buildRetrievalQueryProfile(query, scopeInput);
  const lexical = retrievalLexicalSimilarity(profile.normalized, `${focus.title} ${focus.summary}`);
  const scoped = focus.scope.type !== 'global' && matchesUserContextScope(focus.scope, scopeInput);
  return Math.min(1, lexical * 0.75 + focus.confidence * 0.15 + (scoped ? 0.25 : 0));
}

function renderContextBlock(params: {
  profileLines: string[];
  focuses: UserFocus[];
  rules: CollaborationRule[];
  items: PlannedUserContextItem[];
  understandingSources: Map<string, string>;
  selfReview: boolean;
  projects: ProjectStore;
}): string {
  const understandingItems = params.items.filter((item) => item.objectType === 'understanding');
  return [
    params.selfReview ? [
      '<user-context-review>',
      'The user explicitly asked what xopc understands about them. This is a review of active, non-sensitive structured understanding across scopes.',
      'Scope labels describe where each item applies. Do not present project facts as global personality traits.',
      'An empty memory_search result does not mean structured user understanding is empty.',
      '</user-context-review>',
    ].join('\n') : '',
    params.profileLines.length ? `<user-profile>\n${params.profileLines.join('\n')}\n</user-profile>` : '',
    params.focuses.length ? `<active-focuses>\n${params.focuses.map((focus) => `- ${params.selfReview ? `[${scopeLabel(focus.scope, params.projects)}] ` : ''}${focus.title}: ${focus.summary} (${focus.horizon})`).join('\n')}\n</active-focuses>` : '',
    params.rules.length ? `<collaboration-contract>\n${params.rules.map((rule) => `- ${rule.statement}`).join('\n')}\n</collaboration-contract>` : '',
    understandingItems.length ? buildUserContextBlock(understandingItems.map((item) => (
      `- ${item.content}\n  Evidence: ${params.understandingSources.get(item.recordId) ?? 'Unknown source'}`
    )).join('\n')) : '',
  ].filter(Boolean).join('\n\n');
}

export class UserContextPlanner {
  private readonly retriever = new UserUnderstandingRetriever();

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
    const requestedMaxResults = params.allocation?.maxResults;
    const requestedMaxChars = params.allocation?.maxChars;
    const scopeInput = {
      sessionKey: params.sessionKey,
      workspaceId: params.workspaceId,
      ...(params.projectId ? { projectId: params.projectId } : {}),
    };
    const queryProfile = buildRetrievalQueryProfile(query, scopeInput);
    const selfReview = queryProfile.selfReview;
    const maxResults = requestedMaxResults ?? (selfReview ? SELF_REVIEW_MAX_RESULTS : DEFAULT_MAX_RESULTS);
    const maxChars = requestedMaxChars ?? (selfReview ? SELF_REVIEW_MAX_CONTEXT_CHARS : DEFAULT_MAX_CONTEXT_CHARS);
    const projects = new ProjectStore();
    const excluded = new Set(params.excludedRecordIds ?? []);
    const rejected: UserContextPlan['rejected'] = [];
    const consentRequests: UserContextPlan['consentRequests'] = [];
    const traceItems: PersonalizationItem[] = [];
    const items: PlannedUserContextItem[] = [];
    const selectedFocuses: UserFocus[] = [];
    const selectedRules: CollaborationRule[] = [];
    const understandingSources = new Map<string, string>();
    let usedChars = 0;

    const render = (overrides: Partial<Parameters<typeof renderContextBlock>[0]> = {}) => renderContextBlock({
      profileLines,
      focuses: selectedFocuses,
      rules: selectedRules,
      items,
      understandingSources,
      selfReview,
      projects,
      ...overrides,
    });

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
      const nextChars = render().length;
      if (nextChars <= maxChars) {
        traceItems.push({ objectType: 'profile', objectId: 'profile', decision: 'selected', reason: 'User-provided profile', content, sourceLabel: 'You provided this directly', origin: 'told_by_user', rank: 0, score: 1, injectedChars: nextChars });
        usedChars = nextChars;
      } else {
        profileLines.length = 0;
        traceItems.push({ objectType: 'profile', objectId: 'profile', decision: 'budget_exceeded', reason: 'Context budget reached', content, sourceLabel: 'You provided this directly', origin: 'told_by_user', injectedChars: 0 });
      }
    }

    const rankedFocuses = listUserFocuses(['active'])
      .map((focus) => ({ focus, score: focusScore(focus, query, scopeInput) }))
      .sort((left, right) => selfReview
        ? right.focus.confidence - left.focus.confidence || right.focus.updatedAt - left.focus.updatedAt
        : right.score - left.score || right.focus.updatedAt - left.focus.updatedAt);
    for (const { focus, score } of rankedFocuses) {
      const source = focusSourceDescription(focus);
      let reason = focusRejectionReason(focus, scopeInput, now);
      if (selfReview && reason === 'scope_mismatch') reason = undefined;
      if (!reason && !selfReview && score <= MIN_RELEVANCE_SCORE) reason = 'low_score';
      if (!reason && selectedFocuses.length >= (selfReview ? maxResults : MAX_FOCUS_RESULTS)) reason = 'budget';
      if (!reason && items.length >= maxResults) reason = 'budget';
      const focusScope = scopeLabel(focus.scope, projects);
      const content = `${selfReview ? `[${focusScope}] ` : ''}${focus.title}: ${focus.summary} (${focus.horizon})`;
      const nextChars = render({ focuses: [...selectedFocuses, focus] }).length;
      if (!reason && nextChars > maxChars) reason = 'budget';
      if (reason) {
        rejected.push({ recordId: focus.id, reason });
        traceItems.push({
          objectType: 'focus', objectId: focus.id, versionId: focus.versionId,
          decision: reason === 'budget' ? 'budget_exceeded' : reason === 'requires_consent' ? 'needs_consent'
            : reason === 'scope_mismatch' ? 'scope_mismatch' : reason === 'expired' ? 'expired'
              : reason === 'sensitive' ? 'sensitive' : reason === 'disabled' ? 'disabled' : 'irrelevant',
          reason, content, sourceLabel: source.label, origin: source.origin,
          score, injectedChars: 0,
        });
        continue;
      }
      const addedChars = nextChars - usedChars;
      usedChars = nextChars;
      selectedFocuses.push(focus);
      items.push({
        recordId: focus.id, objectType: 'focus', versionId: focus.versionId, content, score, section: 'task',
        citation: `user-focus://${focus.id}`,
        origin: source.origin,
        stability: focus.confidence,
      });
      traceItems.push({
        objectType: 'focus', objectId: focus.id, versionId: focus.versionId, decision: 'selected', reason: 'Relevant active focus',
        content, sourceLabel: source.label, origin: source.origin,
        rank: items.length, score, injectedChars: addedChars,
      });
    }

    const rules = listCollaborationRules().filter((rule) => ruleMatches(rule, {
      ...scopeInput, channel: params.channel, agentId: parseSessionKey(params.sessionKey)?.agentId,
    }));
    for (const [index, rule] of rules.entries()) {
      const nextChars = render({ rules: [...selectedRules, rule] }).length;
      if (nextChars > maxChars) {
        traceItems.push({ objectType: 'rule', objectId: rule.id, versionId: rule.revisionId, decision: 'budget_exceeded', reason: 'Context budget reached', content: rule.statement, sourceLabel: 'Your collaboration rule', origin: 'told_by_user', injectedChars: 0 });
        continue;
      }
      const addedChars = nextChars - usedChars;
      usedChars = nextChars;
      selectedRules.push(rule);
      traceItems.push({ objectType: 'rule', objectId: rule.id, versionId: rule.revisionId, decision: 'selected', reason: 'Active collaboration rule', content: rule.statement, sourceLabel: 'Your collaboration rule', origin: 'told_by_user', rank: index + 1, score: 1, injectedChars: addedChars });
    }

    const ranked = (selfReview
      ? listUnderstandings(['active'])
        .map((item) => ({ item, score: selfReviewScore(item) }))
        .sort((left, right) => right.score - left.score || right.item.updatedAt - left.item.updatedAt)
      : this.retriever.retrieve({
        query,
        sessionKey: params.sessionKey,
        workspaceId: params.workspaceId,
        ...(params.projectId ? { projectId: params.projectId } : {}),
        maxCandidates: Math.max(maxResults * 5, 50),
      }).map((result) => ({ item: result.understanding, score: result.score })))
      .filter(({ item }) => !excluded.has(item.id));
    for (const { item, score } of ranked) {
      const source = sourceDescription(item);
      if (items.length >= maxResults) {
        rejected.push({ recordId: item.id, reason: 'budget' });
        traceItems.push({ objectType: 'understanding', objectId: item.id, versionId: item.versionId,
          decision: 'budget_exceeded', reason: 'Maximum result count reached', content: item.statement,
          sourceLabel: source.label, origin: source.origin, score, injectedChars: 0 });
        continue;
      }
      let reason = rejectionReason(item, scopeInput, now, queryProfile.timeHints);
      if (selfReview && reason === 'scope_mismatch') reason = undefined;
      if (!reason && !selfReview && score <= MIN_RELEVANCE_SCORE) reason = 'low_score';
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
          reason, content: item.statement, sourceLabel: source.label, origin: source.origin, score, injectedChars: 0 });
        continue;
      }
      const plannedItem: PlannedUserContextItem = {
        recordId: item.id, objectType: 'understanding', versionId: item.versionId,
        content: selfReview ? `[${scopeLabel(item.scope, projects)}] ${item.statement}` : item.statement,
        score, section: sectionFor(item), citation: `user-context://${item.id}`, origin: source.origin, stability: item.confidence,
      };
      const nextSources = new Map(understandingSources).set(item.id, source.label);
      const nextChars = render({ items: [...items, plannedItem], understandingSources: nextSources }).length;
      if (nextChars > maxChars) {
        rejected.push({ recordId: item.id, reason: 'budget' });
        traceItems.push({ objectType: 'understanding', objectId: item.id, versionId: item.versionId, decision: 'budget_exceeded', reason: 'Context budget reached', content: item.statement, sourceLabel: source.label, origin: source.origin, score, injectedChars: 0 });
        continue;
      }
      const addedChars = nextChars - usedChars;
      usedChars = nextChars;
      understandingSources.set(item.id, source.label);
      items.push(plannedItem);
      traceItems.push({ objectType: 'understanding', objectId: item.id, versionId: item.versionId, decision: 'selected', reason: 'Relevant to this request', content: item.statement, sourceLabel: source.label, origin: source.origin, rank: items.length, score, injectedChars: addedChars });
    }

    const block = render();
    recordContextRun({ turnId: params.turnId, sessionKey: params.sessionKey, query, budget: maxChars,
      durationMs: Date.now() - started, items: traceItems });
    return { traceId, modelMessage: prependAgentContext(params.userMessage, block), items, rejected, consentRequests,
      estimatedTokens: Math.ceil(block.length / 4), allocation: params.allocation };
  }
}

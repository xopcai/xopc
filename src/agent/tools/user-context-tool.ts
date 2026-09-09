import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { retrievalLexicalSimilarity } from '../../retrieval/textFeatures.js';
import {
  getAssertionSlot,
  getUserAssertion,
  isWorkingAssumption,
  listUserAssertions,
  reconcileAssertion,
  setAssertionStatus,
} from '../../user-model/index.js';

export interface UserContextToolOptions {
  agentId: string;
  workspaceId: string;
  getSessionId: () => string | undefined;
  getProjectId?: () => string | undefined;
  canRead: () => boolean;
  canWrite?: () => boolean;
  getCurrentUserText?: () => string | undefined;
}

const SearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

const GetSchema = Type.Object({ id: Type.String() });

const UpdateSchema = Type.Object({
  id: Type.String(),
  action: Type.Union([
    Type.Literal('confirm'),
    Type.Literal('correct'),
    Type.Literal('reject'),
    Type.Literal('forget'),
    Type.Literal('review'),
  ]),
  replacement: Type.Optional(Type.String({ maxLength: 500 })),
  userEvidence: Type.String({ minLength: 1, maxLength: 500 }),
});

function visible(options: UserContextToolOptions, slotId: string): boolean {
  const scope = getAssertionSlot(slotId)?.scope;
  return scope?.type === 'global'
    || (scope?.type === 'agent' && scope.id === options.agentId)
    || (scope?.type === 'workspace' && scope.id === options.workspaceId)
    || (scope?.type === 'project' && scope.id === options.getProjectId?.())
    || (scope?.type === 'session' && scope.id === options.getSessionId());
}

function referenceable(assertion: NonNullable<ReturnType<typeof getUserAssertion>>): boolean {
  return (assertion.status === 'active' || isWorkingAssumption(assertion))
    && assertion.authority !== 'external_untrusted'
    && assertion.sensitivity !== 'secret'
    && assertion.sensitivity !== 'regulated'
    && assertion.disclosurePolicy !== 'ask_before_reference';
}

export function createUserContextSearchTool(options: UserContextToolOptions): AgentTool {
  return {
    name: 'user_context_search',
    label: 'User Context Search',
    description: 'Search typed user assertions such as identity, preferences, routines, and current state.',
    parameters: SearchSchema,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      if (!options.canRead()) {
        return { content: [{ type: 'text', text: 'User context is disabled for this session.' }], details: { error: 'user_context_disabled' } };
      }
      const input = raw as { query: string; maxResults?: number };
      const results = listUserAssertions({ statuses: ['active', 'candidate'], limit: 1_000 })
        .filter((assertion) => visible(options, assertion.slotId))
        .filter(referenceable)
        .map((assertion) => ({
          assertion,
          score: retrievalLexicalSimilarity(input.query, `${assertion.statement} ${assertion.normalizedValue}`),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, input.maxResults ?? 12)
        .map(({ assertion, score }) => ({
          id: assertion.id,
          kind: assertion.kind,
          statement: assertion.statement,
          status: assertion.status,
          authority: assertion.authority,
          score,
        }));
      return { content: [{ type: 'text', text: JSON.stringify({ results }, null, 2) }], details: { results } };
    },
  } as AgentTool;
}

export function createUserContextGetTool(options: UserContextToolOptions): AgentTool {
  return {
    name: 'user_context_get',
    label: 'User Context Get',
    description: 'Read one typed user assertion and its subject, predicate, and scope.',
    parameters: GetSchema,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      if (!options.canRead()) {
        return { content: [{ type: 'text', text: 'User context is disabled for this session.' }], details: { error: 'user_context_disabled' } };
      }
      const id = (raw as { id: string }).id;
      const assertion = getUserAssertion(id);
      if (!assertion || !visible(options, assertion.slotId) || !referenceable(assertion)) {
        return { content: [{ type: 'text', text: `User assertion not found: ${id}` }], details: { id } };
      }
      const result = { assertion, slot: getAssertionSlot(assertion.slotId) };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: result };
    },
  } as AgentTool;
}

export function createUserContextUpdateTool(options: UserContextToolOptions): AgentTool {
  return {
    name: 'user_context_update',
    label: 'User Context Update',
    description: 'Confirm, correct, reject, forget, or flag an existing user assertion. Use only when the current user explicitly confirms or requests the change; userEvidence must quote that request.',
    parameters: UpdateSchema,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      if (!options.canRead() || !options.canWrite?.()) {
        return { content: [{ type: 'text', text: 'User-context updates are disabled for this session.' }], details: { error: 'user_context_update_disabled' } };
      }
      const input = raw as {
        id: string;
        action: 'confirm' | 'correct' | 'reject' | 'forget' | 'review';
        replacement?: string;
        userEvidence: string;
      };
      const current = getUserAssertion(input.id);
      const slot = current ? getAssertionSlot(current.slotId) : undefined;
      if (!current || !slot || !visible(options, current.slotId)) {
        return { content: [{ type: 'text', text: `User assertion not found: ${input.id}` }], details: { error: 'assertion_not_found', id: input.id } };
      }
      const evidence = input.userEvidence.trim();
      if (!evidence) {
        return { content: [{ type: 'text', text: 'A quote from the current user message is required.' }], details: { error: 'user_evidence_required' } };
      }
      const currentUserText = options.getCurrentUserText?.();
      if (options.getCurrentUserText && (!currentUserText || !currentUserText.includes(evidence))) {
        return { content: [{ type: 'text', text: 'userEvidence must be an exact quote from the current user message.' }], details: { error: 'user_evidence_mismatch' } };
      }

      try {
        if (input.action === 'correct') {
          const replacement = input.replacement?.trim();
          if (!replacement) {
            return { content: [{ type: 'text', text: 'A replacement is required for correction.' }], details: { error: 'replacement_required' } };
          }
          const result = reconcileAssertion({
            subject: slot.subject,
            predicate: slot.predicate,
            cardinality: slot.cardinality,
            scope: slot.scope,
            kind: current.kind,
            value: replacement,
            normalizedValue: replacement.toLocaleLowerCase(),
            statement: replacement,
            authority: 'user_explicit',
            confidence: 1,
            ...(current.declaredImportance === undefined ? {} : { declaredImportance: current.declaredImportance }),
            inferredImportance: current.inferredImportance,
            consequence: current.consequence,
            actionability: current.actionability,
            volatility: current.volatility,
            sensitivity: current.sensitivity,
            disclosurePolicy: current.disclosurePolicy,
            applicability: current.applicability,
            observedAt: Date.now(),
            createdBy: 'user',
            correctionOfAssertionId: current.id,
          });
          const receipt = {
            action: 'corrected', assertion: result.assertion,
            previousAssertionId: current.id, userEvidence: evidence,
          };
          return { content: [{ type: 'text', text: JSON.stringify(receipt, null, 2) }], details: receipt };
        }

        const status = ({
          confirm: 'active', reject: 'rejected', forget: 'archived', review: 'needs_review',
        } as const)[input.action];
        const assertion = setAssertionStatus(current.id, status, {
          actor: 'user', reason: `User requested ${input.action}: ${evidence}`,
        });
        const receipt = { action: input.action, assertion, userEvidence: evidence };
        return { content: [{ type: 'text', text: JSON.stringify(receipt, null, 2) }], details: receipt };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: message }], details: { error: 'user_context_update_failed', message } };
      }
    },
  } as AgentTool;
}

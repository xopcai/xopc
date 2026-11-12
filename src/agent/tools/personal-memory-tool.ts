import { createHash } from 'node:crypto';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { Config } from '../../config/schema.js';
import { executeAtomicOperation } from '../../capabilities/runtime/atomic-operations.js';
import { deleteKnowledgeItem, getKnowledgeItem, knowledgeContentSources, reviewKnowledgeItem, canUseKnowledge,
  setKnowledgeScope, writeKnowledgeItem } from '../../knowledge-memory/index.js';
import { isUnquotedOwnerEvidence } from '../../memory-learning/owner-directive.js';
import { learningRoleSql, learningTranscriptMessage } from '../../memory-learning/transcript-source.js';
import { getPersonalAgentByConversation } from '../../personal-agent/repository.js';
import { createContextEvidence } from '../../storage/sqlite/context-evidence-repository.js';
import { createCollaborationRule } from '../../storage/sqlite/collaboration-rule-repository.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { memoryVersion } from '../../user-context/memory-version.js';
import { notifyUserContextChange } from '../../user-context/changes.js';
import { canUseAssertion, deleteUserAssertion, getAssertionSlot, getUserAssertion, reconcileAssertion,
  setAssertionStatus, setUserAssertionScope, type UserModelScope } from '../../user-model/index.js';
import { ownerExcludesGlobalScope, ownerMemoryScope, standingToolScope } from '../../user-model/capture/evidence-policy.js';
import { getSessionInteractionPolicy } from '../session/interaction-policy.js';
import { inferMemorySensitivity } from '../memory/sensitivity.js';
import { extractAgentUserPlainText } from '../memory/user-message-text.js';

const schema = Type.Object({
  command: Type.Union((['remember', 'correct', 'forget', 'scope'] as const).map(value => Type.Literal(value))),
  target: Type.Union([Type.Literal('user'), Type.Literal('knowledge')]),
  userEvidence: Type.String({ minLength: 1, maxLength: 1000 }),
  content: Type.Optional(Type.String({ minLength: 1, maxLength: 600 })),
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  version: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  scope: Type.Optional(Type.Union((['global', 'agent', 'workspace', 'project', 'session'] as const).map(value => Type.Literal(value)))),
  predicate: Type.Optional(Type.String({ pattern: '^[a-z][a-z0-9_.-]{2,119}$' })),
  userKind: Type.Optional(Type.Union((['identity', 'preference', 'value', 'routine', 'capability', 'relationship', 'current_state'] as const).map(value => Type.Literal(value)))),
  knowledgeKind: Type.Optional(Type.Union((['project_fact', 'workspace_fact', 'decision', 'task_lesson', 'commitment', 'open_question', 'episode', 'note'] as const).map(value => Type.Literal(value)))),
  validTo: Type.Optional(Type.Number({ minimum: 1 })),
}, { additionalProperties: false });

type Input = Static<typeof schema>;
type Receipt = {
  receiptId: string;
  status: 'saved' | 'pending' | 'forgotten';
  command: Input['command'];
  target: Input['target'];
  id: string;
  scope: UserModelScope;
  committedAt: number;
  effectiveFrom: 'next_turn';
  originalSourcesRetained?: boolean;
};

function visible(scope: UserModelScope, context: { agentId: string; workspaceId: string; conversationId: string; projectId?: string }): boolean {
  return scope.type === 'global' || scope.id === ({ agent: context.agentId, workspace: context.workspaceId,
    project: context.projectId, session: context.conversationId } as Record<string, string | undefined>)[scope.type];
}

function explicitRequest(text: string, quote: string, command: Input['command']): boolean {
  if (command === 'forget') return isUnquotedOwnerEvidence(text, quote);
  const author = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|^\s*>.*$/gmu, '')
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu, span => /记住|保存|纠正|修改|remember|save|correct|scope/iu.test(span) ? '' : span);
  if (!quote.trim() || !author.includes(quote.trim())) return false;
  if (command === 'remember') return !/不要.*(?:记住|保存)|别.*(?:记住|保存)|(?:don't|do not|never)\s+(?:remember|save|store)/iu.test(author)
    && /记住|保存|记下|记着|\b(?:remember|save|store)\b/iu.test(quote);
  return /纠正|修正|改成|改为|修改|更正|不是|仅|只(?:在|用|对)|范围|所有|全局|跨项目|\b(?:correct|change|update|instead|only|scope|global|globally|all|across)\b/iu.test(quote)
    && !/(?:不要|别|不必)(?:再)?(?:修改|更正|纠正)|(?:don't|do not|never)\s+(?:change|correct|update)/iu.test(author);
}

/** Explicit owner mutations use the existing domain transactions and atomic operation receipts. */
export function createPersonalMemoryTool(deps: {
  getConversationId: () => string | undefined;
  getCurrentUserText: () => string | undefined;
  getConfig: () => Config | undefined;
  agentId: string;
  workspaceId: string;
  getProjectId: () => string | undefined;
}): AgentTool {
  return {
    name: 'personal_memory', label: 'Manage memory', parameters: schema,
    description: 'Remember, correct, forget, or change the scope of memory only on an explicit current owner request. Quote that request and its scope qualifiers in userEvidence. User identity, preferences and standing collaboration instructions use target=user. Project facts, decisions and lessons use target=knowledge. A tool instruction for all operations of one type is not an instruction for all projects. For existing items first read their id and version with user_context_read or knowledge_read. Scope IDs come from the current conversation; never guess another agent/project. Report the committed receipt status and scope: saved is durable, pending is not yet usable, forgotten keeps original sources. Changes apply to future turns, not already running prompts. Memory never grants action authority.',
    async execute(_callId, raw) {
      const fail = (error: string) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ status: 'failed', error }) }], details: { status: 'failed', error }, isError: true });
      if (!Value.Check(schema, raw)) return fail('invalid_memory_arguments');
      const input = raw as Input;
      try {
        const conversationId = deps.getConversationId();
        const config = deps.getConfig();
        if (!conversationId || !config || !getPersonalAgentByConversation(conversationId)) return fail('personal_memory_unavailable');
        const interaction = getSessionInteractionPolicy(conversationId);
        if (interaction.mode === 'plan' || interaction.access === 'read-only') return fail('memory_write_denied');
        const access = resolveUserContextSessionAccess(config, conversationId);
        if (!(input.target === 'user' ? access.userModel : access.knowledge)) return fail('memory_access_denied');
        const writePolicy = input.target === 'user' ? config.userContext.userModel.writePolicy : config.userContext.knowledgeMemory.writePolicy;
        // A write deny still permits the owner to remove their existing memory.
        if (input.command !== 'forget' && writePolicy !== 'allow') return fail('memory_write_denied');
        const db = getSqliteDatabase();
        const transcriptId = readCurrentTranscriptId(db, conversationId);
        const source = db.prepare(`SELECT entry_id, role, payload_json FROM transcript_entries
          WHERE transcript_id = ? AND ${learningRoleSql('user')} ORDER BY seq DESC LIMIT 1`)
          .get(transcriptId) as { entry_id: string; role: string; payload_json: string } | undefined;
        const message = source && learningTranscriptMessage(source);
        const text = deps.getCurrentUserText();
        if (!source || !message || !text || !extractAgentUserPlainText(message).includes(text)
          || !explicitRequest(text, input.userEvidence, input.command)) return fail('explicit_current_user_request_required');
        const context = { agentId: deps.agentId, workspaceId: deps.workspaceId, conversationId, projectId: deps.getProjectId() };
        const resolveScope = (type: UserModelScope['type']): UserModelScope => {
          if (type === 'global') return { type };
          const id = ({ agent: context.agentId, workspace: context.workspaceId, project: context.projectId, session: conversationId })[type];
          if (!id) throw new Error(`missing_${type}_scope`);
          return { type, id };
        };
        const requestedScope = ownerMemoryScope(text, input.userEvidence);
        const localScope = requestedScope === 'global' ? undefined : requestedScope;
        if (localScope && input.scope && localScope !== input.scope) return fail('requested_scope_mismatch');
        const toolScope = input.command === 'remember'
          ? standingToolScope(text, input.userEvidence, Boolean(context.projectId)) : undefined;
        if (toolScope && input.target === 'knowledge') return fail('collaboration_instruction_requires_preference');
        if ((toolScope && input.scope && toolScope !== input.scope)
          || (requestedScope === 'global' && input.command === 'remember' && input.scope && input.scope !== 'global')) {
          return fail('requested_scope_mismatch');
        }
        if (input.command === 'scope' && input.scope === 'global' && requestedScope !== 'global') {
          return fail('explicit_global_scope_required');
        }
        const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        // Bind retries to the persisted owner utterance, even when the model changes tool-call IDs.
        const receipt = executeAtomicOperation({ principalId: 'local-owner', capabilityId: 'xopc.personal.memory',
          idempotencyKey: `${source.entry_id}:${digest}`, requestDigest: digest, descriptorDigest: 'chat-memory-v1', surface: 'personal_chat' }, operationId => {
          const now = Date.now();
          const user = input.target === 'user' && input.id ? getUserAssertion(input.id) : undefined;
          const slot = user && getAssertionSlot(user.slotId);
          const knowledge = input.target === 'knowledge' && input.id ? getKnowledgeItem(input.id) : undefined;
          const current = user || knowledge;
          const currentScope = slot?.scope ?? knowledge?.scope;
          if (input.command !== 'remember') {
            if (!current || !currentScope || !visible(currentScope, context) || (slot && slot.principalId !== 'local-owner') || (knowledge && (knowledge.principalId !== 'local-owner' || knowledge.recordClass !== 'memory'
              || !access.knowledgePolicy.scopes.includes(knowledge.scope.type)
              || !knowledgeContentSources(knowledge).every(kind => access.knowledgePolicy.contentSources.includes(kind))))) throw new Error('memory_not_found');
            if (!input.version || input.version !== memoryVersion(user ? { assertion: user, scope: currentScope } : knowledge)) throw new Error('memory_version_conflict_read_again');
          } else if (input.id || input.version) throw new Error('remember_does_not_accept_existing_id');
          if (input.command !== 'scope' && currentScope && requestedScope && currentScope.type !== requestedScope) throw new Error('requested_scope_mismatch');
          const scope = input.command === 'scope'
            ? (input.scope ?? requestedScope) ? resolveScope((input.scope ?? requestedScope)!) : undefined
            : currentScope ?? resolveScope(input.scope ?? requestedScope ?? toolScope
              ?? (input.target === 'user' && !ownerExcludesGlobalScope(text, input.userEvidence) ? 'global' : context.projectId ? 'project' : 'workspace'));
          if (!scope) throw new Error('scope_required');
          if (scope.type === 'global' && ownerExcludesGlobalScope(text, input.userEvidence)) throw new Error('requested_scope_mismatch');
          if (input.target === 'knowledge' && input.command !== 'forget'
            && (!access.knowledgePolicy.scopes.includes(scope.type) || !access.knowledgePolicy.contentSources.includes('memory'))) throw new Error('memory_scope_denied');
          if (input.command !== 'scope' && input.command !== 'remember' && input.scope) {
            const suppliedScope = resolveScope(input.scope);
            if (suppliedScope.type !== scope.type || suppliedScope.id !== scope.id) throw new Error('use_scope_command_to_change_scope');
          }
          let id = input.id!;
          let status: Receipt['status'] = 'saved';
          if (input.command === 'forget') {
            // Reuse the same value-free history boundary used by background forgetting.
            const links = db.prepare(`SELECT DISTINCT e.conversation_id FROM context_evidence e WHERE e.conversation_id IS NOT NULL
              AND (e.evidence_id IN (SELECT evidence_id FROM user_assertion_evidence WHERE assertion_id IN (SELECT assertion_id FROM user_assertions WHERE slot_id = ?))
                OR e.evidence_id IN (SELECT evidence_id FROM knowledge_evidence_links WHERE knowledge_id = ?)
                OR e.message_id IN (SELECT value FROM knowledge_revisions r, json_each(r.source_json, '$.evidenceRefs') WHERE r.knowledge_id = ?))`)
              .all(user?.slotId ?? '', knowledge?.id ?? '', knowledge?.id ?? '') as Array<{ conversation_id: string }>;
            const sources = [...new Set([conversationId, knowledge?.sourceConversationId, ...links.map(link => link.conversation_id)].filter(Boolean))];
            createCollaborationRule({ category: 'boundary', priority: 0, scope, status: 'active',
              conditions: { enforcementLevel: 'prompt', forgottenHistoryEntries: sources.map(id => `${id}:*`) },
              statement: 'Do not automatically recall forgotten information from the marked original conversations.' });
            if (!(user ? deleteUserAssertion(id) : deleteKnowledgeItem(id, now, { includeRelated: false }))) throw new Error('memory_delete_failed');
            status = 'forgotten';
          } else if (input.command === 'scope') {
            if (user) {
              const moved = setUserAssertionScope(id, scope);
              status = canUseAssertion(moved, now, { use: 'answer', agentId: context.agentId }) ? 'saved' : 'pending';
            } else {
              const moved = setKnowledgeScope(id, scope);
              status = canUseKnowledge(moved, context, access.knowledgePolicy) ? 'saved' : 'pending';
            }
          } else {
            const content = input.content?.trim();
            if (!content) throw new Error('content_required');
            const sensitivity = inferMemorySensitivity(`${content}\n${input.userEvidence}`);
            if (sensitivity === 'secret' || sensitivity === 'regulated') throw new Error('sensitive_memory_denied');
            const personal = sensitivity === 'personal' || user?.sensitivity === 'personal';
            const sensitivePolicy = config.userContext.userModel.sensitiveWritePolicy;
            if (personal && sensitivePolicy === 'deny') throw new Error('sensitive_memory_denied');
            const evidence = createContextEvidence({ sourceType: 'conversation', sourceRef: `chat-memory:${source.entry_id}:${digest}`,
              conversationId, messageId: source.entry_id, trustLevel: 'owner', redactedExcerpt: input.userEvidence, observedAt: now });
            if (input.target === 'user') {
              if (!slot && !input.predicate) throw new Error('predicate_required');
              const result = reconcileAssertion({
                subject: slot?.subject ?? { type: 'user', id: 'self' }, predicate: slot?.predicate ?? input.predicate!,
                cardinality: slot?.cardinality ?? 'single', scope, kind: user?.kind ?? input.userKind ?? 'preference',
                value: content, normalizedValue: content.normalize('NFKC').toLowerCase(), statement: content,
                authority: 'user_explicit', confidence: 1, inferredImportance: user?.inferredImportance ?? 0.7,
                consequence: user?.consequence ?? 'medium', actionability: user?.actionability ?? 0.8,
                volatility: user?.volatility ?? (input.userKind === 'current_state' ? 'dynamic' : 'stable'),
                sensitivity: personal ? 'personal' : user?.sensitivity ?? 'normal',
                disclosurePolicy: user?.disclosurePolicy ?? 'referenceable', applicability: user?.applicability,
                domain: user?.domain, layer: user?.layer, sensitivityCategories: user?.sensitivityCategories,
                purposeIds: user?.purposeIds, allowedUses: user?.allowedUses, allowedAgentIds: user?.allowedAgentIds,
                validFrom: user?.validFrom, reviewAt: user?.reviewAt, deleteAfter: user?.deleteAfter,
                validTo: input.validTo ?? user?.validTo, observedAt: now, createdBy: 'user', evidenceId: evidence.id,
                ...(user ? { correctionOfAssertionId: user.id } : {}),
              });
              if (!result.assertion) throw new Error('memory_suppressed');
              id = result.assertion.id;
              if (personal && sensitivePolicy === 'confirm') setAssertionStatus(id, 'needs_review', { actor: 'user', reason: 'Sensitive memory requires review.' });
              status = canUseAssertion(getUserAssertion(id)!, now, { use: 'answer', agentId: context.agentId }) ? 'saved' : 'pending';
            } else if (knowledge) {
              if (input.validTo !== undefined) throw new Error('change_expiry_in_memory_management');
              const item = reviewKnowledgeItem({ id, action: 'edit_and_approve', content, actor: 'user', reason: 'Explicit correction in chat.', expectedStatus: knowledge.status,
                evidence: [{ id: evidence.id, contentHash: evidence.contentHash }], source: { tool: 'personal_memory', evidenceRefs: [source.entry_id] } });
              if (!item) throw new Error('memory_not_found');
              if (personal && sensitivePolicy === 'confirm') throw new Error('sensitive_correction_requires_management_review');
              status = canUseKnowledge(item, context, access.knowledgePolicy) ? 'saved' : 'pending';
            } else {
              const result = writeKnowledgeItem({ scope, kind: input.knowledgeKind ?? 'note', content,
                canonicalKey: `chat:${memoryVersion(content.normalize('NFKC').toLowerCase())}`,
                status: personal && sensitivePolicy === 'confirm' ? 'needs_review' : 'active',
                verification: 'supported', claimMode: 'explicit', confidence: 1, importance: 0.7, originClass: 'owner',
                sourceAgentId: context.agentId, sourceConversationId: conversationId, sensitivity, validTo: input.validTo,
                evidence: [{ id: evidence.id, contentHash: evidence.contentHash }], source: { tool: 'personal_memory', evidenceRefs: [source.entry_id] } });
              if (!result.item) throw new Error('memory_suppressed');
              id = result.item.id;
              status = canUseKnowledge(result.item, context, access.knowledgePolicy) ? 'saved' : 'pending';
            }
          }
          // Do not retain memory text in operation receipts: forgetting must not leave a second copy.
          return { receiptId: operationId, status, command: input.command, target: input.target, id, scope,
            committedAt: now, effectiveFrom: 'next_turn', ...(status === 'forgotten' ? { originalSourcesRetained: true } : {}) } satisfies Receipt;
        }) as Receipt;
        notifyUserContextChange({ kind: 'session', id: conversationId });
        const assertion = receipt.target === 'user' ? getUserAssertion(receipt.id) : undefined;
        const item = receipt.target === 'knowledge' ? getKnowledgeItem(receipt.id) : undefined;
        const currentScope = assertion ? getAssertionSlot(assertion.slotId)?.scope : item?.scope;
        const current = assertion ?? item;
        const result = { ...receipt, committedScope: receipt.scope, scope: currentScope ?? receipt.scope,
          ...(current ? { version: memoryVersion(assertion ? { assertion, scope: currentScope } : item) } : {}),
          available: Boolean(current), usable: assertion
            ? canUseAssertion(assertion, Date.now(), { use: 'answer', agentId: context.agentId })
            : item ? canUseKnowledge(item, context, access.knowledgePolicy) : false };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      } catch (error) { return fail(error instanceof Error ? error.message : 'memory_operation_failed'); }
    },
  } as AgentTool;
}

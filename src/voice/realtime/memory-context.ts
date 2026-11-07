import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { resolveKnowledgeReadPolicy } from '../../user-context/config.js';
import { canUseKnowledge } from '../../knowledge-memory/index.js';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { buildExecutionContext } from '../../agent/context/execution-context.js';
import type { Config } from '../../config/schema.js';
import { getKnowledgeItem } from '../../knowledge-memory/index.js';
import { getConversation, getConversationRouting } from '../../routing/session-key.js';
import { getSessionConfig } from '../../storage/sqlite/config-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { getUserAssertion } from '../../user-model/index.js';
import { canUseAssertion } from '../../user-model/usage-policy.js';
import { onUserContextChange } from '../../user-context/changes.js';
import { stripRuntimeContextFromUserMessage } from '../../session/user-message-display.js';
import { isVoiceAgentInstruction, isVoiceDelegationMessage } from '../../session/voice-transcript.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Voice:Memory');

export interface VoiceMemorySnapshot {
  block: string;
  references: Array<{ kind: 'assertion' | 'knowledge'; id: string; updatedAt: number }>;
  isCurrent: () => boolean;
  subscribe: (invalidate: () => void) => () => void;
}

export function voiceMemoryEnabled(config: Config, conversationId: string): boolean {
  const parsed = getConversationRouting(conversationId);
  const conversation = getConversation(conversationId);
  const explicitlyPrivate = conversation?.sessionType === 'chat' && parsed?.peerKind === 'direct';
  const user = config.userContext;
  if (!parsed || !explicitlyPrivate || parsed.peerKind !== 'direct' || !user.enabled
    || !user.userModel.enabled || !user.contextPlanning.enabled) return false;
  const mode = getSessionConfig(conversationId)?.userContextMode;
  return mode === undefined || mode === 'enabled';
}

export function voiceMemoryQuery(history: AgentMessage[]): string {
  return history.filter((message) => message.role === 'user').filter(message => !isVoiceAgentInstruction(message) && !isVoiceDelegationMessage(message)).slice(-2).map((message) => {
    const text = typeof message.content === 'string' ? message.content : message.content
      .filter((part) => part.type === 'text').map((part) => part.type === 'text' ? part.text : '').join('\n');
    return stripRuntimeContextFromUserMessage(text).slice(-300);
  }).join('\n').slice(-600);
}

export function buildVoiceMemoryContext(input: {
  getConfig: () => Config;
  conversationId: string;
  workspaceId: string;
  projectId?: string;
  history: AgentMessage[];
  maxChars: number;
}): VoiceMemorySnapshot | undefined {
  const started = performance.now();
  try {
    const config = input.getConfig();
    if (!resolveUserContextSessionAccess(config, input.conversationId).userModel || !voiceMemoryEnabled(config, input.conversationId) || input.maxChars < 128) return;
    const session = getSessionMetadata(input.conversationId);
    const context = buildExecutionContext({
      query: voiceMemoryQuery(input.history),
      agentId: session?.agentId ?? 'main',
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      maxAssertions: 6,
      maxKnowledge: 3,
      includeKnowledge: resolveUserContextSessionAccess(config, input.conversationId).knowledge,
      knowledgePolicy: resolveKnowledgeReadPolicy(config.userContext.knowledgeMemory),
    });
    const memory = { confirmedFacts: [] as string[], workingAssumptions: [] as string[], priorities: [] as string[], knowledge: [] as string[] };
    let omittedItems = 0;
    const serialize = () => JSON.stringify({ backgroundMemory: { ...memory, omittedItems } });
    if (serialize().length > input.maxChars) return;
    const references: VoiceMemorySnapshot['references'] = [];
    const add = (target: string[], text: string, reference?: VoiceMemorySnapshot['references'][number]) => {
      target.push(text);
      // Reserve enough space for the final omission count without cutting a fact in half.
      if (serialize().length + 8 > input.maxChars) { target.pop(); omittedItems++; return; }
      if (reference) references.push(reference);
    };
    for (const item of [...context.assertions].sort((left, right) => Number(right.usage === 'confirmed') - Number(left.usage === 'confirmed'))) {
      add(item.usage === 'confirmed' ? memory.confirmedFacts : memory.workingAssumptions,
        item.assertion.statement, { kind: 'assertion', id: item.assertion.id, updatedAt: item.assertion.recordedAt });
    }
    for (const item of context.priorities) add(memory.priorities, `${item.rank}: ${item.targetType}/${item.targetId}`);
    for (const item of context.knowledge) add(memory.knowledge, item.content, { kind: 'knowledge', id: item.id, updatedAt: item.updatedAt });
    if (!Object.values(memory).some(items => items.length)) return;
    const block = serialize();
    const configVersion = JSON.stringify(config.userContext);
    const isCurrent = () => {
      if (!voiceMemoryEnabled(input.getConfig(), input.conversationId)
        || JSON.stringify(input.getConfig().userContext) !== configVersion) return false;
      return references.every((reference) => reference.kind === 'assertion'
        ? (() => { const item = getUserAssertion(reference.id); return Boolean(item && item.recordedAt === reference.updatedAt
          && canUseAssertion(item, Date.now(), { use: 'answer', agentId: session?.agentId ?? 'main' })); })()
        : (() => { const item = getKnowledgeItem(reference.id); return Boolean(item && item.updatedAt === reference.updatedAt
          && canUseKnowledge(item, { agentId: session?.agentId ?? 'main', workspaceId: input.workspaceId,
            projectId: input.projectId, conversationId: input.conversationId }, resolveKnowledgeReadPolicy(input.getConfig().userContext.knowledgeMemory))); })());
    };
    log.debug({ conversationId: input.conversationId, selectedCount: references.length,
      contextChars: block.length, durationMs: performance.now() - started }, 'Native voice memory selected');
    return { block, references, isCurrent, subscribe: invalidate => onUserContextChange(change => {
      if (change.kind === 'policy' || change.id === input.conversationId) invalidate();
    }) };
  } catch (err) {
    log.warn({ err, conversationId: input.conversationId, durationMs: performance.now() - started },
      'Native voice memory unavailable; continuing with chat history');
    return;
  }
}

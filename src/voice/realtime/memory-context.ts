import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { buildExecutionContext } from '../../agent/context/execution-context.js';
import type { Config } from '../../config/schema.js';
import { getKnowledgeItem } from '../../knowledge-memory/index.js';
import { getConversation, getConversationRouting } from '../../routing/session-key.js';
import { getSessionConfig } from '../../storage/sqlite/config-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { getUserAssertion } from '../../user-model/index.js';
import { stripRuntimeContextFromUserMessage } from '../../session/user-message-display.js';
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
  return history.filter((message) => message.role === 'user').slice(-2).map((message) => {
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
    if (!voiceMemoryEnabled(config, input.conversationId) || input.maxChars < 128) return;
    const session = getSessionMetadata(input.conversationId);
    const context = buildExecutionContext({
      query: voiceMemoryQuery(input.history),
      agentId: session?.routing?.agentId ?? 'main',
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      maxAssertions: 6,
      maxKnowledge: 3,
    });
    const block = JSON.stringify({
      backgroundMemory: {
        userFacts: context.assertions.map((item) => item.assertion.statement),
        priorities: context.priorities.map((item) => `${item.rank}: ${item.targetType}/${item.targetId}`),
        knowledge: context.knowledge.map((item) => item.content),
      },
    });
    if (block.length > input.maxChars || block === '{"backgroundMemory":{"userFacts":[],"priorities":[],"knowledge":[]}}') return;
    const references: VoiceMemorySnapshot['references'] = [
      ...context.assertions.map((item) => ({
        kind: 'assertion' as const,
        id: item.assertion.id,
        updatedAt: item.assertion.recordedAt,
      })),
      ...context.knowledge.map((item) => ({ kind: 'knowledge' as const, id: item.id, updatedAt: item.updatedAt })),
    ];
    const configVersion = JSON.stringify(config.userContext);
    const isCurrent = () => {
      if (!voiceMemoryEnabled(input.getConfig(), input.conversationId)
        || JSON.stringify(input.getConfig().userContext) !== configVersion) return false;
      return references.every((reference) => reference.kind === 'assertion'
        ? getUserAssertion(reference.id)?.recordedAt === reference.updatedAt
        : getKnowledgeItem(reference.id)?.updatedAt === reference.updatedAt);
    };
    log.debug({ conversationId: input.conversationId, selectedCount: references.length,
      contextChars: block.length, durationMs: performance.now() - started }, 'Native voice memory selected');
    return { block, references, isCurrent, subscribe: () => () => {} };
  } catch {
    log.warn({ conversationId: input.conversationId, durationMs: performance.now() - started },
      'Native voice memory unavailable; continuing with chat history');
    return;
  }
}

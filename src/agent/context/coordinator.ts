import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { KnowledgeReadPolicy } from '../../knowledge-memory/index.js';
import type { MemorySearchResult } from '../memory/types.js';
import { assembleTaskContext } from '../../tasks/task-context-assembler.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';
import { recordExecutionContext } from './audit.js';
import { extractAgentUserPlainText } from '../memory/user-message-text.js';
import {
  buildExecutionContext,
  fitExecutionContextToChars,
  type ExecutionContext,
} from './execution-context.js';

export interface ExecutionContextPlan {
  traceId: string;
  dynamicSystemContext?: string;
  executionContext?: ExecutionContext;
  estimatedTokens: number;
  contextChars: number;
  contextItemCount: number;
}

export interface ExecutionContextCoordinatorOptions {
  getConfig: () => Config | undefined;
  getAccessForSession: (conversationId: string) => {
    userModel: boolean;
    knowledge: boolean;
    knowledgePolicy: KnowledgeReadPolicy;
  };
  getWorkspaceIdForSession: (conversationId: string) => string;
  getProjectIdForSession: (conversationId: string) => string | undefined;
  ensureMemoryReady: (conversationId: string) => Promise<void>;
  searchExternalMemory: (input: {
    query: string;
    conversationId: string;
    agentId: string;
    workspaceId: string;
    projectId?: string;
    maxResults: number;
  }) => Promise<MemorySearchResult[]>;
}

export class ExecutionContextCoordinator {
  private readonly currentBySession = new Map<string, ExecutionContext>();

  constructor(private readonly options: ExecutionContextCoordinatorOptions) {}

  forgetSession(conversationId: string): void {
    this.currentBySession.delete(conversationId);
  }

  clear(): void {
    this.currentBySession.clear();
  }

  getCurrent(conversationId: string): ExecutionContext | undefined {
    return this.currentBySession.get(conversationId);
  }

  async prepare(
    userMessage: AgentMessage,
    conversationId: string,
    turnId: string,
  ): Promise<ExecutionContextPlan> {
    const empty = (): ExecutionContextPlan => ({
      traceId: '',
      estimatedTokens: 0,
      contextChars: 0,
      contextItemCount: 0,
    });
    const config = this.options.getConfig();
    const access = this.options.getAccessForSession(conversationId);
    if (!config || !config.userContext.contextPlanning.enabled
      || (!access.userModel && !access.knowledge)) return empty();

    await this.options.ensureMemoryReady(conversationId);

    const task = assembleTaskContext(conversationId, extractAgentUserPlainText(userMessage));
    const agentId = extractProfileAgentId(conversationId, config);
    const workspaceId = this.options.getWorkspaceIdForSession(conversationId);
    const projectId = this.options.getProjectIdForSession(conversationId);
    const maxKnowledge = Math.min(config.userContext.contextPlanning.maxKnowledge, task.allocation.maxResults);
    const strategy = config.userContext.knowledgeMemory.searchStrategy;
    const canSearchExternal = access.knowledge
      && access.knowledgePolicy.contentSources.includes('connector')
      && strategy !== 'local-only'
      && maxKnowledge > 0;
    const externalResults = canSearchExternal
      ? await this.options.searchExternalMemory({
          query: task.retrievalQuery,
          conversationId,
          agentId,
          workspaceId,
          projectId,
          maxResults: maxKnowledge,
        })
      : [];
    const externalReserved = strategy === 'external-only' || strategy === 'external-first'
      ? Math.min(maxKnowledge, externalResults.length)
      : strategy === 'fanout'
        ? Math.min(Math.ceil(maxKnowledge / 2), externalResults.length)
        : 0;
    const localBudget = strategy === 'external-only' ? 0 : maxKnowledge - externalReserved;
    const context = buildExecutionContext({
      query: task.retrievalQuery,
      agentId,
      workspaceId,
      projectId,
      conversationId: conversationId,
      maxAssertions: Math.min(config.userContext.contextPlanning.maxAssertions, task.allocation.maxResults),
      maxKnowledge: localBudget,
      includeUserModel: access.userModel,
      includeKnowledge: access.knowledge && strategy !== 'external-only',
      knowledgePolicy: access.knowledgePolicy,
    });
    const remainingKnowledge = Math.max(0, maxKnowledge - context.knowledge.length);
    context.externalKnowledge = externalResults.slice(0, remainingKnowledge);
    this.currentBySession.set(conversationId, context);
    const maxChars = Math.min(config.userContext.contextPlanning.maxChars, task.allocation.maxChars);
    const fitted = fitExecutionContextToChars(context, maxChars);
    const rendered = fitted.rendered;
    const contextItemCount = fitted.context.rules.length + fitted.context.assertions.length
      + fitted.context.goals.length + fitted.context.priorities.length + fitted.context.knowledge.length
      + fitted.context.externalKnowledge.length;
    recordExecutionContext(context, {
      turnId,
      conversationId: conversationId,
      budget: {
        maxAssertions: Math.min(config.userContext.contextPlanning.maxAssertions, task.allocation.maxResults),
        maxKnowledge,
        maxChars,
      },
      renderedChars: rendered.length,
      includedContext: fitted.context,
    });
    return {
      traceId: context.traceId,
      dynamicSystemContext: rendered,
      executionContext: context,
      estimatedTokens: Math.ceil(rendered.length / 4),
      contextChars: rendered.length,
      contextItemCount,
    };
  }
}

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { KnowledgeSource } from '../../knowledge-memory/index.js';
import { assembleTaskContext } from '../../tasks/task-context-assembler.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';
import { recordExecutionContext } from './audit.js';
import { prependAgentContext } from './prepend.js';
import { extractAgentUserPlainText } from '../memory/user-message-text.js';
import {
  buildExecutionContext,
  fitExecutionContextToChars,
  type ExecutionContext,
} from './execution-context.js';

export interface ExecutionContextPlan {
  traceId: string;
  modelMessage: AgentMessage;
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
    knowledgeSources: readonly KnowledgeSource[];
  };
  getWorkspaceIdForSession: (conversationId: string) => string;
  getProjectIdForSession: (conversationId: string) => string | undefined;
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
      modelMessage: userMessage,
      estimatedTokens: 0,
      contextChars: 0,
      contextItemCount: 0,
    });
    const config = this.options.getConfig();
    const access = this.options.getAccessForSession(conversationId);
    if (!config || !config.userContext.contextPlanning.enabled
      || (!access.userModel && !access.knowledge)) return empty();

    const task = assembleTaskContext(conversationId, extractAgentUserPlainText(userMessage));
    const context = buildExecutionContext({
      query: task.retrievalQuery,
      agentId: extractProfileAgentId(conversationId, config),
      workspaceId: this.options.getWorkspaceIdForSession(conversationId),
      projectId: this.options.getProjectIdForSession(conversationId),
      conversationId: conversationId,
      maxAssertions: Math.min(config.userContext.contextPlanning.maxAssertions, task.allocation.maxResults),
      maxKnowledge: Math.min(config.userContext.contextPlanning.maxKnowledge, task.allocation.maxResults),
      includeUserModel: access.userModel,
      includeKnowledge: access.knowledge,
      knowledgeSources: access.knowledgeSources,
    });
    this.currentBySession.set(conversationId, context);
    const maxChars = Math.min(config.userContext.contextPlanning.maxChars, task.allocation.maxChars);
    const fitted = fitExecutionContextToChars(context, maxChars);
    const rendered = fitted.rendered;
    const contextItemCount = fitted.context.rules.length + fitted.context.assertions.length
      + fitted.context.goals.length + fitted.context.priorities.length + fitted.context.knowledge.length;
    recordExecutionContext(context, {
      turnId,
      conversationId: conversationId,
      budget: {
        maxAssertions: Math.min(config.userContext.contextPlanning.maxAssertions, task.allocation.maxResults),
        maxKnowledge: Math.min(config.userContext.contextPlanning.maxKnowledge, task.allocation.maxResults),
        maxChars,
      },
      renderedChars: rendered.length,
      includedContext: fitted.context,
    });
    return {
      traceId: context.traceId,
      modelMessage: prependAgentContext(userMessage, rendered),
      executionContext: context,
      estimatedTokens: Math.ceil(rendered.length / 4),
      contextChars: rendered.length,
      contextItemCount,
    };
  }
}

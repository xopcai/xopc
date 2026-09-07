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
  getAccessForSession: (sessionKey: string) => {
    userModel: boolean;
    knowledge: boolean;
    knowledgeSources: readonly KnowledgeSource[];
  };
  getWorkspaceIdForSession: (sessionKey: string) => string;
  getProjectIdForSession: (sessionKey: string) => string | undefined;
}

export class ExecutionContextCoordinator {
  private readonly currentBySession = new Map<string, ExecutionContext>();

  constructor(private readonly options: ExecutionContextCoordinatorOptions) {}

  forgetSession(sessionKey: string): void {
    this.currentBySession.delete(sessionKey);
  }

  clear(): void {
    this.currentBySession.clear();
  }

  getCurrent(sessionKey: string): ExecutionContext | undefined {
    return this.currentBySession.get(sessionKey);
  }

  async prepare(
    userMessage: AgentMessage,
    sessionKey: string,
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
    const access = this.options.getAccessForSession(sessionKey);
    if (!config || !config.userContext.contextPlanning.enabled
      || (!access.userModel && !access.knowledge)) return empty();

    const task = assembleTaskContext(sessionKey, extractAgentUserPlainText(userMessage));
    const context = buildExecutionContext({
      query: task.retrievalQuery,
      agentId: extractProfileAgentId(sessionKey, config),
      workspaceId: this.options.getWorkspaceIdForSession(sessionKey),
      projectId: this.options.getProjectIdForSession(sessionKey),
      sessionId: sessionKey,
      maxAssertions: Math.min(config.userContext.contextPlanning.maxAssertions, task.allocation.maxResults),
      maxKnowledge: Math.min(config.userContext.contextPlanning.maxKnowledge, task.allocation.maxResults),
      includeUserModel: access.userModel,
      includeKnowledge: access.knowledge,
      knowledgeSources: access.knowledgeSources,
    });
    this.currentBySession.set(sessionKey, context);
    const maxChars = Math.min(config.userContext.contextPlanning.maxChars, task.allocation.maxChars);
    const fitted = fitExecutionContextToChars(context, maxChars);
    const rendered = fitted.rendered;
    const contextItemCount = fitted.context.rules.length + fitted.context.assertions.length
      + fitted.context.goals.length + fitted.context.priorities.length + fitted.context.knowledge.length;
    recordExecutionContext(context, {
      turnId,
      sessionId: sessionKey,
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

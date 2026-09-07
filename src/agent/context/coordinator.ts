import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { parseSessionKey } from '../../routing/session-key.js';
import { assembleTaskContext } from '../../tasks/task-context-assembler.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';
import { recordExecutionContext } from './audit.js';
import { prependAgentContext } from './prepend.js';
import { extractAgentUserPlainText } from '../memory/user-message-text.js';
import {
  buildExecutionContext,
  renderExecutionContext,
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
  isEnabledForSession: (sessionKey: string) => boolean;
  getWorkspaceIdForSession: (sessionKey: string) => string;
  getProjectIdForSession: (sessionKey: string) => string | undefined;
}

function isPrivateSession(sessionKey: string): boolean {
  const parsed = parseSessionKey(sessionKey);
  return !parsed || parsed.peerKind === 'direct';
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
    if (!config || !config.userContext.contextPlanning.enabled
      || !this.options.isEnabledForSession(sessionKey) || !isPrivateSession(sessionKey)) return empty();

    const task = assembleTaskContext(sessionKey, extractAgentUserPlainText(userMessage));
    const context = buildExecutionContext({
      query: task.retrievalQuery,
      agentId: extractProfileAgentId(sessionKey, config),
      workspaceId: this.options.getWorkspaceIdForSession(sessionKey),
      projectId: this.options.getProjectIdForSession(sessionKey),
      sessionId: sessionKey,
      maxAssertions: Math.min(config.userContext.contextPlanning.maxAssertions, task.allocation.maxResults),
      maxKnowledge: Math.min(config.userContext.contextPlanning.maxKnowledge, task.allocation.maxResults),
    });
    this.currentBySession.set(sessionKey, context);
    const rendered = renderExecutionContext(context).slice(
      0,
      Math.min(config.userContext.contextPlanning.maxChars, task.allocation.maxChars),
    );
    const contextItemCount = context.rules.length + context.assertions.length
      + context.goals.length + context.priorities.length + context.knowledge.length;
    recordExecutionContext(context, {
      turnId,
      sessionId: sessionKey,
      budget: {
        maxAssertions: Math.min(config.userContext.contextPlanning.maxAssertions, task.allocation.maxResults),
        maxKnowledge: Math.min(config.userContext.contextPlanning.maxKnowledge, task.allocation.maxResults),
        maxChars: Math.min(config.userContext.contextPlanning.maxChars, task.allocation.maxChars),
      },
      renderedChars: rendered.length,
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

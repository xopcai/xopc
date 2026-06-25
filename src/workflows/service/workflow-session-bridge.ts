import { randomUUID } from 'node:crypto';

import type { GatewayWorkflowHost } from '../../gateway/gateway-workflow-host.types.js';
import { renderWorkflowText } from '../../agent/workflow/snapshot.js';
import type { SessionStore } from '../../session/store.js';
import { SessionStatus } from '../../session/types.js';
import type { WorkflowRunView } from '../domain/index.js';
import { isTerminalWorkflowRunStatus } from '../domain/index.js';
import { GoalWorkflowJudge } from '../../goals/index.js';

import { runViewToSnapshot } from './run-view-to-snapshot.js';
import { buildWorkflowRunSessionKey } from './workflow-session-key.js';

export const WORKFLOW_SESSION_TYPE = 'workflow-run';
export const WORKFLOW_RUN_LINK_CONTEXT_KIND = 'workflow-run-link';

export interface PrepareWorkflowRunSessionParams {
  runId: string;
  agentId: string;
  definitionId: string;
  definitionTitle: string;
  goal: string;
  parentSessionKey?: string;
}

export interface PrepareWorkflowRunSessionResult {
  sessionKey: string;
}

export class WorkflowSessionBridge {
  private readonly terminalPersistedRunIds = new Set<string>();

  constructor(private readonly gateway: GatewayWorkflowHost) {}

  async prepareRunSession(params: PrepareWorkflowRunSessionParams): Promise<PrepareWorkflowRunSessionResult> {
    const sessionKey = buildWorkflowRunSessionKey(params.agentId, params.runId);
    const goalText = formatWorkflowGoalUserMessage(params.definitionId, params.goal);
    const sessionName = truncateSessionName(params.goal.trim() || params.definitionTitle || params.definitionId);

    const store = this.gateway.sessionIndexInstance.getStore();
    await store.resolveTranscriptPath(sessionKey, {
      metadata: {
        sessionType: WORKFLOW_SESSION_TYPE,
        hiddenFromSessionList: true,
        sourceChannel: 'workflow',
        sourceChatId: params.runId,
        routing: {
          agentId: params.agentId,
          source: 'workflow',
          accountId: 'default',
          peerKind: 'run',
          peerId: params.runId,
        },
      },
    });
    await store.updateMetadata(sessionKey, {
      sessionType: WORKFLOW_SESSION_TYPE,
      hiddenFromSessionList: true,
      workflowRunId: params.runId,
      workflowDefinitionId: params.definitionId,
      name: sessionName,
      tags: ['workflow', params.definitionId],
      customData: {
        workflowRunId: params.runId,
        workflowDefinitionId: params.definitionId,
        workflowGoal: params.goal,
        ...(params.parentSessionKey ? { parentSessionKey: params.parentSessionKey } : {}),
      },
    });

    await store.appendTranscriptMessage(sessionKey, {
      role: 'user',
      content: [{ type: 'text', text: goalText }],
      timestamp: Date.now(),
    });

    if (params.parentSessionKey?.trim()) {
      await this.writeParentRunLink({
        parentSessionKey: params.parentSessionKey.trim(),
        runId: params.runId,
        workflowSessionKey: sessionKey,
        definitionId: params.definitionId,
        goal: params.goal,
        status: 'running',
      });
    }

    this.gateway.emit('session.updated', { key: sessionKey, name: sessionName });
    return { sessionKey };
  }

  async handleRunViewUpdated(view: WorkflowRunView): Promise<void> {
    const runId = view.run.id;
    const sessionKey = view.run.metadata?.sessionKey?.trim();
    if (!sessionKey || !isTerminalWorkflowRunStatus(view.run.status)) {
      return;
    }
    if (this.terminalPersistedRunIds.has(runId)) {
      return;
    }
    this.terminalPersistedRunIds.add(runId);

    await this.persistTerminalTranscript(sessionKey, view);

    const parentSessionKey = readParentSessionKey(view);
    if (parentSessionKey) {
      await this.writeParentRunLink({
        parentSessionKey,
        runId,
        workflowSessionKey: sessionKey,
        definitionId: view.run.definitionId,
        goal: view.run.goal,
        status: view.run.status,
      });
    }
    await new GoalWorkflowJudge().handleTerminalWorkflowRun({
      config: this.gateway.currentConfig,
      view,
      sessionKey,
    });
  }

  private async persistTerminalTranscript(sessionKey: string, view: WorkflowRunView): Promise<void> {
    const store = this.gateway.sessionIndexInstance.getStore();
    const snapshot = runViewToSnapshot(view);
    const toolCallId = randomUUID();
    const completed = view.run.status === 'succeeded';
    const resultText = renderWorkflowText(snapshot, completed, { showResultPreviews: true });
    const envelope = {
      content: [{ type: 'text', text: resultText }],
      details: snapshot,
    };
    const isError = view.run.status === 'failed' || view.run.status === 'timeout';

    await store.appendTranscriptMessage(sessionKey, {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: toolCallId,
          name: 'workflow',
          arguments: { name: view.run.definitionId },
        },
      ],
      timestamp: Date.now(),
    } as unknown as Parameters<SessionStore['appendTranscriptMessage']>[1]);

    await store.appendTranscriptMessage(sessionKey, {
      role: 'toolResult',
      toolCallId,
      content: [{ type: 'text', text: JSON.stringify(envelope) }],
      details: snapshot,
      isError,
      timestamp: Date.now(),
    } as unknown as Parameters<SessionStore['appendTranscriptMessage']>[1]);

    await store.updateMetadata(sessionKey, {
      status: SessionStatus.ACTIVE,
    });
  }

  private async writeParentRunLink(params: {
    parentSessionKey: string;
    runId: string;
    workflowSessionKey: string;
    definitionId: string;
    goal: string;
    status: WorkflowRunView['run']['status'];
  }): Promise<void> {
    const store = this.gateway.sessionIndexInstance.getStore();
    const text = formatParentRunLinkText(params);
    await store.appendTranscriptContextEntry(params.parentSessionKey, {
      kind: 'context',
      id: `workflow-run-link:${params.runId}`,
      text,
      data: {
        kind: WORKFLOW_RUN_LINK_CONTEXT_KIND,
        runId: params.runId,
        workflowSessionKey: params.workflowSessionKey,
        definitionId: params.definitionId,
        goal: params.goal,
        status: params.status,
      },
      createdAt: new Date().toISOString(),
    });
  }
}

function formatWorkflowGoalUserMessage(definitionId: string, goal: string): string {
  const trimmedGoal = goal.trim();
  if (trimmedGoal) {
    return `Run workflow \`${definitionId}\`:\n\n${trimmedGoal}`;
  }
  return `Run workflow \`${definitionId}\``;
}

function truncateSessionName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77)}…`;
}

function readParentSessionKey(view: WorkflowRunView): string | null {
  if (view.run.source.kind === 'chat') {
    const originKey = view.run.source.sessionKey?.trim();
    if (originKey) return originKey;
  }
  const customParent = view.run.metadata?.origin?.sessionKey?.trim();
  if (customParent && view.run.metadata?.triggerSource === 'chat') {
    return customParent;
  }
  return null;
}

export function formatParentRunLinkText(params: {
  definitionId: string;
  goal: string;
  status: WorkflowRunView['run']['status'];
}): string {
  const label = params.goal.trim() || params.definitionId;
  if (params.status === 'running' || params.status === 'queued') {
    return `Workflow \`${params.definitionId}\` is running: ${label}`;
  }
  if (params.status === 'succeeded') {
    return `Workflow \`${params.definitionId}\` completed: ${label}`;
  }
  return `Workflow \`${params.definitionId}\` finished (${params.status}): ${label}`;
}

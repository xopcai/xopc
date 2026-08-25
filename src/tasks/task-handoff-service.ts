import { listAgentEntries, normalizeAgentId } from '../agent/agent-scope.js';
import type { Config } from '../config/schema.js';
import { buildSessionKey, sanitizeSegment } from '../routing/session-key.js';
import type { SessionIndex } from '../session/index.js';
import { createLogger } from '../utils/logger.js';

import {
  TaskConversationRepository,
  type TaskConversationState,
  type TaskHandoffSnapshot,
} from './task-conversation-repository.js';
import { TaskContextRepository } from './task-context-repository.js';
import { TaskRepository, type TaskAggregate } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

const log = createLogger('TaskHandoff');

export interface TaskHandoffResult {
  task: TaskAggregate;
  conversation: TaskConversationState;
  snapshot: TaskHandoffSnapshot;
  fromAgentId?: string;
  toAgentId: string;
  activeSessionKey: string;
  assignmentEpoch: number;
}

export class TaskHandoffService {
  readonly #inflight = new Map<string, Promise<TaskHandoffResult>>();

  constructor(private readonly deps: {
    getConfig: () => Config;
    sessionIndex: SessionIndex;
    getActiveRunId: (sessionKey: string) => string | undefined;
    abortRun: (runId: string) => Promise<unknown>;
  }) {}

  handoff(input: {
    taskId: string;
    toAgentId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<TaskHandoffResult> {
    const previous = this.#inflight.get(input.taskId);
    const pending = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(() => this.performHandoff(input));
    this.#inflight.set(input.taskId, pending);
    void pending.finally(() => {
      if (this.#inflight.get(input.taskId) === pending) this.#inflight.delete(input.taskId);
    });
    return pending;
  }

  private async performHandoff(input: {
    taskId: string;
    toAgentId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<TaskHandoffResult> {
    const config = this.deps.getConfig();
    const toAgentId = normalizeAgentId(input.toAgentId);
    const agent = listAgentEntries(config).find(
      (entry) => entry.enabled !== false && normalizeAgentId(entry.id) === toAgentId,
    );
    if (!agent) throw new Error(`Agent not found: ${toAgentId}`);

    const tasks = new TaskRepository();
    const task = tasks.require(input.taskId);
    const conversations = new TaskConversationRepository();
    const duplicate = conversations.findHandoffByIdempotencyKey({
      taskId: task.id,
      expectedTaskVersion: input.expectedVersion,
      toAgentId,
      idempotencyKey: input.idempotencyKey,
    });
    if (duplicate) {
      await this.abortPreviousSession(duplicate.fromSessionKey);
      const state = conversations.requireState(task.id);
      return {
        task,
        conversation: state,
        snapshot: duplicate,
        ...(duplicate.fromAgentId ? { fromAgentId: duplicate.fromAgentId } : {}),
        toAgentId,
        activeSessionKey: duplicate.toSessionKey,
        assignmentEpoch: duplicate.assignmentEpoch,
      };
    }
    if (task.version !== input.expectedVersion) throw new Error('Task changed');
    const previousState = conversations.requireState(task.id);
    if (previousState.currentExecutorAgentId === toAgentId) {
      throw new Error('Executor is already active');
    }

    const assignmentEpoch = previousState.assignmentEpoch + 1;
    const peerId = sanitizeSegment(`task-${task.id}-assignment-${assignmentEpoch}`);
    const sessionKey = buildSessionKey({
      agentId: toAgentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    });
    const runs = new TaskRunRepository();
    const latestRun = runs.getLatestRoot(task.id);
    const latestReceipt = latestRun ? runs.getReceipt(latestRun.id) : undefined;
    const remainingCriteria = latestReceipt?.verification.checks.length
      ? latestReceipt.verification.checks
        .filter((check) => check.status !== 'passed')
        .map((check) => check.criterion)
      : task.contract?.acceptanceCriteria ?? [];
    const payload: Record<string, unknown> = {
      objective: task.contract?.objective ?? task.title,
      expectedOutputs: task.contract?.expectedOutputs ?? [],
      remainingCriteria,
      constraints: task.contract?.constraints ?? [],
      risks: task.contract?.risks ?? [],
      approvalRequired: task.contract?.approvalRequired ?? [],
      context: new TaskContextRepository().list(task.id),
      ...(latestReceipt ? {
        latestReceipt,
        completedWork: latestReceipt.changes,
        remainingWork: latestReceipt.remainingWork,
      } : {}),
    };

    await this.deps.sessionIndex.saveMessages(sessionKey, [], { metadata: {
      sourceChannel: 'webchat',
      sourceChatId: `default:direct:${peerId}`,
      sessionType: 'chat',
      routing: {
        agentId: toAgentId,
        source: 'webchat',
        accountId: 'default',
        peerKind: 'direct',
        peerId,
      },
      projectId: task.projectId,
      customData: {
        origin: 'task',
        triggerKind: 'user',
        assignmentEpoch,
      },
    } });

    let completed: ReturnType<TaskConversationRepository['completeHandoff']>;
    try {
      completed = conversations.completeHandoff({
        taskId: task.id,
        expectedTaskVersion: input.expectedVersion,
        toSessionKey: sessionKey,
        toAgentId,
        idempotencyKey: input.idempotencyKey,
        payload,
      });
    } catch (error) {
      await this.deps.sessionIndex.delete(sessionKey);
      throw error;
    }
    const oldSessionKey = completed.snapshot.fromSessionKey;
    await this.abortPreviousSession(oldSessionKey);

    return {
      task: tasks.require(task.id),
      conversation: completed.state,
      snapshot: completed.snapshot,
      ...(completed.snapshot.fromAgentId ? { fromAgentId: completed.snapshot.fromAgentId } : {}),
      toAgentId,
      activeSessionKey: sessionKey,
      assignmentEpoch: completed.state.assignmentEpoch,
    };
  }

  private async abortPreviousSession(sessionKey: string | undefined): Promise<void> {
    if (!sessionKey) return;
    const activeRunId = this.deps.getActiveRunId(sessionKey);
    if (!activeRunId) return;
    try {
      await this.deps.abortRun(activeRunId);
    } catch (error) {
      log.warn({ err: error, sessionKey, runId: activeRunId }, 'Previous task executor did not stop cleanly');
    }
  }
}

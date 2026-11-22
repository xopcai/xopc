import type { TaskRun, TaskRunStatus } from '@xopcai/gateway-contract';

import { CapabilityError, type CapabilityContext, type CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';
import { getActiveClarification } from '../storage/sqlite/clarification-wait-repository.js';
import { mcpDelegatedRunPrincipal, TaskRunRepository } from '../tasks/task-run-repository.js';
import { scopedMcpIdempotencyKey, toolResult } from './tool-contract.js';

export type McpProtocolTaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export interface McpProtocolTask {
  taskId: string;
  status: McpProtocolTaskStatus;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttl: number | null;
  pollInterval?: number;
}

const DEFAULT_TASK_POLL_INTERVAL_MS = 2_000;

export function mapRunStatusToMcpTaskStatus(status: TaskRunStatus): McpProtocolTaskStatus {
  switch (status) {
    case 'waiting':
      return 'input_required';
    case 'succeeded':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'working';
  }
}

export function toMcpProtocolTask(run: TaskRun, runs = new TaskRunRepository()): McpProtocolTask {
  const status = mapRunStatusToMcpTaskStatus(run.status);
  const receipt = runs.getReceipt(run.id);
  const wait = run.status === 'waiting' && run.conversationId ? getActiveClarification(run.conversationId) : undefined;
  const statusMessage = wait?.taskRunId === run.id
    ? `Input required (clarification ${wait.id}): ${wait.question}`
    : receipt?.summary
      ?? run.terminalMessage
      ?? (run.status === 'queued' ? 'Queued for execution' : run.status === 'running' ? 'Agent is executing' : undefined);
  const updatedMs = run.completedAt ?? run.heartbeatAt ?? run.startedAt ?? run.queuedAt;
  return {
    taskId: run.id,
    status,
    ...(statusMessage ? { statusMessage: statusMessage.slice(0, 500) } : {}),
    createdAt: new Date(run.queuedAt).toISOString(),
    lastUpdatedAt: new Date(updatedMs).toISOString(),
    ttl: null,
    ...(status === 'working' || status === 'input_required' ? { pollInterval: DEFAULT_TASK_POLL_INTERVAL_MS } : {}),
  };
}

function requireOwnedRun(taskId: string, context: CapabilityContext, runs: TaskRunRepository): TaskRun {
  const run = runs.get(taskId);
  if (!run || mcpDelegatedRunPrincipal(run) !== context.principalId) {
    throw new CapabilityError('NOT_FOUND', 'MCP task not found for this connection');
  }
  return run;
}

export function listMcpProtocolTasks(
  context: CapabilityContext,
  cursor?: string,
): { tasks: McpProtocolTask[]; nextCursor?: string } {
  context.assertCurrent?.();
  if (!context.allowedCapabilities?.includes('xopc.agent_runs.list') && !context.allowedCapabilities?.includes('xopc.agent_runs.get')) {
    throw new CapabilityError('FORBIDDEN', 'Task inspection is not granted to this connection');
  }
  const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
  const limit = 25;
  const runs = new TaskRunRepository();
  const page = runs.listByMcpPrincipal(context.principalId, { limit: limit + 1, offset });
  const items = page.slice(0, limit).map(run => toMcpProtocolTask(run, runs));
  return {
    tasks: items,
    ...(page.length > limit ? { nextCursor: String(offset + limit) } : {}),
  };
}

export function getMcpProtocolTask(taskId: string, context: CapabilityContext): McpProtocolTask {
  context.assertCurrent?.();
  if (!context.allowedCapabilities?.includes('xopc.agent_runs.get')) {
    throw new CapabilityError('FORBIDDEN', 'Task inspection is not granted to this connection');
  }
  const runs = new TaskRunRepository();
  return toMcpProtocolTask(requireOwnedRun(taskId, context, runs), runs);
}

export async function getMcpProtocolTaskResult(
  taskId: string,
  dispatcher: CapabilityDispatcher,
  context: CapabilityContext,
) {
  context.assertCurrent?.();
  if (!context.allowedCapabilities?.includes('xopc.agent_runs.result')) {
    throw new CapabilityError('FORBIDDEN', 'Task result inspection is not granted to this connection');
  }
  const data = await dispatcher.call('xopc.agent_runs.result', { runId: taskId }, context) as Record<string, unknown>;
  return toolResult(data);
}

export async function cancelMcpProtocolTask(
  taskId: string,
  dispatcher: CapabilityDispatcher,
  context: CapabilityContext,
): Promise<McpProtocolTask> {
  context.assertCurrent?.();
  if (!context.allowedCapabilities?.includes('xopc.agent_runs.cancel')) {
    throw new CapabilityError('FORBIDDEN', 'Task cancellation is not granted to this connection');
  }
  const descriptor = dispatcher.describe('xopc.agent_runs.cancel', context);
  await dispatcher.call('xopc.agent_runs.cancel', { runId: taskId, reason: 'Cancelled via MCP tasks/cancel' }, context, {
    majorVersion: descriptor.majorVersion,
    descriptorDigest: descriptor.descriptorDigest,
    idempotencyKey: scopedMcpIdempotencyKey(context.principalId, 'xopc.agent_runs.cancel', `mcp-task-cancel:${taskId}`),
  });
  const runs = new TaskRunRepository();
  return toMcpProtocolTask(requireOwnedRun(taskId, context, runs), runs);
}

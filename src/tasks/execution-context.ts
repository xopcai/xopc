import type { SessionMetadata } from '../session/types.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import { getExecutionEnvironmentForSession } from '../execution-environments/subject.js';
import type { ExecutionEnvironmentKind } from '../execution-environments/types.js';
import { TaskConversationRepository } from './task-conversation-repository.js';
export type ExecutionOrigin = 'chat' | 'task' | 'workflow' | 'automation' | 'browser' | 'heartbeat';
export type ExecutionTrigger = 'user' | 'schedule' | 'webhook' | 'heartbeat' | 'retry';

export interface ExecutionContext {
  runId: string;
  conversationId: string;
  channel: string;
  agentId?: string;
  executionEnvironmentId?: string;
  executionKind?: ExecutionEnvironmentKind;
  taskId?: string;
  projectId?: string;
  origin: ExecutionOrigin;
  triggerKind: ExecutionTrigger;
  parentRunId?: string;
  contextTraceId?: string;
}

const ORIGINS = new Set<ExecutionOrigin>(['chat', 'task', 'workflow', 'automation', 'browser', 'heartbeat']);
const TRIGGERS = new Set<ExecutionTrigger>(['user', 'schedule', 'webhook', 'heartbeat', 'retry']);

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataOrigin(metadata: SessionMetadata, taskId?: string): ExecutionOrigin {
  const explicit = optionalString(metadata.customData?.origin);
  if (explicit && ORIGINS.has(explicit as ExecutionOrigin)) return explicit as ExecutionOrigin;
  if (taskId) return 'task';
  if (metadata.sessionType === 'workflow-run' || metadata.sessionType === 'workflow-subagent') return 'workflow';
  if (metadata.sessionType === 'cron') return 'automation';
  if (metadata.sessionType === 'heartbeat') return 'heartbeat';
  if (optionalString(metadata.customData?.browserRecipeId)) return 'browser';
  return 'chat';
}

function metadataTrigger(metadata: SessionMetadata): ExecutionTrigger {
  const explicit = optionalString(metadata.customData?.triggerKind);
  if (explicit && TRIGGERS.has(explicit as ExecutionTrigger)) return explicit as ExecutionTrigger;
  if (metadata.sessionType === 'cron') return 'schedule';
  if (metadata.sessionType === 'heartbeat') return 'heartbeat';
  return 'user';
}

export function resolveExecutionContext(input: {
  runId: string;
  conversationId: string;
  channel: string;
  metadata: SessionMetadata;
  agentId?: string;
}): ExecutionContext {
  const taskId = isXopcDatabaseOpen()
    ? new TaskConversationRepository().resolveActiveExecutionSession(input.conversationId)?.taskId
    : undefined;
  const environment = getExecutionEnvironmentForSession(input.conversationId);
  return {
    runId: input.runId,
    conversationId: input.conversationId,
    channel: input.channel,
    agentId: input.agentId,
    ...(environment ? {
      executionEnvironmentId: environment.id,
      executionKind: environment.kind,
    } : {}),
    projectId: input.metadata.projectId,
    taskId,
    origin: metadataOrigin(input.metadata, taskId),
    triggerKind: metadataTrigger(input.metadata),
    parentRunId: optionalString(input.metadata.customData?.parentRunId),
    contextTraceId: optionalString(input.metadata.customData?.contextTraceId),
  };
}

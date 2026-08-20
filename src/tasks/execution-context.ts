import type { SessionMetadata } from '../session/types.js';
export type ExecutionOrigin = 'chat' | 'task' | 'workflow' | 'automation' | 'browser' | 'proactive';
export type ExecutionTrigger = 'user' | 'schedule' | 'webhook' | 'proactive' | 'retry';

export interface ExecutionContext {
  runId: string;
  sessionKey: string;
  channel: string;
  agentId?: string;
  strategy?: string;
  taskId?: string;
  projectId?: string;
  origin: ExecutionOrigin;
  triggerKind: ExecutionTrigger;
  parentRunId?: string;
  contextTraceId?: string;
}

const ORIGINS = new Set<ExecutionOrigin>(['chat', 'task', 'workflow', 'automation', 'browser', 'proactive']);
const TRIGGERS = new Set<ExecutionTrigger>(['user', 'schedule', 'webhook', 'proactive', 'retry']);

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataOrigin(metadata: SessionMetadata): ExecutionOrigin {
  const explicit = optionalString(metadata.customData?.origin);
  if (explicit && ORIGINS.has(explicit as ExecutionOrigin)) return explicit as ExecutionOrigin;
  if (optionalString(metadata.customData?.taskId)) return 'task';
  if (metadata.sessionType === 'workflow-run' || metadata.sessionType === 'workflow-subagent') return 'workflow';
  if (metadata.sessionType === 'cron') return 'automation';
  if (metadata.sessionType === 'heartbeat') return 'proactive';
  if (optionalString(metadata.customData?.browserRecipeId)) return 'browser';
  return 'chat';
}

function metadataTrigger(metadata: SessionMetadata): ExecutionTrigger {
  const explicit = optionalString(metadata.customData?.triggerKind);
  if (explicit && TRIGGERS.has(explicit as ExecutionTrigger)) return explicit as ExecutionTrigger;
  if (metadata.sessionType === 'cron') return 'schedule';
  if (metadata.sessionType === 'heartbeat') return 'proactive';
  return 'user';
}

export function resolveExecutionContext(input: {
  runId: string;
  sessionKey: string;
  channel: string;
  metadata: SessionMetadata;
  agentId?: string;
}): ExecutionContext {
  return {
    runId: input.runId,
    sessionKey: input.sessionKey,
    channel: input.channel,
    agentId: input.agentId,
    projectId: input.metadata.projectId,
    taskId: optionalString(input.metadata.customData?.taskId),
    origin: metadataOrigin(input.metadata),
    triggerKind: metadataTrigger(input.metadata),
    parentRunId: optionalString(input.metadata.customData?.parentRunId),
    contextTraceId: optionalString(input.metadata.customData?.contextTraceId),
    strategy: optionalString(input.metadata.customData?.strategy),
  };
}

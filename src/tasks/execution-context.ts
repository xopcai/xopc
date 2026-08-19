import type { SessionMetadata } from '../session/types.js';
import type {
  ExecutionReceiptContext,
  ExecutionReceiptOrigin,
  ExecutionReceiptTrigger,
} from '../storage/sqlite/execution-receipt-repository.js';

export interface ExecutionContext extends ExecutionReceiptContext {
  runId: string;
  sessionKey: string;
  channel: string;
  agentId?: string;
  strategy?: string;
}

const ORIGINS = new Set<ExecutionReceiptOrigin>(['chat', 'task', 'workflow', 'automation', 'browser', 'proactive']);
const TRIGGERS = new Set<ExecutionReceiptTrigger>(['user', 'schedule', 'webhook', 'proactive', 'retry']);

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataOrigin(metadata: SessionMetadata): ExecutionReceiptOrigin {
  const explicit = optionalString(metadata.customData?.origin);
  if (explicit && ORIGINS.has(explicit as ExecutionReceiptOrigin)) return explicit as ExecutionReceiptOrigin;
  if (optionalString(metadata.customData?.taskId)) return 'task';
  if (metadata.sessionType === 'workflow-run' || metadata.sessionType === 'workflow-subagent') return 'workflow';
  if (metadata.sessionType === 'cron') return 'automation';
  if (metadata.sessionType === 'heartbeat') return 'proactive';
  if (optionalString(metadata.customData?.browserRecipeId)) return 'browser';
  return 'chat';
}

function metadataTrigger(metadata: SessionMetadata): ExecutionReceiptTrigger {
  const explicit = optionalString(metadata.customData?.triggerKind);
  if (explicit && TRIGGERS.has(explicit as ExecutionReceiptTrigger)) return explicit as ExecutionReceiptTrigger;
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

export function executionReceiptContext(context: ExecutionContext): ExecutionReceiptContext {
  return {
    taskId: context.taskId,
    projectId: context.projectId,
    origin: context.origin,
    triggerKind: context.triggerKind,
    parentRunId: context.parentRunId,
    contextTraceId: context.contextTraceId,
  };
}

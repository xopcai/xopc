import type { SessionMetadata } from '../session/types.js';
import type {
  TaskOutcomeContext,
  TaskOutcomeOrigin,
  TaskOutcomeTrigger,
} from '../storage/sqlite/task-outcome-repository.js';

export interface ExecutionContext extends TaskOutcomeContext {
  runId: string;
  sessionKey: string;
  channel: string;
  agentId?: string;
}

const ORIGINS = new Set<TaskOutcomeOrigin>(['chat', 'goal', 'workflow', 'automation', 'browser', 'proactive']);
const TRIGGERS = new Set<TaskOutcomeTrigger>(['user', 'schedule', 'webhook', 'proactive', 'retry']);

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataOrigin(metadata: SessionMetadata): TaskOutcomeOrigin {
  const explicit = optionalString(metadata.customData?.origin);
  if (explicit && ORIGINS.has(explicit as TaskOutcomeOrigin)) return explicit as TaskOutcomeOrigin;
  if (optionalString(metadata.customData?.goalId)) return 'goal';
  if (metadata.sessionType === 'workflow-run' || metadata.sessionType === 'workflow-subagent') return 'workflow';
  if (metadata.sessionType === 'cron') return 'automation';
  if (metadata.sessionType === 'heartbeat') return 'proactive';
  if (optionalString(metadata.customData?.browserRecipeId)) return 'browser';
  return 'chat';
}

function metadataTrigger(metadata: SessionMetadata): TaskOutcomeTrigger {
  const explicit = optionalString(metadata.customData?.triggerKind);
  if (explicit && TRIGGERS.has(explicit as TaskOutcomeTrigger)) return explicit as TaskOutcomeTrigger;
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
    goalId: optionalString(input.metadata.customData?.goalId),
    workItemId: optionalString(input.metadata.customData?.workItemId),
    origin: metadataOrigin(input.metadata),
    triggerKind: metadataTrigger(input.metadata),
    parentRunId: optionalString(input.metadata.customData?.parentRunId),
    contextTraceId: optionalString(input.metadata.customData?.contextTraceId),
  };
}

export function taskOutcomeContext(context: ExecutionContext): TaskOutcomeContext {
  return {
    projectId: context.projectId,
    goalId: context.goalId,
    workItemId: context.workItemId,
    origin: context.origin,
    triggerKind: context.triggerKind,
    parentRunId: context.parentRunId,
    contextTraceId: context.contextTraceId,
  };
}

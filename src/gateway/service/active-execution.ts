import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

export type ActiveExecutionKind = 'chat' | 'side-chat' | 'task' | 'workflow' | 'automation';
export type ActiveExecutionInitiator = 'user' | 'background';

export type ActiveExecution = {
  conversationId: string;
  runId: string;
  kind: ActiveExecutionKind;
  initiator: ActiveExecutionInitiator;
  phase: 'running';
  startedAt: number;
};

export function describeActiveExecution(input: {
  conversationId: string;
  runId: string;
  origin: TurnOrigin;
  taskRunId?: string;
  kind?: ActiveExecutionKind;
  startedAt?: number;
}): ActiveExecution {
  const { origin } = input;
  const background = origin.type === 'system'
    && (origin.source === 'automation' || origin.source === 'heartbeat' || origin.source === 'internal');
  const kind = input.kind
    ?? (origin.type === 'system' && origin.source === 'automation'
      ? 'automation'
      : origin.type === 'system' && origin.source === 'workflow'
        ? 'workflow'
        : input.taskRunId
          ? 'task'
          : 'chat');

  return {
    conversationId: input.conversationId,
    runId: input.runId,
    kind,
    initiator: background ? 'background' : 'user',
    phase: 'running',
    startedAt: input.startedAt ?? Date.now(),
  };
}

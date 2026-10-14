export type AgentAbortReason = 'deadline_exceeded' | 'user_cancelled' | 'parent_cancelled';
export type AgentTerminationReason = AgentAbortReason | 'provider_error' | 'runtime_error';

export class AgentRunCancelledError extends Error {
  constructor(message = 'Embedded run aborted', readonly code: 'user_cancelled' | 'parent_cancelled' = 'user_cancelled') {
    super(message); this.name = 'AgentRunCancelledError';
  }
}
export class AgentRunDeadlineError extends Error {
  readonly code = 'deadline_exceeded';
  constructor(message = 'Agent run deadline expired') { super(message); this.name = 'AgentRunDeadlineError'; }
}

/** Preserve explicit host reasons; an unspecified upstream abort is parent cancellation. */
export function resolveAgentAbortReason(reason: unknown): AgentAbortReason {
  const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : undefined;
  if (code === 'deadline_exceeded' || code === 'user_cancelled' || code === 'parent_cancelled') return code;
  if (reason instanceof Error && reason.name === 'TimeoutError') return 'deadline_exceeded';
  return 'parent_cancelled';
}

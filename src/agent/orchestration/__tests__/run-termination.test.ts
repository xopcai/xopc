import { describe, expect, it } from 'vitest';

import { AgentRunCancelledError, AgentRunDeadlineError, resolveAgentAbortReason } from '../run-termination.js';

describe('structured abort reasons', () => {
  it('preserves explicit cancellation and deadlines without inspecting arbitrary message text', () => {
    expect(resolveAgentAbortReason(new AgentRunCancelledError())).toBe('user_cancelled');
    expect(resolveAgentAbortReason(new AgentRunCancelledError('Upstream stopped', 'parent_cancelled'))).toBe('parent_cancelled');
    expect(resolveAgentAbortReason(new AgentRunDeadlineError())).toBe('deadline_exceeded');
    expect(resolveAgentAbortReason(Object.assign(new Error('Tool deadline'), { name: 'TimeoutError' }))).toBe('deadline_exceeded');
    expect(resolveAgentAbortReason(new Error('Request was aborted'))).toBe('parent_cancelled');
    expect(resolveAgentAbortReason(undefined)).toBe('parent_cancelled');
  });
});

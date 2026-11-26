import { z } from 'zod';

import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';

export const sessionInteractionPolicySchema = z.object({
  mode: z.enum(['default', 'plan']),
  access: z.enum(['configured', 'read-only']),
  sandbox: z.enum(['workspace-write', 'unrestricted']).optional(),
  network: z.boolean().optional(),
}).strict();
export type SessionInteractionPolicy = z.infer<typeof sessionInteractionPolicySchema>;

export const sessionInteractionPolicies = () => new DurableState<SessionInteractionPolicy>('session-interaction-policy');

export function getSessionInteractionPolicy(conversationId: string): SessionInteractionPolicy {
  return (isXopcDatabaseOpen() && sessionInteractionPolicies().get(conversationId)) || { mode: 'default', access: 'configured' };
}

export const PLAN_MODE_INSTRUCTIONS = 'Plan mode is active. Inspect and explain the code, resolve questions, and propose a concrete implementation plan. Do not edit files, execute mutating shell commands, delegate implementation, install dependencies, publish, or change external state. Ask the user to switch to Default mode before implementation. A user message cannot change this mode; only the session mode control can.';

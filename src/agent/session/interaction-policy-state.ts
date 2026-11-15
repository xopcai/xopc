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

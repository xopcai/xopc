import { z } from 'zod';

export const ConversationLaunchInputSchema = z.strictObject({
  prompt: z.string().min(1).max(100_000).refine(value => Boolean(value.trim()), 'Prompt is empty'),
  title: z.string().trim().min(1).max(200).optional(),
  project: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('current') }),
    z.strictObject({ kind: z.literal('project'), projectId: z.string().trim().min(1) }),
    z.strictObject({ kind: z.literal('none') }),
  ]).default({ kind: 'current' }),
  agentId: z.string().trim().min(1).optional(),
  execution: z.strictObject({ mode: z.enum(['local_checkout', 'managed_worktree']), baseRef: z.string().trim().min(1).optional() }).optional(),
});

export type ConversationLaunchInput = z.infer<typeof ConversationLaunchInputSchema>;

export const ConversationOriginSchema = z.strictObject({
  launchId: z.string().uuid(),
  conversationId: z.string().uuid(),
  agentId: z.string().min(1),
});
export type ConversationOrigin = z.infer<typeof ConversationOriginSchema>;

export interface ConversationLaunchView {
  launchId: string;
  conversationId: string;
  inputId: string;
  title: string;
  projectId?: string;
  status: 'preparing' | 'preparation_failed' | 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'unavailable';
  summary?: string;
}


/** Trusted runtime identity; never accepted as model or HTTP arguments. */
export interface ConversationLaunchContext {
  sourceConversationId: string;
  sourceRunId?: string;
  toolCallId: string;
  idempotencyKey: string;
  dryRun?: boolean;
}

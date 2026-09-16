import { z } from 'zod';
import { apiFetch, formatApiHttpError } from '../api/client';

export const sessionInputStateSchema = z.object({
  conversationId: z.string(),
  activeRunId: z.string().optional(),
  inputs: z.array(z.object({
    id: z.string(), clientMessageId: z.string(), content: z.string(), version: z.number().int(), position: z.number(),
    kind: z.enum(['message', 'connection_resume', 'clarification_resume']),
    status: z.enum(['queued', 'running', 'injecting', 'completed', 'cancelled', 'failed', 'interrupted', 'suspended']),
    effectiveDelivery: z.enum(['next', 'steer']),
  })),
});
export type SessionInputState = z.infer<typeof sessionInputStateSchema>;
export type SessionInput = SessionInputState['inputs'][number];
export const sessionInputsKey = (gatewayId: string | null | undefined, conversationId: string) => ['session-inputs', gatewayId, conversationId] as const;

async function readState(response: Response): Promise<SessionInputState> {
  const body = await response.json() as { payload?: unknown; error?: { message?: string } };
  if (!response.ok) throw new Error(formatApiHttpError(response.status, response.statusText, body.error?.message));
  return sessionInputStateSchema.parse(body.payload);
}
export async function fetchSessionInputs(conversationId: string) {
  return readState(await apiFetch(`/api/sessions/${encodeURIComponent(conversationId)}/input-state`));
}
export async function updateSessionInput(conversationId: string, input: Pick<SessionInput, 'id' | 'version'>, content: string) {
  return readState(await apiFetch(`/api/sessions/${encodeURIComponent(conversationId)}/inputs/${encodeURIComponent(input.id)}`, { method: 'PATCH', body: JSON.stringify({ version: input.version, content }) }));
}
export async function cancelSessionInput(conversationId: string, input: Pick<SessionInput, 'id' | 'version'>) {
  return readState(await apiFetch(`/api/sessions/${encodeURIComponent(conversationId)}/inputs/${encodeURIComponent(input.id)}?version=${input.version}`, { method: 'DELETE' }));
}
export function queuedMessages(state?: SessionInputState): SessionInput[] {
  return (state?.inputs ?? []).filter(input => input.kind === 'message' && input.status === 'queued').sort((a, b) => a.position - b.position);
}

import { z } from 'zod';
import { apiFetch, formatApiHttpError } from '../api/client';
import { sessionPreparationViewSchema, type SessionPreparationView } from '@xopcai/gateway-contract';
import { readLocalSessionDraft } from '../features/chat/local-session-drafts';
import type { ComposerContextRef, WireAttachment } from '../features/chat/composer.types';

const queuedAttachmentSchema = z.object({
  type: z.string(), mimeType: z.string().optional(), data: z.string().optional(), uri: z.string().optional(),
  name: z.string().optional(), size: z.number().optional(), workspaceRelativePath: z.string().optional(),
  durationSeconds: z.number().optional(),
});

const queuedContextRefSchema = z.object({
  kind: z.enum(['note', 'task']), sourceId: z.string(), version: z.string(), title: z.string(),
  refId: z.string().optional(),
});

export const sessionInputStateSchema = z.object({
  preparation: sessionPreparationViewSchema.optional(),
  conversationId: z.string(),
  activeRunId: z.string().optional(),
  inputs: z.array(z.object({
    id: z.string(), clientMessageId: z.string(), content: z.string(), version: z.number().int(), position: z.number(),
    kind: z.enum(['message', 'connection_resume', 'clarification_resume']),
    status: z.enum(['queued', 'running', 'injecting', 'completed', 'cancelled', 'failed', 'interrupted', 'suspended']),
    requestedDelivery: z.enum(['next', 'steer']), effectiveDelivery: z.enum(['next', 'steer']),
    attachments: z.array(queuedAttachmentSchema).optional(), contextRefs: z.array(queuedContextRefSchema).optional(),
    thinking: z.string().optional(), error: z.string().optional(),
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
  const draft = readLocalSessionDraft(conversationId);
  if (draft && !draft.materialization) return { conversationId, inputs: [] } as SessionInputState;
  return readState(await apiFetch(`/api/sessions/${encodeURIComponent(conversationId)}/input-state`));
}
export async function retrySessionPreparation(conversationId: string, preparation: SessionPreparationView) {
  const response = await apiFetch(`/api/sessions/${encodeURIComponent(conversationId)}/preparation/retry`, {
    method: 'POST', body: JSON.stringify({ operationId: preparation.operationId, expectedRevision: preparation.revision, idempotencyKey: `${preparation.operationId}:${preparation.revision}` }),
  });
  if (!response.ok) throw new Error(formatApiHttpError(response.status, response.statusText));
}
export async function updateSessionInput(conversationId: string, input: Pick<SessionInput, 'id' | 'version'>, update: {
  content?: string; attachments?: WireAttachment[]; contextRefs?: ComposerContextRef[]; thinking?: string; position?: number;
}) {
  const contextRefs = update.contextRefs?.map(({ kind, sourceId, expectedVersion }) => ({ kind, sourceId, expectedVersion }));
  return readState(await apiFetch(`/api/sessions/${encodeURIComponent(conversationId)}/inputs/${encodeURIComponent(input.id)}`, {
    method: 'PATCH', body: JSON.stringify({ ...update, contextRefs, version: input.version }),
  }));
}
export async function cancelSessionInput(conversationId: string, input: Pick<SessionInput, 'id' | 'version'>) {
  return readState(await apiFetch(`/api/sessions/${encodeURIComponent(conversationId)}/inputs/${encodeURIComponent(input.id)}?version=${input.version}`, { method: 'DELETE' }));
}
export function queuedMessages(state?: SessionInputState): SessionInput[] {
  return (state?.inputs ?? []).filter(input => input.kind === 'message' && input.status === 'queued').sort((a, b) => a.position - b.position);
}

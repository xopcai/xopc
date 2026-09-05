import { realtimeVoiceStatusSchema, createVoiceSessionResponseSchema, type CreateVoiceSessionRequest } from '@xopcai/realtime-protocol/voice';
import { apiFetch } from '../api/client';
import { queryClient } from './query-client';
import { fetchSession } from './sessions';

export class VoiceRequestError extends Error {
  constructor(readonly code: string, readonly status = 0) { super(code); }
}
export const voiceStatusOptions = (gatewayId: string | null) => ({
  queryKey: ['voice-status', gatewayId], staleTime: 15_000, retry: false as const,
  queryFn: async ({ signal }: { signal: AbortSignal }) => {
    const response = await apiFetch('/api/voice/realtime/status', { signal });
    if (!response.ok) throw new VoiceRequestError('SERVICE_UNAVAILABLE', response.status);
    const parsed = realtimeVoiceStatusSchema.safeParse((await response.json()).payload);
    if (!parsed.success) throw new VoiceRequestError('GATEWAY_UPGRADE_REQUIRED');
    return parsed.data;
  },
});
export async function preflightVoice(request: CreateVoiceSessionRequest, signal: AbortSignal): Promise<void> {
  const response = await apiFetch('/api/voice/realtime/preflight', { method: 'POST', body: JSON.stringify(request), signal });
  if (!response.ok) throw new VoiceRequestError((await response.json()).error?.code ?? 'SERVICE_UNAVAILABLE', response.status);
}
export async function createVoiceConnection(request: CreateVoiceSessionRequest, signal: AbortSignal) {
  let origin = '';
  const response = await apiFetch('/api/voice/realtime/sessions', {
    method: 'POST', body: JSON.stringify(request), signal, onResolvedOrigin: value => { origin = value; },
  });
  if (!response.ok) throw new VoiceRequestError((await response.json()).error?.code ?? 'SERVICE_UNAVAILABLE', response.status);
  const session = createVoiceSessionResponseSchema.parse((await response.json()).payload);
  if (session.inputFormat.sampleRate !== 16000) throw new VoiceRequestError('UNSUPPORTED_FORMAT');
  return { origin, session };
}
export function voiceSessionIdentity(gatewayId: string, sessionKey: string) {
  return queryClient.fetchQuery({ queryKey: ['voice-identity', gatewayId, sessionKey], staleTime: 0, retry: false,
    queryFn: () => fetchSession(sessionKey),
  });
}

export type VoiceApproval = { id: string; sessionKey: string; actionId: string; argumentsPreview: Record<string, unknown>; status: string; expiresAt: string };
export function voiceApprovalsOptions(gatewayId: string | undefined, sessionKey: string | undefined) {
  return {
    queryKey: ['voice-approvals', gatewayId, sessionKey], retry: false as const, refetchInterval: 3000,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<VoiceApproval[]> => {
      const response = await apiFetch(`/api/connectors/approvals?status=pending&sessionKey=${encodeURIComponent(sessionKey ?? '')}`, { signal });
      if (!response.ok) throw new VoiceRequestError('APPROVALS_UNAVAILABLE', response.status);
      const approvals = (await response.json()).payload?.approvals;
      if (!Array.isArray(approvals)) throw new VoiceRequestError('APPROVALS_UNAVAILABLE');
      return approvals.filter((item: VoiceApproval) => item.sessionKey === sessionKey && item.status === 'pending' && Date.parse(item.expiresAt) > Date.now());
    },
  };
}
export async function respondVoiceApproval(id: string, decision: 'approved' | 'denied') {
  const response = await apiFetch('/api/connectors/approvals/respond', { method: 'POST', body: JSON.stringify({ id, decision }) });
  if (!response.ok) throw new VoiceRequestError('APPROVAL_FAILED', response.status);
}

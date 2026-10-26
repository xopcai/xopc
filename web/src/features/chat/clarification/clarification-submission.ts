import { canonicalSessionCommand, type ClarificationSubmission } from '@xopcai/gateway-contract';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { clarificationDraftStorage } from './clarification-draft-storage';

type Attempt = { signature: string; body: object };
const inflight = new Map<string, { signature: string; promise: Promise<Response> }>();

export async function submitQuestionBatch(requestId: string, version: number, action: 'answer' | 'agent_decide' | 'cancel', submission?: ClarificationSubmission, conversationId?: string): Promise<Response> {
  const gateway = useGatewayStore.getState();
  const key = canonicalSessionCommand([gateway.baseUrl, gateway.conversationId, requestId, version]);
  const signature = canonicalSessionCommand({ action, submission });
  const active = inflight.get(key);
  if (active) {
    if (active.signature !== signature) throw new Error('An answer is already being submitted');
    return (await active.promise).clone();
  }
  const promise = sendQuestionBatch(requestId, version, action, submission, conversationId).then(response => {
    if (!response.ok) inflight.delete(key);
    // Retain a bounded receipt for clicks arriving just after the response.
    while (inflight.size > 64) inflight.delete(inflight.keys().next().value!);
    return response;
  }, error => { inflight.delete(key); throw error; });
  inflight.set(key, { signature, promise });
  return (await promise).clone();
}

async function sendQuestionBatch(requestId: string, version: number, action: 'answer' | 'agent_decide' | 'cancel', submission?: ClarificationSubmission, conversationId?: string): Promise<Response> {
  const identity = useGatewayStore.getState().conversationId;
  const storage = clarificationDraftStorage<Attempt>(requestId, version, 'submission', conversationId);
  const payload = { schemaVersion: 2, action, ...submission, expectedVersion: version };
  const signature = canonicalSessionCommand(payload);
  const previous = await storage.read();
  if (previous && previous.signature !== signature) throw new Error('The previous answer is awaiting confirmation. Retry the original answer before changing it.');
  const attempt = previous ?? { signature, body: { ...payload, idempotencyKey: crypto.randomUUID() } };
  await storage.write(attempt);
  window.dispatchEvent(new CustomEvent('clarification-submission-state', { detail: { requestId, pending: true } }));
  if (useGatewayStore.getState().conversationId !== identity) throw new Error('Active Gateway changed');
  const response = await apiFetch(apiUrl(`/api/clarifications/${encodeURIComponent(requestId)}/responses`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attempt.body),
  });
  if (response.ok || (response.status >= 400 && response.status < 500)) {
    await storage.write(undefined);
    window.dispatchEvent(new CustomEvent('clarification-submission-state', { detail: { requestId, pending: false } }));
    if (response.ok) await clarificationDraftStorage(requestId, version, 'draft', conversationId).write(undefined);
  }
  return response;
}

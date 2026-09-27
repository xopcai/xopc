import { randomUUID } from 'expo-crypto';
import { isSessionCommandRejected } from '@xopcai/gateway-contract';
import { apiFetch } from '../api/client';
import { readLocalSessionDraft, saveLocalSessionDraft, removeLocalSessionDraft } from '../features/chat/local-session-drafts';
import { fetchSessionAgentConfig } from './models';
import { useGatewayStore } from '../stores/gateway-store';

export async function materializeSession(id: string, purpose: 'voice' | 'session_resources'): Promise<void> {
  if (!readLocalSessionDraft(id)) return;
  const generation = useGatewayStore.getState().connectionGeneration;
  await fetchSessionAgentConfig(id);
  if (generation !== useGatewayStore.getState().connectionGeneration) throw new Error('Active work computer changed');
  const draft = readLocalSessionDraft(id);
  if (!draft) return;
  if (draft.clientMessageId) throw new Error('The first input is awaiting confirmation');
  draft.materialization ??= { commandId: randomUUID(), purpose };
  saveLocalSessionDraft(draft);
  const response = await apiFetch(`/api/sessions/${encodeURIComponent(id)}/materialize`, {
    method: 'POST', body: JSON.stringify({ ...draft.materialization, creation: draft.creation }),
  });
  if (generation !== useGatewayStore.getState().connectionGeneration) throw new Error('Active work computer changed');
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    if (generation !== useGatewayStore.getState().connectionGeneration) throw new Error('Active work computer changed');
    if (isSessionCommandRejected(response.status, failure)) {
      delete draft.materialization;
      saveLocalSessionDraft(draft);
    }
    throw new Error(`Materialization failed (${response.status})`);
  }
  const result = await response.json() as { payload: { receipt: { conversationId: string; clientMessageId: string; lifecycle: string } } };
  if (generation !== useGatewayStore.getState().connectionGeneration) throw new Error('Active work computer changed');
  if (result.payload.receipt.conversationId !== id || result.payload.receipt.clientMessageId !== draft.materialization.commandId) throw new Error('Invalid materialization receipt');
  if (result.payload.receipt.lifecycle !== 'ready') throw new Error('Conversation environment is not ready yet');
  removeLocalSessionDraft(id);
}

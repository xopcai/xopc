import { apiFetch } from '../api/client';
import { readLocalSessionDraft, removeLocalSessionDraft } from '../features/chat/local-session-drafts';
import { useGatewayStore } from '../stores/gateway-store';

export async function reconcileLocalSession(id: string): Promise<void> {
  const draft = readLocalSessionDraft(id);
  const commandId = draft?.clientMessageId ?? draft?.materialization?.commandId;
  if (!commandId) return;
  const generation = useGatewayStore.getState().connectionGeneration;
  const response = await apiFetch(`/api/sessions/${encodeURIComponent(id)}/input-receipts/${encodeURIComponent(commandId)}`);
  if (generation !== useGatewayStore.getState().connectionGeneration) throw new Error('Active work computer changed');
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Receipt lookup failed (${response.status})`);
  const result = await response.json() as { payload: { receipt: { conversationId: string; clientMessageId: string; lifecycle: string } } };
  if (generation !== useGatewayStore.getState().connectionGeneration) throw new Error('Active work computer changed');
  const receipt = result.payload?.receipt;
  if (receipt?.conversationId !== id || receipt.clientMessageId !== commandId) throw new Error('Invalid input receipt');
  if (draft?.materialization && receipt.lifecycle !== 'ready') return;
  removeLocalSessionDraft(id);
}

import { canonicalSessionCommand, sessionInputCommandSchema, type SessionInputCommand } from '@xopcai/gateway-contract';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { clearPendingSessionCommand, readPendingSessionCommand, savePendingSessionCommand } from './local-session-drafts';

type AppendCommand = Extract<SessionInputCommand, { kind: 'append' }>;
type ReceiptPayload = {
  receipt?: { conversationId: string; clientMessageId: string; transcriptId: string };
  session?: { transcriptId: string };
  inputState?: unknown;
};

/** Keep the accepted input identity across lost replies and page reloads. */
export async function submitQueuedInput(id: string, proposed: AppendCommand, isCurrentScope: () => boolean): Promise<unknown> {
  const assertScope = () => {
    if (!isCurrentScope()) throw new DOMException('Conversation changed', 'AbortError');
  };
  const pending = await readPendingSessionCommand(id);
  assertScope();
  if (pending && (pending.kind !== 'append' || pending.execution || pending.delivery !== 'next'
    || canonicalSessionCommand(pending.input) !== canonicalSessionCommand(proposed.input)
    || Boolean(pending.interrupt) !== Boolean(proposed.interrupt))) {
    throw new Error('The previous input is awaiting confirmation');
  }
  const command = sessionInputCommandSchema.parse({ ...(pending ?? proposed), origin: proposed.origin }) as AppendCommand;
  const validate = (payload?: ReceiptPayload) => {
    const receipt = payload?.receipt;
    if (!receipt || receipt.conversationId !== id || receipt.clientMessageId !== command.clientMessageId
      || receipt.transcriptId !== command.expectedTranscriptId || payload?.session?.transcriptId !== receipt.transcriptId) {
      throw new Error('Invalid input receipt or conversation was reset; reload before sending');
    }
    if (!payload?.inputState) throw new Error('Gateway returned an invalid input state');
    return payload.inputState;
  };
  if (pending) {
    const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(id)}/input-receipts/${encodeURIComponent(command.clientMessageId)}`));
    const json = await response.json() as { payload?: ReceiptPayload; error?: { code?: string; message?: string } };
    assertScope();
    if (response.ok) {
      const state = validate(json.payload);
      await clearPendingSessionCommand(id, command.clientMessageId);
      assertScope();
      return state;
    }
    if (response.status !== 404 || json.error?.code !== 'NOT_RECEIVED') throw new Error(json.error?.message ?? 'Input receipt lookup failed');
  }
  const { origin: _origin, ...durable } = command;
  await savePendingSessionCommand(id, durable);
  assertScope();
  const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(id)}/inputs`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
  });
  const json = await response.json() as { payload?: ReceiptPayload; error?: string | { message?: string } };
  assertScope();
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) await clearPendingSessionCommand(id, command.clientMessageId);
    throw new Error(typeof json.error === 'string' ? json.error : json.error?.message ?? 'Message was not accepted');
  }
  const state = validate(json.payload);
  await clearPendingSessionCommand(id, command.clientMessageId);
  assertScope();
  return state;
}

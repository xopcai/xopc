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
  if (pending && (pending.kind !== 'append' || pending.execution || pending.delivery !== proposed.delivery
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
  const lookupReceipt = async (signal?: AbortSignal) => {
    const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(id)}/input-receipts/${encodeURIComponent(command.clientMessageId)}`), { signal });
    const json = await response.json() as { payload?: ReceiptPayload; error?: { code?: string; message?: string } };
    assertScope();
    if (response.ok) return validate(json.payload);
    if (response.status !== 404 || json.error?.code !== 'NOT_RECEIVED') throw new Error(json.error?.message ?? 'Input receipt lookup failed');
    return undefined;
  };
  const confirm = async (state: unknown) => {
    assertScope();
    await clearPendingSessionCommand(id, command.clientMessageId);
    assertScope();
    return state;
  };
  if (pending) {
    const state = await lookupReceipt();
    if (state !== undefined) return confirm(state);
  }
  const { origin: _origin, ...durable } = command;
  await savePendingSessionCommand(id, durable);
  assertScope();
  let response: Response | undefined;
  let state: unknown;
  try {
    response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(id)}/inputs`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
    });
    const json = await response.json() as { payload?: ReceiptPayload; error?: string | { message?: string } };
    assertScope();
    if (!response.ok) {
      throw new Error(typeof json.error === 'string' ? json.error : json.error?.message ?? 'Message was not accepted');
    }
    state = validate(json.payload);
  } catch (error) {
    assertScope();
    if (response && response.status >= 400 && response.status < 500 && response.status !== 408) {
      await clearPendingSessionCommand(id, command.clientMessageId);
      throw error;
    }
    // The gateway may have committed the input before the POST response was lost.
    state = await lookupReceipt(AbortSignal.timeout(3000)).catch(() => undefined);
    assertScope();
    if (state === undefined) throw error;
  }
  return confirm(state);
}

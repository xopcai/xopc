export type ResolveWebchatConversationIdInput = {
  conversationId?: string;
};

export type ResolveWebchatConversationIdResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: string };

/**
 * Resolve the server-owned session key for webchat `/api/agent` requests.
 * Creation is intentionally out-of-band via `POST /api/sessions`.
 */
export function resolveWebchatConversationId(
  input: ResolveWebchatConversationIdInput,
): ResolveWebchatConversationIdResult {
  const raw = input.conversationId?.trim() ?? '';
  if (!raw) return { ok: false, error: 'Missing conversationId; create sessions via POST /api/sessions' };
  return { ok: true, conversationId: raw };
}

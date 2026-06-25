export type ResolveWebchatSessionKeyInput = {
  sessionKey?: string;
};

export type ResolveWebchatSessionKeyResult =
  | { ok: true; sessionKey: string }
  | { ok: false; error: string };

/**
 * Resolve the server-owned session key for webchat `/api/agent` requests.
 * Creation is intentionally out-of-band via `POST /api/sessions`.
 */
export function resolveWebchatSessionKey(
  input: ResolveWebchatSessionKeyInput,
): ResolveWebchatSessionKeyResult {
  const raw = input.sessionKey?.trim() ?? '';
  if (!raw) return { ok: false, error: 'Missing sessionKey; create sessions via POST /api/sessions' };
  return { ok: true, sessionKey: raw };
}

import type { Session } from 'electron';

/** Exchange the saved credential in the isolated partition, before loading any renderer. */
export async function establishRemoteConsoleSession(partition: Pick<Session, 'fetch'>, origin: string, token: string): Promise<void> {
  const response = await partition.fetch(`${origin}/api/browser-session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Origin: origin },
    credentials: 'include',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('GATEWAY_CONSOLE_LOGIN_FAILED');
  const body = await response.json() as { conversationId?: unknown };
  if (typeof body.conversationId !== 'string' || !body.conversationId) throw new Error('GATEWAY_CONSOLE_INCOMPATIBLE');

  // Verify the HttpOnly cookie, without forwarding the long-lived credential again.
  const verified = await partition.fetch(`${origin}/api/browser-session`, {
    credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!verified.ok) throw new Error('GATEWAY_CONSOLE_SESSION_REQUIRED');
  const session = await verified.json() as { conversationId?: unknown };
  if (session.conversationId !== body.conversationId) throw new Error('GATEWAY_CONSOLE_SESSION_REQUIRED');
}

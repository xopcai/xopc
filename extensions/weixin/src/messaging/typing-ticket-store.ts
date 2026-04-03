/** In-memory typing_ticket per (accountId, peer user id) — refreshed from getConfig in monitor. */

const tickets = new Map<string, string>();

function storeKey(accountId: string, ilinkUserId: string): string {
  return `${accountId}:${ilinkUserId}`;
}

export function setWeixinTypingTicket(
  accountId: string,
  ilinkUserId: string,
  typingTicket: string,
): void {
  const k = storeKey(accountId, ilinkUserId);
  const t = typingTicket.trim();
  if (t) tickets.set(k, t);
  else tickets.delete(k);
}

export function getWeixinTypingTicket(accountId: string, ilinkUserId: string): string | undefined {
  return tickets.get(storeKey(accountId, ilinkUserId));
}

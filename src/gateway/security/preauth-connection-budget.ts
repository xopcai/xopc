/**
 * Pre-authentication connection budget per IP address.
 *
 * Limits the number of concurrent unauthenticated connections from a single
 * IP to prevent connection-flood DoS attacks. Once a connection authenticates
 * successfully, its slot is released.
 */

const DEFAULT_MAX_PREAUTH_CONNECTIONS_PER_IP = 32;
const UNKNOWN_CLIENT_IP_BUDGET_KEY = '__xopc_unknown_client_ip__';

export function getMaxPreauthConnectionsPerIp(env: NodeJS.ProcessEnv = process.env): number {
  const configured = env.XOPC_MAX_PREAUTH_CONNECTIONS_PER_IP;
  if (!configured) {
    return DEFAULT_MAX_PREAUTH_CONNECTIONS_PER_IP;
  }
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_PREAUTH_CONNECTIONS_PER_IP;
  }
  return Math.max(1, Math.floor(parsed));
}

export type PreauthConnectionBudget = {
  /** Try to acquire a slot for the given client IP. Returns false if the budget is exhausted. */
  acquire(clientIp: string | undefined): boolean;
  /** Release a slot when the connection authenticates or closes. */
  release(clientIp: string | undefined): void;
  /** Current number of tracked IPs. */
  size(): number;
};

export function createPreauthConnectionBudget(
  limit = getMaxPreauthConnectionsPerIp(),
): PreauthConnectionBudget {
  const counts = new Map<string, number>();

  function normalizeBudgetKey(clientIp: string | undefined): string {
    const ip = clientIp?.trim();
    // Keep unresolved IPs capped under a shared fallback bucket
    // instead of failing open.
    return ip || UNKNOWN_CLIENT_IP_BUDGET_KEY;
  }

  return {
    acquire(clientIp) {
      const ip = normalizeBudgetKey(clientIp);
      const next = (counts.get(ip) ?? 0) + 1;
      if (next > limit) {
        return false;
      }
      counts.set(ip, next);
      return true;
    },

    release(clientIp) {
      const ip = normalizeBudgetKey(clientIp);
      const current = counts.get(ip);
      if (current === undefined) {
        return;
      }
      if (current <= 1) {
        counts.delete(ip);
        return;
      }
      counts.set(ip, current - 1);
    },

    size() {
      return counts.size;
    },
  };
}

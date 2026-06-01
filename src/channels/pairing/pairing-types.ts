/**
 * Pairing public types — extracted from `pairing-service.ts` so leaf modules
 * (`plugins/types.adapters.ts`, etc.) can reference `PairingPendingView`
 * without pulling the full pairing service implementation, which in turn
 * imports `security.ts` and forms a circular cycle.
 */

export type PairingPendingView = {
  senderId: string;
  codeLast4: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isStale: boolean;
  meta?: Record<string, string>;
};

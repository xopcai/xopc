import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export function bindOwnerIdentity(input: { channel: string; accountId: string; peerId: string }): void {
  if (![input.channel, input.accountId, input.peerId].every(value => value.trim())) throw new Error('Identity fields are required.');
  getSqliteDatabase().prepare(`INSERT INTO owner_identity_bindings(principal_id, channel, account_id, peer_id, verified_at)
    VALUES ('local-owner', ?, ?, ?, ?) ON CONFLICT(channel, account_id, peer_id) DO UPDATE
    SET verified_at = excluded.verified_at, revoked_at = NULL`).run(input.channel, input.accountId, input.peerId, Date.now());
}

export function isOwnerIdentity(input: { source: string; accountId: string; peerId: string }): boolean {
  if (['webchat', 'cli', 'tui'].includes(input.source)) return true;
  return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM owner_identity_bindings
    WHERE principal_id = 'local-owner' AND channel = ? AND account_id = ? AND peer_id = ? AND revoked_at IS NULL`)
    .get(input.source, input.accountId, input.peerId));
}

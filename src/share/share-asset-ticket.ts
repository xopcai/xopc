import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TicketedShareRecord {
  id: string;
  snapshotRevision: number;
  assetTicketSecret: string;
}

export function issueShareAssetTicket(record: TicketedShareRecord, ttlMs: number): string {
  const payload = Buffer.from(JSON.stringify({
    shareId: record.id,
    revision: record.snapshotRevision,
    expiresAt: Date.now() + ttlMs,
  })).toString('base64url');
  const signature = createHmac('sha256', record.assetTicketSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyShareAssetTicket(record: TicketedShareRecord, ticket: string): boolean {
  const [payload, signature] = ticket.split('.');
  if (!payload || !signature) return false;
  const expected = createHmac('sha256', record.assetTicketSecret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    return value.shareId === record.id
      && value.revision === record.snapshotRevision
      && typeof value.expiresAt === 'number'
      && Date.now() < value.expiresAt;
  } catch {
    return false;
  }
}

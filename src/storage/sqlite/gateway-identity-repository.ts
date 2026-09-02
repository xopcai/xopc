import crypto from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type GatewayIdentity = {
  id: string;
  publicKey: string;
  privateKey: string;
  createdAt: number;
};

type GatewayIdentityRow = {
  gateway_id: string;
  public_key: string;
  private_key: string;
  created_at: number;
};

function fromRow(row: GatewayIdentityRow): GatewayIdentity {
  return {
    id: row.gateway_id,
    publicKey: row.public_key,
    privateKey: row.private_key,
    createdAt: row.created_at,
  };
}

export function getOrCreateGatewayIdentity(now = Date.now()): GatewayIdentity {
  return runSqliteWriteTransaction((db) => {
    const existing = db.prepare('SELECT * FROM gateway_identity WHERE singleton_id = 1')
      .get() as GatewayIdentityRow | undefined;
    if (existing) return fromRow(existing);

    const keys = crypto.generateKeyPairSync('ed25519');
    const identity: GatewayIdentity = {
      id: crypto.randomUUID(),
      publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      createdAt: now,
    };
    db.prepare(`
      INSERT INTO gateway_identity (
        singleton_id, gateway_id, public_key, private_key, created_at
      ) VALUES (1, ?, ?, ?, ?)
    `).run(identity.id, identity.publicKey, identity.privateKey, identity.createdAt);
    return identity;
  });
}

export function signGatewayPayload(payload: string): string {
  const identity = getOrCreateGatewayIdentity();
  return crypto.sign(null, Buffer.from(payload), identity.privateKey).toString('base64url');
}

export function getGatewayIdentityPublicKeyRaw(identity = getOrCreateGatewayIdentity()): string {
  const jwk = crypto.createPublicKey(identity.publicKey).export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') throw new Error('Gateway identity public key is invalid');
  return jwk.x;
}

export function clearGatewayIdentityForTest(): void {
  getSqliteDatabase().prepare('DELETE FROM gateway_identity').run();
}

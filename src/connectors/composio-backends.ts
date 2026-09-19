import { randomUUID } from 'node:crypto';

import { CredentialResolver } from '../auth/credentials.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export type ComposioBackend = {
  id: string;
  mode: 'managed' | 'byok';
  label: string;
  credential_ref: string | null;
  credential_source: 'stored' | 'environment';
  verified_at: string | null;
  active: number;
  created_at: string;
};

export function listComposioBackends(): ComposioBackend[] {
  return getSqliteDatabase().prepare('SELECT * FROM connector_backends ORDER BY created_at').all() as ComposioBackend[];
}

export function getComposioBackend(id?: string): ComposioBackend | undefined {
  return (id
    ? getSqliteDatabase().prepare('SELECT * FROM connector_backends WHERE id = ?').get(id)
    : getSqliteDatabase().prepare('SELECT * FROM connector_backends WHERE active = 1').get()) as ComposioBackend | undefined;
}

export function addComposioBackend(input: { id?: string; mode: 'managed' | 'byok'; label: string; credentialRef?: string; credentialSource?: 'stored' | 'environment' }): ComposioBackend {
  const id = input.id ?? randomUUID();
  getSqliteDatabase().prepare(`INSERT INTO connector_backends(id, mode, label, credential_ref, credential_source, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, input.mode, input.label, input.credentialRef ?? null, input.credentialSource ?? 'stored', new Date().toISOString());
  return getComposioBackend(id)!;
}

export function activateComposioBackend(id: string): void {
  if (!getComposioBackend(id)) throw new Error('Connection service not found.');
  runSqliteWriteTransaction(db => {
    db.prepare('UPDATE connector_backends SET active = 0 WHERE active = 1').run();
    db.prepare('UPDATE connector_backends SET active = 1 WHERE id = ?').run(id);
  });
}

export async function removeComposioBackend(id: string, resolver = new CredentialResolver()): Promise<void> {
  const backend = getComposioBackend(id);
  if (!backend) throw new Error('Connection service not found.');
  if (backend.active) throw new Error('Select another connection service before removing this one.');
  const inUse = getSqliteDatabase().prepare(`SELECT 1 FROM connector_connections c JOIN connector_accounts a ON a.id = c.account_id
    WHERE a.backend_id = ? AND c.status NOT IN ('revoked') LIMIT 1`).get(id);
  if (inUse) throw new Error('Disconnect the accounts using this service before removing its credentials.');
  if (backend.credential_ref && backend.credential_source === 'stored') await resolver.deleteProviderCredential(backend.credential_ref);
  getSqliteDatabase().prepare('DELETE FROM connector_backends WHERE id = ?').run(id);
}

/** Bootstrap once; subsequent routing always uses the explicitly selected backend. */
export async function ensureComposioBackend(resolver = new CredentialResolver()): Promise<ComposioBackend> {
  const existing = getComposioBackend();
  if (existing) return existing;
  const storedKey = await resolver.resolveApiKey('connector-composio-api-key').catch(() => null);
  const envRef = process.env.XOPC_COMPOSIO_API_KEY?.trim() ? 'XOPC_COMPOSIO_API_KEY' : process.env.COMPOSIO_API_KEY?.trim() ? 'COMPOSIO_API_KEY' : undefined;
  const key = storedKey || (envRef ? process.env[envRef] : undefined);
  // Another initialization may have completed during credential resolution.
  const initialized = getComposioBackend();
  if (initialized) return initialized;
  const backend = addComposioBackend({ mode: key ? 'byok' : 'managed',
    label: key ? 'Composio' : 'XOPC Cloud', credentialRef: storedKey ? 'connector-composio-api-key' : envRef,
    credentialSource: !storedKey && envRef ? 'environment' : 'stored' });
  getSqliteDatabase().prepare('UPDATE connector_accounts SET backend_id = ? WHERE backend_id IS NULL').run(backend.id);
  activateComposioBackend(backend.id);
  return getComposioBackend(backend.id)!;
}

export async function resolveBackendKey(backend: ComposioBackend, resolver = new CredentialResolver()): Promise<string | null> {
  if (backend.mode === 'managed') return null;
  if (backend.credential_source === 'environment') return backend.credential_ref ? process.env[backend.credential_ref]?.trim() || null : null;
  const key = backend.credential_ref ? await resolver.resolveApiKey(backend.credential_ref) : null;
  if (key?.trim()) return key.trim();
  return null;
}

export function markComposioBackendVerified(id: string): void {
  getSqliteDatabase().prepare('UPDATE connector_backends SET verified_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

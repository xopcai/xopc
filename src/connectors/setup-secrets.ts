import crypto from 'node:crypto';

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_TTL_MS = 15 * 60 * 1000;

export type ConnectorSetupSecretRequest = {
  ref: string;
  key: string;
  label?: string;
  createdAt: number;
  expiresAt: number;
};

type PendingSecret = ConnectorSetupSecretRequest & {
  value?: string;
  lastTouchedAt: number;
};

const pendingSecrets = new Map<string, PendingSecret>();

function nowMs(): number {
  return Date.now();
}

function createSecretRef(): string {
  return `secret://${crypto.randomBytes(6).toString('hex')}`;
}

export function createConnectorSetupSecretRequest(params: { key: string; label?: string }): ConnectorSetupSecretRequest {
  sweepExpiredConnectorSetupSecrets();
  const createdAt = nowMs();
  const request: PendingSecret = {
    ref: createSecretRef(),
    key: params.key,
    label: params.label,
    createdAt,
    expiresAt: createdAt + REQUEST_TIMEOUT_MS,
    lastTouchedAt: createdAt,
  };
  pendingSecrets.set(request.ref, request);
  return { ref: request.ref, key: request.key, label: request.label, createdAt: request.createdAt, expiresAt: request.expiresAt };
}

export function submitConnectorSetupSecret(ref: string, value: string): boolean {
  sweepExpiredConnectorSetupSecrets();
  const entry = pendingSecrets.get(ref.trim());
  if (!entry || entry.expiresAt < nowMs() || typeof value !== 'string' || value.length === 0) {
    return false;
  }
  entry.value = value;
  entry.lastTouchedAt = nowMs();
  return true;
}

export function resolveConnectorSetupSecretRef(ref: string): string | undefined {
  sweepExpiredConnectorSetupSecrets();
  const entry = pendingSecrets.get(ref.trim());
  if (!entry?.value) return undefined;
  entry.lastTouchedAt = nowMs();
  return entry.value;
}

export function consumeConnectorSetupSecretRef(ref: string): string | undefined {
  const value = resolveConnectorSetupSecretRef(ref);
  if (value !== undefined) {
    pendingSecrets.delete(ref.trim());
  }
  return value;
}

export function sweepExpiredConnectorSetupSecrets(): number {
  const now = nowMs();
  let removed = 0;
  for (const [ref, entry] of pendingSecrets) {
    if (entry.expiresAt < now || entry.lastTouchedAt + IDLE_TTL_MS < now) {
      pendingSecrets.delete(ref);
      removed += 1;
    }
  }
  return removed;
}

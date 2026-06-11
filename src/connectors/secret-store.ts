import { CredentialResolver } from '../auth/credentials.js';
import type { ConnectorDefinition, ConnectorInstallInput, ConnectorSecretReference } from './types.js';

function normalizeSecretSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function connectorSecretProviderId(connectorId: string, fieldKey: string): string {
  const normalizedConnectorId = normalizeSecretSegment(connectorId);
  const normalizedFieldKey = normalizeSecretSegment(fieldKey);
  return `connector-${normalizedConnectorId}-${normalizedFieldKey}`;
}

export function createConnectorSecretReference(connectorId: string, fieldKey: string): ConnectorSecretReference {
  return {
    xopcSecretRef: {
      provider: connectorSecretProviderId(connectorId, fieldKey),
      fieldKey,
    },
  };
}

export function isConnectorSecretReference(value: unknown): value is ConnectorSecretReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const ref = (value as Record<string, unknown>).xopcSecretRef;
  return Boolean(
    ref &&
      typeof ref === 'object' &&
      !Array.isArray(ref) &&
      typeof (ref as Record<string, unknown>).provider === 'string' &&
      typeof (ref as Record<string, unknown>).fieldKey === 'string',
  );
}

export async function saveConnectorSecrets(
  definition: ConnectorDefinition,
  input: ConnectorInstallInput,
  resolver = new CredentialResolver(),
): Promise<void> {
  for (const secret of definition.setup.secrets ?? []) {
    const rawValue = input.secrets?.[secret.key];
    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
      continue;
    }
    await resolver.saveApiKey(connectorSecretProviderId(definition.id, secret.key), rawValue.trim(), {
      profileName: 'default',
    });
  }
}

async function resolveSecretReference(
  reference: ConnectorSecretReference,
  resolver: CredentialResolver,
): Promise<string | undefined> {
  const value = await resolver.resolveApiKey(reference.xopcSecretRef.provider);
  return value ?? undefined;
}

export async function resolveConnectorSecretReferences(
  value: unknown,
  resolver = new CredentialResolver(),
): Promise<unknown> {
  if (isConnectorSecretReference(value)) {
    return resolveSecretReference(value, resolver);
  }
  if (Array.isArray(value)) {
    const items = await Promise.all(value.map((item) => resolveConnectorSecretReferences(item, resolver)));
    return items.filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const resolved = await resolveConnectorSecretReferences(child, resolver);
      if (resolved !== undefined) {
        output[key] = resolved;
      }
    }
    return output;
  }
  return value;
}

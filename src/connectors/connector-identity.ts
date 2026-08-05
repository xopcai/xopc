import type { ConnectorConnection } from './types.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function payload(value: unknown): Record<string, unknown> {
  const root = object(value);
  return object(root.data ?? root.result ?? root);
}

function text(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function normalizeConnectorIdentity(toolkit: string, result: unknown): ConnectorConnection['identity'] {
  const row = payload(result);
  if (toolkit === 'github') {
    return {
      username: text(row, ['login', 'username']),
      displayName: text(row, ['name']),
      email: text(row, ['email']),
      avatarUrl: text(row, ['avatar_url']),
      profileUrl: text(row, ['html_url']),
    };
  }
  if (toolkit === 'gmail') {
    return { email: text(row, ['emailAddress', 'email']) };
  }
  throw new Error(`Identity normalization is not defined for ${toolkit}.`);
}

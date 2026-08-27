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
  if (toolkit === 'googledrive') {
    const user = object(row.user);
    return {
      email: text(user, ['emailAddress', 'email']) ?? text(row, ['emailAddress', 'email']),
      displayName: text(user, ['displayName', 'name']),
    };
  }
  if (toolkit === 'slack') {
    return {
      enterpriseId: text(row, ['enterprise_id', 'enterpriseId']),
      workspaceId: text(row, ['team_id', 'teamId']),
      workspace: text(row, ['team', 'team_name', 'workspace']),
      userId: text(row, ['user_id', 'userId']),
      username: text(row, ['user', 'username', 'user_name']),
      botUserId: text(row, ['bot_id', 'botId', 'bot_user_id']),
    };
  }
  throw new Error(`Identity normalization is not defined for ${toolkit}.`);
}

export function connectorIdentityKey(
  toolkit: string,
  identity: Record<string, unknown>,
): string | undefined {
  const normalizedToolkit = toolkit.trim().toLowerCase();
  if (normalizedToolkit === 'slack') {
    const workspaceId = text(identity, ['workspaceId', 'teamId', 'team_id']);
    const subjectId = text(identity, ['userId', 'user_id', 'botUserId', 'bot_user_id']);
    if (!workspaceId || !subjectId) return undefined;
    const enterpriseId = text(identity, ['enterpriseId', 'enterprise_id']) ?? '-';
    return `slack:${enterpriseId}:${workspaceId}:${subjectId}`;
  }
  if (normalizedToolkit === 'gmail' || normalizedToolkit === 'googledrive') {
    const email = text(identity, ['email']);
    return email ? `${normalizedToolkit}:${email.toLowerCase()}` : undefined;
  }
  if (normalizedToolkit === 'github') {
    const username = text(identity, ['username']);
    return username ? `github:${username.toLowerCase()}` : undefined;
  }
  return undefined;
}

export function mergeConnectorIdentity(
  toolkit: string,
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedToolkit = toolkit.trim().toLowerCase();
  if (!['gmail', 'googledrive', 'github', 'slack'].includes(normalizedToolkit)) {
    return { ...current, ...incoming };
  }
  const normalized = Object.fromEntries(Object.entries(normalizeConnectorIdentity(normalizedToolkit, incoming))
    .filter(([, value]) => value !== undefined && value !== null && value !== ''));
  return { ...current, ...incoming, ...normalized };
}

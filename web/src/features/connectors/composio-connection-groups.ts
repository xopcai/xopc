import type { ComposioConnection } from './connectors-api';

export type ComposioConnectionGroup = {
  key: string;
  primary: ComposioConnection;
  authorizations: ComposioConnection[];
};

function connectionTime(connection: ComposioConnection): number {
  const value = connection.connectedAt ? Date.parse(connection.connectedAt) : 0;
  return Number.isFinite(value) ? value : 0;
}

function compareConnections(left: ComposioConnection, right: ComposioConnection): number {
  if (left.status === 'active' && right.status !== 'active') return -1;
  if (left.status !== 'active' && right.status === 'active') return 1;
  if (left.isCurrentAuthorization !== right.isCurrentAuthorization) return left.isCurrentAuthorization ? -1 : 1;
  if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
  return connectionTime(right) - connectionTime(left);
}

export function groupComposioConnections(connections: ComposioConnection[]): ComposioConnectionGroup[] {
  const groups = new Map<string, ComposioConnection[]>();
  for (const connection of connections) {
    const key = connection.accountId ?? connection.identityKey ?? `authorization:${connection.id}`;
    groups.set(key, [...(groups.get(key) ?? []), connection]);
  }
  return [...groups.entries()].map(([key, authorizations]) => {
    const sorted = [...authorizations].sort(compareConnections);
    return { key, primary: sorted[0], authorizations: sorted };
  }).sort((left, right) => compareConnections(left.primary, right.primary));
}

import { createHash } from 'node:crypto';

import { listKnowledgeSourceItems } from '../storage/sqlite/index.js';

type Person = {
  id: string; label: string; names: Set<string>; emails: Set<string>; usernames: Set<string>;
  sources: Map<string, { count: number; lastObservedAt: string }>;
  mentionCount: number; lastObservedAt: string;
};

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : undefined;
}

function personKey(name?: string, email?: string, username?: string): string | undefined {
  return email?.toLocaleLowerCase() ?? username?.toLocaleLowerCase() ?? name?.toLocaleLowerCase();
}

function sourceMetadata(sourceInstanceId: string): { connectorId?: string; toolkit?: string } {
  const connectorId = sourceInstanceId.startsWith('composio:') ? sourceInstanceId.split(':')[1] : undefined;
  return connectorId ? { connectorId, toolkit: connectorId.replace(/^composio-/, '') } : {};
}

export function buildConnectedPeopleGraph(options: { query?: string; limit?: number } = {}) {
  const items = listKnowledgeSourceItems({ includeDeleted: false, limit: 500 });
  const people = new Map<string, Person>();
  for (const item of items) {
    const entities = Array.isArray(item.metadata.personEntities) ? item.metadata.personEntities : [];
    for (const raw of entities) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const record = raw as Record<string, unknown>;
      const name = readString(record, 'name');
      const email = readString(record, 'email');
      const username = readString(record, 'username');
      const key = personKey(name, email, username);
      if (!key) continue;
      const observedAt = item.occurredAt ?? new Date(item.updatedAt).toISOString();
      const current = people.get(key) ?? {
        id: createHash('sha256').update(key).digest('hex').slice(0, 20),
        label: name ?? email ?? username!, names: new Set(), emails: new Set(), usernames: new Set(),
        sources: new Map(), mentionCount: 0, lastObservedAt: observedAt,
      };
      if (name) current.names.add(name);
      if (email) current.emails.add(email);
      if (username) current.usernames.add(username);
      current.mentionCount += 1;
      if (observedAt > current.lastObservedAt) current.lastObservedAt = observedAt;
      const source = current.sources.get(item.sourceInstanceId) ?? { count: 0, lastObservedAt: observedAt };
      source.count += 1;
      if (observedAt > source.lastObservedAt) source.lastObservedAt = observedAt;
      current.sources.set(item.sourceInstanceId, source);
      people.set(key, current);
    }
  }
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const all = [...people.values()]
    .filter((person) => !query || [person.label, ...person.names, ...person.emails, ...person.usernames]
      .some((value) => value.toLocaleLowerCase().includes(query)))
    .sort((left, right) => right.mentionCount - left.mentionCount);
  const selected = all.slice(0, Math.max(1, Math.min(options.limit ?? 100, 500)));
  return {
    people: selected.map((person) => ({ id: person.id, label: person.label, names: [...person.names],
      emails: [...person.emails], usernames: [...person.usernames], roles: [],
      mentionCount: person.mentionCount, lastObservedAt: person.lastObservedAt })),
    sourceEdges: selected.flatMap((person) => [...person.sources].map(([sourceInstanceId, source]) => ({
      personId: person.id, sourceInstanceId, ...sourceMetadata(sourceInstanceId),
      mentionCount: source.count, lastObservedAt: source.lastObservedAt,
    }))),
    scannedItems: items.length,
    truncated: all.length > selected.length,
  };
}

import { createHash } from 'node:crypto';

import { listKnowledgeSourceItems } from '../storage/sqlite/knowledge-repository.js';
import type { KnowledgeSourceItem } from './types.js';

export type ConnectedPersonNode = {
  id: string;
  label: string;
  names: string[];
  emails: string[];
  usernames: string[];
  roles: string[];
  mentionCount: number;
  lastObservedAt: string;
};

export type ConnectedPersonSourceEdge = {
  personId: string;
  sourceInstanceId: string;
  connectorId?: string;
  toolkit?: string;
  mentionCount: number;
  lastObservedAt: string;
};

export type ConnectedPeopleGraph = {
  people: ConnectedPersonNode[];
  sourceEdges: ConnectedPersonSourceEdge[];
  scannedItems: number;
  truncated: boolean;
};

type PersonSignal = { role?: string; name?: string; email?: string; username?: string };

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function signalsFor(item: KnowledgeSourceItem): PersonSignal[] {
  const structured = item.metadata.personEntities;
  if (Array.isArray(structured)) {
    const signals = structured.flatMap((value): PersonSignal[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const record = value as Record<string, unknown>;
      const signal = {
        role: nonEmpty(record.role),
        name: nonEmpty(record.name),
        email: nonEmpty(record.email),
        username: nonEmpty(record.username),
      };
      return signal.name || signal.email || signal.username ? [signal] : [];
    });
    if (signals.length > 0) return signals;
  }
  return Array.isArray(item.metadata.people)
    ? item.metadata.people.flatMap((value): PersonSignal[] => {
        const text = nonEmpty(value);
        if (!text) return [];
        return text.includes('@') ? [{ email: text }] : [{ name: text }];
      })
    : [];
}

function identityFor(signal: PersonSignal): string | undefined {
  if (signal.email) return `email:${signal.email.toLowerCase()}`;
  if (signal.username) return `username:${signal.username.toLowerCase().replace(/^@/, '')}`;
  if (signal.name) return `name:${signal.name.toLocaleLowerCase()}`;
  return undefined;
}

function personId(identity: string): string {
  return `person_${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function latest(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function buildConnectedPeopleGraph(options: { query?: string; limit?: number } = {}): ConnectedPeopleGraph {
  const maxItems = 5_000;
  const items: KnowledgeSourceItem[] = [];
  for (let offset = 0; offset < maxItems; offset += 500) {
    const page = listKnowledgeSourceItems({ limit: 500, offset });
    items.push(...page);
    if (page.length < 500) break;
  }
  const nodeByIdentity = new Map<string, {
    node: ConnectedPersonNode;
    names: Set<string>;
    emails: Set<string>;
    usernames: Set<string>;
    roles: Set<string>;
  }>();
  const edgeByKey = new Map<string, ConnectedPersonSourceEdge>();

  for (const item of items) {
    const observedAt = item.occurredAt ?? item.sourceUpdatedAt ?? item.updatedAt;
    const observedIdentities = new Set<string>();
    for (const signal of signalsFor(item)) {
      const identity = identityFor(signal);
      if (!identity) continue;
      let aggregate = nodeByIdentity.get(identity);
      if (!aggregate) {
        const id = personId(identity);
        aggregate = {
          node: {
            id,
            label: signal.name ?? signal.email ?? signal.username ?? identity,
            names: [],
            emails: [],
            usernames: [],
            roles: [],
            mentionCount: 0,
            lastObservedAt: observedAt,
          },
          names: new Set(),
          emails: new Set(),
          usernames: new Set(),
          roles: new Set(),
        };
        nodeByIdentity.set(identity, aggregate);
      }
      if (signal.name) aggregate.names.add(signal.name);
      if (signal.email) aggregate.emails.add(signal.email.toLowerCase());
      if (signal.username) aggregate.usernames.add(signal.username.replace(/^@/, ''));
      if (signal.role) aggregate.roles.add(signal.role);
      if (observedIdentities.has(identity)) continue;
      observedIdentities.add(identity);
      aggregate.node.mentionCount += 1;
      aggregate.node.lastObservedAt = latest(aggregate.node.lastObservedAt, observedAt);

      const edgeKey = `${aggregate.node.id}\u0000${item.sourceInstanceId}`;
      const existingEdge = edgeByKey.get(edgeKey);
      if (existingEdge) {
        existingEdge.mentionCount += 1;
        existingEdge.lastObservedAt = latest(existingEdge.lastObservedAt, observedAt);
      } else {
        edgeByKey.set(edgeKey, {
          personId: aggregate.node.id,
          sourceInstanceId: item.sourceInstanceId,
          connectorId: nonEmpty(item.metadata.connectorId),
          toolkit: nonEmpty(item.metadata.toolkit),
          mentionCount: 1,
          lastObservedAt: observedAt,
        });
      }
    }
  }

  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const matchingPeople = [...nodeByIdentity.values()]
    .map((aggregate) => ({
      ...aggregate.node,
      names: [...aggregate.names].toSorted(),
      emails: [...aggregate.emails].toSorted(),
      usernames: [...aggregate.usernames].toSorted(),
      roles: [...aggregate.roles].toSorted(),
    }))
    .filter((person) => !query || [person.label, ...person.names, ...person.emails, ...person.usernames]
      .some((value) => value.toLocaleLowerCase().includes(query)))
    .toSorted((left, right) => right.mentionCount - left.mentionCount || right.lastObservedAt.localeCompare(left.lastObservedAt));
  const people = matchingPeople.slice(0, limit);
  const included = new Set(people.map((person) => person.id));
  return {
    people,
    sourceEdges: [...edgeByKey.values()].filter((edge) => included.has(edge.personId)),
    scannedItems: items.length,
    truncated: items.length >= maxItems || matchingPeople.length > limit,
  };
}

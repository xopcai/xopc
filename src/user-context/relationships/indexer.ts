import { createHash } from 'node:crypto';

import type { KnowledgeSourceItem } from '../../knowledge/types.js';
import {
  getSqliteDatabase,
  getUserPeopleIndexState,
  listKnowledgeSourceItems,
  replaceUserPeopleIndex,
} from '../../storage/sqlite/index.js';
import { listUnderstandingSourceGrants } from '../sources/repository.js';
import type {
  UserPersonHandle,
  UserPersonIndexEntry,
  UserPersonKind,
  UserPersonSource,
} from './types.js';

type PersonSignal = { name?: string; email?: string; username?: string };

type PersonAccumulator = {
  id: string;
  displayName: string;
  inferredKind: UserPersonKind;
  confidence: number;
  firstObservedAt: number;
  lastObservedAt: number;
  handles: Map<string, UserPersonHandle>;
  sources: Map<string, UserPersonSource>;
};

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function normalized(value?: string): string | undefined {
  const result = value?.trim().toLocaleLowerCase();
  return result || undefined;
}

function readSignal(value: unknown): PersonSignal | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const read = (key: string) => typeof row[key] === 'string' && row[key].trim()
    ? row[key].trim().slice(0, 160)
    : undefined;
  const signal = { name: read('name'), email: read('email'), username: read('username') };
  return signal.name || signal.email || signal.username ? signal : undefined;
}

function providerScope(sourceInstanceId: string): string {
  if (!sourceInstanceId.startsWith('composio:')) return sourceInstanceId.toLocaleLowerCase();
  return sourceInstanceId.split(':')[1]?.toLocaleLowerCase() ?? sourceInstanceId.toLocaleLowerCase();
}

export function personIdentityKey(signal: PersonSignal, sourceInstanceId: string): string | undefined {
  const email = normalized(signal.email);
  if (email) return `email:${email}`;
  const username = normalized(signal.username);
  if (username) return `provider:${providerScope(sourceInstanceId)}:${username}`;
  const name = normalized(signal.name);
  return name ? `name:${sourceInstanceId.toLocaleLowerCase()}:${name}` : undefined;
}

export function personIdForIdentity(signal: PersonSignal, sourceInstanceId: string): string | undefined {
  const key = personIdentityKey(signal, sourceInstanceId);
  return key ? `person_${hash(key)}` : undefined;
}

function inferredKind(signal: PersonSignal): UserPersonKind {
  const name = normalized(signal.name) ?? '';
  const username = normalized(signal.username) ?? '';
  const email = normalized(signal.email) ?? '';
  const emailLocal = email.split('@')[0] ?? '';
  if (/\[bot\]|(?:^|[-_.])bot(?:$|[-_.])|bot$/.test(`${name} ${username}`)) return 'bot';
  if (/^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|alerts?|mailer[-_.]?daemon)(?:$|[-+_.])/.test(emailLocal)) {
    return 'service';
  }
  if (/^(?:team|group|all|everyone|support|help|sales|contact)(?:$|[-+_.])/.test(emailLocal)) return 'group';
  if (!signal.name && !signal.email && signal.username) return 'unknown';
  return 'person';
}

function confidence(signal: PersonSignal): number {
  if (signal.email) return signal.name ? 0.95 : 0.88;
  if (signal.username) return signal.name ? 0.86 : 0.72;
  return 0.55;
}

function observedAt(item: KnowledgeSourceItem): number {
  const value = Date.parse(item.occurredAt ?? item.sourceUpdatedAt ?? item.updatedAt);
  return Number.isFinite(value) ? value : Date.now();
}

function handle(
  personId: string,
  type: UserPersonHandle['type'],
  value: string,
  sourceInstanceId: string,
  time: number,
): UserPersonHandle {
  return {
    id: `handle_${hash(`${type}:${normalized(value)}:${sourceInstanceId}`)}`,
    type,
    value,
    sourceInstanceId,
    verification: type === 'display_name' ? 'inferred' : 'observed',
    firstObservedAt: time,
    lastObservedAt: time,
  };
}

function activeConnectorSources(): Set<string> {
  return new Set(listUnderstandingSourceGrants().flatMap((grant) => {
    const sourceInstanceId = typeof grant.config.sourceInstanceId === 'string'
      ? grant.config.sourceInstanceId.trim()
      : '';
    if (sourceInstanceId) return [sourceInstanceId];
    const connectorId = typeof grant.config.connectorId === 'string' ? grant.config.connectorId.trim() : '';
    const accountId = typeof grant.config.accountId === 'string' ? grant.config.accountId.trim() : '';
    return connectorId && accountId ? [`composio:${connectorId}:${accountId}`] : [];
  }));
}

function loadActiveSourceItems(): KnowledgeSourceItem[] {
  const activeSources = activeConnectorSources();
  const items: KnowledgeSourceItem[] = [];
  let offset = 0;
  while (true) {
    const page = listKnowledgeSourceItems({ includeDeleted: false, limit: 500, offset });
    items.push(...page.filter((item) => (
      item.synthesisPipeline === 'connected_knowledge'
      && item.sensitivity !== 'secret'
      && item.sensitivity !== 'regulated'
      && item.metadata.observationKind !== 'inventory'
      && (!item.sourceInstanceId.startsWith('composio:') || activeSources.has(item.sourceInstanceId))
    )));
    if (page.length < 500) break;
    offset += page.length;
  }
  return items;
}

function currentIndexRevision(): { sourceChangeSequence: number; sourceGrantsUpdatedAt: number } {
  const db = getSqliteDatabase();
  const sourceChangeSequence = Number((db.prepare('SELECT COALESCE(MAX(sequence), 0) AS value FROM knowledge_source_changes')
    .get() as { value: number }).value);
  const sourceGrantsUpdatedAt = Number((db.prepare('SELECT COALESCE(MAX(updated_at), 0) AS value FROM understanding_source_grants')
    .get() as { value: number }).value);
  return { sourceChangeSequence, sourceGrantsUpdatedAt };
}

export function buildUserPeopleIndex(items: KnowledgeSourceItem[]): UserPersonIndexEntry[] {
  const owners = new Set(items.flatMap((item) => Array.isArray(item.metadata.ownerIdentities)
    ? item.metadata.ownerIdentities.filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLocaleLowerCase()).filter(Boolean)
    : []));
  const people = new Map<string, PersonAccumulator>();
  for (const item of items) {
    const values = Array.isArray(item.metadata.personEntities) ? item.metadata.personEntities : [];
    const seenInItem = new Set<string>();
    for (const value of values) {
      const signal = readSignal(value);
      if (!signal) continue;
      const strongIdentity = normalized(signal.email) ?? normalized(signal.username);
      if (strongIdentity && owners.has(strongIdentity)) continue;
      const identityKey = personIdentityKey(signal, item.sourceInstanceId);
      const id = personIdForIdentity(signal, item.sourceInstanceId);
      if (!identityKey || !id || seenInItem.has(identityKey)) continue;
      seenInItem.add(identityKey);
      const time = observedAt(item);
      const name = signal.name ?? signal.email ?? signal.username!;
      const current = people.get(identityKey) ?? {
        id,
        displayName: name,
        inferredKind: inferredKind(signal),
        confidence: confidence(signal),
        firstObservedAt: time,
        lastObservedAt: time,
        handles: new Map(),
        sources: new Map(),
      };
      if (signal.name && (!current.displayName || current.displayName.includes('@'))) current.displayName = signal.name;
      current.inferredKind = current.inferredKind === 'unknown' ? inferredKind(signal) : current.inferredKind;
      current.confidence = Math.max(current.confidence, confidence(signal));
      current.firstObservedAt = Math.min(current.firstObservedAt, time);
      current.lastObservedAt = Math.max(current.lastObservedAt, time);
      for (const [type, displayValue] of [
        ['email', signal.email],
        ['username', signal.username],
        ['display_name', signal.name],
      ] as const) {
        if (!displayValue) continue;
        const next = handle(id, type, displayValue, item.sourceInstanceId, time);
        const key = `${type}:${normalized(displayValue)}:${item.sourceInstanceId}`;
        const previous = current.handles.get(key);
        if (previous) {
          previous.firstObservedAt = Math.min(previous.firstObservedAt, time);
          previous.lastObservedAt = Math.max(previous.lastObservedAt, time);
        } else current.handles.set(key, next);
      }
      const source = current.sources.get(item.sourceInstanceId) ?? {
        sourceInstanceId: item.sourceInstanceId,
        interactionCount: 0,
        firstObservedAt: time,
        lastObservedAt: time,
      };
      source.interactionCount += 1;
      source.firstObservedAt = Math.min(source.firstObservedAt, time);
      source.lastObservedAt = Math.max(source.lastObservedAt, time);
      current.sources.set(item.sourceInstanceId, source);
      people.set(identityKey, current);
    }
  }
  return [...people.values()].map((person) => ({
    id: person.id,
    displayName: person.displayName,
    inferredKind: person.inferredKind,
    confidence: person.confidence,
    firstObservedAt: person.firstObservedAt,
    lastObservedAt: person.lastObservedAt,
    handles: [...person.handles.values()],
    sources: [...person.sources.values()],
  }));
}

export function rebuildUserPeopleIndex(): UserPersonIndexEntry[] {
  const revision = currentIndexRevision();
  const entries = buildUserPeopleIndex(loadActiveSourceItems());
  replaceUserPeopleIndex(entries, revision);
  return entries;
}

export function ensureUserPeopleIndex(): void {
  const revision = currentIndexRevision();
  const state = getUserPeopleIndexState();
  if (!state
    || state.sourceChangeSequence !== revision.sourceChangeSequence
    || state.sourceGrantsUpdatedAt !== revision.sourceGrantsUpdatedAt) {
    rebuildUserPeopleIndex();
  }
}

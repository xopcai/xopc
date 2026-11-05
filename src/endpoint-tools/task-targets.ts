import { randomUUID } from 'node:crypto';

import type { EndpointConnectionSnapshot } from './registry.js';
import type { EndpointRegistry } from './registry.js';

export interface EndpointExecutionTarget {
  conversationId: string;
  endpointId: string;
  principalId: string;
  connectionId: string;
  executionRef: string;
  selectedAt: number;
  expiresAt: number;
  transcriptId?: string;
  actorPrincipalId?: string;
}

interface TaskTargetStore {
  get(key: string): EndpointExecutionTarget | undefined;
  set(key: string, value: EndpointExecutionTarget): unknown;
  delete(key: string): boolean;
  entries(): Iterable<[string, EndpointExecutionTarget]>;
}

/** An execution target is pinned to a connection and transcript; reconnect never retargets it. */
export class EndpointTaskTargetService {
  private readonly resources = new Map<string, Set<string>>();
  private readonly listeners = new Set<(conversationId: string) => void>();

  constructor(private readonly registry: EndpointRegistry,
    private readonly transcriptId: (conversationId: string) => string | undefined = () => undefined,
    private readonly actorPrincipalId: (conversationId: string) => string | undefined = () => undefined,
    private readonly targets: TaskTargetStore = new Map<string, EndpointExecutionTarget>()) {}

  onChange(listener: (conversationId: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  select(conversationId: string, endpointId: string, now = Date.now(), actorPrincipalId?: string): EndpointExecutionTarget {
    const key = this.key(conversationId), endpoint = this.registry.get(endpointId);
    if (!endpoint) throw new Error('TARGET_OFFLINE');
    actorPrincipalId ??= this.actorPrincipalId(key);
    const current = this.get(key);
    if (current && current.endpointId === endpointId && current.principalId === endpoint.principalId && current.connectionId === endpoint.connectionId
      && current.actorPrincipalId === actorPrincipalId && current.expiresAt > now) return current;
    this.assertReleased(key);
    if (!current) {
      const stored = [...this.targets.entries()];
      if (stored.length >= 2048) {
        for (const [id, target] of stored) {
          if (!this.resources.has(id) && target.transcriptId && target.transcriptId !== this.transcriptId(id)) this.clear(id);
        }
        if ([...this.targets.entries()].length >= 2048) throw new Error('TARGET_CAPACITY_EXCEEDED');
      }
    }
    const target: EndpointExecutionTarget = { conversationId: key, endpointId, principalId: endpoint.principalId,
      connectionId: endpoint.connectionId, executionRef: randomUUID(), selectedAt: now, expiresAt: now + 30 * 60_000,
      transcriptId: this.transcriptId(key), actorPrincipalId };
    this.targets.set(key, target);
    for (const listener of this.listeners) listener(key);
    return { ...target };
  }

  get(conversationId: string): EndpointExecutionTarget | undefined {
    const key = this.key(conversationId), target = this.targets.get(key);
    if (!target) return;
    if (target.transcriptId !== this.transcriptId(key)) {
      this.clear(key);
      return;
    }
    return { ...target };
  }

  resolve(conversationId: string): EndpointConnectionSnapshot | undefined {
    const target = this.get(conversationId);
    if (!target || target.expiresAt <= Date.now()) return;
    if (target.actorPrincipalId && target.actorPrincipalId !== this.actorPrincipalId(conversationId)) return;
    const endpoint = this.registry.get(target.endpointId);
    return endpoint && endpoint.connectionId === target.connectionId && endpoint.principalId === target.principalId ? endpoint : undefined;
  }

  hold(conversationId: string, resourceId: string): () => void {
    const key = this.key(conversationId);
    const resources = this.resources.get(key) ?? new Set<string>();
    if (resources.has(resourceId)) throw new Error('TARGET_RESOURCE_ALREADY_HELD');
    resources.add(resourceId); this.resources.set(key, resources);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      resources.delete(resourceId);
      if (!resources.size && this.resources.get(key) === resources) this.resources.delete(key);
    };
  }

  private assertReleased(key: string): void {
    if (this.resources.get(key)?.size) throw new Error('TARGET_RESOURCE_BUSY: Close the active device resources before changing target');
  }

  clear(conversationId: string): boolean {
    const key = this.key(conversationId);
    this.assertReleased(key);
    const removed = this.targets.delete(key);
    if (removed) for (const listener of this.listeners) listener(key);
    return removed;
  }

  private key(conversationId: string): string {
    const key = conversationId.trim();
    if (!key || key.length > 500) throw new Error('Invalid conversation identity');
    return key;
  }
}

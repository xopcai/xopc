import type { EndpointConnectionSnapshot } from './registry.js';
import { EndpointRegistry } from './registry.js';

export interface EndpointSessionBinding {
  conversationId: string;
  endpointId: string;
  boundAt: number;
}

export interface EndpointSessionBindingStore {
  get(conversationId: string): EndpointSessionBinding | undefined;
  set(binding: EndpointSessionBinding): EndpointSessionBinding;
  delete(conversationId: string): boolean;
}

function memoryStore(): EndpointSessionBindingStore {
  const bindings = new Map<string, EndpointSessionBinding>();
  return {
    get: (conversationId) => bindings.get(conversationId),
    set: (binding) => {
      bindings.set(binding.conversationId, binding);
      return binding;
    },
    delete: (conversationId) => bindings.delete(conversationId),
  };
}

export class EndpointBindingService {
  private readonly changeListeners = new Set<(conversationId: string) => void>();

  onChange(listener: (conversationId: string) => void): () => void {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  }

  constructor(
    private readonly registry: EndpointRegistry,
    private readonly store: EndpointSessionBindingStore = memoryStore(),
  ) {}

  bind(conversationId: string, endpointId: string, now = Date.now()): EndpointSessionBinding {
    const normalizedConversationId = this.normalizeConversationId(conversationId);
    if (!this.registry.get(endpointId)) throw new Error('Endpoint is offline');
    const binding = { conversationId: normalizedConversationId, endpointId, boundAt: now };
    const stored = this.store.set(binding);
    for (const listener of this.changeListeners) listener(normalizedConversationId);
    return stored;
  }

  get(conversationId: string): EndpointSessionBinding | undefined {
    return this.store.get(this.normalizeConversationId(conversationId));
  }

  resolve(conversationId: string): EndpointConnectionSnapshot | undefined {
    const binding = this.get(conversationId);
    return binding ? this.registry.get(binding.endpointId) : undefined;
  }

  unbind(conversationId: string): boolean {
    const normalized = this.normalizeConversationId(conversationId);
    const removed = this.store.delete(normalized);
    if (removed) for (const listener of this.changeListeners) listener(normalized);
    return removed;
  }

  private normalizeConversationId(conversationId: string): string {
    const normalized = conversationId.trim();
    if (!normalized || normalized.length > 500) throw new TypeError('Invalid session key');
    return normalized;
  }
}

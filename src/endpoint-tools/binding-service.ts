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
  constructor(
    private readonly registry: EndpointRegistry,
    private readonly store: EndpointSessionBindingStore = memoryStore(),
  ) {}

  bind(conversationId: string, endpointId: string, now = Date.now()): EndpointSessionBinding {
    const normalizedConversationId = this.normalizeConversationId(conversationId);
    if (!this.registry.get(endpointId)) throw new Error('Endpoint is offline');
    const binding = { conversationId: normalizedConversationId, endpointId, boundAt: now };
    return this.store.set(binding);
  }

  get(conversationId: string): EndpointSessionBinding | undefined {
    return this.store.get(this.normalizeConversationId(conversationId));
  }

  resolve(conversationId: string): EndpointConnectionSnapshot | undefined {
    const binding = this.get(conversationId);
    return binding ? this.registry.get(binding.endpointId) : undefined;
  }

  unbind(conversationId: string): boolean {
    return this.store.delete(this.normalizeConversationId(conversationId));
  }

  private normalizeConversationId(conversationId: string): string {
    const normalized = conversationId.trim();
    if (!normalized || normalized.length > 500) throw new TypeError('Invalid session key');
    return normalized;
  }
}

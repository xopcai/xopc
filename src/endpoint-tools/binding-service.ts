import type { EndpointConnectionSnapshot } from './registry.js';
import { EndpointRegistry } from './registry.js';

export interface EndpointSessionBinding {
  sessionKey: string;
  endpointId: string;
  boundAt: number;
}

export interface EndpointSessionBindingStore {
  get(sessionKey: string): EndpointSessionBinding | undefined;
  set(binding: EndpointSessionBinding): EndpointSessionBinding;
  delete(sessionKey: string): boolean;
}

function memoryStore(): EndpointSessionBindingStore {
  const bindings = new Map<string, EndpointSessionBinding>();
  return {
    get: (sessionKey) => bindings.get(sessionKey),
    set: (binding) => {
      bindings.set(binding.sessionKey, binding);
      return binding;
    },
    delete: (sessionKey) => bindings.delete(sessionKey),
  };
}

export class EndpointBindingService {
  constructor(
    private readonly registry: EndpointRegistry,
    private readonly store: EndpointSessionBindingStore = memoryStore(),
  ) {}

  bind(sessionKey: string, endpointId: string, now = Date.now()): EndpointSessionBinding {
    const normalizedSessionKey = this.normalizeSessionKey(sessionKey);
    if (!this.registry.get(endpointId)) throw new Error('Endpoint is offline');
    const binding = { sessionKey: normalizedSessionKey, endpointId, boundAt: now };
    return this.store.set(binding);
  }

  get(sessionKey: string): EndpointSessionBinding | undefined {
    return this.store.get(this.normalizeSessionKey(sessionKey));
  }

  resolve(sessionKey: string): EndpointConnectionSnapshot | undefined {
    const binding = this.get(sessionKey);
    return binding ? this.registry.get(binding.endpointId) : undefined;
  }

  unbind(sessionKey: string): boolean {
    return this.store.delete(this.normalizeSessionKey(sessionKey));
  }

  private normalizeSessionKey(sessionKey: string): string {
    const normalized = sessionKey.trim();
    if (!normalized || normalized.length > 500) throw new TypeError('Invalid session key');
    return normalized;
  }
}

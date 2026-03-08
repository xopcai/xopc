/**
 * Typed Event Bus - Phase 3
 *
 * Type-safe event bus for inter-extension communication.
 *
 * Features:
 * - Type-safe event emission and listening
 * - Request-response pattern (RPC)
 * - Wildcard pattern matching for events
 * - Automatic cleanup on plugin unload
 * - Error handling with optional error catching
 */

import type {
  EventMap,
  RequestMap,
  EventHandler,
  EventHandlerMeta,
  RequestHandler,
  RequestHandlerMeta,
  WildcardEventHandler,
  WildcardHandlerMeta,
  TypedEventBusOptions,
  RequestOptions,
} from './types/events.js';
import type { PluginLogger } from './types/core.js';

interface InternalRequest {
  id: string;
  method: string;
  params: unknown;
  timeout: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Type-safe event bus for inter-extension communication
 *
 * @example
 * ```typescript
 * interface MyEvents {
 *   'user:login': { userId: string; timestamp: number };
 *   'message:received': { chatId: string; content: string };
 * }
 *
 * interface MyRequests {
 *   'user:get': { userId: string };
 * }
 *
 * interface MyResponses {
 *   'user:get': { name: string; email: string };
 * }
 *
 * const bus = new TypedEventBus<MyEvents, MyRequests, MyResponses>();
 *
 * // Listen for events
 * bus.on('user:login', (data) => {
 *   console.log(`User ${data.userId} logged in`);
 * });
 *
 * // Emit events
 * bus.emit('user:login', { userId: 'user123', timestamp: Date.now() });
 *
 * // Request-response
 * bus.onRequest('user:get', async (params) => {
 *   return { name: 'John', email: 'john@example.com' };
 * });
 *
 * const user = await bus.request('user:get', { userId: 'user123' });
 * ```
 */
export class TypedEventBus<
  TEvents extends EventMap = EventMap,
  TRequests extends RequestMap = RequestMap,
  _TResponses extends RequestMap = RequestMap
> {
  private eventHandlers = new Map<keyof TEvents, EventHandlerMeta[]>();
  private wildcardHandlers: WildcardHandlerMeta[] = [];
  private requestHandlers = new Map<keyof TRequests, RequestHandlerMeta[]>();
  private pendingRequests = new Map<string, InternalRequest>();
  private options: Required<TypedEventBusOptions>;
  private requestIdCounter = 0;

  constructor(options: TypedEventBusOptions = {}) {
    this.options = {
      requestTimeout: options.requestTimeout ?? 5000,
      catchErrors: options.catchErrors ?? true,
      logger: options.logger ?? this.createDefaultLogger(),
    };
  }

  // ============================================================================
  // Event Emission and Listening
  // ============================================================================

  /**
   * Subscribe to an event
   *
   * @param event - Event name
   * @param handler - Event handler function
   * @param options - Handler options (pluginId, once)
   * @returns Unsubscribe function
   */
  on<K extends keyof TEvents>(
    event: K,
    handler: EventHandler<TEvents[K]>,
    options: { pluginId?: string; once?: boolean } = {}
  ): () => void {
    const meta: EventHandlerMeta = {
      handler: handler as EventHandler<unknown>,
      pluginId: options.pluginId,
      once: options.once,
    };

    const handlers = this.eventHandlers.get(event) || [];
    handlers.push(meta);
    this.eventHandlers.set(event, handlers);

    // Return unsubscribe function
    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Unsubscribe from an event
   *
   * @param event - Event name
   * @param handler - Handler to remove
   */
  off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;

    const index = handlers.findIndex((h) => h.handler === handler);
    if (index >= 0) {
      handlers.splice(index, 1);
      if (handlers.length === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  /**
   * Emit an event
   *
   * @param event - Event name
   * @param data - Event data
   */
  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
    // Call specific handlers
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      // Filter out 'once' handlers that need to be removed after execution
      const handlersToRemove: number[] = [];

      handlers.forEach((meta, index) => {
        try {
          meta.handler(data);
          if (meta.once) {
            handlersToRemove.push(index);
          }
        } catch (error) {
          this.handleError(`Error in event handler for ${String(event)}`, error);
        }
      });

      // Remove once handlers (in reverse order to maintain indices)
      for (let i = handlersToRemove.length - 1; i >= 0; i--) {
        handlers.splice(handlersToRemove[i], 1);
      }

      if (handlers.length === 0) {
        this.eventHandlers.delete(event);
      }
    }

    // Call wildcard handlers
    this.wildcardHandlers.forEach((meta) => {
      if (this.matchWildcard(meta.pattern, String(event))) {
        try {
          meta.handler(data, String(event));
        } catch (error) {
          this.handleError(`Error in wildcard handler for ${String(event)}`, error);
        }
      }
    });
  }

  // ============================================================================
  // Wildcard Pattern Matching
  // ============================================================================

  /**
   * Subscribe to events matching a wildcard pattern
   *
   * @param pattern - Wildcard pattern (e.g., 'user:*', '*:update')
   * @param handler - Handler function
   * @param options - Handler options (pluginId)
   * @returns Unsubscribe function
   */
  onWildcard(
    pattern: string,
    handler: WildcardEventHandler,
    options: { pluginId?: string } = {}
  ): () => void {
    const meta: WildcardHandlerMeta = {
      handler,
      pattern,
      pluginId: options.pluginId,
    };

    this.wildcardHandlers.push(meta);

    return () => {
      const index = this.wildcardHandlers.findIndex((h) => h.handler === handler);
      if (index >= 0) {
        this.wildcardHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Check if an event matches a wildcard pattern
   */
  private matchWildcard(pattern: string, event: string): boolean {
    // Handle single * that matches everything
    if (pattern === '*') {
      return true;
    }

    // Convert pattern to regex
    // * matches any sequence of characters
    // Escape special regex characters except *
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*'); // * becomes .*

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(event);
  }

  // ============================================================================
  // Request-Response Pattern
  // ============================================================================

  /**
   * Register a request handler
   */
  onRequest<K extends keyof TRequests>(
    method: K,
    handler: (params: TRequests[K]) => unknown | Promise<unknown>,
    options: { pluginId?: string } = {}
  ): void {
    const meta: RequestHandlerMeta = {
      handler: handler as RequestHandler<unknown, unknown>,
      pluginId: options.pluginId,
    };

    const handlers = this.requestHandlers.get(method) || [];
    handlers.push(meta);
    this.requestHandlers.set(method, handlers);
  }

  /**
   * Make a request and wait for response
   */
  async request<K extends keyof TRequests>(
    method: K,
    params: TRequests[K],
    _options: RequestOptions = {}
  ): Promise<unknown> {
    // Check if there are any handlers
    const handlers = this.requestHandlers.get(method);
    if (!handlers || handlers.length === 0) {
      throw new Error(`No handler registered for request: ${String(method)}`);
    }

    // Try handlers in order until one returns a non-null result
    for (const meta of handlers) {
      try {
        const result = await meta.handler(params);
        if (result !== null && result !== undefined) {
          return result;
        }
      } catch (error) {
        this.handleError(`Error in request handler for ${String(method)}`, error);
        throw error;
      }
    }

    throw new Error(`All handlers returned null for request: ${String(method)}`);
  }

  // ============================================================================
  // Plugin Cleanup
  // ============================================================================

  /**
   * Remove all listeners and handlers for a specific plugin
   *
   * @param pluginId - Plugin ID to cleanup
   */
  cleanup(pluginId: string): void {
    for (const [event, handlers] of this.eventHandlers.entries()) {
      const filtered = handlers.filter((h) => h.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.eventHandlers.delete(event);
      } else {
        this.eventHandlers.set(event, filtered);
      }
    }

    this.wildcardHandlers = this.wildcardHandlers.filter((h) => h.pluginId !== pluginId);

    for (const [method, handlers] of this.requestHandlers.entries()) {
      const filtered = handlers.filter((h) => h.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.requestHandlers.delete(method);
      } else {
        this.requestHandlers.set(method, filtered);
      }
    }
  }

  cleanupAll(): void {
    this.eventHandlers.clear();
    this.wildcardHandlers = [];
    this.requestHandlers.clear();
    for (const req of this.pendingRequests.values()) {
      req.reject(new Error('EventBus cleanup'));
    }
    this.pendingRequests.clear();
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get number of active event handlers for an event
   */
  listenerCount<K extends keyof TEvents>(event: K): number {
    const handlers = this.eventHandlers.get(event);
    return handlers?.length || 0;
  }

  /**
   * Get all registered event names
   */
  eventNames(): (keyof TEvents)[] {
    return Array.from(this.eventHandlers.keys());
  }

  /**
   * Remove all listeners (use with caution)
   */
  removeAllListeners(): void {
    this.eventHandlers.clear();
    this.wildcardHandlers = [];
    this.requestHandlers.clear();

    // Cancel all pending requests
    for (const request of this.pendingRequests.values()) {
      if (request.timer) {
        clearTimeout(request.timer);
      }
      request.reject(new Error('EventBus destroyed'));
    }
    this.pendingRequests.clear();
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private handleError(message: string, error: unknown): void {
    if (this.options.catchErrors) {
      this.options.logger.error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
    } else {
      throw error;
    }
  }

  private createDefaultLogger(): PluginLogger {
    return {
      debug: () => {},
      info: () => {},
      warn: console.warn,
      error: console.error,
    };
  }
}

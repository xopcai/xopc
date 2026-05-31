/**
 * Extension System - Event Bus Types
 * 
 * Type-safe event bus for inter-extension communication.
 */

// `core.ts` imports `TypedEventBus` from this file, so importing `ExtensionLogger`
// back from there would create a circular cycle. Inline the 4-method shape.
interface ExtensionLogger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

// ============================================================================
// Event Bus Core Types
// ============================================================================

export interface EventMap extends Record<string, unknown> {}

export interface RequestMap extends Record<string, unknown> {}

export interface ResponseMap extends Record<string, unknown> {}

export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

export interface EventHandlerMeta {
  handler: EventHandler<unknown>;
  extensionId?: string;
  once?: boolean;
}

export type RequestHandler<TParams = unknown, TResponse = unknown> = 
  (params: TParams) => TResponse | Promise<TResponse>;

export interface RequestHandlerMeta {
  handler: RequestHandler<unknown, unknown>;
  extensionId?: string;
}

export type WildcardEventHandler = (data: unknown, eventType: string) => void | Promise<void>;

export interface WildcardHandlerMeta {
  handler: WildcardEventHandler;
  extensionId?: string;
  pattern: string;
}

export interface TypedEventBusOptions {
  requestTimeout?: number;
  catchErrors?: boolean;
  logger?: ExtensionLogger;
}

export interface RequestOptions {
  timeout?: number;
}

// ============================================================================
// Typed Event Bus Interface
// ============================================================================

export interface TypedEventBus {
  on<K extends string>(
    event: K,
    handler: (data: unknown) => void,
    options?: { extensionId?: string; once?: boolean }
  ): () => void;
  
  off<K extends string>(event: K, handler: (data: unknown) => void): void;
  
  emit<K extends string>(event: K, data: unknown): void;
  
  onWildcard(
    pattern: string,
    handler: (data: unknown, eventType: string) => void,
    options?: { extensionId?: string }
  ): () => void;
  
  onRequest<K extends string>(
    method: K,
    handler: (params: unknown) => unknown | Promise<unknown>,
    options?: { extensionId?: string }
  ): void;
  
  request<K extends string>(
    method: K,
    params: unknown,
    options?: { timeout?: number }
  ): Promise<unknown>;
  
  cleanup(extensionId: string): void;
  cleanupAll(): void;
}

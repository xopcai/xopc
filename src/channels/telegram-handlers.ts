import type { Context } from 'grammy';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TelegramHandlers');

/**
 * Callback query handler type
 */
type CallbackHandler = (ctx: Context, data: string) => Promise<void>;

/**
 * Handler registry for Telegram callback queries
 * 
 * Uses prefix-based routing to eliminate repetitive if-else chains
 */
export class CallbackHandlerRegistry {
  private handlers = new Map<string, CallbackHandler>();
  private prefixHandlers: Array<{ prefix: string; handler: CallbackHandler }> = [];

  /**
   * Register an exact match handler
   */
  on(exact: string, handler: CallbackHandler): this {
    this.handlers.set(exact, handler);
    return this;
  }

  /**
   * Register a prefix-based handler
   */
  onPrefix(prefix: string, handler: CallbackHandler): this {
    this.prefixHandlers.push({ prefix, handler });
    // Sort by length descending for correct matching order
    this.prefixHandlers.sort((a, b) => b.prefix.length - a.prefix.length);
    return this;
  }

  /**
   * Route callback data to appropriate handler
   */
  async route(ctx: Context, data: string): Promise<void> {
    // 1. Try exact match
    const exactHandler = this.handlers.get(data);
    if (exactHandler) {
      await exactHandler(ctx, data);
      return;
    }

    // 2. Try prefix match
    for (const { prefix, handler } of this.prefixHandlers) {
      if (data.startsWith(prefix)) {
        const payload = data.slice(prefix.length);
        await handler(ctx, payload);
        return;
      }
    }

    // 3. No handler found
    log.warn({ data }, 'No handler registered for callback query');
    await ctx.answerCallbackQuery({ text: 'Unknown action' });
  }
}

/**
 * Create standard handler registry with common actions
 */
export function createCallbackRegistry(options: {
  onModelSelect: (ctx: Context, modelId: string) => Promise<void>;
  onProviderSelect: (ctx: Context, providerId: string) => Promise<void>;
  onShowProviders: (ctx: Context) => Promise<void>;
  onCleanupConfirm: (ctx: Context) => Promise<void>;
  onCancel: (ctx: Context) => Promise<void>;
}): CallbackHandlerRegistry {
  const registry = new CallbackHandlerRegistry();

  registry
    // Prefix-based handlers (extract payload after colon)
    .onPrefix('model:', options.onModelSelect)
    .onPrefix('provider:', options.onProviderSelect)
    
    // Exact match handlers
    .on('providers', options.onShowProviders)
    .on('cleanup:confirm', options.onCleanupConfirm)
    .on('cancel', options.onCancel);

  return registry;
}

import {
  productReferenceOpenRoute,
  type ProductReferenceLocator,
} from '@xopcai/gateway-contract';

import { Transport } from './transport.js';
import type { ExtensionClient, StreamHandler, ThemeInfo } from './types.js';

export type CreateExtensionClientOptions = {
  transport?: Transport;
};

export function createExtensionClient(options?: CreateExtensionClientOptions): ExtensionClient {
  const transport = options?.transport ?? new Transport();

  const client: ExtensionClient = {
    capability: {
      describe: id => transport.request('capability.describe', { id }),
      call: (id, call) => transport.request('capability.call', { id, call }),
    },
    async whenReady() {
      await transport.ready;
    },

    theme: {
      async getTheme() {
        return transport.request<ThemeInfo>('theme.get');
      },
      onThemeChange(handler: (t: ThemeInfo) => void) {
        return transport.on('theme.changed', (data) => {
          handler(data as ThemeInfo);
        });
      },
    },

    agent: {
      async sendMessage(message: string, opts?: { conversationId?: string; newSession?: boolean }) {
        return transport.request<{ conversationId: string }>('agent.sendMessage', {
          message,
          conversationId: opts?.conversationId,
          newSession: opts?.newSession,
        });
      },
      onStreamEvent(conversationId: string, handler: StreamHandler) {
        transport.emit('agent.subscribe', { conversationId });
        const unsub = transport.on(`agent.stream.${conversationId}`, handler);
        return () => {
          transport.emit('agent.unsubscribe', { conversationId });
          unsub();
        };
      },
    },

    session: {
      async listSessions() {
        return transport.request<unknown[]>('session.list');
      },
      async navigateToSession(conversationId: string) {
        await transport.request('session.navigate', { conversationId });
      },
    },

    config: {
      async getExtensionConfig<T = Record<string, unknown>>() {
        return transport.request<T>('config.get');
      },
      async setExtensionConfig(patch: Record<string, unknown>) {
        await transport.request('config.set', patch);
      },
    },

    storage: {
      async get<T = unknown>(key: string) {
        return transport.request<T | undefined>('storage.get', { key });
      },
      async set(key: string, value: unknown) {
        await transport.request('storage.set', { key, value });
      },
      async remove(key: string) {
        await transport.request('storage.remove', { key });
      },
      async keys() {
        return transport.request<string[]>('storage.keys');
      },
    },

    ui: {
      resize(height: number) {
        transport.emit('ui.resize', { height });
      },
      async showNotification(options) {
        await transport.request('ui.notification', options);
      },
      async navigate(path: string) {
        await transport.request('ui.navigate', { path });
      },
      async openProduct(reference: ProductReferenceLocator) {
        const path = productReferenceOpenRoute({
          ...reference,
          title: reference.id,
          capabilities: ['open'],
        });
        if (!path) {
          throw new Error(`Product kind cannot be opened by route: ${reference.kind}`);
        }
        await transport.request('ui.navigate', { path });
      },
      onWidgetResult(handler: (data: unknown) => void) {
        return transport.on('widget.data', handler);
      },
    },

    events: {
      emit(event: string, data?: unknown) {
        transport.emit(`ext.${event}`, data);
      },
      on(event: string, handler: (data: unknown) => void) {
        return transport.on(`ext.${event}`, handler);
      },
    },

    onDispose(handler: () => void) {
      return transport.on('panel.dispose', () => {
        handler();
      });
    },

  };

  return client;
}

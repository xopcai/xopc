import { Transport } from './transport.js';
import type { ExtensionClient, StreamHandler, ThemeInfo } from './types.js';

export type CreateExtensionClientOptions = {
  transport?: Transport;
};

export function createExtensionClient(options?: CreateExtensionClientOptions): ExtensionClient {
  const transport = options?.transport ?? new Transport();

  const client: ExtensionClient = {
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
      async sendMessage(message: string, opts?: { sessionKey?: string; newSession?: boolean }) {
        return transport.request<{ sessionKey: string }>('agent.sendMessage', {
          message,
          sessionKey: opts?.sessionKey,
          newSession: opts?.newSession,
        });
      },
      onStreamEvent(sessionKey: string, handler: StreamHandler) {
        transport.emit('agent.subscribe', { sessionKey });
        const unsub = transport.on(`agent.stream.${sessionKey}`, handler);
        return () => {
          transport.emit('agent.unsubscribe', { sessionKey });
          unsub();
        };
      },
    },

    session: {
      async listSessions() {
        return transport.request<unknown[]>('session.list');
      },
      async navigateToSession(sessionKey: string) {
        await transport.request('session.navigate', { sessionKey });
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
      closePanel() {
        transport.emit('ui.closePanel', undefined);
      },
      async navigate(path: string) {
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

    onDidChangeVisibility(handler: (visible: boolean) => void) {
      return transport.on('panel.visibility', (data) => {
        const v =
          typeof data === 'object' &&
          data !== null &&
          'visible' in data &&
          typeof (data as { visible: unknown }).visible === 'boolean'
            ? (data as { visible: boolean }).visible
            : Boolean(data);
        handler(v);
      });
    },
  };

  return client;
}

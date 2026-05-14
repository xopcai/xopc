/**
 * Single shared HTTP + WebSocket listener for the Chrome extension bridge.
 * Gateway and BrowserManager both need the server; only one process may bind a port.
 */

import type { ExtensionBrowserProvider, ExtensionProviderConfig } from './extension.js';

const DEFAULT_PORT = 19820;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_CONNECTION_TIMEOUT = 30_000;
const DEFAULT_COMMAND_TIMEOUT = 30_000;

let mutexTail: Promise<void> = Promise.resolve();

function withExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const prev = mutexTail;
  let unlock!: () => void;
  mutexTail = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  return prev.then(() => fn()).finally(unlock);
}

type ServerState = {
  key: string;
  provider: ExtensionBrowserProvider;
  refCount: number;
};

let state: ServerState | null = null;

function normalizeConfig(config?: ExtensionProviderConfig): Required<ExtensionProviderConfig> {
  return {
    port: config?.port ?? DEFAULT_PORT,
    host: config?.host ?? DEFAULT_HOST,
    connectionTimeout: config?.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT,
    commandTimeout: config?.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT,
  };
}

function serverKey(c: Required<ExtensionProviderConfig>): string {
  return `${c.host}:${c.port}`;
}

/**
 * Increment ref count and return the shared provider plus a one-shot release.
 * First acquire starts the listener; further acquires reuse it (same host:port).
 */
export function acquireExtensionBrowserServer(config?: ExtensionProviderConfig): Promise<{
  provider: ExtensionBrowserProvider;
  release: () => Promise<void>;
}> {
  return withExclusive(async () => {
    const full = normalizeConfig(config);
    const key = serverKey(full);

    if (state && state.key !== key) {
      throw new Error(
        `Chrome extension bridge is already listening on ${state.key}; stop it before using ${key}.`,
      );
    }

    if (!state) {
      const { ExtensionBrowserProvider } = await import('./extension.js');
      const provider = new ExtensionBrowserProvider(full);
      await provider.start();
      state = { key, provider, refCount: 0 };
    }

    state.refCount++;
    let released = false;
    const release = async () => {
      await withExclusive(async () => {
        if (released || !state) return;
        released = true;
        state.refCount--;
        if (state.refCount <= 0) {
          await state.provider.shutdown();
          state = null;
        }
      });
    };

    return { provider: state.provider, release };
  });
}

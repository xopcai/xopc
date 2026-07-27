export enum ExtensionErrorCode {
  PermissionDenied = 4001,
  InvalidRequest = 4002,
  MethodNotFound = 4003,
  InternalError = 4004,
  Timeout = 4005,
  ExtensionNotFound = 4006,
  RateLimited = 4007,
}

export interface ThemeInfo {
  mode: 'light' | 'dark';
  tokens: Record<string, string>;
  fontFamily?: string;
  fontFamilyMono?: string;
}

export interface ExtensionRequest {
  source: 'xopc-extension';
  extensionId: string;
  type: 'request';
  requestId: string;
  method: string;
  params?: unknown;
}

export interface ExtensionEventMessage {
  source: 'xopc-extension';
  extensionId: string;
  type: 'event';
  event: string;
  data?: unknown;
}

export interface HostInit {
  source: 'xopc-host';
  type: 'init';
  extensionId: string;
  permissions: string[];
  theme: ThemeInfo;
  locale: string;
}

export interface HostResponse {
  source: 'xopc-host';
  type: 'response';
  requestId: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface HostEventMessage {
  source: 'xopc-host';
  type: 'event';
  event: string;
  data?: unknown;
}

export type HostToExtensionMessage = HostInit | HostResponse | HostEventMessage;
export type ExtensionToHostMessage = ExtensionRequest | ExtensionEventMessage;

export type StreamHandler = (payload: unknown) => void;

export interface ExtensionClient {
  whenReady(): Promise<void>;
  theme: {
    getTheme(): Promise<ThemeInfo>;
    onThemeChange(handler: (t: ThemeInfo) => void): () => void;
  };
  agent: {
    sendMessage(
      message: string,
      options?: { sessionKey?: string; newSession?: boolean },
    ): Promise<{ sessionKey: string }>;
    onStreamEvent(sessionKey: string, handler: StreamHandler): () => void;
  };
  session: {
    listSessions(): Promise<unknown[]>;
    navigateToSession(sessionKey: string): Promise<void>;
  };
  config: {
    getExtensionConfig<T = Record<string, unknown>>(): Promise<T>;
    setExtensionConfig(patch: Record<string, unknown>): Promise<void>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    keys(): Promise<string[]>;
  };
  ui: {
    resize(height: number): void;
    showNotification(options: {
      type?: 'success' | 'error' | 'info';
      title: string;
      message?: string;
    }): Promise<void>;
    closePanel(): void;
    navigate(path: string): Promise<void>;
    openProduct(reference: ProductReferenceLocator): Promise<void>;
    /** Chat/tool widget iframe: host sends the tool result via `widget.data` after load. */
    onWidgetResult(handler: (data: unknown) => void): () => void;
  };
  events: {
    emit(event: string, data?: unknown): void;
    on(event: string, handler: (data: unknown) => void): () => void;
  };
  onDispose(handler: () => void): () => void;
  onDidChangeVisibility(handler: (visible: boolean) => void): () => void;
}
import type { ProductReferenceLocator } from '@xopcai/gateway-contract';

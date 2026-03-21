export type ChatPayload = {
  type?: 'status' | 'token' | 'error';
  content?: string;
  status?: 'ok' | 'complete' | 'error';
  runId?: string;
  sessionKey?: string;
  message?: unknown;
  errorMessage?: string;
};

export type ErrorPayload = {
  code: string;
  message: string;
};

export type GatewayClientConfig = {
  /** @deprecated No longer needed - always uses current origin */
  url?: string;
  token?: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
};

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

export interface SessionInfo {
  key: string;
  name?: string;
  updatedAt: string;
  messageCount?: number;
}

export type { Message, ProgressState } from '../messages/types.js';

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

export interface Message {
  role: 'user' | 'assistant';
  content: Array<{ type: string; text?: string }>;
  attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>;
  timestamp: number;
  thinking?: string;
  thinkingStreaming?: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ProgressState {
  stage: string;
  message: string;
  detail?: string;
  toolName?: string;
  timestamp: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

export interface SessionInfo {
  key: string;
  name?: string;
  updatedAt: string;
  messageCount?: number;
}

export interface ToolCall {
  toolName: string;
  args?: unknown;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export type GatewaySseConfig = {
  token?: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
};

export type SseConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

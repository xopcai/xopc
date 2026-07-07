export type GatewayClientConfig = {
  token?: string;
};

export interface SessionInfo {
  key: string;
  sessionId?: string;
  name?: string;
  updatedAt: string;
  messageCount?: number;
  sourceChannel?: string;
  sourceChatId?: string;
  projectId?: string;
  customData?: Record<string, unknown>;
  routing?: {
    agentId?: string;
  };
}

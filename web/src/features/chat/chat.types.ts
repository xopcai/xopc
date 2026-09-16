export type GatewayClientConfig = {
  token?: string;
};

export interface SessionInfo {
  agentId?: string;
  key: string;
  transcriptId?: string;
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

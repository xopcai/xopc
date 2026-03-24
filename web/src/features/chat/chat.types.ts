export type GatewayClientConfig = {
  token?: string;
};

export interface SessionInfo {
  key: string;
  name?: string;
  updatedAt: string;
  messageCount?: number;
}

export interface ServiceEvent {
  id: string;
  type: string;
  payload: unknown;
}

export interface GatewayServiceConfig {
  configPath?: string;
  enableHotReload?: boolean;
}

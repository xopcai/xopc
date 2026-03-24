export type GatewayAuthMode = 'none' | 'token';

export interface GatewaySettingsState {
  host: string;
  port: number | undefined;
  auth: {
    mode: GatewayAuthMode;
    token: string;
  };
  heartbeat: {
    enabled: boolean;
    intervalMs: number;
  };
}

export type GatewayAuthMode = 'none' | 'token';

export type UpdatePackageChannel = 'stable' | 'beta' | 'dev';

export interface GatewaySettingsState {
  host: string;
  port: number | undefined;
  auth: {
    mode: GatewayAuthMode;
    token: string;
  };
  /** npm / CLI update channel (config `update.channel`). */
  updateChannel: UpdatePackageChannel;
}

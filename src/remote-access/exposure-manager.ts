import type { Config } from '../config/schema.js';
import { getTunnelConsentState } from '../tunnel/consent.js';
import { getTunnelService } from '../tunnel/tunnel-service.js';
import { resolveGatewayBindMode } from '../config/gateway-bind.js';
import {
  getTailscaleExposureState,
  maybeStartTailscaleFromConfig,
  stopTailscaleExposure,
} from '../gateway/tailscale-lifecycle.js';
import { maybeAutoStartTunnelFromConfig } from '../tunnel/gateway-lifecycle.js';
import type { GatewayTailscaleMode } from '../gateway/server-tailscale.js';
import { collectExposureConflicts } from './exposure-guards.js';

export type ExposureStatus = {
  bindMode: string;
  tailscale: {
    mode: GatewayTailscaleMode;
    active: boolean;
    hostname: string | null;
    resetOnExit: boolean;
  };
  tunnel: ReturnType<ReturnType<typeof getTunnelService>['getStatus']> & {
    consentRequired: boolean;
    canAutoStart: boolean;
  };
  conflicts: ReturnType<typeof collectExposureConflicts>;
};

export class ExposureManager {
  async getStatus(config: Config): Promise<ExposureStatus> {
    const tunnelStatus = getTunnelService().getStatus();
    const consent = getTunnelConsentState(config);
    const ts = getTailscaleExposureState();
    return {
      bindMode: resolveGatewayBindMode(config),
      tailscale: ts,
      tunnel: {
        ...tunnelStatus,
        consentRequired: consent.consentRequired,
        canAutoStart: consent.canAutoStart,
      },
      conflicts: collectExposureConflicts(config),
    };
  }

  async autoStart(config: Config, port: number, gatewayToken: string): Promise<void> {
    await maybeStartTailscaleFromConfig(config, port);
    await maybeAutoStartTunnelFromConfig(config, gatewayToken);
  }

  async startTailscale(config: Config, port: number, mode: GatewayTailscaleMode): Promise<void> {
    await maybeStartTailscaleFromConfig(config, port, mode);
  }

  async stopTailscale(): Promise<void> {
    await stopTailscaleExposure();
  }
}

let singleton: ExposureManager | null = null;

export function getExposureManager(): ExposureManager {
  if (!singleton) {
    singleton = new ExposureManager();
  }
  return singleton;
}

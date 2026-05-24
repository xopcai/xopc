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
import { isTailscaleInstalled } from '../infra/tailscale.js';
import { collectExposureConflicts } from './exposure-guards.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ExposureManager');

export type ExposureStatus = {
  bindMode: string;
  tailscale: ReturnType<typeof getTailscaleExposureState> & { cliAvailable: boolean };
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
    const cliAvailable = await isTailscaleInstalled();
    return {
      bindMode: resolveGatewayBindMode(config),
      tailscale: { ...ts, cliAvailable },
      tunnel: {
        ...tunnelStatus,
        consentRequired: consent.consentRequired,
        canAutoStart: consent.canAutoStart,
      },
      conflicts: collectExposureConflicts(config),
    };
  }

  async autoStart(config: Config, port: number, gatewayToken: string): Promise<void> {
    try {
      await maybeStartTailscaleFromConfig(config, port);
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em, phase: 'tailscale_autostart' }, `Tailscale auto-start skipped: ${em}`);
    }
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

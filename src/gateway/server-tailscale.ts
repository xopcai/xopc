import {
  disableTailscaleFunnel,
  disableTailscaleServe,
  enableTailscaleFunnel,
  enableTailscaleServe,
  getTailnetHostname,
} from '../infra/tailscale.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GatewayTailscale');

export type GatewayTailscaleMode = 'off' | 'serve' | 'funnel';

export async function startGatewayTailscaleExposure(params: {
  tailscaleMode: GatewayTailscaleMode;
  resetOnExit?: boolean;
  port: number;
}): Promise<(() => Promise<void>) | null> {
  if (params.tailscaleMode === 'off') {
    return null;
  }

  if (params.tailscaleMode === 'serve') {
    await enableTailscaleServe(params.port);
  } else {
    await enableTailscaleFunnel(params.port);
  }
  const host = await getTailnetHostname().catch(() => null);
  if (host) {
    log.info(
      { tailscaleMode: params.tailscaleMode, host, port: params.port },
      `${params.tailscaleMode} enabled: https://${host}/`,
    );
  } else {
    log.info({ tailscaleMode: params.tailscaleMode, port: params.port }, `${params.tailscaleMode} enabled`);
  }

  if (!params.resetOnExit) {
    return null;
  }

  return async () => {
    try {
      if (params.tailscaleMode === 'serve') {
        await disableTailscaleServe();
      } else {
        await disableTailscaleFunnel();
      }
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn(
        { err, tailscaleMode: params.tailscaleMode, errorMessage: em },
        `Tailscale ${params.tailscaleMode} cleanup failed: ${em}`,
      );
    }
  };
}

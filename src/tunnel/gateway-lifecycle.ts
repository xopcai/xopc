import type { Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { resolveTunnelBrokerUrl, resolveTunnelRegistrationSecret } from './env.js';
import { getTunnelService } from './tunnel-service.js';
import { fetchTunnelWellKnown } from './well-known.js';

const log = createLogger('Tunnel');

type TunnelEventSink = { emit(type: string, payload: unknown): void };

let tunnelSseWired = false;

/** Publish `tunnel.status` on gateway SSE when tunnel lifecycle changes. */
export function wireTunnelEventsToGateway(service: TunnelEventSink): void {
  if (tunnelSseWired) return;
  tunnelSseWired = true;

  const tunnel = getTunnelService();
  const publish = () => {
    service.emit('tunnel.status', tunnel.getStatus());
  };

  tunnel.on('tunnel:connecting', publish);
  tunnel.on('tunnel:connected', publish);
  tunnel.on('tunnel:disconnected', publish);
  tunnel.on('tunnel:error', publish);
}

export async function configureTunnelFromGatewayConfig(config: Config): Promise<void> {
  const gateway = config.gateway ?? {};
  let brokerUrl = resolveTunnelBrokerUrl(config.tunnel?.brokerUrl);

  try {
    const wellKnown = await fetchTunnelWellKnown(brokerUrl);
    if (wellKnown.brokerUrl?.trim()) {
      brokerUrl = wellKnown.brokerUrl.trim();
    }
  } catch (err) {
    log.debug(
      { err, brokerUrl, phase: 'tunnel_well_known' },
      'Tunnel well-known fetch skipped (using config/env broker URL)',
    );
  }

  let registrationSecret: string;
  try {
    registrationSecret = resolveTunnelRegistrationSecret(process.env, brokerUrl);
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.warn({ phase: 'tunnel_configure', errorMessage: em }, em);
    throw err;
  }

  getTunnelService().configure({
    brokerUrl,
    registrationSecret,
    autoStart: config.tunnel?.autoStart ?? false,
    gatewayHost: gateway.host ?? '127.0.0.1',
  });
}

/**
 * Start FRP tunnel when `tunnel.autoStart` is set (CLI gateway / GatewayServer after HTTP listen).
 */
export async function maybeAutoStartTunnelFromConfig(
  config: Config,
  gatewayToken: string | undefined,
): Promise<void> {
  if (!config.tunnel?.autoStart) return;

  const gateway = config.gateway ?? {};
  const port = gateway.port ?? 18790;
  const host = gateway.host ?? '127.0.0.1';

  await configureTunnelFromGatewayConfig(config);

  if (!gatewayToken) {
    log.warn(
      { phase: 'tunnel_autostart' },
      'tunnel.autoStart is enabled but gateway auth token is unavailable (auth mode may be none)',
    );
    return;
  }

  const tunnel = getTunnelService();
  const { state } = tunnel.getStatus();
  if (state === 'connected' || state === 'connecting' || state === 'reconnecting') {
    log.debug({ phase: 'tunnel_autostart', state }, 'Tunnel already active — skip autostart');
    return;
  }

  try {
    await tunnel.start(port, gatewayToken);
    log.info(
      { phase: 'tunnel_autostart', host, port },
      'Tunnel auto-started after gateway HTTP listen',
    );
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.error({ err, phase: 'tunnel_autostart', errorMessage: em }, `Tunnel autostart failed: ${em}`);
  }
}

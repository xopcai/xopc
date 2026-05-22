import type { Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { hasValidTunnelConsent } from './consent.js';
import { subscribeCertStatus } from './acme-cert-store.js';
import { resolveTunnelBrokerUrl, resolveTunnelRegistrationSecret } from './env.js';
import { getTunnelService } from './tunnel-service.js';
import { resolveFrpSubdomainHost, resolveTunnelE2eConfig } from './tunnel-e2e-config.js';
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
  tunnel.on('tunnel:progress', publish);

  subscribeCertStatus((cert) => {
    service.emit('tunnel.cert.status', cert);
    publish();
  });
}

export async function configureTunnelFromGatewayConfig(
  config: Config,
  opts?: { force?: boolean },
): Promise<void> {
  if (!opts?.force && !config.tunnel?.enabled) return;

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
    registrationSecret = resolveTunnelRegistrationSecret(
      process.env,
      brokerUrl,
      config.tunnel?.registrationSecret,
    );
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.warn({ phase: 'tunnel_configure', errorMessage: em }, em);
    throw err;
  }

  const gateway = config.gateway ?? {};
  const gatewayPort = gateway.port ?? 18790;

  getTunnelService().configure({
    brokerUrl,
    registrationSecret,
    autoStart: config.tunnel?.autoStart ?? false,
    gatewayHost: gateway.host ?? '127.0.0.1',
    e2e: resolveTunnelE2eConfig(config.tunnel, gatewayPort),
    frpSubdomainHost: resolveFrpSubdomainHost(brokerUrl),
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

  if (!hasValidTunnelConsent(config)) {
    log.warn(
      { phase: 'tunnel_autostart', consentVersion: config.tunnel?.consent?.version ?? null },
      'tunnel.autoStart skipped: security consent required or outdated',
    );
    return;
  }

  if (config.tunnel.enabled !== true) {
    log.debug(
      { phase: 'tunnel_autostart' },
      'tunnel.autoStart skipped: tunnel.enabled is false (start remote access once)',
    );
    return;
  }

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

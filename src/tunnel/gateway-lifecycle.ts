import type { Config } from '../config/schema.js';
import { resolveGatewayEffectiveHost } from '../config/gateway-bind.js';
import { createLogger } from '../utils/logger.js';
import { hasValidTunnelConsent } from './consent.js';
import { resolveTunnelBrokerUrl, resolveTunnelRegistrationSecret } from './env.js';
import { getTunnelService } from './tunnel-service.js';
import { resolveFrpSubdomainHost } from './frp-subdomain-host.js';
import { fetchTunnelWellKnown } from './well-known.js';

const log = createLogger('Tunnel');

type TunnelEventSink = { emit(type: string, payload: unknown): void };

let tunnelSseWired = false;

/** Publish `tunnel.status` on the gateway realtime topic when tunnel lifecycle changes. */
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
}

export type ConfigureTunnelFromGatewayConfigOptions = {
  force?: boolean;
  deferWellKnownFetch?: boolean;
};

function applyTunnelServiceFromGatewayConfig(config: Config, brokerUrl: string): void {
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

  getTunnelService().configure({
    brokerUrl,
    registrationSecret,
    autoStart: config.tunnel?.autoStart ?? false,
    gatewayHost: resolveGatewayEffectiveHost(config),
    frpSubdomainHost: resolveFrpSubdomainHost(brokerUrl),
  });
}

async function resolveBrokerUrlFromWellKnown(initialBrokerUrl: string): Promise<string> {
  let brokerUrl = initialBrokerUrl;
  try {
    const wellKnown = await fetchTunnelWellKnown(brokerUrl);
    if (wellKnown.brokerUrl?.trim()) {
      brokerUrl = wellKnown.brokerUrl.trim();
    }
    if (wellKnown.transport?.tls === 'broker_terminated') {
      log.debug({ brokerUrl, phase: 'tunnel_well_known' }, 'Broker uses wildcard TLS termination');
    } else if (wellKnown.transport?.tls) {
      log.warn(
        { tls: wellKnown.transport.tls, phase: 'tunnel_well_known' },
        'Unexpected broker transport mode — expect broker_terminated',
      );
    }
  } catch (err) {
    log.debug(
      { err, brokerUrl, phase: 'tunnel_well_known' },
      'Tunnel well-known fetch skipped (using config/env broker URL)',
    );
  }
  return brokerUrl;
}

let deferredWellKnownRefresh: Promise<void> | null = null;

function scheduleDeferredWellKnownRefresh(config: Config, initialBrokerUrl: string): void {
  if (deferredWellKnownRefresh) return;

  deferredWellKnownRefresh = resolveBrokerUrlFromWellKnown(initialBrokerUrl)
    .then((resolvedBrokerUrl) => {
      if (resolvedBrokerUrl === initialBrokerUrl) return;
      applyTunnelServiceFromGatewayConfig(config, resolvedBrokerUrl);
    })
    .catch((err) => {
      const em = err instanceof Error ? err.message : String(err);
      log.warn(
        { err, phase: 'tunnel_well_known_deferred', errorMessage: em },
        `Deferred tunnel well-known refresh failed: ${em}`,
      );
    })
    .finally(() => {
      deferredWellKnownRefresh = null;
    });
}

export async function configureTunnelFromGatewayConfig(
  config: Config,
  opts?: ConfigureTunnelFromGatewayConfigOptions,
): Promise<void> {
  if (!opts?.force && !config.tunnel?.enabled) return;

  const initialBrokerUrl = resolveTunnelBrokerUrl(config.tunnel?.brokerUrl);

  if (opts?.deferWellKnownFetch) {
    applyTunnelServiceFromGatewayConfig(config, initialBrokerUrl);
    scheduleDeferredWellKnownRefresh(config, initialBrokerUrl);
    return;
  }

  if (deferredWellKnownRefresh) {
    await deferredWellKnownRefresh;
  }

  const brokerUrl = await resolveBrokerUrlFromWellKnown(initialBrokerUrl);
  applyTunnelServiceFromGatewayConfig(config, brokerUrl);
}

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
  const host = resolveGatewayEffectiveHost(config);

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

import { createLogger } from '../../utils/logger.js';

const log = createLogger('GatewayDiscovery');

export type MdnsGatewayAdvertisement = {
  name: string;
  port: number;
  txt: Record<string, string>;
};

let advertised: MdnsGatewayAdvertisement | null = null;

/** Register mDNS service `_xopc-gw._tcp` when enabled (best-effort; no native dep yet). */
export function startMdnsGatewayDiscovery(params: {
  port: number;
  tokenHint?: string;
}): void {
  advertised = {
    name: 'xopc-gateway',
    port: params.port,
    txt: {
      path: '/',
      ...(params.tokenHint ? { auth: 'token' } : {}),
    },
  };
  log.info(
    { port: params.port, service: '_xopc-gw._tcp', phase: 'mdns_register' },
    'Gateway mDNS advertisement registered (logical; install Bonjour for OS broadcast)',
  );
}

export function stopMdnsGatewayDiscovery(): void {
  if (!advertised) {
    return;
  }
  log.debug({ phase: 'mdns_stop' }, 'Gateway mDNS advertisement cleared');
  advertised = null;
}

export function getMdnsGatewayAdvertisement(): MdnsGatewayAdvertisement | null {
  return advertised;
}

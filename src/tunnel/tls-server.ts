import { createServer as createHttpsServer, type Server } from 'node:https';
import { Readable } from 'node:stream';

import { createLogger } from '../utils/logger.js';
import {
  ensureValidCert,
  loadStoredCert,
  startRenewalScheduler,
  stopRenewalScheduler,
  type StoredCert,
} from './acme-cert-store.js';
import type { AcmeConfig } from './acme-client.js';

const log = createLogger('TunnelTLS');

let httpsNodeServer: Server | null = null;

export type TunnelTlsServerConfig = {
  tlsPort: number;
  gatewayPort: number;
  acmeConfig: AcmeConfig;
  fetch?: typeof fetch;
};

function resolveTlsFetch(
  gatewayPort: number,
  customFetch?: typeof fetch,
): (req: Request) => Response | Promise<Response> {
  if (customFetch) {
    return (req: Request) => customFetch(req);
  }
  return async (req: Request) => {
    const url = new URL(req.url);
    url.protocol = 'http:';
    url.hostname = '127.0.0.1';
    url.port = String(gatewayPort);
    return fetch(url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      redirect: 'manual',
      duplex: 'half',
    } as RequestInit);
  };
}

async function nodeRequestToFetch(req: import('node:http').IncomingMessage, tlsPort: number): Promise<Request> {
  const url = new URL(req.url ?? '/', `https://127.0.0.1:${tlsPort}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const part of value) headers.append(key, part);
    } else {
      headers.set(key, value);
    }
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const init: RequestInit = {
    method: req.method,
    headers,
  };
  if (hasBody) {
    init.body = Readable.toWeb(req) as RequestInit['body'];
    (init as RequestInit & { duplex?: 'half' }).duplex = 'half';
  }
  return new Request(url, init);
}

async function sendFetchResponse(res: import('node:http').ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}

export async function startTunnelTlsServer(config: TunnelTlsServerConfig): Promise<Server> {
  if (httpsNodeServer) return httpsNodeServer;

  const cert = await ensureValidCert(config.acmeConfig);
  const handler = resolveTlsFetch(config.gatewayPort, config.fetch);

  httpsNodeServer = createHttpsServer(
    {
      key: cert.keyPem,
      cert: cert.certPem,
      minVersion: 'TLSv1.2',
    },
    (req, res) => {
      void (async () => {
        try {
          const request = await nodeRequestToFetch(req, config.tlsPort);
          const response = await handler(request);
          await sendFetchResponse(res, response);
        } catch (err) {
          log.warn({ err, phase: 'tls_proxy' }, 'TLS proxy request failed');
          if (!res.headersSent) res.writeHead(502);
          res.end('Bad Gateway');
        }
      })();
    },
  );

  await new Promise<void>((resolve, reject) => {
    httpsNodeServer!.once('error', reject);
    httpsNodeServer!.listen(config.tlsPort, '127.0.0.1', () => resolve());
  }).catch((err: unknown) => {
    httpsNodeServer?.close();
    httpsNodeServer = null;
    const em = err instanceof Error ? err.message : String(err);
    if (em.includes('EADDRINUSE')) {
      throw new Error(
        `Tunnel TLS port ${config.tlsPort} is already in use. ` +
          `Stop other xopc tunnel instances or set tunnel.e2e.tlsPort (try ${config.gatewayPort + 1} for gateway port ${config.gatewayPort}).`,
      );
    }
    throw err;
  });

  log.info(
    { port: config.tlsPort, domain: cert.domain, expiresAt: cert.expiresAt },
    "Tunnel TLS server listening (Let's Encrypt cert)",
  );

  startRenewalScheduler(config.acmeConfig, () => reloadTlsCert());

  return httpsNodeServer;
}

function reloadTlsCert(): void {
  const cert = loadStoredCert();
  if (!cert || !httpsNodeServer) return;
  httpsNodeServer.setSecureContext({ key: cert.keyPem, cert: cert.certPem });
  log.info({ domain: cert.domain, expiresAt: cert.expiresAt }, 'TLS cert hot-reloaded');
}

export function stopTunnelTlsServer(): void {
  stopRenewalScheduler();
  if (httpsNodeServer) {
    httpsNodeServer.close();
    httpsNodeServer = null;
    log.info('TLS server stopped');
  }
}

export function getActiveTlsCert(): StoredCert | null {
  return loadStoredCert();
}

/** @internal */
export function resetTunnelTlsServerForTests(): void {
  stopTunnelTlsServer();
}

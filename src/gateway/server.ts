import { serve, type ServerType } from '@hono/node-server';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

import { ensureXopcCliOnPath } from '../infra/path-env.js';

ensureXopcCliOnPath();

import type { GatewayBindMode } from '../config/schema.js';
import { resolveGatewayBindHost, resolveGatewayListenHosts } from '../config/gateway-bind.js';
import { resolveGatewayListenPlan } from './listen.js';
import { GatewayService } from './service.js';
import { createHonoApp } from './hono/app.js';
import { closeAllEventStreams } from './hono/sse.js';
import { handleSiteShareUpgrade } from '../share/site-share-router.js';

export interface GatewayServerConfig {
  port: number;
  /** Resolved listen address (sync plan); re-validated async at start when possible. */
  bindHost: string;
  bind?: GatewayBindMode;
  customBindHost?: string;
  token?: string;
  verbose?: boolean;
  configPath?: string;
  enableHotReload?: boolean;
}

export class GatewayServer {
  private server?: ServerType;
  private extraServers: ServerType[] = [];
  private config: GatewayServerConfig;
  private service: GatewayService;

  constructor(config: GatewayServerConfig) {
    this.config = config;
    this.service = new GatewayService({
      configPath: config.configPath,
      enableHotReload: config.enableHotReload,
      deferChannelConnectUntilAfterHttp: true,
      listenBind: config.bind,
      listenCustomBindHost: config.customBindHost,
      listenPort: config.port,
    });
  }

  async start(): Promise<void> {
    const cfg = this.service.currentConfig;
    const plan = resolveGatewayListenPlan({
      cfg,
      bindOverride: this.config.bind,
    });

    let bindHost: string;
    try {
      bindHost = await resolveGatewayBindHost({
        bindMode: plan.bindMode,
        customBindHost: plan.customBindHost ?? this.config.customBindHost,
      });
    } catch (err) {
      bindHost = plan.bindHost;
      if (plan.bindMode === 'custom') {
        throw err;
      }
    }

    if (plan.bindMode === 'custom') {
      const expected = plan.customBindHost?.trim();
      if (!expected || bindHost !== expected) {
        throw new Error(
          `gateway bind=custom requested ${expected ?? '(missing)'} but resolved ${bindHost}`,
        );
      }
    }

    const listenHosts = await resolveGatewayListenHosts(bindHost);
    console.log(`[GatewayServer] Starting gateway server on ${bindHost}:${this.config.port}...`);

    await this.service.start();
    this.service.registerGatewayShutdownForRestart(async () => {
      await this.stop();
    });

    const { configureTunnelFromGatewayConfig } = await import('../tunnel/gateway-lifecycle.js');
    await configureTunnelFromGatewayConfig(this.service.currentConfig, { deferWellKnownFetch: true });

    const app = createHonoApp({ service: this.service });

    const primaryHost = listenHosts[0] ?? bindHost;
    const attachUpgrade = (server: ServerType): void => {
      // `@hono/node-server`'s `serve()` returns the underlying `http.Server`.
      const inner = server as unknown as {
        on(event: 'upgrade', listener: (req: IncomingMessage, socket: Socket, head: Buffer) => void): void;
      };
      inner.on('upgrade', (req, socket, head) => {
        try {
          handleSiteShareUpgrade(this.service, req, socket, head);
        } catch (err) {
          console.error('[GatewayServer] site-share upgrade error:', err);
          try {
            socket.destroy();
          } catch {
            /* ignore */
          }
        }
      });
    };

    this.server = serve(
      {
        fetch: app.fetch,
        port: this.config.port,
        hostname: primaryHost,
      },
      () => {
        console.log(`[GatewayServer] Gateway server running at http://${primaryHost}:${this.config.port}`);
        this.service.markHttpListening();
        void this.service.onHttpListening().catch((err) => {
          console.error('[GatewayServer] Deferred channel startup failed:', err);
        });
      },
    );
    attachUpgrade(this.server);

    for (const aliasHost of listenHosts.slice(1)) {
      const extra = serve({
        fetch: app.fetch,
        port: this.config.port,
        hostname: aliasHost,
      });
      attachUpgrade(extra);
      this.extraServers.push(extra);
    }
  }

  async close(opts?: { reason?: string; restartExpectedMs?: number | null }): Promise<void> {
    const reason = opts?.reason ?? 'gateway stopping';
    console.log(`[GatewayServer] Closing gateway server: ${reason}`);
    await this.stop();
  }

  async stop(): Promise<void> {
    console.log('[GatewayServer] Stopping gateway server...');

    closeAllEventStreams();

    const closeServer = async (server: ServerType | undefined) => {
      if (!server) {
        return;
      }
      const forceClose = setTimeout(() => {
        (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      }, 2000);
      await new Promise<void>((resolve) => {
        server.close(() => {
          clearTimeout(forceClose);
          resolve();
        });
      });
    };

    await closeServer(this.server);
    this.server = undefined;

    for (const extra of this.extraServers) {
      await closeServer(extra);
    }
    this.extraServers = [];

    await this.service.stop();

    console.log('[GatewayServer] Gateway server stopped');
  }

  forceCloseConnections(): void {
    const close = (server: ServerType | undefined) => {
      (server as { closeAllConnections?: () => void } | undefined)?.closeAllConnections?.();
    };

    close(this.server);
    for (const extra of this.extraServers) {
      close(extra);
    }
  }

  get isRunning(): boolean {
    return this.server !== undefined;
  }

  get serviceInstance(): GatewayService {
    return this.service;
  }
}

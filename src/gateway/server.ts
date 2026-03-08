import { serve, type ServerType } from '@hono/node-server';
import { GatewayService } from './service.js';
import { createHonoApp } from './hono/app.js';

export interface GatewayServerConfig {
  host: string;
  port: number;
  token?: string;
  verbose?: boolean;
  configPath?: string;
  enableHotReload?: boolean;
}

export class GatewayServer {
  private server?: ServerType;
  private config: GatewayServerConfig;
  private service: GatewayService;

  constructor(config: GatewayServerConfig) {
    this.config = config;
    this.service = new GatewayService({
      configPath: config.configPath,
      enableHotReload: config.enableHotReload,
    });
  }

  async start(): Promise<void> {
    console.log(`[GatewayServer] Starting gateway server on ${this.config.host}:${this.config.port}...`);

    // Start the underlying service first
    await this.service.start();

    // Create Hono app
    // Priority: CLI token > service auto-generated token
    const effectiveToken = this.config.token || this.service.getAuthToken();
    const app = createHonoApp({
      service: this.service,
      token: effectiveToken,
    });

    // Create Node.js HTTP server (no WebSocket upgrade needed)
    this.server = serve({
      fetch: app.fetch,
      port: this.config.port,
      hostname: this.config.host,
    }, () => {
      console.log(`[GatewayServer] Gateway server running at http://${this.config.host}:${this.config.port}`);
    });
  }

  async close(opts?: { reason?: string; restartExpectedMs?: number | null }): Promise<void> {
    const reason = opts?.reason ?? 'gateway stopping';
    console.log(`[GatewayServer] Closing gateway server: ${reason}`);
    await this.stop();
  }

  async stop(): Promise<void> {
    console.log('[GatewayServer] Stopping gateway server...');

    // Stop the HTTP server
    if (this.server) {
      // Force server close after a short delay to allow connections to drain
      const forceClose = setTimeout(() => {
        if (this.server) {
          (this.server as any).closeAllConnections?.();
        }
      }, 2000);
      
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          clearTimeout(forceClose);
          resolve();
        });
      });
      this.server = undefined;
    }

    // Stop the underlying service
    await this.service.stop();

    console.log('[GatewayServer] Gateway server stopped');
  }

  get isRunning(): boolean {
    return this.server !== undefined;
  }

  get serviceInstance(): GatewayService {
    return this.service;
  }
}

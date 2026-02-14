import { serve, type ServerType } from '@hono/node-server';
import { createLogger } from '../utils/logger.js';
import { GatewayService } from './service.js';
import { createHonoApp } from './hono/app.js';

const log = createLogger('GatewayServer');

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
    log.info({ host: this.config.host, port: this.config.port }, 'Starting gateway server...');

    // Start the underlying service first
    await this.service.start();

    // Create Hono app
    const app = createHonoApp({
      service: this.service,
      token: this.config.token,
    });

    // Create Node.js HTTP server (no WebSocket upgrade needed)
    this.server = serve({
      fetch: app.fetch,
      port: this.config.port,
      hostname: this.config.host,
    }, () => {
      log.info(
        { host: this.config.host, port: this.config.port },
        `Gateway server running at http://${this.config.host}:${this.config.port}`,
      );
    });
  }

  async stop(): Promise<void> {
    log.info('Stopping gateway server...');

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

    log.info('Gateway server stopped');
  }

  get isRunning(): boolean {
    return this.server !== undefined;
  }

  get serviceInstance(): GatewayService {
    return this.service;
  }
}

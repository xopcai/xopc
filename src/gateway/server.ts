import { serve, type ServerType } from '@hono/node-server';
import { createNodeWebSocket, type NodeWebSocket } from '@hono/node-ws';
import { createLogger } from '../utils/logger.js';
import { GatewayService } from './service.js';
import { createHonoApp } from './hono/app.js';
import { createWebSocketHandler } from './hono/websocket.js';

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
  private wsServer?: NodeWebSocket['wss'];
  private closeWsConnections?: () => void;

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

    // Create WebSocket handler
    const wsHandler = createWebSocketHandler({
      service: this.service,
      token: this.config.token,
    });

    // Setup WebSocket integration
    const { injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({
      app,
    });

    // Add WebSocket route
    app.get('/ws', upgradeWebSocket(() => wsHandler.handlers));

    // Create Node.js HTTP server
    this.server = serve({
      fetch: app.fetch,
      port: this.config.port,
      hostname: this.config.host,
    }, () => {
      log.info(
        { host: this.config.host, port: this.config.port },
        `Gateway server running at http://${this.config.host}:${this.config.port}`
      );
    });

    // Inject WebSocket handler into the server
    injectWebSocket(this.server);
    
    // Store WebSocket server and close function for cleanup
    this.wsServer = wss;
  }

  async stop(): Promise<void> {
    log.info('Stopping gateway server...');

    // Close all WebSocket connections first
    if (this.wsServer) {
      this.wsServer.clients.forEach((ws) => {
        ws.close(1001, 'Server shutting down');
      });
    }

    // Stop the HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
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

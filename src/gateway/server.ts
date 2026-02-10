import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../utils/logger.js';
import { GatewayService, type GatewayServiceConfig } from './service.js';
import {
  type GatewayRequest,
  type GatewayResponse,
  type GatewayEvent,
  isGatewayRequest,
  createResponse,
  createEvent,
} from './protocol.js';
import { createAuthMiddleware, logRequest, logWsConnection, handleError } from './middleware/index.js';

const log = createLogger('GatewayServer');

interface ClientConnection {
  ws: WebSocket;
  id: string;
  authenticated: boolean;
}

export interface GatewayServerConfig {
  host: string;
  port: number;
  token?: string;
  verbose?: boolean;
  configPath?: string;
  enableHotReload?: boolean;
}

export class GatewayServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, ClientConnection>();
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
    const authenticate = createAuthMiddleware({ token: this.config.token });

    // Start the underlying service
    await this.service.start();

    this.httpServer = http.createServer((req, res) => {
      logRequest(req);

      // Handle CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health endpoint (no auth required)
      if (req.url === '/health' && req.method === 'GET') {
        const health = this.service.getHealth();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
        return;
      }

      // Check auth for other endpoints
      if (!authenticate(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      // Default API info endpoint
      if (req.url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          service: 'xopcbot-gateway',
          version: '0.1.0',
          endpoints: [
            'GET /health',
            'WS / (WebSocket protocol)',
          ],
          methods: ['health', 'status', 'agent', 'send', 'channels.status', 'config.reload', 'config.get'],
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws, req) => {
      logWsConnection(req);

      const clientId = crypto.randomUUID();
      const client: ClientConnection = {
        ws,
        id: clientId,
        authenticated: !this.config.token, // Auto-authenticated if no token
      };
      this.clients.set(ws, client);

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (!isGatewayRequest(message)) {
            ws.send(JSON.stringify(createResponse(
              'unknown',
              undefined,
              { code: 'BAD_REQUEST', message: 'Invalid message format' }
            )));
            return;
          }

          await this.handleRequest(message, client);
        } catch (error) {
          log.error({ err: error }, 'Failed to handle message');
          ws.send(JSON.stringify(handleError(error, 'unknown')));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        log.info({ clientId }, 'Client disconnected');
      });

      ws.on('error', (error) => {
        log.error({ err: error, clientId }, 'WebSocket error');
      });
    });

    return new Promise((resolve) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        log.info(
          { host: this.config.host, port: this.config.port },
          `Gateway server running at http://${this.config.host}:${this.config.port}`
        );
        resolve();
      });
    });
  }

  private async handleRequest(
    request: GatewayRequest,
    client: ClientConnection
  ): Promise<void> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case 'health': {
          const health = this.service.getHealth();
          client.ws.send(JSON.stringify(createResponse(id, health)));
          break;
        }

        case 'status': {
          const status = this.service.getHealth();
          client.ws.send(JSON.stringify(createResponse(id, {
            status: status.status,
            version: status.version,
            channels: status.channels,
          })));
          break;
        }

        case 'agent': {
          const message = params.message as string;
          const channel = (params.channel as string) || 'gateway';
          const chatId = (params.chatId as string) || 'default';

          if (!message) {
            client.ws.send(JSON.stringify(createResponse(
              id,
              undefined,
              { code: 'BAD_REQUEST', message: 'Missing required param: message' }
            )));
            return;
          }

          // Stream agent events
          const generator = this.service.runAgent(message, channel, chatId);

          try {
            while (true) {
              const { done, value } = await generator.next();

              if (done) {
                client.ws.send(JSON.stringify(createResponse(id, value)));
                break;
              } else {
                client.ws.send(JSON.stringify(createEvent('agent', value)));
              }
            }
          } catch (error) {
            client.ws.send(JSON.stringify(handleError(error, id)));
          }
          break;
        }

        case 'send': {
          const channel = params.channel as string;
          const chatId = params.chatId as string;
          const content = params.content as string;

          if (!channel || !chatId || !content) {
            client.ws.send(JSON.stringify(createResponse(
              id,
              undefined,
              { code: 'BAD_REQUEST', message: 'Missing required params: channel, chatId, content' }
            )));
            return;
          }

          const result = await this.service.sendMessage(channel, chatId, content);
          client.ws.send(JSON.stringify(createResponse(id, result)));
          break;
        }

        case 'channels.status': {
          const channels = this.service.getChannelsStatus();
          client.ws.send(JSON.stringify(createResponse(id, { channels })));
          break;
        }

        case 'config.reload': {
          const result = await this.service.reloadConfig();
          client.ws.send(JSON.stringify(createResponse(id, result)));
          break;
        }

        case 'config.get': {
          const config = this.service.currentConfig;
          // Return only safe config (no API keys)
          const safeConfig = {
            agents: config.agents,
            channels: {
              telegram: { enabled: config.channels?.telegram?.enabled },
              whatsapp: { enabled: config.channels?.whatsapp?.enabled },
            },
            gateway: config.gateway,
          };
          client.ws.send(JSON.stringify(createResponse(id, { config: safeConfig })));
          break;
        }

        default: {
          client.ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'NOT_FOUND', message: `Method not found: ${method}` }
          )));
        }
      }
    } catch (error) {
      client.ws.send(JSON.stringify(handleError(error, id)));
    }
  }

  async stop(): Promise<void> {
    log.info('Stopping gateway server...');

    // Close all client connections
    for (const [ws, client] of this.clients) {
      log.debug({ clientId: client.id }, 'Closing client connection');
      ws.close();
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    // Stop HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    // Stop underlying service
    await this.service.stop();

    log.info('Gateway server stopped');
  }

  get isRunning(): boolean {
    return this.httpServer !== null;
  }
}

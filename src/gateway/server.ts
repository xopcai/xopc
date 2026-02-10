import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../utils/logger.js';
import {
  type GatewayConfig,
  type GatewayRequest,
  type GatewayResponse,
  type GatewayEvent,
  type RequestContext,
  isGatewayRequest,
  createResponse,
  createEvent,
} from './protocol.js';
import { Router } from './router.js';
import { createAuthMiddleware, logRequest, logWsConnection, handleError } from './middleware/index.js';

const log = createLogger('GatewayServer');

interface ClientConnection {
  ws: WebSocket;
  id: string;
  authenticated: boolean;
}

export class GatewayServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private router: Router;
  private clients = new Map<WebSocket, ClientConnection>();
  private config: GatewayConfig;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.router = new Router();
  }

  async start(): Promise<void> {
    const authenticate = createAuthMiddleware({ token: this.config.token });

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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          service: 'xopcbot-gateway',
          version: '0.1.0',
          uptime: process.uptime(),
        }));
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
          methods: this.router.list(),
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
          { host: this.config.port, port: this.config.port },
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

    const handler = this.router.get(method);
    if (!handler) {
      client.ws.send(JSON.stringify(createResponse(
        id,
        undefined,
        { code: 'NOT_FOUND', message: `Method not found: ${method}` }
      )));
      return;
    }

    const ctx: RequestContext = {
      clientId: client.id,
      isAuthenticated: client.authenticated,
      sendEvent: (event) => {
        client.ws.send(JSON.stringify(event));
      },
    };

    try {
      const result = handler(params, ctx);

      // Check if result is async generator (streaming)
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        const generator = result as AsyncGenerator<GatewayEvent, unknown, unknown>;
        
        try {
          // Stream events until generator completes
          while (true) {
            const { done, value } = await generator.next();
            
            if (done) {
              // Final response with return value
              client.ws.send(JSON.stringify(createResponse(id, value)));
              break;
            } else {
              // Stream event
              client.ws.send(JSON.stringify(value));
            }
          }
        } catch (error) {
          client.ws.send(JSON.stringify(handleError(error, id)));
        }
      } else {
        // Regular promise
        const value = await result;
        client.ws.send(JSON.stringify(createResponse(id, value)));
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

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    log.info('Gateway server stopped');
  }

  get isRunning(): boolean {
    return this.httpServer !== null;
  }
}

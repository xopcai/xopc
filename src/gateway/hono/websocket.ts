import type { WSContext } from 'hono/ws';
import type { GatewayService } from '../service.js';
import { createLogger } from '../../utils/logger.js';
import {
  type GatewayRequest,
  type GatewayEvent,
  isGatewayRequest,
  createResponse,
  createEvent,
} from '../protocol.js';

const log = createLogger('Hono:WebSocket');

interface ClientConnection {
  ws: WSContext;
  id: string;
  authenticated: boolean;
}

export interface WebSocketHandlerConfig {
  service: GatewayService;
  token?: string;
}

export function createWebSocketHandler(config: WebSocketHandlerConfig) {
  const { service, token } = config;
  const clients = new Map<WSContext, ClientConnection>();

  return {
    // Returns WSEvents for Hono's upgradeWebSocket
    get handlers() {
      return {
        onOpen: (_evt: Event, ws: WSContext) => {
          const clientId = crypto.randomUUID();
          clients.set(ws, {
            ws,
            id: clientId,
            authenticated: !token, // Auto-auth if no token configured
          });
          log.info({ clientId }, 'WebSocket connected');
        },

        onMessage: async (evt: MessageEvent, ws: WSContext) => {
          const client = clients.get(ws);
          if (!client) {
            log.warn('Message from unknown client');
            return;
          }

          try {
            const message = evt.data;
            const data = JSON.parse(message.toString());

            if (!isGatewayRequest(data)) {
              ws.send(JSON.stringify(createResponse(
                'unknown',
                undefined,
                { code: 'BAD_REQUEST', message: 'Invalid message format' }
              )));
              return;
            }

            await handleRequest(data, client, service, ws);
          } catch (error) {
            log.error({ err: error, clientId: client.id }, 'Failed to handle message');
            ws.send(JSON.stringify(createErrorResponse(error, 'unknown')));
          }
        },

        onClose: (_evt: CloseEvent, ws: WSContext) => {
          const client = clients.get(ws);
          if (client) {
            log.info({ clientId: client.id }, 'WebSocket disconnected');
            clients.delete(ws);
          }
        },

        onError: (evt: Event, ws: WSContext) => {
          const client = clients.get(ws);
          log.error({ clientId: client?.id, error: evt }, 'WebSocket error');
        },
      };
    },
  };
}

function createErrorResponse(error: unknown, requestId: string) {
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';

  if (error instanceof Error) {
    message = error.message;
    if (message.includes('not found')) code = 'NOT_FOUND';
    else if (message.includes('unauthorized')) code = 'UNAUTHORIZED';
    else if (message.includes('missing')) code = 'BAD_REQUEST';
  }

  return createResponse(requestId, undefined, { code, message });
}

async function handleRequest(
  request: GatewayRequest,
  client: ClientConnection,
  service: GatewayService,
  ws: WSContext
): Promise<void> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'health': {
        const health = service.getHealth();
        ws.send(JSON.stringify(createResponse(id, health)));
        break;
      }

      case 'status': {
        const health = service.getHealth();
        ws.send(JSON.stringify(createResponse(id, {
          status: health.status,
          version: health.version,
          channels: health.channels,
          uptime: health.uptime,
        })));
        break;
      }

      case 'agent': {
        const message = params.message as string;
        const channel = (params.channel as string) || 'gateway';
        const chatId = (params.chatId as string) || 'default';

        if (!message) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: message' }
          )));
          return;
        }

        const generator = service.runAgent(message, channel, chatId);

        try {
          while (true) {
            const { done, value } = await generator.next();

            if (done) {
              ws.send(JSON.stringify(createResponse(id, value)));
              break;
            } else {
              ws.send(JSON.stringify(createEvent('agent', value)));
            }
          }
        } catch (error) {
          ws.send(JSON.stringify(createErrorResponse(error, id)));
        }
        break;
      }

      case 'send': {
        const channel = params.channel as string;
        const chatId = params.chatId as string;
        const content = params.content as string;

        if (!channel || !chatId || !content) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required params: channel, chatId, content' }
          )));
          return;
        }

        const result = await service.sendMessage(channel, chatId, content);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'channels.status': {
        const channels = service.getChannelsStatus();
        ws.send(JSON.stringify(createResponse(id, { channels })));
        break;
      }

      case 'config.reload': {
        const result = await service.reloadConfig();
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'config.get': {
        const config = service.currentConfig;
        const safeConfig = {
          agents: config.agents,
          channels: {
            telegram: { enabled: config.channels?.telegram?.enabled },
            whatsapp: { enabled: config.channels?.whatsapp?.enabled },
          },
          gateway: config.gateway,
          cron: { enabled: config.cron?.enabled },
        };
        ws.send(JSON.stringify(createResponse(id, { config: safeConfig })));
        break;
      }

      case 'cron.list': {
        const cronService = service.cronServiceInstance;
        const jobs = await cronService.listJobs();
        ws.send(JSON.stringify(createResponse(id, { jobs })));
        break;
      }

      case 'cron.add': {
        const cronService = service.cronServiceInstance;
        const schedule = params.schedule as string;
        const message = params.message as string;
        const name = params.name as string | undefined;

        if (!schedule || !message) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required params: schedule, message' }
          )));
          break;
        }

        try {
          const result = await cronService.addJob(schedule, message, { name });
          ws.send(JSON.stringify(createResponse(id, result)));
        } catch (error) {
          ws.send(JSON.stringify(createErrorResponse(error, id)));
        }
        break;
      }

      case 'cron.remove': {
        const cronService = service.cronServiceInstance;
        const jobId = params.id as string;

        if (!jobId) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: id' }
          )));
          break;
        }

        const result = await cronService.removeJob(jobId);
        ws.send(JSON.stringify(createResponse(id, { removed: result })));
        break;
      }

      case 'cron.toggle': {
        const cronService = service.cronServiceInstance;
        const jobId = params.id as string;
        const enabled = params.enabled as boolean;

        if (!jobId || typeof enabled !== 'boolean') {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required params: id, enabled' }
          )));
          break;
        }

        const result = await cronService.toggleJob(jobId, enabled);
        ws.send(JSON.stringify(createResponse(id, { toggled: result })));
        break;
      }

      case 'cron.metrics': {
        const cronService = service.cronServiceInstance;
        const metrics = await cronService.getMetrics();
        ws.send(JSON.stringify(createResponse(id, metrics)));
        break;
      }

      default: {
        ws.send(JSON.stringify(createResponse(
          id,
          undefined,
          { code: 'NOT_FOUND', message: `Method not found: ${method}` }
        )));
      }
    }
  } catch (error) {
    ws.send(JSON.stringify(createErrorResponse(error, id)));
  }
}

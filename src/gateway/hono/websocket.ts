import type { WSContext } from 'hono/ws';
import type { GatewayService } from '../service.js';
import { createLogger } from '../../utils/logger.js';
import { validateWebSocketAuth } from './middleware/auth.js';
import {
  type GatewayRequest,
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

/**
 * Get WebSocket auth result from connection parameters
 */
export function getWebSocketAuth(
  url: URL,
  authHeader: string | null,
  token?: string
): { authenticated: boolean; error?: string } {
  const result = validateWebSocketAuth(url, authHeader, token);
  if (result.valid) {
    return { authenticated: true };
  }
  return { authenticated: false, error: result.error };
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

          // Validate auth on connection
          const url = new URL(ws.url);
          const authHeader = url.searchParams.get('token') || null;
          const auth = getWebSocketAuth(url, authHeader, token);

          if (!auth.authenticated) {
            log.warn({ clientId, error: auth.error }, 'WebSocket auth failed');
            // Mark as unauthenticated - will be rejected on first message
            clients.set(ws, {
              ws,
              id: clientId,
              authenticated: false,
            });
            return;
          }

          clients.set(ws, {
            ws,
            id: clientId,
            authenticated: true,
          });
          log.info({ clientId }, 'WebSocket connected and authenticated');
        },

        onMessage: async (evt: MessageEvent, ws: WSContext) => {
          const client = clients.get(ws);
          if (!client) {
            log.warn('Message from unknown client');
            return;
          }

          // Reject requests from unauthenticated clients
          if (!client.authenticated) {
            ws.send(JSON.stringify(createResponse(
              'unknown',
              undefined,
              { code: 'UNAUTHORIZED', message: 'Authentication required' }
            )));
            ws.close(4401, 'Unauthorized');
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
        const attachments = params.attachments as Array<{
          type: string;
          mimeType?: string;
          data?: string;
          name?: string;
          size?: number;
        }> | undefined;

        if (!message) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: message' }
          )));
          return;
        }

        const generator = service.runAgent(message, channel, chatId, attachments);

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

      case 'cron.get': {
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

        const job = await cronService.getJob(jobId);
        if (!job) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'NOT_FOUND', message: `Job not found: ${jobId}` }
          )));
          break;
        }
        ws.send(JSON.stringify(createResponse(id, { job })));
        break;
      }

      case 'cron.update': {
        const cronService = service.cronServiceInstance;
        const jobId = params.id as string;
        const updates = params.updates as Partial<{
          name: string;
          schedule: string;
          message: string;
          enabled: boolean;
          timezone: string;
          maxRetries: number;
          timeout: number;
        }>;

        if (!jobId || !updates) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required params: id, updates' }
          )));
          break;
        }

        try {
          const result = await cronService.updateJob(jobId, updates);
          ws.send(JSON.stringify(createResponse(id, { updated: result })));
        } catch (error) {
          ws.send(JSON.stringify(createErrorResponse(error, id)));
        }
        break;
      }

      case 'cron.run': {
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

        try {
          await cronService.runJobNow(jobId);
          ws.send(JSON.stringify(createResponse(id, { triggered: true })));
        } catch (error) {
          ws.send(JSON.stringify(createErrorResponse(error, id)));
        }
        break;
      }

      case 'cron.history': {
        const cronService = service.cronServiceInstance;
        const jobId = params.id as string;
        const limit = params.limit as number | undefined;

        if (!jobId) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: id' }
          )));
          break;
        }

        const history = cronService.getJobHistory(jobId, limit);
        ws.send(JSON.stringify(createResponse(id, { history })));
        break;
      }

      // ========== Session Management ==========

      case 'session.list': {
        const query = params.query as Parameters<typeof service.listSessions>[0];
        const result = await service.listSessions(query);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.get': {
        const key = params.key as string;
        if (!key) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: key' }
          )));
          break;
        }
        const session = await service.getSession(key);
        if (!session) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'NOT_FOUND', message: `Session not found: ${key}` }
          )));
          break;
        }
        ws.send(JSON.stringify(createResponse(id, { session })));
        break;
      }

      case 'session.delete': {
        const key = params.key as string;
        if (!key) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: key' }
          )));
          break;
        }
        const result = await service.deleteSession(key);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.deleteMany': {
        const keys = params.keys as string[];
        if (!Array.isArray(keys) || keys.length === 0) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing or invalid param: keys (array expected)' }
          )));
          break;
        }
        const result = await service.deleteSessions(keys);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.rename': {
        const key = params.key as string;
        const name = params.name as string;
        if (!key || !name) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required params: key, name' }
          )));
          break;
        }
        const result = await service.renameSession(key, name);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.tag': {
        const key = params.key as string;
        const tags = params.tags as string[];
        if (!key || !Array.isArray(tags)) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing or invalid params: key, tags (array expected)' }
          )));
          break;
        }
        const result = await service.tagSession(key, tags);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.untag': {
        const key = params.key as string;
        const tags = params.tags as string[];
        if (!key || !Array.isArray(tags)) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing or invalid params: key, tags (array expected)' }
          )));
          break;
        }
        const result = await service.untagSession(key, tags);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.archive': {
        const key = params.key as string;
        if (!key) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: key' }
          )));
          break;
        }
        const result = await service.archiveSession(key);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.unarchive': {
        const key = params.key as string;
        if (!key) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: key' }
          )));
          break;
        }
        const result = await service.unarchiveSession(key);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.pin': {
        const key = params.key as string;
        if (!key) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: key' }
          )));
          break;
        }
        const result = await service.pinSession(key);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.unpin': {
        const key = params.key as string;
        if (!key) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: key' }
          )));
          break;
        }
        const result = await service.unpinSession(key);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.search': {
        const query = params.query as string;
        if (!query) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: query' }
          )));
          break;
        }
        const sessions = await service.searchSessions(query);
        ws.send(JSON.stringify(createResponse(id, { sessions })));
        break;
      }

      case 'session.searchIn': {
        const key = params.key as string;
        const keyword = params.keyword as string;
        if (!key || !keyword) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required params: key, keyword' }
          )));
          break;
        }
        const messages = await service.searchInSession(key, keyword);
        ws.send(JSON.stringify(createResponse(id, { messages })));
        break;
      }

      case 'session.export': {
        const key = params.key as string;
        const format = (params.format as 'json' | 'markdown') || 'json';
        if (!key) {
          ws.send(JSON.stringify(createResponse(
            id,
            undefined,
            { code: 'BAD_REQUEST', message: 'Missing required param: key' }
          )));
          break;
        }
        const result = await service.exportSession(key, format);
        ws.send(JSON.stringify(createResponse(id, result)));
        break;
      }

      case 'session.stats': {
        const stats = await service.getSessionStats();
        ws.send(JSON.stringify(createResponse(id, stats)));
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

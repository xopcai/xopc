import type { IncomingMessage } from 'http';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Gateway:Access');

export function logRequest(req: IncomingMessage): void {
  log.info({
    method: req.method,
    url: req.url,
    remoteAddress: req.socket.remoteAddress,
  }, 'HTTP request');
}

export function logWsConnection(req: IncomingMessage): void {
  log.info({
    remoteAddress: req.socket.remoteAddress,
  }, 'WebSocket connection');
}

import type { RequestHandler } from './protocol.js';
import {
  handleHealth,
  handleStatus,
  handleAgent,
  handleSend,
  handleChannelsStatus,
} from './handlers/index.js';

export class Router {
  private handlers = new Map<string, RequestHandler>();

  constructor() {
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    this.register('health', handleHealth);
    this.register('status', handleStatus);
    this.register('agent', handleAgent);
    this.register('send', handleSend);
    this.register('channels.status', handleChannelsStatus);
  }

  register(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler);
  }

  get(method: string): RequestHandler | undefined {
    return this.handlers.get(method);
  }

  list(): string[] {
    return Array.from(this.handlers.keys());
  }
}

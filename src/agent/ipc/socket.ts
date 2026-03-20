import { createServer, Server, Socket } from 'net';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { createLogger } from '../../utils/logger.js';
import { resolveSocketPath } from '../../config/paths.js';
import type { AgentIPCMessage, AnyIPCMessage } from './types.js';
import { isValidIPCMessage } from './types.js';

const log = createLogger('AgentSocket');

// ============================================
// Socket Message Protocol
// ============================================

interface SocketMessage {
  id: string;
  payload: AgentIPCMessage;
}

// ============================================
// Agent Socket Server
// ============================================

export class AgentSocketServer {
  private server?: Server;
  private readonly socketPath: string;
  private connections: Map<string, Socket> = new Map();
  private messageHandler?: (msg: AgentIPCMessage, reply: (response: AgentIPCMessage) => void) => Promise<void>;

  constructor(agentId?: string) {
    this.socketPath = resolveSocketPath(agentId);
  }

  /**
   * Start the socket server
   */
  async start(
    handler: (msg: AgentIPCMessage, reply: (response: AgentIPCMessage) => void) => Promise<void>
  ): Promise<void> {
    this.messageHandler = handler;

    // Ensure directory exists
    await mkdir(dirname(this.socketPath), { recursive: true });

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err) => {
        log.error({ err }, 'Socket server error');
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        log.info({ socketPath: this.socketPath }, 'Socket server listening');
        resolve();
      });
    });
  }

  /**
   * Stop the socket server
   */
  async stop(): Promise<void> {
    // Close all connections
    for (const [id, socket] of this.connections) {
      socket.end();
      this.connections.delete(id);
    }

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        log.info('Socket server stopped');
        resolve();
      });
    });
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  // ============================================
  // Private Methods
  // ============================================

  private handleConnection(socket: Socket): void {
    const connectionId = `${socket.remoteAddress}:${socket.remotePort}`;
    this.connections.set(connectionId, socket);

    log.debug({ connectionId }, 'New socket connection');

    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString('utf-8');

      // Process complete messages (newline-delimited JSON)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const msg = JSON.parse(line) as AgentIPCMessage;

          if (!isValidIPCMessage(msg)) {
            log.warn({ line }, 'Invalid IPC message received');
            continue;
          }

          await this.handleMessage(msg, (response) => {
            socket.write(JSON.stringify(response) + '\n');
          });
        } catch (error) {
          log.warn({ line, error }, 'Failed to parse socket message');
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(connectionId);
      log.debug({ connectionId }, 'Socket connection closed');
    });

    socket.on('error', (err) => {
      log.warn({ connectionId, err }, 'Socket error');
      this.connections.delete(connectionId);
    });
  }

  private async handleMessage(
    msg: AgentIPCMessage,
    reply: (response: AgentIPCMessage) => void
  ): Promise<void> {
    if (!this.messageHandler) {
      log.warn('No message handler set');
      return;
    }

    try {
      await this.messageHandler(msg, reply);
    } catch (error) {
      log.error({ messageId: msg.id, error }, 'Error handling message');
    }
  }
}

// ============================================
// Agent Socket Client
// ============================================

export class AgentSocketClient {
  private socket?: Socket;
  private readonly socketPath: string;
  private pendingResponses: Map<
    string,
    { resolve: (value: AgentIPCMessage) => void; reject: (reason?: Error) => void; timeout: NodeJS.Timeout }
  > = new Map();

  constructor(targetAgentId: string) {
    this.socketPath = resolveSocketPath(targetAgentId);
  }

  /**
   * Connect to the socket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket();

      this.socket.on('connect', () => {
        log.debug({ socketPath: this.socketPath }, 'Socket connected');
        this.startListening();
        resolve();
      });

      this.socket.on('error', (err) => {
        log.warn({ socketPath: this.socketPath, err }, 'Socket connection error');
        reject(err);
      });

      this.socket.connect(this.socketPath);
    });
  }

  /**
   * Disconnect from the socket server
   */
  disconnect(): void {
    // Reject all pending responses
    for (const [id, handler] of this.pendingResponses) {
      clearTimeout(handler.timeout);
      handler.reject(new Error('Socket disconnected'));
    }
    this.pendingResponses.clear();

    this.socket?.end();
    this.socket = undefined;
  }

  /**
   * Send a message and wait for response
   */
  async sendAndWait(
    msg: AgentIPCMessage,
    timeoutMs: number = 30000
  ): Promise<AgentIPCMessage> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(msg.id);
        reject(new Error(`Timeout waiting for response to ${msg.id}`));
      }, timeoutMs);

      this.pendingResponses.set(msg.id, { resolve, reject, timeout });

      this.socket!.write(JSON.stringify(msg) + '\n', (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingResponses.delete(msg.id);
          reject(err);
        }
      });
    });
  }

  /**
   * Send a message without waiting for response
   */
  async send(msg: AgentIPCMessage): Promise<void> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    return new Promise((resolve, reject) => {
      this.socket!.write(JSON.stringify(msg) + '\n', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Check if socket is connected
   */
  isConnected(): boolean {
    return this.socket?.readyState === 'open';
  }

  // ============================================
  // Private Methods
  // ============================================

  private startListening(): void {
    if (!this.socket) return;

    let buffer = '';

    this.socket.on('data', (data) => {
      buffer += data.toString('utf-8');

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const msg = JSON.parse(line) as AgentIPCMessage;

          // Check if this is a response we're waiting for
          if (msg.replyTo && this.pendingResponses.has(msg.replyTo)) {
            const handler = this.pendingResponses.get(msg.replyTo)!;
            clearTimeout(handler.timeout);
            this.pendingResponses.delete(msg.replyTo);
            handler.resolve(msg);
          }
        } catch (error) {
          log.warn({ line, error }, 'Failed to parse response');
        }
      }
    });

    this.socket.on('close', () => {
      log.debug('Socket closed');
      this.disconnect();
    });

    this.socket.on('error', (err) => {
      log.warn({ err }, 'Socket error');
    });
  }
}

// ============================================
// Utility Functions
// ============================================

export async function isSocketAvailable(agentId?: string): Promise<boolean> {
  const socketPath = resolveSocketPath(agentId);

  return new Promise((resolve) => {
    const socket = new Socket();

    socket.on('connect', () => {
      socket.end();
      resolve(true);
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.connect(socketPath);
  });
}

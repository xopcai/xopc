import {
  EXECUTION_HOST_MAX_COMMAND_DURATION_MS,
  type ClientExecutionHostMessage,
  type ExecutionCommand,
  type ExecutionHostHelloPayload,
  type ServerExecutionHostMessage,
} from '@xopcai/realtime-protocol';

import { recordExecutionHostEvent, touchExecutionHost } from './repository.js';

export interface ExecutionHostTransport {
  send(message: ServerExecutionHostMessage): void;
  close(code: number, reason: string): void;
}

export interface ConnectedExecutionHost {
  hostId: string;
  connectionId: string;
  connectedAt: number;
  lastSeenAt: number;
  hello: ExecutionHostHelloPayload;
}

type Connection = ConnectedExecutionHost & { transport: ExecutionHostTransport };
type PendingOperation = {
  hostId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (payload: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

function connectionError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code, retryable: true });
}

export class ExecutionHostRegistry {
  private readonly connections = new Map<string, Connection>();
  private readonly pending = new Map<string, PendingOperation>();

  connect(
    hello: ExecutionHostHelloPayload,
    connectionId: string,
    transport: ExecutionHostTransport,
    now = Date.now(),
  ): ConnectedExecutionHost {
    const previous = this.connections.get(hello.hostId);
    if (previous && previous.connectionId !== connectionId) {
      previous.transport.close(4409, 'Execution host connected elsewhere');
      this.disconnect(previous.hostId, previous.connectionId, 'replaced', now);
    }
    const connection: Connection = {
      hostId: hello.hostId,
      connectionId,
      connectedAt: now,
      lastSeenAt: now,
      hello,
      transport,
    };
    this.connections.set(hello.hostId, connection);
    touchExecutionHost(hello.hostId, hello, now);
    recordExecutionHostEvent(hello.hostId, 'connected', { connectionId }, now);
    return this.publicConnection(connection);
  }

  touch(hostId: string, connectionId: string, now = Date.now()): void {
    const connection = this.connections.get(hostId);
    if (!connection || connection.connectionId !== connectionId) return;
    connection.lastSeenAt = now;
  }

  disconnect(hostId: string, connectionId: string, reason = 'disconnected', now = Date.now()): void {
    const connection = this.connections.get(hostId);
    if (!connection || connection.connectionId !== connectionId) return;
    this.connections.delete(hostId);
    recordExecutionHostEvent(hostId, 'disconnected', { connectionId, reason }, now);
    for (const [operationId, operation] of this.pending) {
      if (operation.hostId !== hostId) continue;
      clearTimeout(operation.timer);
      operation.reject(connectionError(`Execution host disconnected: ${reason}`, 'HOST_DISCONNECTED'));
      this.pending.delete(operationId);
    }
  }

  disconnectHost(hostId: string, reason: string): void {
    const connection = this.connections.get(hostId);
    if (!connection) return;
    connection.transport.close(4403, reason);
    this.disconnect(hostId, connection.connectionId, reason);
  }

  disconnectAll(reason: string): void {
    for (const connection of [...this.connections.values()]) {
      this.disconnect(connection.hostId, connection.connectionId, reason);
    }
  }

  list(): ConnectedExecutionHost[] {
    return [...this.connections.values()].map((connection) => this.publicConnection(connection));
  }

  get(hostId: string): ConnectedExecutionHost | undefined {
    const connection = this.connections.get(hostId);
    return connection ? this.publicConnection(connection) : undefined;
  }

  execute(
    hostId: string,
    command: ExecutionCommand,
    onProgress?: (payload: unknown) => void,
  ): Promise<unknown> {
    const connection = this.connections.get(hostId);
    if (!connection) {
      return Promise.reject(connectionError(`Execution host is offline: ${hostId}`, 'HOST_OFFLINE'));
    }
    if (this.pending.has(command.operationId)) {
      return Promise.reject(new Error(`Execution operation is already pending: ${command.operationId}`));
    }
    const timeoutMs = command.deadlineAt - Date.now();
    if (timeoutMs <= 0) {
      return Promise.reject(new Error(`Execution operation deadline has elapsed: ${command.operationId}`));
    }
    if (timeoutMs > EXECUTION_HOST_MAX_COMMAND_DURATION_MS) {
      return Promise.reject(new Error(`Execution operation deadline exceeds four hours: ${command.operationId}`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.operationId);
        try {
          connection.transport.send({
            type: 'execution.cancel',
            operationId: command.operationId,
            reason: 'Gateway execution deadline exceeded',
          });
        } catch {
          // The deadline outcome is authoritative even if the socket closed first.
        }
        reject(connectionError(`Execution operation timed out: ${command.operationId}`, 'DEADLINE_EXCEEDED'));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(command.operationId, { hostId, resolve, reject, onProgress, timer });
      try {
        connection.transport.send({ type: 'execution.command', command });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(command.operationId);
        reject(connectionError(
          error instanceof Error ? error.message : String(error),
          'HOST_SEND_FAILED',
        ));
      }
    });
  }

  cancel(hostId: string, operationId: string, reason: string): void {
    const connection = this.connections.get(hostId);
    try {
      connection?.transport.send({ type: 'execution.cancel', operationId, reason });
    } catch {
      // Cancellation is best effort over the transport; local state is authoritative below.
    }
    const operation = this.pending.get(operationId);
    if (!operation || operation.hostId !== hostId) return;
    clearTimeout(operation.timer);
    this.pending.delete(operationId);
    operation.reject(Object.assign(new Error(reason), { code: 'CANCELLED' }));
  }

  handleMessage(hostId: string, connectionId: string, message: ClientExecutionHostMessage): void {
    const connection = this.connections.get(hostId);
    if (!connection || connection.connectionId !== connectionId) {
      throw new Error('Execution host connection is stale');
    }
    connection.lastSeenAt = Date.now();
    const operation = this.pending.get(message.operationId);
    if (!operation || operation.hostId !== hostId) return;
    if (message.type === 'execution.accepted') return;
    if (message.type === 'execution.progress') {
      operation.onProgress?.(message.payload);
      return;
    }
    clearTimeout(operation.timer);
    this.pending.delete(message.operationId);
    if (message.type === 'execution.result') operation.resolve(message.result);
    else operation.reject(Object.assign(new Error(message.message), {
      code: message.code,
      retryable: message.retryable,
    }));
  }

  private publicConnection(connection: Connection): ConnectedExecutionHost {
    const { transport: _transport, ...publicConnection } = connection;
    return publicConnection;
  }
}

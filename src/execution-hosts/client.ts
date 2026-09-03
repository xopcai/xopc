import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { RealtimeClient, type RealtimeWebSocket } from '@xopcai/realtime-client';
import {
  EXECUTION_HOST_MAX_COMMAND_DURATION_MS,
  type ClientExecutionHostMessage,
  type ExecutionCommand,
} from '@xopcai/realtime-protocol';

import { createExecutionHostHello, createExecutionHostTicketRequest, type ExecutionHostIdentity } from './identity.js';

const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');

export interface ExecutionHostCommandHandler {
  execute(
    command: ExecutionCommand,
    signal: AbortSignal,
    onProgress: (payload: unknown) => void,
  ): Promise<unknown>;
}

function httpUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

function websocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/realtime/v1/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function requiredCapability(command: ExecutionCommand): keyof ExecutionHostIdentity['registration']['capabilities'] | undefined {
  if (command.command === 'environment.snapshot') return 'snapshots';
  if (command.command !== 'workspace.execute_tool') return 'git';
  const toolName = (command.payload as { toolName?: unknown } | null)?.toolName;
  if (toolName === 'write_file' || toolName === 'apply_patch') return 'patch';
  if (toolName === 'grep' || toolName === 'find') return 'search';
  if (toolName === 'exec_command' || toolName === 'managed_job') return 'shell';
  return undefined;
}

export class ExecutionHostClient {
  private readonly operations = new Map<string, {
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
    sequence: number;
  }>();
  private readonly realtime: RealtimeClient;

  constructor(input: {
    gatewayUrl: string;
    identity: ExecutionHostIdentity;
    handler: ExecutionHostCommandHandler;
    onStateChange?: (state: string, error?: string) => void;
  }) {
    const { gatewayUrl, identity, handler } = input;
    this.realtime = new RealtimeClient({
      clientId: identity.registration.hostId,
      clientKind: 'execution_host',
      createMessageId: crypto.randomUUID,
      getWebSocketUrl: () => websocketUrl(gatewayUrl),
      createWebSocket: (url) => new WebSocket(url) as unknown as RealtimeWebSocket,
      issueTicket: async (signal) => {
        const response = await fetch(httpUrl(gatewayUrl, '/api/execution-hosts/tickets'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createExecutionHostTicketRequest(identity)),
          signal,
        });
        const body = await response.json() as { ok?: boolean; payload?: { ticket?: string }; error?: { message?: string } };
        const ticket = body.payload?.ticket;
        if (!response.ok || !ticket) throw new Error(body.error?.message || `Ticket request failed (${response.status})`);
        return ticket;
      },
      onStateChange: input.onStateChange,
      executionHost: {
        createHello: async () => createExecutionHostHello(identity),
        onReady: () => {},
        onDisconnected: () => {
          for (const operation of this.operations.values()) {
            clearTimeout(operation.timer);
            operation.controller.abort();
          }
          this.operations.clear();
        },
        onMessage: (message) => {
          if (message.type === 'execution.cancel') {
            this.operations.get(message.operationId)?.controller.abort(message.reason);
            return;
          }
          const { command } = message;
          const capability = requiredCapability(command);
          if (capability && !identity.registration.capabilities[capability]) {
            this.send({
              type: 'execution.error',
              operationId: command.operationId,
              code: 'CAPABILITY_UNAVAILABLE',
              message: `Execution host capability is disabled: ${capability}`,
              retryable: false,
            });
            return;
          }
          if (this.operations.has(command.operationId)) {
            this.send({
              type: 'execution.error',
              operationId: command.operationId,
              code: 'DUPLICATE_OPERATION',
              message: 'Execution operation is already running',
              retryable: false,
            });
            return;
          }
          if (this.operations.size >= identity.registration.maxConcurrency) {
            this.send({
              type: 'execution.error',
              operationId: command.operationId,
              code: 'HOST_BUSY',
              message: 'Execution host concurrency limit reached',
              retryable: true,
            });
            return;
          }
          const controller = new AbortController();
          const timeoutMs = command.deadlineAt - Date.now();
          if (timeoutMs <= 0 || timeoutMs > EXECUTION_HOST_MAX_COMMAND_DURATION_MS) {
            this.send({
              type: 'execution.error',
              operationId: command.operationId,
              code: 'DEADLINE_EXCEEDED',
              message: timeoutMs <= 0
                ? 'Execution command deadline has expired'
                : 'Execution command deadline exceeds four hours',
              retryable: false,
            });
            return;
          }
          const operation = {
            controller,
            timer: setTimeout(() => controller.abort('Execution deadline exceeded'), timeoutMs),
            sequence: 0,
          };
          operation.timer.unref?.();
          this.operations.set(command.operationId, operation);
          if (!this.send({
            type: 'execution.accepted',
            operationId: command.operationId,
          })) {
            clearTimeout(operation.timer);
            this.operations.delete(command.operationId);
            controller.abort('Realtime connection closed');
            return;
          }
          void Promise.resolve().then(() => handler.execute(command, controller.signal, (payload) => {
            if (controller.signal.aborted) return;
            operation.sequence += 1;
            this.send({
              type: 'execution.progress',
              operationId: command.operationId,
              sequence: operation.sequence,
              payload: payload ?? null,
            });
          }))
            .then((result) => {
              if (controller.signal.aborted) {
                throw new Error(String(controller.signal.reason || 'Execution operation cancelled'));
              }
              this.send({
                type: 'execution.result',
                operationId: command.operationId,
                result: result ?? null,
              });
            })
            .catch((error) => {
              const executionError = error as { code?: unknown; retryable?: unknown };
              const rawCode = typeof executionError.code === 'string' ? executionError.code.trim() : '';
              const rawMessage = error instanceof Error ? error.message : String(error);
              this.send({
                type: 'execution.error',
                operationId: command.operationId,
                code: controller.signal.aborted
                  ? 'CANCELLED'
                  : rawCode
                    ? rawCode.slice(0, 80)
                    : 'EXECUTION_FAILED',
                message: rawMessage.trim().slice(0, 1000) || 'Execution failed',
                retryable: executionError.retryable === true,
              });
            })
            .finally(() => {
              clearTimeout(operation.timer);
              this.operations.delete(command.operationId);
            });
        },
      },
    });
  }

  connect(): void {
    this.realtime.connect();
  }

  disconnect(): void {
    this.realtime.disconnect();
  }

  private send(message: ClientExecutionHostMessage): boolean {
    try {
      this.realtime.sendExecutionHostMessage(message);
      return true;
    } catch {
      return false;
    }
  }
}

import type {
  ClientExecutionHostMessage,
  ExecutionHostHelloPayload,
} from '@xopcai/realtime-protocol';

import { ExecutionHostAuthenticator } from './auth.js';
import { ExecutionHostEnrollmentStore } from './enrollment.js';
import { ExecutionHostRegistry, type ExecutionHostTransport } from './registry.js';

export class ExecutionHostRuntime {
  readonly authenticator = new ExecutionHostAuthenticator();
  readonly enrollments = new ExecutionHostEnrollmentStore();
  readonly registry = new ExecutionHostRegistry();

  connect(
    hello: ExecutionHostHelloPayload,
    connectionId: string,
    transport: ExecutionHostTransport,
  ): void {
    this.authenticator.authenticateHello(hello);
    this.registry.connect(hello, connectionId, transport);
  }

  handleMessage(
    hostId: string,
    connectionId: string,
    message: ClientExecutionHostMessage,
  ): void {
    this.registry.handleMessage(hostId, connectionId, message);
  }
}

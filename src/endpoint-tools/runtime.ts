import { join } from 'node:path';

import {
  type ClientEndpointMessage,
  type EndpointHelloPayload,
} from '@xopcai/endpoint-tools-protocol';

import { resolveStateDir } from '../config/paths.js';
import {
  bindEndpointPrincipal,
  deleteEndpointSessionBinding,
  finishEndpointToolInvocationAudit,
  getEndpointPrincipal,
  getEndpointSessionBinding,
  startEndpointToolInvocationAudit,
  setEndpointSessionBinding,
  touchEndpointPrincipal,
} from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import { EndpointAuthenticator, type EndpointAuthenticatorDeps } from './auth.js';
import { EndpointBindingService } from './binding-service.js';
import {
  EndpointInvocationService,
  type EndpointInvocationAuditSink,
} from './invocation-service.js';
import { EndpointToolPolicy } from './policy.js';
import {
  EndpointRegistry,
  type EndpointRegistration,
  type EndpointTransport,
} from './registry.js';
import { EndpointUploadService } from './upload-service.js';

const log = createLogger('EndpointTools');
const MAX_MESSAGE_CLOCK_SKEW_MS = 60_000;

export class EndpointToolRuntime {
  readonly registry: EndpointRegistry;
  readonly invocations: EndpointInvocationService;
  readonly uploads: EndpointUploadService;
  readonly bindings: EndpointBindingService;

  private readonly authenticator: EndpointAuthenticator;
  private closed = false;

  constructor(options: {
    auth?: EndpointAuthenticatorDeps;
    audit?: EndpointInvocationAuditSink;
    uploadRoot?: string;
  } = {}) {
    const policy = new EndpointToolPolicy();
    this.registry = new EndpointRegistry(policy);
    this.bindings = new EndpointBindingService(this.registry, {
      get: getEndpointSessionBinding,
      set: setEndpointSessionBinding,
      delete: deleteEndpointSessionBinding,
    });
    this.authenticator = new EndpointAuthenticator(options.auth ?? {
      getPrincipal: getEndpointPrincipal,
      bindEndpoint: bindEndpointPrincipal,
      touchPrincipal: touchEndpointPrincipal,
    });
    this.uploads = new EndpointUploadService(
      options.uploadRoot ?? join(resolveStateDir(), 'endpoint-tool-files'),
    );
    this.invocations = new EndpointInvocationService(this.registry, {
      audit: options.audit ?? {
        started: startEndpointToolInvocationAudit,
        finished: finishEndpointToolInvocationAudit,
      },
      uploads: this.uploads,
      policy,
    });
  }

  connect(
    hello: EndpointHelloPayload,
    connectionId: string,
    transport: EndpointTransport,
  ): EndpointRegistration {
    if (this.closed) throw new Error('Endpoint runtime is closed');
    this.authenticator.authenticate(hello);
    const registration = this.registry.register(hello, connectionId, transport);
    log.info({ endpointId: hello.endpointId, connectionId, kind: hello.kind }, 'Endpoint connected');
    return registration;
  }

  handleMessage(endpointId: string, connectionId: string, message: ClientEndpointMessage): void {
    if (!this.registry.isCurrentConnection(endpointId, connectionId)) {
      throw new Error('Endpoint connection is no longer active');
    }
    if (Math.abs(Date.now() - message.sentAt) > MAX_MESSAGE_CLOCK_SKEW_MS) {
      throw new Error('Endpoint message timestamp is outside the allowed window');
    }
    if (message.type === 'endpoint.availability_changed') {
      this.registry.heartbeat(endpointId, connectionId, message.payload.availability);
      return;
    }
    this.invocations.handleMessage(endpointId, message);
  }

  touch(endpointId: string, connectionId: string): void {
    const endpoint = this.registry.get(endpointId);
    if (endpoint?.connectionId === connectionId) {
      this.registry.heartbeat(endpointId, connectionId, endpoint.availability);
    }
  }

  remove(endpointId: string, connectionId: string): void {
    if (!this.registry.remove(endpointId, connectionId)) return;
    this.invocations.failEndpoint(endpointId);
    log.info({ endpointId, connectionId }, 'Endpoint disconnected');
  }

  disconnect(endpointId: string, reason: string): void {
    this.registry.disconnect(endpointId, 4003, reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.invocations.close();
    this.registry.closeAll();
  }
}

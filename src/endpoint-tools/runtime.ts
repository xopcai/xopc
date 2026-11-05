import { join } from 'node:path';
import type { DeviceInteractionCheckpoint } from '@xopcai/gateway-contract';

import {
  type ClientEndpointMessage,
  type EndpointHelloPayload,
  type EndpointDesktopExecutionAuthority,
} from '@xopcai/endpoint-tools-protocol';

import { recordDeviceGrantEvent } from '../storage/sqlite/device-grant-audit-repository.js';
import { resolveStateDir } from '../config/paths.js';
import {
  bindEndpointPrincipal,
  finishEndpointToolInvocationAudit,
  getEndpointPrincipal,
  startEndpointToolInvocationAudit,
  touchEndpointPrincipal,
  deleteBrowserTabBindingsByEndpoint,
} from '../storage/sqlite/index.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';
import { findSessionInputByRunId } from '../storage/sqlite/session-input-repository.js';
import { readSessionInputControl } from '../storage/sqlite/session-input-control-repository.js';
import { createLogger } from '../utils/logger.js';
import { EndpointAuthenticator, type EndpointAuthenticatorDeps } from './auth.js';
import { DeviceGrantService } from './grant-service.js';
import { EndpointTaskTargetService, type EndpointExecutionTarget } from './task-targets.js';
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
import { EndpointContextStore } from './context-store.js';
import { LocationSharingService } from './location-sharing.js';
import { DesktopTerminalGatewayBroker } from './terminal-broker.js';
import { ProviderOperationStatusService } from './provider-operation-status.js';
import { EndpointProviderCatalog } from './provider-catalog.js';
import { currentDeviceExecutionActor } from './execution-actor.js';

const log = createLogger('EndpointTools');
const MAX_MESSAGE_CLOCK_SKEW_MS = 60_000;

export class EndpointToolRuntime {
  readonly registry: EndpointRegistry;
  readonly contexts: EndpointContextStore;
  readonly locations: LocationSharingService;
  readonly grants: DeviceGrantService;
  readonly invocations: EndpointInvocationService;
  readonly uploads: EndpointUploadService;
  readonly targets: EndpointTaskTargetService;
  readonly terminals: DesktopTerminalGatewayBroker;
  readonly providers: EndpointProviderCatalog;
  readonly providerOperations: ProviderOperationStatusService;

  private readonly authenticator: EndpointAuthenticator;
  private readonly providerMessageBudget = new Map<string, { startedAt: number; count: number }>();
  private closed = false;

  constructor(options: {
    auth?: EndpointAuthenticatorDeps;
    audit?: EndpointInvocationAuditSink;
    uploadRoot?: string;
  } = {}) {
    const policy = new EndpointToolPolicy();
    this.registry = new EndpointRegistry(policy);
    this.providers = new EndpointProviderCatalog(this.registry);
    this.providerOperations = new ProviderOperationStatusService(this.registry);
    this.contexts = new EndpointContextStore(this.registry);
    this.locations = new LocationSharingService(this.registry, this.contexts);
    this.grants = new DeviceGrantService(this.registry, Date.now, recordDeviceGrantEvent);
    this.targets = new EndpointTaskTargetService(this.registry, id => getSessionMetadata(id)?.transcriptId,
      id => currentDeviceExecutionActor(id)?.principalId, new DurableState<EndpointExecutionTarget>('device.task-targets'));
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
      authorizeProvider: (endpointId, toolName) => this.providers.assertExecutable(endpointId, toolName),
      authorizeInteractionRecovery: (origin, endpointId) => {
        if (getSessionMetadata(origin.conversationId)?.transcriptId !== origin.transcriptId) return false;
        const actor = currentDeviceExecutionActor(origin.conversationId, origin.runId);
        const target = this.targets.get(origin.conversationId);
        const input = findSessionInputByRunId(origin.conversationId, origin.runId);
        return actor?.kind === 'owner' && actor.principalId === origin.actorPrincipalId && actor.scopes.includes('gateway.admin')
          && !!input && input.status !== 'cancelled' && !readSessionInputControl(origin.conversationId).paused
          && target?.executionRef === origin.targetRef && (!target || target.endpointId === endpointId && target.expiresAt > Date.now());
      },
    });
    this.terminals = new DesktopTerminalGatewayBroker(this.registry, this.invocations);
    this.registry.onChange((endpointId, reason) => {
      if (reason === 'authorization') this.invocations.invalidateContracts(endpointId);
    });
  }

  setProvidersEnabled(enabled: boolean): void {
    this.providers.setEnabled(enabled);
    if (!enabled) this.invocations.discardDetachedInteractions();
  }

  connect(
    hello: EndpointHelloPayload,
    connectionId: string,
    transport: EndpointTransport,
    executionAuthority?: EndpointDesktopExecutionAuthority,
  ): EndpointRegistration {
    if (this.closed) throw new Error('Endpoint runtime is closed');
    this.authenticator.authenticate(hello);
    if (hello.execution && !executionAuthority) throw new Error('DESKTOP_EXECUTION_AUTHORITY_REQUIRED');
    const previous = this.registry.get(hello.endpointId);
    const registration = this.registry.register(hello, connectionId, transport, Date.now(), executionAuthority);
    if (previous) {
      this.providers.disconnect(previous.endpointId, previous.connectionId);
      this.providerOperations.disconnect(previous.endpointId, previous.connectionId);
      this.grants.revokeEndpoint(previous.endpointId, previous.principalId);
      this.invocations.failEndpoint(previous.endpointId);
    }
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
    if (message.type.startsWith('provider.')) {
      const now = Date.now(), previous = this.providerMessageBudget.get(connectionId);
      const budget = previous && now - previous.startedAt < 10_000 ? previous : { startedAt: now, count: 0 };
      if (++budget.count > 128) throw new Error('PROVIDER_MESSAGE_RATE_LIMITED');
      this.providerMessageBudget.set(connectionId, budget);
    }
    if (message.type === 'endpoint.availability_changed') {
      this.registry.heartbeat(endpointId, connectionId, message.payload.availability);
      return;
    }
    if (message.type === 'provider.catalog.replace') {
      const { revision } = message.payload;
      try {
        this.providers.replace(endpointId, connectionId, message.payload);
      } catch (err) {
        const reason = err instanceof Error ? err.message : '';
        const code = reason === 'PROVIDER_CATALOG_RATE_LIMITED' || reason === 'PROVIDER_CATALOG_REVISION_CONFLICT'
          || reason === 'PROVIDER_CONNECTION_CONFLICT' ? reason : 'PROVIDER_CATALOG_REJECTED';
        log.warn({ endpointId, connectionId, revision, code }, 'Provider catalog rejected');
        this.registry.send(endpointId, 'provider.catalog.ack', { revision, accepted: false, code });
        return;
      }
      this.registry.send(endpointId, 'provider.catalog.ack', { revision, accepted: true });
      return;
    }
    if (message.type === 'provider.state.changed') {
      this.providers.reportState(endpointId, connectionId, message.payload);
      return;
    }
    if (message.type === 'provider.operation.status') { this.providerOperations.receive(endpointId, connectionId, message.payload); return; }
    if (message.type === 'provider.interaction.request') { this.invocations.requestInteraction(endpointId, message.payload); return; }
    if (message.type === 'terminal.event' && this.registry.get(endpointId)?.terminalVersion !== 1) throw new Error('DESKTOP_TERMINAL_NOT_NEGOTIATED');
    this.invocations.handleMessage(endpointId, message);
  }

  canResumeDeviceInteraction(conversationId: string, checkpoint: DeviceInteractionCheckpoint): boolean {
    const target = this.targets.get(conversationId);
    if (!target || target.actorPrincipalId !== checkpoint.actorPrincipalId || target.expiresAt <= Date.now()
      || target.endpointId !== checkpoint.endpointId || target.principalId !== checkpoint.principalId) return false;
    const endpoint = this.registry.get(target.endpointId);
    if (endpoint?.connectionId !== target.connectionId
      || this.registry.getTool(target.endpointId, checkpoint.toolName)?.provider?.digest !== checkpoint.providerDigest) return false;
    try { this.providers.assertExecutable(target.endpointId, checkpoint.toolName); return true; }
    catch { return false; }
  }

  touch(endpointId: string, connectionId: string): void {
    const endpoint = this.registry.get(endpointId);
    if (endpoint?.connectionId === connectionId) {
      this.registry.heartbeat(endpointId, connectionId, endpoint.availability);
    }
  }

  remove(endpointId: string, connectionId: string): void {
    this.providerMessageBudget.delete(connectionId);
    const principalId = this.registry.get(endpointId)?.principalId;
    if (!this.registry.remove(endpointId, connectionId)) return;
    this.providers.disconnect(endpointId, connectionId);
    this.providerOperations.disconnect(endpointId, connectionId);
    this.grants.revokeEndpoint(endpointId, principalId);
    this.invocations.failEndpoint(endpointId);
    deleteBrowserTabBindingsByEndpoint(endpointId);
    log.info({ endpointId, connectionId }, 'Endpoint disconnected');
  }

  disconnect(endpointId: string, reason: string): void {
    this.grants.revokeEndpoint(endpointId);
    this.registry.disconnect(endpointId, 4003, reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.providerMessageBudget.clear();
    this.terminals.close();
    this.providerOperations.close();
    this.grants.close();
    this.invocations.close();
    this.uploads.close();
    this.contexts.close();
    void this.locations.close();
    this.registry.closeAll();
  }
}

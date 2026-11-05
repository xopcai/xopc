import { randomUUID } from 'node:crypto';

import type { ClientEndpointMessage, ProviderOperationReceipt } from '@xopcai/endpoint-tools-protocol';

import { parseExternalToolRef } from '../agent/external-tools/refs.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import type { EndpointRegistry } from './registry.js';

type StatusMessage = Extract<ClientEndpointMessage, { type: 'provider.operation.status' }>['payload'];
type Operation = { principal_id: string; capability_id: string; descriptor_digest: string; request_digest: string; state: string };
type Pending = { endpointId: string; connectionId: string; operationId: string; providerDigest: string; argumentsDigest: string;
  timer: ReturnType<typeof setTimeout>; complete(receipt?: ProviderOperationReceipt): void };

/** Read-only reconciliation. A receipt never replays a write or reconstructs a missing payload. */
export class ProviderOperationStatusService {
  private readonly pending = new Map<string, Pending>();
  private readonly evidence = new DurableState<ProviderOperationReceipt>('device.operation-receipts');
  constructor(private readonly registry: EndpointRegistry) {}

  async query(operationId: string) {
    const operation = getSqliteDatabase().prepare(`SELECT principal_id, capability_id, descriptor_digest, request_digest, state
      FROM capability_operations WHERE operation_id=?`).get(operationId) as Operation | undefined;
    if (!operation) return;
    const ref = parseExternalToolRef(operation.capability_id, 'endpoint');
    if (!ref?.namespace.startsWith(operation.principal_id + '/')) return;
    const providerId = ref.namespace.slice(operation.principal_id.length + 1);
    const endpoint = this.registry.list().find(endpoint => endpoint.principalId === operation.principal_id
      && endpoint.tools.some(tool => tool.provider?.localId === providerId && tool.provider.name === ref.toolName && tool.provider.durableOperations === 1));
    const previous = this.evidence.get(operationId);
    if (!endpoint || this.pending.size >= 32) return { operationId, gatewayState: operation.state, deviceStatus: 'unavailable', receipt: previous };
    const requestId = randomUUID();
    const receipt = await new Promise<ProviderOperationReceipt | undefined>(resolve => {
      this.pending.set(requestId, { endpointId: endpoint.endpointId, connectionId: endpoint.connectionId, operationId,
        providerDigest: operation.descriptor_digest, argumentsDigest: operation.request_digest, complete: resolve,
        timer: setTimeout(() => this.finish(requestId), 3_000) });
      try { this.registry.send(endpoint.endpointId, 'provider.operation.query', { requestId, operationId, providerDigest: operation.descriptor_digest }); }
      catch { this.finish(requestId); }
    });
    const latest = this.evidence.get(operationId);
    if (receipt && receipt.state !== 'running' && latest?.state !== 'succeeded') this.evidence.set(operationId, receipt);
    return { operationId, gatewayState: operation.state, deviceStatus: receipt ? 'recorded' : 'unavailable', receipt: latest?.state === 'succeeded' ? latest : receipt ?? latest };
  }

  receive(endpointId: string, connectionId: string, message: StatusMessage): void {
    const pending = this.pending.get(message.requestId), receipt = message.receipt;
    if (!pending || pending.endpointId !== endpointId || pending.connectionId !== connectionId
      || pending.operationId !== message.operationId || pending.providerDigest !== message.providerDigest) return;
    if (receipt && (receipt.intent.operationId !== pending.operationId || receipt.intent.providerDigest !== pending.providerDigest
      || receipt.intent.argumentsDigest !== pending.argumentsDigest)) return;
    this.finish(message.requestId, receipt);
  }

  disconnect(endpointId: string, connectionId: string): void {
    for (const [id, pending] of this.pending) if (pending.endpointId === endpointId && pending.connectionId === connectionId) this.finish(id);
  }

  close(): void { for (const id of this.pending.keys()) this.finish(id); }

  private finish(id: string, receipt?: ProviderOperationReceipt): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id); clearTimeout(pending.timer); pending.complete(receipt);
  }
}

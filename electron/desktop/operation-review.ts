import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson, desktopWorkspaceDescriptor, desktopOperationIntentSchema, desktopOperationReceiptSchema, desktopOperationReviewSchema,
  type DesktopOperationIntent, type DesktopOperationReceipt } from '@xopcai/endpoint-tools-protocol';
import { endpointToolRevision } from '@xopcai/endpoint-tools-client';
import { z } from 'zod';

import type { GatewayConnectionPreview } from '../gateway/connection-manager.js';
import { isConnectionId } from '../gateway/profiles.js';
import { DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR } from './clipboard-tool.js';
import { DesktopDeviceAuth } from './device-auth.js';
import { DesktopIdentityStore, type DesktopBinding } from './device-identity.js';
import { desktopAuthTransport } from './device-transport.js';
import type { DesktopExecutionManager } from './execution-manager.js';
import { DesktopExecutionLease, DesktopOperationJournal } from './operation-journal.js';

const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const pendingSchema = z.strictObject({ intent: desktopOperationIntentSchema, generation, receipt: desktopOperationReceiptSchema.optional() });
const recordSchema = z.strictObject({ intent: desktopOperationIntentSchema, generation, state: z.enum(['running', 'unknown', 'failed', 'succeeded']), review: desktopOperationReviewSchema.optional() });
const finiteOperation = (intent: DesktopOperationIntent) => intent.tool === DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR.name && intent.toolRevision === endpointToolRevision(DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR)
  || intent.tool === 'desktop.workspace.write' && Boolean(intent.workspaceId) && intent.toolRevision === endpointToolRevision(desktopWorkspaceDescriptor('write', intent.workspaceId));

/** Only the trusted connection window can request a native human review; Agent tools cannot acknowledge unknown outcomes. */
export class DesktopOperationReviewManager {
  private active?: AbortController;
  constructor(private readonly options: {
    manager: GatewayConnectionPreview; execution: DesktopExecutionManager; store: DesktopIdentityStore; executorRoot: string;
    visible(): boolean;
    confirm(binding: Pick<DesktopBinding, 'gatewayId' | 'origin'> & { offline?: true }, intent: DesktopOperationIntent, receipt: DesktopOperationReceipt | undefined, signal: AbortSignal): Promise<boolean>;
  }) {}
  cancel(): void { this.active?.abort(); }
  private async withClient<T>(epoch: unknown, id: unknown, work: (client: DesktopDeviceAuth, binding: DesktopBinding, signal: AbortSignal, current: () => void) => Promise<T>): Promise<T> {
    if (this.active) throw new Error('DESKTOP_OPERATION_BUSY');
    const state = this.options.manager.snapshot();
    if (!isConnectionId(id) || epoch !== state.epoch || id !== state.selectedId) throw new Error('STALE_CONNECTION_EPOCH');
    const profile = state.profiles.find(profile => profile.id === id);
    if (!profile?.identity) throw new Error('DESKTOP_PINNED_GATEWAY_REQUIRED');
    const binding = { profileId: id, origin: profile.origin, ...profile.identity }, controller = new AbortController(); this.active = controller;
    const channel = desktopAuthTransport(binding, profile.transport, controller.signal), client = new DesktopDeviceAuth(binding, this.options.store, channel.request);
    const current = () => { if (controller.signal.aborted || this.options.manager.snapshot().epoch !== epoch || this.options.manager.snapshot().selectedId !== id) throw new Error('DESKTOP_OPERATION_CANCELLED'); };
    try {
      const compatibility = await client.endpointRequest('/api/desktop-host/compatibility', 'GET'); current();
      if (compatibility?.gatewayId !== binding.gatewayId || compatibility.publicKey !== binding.publicKey || compatibility.capabilities?.operationReviewVersion !== 1) throw new Error('DESKTOP_OPERATION_REVIEW_UNSUPPORTED');
      return await work(client, binding, controller.signal, current);
    } finally { channel.close(); if (this.active === controller) this.active = undefined; }
  }
  private async local<T>(epoch: unknown, work: (journal: DesktopOperationJournal, signal: AbortSignal, current: () => void) => Promise<T>): Promise<T> {
    if (this.active) throw new Error('DESKTOP_OPERATION_BUSY');
    if (epoch !== this.options.manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
    if (!this.options.visible()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
    const controller = new AbortController(); this.active = controller;
    let lease: DesktopExecutionLease | undefined, journal: DesktopOperationJournal | undefined;
    const current = () => { if (controller.signal.aborted || epoch !== this.options.manager.snapshot().epoch) throw new Error('DESKTOP_OPERATION_CANCELLED'); };
    try {
      await this.options.execution.requireStopped(); current();
      lease = new DesktopExecutionLease(this.options.executorRoot); journal = new DesktopOperationJournal(lease);
      return await work(journal,controller.signal,current);
    } finally { journal?.close(); lease?.close(); if (this.active === controller) this.active = undefined; }
  }
  listLocal(epoch: unknown) {
    return this.local(epoch, async journal => journal.unresolved());
  }
  reviewLocal(epoch: unknown, operationId: unknown) {
    if (!z.uuid().safeParse(operationId).success) return Promise.reject(new Error('DESKTOP_OPERATION_IDENTITY_MISMATCH'));
    return this.local(epoch, async (journal,signal,current) => {
      const item = journal.unresolved().find(item => item.operationId === operationId), intent = item?.intent;
      if (!intent) throw new Error('DESKTOP_OPERATION_CONTEXT_UNAVAILABLE');
      let receipt = journal.inspect(intent);
      if (!receipt) throw new Error('DESKTOP_OPERATION_CONTEXT_UNAVAILABLE');
      const finite = finiteOperation(intent);
      if (!receipt.executionStopped) {
        if (!finite) throw new Error('DESKTOP_EXECUTION_STOP_UNCONFIRMED');
        receipt = journal.confirmUnknownStopped(intent);
      }
      const profile = this.options.manager.snapshot().profiles.find(profile => profile.identity?.gatewayId === intent.gatewayId);
      if (!await this.options.confirm({ gatewayId: intent.gatewayId, origin: profile?.origin ?? '原Gateway地址不可用', offline: true }, structuredClone(intent), structuredClone(receipt), signal)) throw new Error('DESKTOP_LOCAL_CONSENT_DENIED');
      current(); if (!this.options.visible()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
      // Desktop writes use manual recovery: only first-generation manual intents; the original server must still verify an offline acknowledgement.
      journal.review(intent, desktopOperationReviewSchema.parse({ reviewId: randomUUID(), expectedGeneration: 1,
        intentFingerprint: createHash('sha256').update(JSON.stringify(intent)).digest('hex'), executorStopped: true, localStatus: 'recorded', receipt }));
      return { operationId, locallyReviewed: true, serverConfirmed: false, outcome: 'unknown' };
    });
  }
  list(epoch: unknown, id: unknown) {
    return this.withClient(epoch, id, async (client, binding, _signal, current) => {
      const identity = await client.readSelf(); current();
      const response = z.strictObject({ items: z.array(pendingSchema).max(8) }).parse(await client.endpointRequest('/api/desktop-host/operations', 'GET', undefined, identity.deviceId)); current();
      if (response.items.some(item => item.intent.gatewayId !== binding.gatewayId || item.intent.deviceId !== identity.deviceId)) throw new Error('DESKTOP_DEVICE_IDENTITY_MISMATCH');
      return response.items;
    });
  }
  review(epoch: unknown, id: unknown, operationId: unknown) {
    if (!z.uuid().safeParse(operationId).success) return Promise.reject(new Error('DESKTOP_OPERATION_IDENTITY_MISMATCH'));
    return this.withClient(epoch, id, async (client, binding, signal, current) => {
      if (!this.options.visible()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
      await this.options.execution.requireStopped(); current();
      const identity = await client.readSelf(); current();
      const record = recordSchema.parse(await client.endpointRequest(`/api/desktop-host/operations/${operationId}`, 'GET', undefined, identity.deviceId)); current();
      const intent = record.intent;
      if (intent.operationId !== operationId || intent.gatewayId !== binding.gatewayId || intent.deviceId !== identity.deviceId) throw new Error('DESKTOP_DEVICE_IDENTITY_MISMATCH');
      const lease = new DesktopExecutionLease(this.options.executorRoot);
      let journal: DesktopOperationJournal | undefined;
      try {
        journal = new DesktopOperationJournal(lease);
        const previous = journal.reviewed(intent);
        let review = previous;
        if (record.review) {
          if (!previous || canonicalJson(previous) !== canonicalJson(record.review)) throw new Error('DESKTOP_OPERATION_REVIEW_CONFLICT');
          return { operationId, reviewed: true, outcome: record.state };
        }
        if (record.state !== 'unknown' || previous && previous.expectedGeneration !== record.generation) throw new Error('DESKTOP_OPERATION_REVIEW_CONFLICT');
        if (!review) {
          let receipt = journal.inspect(intent);
          const finiteExecutor = finiteOperation(intent);
          if ((!receipt || !receipt.executionStopped) && !finiteExecutor) throw new Error('DESKTOP_EXECUTION_STOP_UNCONFIRMED');
          // Independent stop evidence: the fixed-root lease and this known no-child-process adapter; a human click never proves stop.
          if (receipt && !receipt.executionStopped) receipt = journal.confirmUnknownStopped(intent);
          if (!await this.options.confirm(binding, structuredClone(intent), receipt && structuredClone(receipt), signal)) throw new Error('DESKTOP_LOCAL_CONSENT_DENIED');
          current(); if (!this.options.visible()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
          review = desktopOperationReviewSchema.parse({ reviewId: randomUUID(), expectedGeneration: record.generation,
            intentFingerprint: createHash('sha256').update(JSON.stringify(intent)).digest('hex'), executorStopped: true,
            localStatus: receipt ? 'recorded' : 'not-found', ...(receipt ? { receipt } : {}) });
          journal.review(intent, review);
        }
        current();
        const response = await client.endpointRequest(`/api/desktop-host/operations/${operationId}/review`, 'POST', review, identity.deviceId); current();
        if (response?.operationId !== operationId || response.reviewId !== review.reviewId || response.reviewed !== true || response.outcome !== 'unknown') throw new Error('DESKTOP_OPERATION_REVIEW_CONFLICT');
        return response;
      } finally { journal?.close(); lease.close(); }
    });
  }
}

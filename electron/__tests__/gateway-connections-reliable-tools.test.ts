import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { endpointToolRevision } from '@xopcai/endpoint-tools-client';
import { ENDPOINT_TEXT_OUTPUT_SCHEMA, canonicalJson, clientEndpointMessageSchema,
  type ClientEndpointMessage, type EndpointToolDescriptor } from '@xopcai/endpoint-tools-protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DesktopExecutionSession } from '../desktop/execution-session.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../desktop/operation-journal.js';
import { DesktopOperationSupervisor, type DesktopExecutionWorker } from '../desktop/operation-supervisor.js';
import { DesktopReliableToolController } from '../desktop/reliable-tool-controller.js';
import { DesktopExecutionCatalog } from '../desktop/execution-catalog.js';

const descriptor: EndpointToolDescriptor = { name: 'fixture.write', title: 'Fixture', description: 'Fixture write', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA, policyId: 'user.foreground-write', sensitivity: 'personal', effect: 'write', confirmation: 'always',
  requiresForeground: true, requiredPermissions: ['fixture'], timeoutMs: 10000, maxConcurrency: 1, supportsCancellation: true, idempotent: false, resultKinds: ['text'] };
let root: string, lease: DesktopExecutionLease, journal: DesktopOperationJournal, controller: DesktopReliableToolController;
let worker: DesktopExecutionWorker, frames: ClientEndpointMessage[], request: any;
let failResultDelivery: boolean, foreground: boolean;
const confirm = vi.fn(async () => true), transportFailure = vi.fn();
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xopc-reliable-controller-')); lease = new DesktopExecutionLease(root); journal = new DesktopOperationJournal(lease);
  const authority = { gatewayId: randomUUID(), deviceId: randomUUID(), authorizationRevision: 1, expiresAt: Date.now() + descriptor.timeoutMs, toolRevision: endpointToolRevision(descriptor), active: true };
  const args = { text: 'fixture' }, intent = { operationId: randomUUID(), gatewayId: authority.gatewayId, deviceId: authority.deviceId, authorizationRevision: 1,
    tool: descriptor.name, toolRevision: authority.toolRevision, expiresAt: authority.expiresAt, argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex') };
  request = { protocolVersion: 2, messageId: randomUUID(), type: 'tool.invoke', sentAt: Date.now(), payload: { invocationId: randomUUID(), toolCallId: 'fixture',
    toolName: descriptor.name, descriptorRevision: authority.toolRevision, arguments: args, confirmationRequired: true, deadlineAt: intent.expiresAt, execution: intent } };
  worker = { run: vi.fn(async () => ({ status: 'succeeded', result: { content: [{ type: 'text', text: 'written' }] } })), stop: vi.fn(async () => ({ confirmed: true })) };
  const catalog = new DesktopExecutionCatalog([descriptor]);
  const supervisor = new DesktopOperationSupervisor({ journal, authority: () => authority, createWorker: () => worker,
    validateResult: catalog.validateResult, stopTimeoutMs: 25 });
  confirm.mockReset().mockResolvedValue(true); transportFailure.mockReset();
  const session = new DesktopExecutionSession({ binding: { gatewayId: authority.gatewayId, deviceId: authority.deviceId, authorizationRevision: 1,
    clientId: randomUUID(), connectionInstanceId: randomUUID() }, supervisor, confirm });
  foreground = true;
  controller = new DesktopReliableToolController({ session, catalog, availability: () => foreground ? 'foreground' : 'background', onTransportFailure: transportFailure });
  frames = []; failResultDelivery = false; controller.connect(message => {
    if (failResultDelivery && message.type === 'tool.result') throw new Error('Injected transport failure');
    frames.push(clientEndpointMessageSchema.parse(message));
  });
});
afterEach(async () => { await controller.disconnect(); journal.close(); lease.close(); rmSync(root, { recursive: true, force: true }); });
const cancel = () => ({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), type: 'tool.cancel', payload: { invocationId: request.payload.invocationId, reason: 'fixture' } });

it('rejects terminal commands instead of executing them through the ordinary reliable controller', async () => {
  await controller.handleMessage({ protocolVersion: 2, messageId: randomUUID(), type: 'terminal.command', sentAt: Date.now(),
    payload: { invocationId: request.payload.invocationId, command: { action: 'close', sessionId: randomUUID(), generation: randomUUID(), connectionInstanceId: randomUUID() } } });
  expect(worker.run).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  expect(frames).toMatchObject([{ type: 'tool.error', payload: { code: 'PROTOCOL_ERROR' } }]);
});

it('returns one persisted completion receipt and refuses to replay an existing result body or action', async () => {
  await controller.handleMessage(request);
  expect(frames.map(frame => frame.type)).toEqual(['tool.received', 'tool.result']);
  expect(frames[1]).toMatchObject({ payload: { operationReceipt: { state: 'succeeded', executionStopped: true }, content: [{ text: 'written' }] } });
  await controller.handleMessage({ ...request, payload: { ...request.payload, invocationId: randomUUID() } });
  expect(frames.at(-1)).toMatchObject({ type: 'tool.error', payload: { code: 'OUTCOME_UNKNOWN', operationReceipt: { state: 'succeeded' } } });
  expect(worker.run).toHaveBeenCalledTimes(1); expect(confirm).toHaveBeenCalledTimes(1);
});

it('does not turn cancel into confirmed stop until the worker acknowledgement is persisted', async () => {
  const started = Promise.withResolvers<void>(), stopped = Promise.withResolvers<{ confirmed: boolean }>();
  worker.run = vi.fn(async () => { started.resolve(); return new Promise(() => {}); }); worker.stop = vi.fn(() => stopped.promise);
  const pending = controller.handleMessage(request); await started.promise;
  const cancellation = controller.handleMessage(cancel()); await Promise.resolve();
  expect(frames.map(frame => frame.type)).toEqual(['tool.received']);
  stopped.resolve({ confirmed: true }); await cancellation; await pending;
  expect(frames).toHaveLength(2); expect(frames[1]).toMatchObject({ type: 'tool.cancelled', payload: { operationReceipt: { state: 'stopped', executionStopped: true } } });
});

it('reports completed failure evidence separately from unknown or stopped execution', async () => {
  worker.run = vi.fn(async () => ({ status: 'failed', result: { content: [{ type: 'text', text: 'fixture failure' }] } }));
  await controller.handleMessage(request);
  expect(frames.at(-1)).toMatchObject({ type: 'tool.error', payload: { code: 'TOOL_EXECUTION_FAILED', operationReceipt: { state: 'failed', executionStopped: true }, operationResult: { content: [{ text: 'fixture failure' }] } } });
});

it('blocks a new intent after an unconfirmed stop without asking for another native approval', async () => {
  const started = Promise.withResolvers<void>(); worker.run = vi.fn(async () => { started.resolve(); return new Promise(() => {}); });
  worker.stop = vi.fn(async () => ({ confirmed: false }));
  const pending = controller.handleMessage(request); await started.promise; await controller.handleMessage(cancel()); await pending;
  expect(frames.at(-1)).toMatchObject({ payload: { code: 'OUTCOME_UNKNOWN', operationReceipt: { state: 'unknown', executionStopped: false } } });
  await controller.handleMessage({ ...request, payload: { ...request.payload, invocationId: randomUUID(), execution: { ...request.payload.execution, operationId: randomUUID() } } });
  expect(frames.at(-1)).toMatchObject({ payload: { code: 'EXECUTION_STOP_UNCONFIRMED' } }); expect(confirm).toHaveBeenCalledTimes(1); expect(worker.run).toHaveBeenCalledTimes(1);
});

it('disconnects during an unresolved native approval without starting or emitting a late result', async () => {
  confirm.mockImplementation(async () => new Promise(() => {}));
  const pending = controller.handleMessage(request); await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  await controller.disconnect(); await pending; expect(worker.run).not.toHaveBeenCalled(); expect(frames.map(frame => frame.type)).toEqual(['tool.received']);
});

it('rejects invalid result contracts before recording a successful operation', async () => {
  worker.run = vi.fn(async () => ({ status: 'succeeded', result: { content: [{ type: 'text', text: 'done' }], afterSend: () => {} } }));
  await controller.handleMessage(request);
  expect(journal.inspect(request.payload.execution)).toMatchObject({ state: 'unknown' });
  expect(frames.at(-1)).toMatchObject({ payload: { code: 'OUTCOME_UNKNOWN', operationReceipt: { state: 'unknown' } } });
});

it('validates the actual tool input and output schemas locally, before approval or successful persistence', async () => {
  await controller.handleMessage({ ...request, payload: { ...request.payload, arguments: { text: 42 } } });
  expect(frames.at(-1)).toMatchObject({ payload: { code: 'INVALID_ARGUMENTS' } }); expect(confirm).not.toHaveBeenCalled();
  worker.run = vi.fn(async () => ({ status: 'succeeded', result: { content: [{ type: 'json', value: { wrong: true } }] } }));
  await controller.handleMessage(request);
  expect(journal.inspect(request.payload.execution)).toMatchObject({ state: 'unknown' });
});

it('does not retry a failed result delivery or convert durable success into another terminal response', async () => {
  failResultDelivery = true; await controller.handleMessage(request);
  expect(frames.map(frame => frame.type)).toEqual(['tool.received']); expect(transportFailure).toHaveBeenCalledOnce();
  expect(journal.inspect(request.payload.execution)).toMatchObject({ state: 'succeeded', executionStopped: true });
  await controller.handleMessage({ ...request, payload: { ...request.payload, invocationId: randomUUID() } });
  expect(worker.run).toHaveBeenCalledOnce(); expect(frames).toHaveLength(1);
});

it('rejects overlong deadlines and rechecks foreground after native approval before starting', async () => {
  await controller.handleMessage({ ...request, payload: { ...request.payload, deadlineAt: Date.now() + descriptor.timeoutMs + 1000 } });
  expect(frames.at(-1)).toMatchObject({ payload: { code: 'TOOL_TIMEOUT' } }); expect(confirm).not.toHaveBeenCalled();
  confirm.mockImplementation(async () => { foreground = false; return true; });
  await controller.handleMessage(request);
  expect(frames.at(-1)).toMatchObject({ payload: { code: 'ENDPOINT_NOT_FOREGROUND' } }); expect(worker.run).not.toHaveBeenCalled();
});

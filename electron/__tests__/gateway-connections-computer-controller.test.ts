import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REMOTE_COMPUTER_CONTROL_TOOL, REMOTE_COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { canonicalJson, type ClientEndpointMessage, type DesktopExecutionRequest } from '@xopcai/endpoint-tools-protocol';
import { expect, it, vi } from 'vitest';

import { DesktopComputerHostController } from '../desktop/computer-host-controller.js';
import { DesktopComputerSession } from '../desktop/computer-session.js';
import { DesktopExecutionSession } from '../desktop/execution-session.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../desktop/operation-journal.js';
import { DesktopOperationSupervisor } from '../desktop/operation-supervisor.js';
import { DesktopExecutionCatalog } from '../desktop/execution-catalog.js';
import { DesktopReliableToolController } from '../desktop/reliable-tool-controller.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xopc-computer-controller-'));
  const lease = new DesktopExecutionLease(root), journal = new DesktopOperationJournal(lease);
  const gatewayId = randomUUID(), deviceId = randomUUID(), connectionInstanceId = randomUUID();
  let controller!: DesktopComputerHostController, current = true, toolRevision = 'a'.repeat(64);
  const confirm = vi.fn(async () => true), frame = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' as const };
  const command = vi.fn(async () => ({ status: 'ready' as const, sessionId: 'session', brokerEpoch: randomUUID(), generation: 1, frame }));
  const dispose = vi.fn(async () => {});
  const supervisor = new DesktopOperationSupervisor({ journal, authority: () => ({ gatewayId, deviceId, authorizationRevision: 1, toolRevision, active: current, expiresAt: Date.now() + 120000 }), createWorker: (_tool, intent) => controller.workerFor(intent) });
  const execution = new DesktopExecutionSession({ binding: { gatewayId, deviceId, clientId: randomUUID(), connectionInstanceId, authorizationRevision: 1 }, supervisor, confirm });
  const uploadFrame = vi.fn(async (_request: DesktopExecutionRequest, _grant: unknown, frame: { bytes: Uint8Array }) => ({ type: 'file' as const, fileId: randomUUID(), name: 'observation.png', mimeType: 'image/png', size: frame.bytes.length, sha256: createHash('sha256').update(frame.bytes).digest('hex') }));
  controller = new DesktopComputerHostController({ current: () => current, execution,
    createSession: upload => new DesktopComputerSession({ current: () => current, createBroker: () => ({ command, dispose }), uploadFrame: upload }), uploadFrame });
  const args = { op: 'observe', owner: 'conversation', sessionId: 'session' };
  const invocationId = randomUUID(), deadlineAt = Date.now() + 25000;
  const request = { invocationId, toolCallId: 'fixture-call', toolName: REMOTE_COMPUTER_CONTROL_TOOL, arguments: args,
    descriptorRevision: 'a'.repeat(64), confirmationRequired: true, deadlineAt,
    execution: { operationId: randomUUID(), gatewayId, deviceId, tool: REMOTE_COMPUTER_CONTROL_TOOL, argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex'), toolRevision: 'a'.repeat(64), authorizationRevision: 1, expiresAt: deadlineAt },
    uploadGrant: { path: `/api/endpoint-tools/invocations/${invocationId}/files`, token: 'fixture-upload-token', maxBytes: 5 * 1024 * 1024, maxFiles: 1, expiresAt: deadlineAt } };
  const catalog = new DesktopExecutionCatalog([REMOTE_COMPUTER_DESCRIPTOR as never]);
  request.descriptorRevision = catalog.revision(REMOTE_COMPUTER_CONTROL_TOOL)!;
  request.execution.toolRevision = request.descriptorRevision;
  toolRevision = request.descriptorRevision;
  const frames: ClientEndpointMessage[] = [];
  const reliable = new DesktopReliableToolController({ session: execution, catalog, computer: controller, availability: () => current ? 'foreground' : 'background' });
  reliable.connect(message => frames.push(message));
  return { controller, reliable, frames, execution, journal, frame, confirm, command, dispose, uploadFrame, request, revoke: () => { current = false; },
    close: async () => { await reliable.disconnect(); journal.close(); lease.close(); await rm(root, { recursive: true, force: true }); } };
}
it('uses one exact invocation upload grant after native approval and journal start, then wipes the frame', async () => {
  const f = await fixture();
  try {
    f.command.mockImplementationOnce(async () => {
      expect(f.journal.inspect(f.request.execution)?.state).toBe('running');
      expect(f.confirm).toHaveBeenCalledOnce();
      return { status: 'ready', sessionId: 'session', brokerEpoch: randomUUID(), generation: 1, frame: f.frame };
    });
    expect((await f.controller.run(f.request)).receipt.state).toBe('succeeded');
    expect(f.uploadFrame).toHaveBeenCalledOnce();
    expect(f.uploadFrame.mock.calls[0][0].invocationId).toBe(f.request.invocationId);
    expect([...f.frame.bytes]).toEqual([0, 0, 0]);
    expect(() => f.controller.workerFor(f.request.execution)).toThrow('INVOCATION_MISMATCH');
  } finally { await f.close(); }
});
it('rejects foreign upload paths, missing intent and oversized or multi-file grants before native execution', async () => {
  const f = await fixture();
  try {
    for (const patch of [{ uploadGrant: undefined }, { execution: undefined },
      { uploadGrant: { ...f.request.uploadGrant, path: '/api/endpoint-tools/invocations/' + randomUUID() + '/files' } },
      { uploadGrant: { ...f.request.uploadGrant, maxFiles: 2 } },
      { uploadGrant: { ...f.request.uploadGrant, maxBytes: 5 * 1024 * 1024 + 1 } }]) {
      await expect(f.controller.run({ ...f.request, ...patch })).rejects.toThrow();
    }
    expect(f.confirm).not.toHaveBeenCalled(); expect(f.command).not.toHaveBeenCalled(); expect(f.uploadFrame).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
it('treats revocation during an upload as unknown and confirms private broker shutdown without replay', async () => {
  const f = await fixture();
  try {
    f.uploadFrame.mockImplementationOnce(async () => {
      f.revoke();
      return { type: 'file', fileId: randomUUID(), name: 'observation.png', mimeType: 'image/png', size: 3, sha256: 'a'.repeat(64) };
    });
    const result = await f.controller.run(f.request);
    expect(result.receipt.state).toBe('unknown');
    await f.controller.close();
    expect(f.journal.inspect(f.request.execution)).toMatchObject({ state: 'unknown', executionStopped: true });
    expect(f.command).toHaveBeenCalledOnce(); expect(f.dispose).toHaveBeenCalled();
    await expect(f.controller.run(f.request)).rejects.toThrow();
    expect(f.command).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});
it('routes the v2 invocation and its upload through the dedicated adapter and refuses duplicate operation replay', async () => {
  const f = await fixture();
  try {
    const message = { protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), type: 'tool.invoke', payload: f.request };
    await f.reliable.handleMessage(message);
    expect(f.frames.map(frame => frame.type)).toEqual(['tool.received', 'tool.result']);
    expect(f.frames[1]).toMatchObject({ payload: { operationReceipt: { state: 'succeeded', executionStopped: true } } });
    const invocationId = randomUUID();
    await f.reliable.handleMessage({ ...message, messageId: randomUUID(), payload: { ...f.request, invocationId,
      uploadGrant: { ...f.request.uploadGrant, path: `/api/endpoint-tools/invocations/${invocationId}/files` } } });
    expect(f.frames.at(-1)).toMatchObject({ type: 'tool.error', payload: { code: 'OUTCOME_UNKNOWN', operationReceipt: { state: 'succeeded' } } });
    expect(f.command).toHaveBeenCalledOnce(); expect(f.uploadFrame).toHaveBeenCalledOnce(); expect(f.confirm).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

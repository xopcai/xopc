import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJson, desktopOperationReceiptSchema, type ClientEndpointMessage, type DesktopExecutionRequest } from '@xopcai/endpoint-tools-protocol';
import { expect, it } from 'vitest';
import type { WebSocket as Socket } from 'ws';

import { DesktopExecutionSession } from '../../../electron/desktop/execution-session.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../../../electron/desktop/operation-journal.js';
import { DesktopOperationSupervisor } from '../../../electron/desktop/operation-supervisor.js';
import { DesktopDeviceFrameSigner, DesktopDeviceFrameVerifier } from '../../endpoint-tools/desktop-device-frame.js';
import { signDesktopGatewayFrame, verifyDesktopGatewayFrame } from '../../endpoint-tools/desktop-frame.js';

const { WebSocket, WebSocketServer } = createRequire(import.meta.url)('ws') as typeof import('ws');

// Isolated signed transport + supervisor test; no production Gateway grants or native consent are simulated as accepted.
it('preserves a durable write receipt after lost delivery and refuses a second effect over a new signed WS connection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xopc-execution-transport-'));
  const gateway = generateKeyPairSync('ed25519'), device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const gatewayKey = gateway.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const deviceKey = device.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const devicePrivate = device.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const authority = { gatewayId: randomUUID(), deviceId: randomUUID(), authorizationRevision: 1, toolRevision: 'a'.repeat(64), expiresAt: Date.now() + 60000, active: true };
  const args = { text: 'one durable effect\n' }, path = join(root, 'effect.txt');
  const request: DesktopExecutionRequest = { invocationId: randomUUID(), toolCallId: 'fixture', toolName: 'fixture.write', arguments: args,
    descriptorRevision: authority.toolRevision, confirmationRequired: true, deadlineAt: authority.expiresAt,
    execution: { operationId: randomUUID(), gatewayId: authority.gatewayId, deviceId: authority.deviceId,
      authorizationRevision: 1, toolRevision: authority.toolRevision, expiresAt: authority.expiresAt, tool: 'fixture.write',
      argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex') } };
  let lease: DesktopExecutionLease | undefined, journal: DesktopOperationJournal | undefined, session: DesktopExecutionSession | undefined;
  let effects = 0, approvals = 0;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  let client: Socket | undefined, peer: Socket | undefined, signer: DesktopDeviceFrameSigner | undefined;
  const worker = () => ({ run: async (input: Record<string, unknown>) => {
    expect(journal!.inspect(request.execution)?.state).toBe('running');
    const fd = openSync(path, 'a', 0o600);
    try { writeSync(fd, String(input.text)); fsyncSync(fd); } finally { closeSync(fd); }
    effects += 1; return { status: 'succeeded' as const, result: { written: true } };
  }, stop: async () => ({ confirmed: true }) });
  try {
    for (const attempt of [0, 1]) {
      const binding = { gatewayId: authority.gatewayId, deviceId: authority.deviceId, clientId: randomUUID(), connectionInstanceId: randomUUID(), authorizationRevision: 1 };
      const gatewayBinding = { gatewayId: binding.gatewayId, deviceId: binding.deviceId, clientId: binding.clientId, connectionInstanceId: binding.connectionInstanceId };
      lease = new DesktopExecutionLease(root); journal = new DesktopOperationJournal(lease);
      const supervisor = new DesktopOperationSupervisor({ journal, authority: () => authority, createWorker: worker });
      session = new DesktopExecutionSession({ binding, supervisor, confirm: async () => { approvals += 1; return true; } });
      signer = new DesktopDeviceFrameSigner(binding, devicePrivate);
      const verifier = new DesktopDeviceFrameVerifier(binding, deviceKey);
      const connection = new Promise<Socket>(resolve => server.once('connection', resolve));
      client = new WebSocket(`ws://127.0.0.1:${address.port}`);
      await new Promise<void>((resolve, reject) => { client!.once('open', resolve); client!.once('error', reject); });
      peer = await connection;
      const delivered = Promise.withResolvers<string>(), handled = Promise.withResolvers<void>();
      peer.once('message', wire => delivered.resolve(wire.toString()));
      const currentClient = client, currentSession = session, currentSigner = signer;
      client.once('message', raw => { void (async () => {
        const verified = verifyDesktopGatewayFrame(raw.toString(), gatewayBinding, gatewayKey, 0);
        const outcome = await currentSession.invoke(verified.message.payload.payload);
        const response: ClientEndpointMessage = { protocolVersion: 2, messageId: randomUUID(), type: 'tool.result', sentAt: Date.now(),
          payload: { invocationId: verified.message.payload.payload.invocationId, content: [{ type: 'text', text: 'Receipt only' }],
            details: { receipt: outcome.receipt, repeated: outcome.repeated } } };
        const wire = currentSigner.sign(response);
        if (attempt === 0) currentClient.close(); // Drop completion after the durable effect and journal commit.
        else currentClient.send(wire);
        handled.resolve();
      })().catch(handled.reject); });
      const command = { protocolVersion: 2, kind: 'endpoint.message', messageId: randomUUID(), sentAt: Date.now(),
        payload: { protocolVersion: 2, messageId: randomUUID(), type: 'tool.invoke', sentAt: Date.now(),
          payload: { ...request, invocationId: randomUUID() } } };
      const signed = signDesktopGatewayFrame(command, gatewayBinding, 1, payload => sign(null, Buffer.from(payload), gateway.privateKey).toString('base64url'));
      peer.send(JSON.stringify(signed));
      await handled.promise;
      if (attempt === 1) {
        const wire = await delivered.promise;
        const forged = JSON.parse(wire); forged.message.payload.details.receipt.state = 'stopped';
        expect(() => verifier.verify(JSON.stringify(forged))).toThrow('DESKTOP_DEVICE_FRAME_INVALID');
        const response = verifier.verify(wire);
        expect(response.type).toBe('tool.result');
        if (response.type !== 'tool.result') throw new Error('Missing receipt');
        expect(desktopOperationReceiptSchema.parse(response.payload.details!.receipt)).toMatchObject({ operationId: request.execution.operationId,
          state: 'succeeded', executionStopped: true, resultHash: createHash('sha256').update(canonicalJson({ written: true })).digest('hex') });
        expect(response.payload.details!.repeated).toBe(true);
        expect(() => verifier.verify(wire)).toThrow('DESKTOP_DEVICE_FRAME_INVALID');
      }
      await session.close(); session = undefined; signer.close(); journal.close(); journal = undefined; lease.close(); lease = undefined;
      client.terminate(); peer.terminate();
    }
    expect(readFileSync(path, 'utf8')).toBe(args.text); expect(effects).toBe(1); expect(approvals).toBe(1);
  } finally {
    await session?.close(); signer?.close(); client?.terminate(); peer?.terminate();
    journal?.close(); lease?.close();
    await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true });
  }
}, 20000);

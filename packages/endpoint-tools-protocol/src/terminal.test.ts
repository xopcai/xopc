import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import { clientEndpointMessageSchema, serverEndpointMessageSchema } from './index.js';
import { desktopTerminalCommandSchema, desktopTerminalEventSchema } from './terminal.js';

const binding = () => ({ sessionId: randomUUID(), generation: randomUUID(), connectionInstanceId: randomUUID() });
const envelope = (type: string, payload: unknown) => ({ protocolVersion: 3, messageId: randomUUID(), sentAt: Date.now(), type, payload });

it('keeps typed terminal traffic separate from tool progress and never claims opening or EOF proves executor stop', () => {
  const scope = binding(), invocationId = randomUUID();
  const opened = { ...scope, event: 'opened', operationId: randomUUID(), state: 'running', executionStopped: false };
  expect(clientEndpointMessageSchema.parse(envelope('terminal.event', { invocationId, event: opened })).type).toBe('terminal.event');
  expect(desktopTerminalEventSchema.safeParse({ ...opened, executionStopped: true }).success).toBe(false);
  expect(desktopTerminalEventSchema.safeParse({ ...opened, state: 'succeeded' }).success).toBe(false);
  expect(desktopTerminalEventSchema.safeParse({ ...scope, event: 'stream-ended', reason: 'eof', executionStopped: true }).success).toBe(false);
  expect(desktopTerminalEventSchema.safeParse({ ...scope, event: 'stream-ended', reason: 'eof' }).success).toBe(true);
  expect(clientEndpointMessageSchema.safeParse(envelope('tool.progress', { invocationId, bytes: Buffer.from('terminal').toString('base64') })).success).toBe(false);
});

it('bounds stdin/output and resize, rejects source flags, arbitrary container identifiers and control replay metadata', () => {
  const scope = binding(), invocationId = randomUUID(), input = { ...scope, action: 'input', inputId: randomUUID(), sequence: 1, bytes: Buffer.alloc(4096).toString('base64') };
  expect(serverEndpointMessageSchema.parse(envelope('terminal.command', { invocationId, command: input })).type).toBe('terminal.command');
  expect(desktopTerminalCommandSchema.safeParse({ ...input, bytes: Buffer.alloc(4097).toString('base64') }).success).toBe(false);
  for (const extra of [{ source: 'local-user' }, { containerId: 'a'.repeat(64) }, { resume: true }, { sequence: 0 }]) {
    expect(desktopTerminalCommandSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  }
  expect(desktopTerminalEventSchema.safeParse({ ...scope, event: 'output', sequence: 1, bytes: Buffer.alloc(16384).toString('base64') }).success).toBe(true);
  expect(desktopTerminalEventSchema.safeParse({ ...scope, event: 'output', sequence: 1, bytes: Buffer.alloc(16385).toString('base64') }).success).toBe(false);
  expect(desktopTerminalCommandSchema.safeParse({ ...scope, action: 'resize', requestId: randomUUID(), columns: 100, rows: 30 }).success).toBe(true);
  expect(desktopTerminalCommandSchema.safeParse({ ...scope, action: 'resize', columns: 501, rows: 30 }).success).toBe(false);
  expect(desktopTerminalEventSchema.safeParse({ ...scope, event: 'input-ack', inputId: randomUUID(), sequence: 1, dispatch: 'completed' }).success).toBe(false);
});

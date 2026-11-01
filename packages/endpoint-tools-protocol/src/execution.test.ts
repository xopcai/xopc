import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import { desktopOperationIntentSchema, desktopOperationReceiptSchema } from './execution.js';

it('requires stable target identity, argument digest, grant revision and deadline without transport attempt fields', () => {
  const intent = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(), tool: 'workspace.write',
    argumentHash: 'a'.repeat(64), toolRevision: 'b'.repeat(64), authorizationRevision: 3, expiresAt: Date.now() + 60000 };
  expect(desktopOperationIntentSchema.parse(intent)).toEqual(intent);
  for (const patch of [{ invocationId: randomUUID() }, { argumentHash: 'raw arguments' }, { authorizationRevision: -1 }, { expiresAt: Infinity }, { deviceId: 'server-path' }]) {
    expect(() => desktopOperationIntentSchema.parse({ ...intent, ...patch })).toThrow();
  }
});

it('does not confuse a cancellation request, an unknown outcome and a confirmed stop', () => {
  const receipt = { operationId: randomUUID(), updatedAt: Date.now() };
  for (const state of ['recorded', 'running', 'cancel-requested'] as const) {
    expect(desktopOperationReceiptSchema.parse({ ...receipt, state, executionStopped: false }).state).toBe(state);
    expect(() => desktopOperationReceiptSchema.parse({ ...receipt, state, executionStopped: true })).toThrow();
  }
  for (const state of ['succeeded', 'failed', 'stopped'] as const) {
    expect(desktopOperationReceiptSchema.parse({ ...receipt, state, executionStopped: true }).state).toBe(state);
    expect(() => desktopOperationReceiptSchema.parse({ ...receipt, state, executionStopped: false })).toThrow();
  }
  for (const executionStopped of [false, true]) expect(desktopOperationReceiptSchema.parse({ ...receipt, state: 'unknown', executionStopped }).state).toBe('unknown');
  expect(() => desktopOperationReceiptSchema.parse({ ...receipt, state: 'running', executionStopped: false, invocationId: randomUUID() })).toThrow();
});

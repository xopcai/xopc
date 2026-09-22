import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CapabilityDispatcher, defineExternalCapability, type CapabilityContext } from '../runtime/dispatcher.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { executeExternalOperation, ExternalEffectNotAppliedError, type ExternalOperationInput } from '../runtime/external-operations.js';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xopc-external-operation-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'xopc.db') });
});
afterEach(() => {
  closeXopcDatabase();
  resetXopcDatabaseSingletonForTest();
  rmSync(directory, { recursive: true, force: true });
});
const input: ExternalOperationInput = { principalId: 'p', capabilityId: 'xopc.fixture.send', idempotencyKey: 'intent-1',
  requestDigest: 'args', descriptorDigest: 'contract', surface: 'agent', recovery: 'manual' };

describe('external operation outcome safety', () => {
  it('dispatches external capabilities with durable output validation and fresh replay authorization', async () => {
    const execute = vi.fn(async (_input: unknown, context: { operationId: string }) => ({ receiptId: context.operationId }));
    const dispatcher = new CapabilityDispatcher();
    dispatcher.register(defineExternalCapability({ id: 'xopc.fixture.send', majorVersion: 1,
      description: 'Send a fixture action', effect: 'external-write', recovery: 'manual',
      surfaces: ['http', 'agent'], scopes: ['workspace.write'],
      input: z.strictObject({ body: z.string().default('Hello') }), output: z.object({ receiptId: z.string() }), execute,
    }));
    const context: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['workspace.write'], authorize: () => true };
    const descriptor = dispatcher.describe('xopc.fixture.send', context);
    const expected = { ...descriptor, idempotencyKey: 'intent' };
    await expect(dispatcher.call(descriptor.id, {}, context)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const result = await dispatcher.call(descriptor.id, {}, context, expected);
    expect(await dispatcher.call(descriptor.id, { body: 'Hello' }, { ...context, surface: 'agent' }, expected)).toEqual(result);
    await expect(dispatcher.call(descriptor.id, {}, { ...context, authorize: () => false }, expected)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(dispatcher.call(descriptor.id, { body: 'Different' }, context, expected)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not repeat an external capability whose successful effect returned invalid output', async () => {
    const execute = vi.fn(async () => ({ receiptId: 'evidence', valid: false }));
    const dispatcher = new CapabilityDispatcher();
    dispatcher.register(defineExternalCapability({ id: 'xopc.fixture.invalid', majorVersion: 1,
      description: 'Invalid output fixture', effect: 'external-write', recovery: 'manual',
      surfaces: ['http'], scopes: [], input: z.strictObject({}), output: z.object({ valid: z.literal(true) }),
      execute: execute as unknown as () => Promise<{ valid: true }>,
    }));
    const context: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: [], authorize: () => true };
    const descriptor = dispatcher.describe('xopc.fixture.invalid', context);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(dispatcher.call(descriptor.id, {}, context, { ...descriptor, idempotencyKey: 'intent' }))
        .rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    }
    expect(execute).toHaveBeenCalledTimes(1);
    expect(getSqliteDatabase().prepare('SELECT evidence_json FROM capability_operations').get()!.evidence_json)
      .toContain('evidence');
  });
  it('marks an expired manual attempt unknown without executing a replacement', async () => {
    let now = 1000;
    let finish!: (value: { receiptId: string }) => void;
    const request = { ...input, now: () => now, leaseMs: 1000 };
    const first = executeExternalOperation(request, () => new Promise<{ receiptId: string }>(resolve => { finish = resolve; }));
    now = 2001;
    const replacement = vi.fn(async () => ({ receiptId: 'replacement' }));
    await expect(executeExternalOperation(request, replacement)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(replacement).not.toHaveBeenCalled();
    expect(getSqliteDatabase().prepare('SELECT state FROM capability_invocations').get()!.state).toBe('unknown');
    finish({ receiptId: 'late-confirmed' });
    await expect(first).resolves.toEqual({ receiptId: 'late-confirmed' });
    await expect(executeExternalOperation({ ...input, leaseMs: Number.NaN }, replacement)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('never resends an ambiguous manual operation, including after reopen', async () => {
    const send = vi.fn(async () => { throw new Error('Disconnected after sending'); });
    await expect(executeExternalOperation(input, send)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    await expect(executeExternalOperation(input, send)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(executeExternalOperation({ ...input, requestDigest: 'different' }, send)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(executeExternalOperation({ ...input, recovery: 'provider-idempotent' }, send)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('recovers with the same provider key without creating a second effect', async () => {
    const provider = new Map<string, { id: string }>();
    let calls = 0;
    const send = async (key: string) => {
      calls++;
      if (!provider.has(key)) provider.set(key, { id: 'remote-object' });
      if (calls === 1) throw new Error('Lost receipt');
      return provider.get(key)!;
    };
    const request = { ...input, recovery: 'provider-idempotent' as const };
    await expect(executeExternalOperation(request, send)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(await executeExternalOperation(request, send)).toEqual({ id: 'remote-object' });
    expect(await executeExternalOperation(request, send)).toEqual({ id: 'remote-object' });
    expect(provider.size).toBe(1);
    expect(calls).toBe(2);
  });

  it('fences a late executor after an expired lease is taken over', async () => {
    let now = 1000;
    let finish!: (value: { id: string }) => void;
    const request = { ...input, recovery: 'provider-idempotent' as const, now: () => now, leaseMs: 1000 };
    const first = executeExternalOperation(request, () => new Promise<{ id: string }>(resolve => { finish = resolve; }));
    const rejected = expect(first).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await expect(executeExternalOperation(request, async () => ({ id: 'duplicate' }))).rejects.toMatchObject({ code: 'IN_PROGRESS' });
    now = 2001;
    expect(await executeExternalOperation(request, async () => ({ id: 'current' }))).toEqual({ id: 'current' });
    finish({ id: 'stale' });
    await rejected;
    expect(await executeExternalOperation(request, async () => ({ id: 'must-not-run' }))).toEqual({ id: 'current' });
  });

  it('retains provider evidence when output validation fails', async () => {
    await expect(executeExternalOperation(input, async () => ({ receiptId: 'applied-1' }), () => {
      throw new Error('Output contract mismatch');
    })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    const row = getSqliteDatabase().prepare('SELECT state, evidence_json FROM capability_operations').get()!;
    expect(row.state).toBe('unknown');
    expect(JSON.parse(String(row.evidence_json))).toEqual({ receiptId: 'applied-1' });
  });

  it('distinguishes confirmed rejection from an unknown outcome', async () => {
    const send = vi.fn(async () => { throw new ExternalEffectNotAppliedError('Provider rejected before acceptance'); });
    await expect(executeExternalOperation(input, send)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(executeExternalOperation(input, send)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

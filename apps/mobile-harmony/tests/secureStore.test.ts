import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ records: new Map<string, Uint8Array>(), failAlias: '', writes: 0 }));
vi.mock('@kit.ArkTS', () => ({ util: {
  generateRandomUUID: () => randomUUID(),
  TextEncoder: class { encodeInto(value: string) { return new TextEncoder().encode(value); } },
  TextDecoder: class { decodeToString(value: Uint8Array) { return new TextDecoder('utf-8', { fatal: true }).decode(value); } },
} }));
vi.mock('@kit.AssetStoreKit', () => ({ asset: {
  Tag: { ALIAS: 'alias', SECRET: 'secret', RETURN_TYPE: 'return', ACCESSIBILITY: 'access', SYNC_TYPE: 'sync', CONFLICT_RESOLUTION: 'conflict' },
  ReturnType: { ALL: 0 }, Accessibility: { DEVICE_FIRST_UNLOCKED: 0 }, SyncType: { NEVER: 0 },
  ConflictResolution: { OVERWRITE: 0 }, ErrorCode: { NOT_FOUND: 404 },
  async query(query: Map<string, unknown>) {
    const alias = new TextDecoder().decode(query.get('alias') as Uint8Array);
    const secret = state.records.get(alias);
    if (!secret) throw Object.assign(new Error('Not found'), { code: 404 });
    return [new Map([['secret', secret.slice()]])];
  },
  async add(attributes: Map<string, unknown>) {
    const alias = new TextDecoder().decode(attributes.get('alias') as Uint8Array);
    const bytes = attributes.get('secret') as Uint8Array;
    if (alias === state.failAlias) throw new Error('INJECTED_WRITE_FAILURE');
    if (bytes.length === 0 || bytes.length > 1024) throw new Error('NATIVE_SIZE_LIMIT');
    state.writes++; state.records.set(alias, bytes.slice());
  },
  async remove(query: Map<string, unknown>) { state.records.delete(new TextDecoder().decode(query.get('alias') as Uint8Array)); },
} }));
vi.mock('@kit.BasicServicesKit', () => ({}));

import { XopcSecureStore } from '../entry/src/main/ets/service/secureStore.ets';

describe('atomic native secure records', () => {
  beforeEach(() => { state.records.clear(); state.failAlias = ''; state.writes = 0; });
  it('round-trips Unicode across byte boundaries, empty strings, and large-to-small updates', async () => {
    const store = new XopcSecureStore(); const text = '鸿蒙🌟'.repeat(2000);
    await store.write('journal', text); expect(await store.read('journal')).toBe(text);
    expect(state.records.size).toBeGreaterThan(1);
    await store.write('journal', 'short'); expect(await store.read('journal')).toBe('short');
    expect(state.records.size).toBe(1);
    await store.write('journal', ''); expect(await store.read('journal')).toBe('');
    await store.remove('journal'); expect(state.records.size).toBe(0);
  });
  it('keeps the old generation after a failed atomic pointer commit and removes abandoned chunks', async () => {
    const store = new XopcSecureStore(); await store.write('journal', 'old');
    state.failAlias = 'xopc.journal';
    await expect(store.write('journal', 'new'.repeat(2000))).rejects.toThrow('INJECTED_WRITE_FAILURE');
    expect(await store.read('journal')).toBe('old'); expect(state.records.size).toBe(1);
  });
  it('serializes concurrent writes across instances', async () => {
    const first = new XopcSecureStore(); const second = new XopcSecureStore();
    await Promise.all([first.write('journal', 'a'.repeat(15000)), second.write('journal', 'b'.repeat(18000))]);
    expect(await first.read('journal')).toBe('b'.repeat(18000));
    expect(state.records.size).toBe(19);
  });
  it('fails closed if a chunk is missing and accepts legacy short records', async () => {
    const store = new XopcSecureStore(); await store.write('journal', 'x'.repeat(1500));
    state.records.delete([...state.records.keys()].find((key) => key.endsWith('.0'))!);
    await expect(store.read('journal')).rejects.toThrow('INCOMPLETE_SECURE_RECORD');
    state.records.set('xopc.legacy', new TextEncoder().encode('legacy'));
    expect(await store.read('legacy')).toBe('legacy');
  });
});

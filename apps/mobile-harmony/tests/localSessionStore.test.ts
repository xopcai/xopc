import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeSql: vi.fn(),
  getRdbStore: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.ArkData', () => ({
  relationalStore: {
    ConflictResolution: { ON_CONFLICT_REPLACE: 1 },
    RdbPredicates: class {},
    SecurityLevel: { S2: 2 },
    getRdbStore: mocks.getRdbStore,
  },
}));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({
  gatewaySession: { currentProfile: () => ({ gatewayId: 'gateway', deviceId: 'device' }) },
}));

import { XopcLocalSessionStore } from '../entry/src/main/ets/service/localSessionStore.ets';

describe('local session store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.executeSql.mockResolvedValue(undefined);
    mocks.getRdbStore.mockResolvedValue({ executeSql: mocks.executeSql, insert: mocks.insert });
  });

  it('does not expose a newly created draft before SQLite finishes inserting it', async () => {
    let finishInsert!: (rowId: number) => void;
    mocks.insert.mockImplementationOnce(() => new Promise<number>((resolve) => { finishInsert = resolve; }));
    const store = new XopcLocalSessionStore();
    await store.initialize({} as never);
    let saved = false;
    const pending = store.save({
      conversationId: 'draft-1',
      createdAt: '2026-09-27T00:00:00.000Z',
      creation: {
        agentId: 'coding', projectId: null, execution: null, temporary: false, model: '', thinkingLevel: 'off',
      },
    }, 'gateway:device').then(() => { saved = true; });

    await Promise.resolve();
    expect(saved).toBe(false);
    finishInsert(1);
    await pending;
    expect(saved).toBe(true);
  });
});

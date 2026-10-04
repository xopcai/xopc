import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ executeSql: vi.fn(), querySql: vi.fn(), getRdbStore: vi.fn() }));
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.ArkData', () => ({ relationalStore: {
  ConflictResolution: { ON_CONFLICT_REPLACE: 1 },
  RdbPredicates: class {},
  SecurityLevel: { S2: 2 },
  getRdbStore: mocks.getRdbStore,
} }));

import { XopcNoteDraftStore } from '../entry/src/main/ets/service/noteDraftStore.ets';

const columns = (names: string[]) => {
  let index = -1;
  return { getColumnIndex: () => 1, goToNextRow: () => ++index < names.length,
    getString: () => names[index], close: vi.fn() };
};

describe('native note draft schema', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.executeSql.mockResolvedValue(undefined);
    mocks.getRdbStore.mockResolvedValue({ executeSql: mocks.executeSql, querySql: mocks.querySql });
  });

  it('does not issue a duplicate ALTER on an existing device database', async () => {
    mocks.querySql.mockResolvedValue(columns(['note_id', 'project_id']));
    const store = new XopcNoteDraftStore();
    await store.initialize({} as never);
    expect(mocks.executeSql).toHaveBeenCalledTimes(1);
    await store.initialize({} as never);
    expect(mocks.getRdbStore).toHaveBeenCalledTimes(1);
  });

  it('adds a missing column and retries initialization after a real migration failure', async () => {
    mocks.querySql.mockImplementation(async () => columns(['note_id']));
    mocks.executeSql.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('SQLite: Generic error'));
    const store = new XopcNoteDraftStore();
    await expect(store.initialize({} as never)).rejects.toThrow('SQLite: Generic error');
    await store.initialize({} as never);
    expect(mocks.getRdbStore).toHaveBeenCalledTimes(2);
    expect(mocks.executeSql).toHaveBeenCalledWith('ALTER TABLE note_drafts ADD COLUMN project_id TEXT');
  });
});

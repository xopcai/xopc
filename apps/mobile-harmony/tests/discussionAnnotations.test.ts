import { DatabaseSync } from 'node:sqlite';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getStore: vi.fn(),save: vi.fn(),gateway: 'gateway',revision: 1 }));
vi.mock('@kit.ArkData', () => ({ relationalStore: { SecurityLevel: { S2: 2 },getRdbStore: mocks.getStore } }));
vi.mock('../entry/src/main/ets/repository/discussionCaptureRepository.ets', () => ({ XopcDiscussionCaptureRepository: class { saveAnnotation = mocks.save; } }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { currentProfile: () => ({ gatewayId: mocks.gateway }),connectionRevision: () => mocks.revision,assertConnection: (revision: number) => { if (revision !== mocks.revision) throw new Error('GATEWAY_CHANGED'); } } }));
import { XopcAnnotationStore,XopcAnnotationSync } from '../entry/src/main/ets/service/discussionAnnotations.ets';
let db: DatabaseSync;
beforeEach(() => {
  vi.clearAllMocks(); mocks.gateway = 'gateway'; mocks.revision = 1; db = new DatabaseSync(':memory:');
  mocks.getStore.mockResolvedValue({
    executeSql: async (sql: string,bindings: never[] = []) => { db.prepare(sql).run(...bindings); },
    querySql: async (sql: string,bindings: never[] = []) => {
      const rows = db.prepare(sql).all(...bindings) as Record<string,unknown>[]; const columns = Object.keys(rows[0] ?? {}); let index = -1;
      return { goToFirstRow: () => { index = 0; return !!rows.length; },goToNextRow: () => ++index < rows.length,
        getString: (column: number) => String(rows[index][columns[column]]),getLong: (column: number) => Number(rows[index][columns[column]]),close() {} };
    },
  });
});
afterEach(() => db.close());
const annotation = { id: 'mark',kind: 'highlight',text: '',anchor: { type: 'time',capturedAt: 1,positionMs: 2000 },revision: 0,deleted: false,createdAt: 1,updatedAt: 1 };
it('reopens locally committed annotations and syncs a stable id after network loss', async () => {
  const store = new XopcAnnotationStore(); await store.initialize({} as never); await store.save('recording',annotation);
  const reopened = new XopcAnnotationStore(); await reopened.initialize({} as never);
  expect((await reopened.list('recording'))[0].annotation).toEqual(annotation);
  const sync = new XopcAnnotationSync(reopened); mocks.save.mockRejectedValueOnce(new Error('OFFLINE')).mockResolvedValue({ ...annotation,revision: 1 });
  await expect(sync.sync('recording','discussion')).rejects.toThrow('OFFLINE');
  expect((await reopened.list('recording'))[0].state).toBe('pending');
  await sync.sync('recording','discussion'); expect((await reopened.list('recording'))[0].state).toBe('synced');
  expect(mocks.save.mock.calls.map(call => call[1].id)).toEqual(['mark','mark']);
});
it('retains edits when an older acknowledgement arrives and preserves conflicts', async () => {
  const store = new XopcAnnotationStore(); await store.initialize({} as never); await store.save('recording',annotation);
  const row = (await store.list('recording'))[0]; await store.save('recording',{ ...annotation,text: 'New thought' });
  await store.acknowledge(row,{ ...annotation,revision: 1 });
  expect((await store.list('recording'))[0]).toMatchObject({ state: 'pending',annotation: { text: 'New thought' } });
  mocks.save.mockRejectedValue(new Error('HTTP 409')); await expect(new XopcAnnotationSync(store).sync('recording','discussion')).rejects.toThrow('409');
  expect((await store.list('recording'))[0].state).toBe('conflict');
});
it('separates Gateway namespaces and refuses an acknowledgement after switching connection', async () => {
  const store = new XopcAnnotationStore(); await store.initialize({} as never); await store.save('recording',annotation);
  mocks.gateway = 'other'; expect(await store.list('recording')).toEqual([]); mocks.gateway = 'gateway';
  mocks.save.mockImplementation(async () => { mocks.revision++; return { ...annotation,revision: 1 }; });
  await expect(new XopcAnnotationSync(store).sync('recording','discussion')).rejects.toThrow('GATEWAY_CHANGED');
  expect((await store.list('recording'))[0].state).toBe('pending');
});
it('persists review tab and playback position independently without overwriting either', async () => {
  const store = new XopcAnnotationStore(); await store.initialize({} as never);
  await store.saveReviewTab('note','marks'); await store.saveReviewPosition('note',12000,'audio');
  expect(await store.reviewPosition('note')).toEqual({ tab: 'marks',positionMs: 12000,sourceId: 'audio' });
  await store.saveReviewTab('note','transcript'); expect((await store.reviewPosition('note'))?.positionMs).toBe(12000);
});

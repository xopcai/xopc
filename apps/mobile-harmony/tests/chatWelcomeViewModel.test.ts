import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../mobile-expo/src/i18n/locales/en';
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));
import { XopcChatWelcomeViewModel } from '../entry/src/main/ets/viewmodel/chatWelcomeViewModel.ets';
const data = { copy: en.chat.welcomeSpotlight, names: en.agentsPage.builtInAgents };
const scope = { conversationId: 's', work: { project: { id: 'p', title: 'Project' }, task: { id: 't', title: 'Task' } }, sources: [], sourcesHasMore: false, unavailableSections: [] };

describe('welcome context enrichment', () => {
  beforeEach(() => vi.resetAllMocks());
  it('prioritizes the task and latest attention, never POSTs or creates a session', async () => {
    mocks.request.mockResolvedValue(JSON.stringify({ task: { title: 'Task', phase: 'active' }, operationalState: 'waiting', attention: [{ summary: 'Choose the exact scope' }], receipts: [] }));
    const model = new XopcChatWelcomeViewModel(); await model.load(data, scope, '/repo', { id: 'coder' });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/api/tasks/t');
    expect(model.model?.starters[0].prompt).toContain('Choose the exact scope'); expect(model.loading).toBe(false);
  });
  it('uses project blockers and retains usable suggestions when operating data fails', async () => {
    const model = new XopcChatWelcomeViewModel(); const project = { ...scope, work: { project: scope.work.project } };
    mocks.request.mockResolvedValueOnce(JSON.stringify({ project: { name: 'Renamed project' } }))
      .mockResolvedValueOnce(JSON.stringify({ view: { digest: { health: 'attention' }, blockers: [{ detail: 'Approval needed' }], recentResults: [] } }));
    await model.load(data, project); expect(model.model?.starters[0].prompt).toContain('Approval needed');
    expect(mocks.request).toHaveBeenLastCalledWith('/api/projects/p/operating-view');
    mocks.request.mockResolvedValueOnce(JSON.stringify({ project: { name: 'Project' } })).mockRejectedValueOnce(new Error('OFFLINE'));
    await model.load(data, project); expect(model.degraded).toBe(true); expect(model.model?.starters).toHaveLength(3);
  });
  it('rejects stale context results when switching conversation or leaving the screen', async () => {
    let resolve!: (value: string) => void;
    mocks.request.mockReturnValue(new Promise<string>(done => { resolve = done; }));
    const model = new XopcChatWelcomeViewModel(); const old = model.load(data, scope);
    await model.load(data, undefined, '/new'); const current = model.model;
    resolve(JSON.stringify({ task: { title: 'Old task' } })); await old;
    expect(model.model).toBe(current); expect(model.model?.headline).toBe('Start from the current folder');
  });
  it('matches explicit skill-based custom Agent suggestions', async () => {
    const model = new XopcChatWelcomeViewModel();
    await model.load(data, undefined, '', { id: 'custom', name: 'My expert', effective: { skills: { mode: 'selected', include: ['code-review'] } } });
    expect(model.model?.tagline).toContain('My expert'); expect(model.model?.starters[0].id).toContain('coding');
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

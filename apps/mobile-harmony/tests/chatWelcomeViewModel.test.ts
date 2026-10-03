import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../../mobile-expo/src/i18n/locales/en';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn() };
});

vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({
  gatewaySession: { request: mocks.request },
}));

import { XopcChatWelcomeViewModel } from '../entry/src/main/ets/viewmodel/chatWelcomeViewModel.ets';

const data = { copy: en.chat.welcomeSpotlight };
const scope = {
  conversationId: 's',
  work: { project: { id: 'p', title: 'Project' }, task: { id: 't', title: 'Task' } },
  sources: [],
  sourcesHasMore: false,
  unavailableSections: [],
};

describe('welcome context enrichment', () => {
  beforeEach(() => vi.resetAllMocks());

  it('prioritizes explicit task attention without mutating server state', async () => {
    mocks.request.mockResolvedValue(JSON.stringify({
      task: { title: 'Task', phase: 'active' },
      operationalState: 'waiting',
      attention: [{ summary: 'Choose the exact scope' }],
      receipts: [],
    }));
    const model = new XopcChatWelcomeViewModel();

    await model.load(data, scope);

    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/api/tasks/t');
    expect(model.model?.recommendation?.prompt).toContain('Choose the exact scope');
  });

  it('shows a verified project blocker and stays quiet when enrichment fails', async () => {
    const model = new XopcChatWelcomeViewModel();
    const project = { ...scope, work: { project: scope.work.project } };
    mocks.request.mockResolvedValueOnce(JSON.stringify({ project: { name: 'Renamed project' } }))
      .mockResolvedValueOnce(JSON.stringify({
        view: {
          digest: { health: 'attention' },
          blockers: [{ detail: 'Approval needed' }],
          recentResults: [],
        },
      }));

    await model.load(data, project);

    expect(model.model?.recommendation?.prompt).toContain('Approval needed');
    expect(mocks.request).toHaveBeenLastCalledWith('/api/projects/p/operating-view');

    mocks.request.mockResolvedValueOnce(JSON.stringify({ project: { name: 'Project' } }))
      .mockRejectedValueOnce(new Error('OFFLINE'));
    await model.load(data, project);

    expect(model.model?.recommendation).toBeUndefined();
  });

  it('rejects stale context results when switching conversations', async () => {
    let resolve!: (value: string) => void;
    mocks.request.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const model = new XopcChatWelcomeViewModel();
    const old = model.load(data, scope);

    await model.load(data, undefined);
    const current = model.model;
    resolve(JSON.stringify({ task: { title: 'Old task' } }));
    await old;

    expect(model.model).toBe(current);
    expect(model.model?.headline).toBe('What do you want to move forward?');
    expect(model.model?.recommendation).toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { historyRows } from '../entry/src/main/ets/common/chatProtocol.ets';
import { chatPresentationRows } from '../entry/src/main/ets/common/chatPresentation.ets';
import { mergeAssistantRows } from '../entry/src/main/ets/common/chatRichContent.ets';
import { generatedMediaByReply, generatedMediaCards } from '../entry/src/main/ets/common/generatedMedia.ets';

const { request, assertConnection } = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), assertConnection: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({
  gatewaySession: { request, assertConnection, connectionRevision: () => 1 },
}));
import { XopcGeneratedMediaViewModel } from '../entry/src/main/ets/viewmodel/generatedMediaViewModel.ets';

const song = { id: 'song', title: '风从山南来', state: 'completed', createdAt: 1 };
const draft = { id: 'video', transcriptId: 'active', modelRef: 'xopc-cloud/video', revision: 3, createdAt: 2 };
const video = { transcriptId: 'active', modelRef: draft.modelRef, configured: true, jobs: [], draft };

describe('generated media in chat', () => {
  afterEach(() => vi.resetAllMocks());

  it('preserves music and video anchors through compact history, turn merging and presentation', () => {
    const rows = chatPresentationRows(mergeAssistantRows(historyRows({ session: { key: 'chat', messages: [
      { id: 'tools', role: 'assistant', turnId: 'music', content: '' },
      { id: 'song-reply', role: 'assistant', turnId: 'music', content: 'Song ready', generatedMediaIds: [song.id] },
      { id: 'user', role: 'user', content: 'Create a video' },
      { id: 'video-reply', role: 'assistant', turnId: 'video', content: '', generatedMediaIds: [draft.id] },
      { id: 'later', role: 'assistant', turnId: 'later', content: 'Another reply' },
    ] }, pagination: { hasMore: false } })), undefined, '');
    const cards = [...generatedMediaCards('music', { jobs: [song] }), ...generatedMediaCards('video', video)];
    expect([...generatedMediaByReply(cards, rows).keys()]).toEqual(['tools', 'video-reply']);
    expect(generatedMediaByReply(cards, []).get('')).toEqual(cards);
  });

  it('filters old video jobs and only enables confirmation for the configured draft model', () => {
    const response = { ...video, jobs: [
      { id: 'old', transcriptId: 'archived', createdAt: 0 },
      { id: 'current', transcriptId: 'active', createdAt: 1 },
    ] };
    expect(generatedMediaCards('video', response).map(card => card.item.id)).toEqual(['current', draft.id]);
    expect(generatedMediaCards('video', response).at(-1)).toMatchObject({ draft: true, canConfirm: true });
    expect(generatedMediaCards('video', { ...response, modelRef: 'changed' }).at(-1)?.canConfirm).toBe(false);
  });

  it('retains video when music is unavailable and confirms the reviewed draft revision', async () => {
    const job = { id: draft.id, transcriptId: 'active', state: 'queued', createdAt: 3 };
    let confirmed = false;
    request.mockImplementation(async (path: string, method?: string) => {
      if (path.includes('/music-generation/')) throw new Error('NOT_FOUND');
      if (method === 'POST') { confirmed = true; return JSON.stringify(job); }
      return JSON.stringify(confirmed ? { ...video, draft: undefined, jobs: [job] } : video);
    });
    const model = new XopcGeneratedMediaViewModel();
    try {
      model.observe('chat', 'scope', true, false);
      await vi.waitFor(() => expect(model.cards).toHaveLength(1));
      await model.confirm(model.cards[0]);
      expect(request).toHaveBeenCalledWith('/api/video-generation/sessions/chat/jobs/confirm-draft',
        'POST', JSON.stringify({ id: draft.id, revision: 3 }));
      expect(model.cards).toEqual([{ kind: 'video', item: job, draft: false, canConfirm: false }]);
    } finally { model.stop(); }
  });

  it('ignores a delayed response after switching chats', async () => {
    let resolveOld!: (value: string) => void;
    const old = new Promise<string>(resolve => { resolveOld = resolve; });
    request.mockImplementation((path: string) => path.includes('/old/') && path.includes('/music-generation/')
      ? old : Promise.resolve(JSON.stringify({ jobs: [] })));
    const model = new XopcGeneratedMediaViewModel();
    try {
      model.observe('old', 'old', true, false);
      model.observe('new', 'new', true, false);
      resolveOld(JSON.stringify({ jobs: [song] }));
      await old;
      await Promise.resolve();
      expect(model.cards).toEqual([]);
    } finally { model.stop(); }
  });
});

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
    expect(generatedMediaByReply(cards, rows.slice(-1)).get('')).toEqual(cards);
    expect(generatedMediaByReply(cards, rows.slice(1)).get('')).toEqual([cards[0]]);
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

  it('shows a newly queued song before history has a reply anchor and updates the same card', async () => {
    const model = new XopcGeneratedMediaViewModel();
    const jobsPath = '/api/music-generation/sessions/live/jobs';
    let jobs: typeof song[] = [];
    request.mockImplementation(async (path: string) =>
      JSON.stringify({ transcriptId: 'active', jobs: path === jobsPath ? jobs : [] }));
    const observe = (): void => model.observe('live', 'live:active', 'active', true, true);
    try {
      observe();
      expect(model.cards).toEqual([]);
      jobs = [{ ...song, state: 'queued' }];
      observe();
      await vi.waitFor(() => expect(generatedMediaByReply(model.cards, []).get('')).toMatchObject([
        { item: { id: song.id, state: 'queued' } },
      ]));
      jobs = [song];
      observe();
      await vi.waitFor(() => expect(model.cards.map(card => card.item)).toEqual([song]));
    } finally { model.stop(); }
  });

  it('updates the original song card on the next poll even while video is still loading', async () => {
    vi.useFakeTimers();
    const model = new XopcGeneratedMediaViewModel();
    const reply = chatPresentationRows(historyRows({ session: { key: 'poll', messages: [
      { id: 'song-reply', role: 'assistant', content: 'Creating the song', generatedMediaIds: [song.id] },
    ] }, pagination: { hasMore: false } }), undefined, '');
    let music: typeof song & { durationMs?: number } = { ...song, state: 'queued' };
    let resolveVideo!: (result: string) => void;
    const pendingVideo = new Promise<string>(resolve => { resolveVideo = resolve; });
    request.mockImplementation((path: string) => path.includes('/video-generation/') ? pendingVideo
      : Promise.resolve(JSON.stringify({ transcriptId: 'active', jobs: [music] })));
    try {
      model.observe('poll', 'poll:active', 'active', true, false);
      await vi.advanceTimersByTimeAsync(0);
      expect(generatedMediaByReply(model.cards, reply).get('song-reply')?.map(card => card.item))
        .toEqual([music]);

      music = { ...song, durationMs: 154000 };
      await vi.advanceTimersByTimeAsync(3000);
      expect(generatedMediaByReply(model.cards, reply).get('song-reply')?.map(card => card.item))
        .toEqual([music]);
    } finally {
      model.stop();
      resolveVideo(JSON.stringify({ transcriptId: 'active', jobs: [] }));
      await pendingVideo;
      vi.useRealTimers();
    }
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
      model.observe('chat', 'scope', 'active', true, false);
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
      model.observe('old', 'old', 'transcript-old', true, false);
      model.observe('new', 'new', 'transcript-new', true, false);
      resolveOld(JSON.stringify({ jobs: [song] }));
      await old;
      await Promise.resolve();
      expect(model.cards).toEqual([]);
    } finally { model.stop(); }
  });

  it('restores only the original transcript and retains jobs when a refresh omits them', async () => {
    const queuedSong = { ...song, state: 'queued' };
    const savedVideo = { id: 'saved-video', transcriptId: 'active', state: 'completed', createdAt: 4 };
    request.mockImplementation(async (path: string) =>
      JSON.stringify(path.includes('/video-generation/') ? { ...video, jobs: [savedVideo] }
        : { transcriptId: 'active', jobs: [queuedSong] }));
    const model = new XopcGeneratedMediaViewModel();
    try {
      model.observe('revisit', 'gateway:device:revisit:active', 'active', true, false);
      await vi.waitFor(() => expect(model.cards).toHaveLength(3));
      model.observe('other', 'gateway:device:other:active', 'active', false, false);
      expect(model.cards).toEqual([]);
      model.observe('revisit', 'gateway:other-device:revisit:active', 'active', false, false);
      expect(model.cards).toEqual([]);
      model.observe('revisit', 'gateway:device:revisit:reset', 'reset', false, false);
      expect(model.cards).toEqual([]);

      request.mockResolvedValue(JSON.stringify({ transcriptId: 'mismatched', jobs: [] }));
      model.observe('revisit', 'gateway:device:revisit:active', 'active', true, false);
      expect(model.cards.map(card => card.item.id)).toEqual([song.id, draft.id, savedVideo.id]);
      expect(model.cards[1].canConfirm).toBe(false);
      await Promise.resolve();
      expect(model.cards).toHaveLength(3);

      request.mockResolvedValue(JSON.stringify({ transcriptId: 'active', jobs: [] }));
      model.observe('revisit', 'gateway:device:revisit:active', 'active', true, false);
      await vi.waitFor(() => expect(model.cards.map(card => card.item.id)).toEqual([song.id, savedVideo.id]));
      expect(model.cards[0].item.state).toBe('queued');

      request.mockImplementation(async (path: string) => JSON.stringify({
        transcriptId: 'active', jobs: path.includes('/music-generation/') ? [song] : [],
      }));
      model.observe('revisit', 'gateway:device:revisit:active', 'active', true, false);
      await vi.waitFor(() => expect(model.cards.map(card => card.item)).toEqual([song, savedVideo]));
    } finally { model.stop(); }
  });
});

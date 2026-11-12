// @vitest-environment jsdom
import { SEEDANCE_VIDEO_MODEL_REF, type MusicGenerationSession, type VideoGenerationDraft, type VideoGenerationJob, type VideoGenerationSession } from '@xopcai/gateway-contract';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../messages.types';
import { useChatMusicGeneration } from '../../music/chat-music-generation';
import { useChatVideoGeneration } from '../../video/chat-video-generation';

const mediaCache = vi.hoisted(() => ({ data: undefined as MusicGenerationSession | VideoGenerationSession | undefined, mutate: vi.fn() }));
vi.mock('swr', () => ({ default: () => mediaCache }));

vi.mock('@/features/chat/rendering/connected-message-bubble', () => ({
  ConnectedMessageBubble: ({ message, messageIndex, onRetryUserMessageRound }: {
    message: Message; messageIndex: number; onRetryUserMessageRound?: (index: number) => void;
  }) => <button data-transcript-time={message.timestamp} onClick={() => onRetryUserMessageRound?.(messageIndex)}>Message</button>,
}));
import { MessageList } from '../message-list';

describe('conversation timeline', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const renderTimeline = (content: ReactNode) => act(() => root.render(<MemoryRouter>{content}</MemoryRouter>));
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); mediaCache.data = undefined; vi.restoreAllMocks(); });

  it('interleaves results by time while retaining transcript action indices', () => {
    const retry = vi.fn();
    const list: Message[] = [10, 30].map(timestamp => ({ role: 'user', timestamp, content: [{ type: 'text', text: 'Request' }] }));
    act(() => root.render(<MessageList messages={list} timelineEntries={[{ id: 'run-1', timestamp: 20, content: 'Run result' }]}
      streaming={false} progress={null} reasoningLevel="off" registerListContentRef={() => {}} onRetryUserMessageRound={retry} />));
    const ordered = [...container.querySelectorAll('[data-transcript-time], [data-chat-timeline-entry]')];
    expect(ordered.map(node => node.getAttribute('data-transcript-time') ?? node.getAttribute('data-chat-timeline-entry'))).toEqual(['10', 'run-1', '30']);
    expect(ordered[1].classList.contains('-mt-5')).toBe(false);
    act(() => (ordered[2] as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalledWith(1);
    expect(list).toHaveLength(2);
  });

  it('renders a result without showing empty conversation suggestions', () => {
    act(() => root.render(<MessageList messages={[]} timelineEntries={[{ id: 'run-1', timestamp: 20, content: 'Run result' }]}
      streaming={false} progress={null} reasoningLevel="off" registerListContentRef={() => {}} welcomeOverlay={<p>Welcome</p>} />));
    expect(container.textContent).toContain('Run result');
    expect(container.textContent).not.toContain('Welcome');
  });

  it('keeps a single time separator for nearby messages around a video card', () => {
    const messages: Message[] = [
      { role: 'user', timestamp: 10, content: [{ type: 'text', text: 'Make a video' }] },
      { role: 'assistant', timestamp: 30, content: [{ type: 'text', text: 'Review the draft' }] },
    ];
    act(() => root.render(<MessageList messages={messages}
      timelineEntries={[{ id: 'video-generation:draft', timestamp: 20, content: 'Video draft' }]}
      streaming={false} progress={null} reasoningLevel="off" registerListContentRef={() => {}} />));
    expect(container.querySelectorAll('[data-chat-time-separator]')).toHaveLength(1);
  });

  it.each(['live', 'history'])('puts a music card after its originating %s reply', (source) => {
    const receipt = { id: 'song', workId: 'song', state: 'queued' };
    const toolResult = JSON.stringify(source === 'live' ? { details: receipt } : receipt);
    const list: Message[] = [
      { role: 'user', timestamp: 10, content: [{ type: 'text', text: 'Make a song' }] },
      { role: 'assistant', timestamp: 30, content: [
        { type: 'tool_use', id: 'create', name: 'music_generation', status: 'done', result: toolResult },
        { type: 'text', text: 'The song is queued' },
      ] },
      { role: 'user', timestamp: 30, content: [{ type: 'text', text: 'Check its status' }] },
      { role: 'assistant', timestamp: 40, content: [{ type: 'text', text: 'Still queued' }] },
    ];
    mediaCache.data = { configured: true, jobs: [{
      id: 'song', workId: 'song', parentId: null, versionNumber: 1, modelRef: 'music/model',
      title: 'Song', mode: 'song', prompt: 'Folk', lyrics: 'Lyrics', state: 'running',
      durationMs: null, error: null, createdAt: 20,
    }] };
    function MusicConversation() {
      const entries = useChatMusicGeneration('conversation', 'en', false, list);
      return <MessageList messages={list} timelineEntries={entries}
        streaming={false} progress={null} reasoningLevel="off" registerListContentRef={() => {}} />;
    }
    renderTimeline(<MusicConversation />);
    expect([...container.querySelectorAll('[data-chat-message-index], [data-chat-timeline-entry]')]
      .map(node => node.getAttribute('data-chat-message-index') ?? node.getAttribute('data-chat-timeline-entry')))
      .toEqual(['0', '1', 'music-generation:song', '2', '3']);
    expect(container.querySelector('[data-chat-timeline-entry]')?.classList.contains('-mt-5')).toBe(true);
  });

  it.each(['live', 'history'])('keeps the video draft and its job below the originating %s reply', (source) => {
    const original: VideoGenerationDraft = {
      id: 'video', revision: 1, transcriptId: 'transcript', modelRef: SEEDANCE_VIDEO_MODEL_REF,
      prompt: 'A boat', duration: 4, resolution: '480P', ratio: '16:9',
      imageUri: null, imageName: null, estimatedCostFen: 100, createdAt: 20,
    };
    const draft = { ...original, revision: 2, prompt: 'A blue boat' };
    const reply = (video: VideoGenerationDraft, timestamp: number, text: string): Message => {
      const receipt = JSON.stringify(video);
      const result = source === 'live' ? JSON.stringify({ content: [{ type: 'text', text: receipt }], details: {} }) : receipt;
      return { role: 'assistant', timestamp, content: [
        { type: 'tool_use', id: `draft-${video.revision}`, name: 'video_draft', status: 'done', result },
        { type: 'text', text },
      ] };
    };
    const list: Message[] = [
      { role: 'user', timestamp: 10, content: [{ type: 'text', text: 'Make a video' }] },
      reply(original, 30, 'Review the draft'),
      { role: 'user', timestamp: 40, content: [{ type: 'text', text: 'Make the boat blue' }] },
      reply(draft, 60, 'I updated the draft'),
    ];
    const session: VideoGenerationSession = { transcriptId: draft.transcriptId, configured: true,
      modelRef: draft.modelRef, defaults: { duration: 4, resolution: '480P' }, draft, jobs: [] };
    const job: VideoGenerationJob = { id: draft.id, transcriptId: draft.transcriptId, modelRef: draft.modelRef,
      prompt: draft.prompt, duration: draft.duration, resolution: draft.resolution, ratio: draft.ratio,
      imageName: null, state: 'queued', error: null, createdAt: 70, draftCreatedAt: draft.createdAt };
    function VideoConversation({ data }: { data: VideoGenerationSession }) {
      mediaCache.data = data;
      const { timelineEntries } = useChatVideoGeneration('conversation', 'en', list);
      return <MessageList messages={list} timelineEntries={timelineEntries}
        streaming={false} progress={null} reasoningLevel="off" registerListContentRef={() => {}} />;
    }
    const expectOrder = () => {
      expect([...container.querySelectorAll('[data-chat-message-index], [data-chat-timeline-entry]')]
        .map(node => node.getAttribute('data-chat-message-index') ?? node.getAttribute('data-chat-timeline-entry')))
        .toEqual(['0', '1', 'video-generation:video', '2', '3']);
    };

    renderTimeline(<VideoConversation data={session} />);
    expect(container.textContent).toContain('Video draft');
    expectOrder();

    renderTimeline(<VideoConversation data={{ ...session, draft: undefined, jobs: [job] }} />);
    expect(container.querySelector('[data-chat-timeline-entry] [role="status"]')?.textContent).toBe('Queued');
    expectOrder();

    renderTimeline(<VideoConversation data={{ ...session, draft: undefined, jobs: [{ ...job, state: 'completed' }] }} />);
    expect(container.querySelector('[data-chat-timeline-entry] video')).toBeTruthy();
    expectOrder();
  });

  it('keeps music playback and download visible while showing lyrics and creation details on demand', () => {
    mediaCache.data = { configured: true, jobs: [{
      id: 'song', workId: 'song', parentId: null, versionNumber: 1, modelRef: 'music/model',
      title: 'Song', mode: 'song', prompt: 'Full folk-pop prompt', lyrics: 'The first line', state: 'completed',
      durationMs: 30_000, error: null, createdAt: 20,
    }] };
    const list: Message[] = [];
    function MusicConversation() {
      const entries = useChatMusicGeneration('conversation', 'zh', false, list);
      return <MessageList messages={list} timelineEntries={entries}
        streaming={false} progress={null} reasoningLevel="off" registerListContentRef={() => {}} />;
    }
    renderTimeline(<MusicConversation />);
    const card = container.querySelector('article')!;
    const player = card.querySelector('audio');
    const download = card.querySelector('a[download]');
    const lyrics = card.querySelector<HTMLButtonElement>('[role="group"] button[aria-controls]')!;
    const details = card.querySelector<HTMLButtonElement>('button[aria-label="创作详情"]')!;
    expect(player).toBeTruthy();
    expect(download?.getAttribute('aria-label')).toBe('下载音频');
    expect(lyrics.textContent).toBe('歌词');
    expect(card.textContent).not.toContain('Full folk-pop prompt');
    expect(card.textContent).not.toContain('The first line');

    act(() => lyrics.click());
    expect(lyrics.getAttribute('aria-expanded')).toBe('true');
    const lyricsRegion = lyrics.closest('[role="group"]')!.querySelector('[role="region"]')!;
    expect(lyricsRegion.textContent).toBe('The first line');
    expect(download!.compareDocumentPosition(lyricsRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.querySelector('button[aria-label="播放"]')).toBeTruthy();

    act(() => details.click());
    expect(lyrics.getAttribute('aria-expanded')).toBe('false');
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(card.textContent).not.toContain('The first line');
    expect(card.textContent).toContain('Full folk-pop prompt');
    expect(card.textContent).toContain('music/model');
    expect(card.querySelector('audio')).toBe(player);

    act(() => details.click());
    expect(details.getAttribute('aria-expanded')).toBe('false');
    expect(card.textContent).not.toContain('Full folk-pop prompt');
  });

  it('preserves user and reply order when confirmation advances the user timestamp past the reply shell', () => {
    const user: Message = { role: 'user', timestamp: 30, content: [{ type: 'text', text: 'Export the result' }] };
    const reply: Message = { role: 'assistant', timestamp: 31, content: [], pendingResponseStatus: 'sending' };
    const render = (input: Message, response: Message, streaming: boolean, sending: boolean) => {
      act(() => root.render(<MessageList messages={[input, response]}
        timelineEntries={[{ id: 'run-1', timestamp: 20, content: 'Run result' }]}
        streaming={streaming} sending={sending} progress={null} reasoningLevel="off" registerListContentRef={() => {}} />));
      expect([...container.querySelectorAll('[data-chat-message-index], [data-chat-timeline-entry]')]
        .map(node => node.getAttribute('data-chat-message-index') ?? node.getAttribute('data-chat-timeline-entry')))
        .toEqual(['run-1', '0', '1']);
    };

    render(user, reply, false, true);
    const confirmed = { ...user, timestamp: 32 };
    render(confirmed, { ...reply, pendingResponseStatus: 'waiting' }, false, true);
    render(confirmed, { ...reply, pendingResponseStatus: undefined, content: [{ type: 'text', text: 'Exporting' }] }, true, false);
    render(confirmed, { ...reply, timestamp: 33, pendingResponseStatus: undefined,
      content: [{ type: 'text', text: 'Exported' }] }, false, false);
  });

  it('keeps an undated streaming reply after its user message instead of above past results', () => {
    const list: Message[] = [
      { role: 'user', timestamp: 30, content: [{ type: 'text', text: 'Repair the task' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Working on it' }] },
    ];
    act(() => root.render(<MessageList messages={list} timelineEntries={[{ id: 'failed-run', timestamp: 20, content: 'Failure' }]}
      streaming progress={null} reasoningLevel="off" registerListContentRef={() => {}} />));
    expect([...container.querySelectorAll('[data-chat-message-index], [data-chat-timeline-entry]')]
      .map(node => node.getAttribute('data-chat-message-index') ?? node.getAttribute('data-chat-timeline-entry')))
      .toEqual(['failed-run', '0', '1']);
  });
});

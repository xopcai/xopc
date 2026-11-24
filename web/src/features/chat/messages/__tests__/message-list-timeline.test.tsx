// @vitest-environment jsdom
import { SEEDANCE_VIDEO_MODEL_REF, type ImageGenerationSession, type MusicGenerationSession, type VideoGenerationDraft, type VideoGenerationJob, type VideoGenerationSession } from '@xopcai/gateway-contract';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../messages.types';
import { useChatImageGeneration } from '../../image/chat-image-generation';
import { useChatMusicGeneration } from '../../music/chat-music-generation';
import { useChatVideoGeneration } from '../../video/chat-video-generation';

const mediaCache = vi.hoisted(() => ({ data: undefined as ImageGenerationSession | MusicGenerationSession | VideoGenerationSession | undefined, mutate: vi.fn() }));
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
  afterEach(() => { act(() => root.unmount()); container.remove(); mediaCache.data = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it.each(['live', 'history'])('keeps the video draft and its job below the latest draft-changing %s reply', (source) => {
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
      { role: 'user', timestamp: 80, content: [{ type: 'text', text: 'What color is the boat?' }] },
      { role: 'assistant', timestamp: 90, content: [
        { type: 'tool_use', id: 'inspect', name: 'video_draft', status: 'done', result: JSON.stringify({ draft }) },
        { type: 'text', text: 'The boat is blue' },
      ] },
    ];
    const session: VideoGenerationSession = { transcriptId: draft.transcriptId, configured: true,
      modelRef: draft.modelRef, defaults: { duration: 4, resolution: '480P' }, draft, jobs: [] };
    const job: VideoGenerationJob = { id: draft.id, transcriptId: draft.transcriptId, modelRef: draft.modelRef,
      prompt: draft.prompt, duration: draft.duration, resolution: draft.resolution, ratio: draft.ratio,
      imageName: null, state: 'queued', error: null, createdAt: 70, draftCreatedAt: draft.createdAt };
    function VideoConversation({ data, messages = list }: { data: VideoGenerationSession; messages?: Message[] }) {
      mediaCache.data = data;
      const { timelineEntries } = useChatVideoGeneration('conversation', 'zh', messages);
      return <MessageList messages={messages} timelineEntries={timelineEntries}
        streaming={false} progress={null} reasoningLevel="off" registerListContentRef={() => {}} />;
    }
    const order = () => [...container.querySelectorAll('[data-chat-message-index], [data-chat-timeline-entry]')]
      .map(node => node.getAttribute('data-chat-message-index') ?? node.getAttribute('data-chat-timeline-entry'));
    const updatedOrder = ['0', '1', '2', '3', 'video-generation:video', '4', '5'];

    renderTimeline(<VideoConversation data={{ ...session, draft: original }} messages={list.slice(0, 2)} />);
    expect(order()).toEqual(['0', '1', 'video-generation:video']);

    renderTimeline(<VideoConversation data={session} />);
    const card = container.querySelector('[data-chat-timeline-entry]');
    expect(card?.textContent).toContain('A blue boat');
    expect(card?.querySelector('button')?.textContent).toBe('确认生成');
    expect(order()).toEqual(updatedOrder);

    renderTimeline(<VideoConversation data={{ ...session, draft: undefined, jobs: [job] }} />);
    expect(container.querySelector('[data-chat-timeline-entry] [role="status"]')?.textContent).toBe('排队中');
    expect(order()).toEqual(updatedOrder);

    renderTimeline(<VideoConversation data={{ ...session, draft: undefined, jobs: [{ ...job, state: 'completed' }] }} />);
    expect(container.querySelector('[data-chat-timeline-entry] video')?.hasAttribute('controls')).toBe(false);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="预览 视频"]')!.click());
    const videoPreview = document.querySelector('[role="dialog"]')!;
    expect(videoPreview.querySelector('video')).toBeTruthy();
    expect(videoPreview.querySelector('a[download]')?.getAttribute('aria-label')).toBe('下载视频');
    act(() => videoPreview.querySelector<HTMLButtonElement>('button[aria-label="关闭预览"]')!.click());
    expect(order()).toEqual(updatedOrder);
  });

  it('opens the original images in a gallery without embedding the full images in the timeline', async () => {
    const fetchImage = vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' })));
    const createObjectURL = vi.fn()
      .mockReturnValueOnce('blob:cover')
      .mockReturnValueOnce('blob:second-image')
      .mockReturnValueOnce('blob:gallery-second-image');
    vi.stubGlobal('fetch', fetchImage);
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = vi.fn();
    });
    mediaCache.data = { configured: true, jobs: [{
      id: 'image', workId: 'image', parentId: null, versionNumber: 1, title: 'Coast', prompt: 'Sunset',
      modelRef: null, aspectRatio: null, resolution: null, quality: null, count: 2, state: 'completed', error: null, createdAt: 20,
      images: [0, 1].map(index => ({ index, mediaUri: `media://outbound/image-${index}.png`, mimeType: 'image/png' })),
    }] };
    const list: Message[] = [];
    function ImageConversation() {
      const entries = useChatImageGeneration('conversation', 'en', false, list);
      return <MessageList messages={list} timelineEntries={entries}
        streaming={false} progress={null} reasoningLevel="off" registerListContentRef={() => {}} />;
    }
    await act(async () => { renderTimeline(<ImageConversation />); });
    expect(container.querySelector('article img')?.getAttribute('src')).toBe('blob:cover');
    expect(fetchImage).toHaveBeenCalledTimes(2);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Preview Coast · 1 / 2"]')!.click());
    const gallery = document.querySelector('[role="dialog"]')!;
    expect(gallery.querySelector('img')?.getAttribute('src')).toBe('blob:cover');
    const next = gallery.querySelector<HTMLButtonElement>('button[aria-label="Next image"]')!;
    await act(async () => { next.click(); });
    expect(gallery.querySelector('[role="status"]')?.textContent).toBe('2 / 2');
    expect(gallery.querySelector('img')?.getAttribute('src')).toBe('blob:gallery-second-image');
    expect(gallery.querySelector('a[download]')?.getAttribute('href')).toContain('/images/1?download=1');
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
    act(() => card.querySelector<HTMLButtonElement>('button[aria-label="预览 Song"]')!.click());
    const preview = document.querySelector('[role="dialog"]')!;
    expect(preview.querySelector('button[aria-label="播放"]')).toBeTruthy();
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    act(() => preview.querySelector<HTMLButtonElement>('button[aria-label="关闭预览"]')!.click());
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

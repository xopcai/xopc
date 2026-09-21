import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resume: vi.fn(),
  run: vi.fn(),
  pending: vi.fn(),
  clearPending: vi.fn(),
  voiceMerge: vi.fn(),
  voiceInspection: vi.fn(),
  isVoice: vi.fn(),
}));
vi.mock('../../../storage/sqlite/connection-wait-repository.js', () => ({ getConnectionResumeInput: mocks.resume }));
vi.mock('../../../session/index.js', () => ({
  resolveConfiguredActivityDetailDefault: () => 'stream',
  resolveEffectiveReasoningLevel: async () => 'stream',
}));
vi.mock('../direct-turn-helpers.js', () => ({
  hydratePerTurnState: async () => undefined,
  tryRunSlashCommand: async () => ({ matched: false }),
  runDirectAgentTurn: mocks.run,
}));
vi.mock('../../inbound/attachment-pipeline.js', () => ({
  setPendingTranscriptUserMessage: mocks.pending,
  clearPendingTranscriptUserMessage: mocks.clearPending,
}));
vi.mock('../../../channels/attachments/voice-stt-webchat.js', () => ({
  isVoiceLikeAttachment: mocks.isVoice,
  mergeVoiceTranscriptsIntoUserText: mocks.voiceMerge,
  requestsOriginalVoiceInspection: mocks.voiceInspection,
}));
vi.mock('../../../voice/stt/index.js', () => ({ mergeSttConfigFromAppConfig: () => ({}) }));

import { runProcessDirectStreaming, type ProcessDirectStreamingDeps } from '../process-direct-streaming.js';

function setup() {
  const title = vi.fn();
  const buildTranscriptUserMessage = vi.fn(async (content: string) => ({ role: 'user', content, timestamp: 1 }));
  const deps = {
    log: { warn: vi.fn(), info: vi.fn() },
    resolveSessionEndpoint: async () => ({ channel: 'webchat', chatId: 'chat' }),
    initDirectStreamingSession: () => ({}),
    registerWebchatStreamPublisher: vi.fn(), unregisterWebchatStreamPublisher: vi.fn(),
    endDirectRequestContext: vi.fn(), getConfig: () => undefined,
    prepareInboundAttachments: async () => undefined,
    buildTranscriptUserMessage,
    agentManager: {
      prepareSkillTurn: (_key: string, text: string) => ({ text, activatedCapabilityNames: [] }),
      withSkillCapabilities: (_key: string, _names: string[], run: () => unknown) => run(),
    },
    maybeEmitWebchatTts: async () => null,
    enqueueProvisionalSessionTitle: title,
  } as unknown as ProcessDirectStreamingDeps;
  return { deps, title, buildTranscriptUserMessage };
}

describe('direct stream input visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resume.mockReturnValue(undefined);
    mocks.isVoice.mockReturnValue(false);
    mocks.voiceInspection.mockReturnValue(false);
    mocks.voiceMerge.mockImplementation(async (_attachments: unknown, text: string) => ({
      text,
      inboundVoice: false,
      voiceTranscripts: [],
      transcribedMediaUris: [],
    }));
    mocks.run.mockImplementation(async (_deps, input) => {
      input.onEvent({ type: 'message_end', message: { role: 'assistant', content: 'Resumed' } });
      return { ok: true, lastAssistantText: 'Resumed' };
    });
  });

  it.each(['continued', 'skipped'])('keeps a %s connection continuation out of user events, titles, and pending transcript rows', async resolution => {
    mocks.resume.mockReturnValue({ kind: 'connection_resume', payload: { resolution } });
    const { deps, title } = setup();
    const events = [];
    for await (const event of runProcessDirectStreaming(deps, {
      content: 'Internal recovery instruction', conversationId: 'agent:main:main', runId: 'resume-run',
      origin: { type: 'system', source: 'internal' },
    })) events.push(event);
    expect(events.map(event => event.type)).toEqual(['message_end']);
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(title).not.toHaveBeenCalled();
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.clearPending).not.toHaveBeenCalled();
  });

  it('still publishes and records actual user input', async () => {
    const { deps, title } = setup();
    const events = [];
    for await (const event of runProcessDirectStreaming(deps, {
      content: 'Check Gmail', conversationId: 'agent:main:main', runId: 'user-run',
      origin: { type: 'system', source: 'internal' },
    })) events.push(event);
    expect(events.map(event => event.type)).toEqual(['user_message', 'message_end']);
    expect(title).toHaveBeenCalledWith('agent:main:main', 'Check Gmail');
    expect(mocks.pending).toHaveBeenCalledOnce();
    expect(mocks.clearPending).toHaveBeenCalledOnce();
  });

  it('suppresses read_media prompts for successfully transcribed voice while retaining its media', async () => {
    const uri = 'media://inbound/voice.m4a';
    const media = [{
      id: 'voice-1', bucket: 'inbound', type: 'voice', mimeType: 'audio/mp4',
      uri, name: 'voice.m4a', size: 3, path: '/tmp/voice.m4a',
    }];
    mocks.isVoice.mockReturnValue(true);
    mocks.voiceMerge.mockResolvedValue({
      text: '转写后的内容',
      inboundVoice: true,
      voiceTranscripts: ['转写后的内容'],
      transcribedMediaUris: [uri],
    });
    const { deps, buildTranscriptUserMessage } = setup();
    deps.prepareInboundAttachments = vi.fn(async () => media);

    for await (const _event of runProcessDirectStreaming(deps, {
      content: '', conversationId: 'agent:main:voice', runId: 'voice-run',
      origin: { type: 'system', source: 'internal' },
      attachments: media,
    })) { /* drain */ }

    const options = buildTranscriptUserMessage.mock.calls[0]?.[3] as {
      suppressMediaPromptUris?: ReadonlySet<string>;
    };
    expect(options.suppressMediaPromptUris?.has(uri)).toBe(true);
    expect(buildTranscriptUserMessage.mock.calls[0]?.[1]).toEqual(media);
  });

  it('exposes a session-bound note as visible and persisted turn context', async () => {
    const { deps } = setup();
    const sourceContext = {
      kind: 'note' as const,
      sourceId: 'note-1',
      version: '2',
      title: 'Bound note',
      text: '# Bound note\n\nSource content',
    };
    deps.sourceContextResolver = vi.fn(async () => sourceContext);
    deps.sessionStore = {
      getMetadata: vi.fn(async () => ({
        customData: {
          sourceBinding: {
            kind: 'note', sourceId: 'note-1', version: '1', attachedAt: 1,
          },
        },
      })),
    } as never;

    const events = [];
    for await (const event of runProcessDirectStreaming(deps, {
      content: 'Update this note', conversationId: 'agent:main:note', runId: 'note-run',
      origin: { type: 'system', source: 'internal' },
    })) events.push(event);

    expect(events[0]).toEqual(expect.objectContaining({
      type: 'user_message',
      metadata: {
        sourceContexts: [expect.objectContaining({
          kind: 'note', sourceId: 'note-1', version: '2', title: 'Bound note',
        })],
      },
    }));
    expect(mocks.pending).toHaveBeenCalledWith(
      'agent:main:note',
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceContexts: [expect.objectContaining({ sourceId: 'note-1', version: '2' })],
        }),
      }),
    );
    expect(mocks.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceContexts: [sourceContext] }),
    );
  });

  it('finishes the text stream while deferred speech is still pending', async () => {
    const { deps } = setup();
    let completeAudio!: (audio: { type: 'tts_audio'; uri: string; name: string; mimeType: string }) => void;
    deps.maybeEmitWebchatTts = vi.fn(() => new Promise(resolve => { completeAudio = resolve; }));
    const onDeferredAudio = vi.fn();
    const events = [];
    for await (const event of runProcessDirectStreaming(deps, {
      content: 'hello', conversationId: 'chat', runId: 'run',
      origin: { type: 'system', source: 'internal' }, onDeferredAudio,
    })) events.push(event);
    expect(events.map(event => event.type)).toEqual(['user_message', 'message_end']);
    expect(deps.unregisterWebchatStreamPublisher).toHaveBeenCalledOnce();
    expect(onDeferredAudio).not.toHaveBeenCalled();
    const audio = { type: 'tts_audio' as const, uri: 'media://tts/reply.mp3', name: 'reply.mp3', mimeType: 'audio/mpeg' };
    completeAudio(audio);
    await vi.waitFor(() => expect(onDeferredAudio).toHaveBeenCalledWith(audio));
  });

  it('contains deferred speech failures after the text run has ended', async () => {
    const { deps } = setup();
    let failAudio!: (error: Error) => void;
    deps.maybeEmitWebchatTts = vi.fn(() => new Promise((_resolve, reject) => { failAudio = reject; }));
    const onDeferredAudio = vi.fn();
    for await (const _event of runProcessDirectStreaming(deps, {
      content: 'hello', conversationId: 'chat', runId: 'run',
      origin: { type: 'system', source: 'internal' }, onDeferredAudio,
    })) { /* drain */ }
    failAudio(new Error('speech offline'));
    await vi.waitFor(() => expect(deps.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'chat', runId: 'run' }), 'Failed to deliver assistant audio',
    ));
    expect(onDeferredAudio).not.toHaveBeenCalled();
  });

});
